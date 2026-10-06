import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { test, expect } from "@playwright/test";
import { runTireSync, type SyncOutcome } from "../../src/lib/tires/sync/engine";
import { createGraphClient, GraphError, type GraphFileSource, type SourceLocation } from "../../src/lib/tires/sync/graph";
import { buildRodoparXlsx, type Cells } from "./rodopar-workbook";
import { cloneDatabase, dropDatabase, jsonOf, pgRpc, psql } from "./pg";

/**
 * Sincronização da fonte oficial dos pneus — integração ponta a ponta contra
 * uma CÓPIA do banco local de teste (`hfm_imp` → `hfm_sync_it`) e uma Graph
 * simulada. Cobre: credenciais ausentes, falha de conexão, planilha
 * indisponível, sucesso, sem alteração (eTag), revisão do mesmo dia (versão
 * anterior arquivada), mudança de estrutura, planilha desatualizada,
 * reprocessamento controlado, trava contra execução simultânea e o cliente
 * HTTP da Graph (token, site, biblioteca, arquivo, download e erros).
 */
const TEMPLATE = process.env.HFM_TEST_PG_TEMPLATE ?? "hfm_imp";
const DB = "hfm_sync_it";
const ORG = "e0f2623f-8a1b-4f50-b24e-4b32845fdfb4";
const ADMIN = { sub: "22ed0fad-19f3-4ad5-8285-2a423543c653", role: "authenticated" };
const SERVICE = { role: "service_role" };

/** Graph simulada: um arquivo com eTag, ou uma falha programada. */
class FakeGraph implements GraphFileSource {
  calls: string[] = [];
  constructor(public file: { buffer: ArrayBuffer; eTag: string; modified: string } | null, public failure: GraphError | null = null) {}
  async locate(source: SourceLocation) {
    expect(source.filePath).toMatch(/\.xlsx$/i);
    this.calls.push("locate");
    if (this.failure) throw this.failure;
    if (!this.file) throw new GraphError("graph_nao_encontrado", "Site, biblioteca ou arquivo não encontrado no SharePoint.", 404);
    return {
      siteId: "site-1",
      driveId: "drive-1",
      item: { id: "item-1", name: "Base Geral Pneus Rodorpar.xlsx", eTag: this.file.eTag, cTag: null, size: this.file.buffer.byteLength, lastModified: this.file.modified, webUrl: null },
    };
  }
  async download() {
    this.calls.push("download");
    if (!this.file) throw new GraphError("graph_nao_encontrado", "Arquivo não encontrado.", 404);
    return this.file.buffer;
  }
}

let baseRows: Cells[] = [];
const count = (sql: string) => Number(psql(DB, sql));
const lastRun = () =>
  jsonOf<{ status: string; error_code: string | null; trigger: string; reprocess_of: string | null; batch_id: string | null; same_day_revision: boolean }>(
    DB,
    "select to_jsonb(r) - 'log' from public.tire_sync_runs r order by started_at desc limit 1;",
  );
const sync = (graph: GraphFileSource | null, trigger: "manual" | "agendada" | "reprocessamento" = "manual", reprocessOf: string | null = null, claims = ADMIN) =>
  runTireSync({ rpc: pgRpc(DB, claims), organizationId: ORG, graph }, trigger, reprocessOf);

/** Linhas do arquivo a partir dos dados confirmados de 05/10, com a "data da última alteração" escolhida. */
function rowsAt(updatedAt: string, mutate?: (rows: Cells[]) => Cells[]): Cells[] {
  const rows = baseRows.map((r, i) => ({ ...r, updated_at: i === 0 ? updatedAt : (r.updated_at as string | null) }));
  return mutate ? mutate(rows) : rows;
}

test.describe.serial("sincronização com a fonte oficial (SharePoint)", () => {
  test.beforeAll(() => {
    cloneDatabase(TEMPLATE, DB);
    baseRows = jsonOf<Cells[]>(
      DB,
      `select coalesce(jsonb_agg(s.cells order by s.row_number), '[]') from public.tire_import_staging s
        where s.batch_id = (select id from public.tire_import_batches where status = 'confirmed' order by reference_date desc limit 1);`,
    );
    expect(baseRows.length).toBeGreaterThan(100);
  });

  test.afterAll(() => dropDatabase(DB));

  test("credenciais ausentes: falha registrada com motivo, nada aplicado", async () => {
    const before = count("select count(*) from public.tire_import_batches");
    const r = await sync(null);
    expect(r.status).toBe("falhou");
    expect(r.errorCode).toBe("credenciais_ausentes");
    expect(lastRun().status).toBe("falhou");
    expect(count("select count(*) from public.tire_import_batches")).toBe(before);
    expect(count("select consecutive_failures from public.tire_sync_sources")).toBe(1);
  });

  test("falha de conexão e planilha indisponível viram falhas rastreáveis", async () => {
    const down = await sync(new FakeGraph(null, new GraphError("graph_indisponivel", "Não foi possível conectar à Microsoft Graph (SharePoint).")));
    expect(down.status).toBe("falhou");
    expect(down.errorCode).toBe("graph_indisponivel");
    const missing = await sync(new FakeGraph(null));
    expect(missing.status).toBe("falhou");
    expect(missing.errorCode).toBe("graph_nao_encontrado");
    expect(count("select count(*) from public.tire_audit_events where action = 'sync.falhou'")).toBe(3);
    expect(count("select count(*) from public.outbox_events where event_type = 'tires.sync.failed'")).toBeGreaterThanOrEqual(3);
  });

  let first: SyncOutcome;
  test("sucesso: planilha nova vira os dados de 06/10, pelo pipeline oficial", async () => {
    const buffer = await buildRodoparXlsx(rowsAt("2026-10-06T09:15:00"));
    first = await sync(new FakeGraph({ buffer, eTag: '"{E1},1"', modified: "2026-10-06T12:15:00Z" }));
    expect(first.status, first.message).toMatch(/^concluida/);
    expect(first.referenceDate).toBe("2026-10-06");
    expect(first.sameDayRevision).toBe(false);
    const batch = jsonOf<{ status: string; source_kind: string; sync_run_id: string; total_rows: number }>(
      DB, `select to_jsonb(b) from public.tire_import_batches b where id = '${first.batchId}';`);
    expect(batch.status).toBe("confirmed");
    expect(batch.source_kind).toBe("sharepoint");
    expect(batch.sync_run_id).toBe(first.runId);
    expect(batch.total_rows).toBe(baseRows.length);
    expect(count("select count(*) from public.tire_daily_snapshots where reference_date = '2026-10-06'")).toBe(baseRows.length);
    // trilha: sincronização e confirmação; varredura da auditoria disparada pela confirmação
    expect(count("select count(*) from public.tire_audit_scans where trigger = 'confirmacao'")).toBe(1);
    const src = jsonOf<{ last_status: string; last_etag: string; consecutive_failures: number; resolved_item_id: string }>(
      DB, "select to_jsonb(s) from public.tire_sync_sources s;");
    expect(src.last_etag).toBe('"{E1},1"');
    expect(src.consecutive_failures).toBe(0);
    expect(src.resolved_item_id).toBe("item-1");
  });

  test("agendada respeita o intervalo mínimo; sem alteração (eTag) não baixa nem cria lote", async () => {
    const graph = new FakeGraph({ buffer: await buildRodoparXlsx(rowsAt("2026-10-06T09:15:00")), eTag: '"{E1},1"', modified: "2026-10-06T12:15:00Z" });
    const before = count("select count(*) from public.tire_import_batches");
    // acabou de rodar: a agendada aguarda o intervalo mínimo (nenhuma execução registrada)
    const runsBefore = count("select count(*) from public.tire_sync_runs");
    const early = await sync(graph, "agendada", null, SERVICE);
    expect(early.status).toBe("ignorada");
    expect(count("select count(*) from public.tire_sync_runs")).toBe(runsBefore);
    expect(graph.calls).toEqual([]);
    psql(DB, "update public.tire_sync_sources set last_attempt_at = now() - interval '2 hours';"); // só no banco de teste
    const r = await sync(graph, "agendada", null, SERVICE);
    expect(r.status).toBe("sem_alteracao");
    expect(graph.calls).toEqual(["locate"]);
    expect(count("select count(*) from public.tire_import_batches")).toBe(before);
    const run = lastRun();
    expect(run.trigger).toBe("agendada");
  });

  test("mesmo dia, planilha alterada: revisão do dia com a versão anterior arquivada", async () => {
    const removed = String(baseRows[1].fire_number);
    const changed = baseRows.findIndex((r, i) => i > 1 && r.status_raw && /uso/i.test(String(r.status_raw)) && typeof r.psi === "number");
    const changedFire = String(baseRows[changed].fire_number);
    const rows = rowsAt("2026-10-06T16:40:00", (all) =>
      all.filter((r) => String(r.fire_number) !== removed).map((r) => (String(r.fire_number) === changedFire ? { ...r, psi: (r.psi as number) + 3 } : r)),
    );
    const r = await sync(new FakeGraph({ buffer: await buildRodoparXlsx(rows), eTag: '"{E1},2"', modified: "2026-10-06T19:40:00Z" }));
    expect(r.status, r.message).toMatch(/^concluida/);
    expect(r.sameDayRevision).toBe(true);
    expect(count(`select count(*) from public.tire_import_batches where id = '${first.batchId}' and status = 'superseded'`)).toBe(1);
    expect(count("select count(*) from public.tire_import_batches where status = 'confirmed' and reference_date = '2026-10-06'")).toBe(1);
    // nada foi apagado: a versão anterior de cada linha está no arquivo de revisões
    expect(count("select count(*) from public.tire_snapshot_revisions where reference_date = '2026-10-06'")).toBe(baseRows.length);
    expect(count("select count(*) from public.tire_snapshot_revisions where reason = 'removed'")).toBe(1);
    expect(count("select count(*) from public.tire_daily_snapshots where reference_date = '2026-10-06'")).toBe(baseRows.length);
    expect(count(`select count(*) from public.tires where fire_number = '${removed}' and presence_status = 'absent'`)).toBe(1);
    const psi = jsonOf<{ psi: number; revision: number }>(DB,
      `select jsonb_build_object('psi', s.psi, 'revision', s.revision) from public.tire_daily_snapshots s join public.tires t on t.id = s.tire_id
        where t.fire_number = '${changedFire}' and s.reference_date = '2026-10-06';`);
    expect(psi.revision).toBe(2);
    expect(Number(psi.psi)).toBe(Number(baseRows[changed].psi) + 3);
    // datas anteriores intactas
    expect(count("select count(*) from public.tire_daily_snapshots where reference_date = '2026-10-05' and revision <> 1")).toBe(0);
  });

  test("estrutura alterada: coluna oficial ausente bloqueia e nada é aplicado", async () => {
    const before = count("select count(*) from public.tire_import_batches");
    const buffer = await buildRodoparXlsx(rowsAt("2026-10-06T18:00:00"), { drop: ["psi"], extraColumn: "Pressão (lbs)" });
    const r = await sync(new FakeGraph({ buffer, eTag: '"{E1},3"', modified: "2026-10-06T21:00:00Z" }));
    expect(r.status).toBe("bloqueada");
    expect(r.errorCode).toBe("estrutura_invalida");
    expect(r.message).toMatch(/psi/);
    expect(count("select count(*) from public.tire_import_batches")).toBe(before);
    const structure = jsonOf<{ missing_columns: string[]; unrecognized_columns: string[] }>(DB,
      "select structure from public.tire_sync_runs order by started_at desc limit 1;");
    expect(structure.missing_columns).toContain("psi");
  });

  test("planilha mais antiga que os dados vigentes é recusada", async () => {
    const old = baseRows.map((r) => ({ ...r, updated_at: "2026-10-02T10:00:00" }));
    const r = await sync(new FakeGraph({ buffer: await buildRodoparXlsx(old), eTag: '"{E0},9"', modified: "2026-10-02T13:00:00Z" }));
    expect(r.status).toBe("bloqueada");
    expect(r.errorCode).toBe("referencia_desatualizada");
  });

  test("reprocessamento controlado: registrado como tal; versão já aplicada não duplica", async () => {
    const blockedRun = psql(DB, "select id from public.tire_sync_runs where status = 'bloqueada' order by started_at limit 1;");
    const rows = jsonOf<Cells[]>(DB, `select coalesce(jsonb_agg(s.cells order by s.row_number), '[]') from public.tire_import_staging s
       where s.batch_id = (select id from public.tire_import_batches where status = 'confirmed' and reference_date = '2026-10-06');`);
    // a mesma planilha da revisão aplicada (mesmo conteúdo → mesmo hash)
    const graph = new FakeGraph({ buffer: await buildRodoparXlsx(rows), eTag: '"{E1},2"', modified: "2026-10-06T19:40:00Z" });
    const r = await sync(graph, "reprocessamento", blockedRun);
    expect(["sem_alteracao", "concluida", "concluida_com_avisos"]).toContain(r.status);
    expect(graph.calls).toContain("download"); // reprocessar sempre baixa de novo
    const run = lastRun();
    expect(run.trigger).toBe("reprocessamento");
    expect(run.reprocess_of).toBe(blockedRun);
  });

  test("execução simultânea: a segunda espera a primeira (trava no banco)", async () => {
    const rpc = pgRpc(DB, ADMIN);
    const open = await rpc("tire_sync_begin", { p_organization_id: ORG, p_trigger: "manual", p_reprocess_of: null });
    expect(open.error).toBeNull();
    const r = await sync(new FakeGraph(null));
    expect(r.status).toBe("em_andamento");
    const runId = (open.data as { run_id: string }).run_id;
    const fin = await rpc("tire_sync_finish", { p_organization_id: ORG, p_run_id: runId, p_status: "falhou", p_error_code: "teste", p_error_message: "Encerrada pelo teste.", p_patch: {} });
    expect(fin.error).toBeNull();
  });

  test("agendada só pelo servidor; pessoa sem permissão não sincroniza", async () => {
    const asUser = await pgRpc(DB, ADMIN)("tire_sync_begin", { p_organization_id: ORG, p_trigger: "agendada", p_reprocess_of: null });
    expect(asUser.error?.code).toBe("42501");
    const stranger = await pgRpc(DB, { sub: "00000000-0000-4000-8000-00000000dead", role: "authenticated" })("tire_sync_begin", {
      p_organization_id: ORG, p_trigger: "manual", p_reprocess_of: null,
    });
    expect(stranger.error?.code).toBe("42501");
  });
});

test.describe("cliente da Microsoft Graph (servidor HTTP simulado)", () => {
  let server: Server;
  let base = "";
  const hits: string[] = [];
  let mode: "ok" | "401" | "403" | "slow" = "ok";

  test.beforeAll(async () => {
    const file = Buffer.from("conteudo-xlsx-simulado");
    server = createServer((req, res) => {
      const url = req.url ?? "";
      hits.push(`${req.method} ${url.split("?")[0]}`);
      const json = (status: number, body: unknown) => {
        res.writeHead(status, { "content-type": "application/json" });
        res.end(JSON.stringify(body));
      };
      if (url.startsWith("/login/tenant-x/oauth2/v2.0/token")) return mode === "401" ? json(401, { error: "invalid_client" }) : json(200, { access_token: "tok", expires_in: 3600 });
      if (req.headers.authorization !== "Bearer tok") return json(401, {});
      if (mode === "403") return json(403, {});
      if (mode === "slow") return; // nunca responde → tempo limite
      if (url.startsWith("/graph/sites/grupohorizonte.sharepoint.com:/sites/HorizonteFleetManagement")) return json(200, { id: "site-9" });
      if (url.startsWith("/graph/sites/site-9/drives")) return json(200, { value: [{ id: "drv-1", name: "Shared Documents" }] });
      if (url.startsWith("/graph/drives/drv-1/root:/Gest%C3%A3o%20de%20Pneus/Base%20Geral%20Pneus%20Rodorpar.xlsx")) {
        return json(200, { id: "itm-1", name: "Base Geral Pneus Rodorpar.xlsx", eTag: '"{X},7"', size: file.length, lastModifiedDateTime: "2026-10-06T10:00:00Z" });
      }
      if (url.startsWith("/graph/drives/drv-1/items/itm-1/content")) {
        res.writeHead(200, { "content-type": "application/octet-stream", "content-length": String(file.length) });
        return res.end(file);
      }
      json(404, {});
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  test.afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

  const client = (timeoutMs = 3000) =>
    createGraphClient({ tenantId: "tenant-x", clientId: "c", clientSecret: "s", graphBase: `${base}/graph`, loginBase: `${base}/login`, timeoutMs });
  const source: SourceLocation = {
    siteHostname: "grupohorizonte.sharepoint.com",
    sitePath: "/sites/HorizonteFleetManagement",
    driveName: "Documentos Compartilhados",
    filePath: "Gestão de Pneus/Base Geral Pneus Rodorpar.xlsx",
  };

  test("localiza site → biblioteca padrão → arquivo pelo caminho e baixa", async () => {
    mode = "ok";
    const g = client();
    const loc = await g.locate(source);
    expect(loc).toMatchObject({ siteId: "site-9", driveId: "drv-1", item: { id: "itm-1", eTag: '"{X},7"' } });
    const buf = await g.download(loc.driveId, loc.item.id, 1024);
    expect(Buffer.from(buf).toString()).toBe("conteudo-xlsx-simulado");
    await expect(g.download(loc.driveId, loc.item.id, 5)).rejects.toMatchObject({ code: "arquivo_grande_demais" });
  });

  test("credenciais recusadas, sem permissão e tempo esgotado viram códigos estáveis", async () => {
    mode = "401";
    await expect(client().locate(source)).rejects.toMatchObject({ code: "graph_autenticacao" });
    mode = "403";
    await expect(client().locate(source)).rejects.toMatchObject({ code: "graph_sem_permissao" });
    mode = "slow";
    await expect(client(400).locate(source)).rejects.toMatchObject({ code: "graph_tempo_esgotado" });
    mode = "ok";
  });
});
