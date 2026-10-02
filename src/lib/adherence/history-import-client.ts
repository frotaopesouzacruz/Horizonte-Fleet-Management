import { fileFromForm, runChunkedProcess, runStagedImport, type ImportProgressHandler } from "@/lib/import/client";
import type { Result } from "./actions";
import type { ChecklistHistoryLayout } from "./history-import-columns";
import {
  finalizeHistoryImport, processHistoryChunk, stageHistoryChunk, validateHistoryChunk,
  type HistoryImportOptions, type HistoryImportOutcome, type HistoryImportPreview,
} from "./history-import-actions";

/**
 * A importação do histórico de Check List vista da tela: o arquivo é lido no
 * navegador e vai ao servidor em partes, com o catálogo publicado guiando o
 * mapeamento das colunas.
 */
export function uploadHistoryImport(
  formData: FormData,
  layout: ChecklistHistoryLayout,
  options: HistoryImportOptions,
  onProgress?: ImportProgressHandler,
): Promise<Result<HistoryImportPreview>> {
  return runStagedImport(
    fileFromForm(formData),
    {
      load: (input) => stageHistoryChunk({ ...input, layout, options }),
      validate: validateHistoryChunk,
      finalize: (batchId, sheet) => finalizeHistoryImport(batchId, sheet, layout),
    },
    onProgress,
  );
}

export function confirmHistoryImport(
  batchId: string,
  onProgress?: ImportProgressHandler,
  expectedRows = 0,
): Promise<Result<HistoryImportOutcome>> {
  return runChunkedProcess((limit) => processHistoryChunk(batchId, limit), onProgress, expectedRows);
}
