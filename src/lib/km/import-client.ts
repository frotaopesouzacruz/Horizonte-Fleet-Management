import { runInSteps, withRetry, type StepResult } from "@/lib/import/client";
import {
  cancelKmImport, finalizeKmImport, processKmChunk, stageKmChunk, validateKmImport,
  type KmImportOutcome, type KmImportPreview,
} from "./import-actions";
import { chunkKmRows, readKmImportFile, type KmSheetRead, type KmSheetRow } from "./import-sheet";

/**
 * Importação de KM vista da tela: upload → leitura (navegador) → staging em
 * blocos → validação → comparação/prévia → confirmação → consolidação em
 * blocos. Este módulo só lê, fatia, repete e informa o andamento; toda regra
 * é das rotinas do banco. Segue o padrão de `runStagedImport` /
 * `runChunkedProcess` (mesmas repetições e mesmo ajuste de bloco), com a
 * leitura da aba nomeada e as etapas próprias do KM.
 */

export type KmImportStage = "reading" | "sending" | "validating" | "finalizing" | "saving";

export interface KmImportProgress {
  stage: KmImportStage;
  done: number;
  total: number;
}

export type KmImportProgressHandler = (progress: KmImportProgress | null) => void;

/** O que a tela guarda da leitura (sem as linhas, que já foram ao banco). */
export type KmSheetInfo = Omit<KmSheetRead, "rows"> & { rowsRead: number };

export interface KmUploadFailure {
  ok: false;
  error: string;
  stage: KmImportStage;
  /** Abas encontradas quando a aba oficial não existe. */
  sheetNames?: string[];
  /** Lote que ficou aberto (em rascunho) para retomar ou cancelar em Lotes. */
  batchId?: string | null;
}

export type KmUploadResult = { ok: true; sheet: KmSheetInfo; preview: KmImportPreview } | KmUploadFailure;

const LOAD_MIN_ROWS = 125;

/** Um bloco no staging; se o banco estourar o tempo, o bloco é dividido ao meio. */
async function sendChunk(
  rows: KmSheetRow[],
  batchId: string | null,
  sheet: KmSheetRead,
): Promise<StepResult<{ batchId: string; loaded: number }>> {
  const columnMapping = Object.fromEntries(sheet.columns.map((c) => [c.header, c.field]));
  const result = await withRetry(() =>
    stageKmChunk({
      batchId,
      file: { name: sheet.fileName, size: sheet.fileSize, hash: sheet.fileHash },
      sheetName: sheet.sheetName,
      headerRow: sheet.headerRow,
      columnMapping,
      rows,
    }),
  );
  if (!result.ok && result.retry && rows.length > LOAD_MIN_ROWS) {
    const mid = Math.ceil(rows.length / 2);
    const first = await sendChunk(rows.slice(0, mid), batchId, sheet);
    if (!first.ok || !first.data) return first;
    return sendChunk(rows.slice(mid), first.data.batchId, sheet);
  }
  return result;
}

/** Valida em blocos até não sobrar linha pendente (normalmente uma chamada: o load já avalia). */
async function validateAll(batchId: string, total: number, onProgress?: KmImportProgressHandler) {
  onProgress?.({ stage: "validating", done: 0, total });
  return runInSteps({
    step: (limit) => validateKmImport(batchId, limit),
    remaining: (d) => d.pending,
    onStep: (d) => onProgress?.({ stage: "validating", done: total > 0 ? Math.max(0, total - d.pending) : 0, total }),
    initialLimit: 2000,
    maxLimit: 5000,
  });
}

async function finalize(batchId: string, onProgress?: KmImportProgressHandler) {
  onProgress?.({ stage: "finalizing", done: 0, total: 0 });
  return withRetry(() => finalizeKmImport(batchId));
}

/** Arquivo → prévia. Uma falha antes da prévia descarta o lote aberto (rascunho). */
export async function uploadKmImport(file: File | null, onProgress?: KmImportProgressHandler): Promise<KmUploadResult> {
  if (!file) return { ok: false, error: "Selecione o arquivo Base Geral KM Rodado.xlsx.", stage: "reading" };
  let batchId: string | null = null;
  const abort = async (stage: KmImportStage, error?: string): Promise<KmUploadFailure> => {
    if (batchId) await cancelKmImport(batchId).catch(() => undefined);
    return { ok: false, error: error ?? "Não foi possível concluir a importação.", stage };
  };
  try {
    onProgress?.({ stage: "reading", done: 0, total: 0 });
    const read = await readKmImportFile(file);
    if (!read.ok) return { ok: false, error: read.error, stage: "reading", sheetNames: read.sheetNames };
    const sheet = read.data;
    const total = sheet.rows.length;

    let sent = 0;
    for (const chunk of chunkKmRows(sheet.rows)) {
      onProgress?.({ stage: "sending", done: sent, total });
      const loaded: StepResult<{ batchId: string; loaded: number }> = await sendChunk(chunk, batchId, sheet);
      if (!loaded.ok || !loaded.data?.batchId) return await abort("sending", loaded.error);
      batchId = loaded.data.batchId;
      sent += chunk.length;
    }
    onProgress?.({ stage: "sending", done: total, total });
    if (!batchId) return { ok: false, error: "A aba Controle KM Rodado não possui linhas de dados.", stage: "sending" };

    const validated = await validateAll(batchId, total, onProgress);
    if (!validated.ok) return await abort("validating", validated.error);

    const preview = await finalize(batchId, onProgress);
    if (!preview.ok || !preview.data) {
      // O lote fica em rascunho: a prévia pode ser refeita em Lotes → Retomar.
      return { ok: false, error: preview.error ?? "Não foi possível montar a prévia.", stage: "finalizing", batchId };
    }
    const { rows, ...info } = sheet;
    return { ok: true, sheet: { ...info, rowsRead: rows.length }, preview: preview.data };
  } finally {
    onProgress?.(null);
  }
}

/**
 * Retoma um lote aberto: rascunho → valida o que faltar e monta a prévia;
 * validado → refaz a prévia com a base de agora.
 */
export async function resumeKmImport(
  batchId: string,
  status: string,
  onProgress?: KmImportProgressHandler,
): Promise<StepResult<KmImportPreview>> {
  try {
    if (status === "draft") {
      const validated = await validateAll(batchId, 0, onProgress);
      if (!validated.ok) return { ok: false, error: validated.error };
    }
    const preview = await finalize(batchId, onProgress);
    return preview.ok && preview.data ? preview : { ok: false, error: preview.error ?? "Não foi possível montar a prévia." };
  } finally {
    onProgress?.(null);
  }
}

/**
 * Confirma: consolida em blocos de até 2.000 linhas até concluir. Um lote
 * interrompido no meio ("gravando") continua daqui — o que já foi gravado
 * não se repete.
 */
export async function confirmKmImport(
  batchId: string,
  expectedRows: number,
  onProgress?: KmImportProgressHandler,
): Promise<StepResult<KmImportOutcome>> {
  let total = Math.max(0, expectedRows);
  try {
    onProgress?.({ stage: "saving", done: 0, total });
    const result = await runInSteps({
      step: (limit) => processKmChunk(batchId, limit),
      remaining: (d) => (d.done ? 0 : Math.max(1, d.remaining)),
      onStep: (d) => {
        total = Math.max(total, d.remaining);
        onProgress?.({ stage: "saving", done: d.done ? total : Math.max(0, total - d.remaining), total });
      },
      initialLimit: 2000,
      maxLimit: 2000,
      minLimit: 50,
    });
    if (!result.ok || !result.data?.outcome) return { ok: false, error: result.error ?? "Não foi possível gravar a importação." };
    return { ok: true, data: result.data.outcome };
  } finally {
    onProgress?.(null);
  }
}
