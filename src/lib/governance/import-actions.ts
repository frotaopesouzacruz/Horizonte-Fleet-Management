"use server";

import { createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import { resolveOrganization } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { parseSpreadsheet } from "@/lib/admin/spreadsheet";
import type { Json } from "@/types/database.types";
import type { Result } from "./actions";
import {
  ALLOCATION_IMPORT_COLUMNS, ALLOCATION_REQUIRED, BR_IMPORT_COLUMNS, BR_REQUIRED,
  cellToText, mapColumns, toIsoDate,
  type AllocationImportField, type BrImportField, type ImportKind,
} from "./import-columns";

/**
 * Importação da Fidelização pela tela (Etapa 13, §56–§58).
 *
 * A action só lê a planilha e mapeia as colunas. Tudo o mais é do banco:
 * `stage_*_import` valida linha a linha e devolve a prévia; `process_*_import`
 * grava o que a prévia prometeu. Nada aqui cria veículo, BR ou colaborador
 * por conta própria, nada sobrescreve vínculo histórico, nada toca em perfil
 * de acesso — a §57 e a §58 são o contrato dessas duas rotinas.
 */

const MODULE_PATH = "/governanca/fidelizacao";
const MAX_ROWS = 5000;
const MAX_FILE_BYTES = 10 * 1024 * 1024;

const SESSION_LOST =
  "Sua sessão expirou ou o acesso mudou. Recarregue a página e tente de novo.";

export interface ImportFinding {
  rowNumber: number | null;
  level: string;
  field: string | null;
  code: string | null;
  message: string;
}

export interface BrImportSampleRow {
  rowNumber: number;
  status: string;
  action: string;
  operation: string | null;
  city: string | null;
  stateUf: string | null;
  code: string | null;
  description: string | null;
  statusValue: string | null;
  currentStatus: string | null;
}

export interface BrImportPreview {
  kind: "brs";
  batchId: string;
  fileName: string;
  sheetName: string;
  totalRows: number;
  validRows: number;
  warningRows: number;
  errorRows: number;
  createRows: number;
  updateRows: number;
  skipRows: number;
  alreadyImported: boolean;
  mappedColumns: { header: string; field: string; label: string }[];
  unmappedColumns: string[];
  findings: ImportFinding[];
  sample: BrImportSampleRow[];
}

export interface AllocationImportSampleRow {
  rowNumber: number;
  status: string;
  action: string;
  brCode: string | null;
  operation: string | null;
  city: string | null;
  fleetCode: string | null;
  licensePlate: string | null;
  startDate: string | null;
  endDate: string | null;
  vehicleRole: string | null;
  statusValue: string | null;
  previousVehicle: string | null;
}

/** As sete contagens da prévia (§58). */
export interface AllocationImportCategories {
  existing: number;
  new: number;
  substitutions: number;
  overlaps: number;
  unknownBrs: number;
  vehiclesNotFound: number;
  competenceErrors: number;
}

export interface AllocationImportPreview {
  kind: "allocations";
  batchId: string;
  fileName: string;
  sheetName: string;
  totalRows: number;
  validRows: number;
  warningRows: number;
  errorRows: number;
  createRows: number;
  substituteRows: number;
  skipRows: number;
  alreadyImported: boolean;
  categories: AllocationImportCategories;
  mappedColumns: { header: string; field: string; label: string }[];
  unmappedColumns: string[];
  findings: ImportFinding[];
  sample: AllocationImportSampleRow[];
}

export type ImportPreview = BrImportPreview | AllocationImportPreview;

export interface ImportOutcome {
  created: number;
  updated: number;
  substituted: number;
  skipped: number;
}

type Raw = Record<string, unknown>;
const obj = (v: unknown): Raw => (v && typeof v === "object" && !Array.isArray(v) ? (v as Raw) : {});
const arr = (v: unknown): Raw[] => (Array.isArray(v) ? (v as Raw[]) : []);
const num = (v: unknown): number => (typeof v === "number" ? v : v == null ? 0 : Number(v));
const strOrNull = (v: unknown): string | null => (v == null || v === "" ? null : String(v));

function toMessage(error: { code?: string; message?: string }, fallback: string): string {
  const message = error.message ?? "";
  if (message && /^[A-ZÀ-Ý]/.test(message.trim()) && !message.includes("violates")) return message;
  if (error.code === "42501") return "Você não possui permissão para importar na Fidelização.";
  return fallback;
}

function findings(v: unknown): ImportFinding[] {
  return arr(v).map((f) => ({
    rowNumber: f.row_number == null ? null : num(f.row_number),
    level: String(f.level ?? ""),
    field: strOrNull(f.field),
    code: strOrNull(f.code),
    message: String(f.message ?? ""),
  }));
}

async function readFile(formData: FormData): Promise<
  | { ok: true; file: File; buffer: ArrayBuffer; hash: string; sheet: Awaited<ReturnType<typeof parseSpreadsheet>> }
  | { ok: false; error: string }
> {
  const file = formData.get("file");
  if (!(file instanceof File)) return { ok: false, error: "Selecione um arquivo." };
  if (file.size === 0) return { ok: false, error: "O arquivo está vazio." };
  if (file.size > MAX_FILE_BYTES) return { ok: false, error: "O arquivo excede 10 MB." };
  if (!/\.(xlsx|csv)$/i.test(file.name)) return { ok: false, error: "Formato não suportado. Utilize XLSX ou CSV." };

  const buffer = await file.arrayBuffer();
  const hash = createHash("sha256").update(Buffer.from(buffer)).digest("hex");
  let sheet;
  try {
    sheet = await parseSpreadsheet(buffer, file.name);
  } catch {
    return { ok: false, error: "Não foi possível ler o arquivo. Verifique se é um XLSX ou CSV válido." };
  }
  if (!sheet.rows.length) return { ok: false, error: "A planilha não possui linhas de dados." };
  if (sheet.rows.length > MAX_ROWS) return { ok: false, error: `A planilha excede ${MAX_ROWS} linhas.` };
  return { ok: true, file, buffer, hash, sheet };
}

/** §56 — envia o arquivo de BRs para validação e devolve a prévia. */
export async function uploadBrImport(formData: FormData): Promise<Result<BrImportPreview>> {
  const context = await resolveOrganization("fidelization.import");
  if (!context) return { ok: false, error: SESSION_LOST };
  const supabase = await createClient();

  const read = await readFile(formData);
  if (!read.ok) return { ok: false, error: read.error };
  const { file, hash, sheet } = read;

  const columns = mapColumns<BrImportField>(sheet.headers, BR_IMPORT_COLUMNS, BR_REQUIRED);
  if (columns.missing.length) {
    return { ok: false, error: `Colunas obrigatórias não encontradas: ${columns.missing.join(", ")}.` };
  }

  const rows: Json[] = sheet.rows.map((values, index) => {
    const raw: Record<string, Json> = {};
    const mapped: Partial<Record<BrImportField, string | null>> = {};
    sheet.headers.forEach((header, columnIndex) => {
      const value = values[columnIndex] ?? null;
      raw[header || `col_${columnIndex + 1}`] = value instanceof Date ? value.toISOString() : (value as Json);
      const field = columns.mapping[columnIndex];
      if (field) mapped[field] = cellToText(value);
    });
    return {
      row_number: index + 2,
      raw,
      operation: mapped.operation ?? null,
      state: mapped.state ?? null,
      city: mapped.city ?? null,
      code: mapped.code ?? null,
      description: mapped.description ?? null,
      status: mapped.status ?? null,
      notes: mapped.notes ?? null,
    };
  });

  const { data, error } = await supabase.rpc("stage_br_import", {
    p_organization_id: context.organization.organizationId,
    p_payload: {
      file_name: file.name,
      file_hash: hash,
      file_size: file.size,
      column_mapping: Object.fromEntries(columns.mapped.map((m) => [m.header, m.field])),
      rows,
    },
  });
  if (error) return { ok: false, error: toMessage(error, "Não foi possível validar a importação.") };

  const r = obj(data);
  return {
    ok: true,
    data: {
      kind: "brs",
      batchId: String(r.batch_id ?? ""),
      fileName: file.name,
      sheetName: sheet.sheetName,
      totalRows: num(r.total_rows),
      validRows: num(r.valid_rows),
      warningRows: num(r.warning_rows),
      errorRows: num(r.error_rows),
      createRows: num(r.create_rows),
      updateRows: num(r.update_rows),
      skipRows: num(r.skip_rows),
      alreadyImported: r.already_imported === true,
      mappedColumns: columns.mapped,
      unmappedColumns: columns.unmapped,
      findings: findings(r.findings),
      sample: arr(r.sample).map((s) => {
        const d = obj(s.data);
        return {
          rowNumber: num(s.row_number),
          status: String(s.status ?? ""),
          action: String(s.action ?? ""),
          operation: strOrNull(d.operation_name),
          city: strOrNull(d.city_name),
          stateUf: strOrNull(d.state_uf),
          code: strOrNull(d.code),
          description: strOrNull(d.description),
          statusValue: strOrNull(d.status),
          currentStatus: strOrNull(d.current_status),
        };
      }),
    },
  };
}

/** §57 — envia o arquivo de alocações para validação e devolve a prévia da §58. */
export async function uploadAllocationImport(formData: FormData): Promise<Result<AllocationImportPreview>> {
  const context = await resolveOrganization("fidelization.import");
  if (!context) return { ok: false, error: SESSION_LOST };
  const supabase = await createClient();

  const read = await readFile(formData);
  if (!read.ok) return { ok: false, error: read.error };
  const { file, hash, sheet } = read;

  const columns = mapColumns<AllocationImportField>(sheet.headers, ALLOCATION_IMPORT_COLUMNS, ALLOCATION_REQUIRED);
  if (columns.missing.length) {
    return { ok: false, error: `Colunas obrigatórias não encontradas: ${columns.missing.join(", ")}.` };
  }

  const rows: Json[] = sheet.rows.map((values, index) => {
    const raw: Record<string, Json> = {};
    const mapped: Partial<Record<AllocationImportField, string | null>> = {};
    sheet.headers.forEach((header, columnIndex) => {
      const value = values[columnIndex] ?? null;
      raw[header || `col_${columnIndex + 1}`] = value instanceof Date ? value.toISOString() : (value as Json);
      const field = columns.mapping[columnIndex];
      if (!field) return;
      mapped[field] = field === "start_date" || field === "end_date" ? toIsoDate(value) : cellToText(value);
    });
    return {
      row_number: index + 2,
      raw,
      operation: mapped.operation ?? null,
      state: mapped.state ?? null,
      city: mapped.city ?? null,
      br_code: mapped.br_code ?? null,
      fleet_code: mapped.fleet_code ?? null,
      license_plate: mapped.license_plate ?? null,
      start_date: mapped.start_date ?? null,
      end_date: mapped.end_date ?? null,
      vehicle_role: mapped.vehicle_role ?? null,
      status: mapped.status ?? null,
      reason: mapped.reason ?? null,
    };
  });

  const { data, error } = await supabase.rpc("stage_fidelization_import", {
    p_organization_id: context.organization.organizationId,
    p_payload: {
      file_name: file.name,
      file_hash: hash,
      file_size: file.size,
      column_mapping: Object.fromEntries(columns.mapped.map((m) => [m.header, m.field])),
      rows,
    },
  });
  if (error) return { ok: false, error: toMessage(error, "Não foi possível validar a importação.") };

  const r = obj(data);
  const c = obj(r.categories);
  return {
    ok: true,
    data: {
      kind: "allocations",
      batchId: String(r.batch_id ?? ""),
      fileName: file.name,
      sheetName: sheet.sheetName,
      totalRows: num(r.total_rows),
      validRows: num(r.valid_rows),
      warningRows: num(r.warning_rows),
      errorRows: num(r.error_rows),
      createRows: num(r.create_rows),
      substituteRows: num(r.substitute_rows),
      skipRows: num(r.skip_rows),
      alreadyImported: r.already_imported === true,
      categories: {
        existing: num(c.existing),
        new: num(c.new),
        substitutions: num(c.substitutions),
        overlaps: num(c.overlaps),
        unknownBrs: num(c.unknown_brs),
        vehiclesNotFound: num(c.vehicles_not_found),
        competenceErrors: num(c.competence_errors),
      },
      mappedColumns: columns.mapped,
      unmappedColumns: columns.unmapped,
      findings: findings(r.findings),
      sample: arr(r.sample).map((s) => {
        const d = obj(s.data);
        return {
          rowNumber: num(s.row_number),
          status: String(s.status ?? ""),
          action: String(s.action ?? ""),
          brCode: strOrNull(d.br_code),
          operation: strOrNull(d.operation_name),
          city: strOrNull(d.city_name),
          fleetCode: strOrNull(d.fleet_code),
          licensePlate: strOrNull(d.license_plate),
          startDate: strOrNull(d.start_date),
          endDate: strOrNull(d.end_date),
          vehicleRole: strOrNull(d.vehicle_role),
          statusValue: strOrNull(d.status),
          previousVehicle: strOrNull(d.previous_vehicle),
        };
      }),
    },
  };
}

/** Grava um lote validado. O tipo diz qual rotina do banco decide. */
export async function confirmImport(kind: ImportKind, batchId: string): Promise<Result<ImportOutcome>> {
  const context = await resolveOrganization("fidelization.import");
  if (!context) return { ok: false, error: SESSION_LOST };
  const supabase = await createClient();

  const { data, error } = await supabase.rpc(kind === "brs" ? "process_br_import" : "process_fidelization_import", {
    p_organization_id: context.organization.organizationId,
    p_batch_id: batchId,
  });
  if (error) return { ok: false, error: toMessage(error, "A importação falhou e nenhum registro foi alterado.") };

  revalidatePath(MODULE_PATH);
  const r = obj(data);
  return {
    ok: true,
    data: {
      created: num(r.created),
      updated: num(r.updated),
      substituted: num(r.substituted),
      skipped: num(r.skipped),
    },
  };
}
