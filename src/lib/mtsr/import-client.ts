import { runInSteps, withRetry, type StepResult } from "@/lib/import/client";
import { finalizeMtsrImport, processMtsrChunk, stageMtsrChunk, validateMtsrImport, type MtsrImportOutcome, type MtsrImportPreview } from "./import-actions";
import { chunkRows, readMtsrImportFile, type MtsrSheetComponentSpec, type MtsrSheetRead, type MtsrSheetRow } from "./import-sheet";

/**
 * Importação de conformidade MTSR vista da tela: upload → leitura (navegador)
 * → staging em blocos → validação → prévia → confirmação → ingestão em
 * blocos. Este módulo só lê, fatia, repete e informa o andamento; toda regra
 * é das rotinas do banco.
 */
export type MtsrImportStage = "reading" | "sending" | "validating" | "finalizing" | "saving";
export interface MtsrImportProgress {
  stage: MtsrImportStage;
  done: number;
  total: number;
}
export type MtsrImportProgressHandler = (progress: MtsrImportProgress | null) => void;
export type MtsrSheetInfo = Omit<MtsrSheetRead, "rows"> & { rowsRead: number };

export type MtsrUploadResult =
  | { ok: true; sheet: MtsrSheetInfo; preview: MtsrImportPreview }
  | { ok: false; error: string; stage: MtsrImportStage; sheetNames?: string[]; batchId?: string | null };

const LOAD_MIN_ROWS = 50;

async function sendChunk(rows: MtsrSheetRow[], batchId: string | null, sheet: MtsrSheetRead, referenceDefault: string | null): Promise<StepResult<{ batchId: string; loaded: number }>> {
  const columnMapping = Object.fromEntries(sheet.columns.map((c) => [c.header, c.field]));
  const result = await withRetry(() =>
    stageMtsrChunk({ batchId, file: { name: sheet.fileName, size: sheet.fileSize, hash: sheet.fileHash }, columnMapping, referenceDefault, rows }),
  );
  if (!result.ok && result.retry && rows.length > LOAD_MIN_ROWS) {
    const mid = Math.ceil(rows.length / 2);
    const first = await sendChunk(rows.slice(0, mid), batchId, sheet, referenceDefault);
    if (!first.ok || !first.data) return first;
    return sendChunk(rows.slice(mid), first.data.batchId, sheet, referenceDefault);
  }
  return result;
}

export async function uploadMtsrImport(
  file: File | null,
  components: MtsrSheetComponentSpec[],
  options: { referenceDefault?: string | null } = {},
  onProgress?: MtsrImportProgressHandler,
): Promise<MtsrUploadResult> {
  if (!file) return { ok: false, error: "Selecione a planilha de conformidade (modelo MTSR).", stage: "reading" };
  let batchId: string | null = null;
  try {
    onProgress?.({ stage: "reading", done: 0, total: 0 });
    const read = await readMtsrImportFile(file, components);
    if (!read.ok) return { ok: false, error: read.error, stage: "reading", sheetNames: read.sheetNames };
    const sheet = read.data;
    const total = sheet.rows.length;
    let sent = 0;
    for (const chunk of chunkRows(sheet.rows)) {
      onProgress?.({ stage: "sending", done: sent, total });
      const loaded = await sendChunk(chunk, batchId, sheet, options.referenceDefault ?? null);
      if (!loaded.ok || !loaded.data?.batchId) return { ok: false, error: loaded.error ?? "Não foi possível enviar a planilha.", stage: "sending", batchId };
      batchId = loaded.data.batchId;
      sent += chunk.length;
    }
    if (!batchId) return { ok: false, error: "A planilha não possui linhas de dados.", stage: "sending" };
    const id = batchId;
    onProgress?.({ stage: "validating", done: 0, total });
    const validated = await runInSteps({
      step: (limit) => validateMtsrImport(id, limit),
      remaining: (d) => d.pending,
      onStep: (d) => onProgress?.({ stage: "validating", done: Math.max(0, total - d.pending), total }),
      initialLimit: 500,
      maxLimit: 2000,
    });
    if (!validated.ok) return { ok: false, error: validated.error ?? "Não foi possível validar a planilha.", stage: "validating", batchId };
    onProgress?.({ stage: "finalizing", done: total, total });
    const preview = await withRetry(() => finalizeMtsrImport(id));
    if (!preview.ok || !preview.data) return { ok: false, error: preview.error ?? "Não foi possível montar a prévia.", stage: "finalizing", batchId };
    const { rows, ...info } = sheet;
    return { ok: true, sheet: { ...info, rowsRead: rows.length }, preview: preview.data };
  } finally {
    onProgress?.(null);
  }
}

export async function confirmMtsrImport(batchId: string, expectedRows: number, onProgress?: MtsrImportProgressHandler): Promise<StepResult<MtsrImportOutcome>> {
  let total = Math.max(0, expectedRows);
  try {
    onProgress?.({ stage: "saving", done: 0, total });
    const result = await runInSteps({
      step: (limit) => processMtsrChunk(batchId, limit),
      remaining: (d) => (d.done ? 0 : Math.max(1, d.remaining)),
      onStep: (d) => {
        total = Math.max(total, d.remaining);
        onProgress?.({ stage: "saving", done: d.done ? total : Math.max(0, total - d.remaining), total });
      },
      initialLimit: 200,
      maxLimit: 500,
    });
    if (!result.ok || !result.data) return { ok: false, error: result.error ?? "Não foi possível concluir a importação." };
    return result.data.outcome ? { ok: true, data: result.data.outcome } : { ok: false, error: "A importação terminou sem resumo." };
  } finally {
    onProgress?.(null);
  }
}
