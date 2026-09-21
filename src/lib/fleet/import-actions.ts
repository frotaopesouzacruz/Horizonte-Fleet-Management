"use server";

import { createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireOrganization } from "@/lib/auth/session";
import { parseSpreadsheet } from "@/lib/admin/spreadsheet";
import {
  autoMapColumns,
  normalizeVehicleRow,
  FLEET_COLUMNS,
  type CellValue,
  type FleetField,
} from "./columns";
import type { Result } from "./actions";
import type { Json } from "@/types/database.types";

/**
 * Fleet import.
 *
 * The staging pipeline is the one from Etapa 03 — `import_batches`,
 * `import_rows`, `import_errors`, validate, preview, process — with a batch
 * type of `vehicles`. Nothing reaches `vehicles` until someone confirms the
 * preview, and the database routines decide what an import is allowed to
 * change. Everything it is not allowed to change comes back as a divergence
 * with both values side by side, which is the whole of §55.
 */

const MODULE_PATH = "/frota/cadastro";
const MAX_ROWS = 20000;
const MAX_FILE_BYTES = 10 * 1024 * 1024;

export interface FleetImportPreview {
  batchId: string;
  fileName: string;
  sheetName: string;
  mode: string;
  totalRows: number;
  validRows: number;
  warningRows: number;
  errorRows: number;
  createRows: number;
  updateRows: number;
  mappedColumns: { header: string; field: FleetField; label: string }[];
  unmappedColumns: string[];
  alreadyImported: boolean;
  /** Rows whose allocation or odometer disagrees with HFM. Neither was changed. */
  assignmentDivergences: number;
  odometerDivergences: number;
  findings: { row_number: number | null; level: string; field: string | null; message: string }[];
  sample: {
    row_number: number;
    action: string;
    status: string;
    fleetCode: string;
    plate: string;
    operation: string;
  }[];
}

export async function uploadFleetImport(formData: FormData): Promise<Result<FleetImportPreview>> {
  const { organization } = await requireOrganization("vehicles.import");
  const supabase = await createClient();

  const file = formData.get("file");
  const mode = String(formData.get("mode") ?? "create_update");
  if (!(file instanceof File)) return { ok: false, error: "Selecione um arquivo." };
  if (file.size === 0) return { ok: false, error: "O arquivo está vazio." };
  if (file.size > MAX_FILE_BYTES) return { ok: false, error: "O arquivo excede 10 MB." };
  if (!/\.(xlsx|csv)$/i.test(file.name)) {
    return { ok: false, error: "Formato não suportado. Utilize XLSX ou CSV." };
  }

  const buffer = await file.arrayBuffer();
  const fileHash = createHash("sha256").update(Buffer.from(buffer)).digest("hex");

  let sheet;
  try {
    sheet = await parseSpreadsheet(buffer, file.name);
  } catch {
    return { ok: false, error: "Não foi possível ler o arquivo. Verifique se é um XLSX ou CSV válido." };
  }

  if (!sheet.rows.length) return { ok: false, error: "A planilha não possui linhas de dados." };
  if (sheet.rows.length > MAX_ROWS) return { ok: false, error: `A planilha excede ${MAX_ROWS} linhas.` };

  const { mapping, unmapped, missing } = autoMapColumns(sheet.headers);
  if (missing.length) {
    return {
      ok: false,
      error: `Colunas obrigatórias não encontradas: ${missing.map((m) => m.label).join(", ")}.`,
    };
  }

  // The same file processed twice is not blocked, only announced.
  const { data: previous } = await supabase
    .from("import_batches")
    .select("id")
    .eq("organization_id", organization.organizationId)
    .eq("type", "vehicles")
    .eq("file_hash", fileHash)
    .eq("status", "completed")
    .limit(1);

  const { data: batch, error: batchError } = await supabase
    .from("import_batches")
    .insert({
      organization_id: organization.organizationId,
      type: "vehicles",
      mode,
      status: "draft",
      file_name: file.name,
      file_hash: fileHash,
      file_size: file.size,
      column_mapping: Object.fromEntries(
        Object.entries(mapping).map(([index, field]) => [sheet.headers[Number(index)] ?? index, field]),
      ),
    })
    .select("id")
    .single();

  if (batchError || !batch) {
    return { ok: false, error: "Não foi possível iniciar a importação. Verifique sua permissão." };
  }

  const staged = sheet.rows.map((values, index) => {
    const raw: Record<string, CellValue> = {};
    const mapped: Record<string, CellValue> = {};

    sheet.headers.forEach((header, columnIndex) => {
      const value = values[columnIndex] ?? null;
      raw[header || `col_${columnIndex + 1}`] = value instanceof Date ? value.toISOString() : value;
      const field = mapping[columnIndex];
      if (field) mapped[field] = value;
    });

    return {
      organization_id: organization.organizationId,
      batch_id: batch.id,
      row_number: index + 2, // 1 is the header, as the file shows it
      raw_data: raw as unknown as Json,
      normalized_data: normalizeVehicleRow(mapped) as unknown as Json,
    };
  });

  for (let i = 0; i < staged.length; i += 500) {
    const { error } = await supabase.from("import_rows").insert(staged.slice(i, i + 500));
    if (error) {
      await supabase.from("import_batches").delete().eq("id", batch.id);
      return { ok: false, error: "Não foi possível preparar as linhas da importação." };
    }
  }

  const { data: validation, error: validationError } = await supabase
    .rpc("validate_vehicle_import", { p_batch_id: batch.id })
    .maybeSingle();

  if (validationError) {
    await supabase.from("import_batches").delete().eq("id", batch.id);
    return { ok: false, error: "Não foi possível validar a importação." };
  }

  const preview = await loadPreview(batch.id, {
    fileName: file.name,
    sheetName: sheet.sheetName,
    mode,
    mapping,
    headers: sheet.headers,
    unmapped: unmapped.map((u) => u.header),
    alreadyImported: Boolean(previous?.length),
    counts: validation,
  });

  return { ok: true, data: preview };
}

async function loadPreview(
  batchId: string,
  context: {
    fileName: string;
    sheetName: string;
    mode: string;
    mapping: Record<number, FleetField>;
    headers: string[];
    unmapped: string[];
    alreadyImported: boolean;
    counts: Partial<{
      total_rows: number;
      valid_rows: number;
      warning_rows: number;
      error_rows: number;
      create_rows: number;
      update_rows: number;
    }> | null;
  },
): Promise<FleetImportPreview> {
  const supabase = await createClient();

  const [findings, sample, divergences] = await Promise.all([
    supabase
      .from("import_errors")
      .select("row_number, level, field, message")
      .eq("batch_id", batchId)
      .order("level")
      .order("row_number")
      .limit(300),
    supabase
      .from("import_rows")
      .select("row_number, action, status, normalized_data")
      .eq("batch_id", batchId)
      .order("row_number")
      .limit(12),
    supabase.from("import_errors").select("code").eq("batch_id", batchId).limit(5000),
  ]);

  const codes = divergences.data ?? [];

  return {
    batchId,
    fileName: context.fileName,
    sheetName: context.sheetName,
    mode: context.mode,
    totalRows: context.counts?.total_rows ?? 0,
    validRows: context.counts?.valid_rows ?? 0,
    warningRows: context.counts?.warning_rows ?? 0,
    errorRows: context.counts?.error_rows ?? 0,
    createRows: context.counts?.create_rows ?? 0,
    updateRows: context.counts?.update_rows ?? 0,
    mappedColumns: Object.entries(context.mapping).map(([index, field]) => ({
      header: context.headers[Number(index)] ?? "",
      field,
      label: FLEET_COLUMNS.find((c) => c.field === field)?.label ?? field,
    })),
    unmappedColumns: context.unmapped,
    alreadyImported: context.alreadyImported,
    assignmentDivergences: codes.filter((row) => row.code === "assignment_divergence").length,
    odometerDivergences: codes.filter((row) => row.code === "odometer_divergence").length,
    findings: findings.data ?? [],
    sample: (sample.data ?? []).map((row) => {
      const data = row.normalized_data as {
        fleet_code?: string;
        license_plate?: string;
        operation_name?: string;
      };
      return {
        row_number: row.row_number,
        action: row.action,
        status: row.status,
        fleetCode: data?.fleet_code ?? "",
        plate: data?.license_plate ?? "",
        operation: data?.operation_name ?? "",
      };
    }),
  };
}

export async function processFleetImport(
  batchId: string,
): Promise<Result<{ created: number; updated: number; skipped: number }>> {
  await requireOrganization("vehicles.import");
  const supabase = await createClient();

  const { data, error } = await supabase
    .rpc("process_vehicle_import", { p_batch_id: batchId })
    .maybeSingle();

  if (error) {
    await supabase
      .from("import_batches")
      .update({ status: "failed", error_message: error.message.slice(0, 500) })
      .eq("id", batchId);
    return { ok: false, error: "A importação falhou e nenhum registro foi alterado." };
  }

  revalidatePath(MODULE_PATH);
  return {
    ok: true,
    data: {
      created: data?.created_rows ?? 0,
      updated: data?.updated_rows ?? 0,
      skipped: data?.skipped_rows ?? 0,
    },
  };
}

export async function cancelFleetImport(batchId: string): Promise<Result> {
  await requireOrganization("vehicles.import");
  const supabase = await createClient();

  const { error } = await supabase.from("import_batches").delete().eq("id", batchId);
  if (error) return { ok: false, error: "Não foi possível cancelar a importação." };
  return { ok: true };
}
