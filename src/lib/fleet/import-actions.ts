"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireOrganization } from "@/lib/auth/session";
import { rawRow } from "@/lib/import/sheet-core";
import type { StepResult } from "@/lib/import/client";
import { clampLimit, stepError } from "@/lib/import/server";
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
 *
 * No row ceiling: the browser reads the file and sends the rows in parts
 * (`loadFleetChunk`); the database validates (`validateFleetChunk`) and writes
 * (`processFleetChunk`) in parts too, each well inside one request's time.
 */

const MODULE_PATH = "/frota/cadastro";

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

/** One part of the file, as the browser read it. The first part opens the batch. */
export interface FleetImportChunkInput {
  batchId: string | null;
  file: { name: string; size: number; hash: string };
  sheetName: string;
  headers: string[];
  rows: CellValue[][];
  /** Spreadsheet row number of the first row in this part (row 1 is the header). */
  firstRowNumber: number;
  mode: string;
}

export async function loadFleetChunk(input: FleetImportChunkInput): Promise<StepResult<{ batchId: string }>> {
  const { organization } = await requireOrganization("vehicles.import");
  const supabase = await createClient();

  const { mapping, missing } = autoMapColumns(input.headers);
  if (missing.length) {
    return {
      ok: false,
      error: `Colunas obrigatórias não encontradas: ${missing.map((m) => m.label).join(", ")}.`,
    };
  }

  let batchId = input.batchId;
  let created = false;
  if (!batchId) {
    const { data: batch, error: batchError } = await supabase
      .from("import_batches")
      .insert({
        organization_id: organization.organizationId,
        type: "vehicles",
        mode: input.mode,
        status: "draft",
        file_name: input.file.name,
        file_hash: input.file.hash,
        file_size: input.file.size,
        column_mapping: Object.fromEntries(
          Object.entries(mapping).map(([index, field]) => [input.headers[Number(index)] ?? index, field]),
        ),
      })
      .select("id")
      .single();
    if (batchError || !batch) {
      return { ok: false, error: "Não foi possível iniciar a importação. Verifique sua permissão." };
    }
    batchId = batch.id;
    created = true;
  }

  const staged = input.rows.map((values, index) => {
    const mapped: Record<string, CellValue> = {};
    input.headers.forEach((_, columnIndex) => {
      const field = mapping[columnIndex];
      if (field) mapped[field] = values[columnIndex] ?? null;
    });
    return {
      organization_id: organization.organizationId,
      batch_id: batchId!,
      row_number: input.firstRowNumber + index,
      raw_data: rawRow(input.headers, values) as unknown as Json,
      normalized_data: normalizeVehicleRow(mapped) as unknown as Json,
    };
  });

  // A part sent twice (an answer lost on the way) does not duplicate rows.
  const { error } = await supabase
    .from("import_rows")
    .upsert(staged, { onConflict: "batch_id,row_number", ignoreDuplicates: true });
  if (error) {
    if (created) await supabase.from("import_batches").delete().eq("id", batchId!);
    return { ok: false, error: "Não foi possível preparar as linhas da importação." };
  }
  return { ok: true, data: { batchId: batchId! } };
}

/** Validates the next `limit` pending rows, in file order. */
export async function validateFleetChunk(batchId: string, limit: number): Promise<StepResult<{ pending: number }>> {
  await requireOrganization("vehicles.import");
  const supabase = await createClient();
  const { data, error } = await supabase
    .rpc("validate_vehicle_import", { p_batch_id: batchId, p_limit: clampLimit(limit) })
    .maybeSingle();
  if (error) return stepError(error, () => "Não foi possível validar a importação.");
  return { ok: true, data: { pending: data?.pending_rows ?? 0 } };
}

export async function finalizeFleetImport(
  batchId: string,
  sheet: { fileName: string; sheetName: string; headers: string[]; mode: string },
): Promise<StepResult<FleetImportPreview>> {
  const { organization } = await requireOrganization("vehicles.import");
  const supabase = await createClient();

  const { data: batch } = await supabase
    .from("import_batches")
    .select("status, file_hash, total_rows, valid_rows, warning_rows, error_rows")
    .eq("id", batchId)
    .maybeSingle();
  if (!batch || batch.status !== "validated") {
    return { ok: false, error: "A validação desta importação não terminou. Envie o arquivo novamente." };
  }

  const count = (action: string) =>
    supabase.from("import_rows").select("id", { count: "exact", head: true }).eq("batch_id", batchId).eq("action", action);

  // The same file processed twice is not blocked, only announced.
  const [previous, creates, updates] = await Promise.all([
    batch.file_hash
      ? supabase
          .from("import_batches")
          .select("id")
          .eq("organization_id", organization.organizationId)
          .eq("type", "vehicles")
          .eq("file_hash", batch.file_hash)
          .eq("status", "completed")
          .limit(1)
      : Promise.resolve({ data: [] as { id: string }[] }),
    count("create"),
    count("update"),
  ]);

  const { mapping, unmapped } = autoMapColumns(sheet.headers);
  const preview = await loadPreview(batchId, {
    fileName: sheet.fileName,
    sheetName: sheet.sheetName,
    mode: sheet.mode,
    mapping,
    headers: sheet.headers,
    unmapped: unmapped.map((u) => u.header),
    alreadyImported: Boolean(previous.data?.length),
    counts: {
      total_rows: batch.total_rows ?? 0,
      valid_rows: batch.valid_rows ?? 0,
      warning_rows: batch.warning_rows ?? 0,
      error_rows: batch.error_rows ?? 0,
      create_rows: creates.count ?? 0,
      update_rows: updates.count ?? 0,
    },
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

  const divergences = (code: string) =>
    supabase.from("import_errors").select("id", { count: "exact", head: true }).eq("batch_id", batchId).eq("code", code);

  const [findings, sample, assignmentDivergences, odometerDivergences] = await Promise.all([
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
    divergences("assignment_divergence"),
    divergences("odometer_divergence"),
  ]);

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
    assignmentDivergences: assignmentDivergences.count ?? 0,
    odometerDivergences: odometerDivergences.count ?? 0,
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

/**
 * Writes the next `limit` rows of a validated batch. The last part closes the
 * batch and brings the totals; an interrupted batch resumes where it stopped,
 * because a written row is no longer waiting to be written.
 */
export async function processFleetChunk(
  batchId: string,
  limit: number,
): Promise<StepResult<{ done: boolean; remaining: number; outcome?: { created: number; updated: number; skipped: number } }>> {
  await requireOrganization("vehicles.import");
  const supabase = await createClient();

  const { data, error } = await supabase
    .rpc("process_vehicle_import", { p_batch_id: batchId, p_limit: clampLimit(limit) })
    .maybeSingle();
  if (error) {
    return stepError(error, () =>
      "A gravação parou nesta parte. O que já foi gravado continua gravado; confirme de novo para continuar.",
    );
  }

  const remaining = data?.remaining_rows ?? 0;
  if (remaining > 0) return { ok: true, data: { done: false, remaining } };

  revalidatePath(MODULE_PATH);
  return {
    ok: true,
    data: {
      done: true,
      remaining: 0,
      outcome: {
        created: data?.created_rows ?? 0,
        updated: data?.updated_rows ?? 0,
        skipped: data?.skipped_rows ?? 0,
      },
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
