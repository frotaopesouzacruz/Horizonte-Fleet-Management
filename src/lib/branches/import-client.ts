import {
  fileFromForm, runChunkedProcess, runStagedImport, type ImportProgressHandler,
} from "@/lib/import/client";
import type { Result } from "./actions";
import {
  finalizeBranchImport, processBranchChunk, stageBranchChunk, validateBranchChunk,
  type BranchImportOutcome, type BranchImportPreview,
} from "./import-actions";

/**
 * A importação de Filiais vista da gaveta: o arquivo é lido no navegador e
 * vai ao servidor em partes, sem teto de linhas. As assinaturas são as mesmas
 * de antes (FormData → prévia, lote → resultado), mais o progresso.
 */

export function uploadBranchImport(
  formData: FormData,
  onProgress?: ImportProgressHandler,
): Promise<Result<BranchImportPreview>> {
  return runStagedImport(
    fileFromForm(formData),
    { load: stageBranchChunk, validate: validateBranchChunk, finalize: finalizeBranchImport },
    onProgress,
  );
}

export function confirmBranchImport(
  batchId: string,
  onProgress?: ImportProgressHandler,
  expectedRows = 0,
): Promise<Result<BranchImportOutcome>> {
  return runChunkedProcess((limit) => processBranchChunk(batchId, limit), onProgress, expectedRows);
}
