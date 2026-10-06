import { createHash } from "node:crypto";
import { RODOPAR_CHUNK_ROWS, readRodoparWorkbook, type RodoparReadResult, type RodoparRow } from "../rodopar-sheet";
import { GraphError, type GraphFileSource } from "./graph";

/**
 * Sincronização da fonte oficial dos pneus (planilha do SharePoint) — o
 * orquestrador. Não tem regra de negócio: abre a execução no banco (trava),
 * localiza e baixa o arquivo pela Graph, lê com o MESMO leitor da importação
 * manual, envia pelo MESMO pipeline (tire_import_start → stage → validate →
 * confirm) e encerra a execução com o resultado. Toda decisão (Nº Fogo como
 * texto, situação canônica, comparação, ausentes, revisão do mesmo dia,
 * auditoria) é do banco.
 *
 *   sem alteração .... eTag igual (ou mesmo hash/arquivo já aplicado) → nada muda
 *   estrutura ........ coluna oficial ausente → bloqueada, nada é gravado
 *   desatualizada .... planilha mais antiga que os dados vigentes → bloqueada
 *   mesma data ....... revisão do dia (a versão anterior fica arquivada)
 *   lote bloqueado ... erros bloqueantes (Nº Fogo duplicado, posição dupla…)
 *   falha ............ credenciais, permissão, arquivo/rede indisponível
 *
 * Funciona com qualquer cliente de banco que fale RPC: o da pessoa (botão
 * "Sincronizar agora" — a autoria fica com ela) ou o do servidor (agendada).
 */

export type SyncTrigger = "agendada" | "manual" | "reprocessamento";
export type SyncFinalStatus = "concluida" | "concluida_com_avisos" | "sem_alteracao" | "bloqueada" | "falhou";

export interface SyncRpcError {
  code?: string;
  message?: string;
  hint?: string;
  details?: string;
}
export type SyncRpc = (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: SyncRpcError | null }>;

export interface SyncDeps {
  rpc: SyncRpc;
  organizationId: string;
  /** null = credenciais da integração ausentes no servidor. */
  graph: GraphFileSource | null;
  /** Limite do arquivo baixado (padrão 40 MB). */
  maxBytes?: number;
  /** Leitor da planilha (o teste pode injetar). */
  parse?: (buffer: ArrayBuffer, file: { fileName: string; fileSize: number; fileHash: string }) => Promise<RodoparReadResult>;
}

export interface SyncOutcome {
  status: SyncFinalStatus | "ignorada" | "em_andamento";
  runId: string | null;
  message: string;
  errorCode?: string | null;
  batchId?: string | null;
  referenceDate?: string | null;
  sameDayRevision?: boolean;
  counters?: Record<string, number>;
}

interface BeginResult {
  skipped: boolean;
  reason?: string;
  run_id?: string;
  latest_reference_date?: string | null;
  today?: string;
  force?: boolean;
  source?: {
    site_hostname: string;
    site_path: string;
    drive_name: string;
    file_path: string;
    resolved_site_id: string | null;
    resolved_drive_id: string | null;
    resolved_item_id: string | null;
    last_etag: string | null;
    last_file_hash: string | null;
    last_status: string | null;
  };
}

class SyncStop extends Error {
  constructor(
    public readonly status: SyncFinalStatus,
    public readonly code: string | null,
    message: string,
    public readonly patch: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

const ptDate = (iso: string | null | undefined) => (iso ? iso.slice(0, 10).split("-").reverse().join("/") : "—");

async function defaultParse(buffer: ArrayBuffer, file: { fileName: string; fileSize: number; fileHash: string }): Promise<RodoparReadResult> {
  const ExcelJS = (await import("exceljs")).default;
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(buffer);
  } catch {
    return { ok: false, error: "O arquivo baixado não é um XLSX válido." };
  }
  return readRodoparWorkbook(workbook, file);
}

export async function runTireSync(deps: SyncDeps, trigger: SyncTrigger, reprocessOf: string | null = null): Promise<SyncOutcome> {
  const { rpc, organizationId } = deps;
  const org = { p_organization_id: organizationId };

  const begun = await rpc("tire_sync_begin", { ...org, p_trigger: trigger, p_reprocess_of: reprocessOf });
  if (begun.error) {
    if (begun.error.hint === "tire_sync_running") {
      return { status: "em_andamento", runId: null, message: begun.error.message ?? "Já existe uma sincronização em andamento." };
    }
    return { status: "falhou", runId: null, message: begun.error.message ?? "Não foi possível iniciar a sincronização.", errorCode: begun.error.hint ?? begun.error.code };
  }
  const start = begun.data as BeginResult;
  if (start.skipped || !start.run_id || !start.source) {
    return {
      status: "ignorada",
      runId: null,
      message: start.reason === "inactive" ? "A sincronização automática está pausada." : "Sincronizado há pouco: aguardando o intervalo mínimo.",
    };
  }
  const runId = start.run_id;
  const source = start.source;
  const force = trigger === "reprocessamento";

  const log = async (step: string, message: string, patch: Record<string, unknown> = {}, level: "info" | "warning" | "error" = "info") => {
    const r = await rpc("tire_sync_log", { ...org, p_run_id: runId, p_step: step, p_level: level, p_message: message, p_patch: patch });
    if (r.error) throw new SyncStop("falhou", "registro_falhou", r.error.message ?? "Falha ao registrar a etapa da sincronização.");
  };

  let outcome: SyncOutcome;
  try {
    if (!deps.graph) {
      throw new SyncStop(
        "falhou",
        "credenciais_ausentes",
        "Credenciais da integração com o SharePoint não configuradas no servidor (MS_GRAPH_TENANT_ID, MS_GRAPH_CLIENT_ID, MS_GRAPH_CLIENT_SECRET).",
      );
    }

    // 1. localizar o arquivo (ids guardados; se sumiu, relocaliza pelo caminho)
    await log("localizando", `Localizando ${source.file_path} em ${source.site_hostname}${source.site_path}.`);
    const located = await deps.graph.locate({
      siteHostname: source.site_hostname,
      sitePath: source.site_path,
      driveName: source.drive_name,
      filePath: source.file_path,
      resolvedSiteId: source.resolved_site_id,
      resolvedDriveId: source.resolved_drive_id,
      resolvedItemId: source.resolved_item_id,
    });
    const item = located.item;
    const filePatch = {
      file_name: item.name,
      file_web_url: item.webUrl,
      file_etag: item.eTag,
      file_ctag: item.cTag,
      file_last_modified: item.lastModified,
      file_size: item.size,
      resolved: { site_id: located.siteId, drive_id: located.driveId, item_id: item.id },
    };
    await log("localizando", `Arquivo encontrado: ${item.name} (alterado em ${item.lastModified ?? "data desconhecida"}).`, filePatch);

    // 2. sem alteração desde a última sincronização bem-sucedida → nada a fazer
    if (!force && item.eTag && source.last_etag && item.eTag === source.last_etag
        && ["concluida", "concluida_com_avisos", "sem_alteracao"].includes(source.last_status ?? "")) {
      throw new SyncStop("sem_alteracao", null, "A planilha não mudou desde a última sincronização.");
    }

    // 3. baixar e conferir a assinatura
    await log("baixando", "Baixando o arquivo.");
    const buffer = await deps.graph.download(located.driveId, item.id, deps.maxBytes ?? 40 * 1_048_576);
    const hash = createHash("sha256").update(Buffer.from(buffer)).digest("hex");
    await log("baixando", `Arquivo baixado (${buffer.byteLength.toLocaleString("pt-BR")} bytes).`, { file_hash: hash, file_size: buffer.byteLength });
    if (!force && source.last_file_hash === hash && ["concluida", "concluida_com_avisos", "sem_alteracao"].includes(source.last_status ?? "")) {
      throw new SyncStop("sem_alteracao", null, "O conteúdo da planilha é o mesmo da última sincronização.");
    }

    // 4. ler com o mesmo leitor da importação manual e validar a estrutura
    await log("lendo", "Lendo a planilha.");
    const parse = deps.parse ?? defaultParse;
    const parsed = await parse(buffer, { fileName: item.name || "Base Geral Pneus Rodorpar.xlsx", fileSize: buffer.byteLength, fileHash: hash });
    if (!parsed.ok) throw new SyncStop("bloqueada", "estrutura_invalida", parsed.error, { structure: { error: parsed.error } });
    const { meta, rows, missingRequired } = parsed.data;
    const structure = {
      sheet_name: meta.sheet_name,
      header_row: meta.header_row,
      layout_version: meta.layout_version,
      recognized_columns: meta.recognized_columns,
      unrecognized_columns: meta.unrecognized_columns,
      ignored_columns: meta.ignored_columns,
      missing_columns: missingRequired,
      rows: rows.length,
    };
    if (missingRequired.length) {
      throw new SyncStop("bloqueada", "estrutura_invalida",
        `A estrutura da planilha mudou: colunas oficiais ausentes (${missingRequired.join(", ")}). Nada foi aplicado.`, { structure });
    }
    if (!rows.length) throw new SyncStop("bloqueada", "planilha_vazia", "A planilha não tem linhas de pneus. Nada foi aplicado.", { structure });
    await log("validando_estrutura",
      `Estrutura conferida: ${rows.length.toLocaleString("pt-BR")} linhas, ${meta.recognized_columns.length} colunas oficiais` +
        (meta.unrecognized_columns.length ? `, ${meta.unrecognized_columns.length} coluna(s) não reconhecida(s) ignorada(s)` : "") + ".",
      { structure }, meta.unrecognized_columns.length ? "warning" : "info");

    // 5. data de referência = maior data de alteração do arquivo (nunca futura)
    const today = start.today ?? new Date().toISOString().slice(0, 10);
    const suggested = meta.suggested_reference_date && meta.suggested_reference_date <= today ? meta.suggested_reference_date : today;
    const latest = start.latest_reference_date ?? null;
    if (latest && suggested < latest) {
      throw new SyncStop("bloqueada", "referencia_desatualizada",
        `A planilha é de ${ptDate(suggested)}, anterior aos dados vigentes (${ptDate(latest)}). Nada foi aplicado.`, { reference_date: suggested });
    }
    const sameDay = Boolean(latest && suggested === latest);

    // 6. abrir o lote (o banco recusa arquivo já aplicado e data inválida)
    const started = await rpc("tire_import_start", {
      ...org,
      p_payload: { ...meta, reference_date: suggested, source_kind: "sharepoint", sync_run_id: runId, replace_same_day: sameDay },
    });
    if (started.error) {
      if (started.error.hint === "tire_duplicate_file") {
        throw new SyncStop("sem_alteracao", null, started.error.message ?? "Esta versão da planilha já está aplicada.");
      }
      throw new SyncStop("falhou", started.error.hint ?? "lote_nao_aberto", started.error.message ?? "Não foi possível abrir o lote.");
    }
    const batch = started.data as { batch_id: string; same_day_revision?: boolean };
    await log("enviando", sameDay
      ? `Revisão do dia ${ptDate(suggested)}: a versão anterior fica arquivada.`
      : `Lote aberto para os dados de ${ptDate(suggested)}.`, { batch_id: batch.batch_id, reference_date: suggested, same_day_revision: sameDay });

    // 7. enviar as linhas em partes (repetir a mesma parte não duplica)
    const sendRows = async (part: RodoparRow[]): Promise<void> => {
      const r = await rpc("tire_import_stage", { ...org, p_batch_id: batch.batch_id, p_rows: part });
      if (r.error) {
        if (r.error.code === "57014" && part.length > 50) {
          const mid = Math.ceil(part.length / 2);
          await sendRows(part.slice(0, mid));
          await sendRows(part.slice(mid));
          return;
        }
        throw new SyncStop("falhou", "envio_falhou", r.error.message ?? "Falha ao enviar as linhas.");
      }
    };
    for (let i = 0; i < rows.length; i += RODOPAR_CHUNK_ROWS) await sendRows(rows.slice(i, i + RODOPAR_CHUNK_ROWS));

    // 8. validar e comparar (no banco)
    await log("validando", "Validando, enriquecendo e comparando com os dados anteriores.");
    const validated = await rpc("tire_import_validate", { ...org, p_batch_id: batch.batch_id });
    if (validated.error) throw new SyncStop("falhou", "validacao_falhou", validated.error.message ?? "Falha na validação.");
    const v = validated.data as {
      status: string; block_reason: string | null; total_rows: number; valid_rows: number; warning_rows: number; error_rows: number;
      new_tires: number; updated_tires: number; unchanged_tires: number; absent_tires: number; reappeared_tires: number;
    };
    const counters = {
      rows: v.total_rows, valid: v.valid_rows, warnings: v.warning_rows, errors: v.error_rows, new: v.new_tires,
      updated: v.updated_tires, unchanged: v.unchanged_tires, absent: v.absent_tires, reappeared: v.reappeared_tires,
    };
    if (v.status !== "validated") {
      throw new SyncStop("bloqueada", "lote_bloqueado", `Lote bloqueado: ${v.block_reason ?? "há inconsistências bloqueantes."}`, { counters });
    }

    // 9. confirmar (uma transação: cadastro, dados do dia, eventos, ausentes, conciliação, auditoria)
    await log("confirmando", "Aplicando os dados.", { counters });
    const confirmed = await rpc("tire_import_confirm", { ...org, p_batch_id: batch.batch_id });
    if (confirmed.error) {
      throw new SyncStop("falhou", confirmed.error.hint ?? "confirmacao_falhou", confirmed.error.message ?? "Falha ao aplicar os dados.", { counters });
    }
    const c = confirmed.data as { snapshots: number; new_tires: number; events: number; absent: number; removed_in_revision?: number };
    const finalCounters = { ...counters, snapshots: c.snapshots, events: c.events, absent: c.absent, removed_in_revision: c.removed_in_revision ?? 0 };
    const status: SyncFinalStatus = v.warning_rows > 0 ? "concluida_com_avisos" : "concluida";
    const message = `${sameDay ? "Dados do dia revisados" : "Dados aplicados"}: ${ptDate(suggested)} — ${c.snapshots} pneus, ${v.new_tires} novos, ${v.updated_tires} alterados, ${c.absent} ausentes` +
      (v.warning_rows ? `, ${v.warning_rows} com aviso de qualidade.` : ".");
    const fin = await rpc("tire_sync_finish", { ...org, p_run_id: runId, p_status: status, p_error_code: null, p_error_message: message, p_patch: { counters: finalCounters } });
    if (fin.error) throw new SyncStop("falhou", "registro_falhou", fin.error.message ?? "Falha ao encerrar a sincronização.");
    outcome = { status, runId, message, batchId: batch.batch_id, referenceDate: suggested, sameDayRevision: sameDay, counters: finalCounters };
    return outcome;
  } catch (error) {
    const stop =
      error instanceof SyncStop
        ? error
        : error instanceof GraphError
          ? new SyncStop("falhou", error.code, error.message)
          : new SyncStop("falhou", "erro_inesperado", error instanceof Error ? error.message.slice(0, 500) : "Erro inesperado na sincronização.");
    const fin = await rpc("tire_sync_finish", {
      ...org, p_run_id: runId, p_status: stop.status, p_error_code: stop.code, p_error_message: stop.message, p_patch: stop.patch,
    });
    return {
      status: stop.status,
      runId,
      message: fin.error ? `${stop.message} (o encerramento também falhou: ${fin.error.message ?? "erro"})` : stop.message,
      errorCode: stop.code,
    };
  }
}
