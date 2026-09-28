import {
  fileFromForm, runChunkedProcess, runStagedImport, type ImportProgressHandler, type StepResult,
} from "@/lib/import/client";
import type { MaintenanceImportKind } from "./import-columns";
import {
  cancelMaintenanceImport, finalizeMaintenanceImport, processMaintenanceChunk, stageMaintenanceChunk, validateMaintenanceChunk,
  type MaintenanceImportOutcome, type MaintenanceImportPreview,
} from "./import-actions";

/**
 * As importações da Manutenção vistas da tela: o arquivo é lido no navegador e
 * vai ao servidor em partes, sem teto de linhas. O mesmo fluxo serve às cinco
 * bases; muda só o layout de colunas.
 */
export function uploadMaintenanceImport(
  kind: MaintenanceImportKind,
  formData: FormData,
  onProgress?: ImportProgressHandler,
): Promise<StepResult<MaintenanceImportPreview>> {
  return runStagedImport(
    fileFromForm(formData),
    {
      load: (input) => stageMaintenanceChunk(kind, input),
      validate: validateMaintenanceChunk,
      finalize: (batchId, sheet) => finalizeMaintenanceImport(kind, batchId, sheet),
      abort: cancelMaintenanceImport,
    },
    onProgress,
  );
}

export function confirmMaintenanceImport(
  batchId: string,
  onProgress?: ImportProgressHandler,
  expectedRows = 0,
): Promise<StepResult<MaintenanceImportOutcome>> {
  return runChunkedProcess((limit) => processMaintenanceChunk(batchId, limit), onProgress, expectedRows);
}
