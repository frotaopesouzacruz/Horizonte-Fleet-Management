"use server";

import { revalidatePath } from "next/cache";
import { resolveOrganization } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import type { CellValue } from "@/lib/admin/qlp";
import { rawRow } from "@/lib/import/sheet-core";
import type { StepResult } from "@/lib/import/client";
import { clampLimit, stepError } from "@/lib/import/server";
import type { Json } from "@/types/database.types";
import type { Result } from "./actions";
import {
  ALLOCATION_IMPORT_COLUMNS, ALLOCATION_REQUIRED, BR_IMPORT_COLUMNS, BR_REQUIRED, IMPORT_LAYOUT_KIND,
  cellToText, mapColumns, normalizeHeader, toIsoDate,
  type AllocationImportField, type BrImportField, type ColumnMapping, type ColumnOverrides, type ImportColumn,
  type ImportKind,
} from "./import-columns";

/**
 * Importação da Fidelização pela tela (Etapa 13, §56–§58).
 *
 * A action só mapeia as colunas. Tudo o mais é do banco: `stage_*_import`
 * valida linha a linha e devolve a prévia; `process_*_import` grava o que a
 * prévia prometeu. Nada aqui cria veículo, BR ou colaborador por conta
 * própria, nada sobrescreve vínculo histórico, nada toca em perfil de acesso —
 * a §57 e a §58 são o contrato dessas duas rotinas.
 *
 * Sem teto de linhas: a planilha é lida no navegador e chega aqui em partes
 * (`stageFidelizationChunk`); o banco valida (`validateFidelizationChunk`) e
 * grava (`processFidelizationChunk`) em partes também, e a prévia
 * (`finalizeFidelizationImport`) é a mesma de um arquivo validado de uma vez.
 */

const MODULE_PATH = "/governanca/fidelizacao";

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

/** Uma parte do arquivo, como o navegador a leu. */
export interface ImportChunkInput {
  batchId: string | null;
  file: { name: string; size: number; hash: string };
  sheetName: string;
  headers: string[];
  rows: CellValue[][];
  /** Número, na planilha, da primeira linha desta parte (a linha 1 é o cabeçalho). */
  firstRowNumber: number;
  /** Ligação coluna → campo escolhida na tela (JSON), quando houver. */
  mapping?: string | null;
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

/**
 * A ligação coluna → campo que a tela mandou (JSON). Só passa o que é campo
 * deste arquivo, ou "" (ignorar); o resto é descartado em silêncio, porque o
 * servidor nunca confia no que o formulário diz.
 */
function readOverrides<F extends string>(raw: string | null | undefined, columns: ImportColumn<F>[]): ColumnOverrides {
  if (typeof raw !== "string" || !raw) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  const allowed = new Set<string>(columns.map((c) => c.field));
  const overrides: ColumnOverrides = {};
  for (const [header, field] of Object.entries(obj(parsed))) {
    const key = normalizeHeader(header);
    if (!key || typeof field !== "string") continue;
    if (field === "" || allowed.has(field)) overrides[key] = field;
  }
  return overrides;
}

function columnsFor(kind: ImportKind, headers: string[], mapping?: string | null): ColumnMapping<string> {
  return kind === "brs"
    ? (mapColumns<BrImportField>(headers, BR_IMPORT_COLUMNS, BR_REQUIRED, readOverrides(mapping, BR_IMPORT_COLUMNS)) as ColumnMapping<string>)
    : (mapColumns<AllocationImportField>(
        headers, ALLOCATION_IMPORT_COLUMNS, ALLOCATION_REQUIRED, readOverrides(mapping, ALLOCATION_IMPORT_COLUMNS),
      ) as ColumnMapping<string>);
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

/** As linhas de uma parte, no formato que `stage_*_import` lê. */
function payloadRows(kind: ImportKind, input: ImportChunkInput, columns: ColumnMapping<string>): Json[] {
  return input.rows.map((values, index) => {
    const mapped: Record<string, string | null> = {};
    input.headers.forEach((_, columnIndex) => {
      const field = columns.mapping[columnIndex];
      if (!field) return;
      const value = values[columnIndex] ?? null;
      mapped[field] = field === "start_date" || field === "end_date" ? toIsoDate(value) : cellToText(value);
    });
    const base = {
      row_number: input.firstRowNumber + index,
      raw: rawRow(input.headers, values),
      operation: mapped.operation ?? null,
      state: mapped.state ?? null,
      city: mapped.city ?? null,
      status: mapped.status ?? null,
    };
    return kind === "brs"
      ? { ...base, code: mapped.code ?? null, description: mapped.description ?? null, notes: mapped.notes ?? null }
      : {
          ...base,
          br_code: mapped.br_code ?? null,
          fleet_code: mapped.fleet_code ?? null,
          license_plate: mapped.license_plate ?? null,
          start_date: mapped.start_date ?? null,
          end_date: mapped.end_date ?? null,
          vehicle_role: mapped.vehicle_role ?? null,
          reason: mapped.reason ?? null,
        };
  });
}

const STAGE_RPC = { brs: "stage_br_import", allocations: "stage_fidelization_import" } as const;
const PROCESS_RPC = { brs: "process_br_import", allocations: "process_fidelization_import" } as const;

/** §56/§57 — grava uma parte do arquivo como linhas pendentes; a primeira abre o lote. */
export async function stageFidelizationChunk(
  kind: ImportKind,
  input: ImportChunkInput,
): Promise<StepResult<{ batchId: string }>> {
  const context = await resolveOrganization("fidelization.import");
  if (!context) return { ok: false, error: SESSION_LOST };

  const columns = columnsFor(kind, input.headers, input.mapping);
  if (columns.missing.length) {
    return { ok: false, error: `Colunas obrigatórias não encontradas: ${columns.missing.join(", ")}.` };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc(STAGE_RPC[kind], {
    p_organization_id: context.organization.organizationId,
    p_payload: {
      phase: "load",
      batch_id: input.batchId,
      file_name: input.file.name,
      file_hash: input.file.hash,
      file_size: input.file.size,
      column_mapping: Object.fromEntries(columns.mapped.map((m) => [m.header, m.field])),
      rows: payloadRows(kind, input, columns),
    },
  });
  if (error) return stepError(error, (e) => toMessage(e, "Não foi possível enviar as linhas do arquivo."));
  return { ok: true, data: { batchId: String(obj(data).batch_id ?? "") } };
}

/** Valida as próximas `limit` linhas pendentes, na ordem do arquivo. */
export async function validateFidelizationChunk(
  kind: ImportKind,
  batchId: string,
  limit: number,
): Promise<StepResult<{ pending: number }>> {
  const context = await resolveOrganization("fidelization.import");
  if (!context) return { ok: false, error: SESSION_LOST };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc(STAGE_RPC[kind], {
    p_organization_id: context.organization.organizationId,
    p_payload: { phase: "validate", batch_id: batchId, limit: clampLimit(limit) },
  });
  if (error) return stepError(error, (e) => toMessage(e, "Não foi possível validar a importação."));
  return { ok: true, data: { pending: num(obj(data).pending) } };
}

/** Fecha a validação e devolve a prévia (§56, §58). */
export async function finalizeFidelizationImport(
  kind: ImportKind,
  batchId: string,
  sheet: { fileName: string; sheetName: string; headers: string[]; mapping?: string | null },
): Promise<StepResult<ImportPreview>> {
  const context = await resolveOrganization("fidelization.import");
  if (!context) return { ok: false, error: SESSION_LOST };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc(STAGE_RPC[kind], {
    p_organization_id: context.organization.organizationId,
    p_payload: { phase: "finalize", batch_id: batchId },
  });
  if (error) return stepError(error, (e) => toMessage(e, "Não foi possível validar a importação."));

  const columns = columnsFor(kind, sheet.headers, sheet.mapping);
  const r = obj(data);
  const common = {
    batchId: String(r.batch_id ?? batchId),
    fileName: sheet.fileName,
    sheetName: sheet.sheetName,
    totalRows: num(r.total_rows),
    validRows: num(r.valid_rows),
    warningRows: num(r.warning_rows),
    errorRows: num(r.error_rows),
    createRows: num(r.create_rows),
    skipRows: num(r.skip_rows),
    alreadyImported: r.already_imported === true,
    mappedColumns: columns.mapped,
    unmappedColumns: columns.unmapped,
    findings: findings(r.findings),
  };

  if (kind === "brs") {
    return {
      ok: true,
      data: {
        kind: "brs",
        ...common,
        updateRows: num(r.update_rows),
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

  const c = obj(r.categories);
  return {
    ok: true,
    data: {
      kind: "allocations",
      ...common,
      substituteRows: num(r.substitute_rows),
      categories: {
        existing: num(c.existing),
        new: num(c.new),
        substitutions: num(c.substitutions),
        overlaps: num(c.overlaps),
        unknownBrs: num(c.unknown_brs),
        vehiclesNotFound: num(c.vehicles_not_found),
        competenceErrors: num(c.competence_errors),
      },
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

/**
 * Grava as próximas `limit` linhas de um lote validado. A última parte fecha o
 * lote e traz o resultado; um lote interrompido continua de onde parou.
 */
export async function processFidelizationChunk(
  kind: ImportKind,
  batchId: string,
  limit: number,
): Promise<StepResult<{ done: boolean; remaining: number; outcome?: ImportOutcome }>> {
  const context = await resolveOrganization("fidelization.import");
  if (!context) return { ok: false, error: SESSION_LOST };
  const supabase = await createClient();

  const { data, error } = await supabase.rpc(PROCESS_RPC[kind], {
    p_organization_id: context.organization.organizationId,
    p_batch_id: batchId,
    p_limit: clampLimit(limit),
  });
  if (error) {
    return stepError(error, (e) =>
      toMessage(e, "A gravação parou nesta parte. O que já foi gravado continua gravado; confirme de novo para continuar."),
    );
  }

  const r = obj(data);
  if (r.done !== true) return { ok: true, data: { done: false, remaining: num(r.remaining) } };

  revalidatePath(MODULE_PATH);
  revalidatePath("/governanca/brs");
  return {
    ok: true,
    data: {
      done: true,
      remaining: 0,
      outcome: {
        created: num(r.created),
        updated: num(r.updated),
        substituted: num(r.substituted),
        skipped: num(r.skipped),
      },
    },
  };
}

/* ------------------------------------------ mapeamento e layouts (Etapa 15) */

export interface ImportFileColumns {
  /** Cabeçalhos do arquivo, na ordem da planilha. */
  headers: string[];
  /** Sugestão por nome: cabeçalho → campo, ou "" quando nenhum alias bate. */
  suggestion: Record<string, string>;
  rowCount: number;
}

export interface ImportLayout {
  id: string;
  name: string;
  /** Cabeçalho normalizado → campo ("" = ignorar). */
  mapping: Record<string, string>;
  updatedAt: string;
}

export async function listImportLayouts(kind: ImportKind): Promise<Result<ImportLayout[]>> {
  const context = await resolveOrganization("fidelization.import");
  if (!context) return { ok: false, error: SESSION_LOST };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("import_layouts")
    .select("id, name, mapping, updated_at")
    .eq("organization_id", context.organization.organizationId)
    .eq("kind", IMPORT_LAYOUT_KIND[kind])
    .order("name");
  if (error) return { ok: false, error: toMessage(error, "Não foi possível carregar os layouts salvos.") };
  return {
    ok: true,
    data: (data ?? []).map((l) => ({
      id: l.id,
      name: l.name,
      mapping: Object.fromEntries(
        Object.entries(obj(l.mapping)).map(([k, v]) => [k, typeof v === "string" ? v : ""]),
      ),
      updatedAt: l.updated_at,
    })),
  };
}

/** Salva (ou atualiza, pelo nome) a ligação atual como layout da organização. */
export async function saveImportLayout(
  kind: ImportKind,
  name: string,
  mapping: Record<string, string>,
): Promise<Result<{ id: string }>> {
  const context = await resolveOrganization("fidelization.import");
  if (!context) return { ok: false, error: SESSION_LOST };
  const normalized: Record<string, string> = {};
  for (const [header, field] of Object.entries(mapping)) {
    const key = normalizeHeader(header);
    if (key) normalized[key] = field;
  }
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("save_import_layout", {
    p_organization_id: context.organization.organizationId,
    p_kind: IMPORT_LAYOUT_KIND[kind],
    p_name: name,
    p_mapping: normalized,
  });
  if (error) return { ok: false, error: toMessage(error, "Não foi possível salvar o layout.") };
  return { ok: true, data: { id: String(data) } };
}

export async function deleteImportLayout(layoutId: string): Promise<Result> {
  const context = await resolveOrganization("fidelization.import");
  if (!context) return { ok: false, error: SESSION_LOST };
  const supabase = await createClient();
  const { error } = await supabase.rpc("delete_import_layout", {
    p_organization_id: context.organization.organizationId,
    p_layout_id: layoutId,
  });
  if (error) return { ok: false, error: toMessage(error, "Não foi possível excluir o layout.") };
  return { ok: true };
}
