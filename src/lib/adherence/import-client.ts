import {
  fileFromForm, runChunkedProcess, runStagedImport, type ImportProgressHandler,
} from "@/lib/import/client";
import type { Result } from "./actions";
import {
  finalizeAdherenceImport, processAdherenceChunk, stageAdherenceChunk, validateAdherenceChunk,
  type AdherenceImportOutcome, type AdherenceImportPreview,
} from "./import-actions";

/**
 * A importação de aderência vista da tela: o arquivo é lido no navegador e
 * vai ao servidor em partes, sem teto de linhas.
 */

export function uploadAdherenceImport(
  formData: FormData,
  onProgress?: ImportProgressHandler,
): Promise<Result<AdherenceImportPreview>> {
  return runStagedImport(
    fileFromForm(formData),
    { load: stageAdherenceChunk, validate: validateAdherenceChunk, finalize: finalizeAdherenceImport },
    onProgress,
  );
}

export function confirmAdherenceImport(
  batchId: string,
  onProgress?: ImportProgressHandler,
  expectedRows = 0,
): Promise<Result<AdherenceImportOutcome>> {
  return runChunkedProcess((limit) => processAdherenceChunk(batchId, limit), onProgress, expectedRows);
}
