import {
  fileFromForm, readImportFile, runChunkedProcess, runStagedImport, type ImportProgressHandler,
} from "@/lib/import/client";
import type { Result } from "./actions";
import {
  finalizeFidelizationImport, processFidelizationChunk, stageFidelizationChunk, validateFidelizationChunk,
  type ImportFileColumns, type ImportOutcome, type ImportPreview,
} from "./import-actions";
import {
  ALLOCATION_IMPORT_COLUMNS, ALLOCATION_REQUIRED, BR_IMPORT_COLUMNS, BR_REQUIRED, mapColumns,
  type ImportColumn, type ImportKind,
} from "./import-columns";

/**
 * A importação da Fidelização vista da gaveta: o arquivo é lido no navegador
 * e vai ao servidor em partes, sem teto de linhas. As assinaturas são as
 * mesmas de antes (FormData → prévia, lote → resultado), mais o progresso.
 */

function mappingFrom(formData: FormData): string | null {
  const mapping = formData.get("mapping");
  return typeof mapping === "string" && mapping ? mapping : null;
}

export function uploadFidelizationImport(
  kind: ImportKind,
  formData: FormData,
  onProgress?: ImportProgressHandler,
): Promise<Result<ImportPreview>> {
  const mapping = mappingFrom(formData);
  return runStagedImport(
    fileFromForm(formData),
    {
      load: (input) => stageFidelizationChunk(kind, { ...input, mapping }),
      validate: (batchId, limit) => validateFidelizationChunk(kind, batchId, limit),
      finalize: (batchId, sheet) => finalizeFidelizationImport(kind, batchId, { ...sheet, mapping }),
    },
    onProgress,
  );
}

export function confirmFidelizationImport(
  kind: ImportKind,
  batchId: string,
  onProgress?: ImportProgressHandler,
  expectedRows = 0,
): Promise<Result<ImportOutcome>> {
  return runChunkedProcess((limit) => processFidelizationChunk(kind, batchId, limit), onProgress, expectedRows);
}

/**
 * Lê os cabeçalhos e sugere a ligação de cada coluna pelos aliases (§47).
 * Nada é gravado; a leitura fica guardada para a validação que vem depois.
 */
export async function inspectFidelizationFile(kind: ImportKind, formData: FormData): Promise<Result<ImportFileColumns>> {
  const file = fileFromForm(formData);
  if (!file) return { ok: false, error: "Selecione um arquivo." };
  const parsed = await readImportFile(file);
  if (!parsed.ok || !parsed.data) return { ok: false, error: parsed.error };
  const { sheet } = parsed.data;
  const columns = (kind === "brs" ? BR_IMPORT_COLUMNS : ALLOCATION_IMPORT_COLUMNS) as ImportColumn<string>[];
  const required = (kind === "brs" ? BR_REQUIRED : ALLOCATION_REQUIRED) as { label: string; fields: string[] }[];
  const auto = mapColumns<string>(sheet.headers, columns, required);
  const suggestion: Record<string, string> = {};
  sheet.headers.forEach((header, index) => {
    if (!header) return;
    suggestion[header] = auto.mapping[index] ?? "";
  });
  return { ok: true, data: { headers: sheet.headers.filter(Boolean), suggestion, rowCount: sheet.rows.length } };
}
