import {
  fileFromForm, runChunkedProcess, runStagedImport, type ImportProgressHandler,
} from "@/lib/import/client";
import type { Result } from "./actions";
import {
  cancelFleetImport, finalizeFleetImport, loadFleetChunk, processFleetChunk, validateFleetChunk,
  type FleetImportPreview,
} from "./import-actions";

/**
 * The fleet import as the drawer sees it: the file is read in the browser and
 * reaches the server in parts, with no row ceiling. Same signatures as before
 * (FormData → preview, batch → totals), plus progress.
 */

export function uploadFleetImport(
  formData: FormData,
  onProgress?: ImportProgressHandler,
): Promise<Result<FleetImportPreview>> {
  const mode = String(formData.get("mode") ?? "create_update");
  return runStagedImport(
    fileFromForm(formData),
    {
      load: (input) => loadFleetChunk({ ...input, mode }),
      validate: validateFleetChunk,
      finalize: (batchId, sheet) => finalizeFleetImport(batchId, { ...sheet, mode }),
      abort: cancelFleetImport,
    },
    onProgress,
  );
}

export function processFleetImport(
  batchId: string,
  onProgress?: ImportProgressHandler,
  expectedRows = 0,
): Promise<Result<{ created: number; updated: number; skipped: number }>> {
  return runChunkedProcess((limit) => processFleetChunk(batchId, limit), onProgress, expectedRows);
}
