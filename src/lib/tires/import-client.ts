import { withRetry, type StepResult } from "@/lib/import/client";
import { stageTireImport, startTireImport, validateTireImport } from "./actions";
import { RODOPAR_CHUNK_ROWS, readRodoparWorkbook, type RodoparMeta, type RodoparRead, type RodoparRow } from "./rodopar-sheet";
import type { TireImportBatch } from "./types";

/**
 * Importação oficial Rodopar 10 vista da tela:
 *
 *   LER (navegador) → enviar em partes (staging) → VALIDAR/COMPARAR (banco)
 *   → PRÉVIA (paginada, no banco) → CONFIRMAR (uma transação) → fotografia
 *
 * Este módulo só lê o arquivo, fatia, repete e informa o andamento. Nada é
 * gravado no cadastro de pneus antes da confirmação: o envio vai para a
 * área de preparação do lote, e toda regra (Nº Fogo como texto, status
 * canônico, sulco mínimo, PSI, enriquecimento, mudanças, ausentes) é do
 * banco.
 */
export type TireImportStage = "reading" | "sending" | "validating";
export interface TireImportProgress {
  stage: TireImportStage;
  done: number;
  total: number;
}
export type TireImportProgressHandler = (progress: TireImportProgress | null) => void;

export const TIRE_IMPORT_STAGE_LABEL: Record<TireImportStage, string> = {
  reading: "Lendo o arquivo",
  sending: "Enviando as linhas",
  validating: "Validando e comparando com a fotografia anterior",
};

const readCache = new WeakMap<File, Promise<{ ok: true; data: RodoparRead } | { ok: false; error: string }>>();

async function sha256Hex(buffer: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

async function read(file: File): Promise<{ ok: true; data: RodoparRead } | { ok: false; error: string }> {
  if (file.size === 0) return { ok: false, error: "O arquivo está vazio." };
  if (!/\.xlsx$/i.test(file.name)) return { ok: false, error: "Formato não suportado. Envie o relatório Rodopar 10 em XLSX." };
  let buffer: ArrayBuffer;
  try {
    buffer = await file.arrayBuffer();
  } catch {
    return { ok: false, error: "Não foi possível ler o arquivo." };
  }
  try {
    const ExcelJS = (await import("exceljs")).default;
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);
    return readRodoparWorkbook(workbook, { fileName: file.name, fileSize: file.size, fileHash: await sha256Hex(buffer) });
  } catch {
    return { ok: false, error: "Não foi possível ler o arquivo. Verifique se é um XLSX válido exportado do Rodopar." };
  }
}

/** Lê o arquivo uma vez só: a escolha (que sugere a data) e o envio usam a mesma leitura. */
export function readRodoparFile(file: File) {
  let pending = readCache.get(file);
  if (!pending) {
    pending = read(file);
    readCache.set(file, pending);
  }
  return pending;
}

export type TireUploadResult =
  | { ok: true; meta: RodoparMeta; batch: TireImportBatch }
  | { ok: false; error: string; stage: TireImportStage; code?: string | null; batchId?: string | null };

async function sendRows(batchId: string, rows: RodoparRow[]): Promise<StepResult<{ staged: number }>> {
  const r = await withRetry(() => stageTireImport(batchId, rows));
  if (!r.ok && r.retry && rows.length > 50) {
    const mid = Math.ceil(rows.length / 2);
    const first = await sendRows(batchId, rows.slice(0, mid));
    if (!first.ok) return first;
    return sendRows(batchId, rows.slice(mid));
  }
  return r;
}

export async function uploadRodoparImport(
  file: File | null,
  referenceDate: string,
  onProgress?: TireImportProgressHandler,
): Promise<TireUploadResult> {
  if (!file) return { ok: false, error: "Selecione o relatório Rodopar 10 (XLSX).", stage: "reading" };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(referenceDate)) return { ok: false, error: "Informe a data de referência da fotografia.", stage: "reading" };
  let batchId: string | null = null;
  try {
    onProgress?.({ stage: "reading", done: 0, total: 0 });
    const parsed = await readRodoparFile(file);
    if (!parsed.ok) return { ok: false, error: parsed.error, stage: "reading" };
    const { meta, rows, missingRequired } = parsed.data;
    if (missingRequired.length) {
      return { ok: false, error: `Colunas obrigatórias ausentes: ${missingRequired.join(", ")}.`, stage: "reading" };
    }
    if (!rows.length) return { ok: false, error: "O relatório não possui linhas de pneus.", stage: "reading" };

    // abrir o lote não é repetido: um erro aqui é resposta (arquivo já importado, data inválida…)
    const started = await startTireImport({ meta, referenceDate });
    if (!started.ok || !started.data) {
      return { ok: false, error: started.error ?? "Não foi possível abrir o lote.", stage: "sending", code: started.code ?? null };
    }
    batchId = started.data.batchId;
    const total = rows.length;
    for (let i = 0; i < total; i += RODOPAR_CHUNK_ROWS) {
      onProgress?.({ stage: "sending", done: i, total });
      const sent = await sendRows(batchId, rows.slice(i, i + RODOPAR_CHUNK_ROWS));
      if (!sent.ok) return { ok: false, error: sent.error ?? "Não foi possível enviar as linhas.", stage: "sending", batchId };
    }
    onProgress?.({ stage: "validating", done: total, total });
    const id = batchId;
    const validated = await withRetry(() => validateTireImport(id));
    if (!validated.ok || !validated.data) {
      return { ok: false, error: validated.error ?? "Não foi possível validar o arquivo.", stage: "validating", batchId };
    }
    return { ok: true, meta, batch: validated.data };
  } finally {
    onProgress?.(null);
  }
}
