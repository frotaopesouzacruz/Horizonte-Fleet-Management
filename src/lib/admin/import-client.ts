import {
  fileFromForm, runChunkedProcess, runStagedImport, type ImportProgressHandler,
} from "@/lib/import/client";
import type { Result } from "./actions";
import {
  cancelImport, finalizeImport, loadImportChunk, processImportChunk, validateImportChunk,
  type ImportPreview,
} from "./import-actions";

/**
 * The people import as the drawer sees it: the file is read in the browser and
 * reaches the server in parts, with no row ceiling. Same signatures as before
 * (FormData → preview, batch → totals), plus progress.
 */

export function uploadImportFile(
  formData: FormData,
  onProgress?: ImportProgressHandler,
): Promise<Result<ImportPreview>> {
  const mode = String(formData.get("mode") ?? "create_update");
  return runStagedImport(
    fileFromForm(formData),
    {
      load: (input) => loadImportChunk({ ...input, mode }),
      validate: validateImportChunk,
      finalize: (batchId, sheet) => finalizeImport(batchId, { ...sheet, mode }),
      abort: cancelImport,
    },
    onProgress,
  );
}

export function processImport(
  batchId: string,
  onProgress?: ImportProgressHandler,
  expectedRows = 0,
): Promise<Result<{ created: number; updated: number; skipped: number }>> {
  return runChunkedProcess((limit) => processImportChunk(batchId, limit), onProgress, expectedRows);
}
