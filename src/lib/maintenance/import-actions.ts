"use server";

import { revalidatePath } from "next/cache";
import { requireOrganization } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import type { CellValue } from "@/lib/admin/qlp";
import { rawRow } from "@/lib/import/sheet-core";
import type { StepResult } from "@/lib/import/client";
import { clampLimit, stepError } from "@/lib/import/server";
import type { Json } from "@/types/database.types";
import { IMPORT_COLUMNS, importCell, mapMaintenanceColumns, type MaintenanceImportKind } from "./import-columns";

/**
 * Importações da Manutenção (Etapa 16).
 *
 * A planilha é lida no navegador e chega em partes, sem teto de linhas. Duas
 * rotinas do banco fazem o resto: `stage_maintenance_import` grava as linhas,
 * valida em partes e devolve a prévia (novas, atualizações, sem mudança,
 * conflitos, duplicadas no arquivo, erros e veículos/serviços/fornecedores
 * desconhecidos); `process_maintenance_import` grava em partes, idempotente
 * pela chave de importação. A importação nunca cria veículo nem operação,
 * nunca toca em Perfis & Permissões, nunca reescreve o histórico de status de
 * uma manutenção alterada por usuário e nunca apaga vínculo com apontamento.
 */

const MODULE_PATH = "/frota/manutencao";

type Raw = Record<string, unknown>;
const obj = (v: unknown): Raw => (v && typeof v === "object" && !Array.isArray(v) ? (v as Raw) : {});
const arr = (v: unknown): Raw[] => (Array.isArray(v) ? (v as Raw[]) : []);
const num = (v: unknown): number => (typeof v === "number" ? v : v == null ? 0 : Number(v));
const strOrNull = (v: unknown): string | null => (v == null ? null : String(v));

type StageRpc = (
  fn: string,
  args: Record<string, Json>,
) => Promise<{ data: unknown; error: { code?: string; message?: string } | null }>;

async function rpc(fn: string, args: Record<string, Json>) {
  const supabase = await createClient();
  return (supabase.rpc as unknown as StageRpc)(fn, args);
}

function toMessage(error: { code?: string; message?: string }, fallback: string): string {
  const message = error.message ?? "";
  if (message && /^[A-ZÀ-Ý]/.test(message.trim())) return message;
  if (error.code === "42501") return "Você não possui permissão para importar manutenção.";
  return fallback;
}

export interface MaintenanceImportFinding {
  rowNumber: number | null;
  level: string;
  field: string | null;
  code: string | null;
  message: string;
}

export interface MaintenanceImportPreview {
  batchId: string;
  kind: MaintenanceImportKind;
  fileName: string;
  sheetName: string;
  totalRows: number;
  validRows: number;
  warningRows: number;
  errorRows: number;
  createRows: number;
  updateRows: number;
  unchangedRows: number;
  conflictRows: number;
  duplicateRows: number;
  maintenances: number;
  /** Existentes sem operação que recebem a operação/cidade da planilha. */
  contextFillRows: number;
  /** Abertas reconhecidas apesar de a planilha ter mudado a OS ou a data. */
  reidentifiedRows: number;
  alreadyImported: boolean;
  /** Fornecedores da planilha sem correspondência no catálogo (nome e linhas). */
  unknownSuppliers: { name: string; rows: number }[];
  categories: Record<string, number>;
  mappedColumns: { header: string; field: string; label: string }[];
  unmappedColumns: string[];
  findings: MaintenanceImportFinding[];
  sample: { rowNumber: number; status: string; action: string; data: Record<string, unknown> }[];
}

export interface MaintenanceImportChunkInput {
  batchId: string | null;
  file: { name: string; size: number; hash: string };
  sheetName: string;
  headers: string[];
  rows: CellValue[][];
  firstRowNumber: number;
}

/** Grava uma parte do arquivo como linhas pendentes; a primeira abre o lote. */
export async function stageMaintenanceChunk(
  kind: MaintenanceImportKind,
  input: MaintenanceImportChunkInput,
): Promise<StepResult<{ batchId: string }>> {
  const { organization } = await requireOrganization("maintenance.import");
  if (!(kind in IMPORT_COLUMNS)) return { ok: false, error: "Tipo de importação desconhecido." };
  const columns = mapMaintenanceColumns(kind, input.headers);
  if (columns.missing.length) {
    return { ok: false, error: `Colunas obrigatórias não encontradas: ${columns.missing.join(", ")}.` };
  }
  const byField = new Map(IMPORT_COLUMNS[kind].map((c) => [c.field, c]));

  const rows: Json[] = input.rows.map((values, index) => {
    const mapped: Record<string, string | null> = {};
    input.headers.forEach((_, columnIndex) => {
      const field = columns.mapping[columnIndex];
      if (field) mapped[field] = importCell(byField.get(field), values[columnIndex] ?? null);
    });
    return { row_number: input.firstRowNumber + index, raw: rawRow(input.headers, values), ...mapped };
  });

  const { data, error } = await rpc("stage_maintenance_import", {
    p_organization_id: organization.organizationId,
    p_payload: {
      phase: "load",
      kind,
      batch_id: input.batchId,
      file_name: input.file.name,
      file_hash: input.file.hash,
      file_size: input.file.size,
      column_mapping: Object.fromEntries(columns.mapped.map((m) => [m.header, m.field])),
      rows,
    },
  });
  if (error) return stepError(error, (e) => toMessage(e, "Não foi possível enviar as linhas do arquivo."));
  return { ok: true, data: { batchId: String(obj(data).batch_id ?? "") } };
}

export async function validateMaintenanceChunk(batchId: string, limit: number): Promise<StepResult<{ pending: number }>> {
  const { organization } = await requireOrganization("maintenance.import");
  const { data, error } = await rpc("stage_maintenance_import", {
    p_organization_id: organization.organizationId,
    p_payload: { phase: "validate", batch_id: batchId, limit: clampLimit(limit) },
  });
  if (error) return stepError(error, (e) => toMessage(e, "Não foi possível validar a importação."));
  return { ok: true, data: { pending: num(obj(data).pending) } };
}

export async function finalizeMaintenanceImport(
  kind: MaintenanceImportKind,
  batchId: string,
  sheet: { fileName: string; sheetName: string; headers: string[] },
): Promise<StepResult<MaintenanceImportPreview>> {
  const { organization } = await requireOrganization("maintenance.import");
  const { data, error } = await rpc("stage_maintenance_import", {
    p_organization_id: organization.organizationId,
    p_payload: { phase: "finalize", batch_id: batchId },
  });
  if (error) return stepError(error, (e) => toMessage(e, "Não foi possível validar a importação."));

  const columns = mapMaintenanceColumns(kind, sheet.headers);
  const r = obj(data);
  const summary = obj(r.summary);
  const categories: Record<string, number> = {};
  for (const [k, v] of Object.entries(obj(r.categories))) categories[k] = num(v);
  return {
    ok: true,
    data: {
      batchId: String(r.batch_id ?? batchId),
      kind,
      fileName: sheet.fileName,
      sheetName: sheet.sheetName,
      totalRows: num(r.total_rows),
      validRows: num(r.valid_rows),
      warningRows: num(r.warning_rows),
      errorRows: num(r.error_rows),
      createRows: num(summary.create_rows),
      updateRows: num(summary.update_rows),
      unchangedRows: num(summary.unchanged_rows),
      conflictRows: num(summary.conflict_rows),
      duplicateRows: num(summary.duplicate_rows),
      maintenances: num(summary.maintenances),
      contextFillRows: num(summary.context_fill_rows),
      reidentifiedRows: num(summary.reidentified_rows),
      alreadyImported: summary.already_imported === true,
      unknownSuppliers: arr(summary.unknown_suppliers).map((u) => ({ name: String(u.name ?? ""), rows: num(u.rows) })),
      categories,
      mappedColumns: columns.mapped,
      unmappedColumns: columns.unmapped,
      findings: arr(r.findings).map((f) => ({
        rowNumber: f.row_number == null ? null : num(f.row_number),
        level: String(f.level ?? ""),
        field: strOrNull(f.field),
        code: strOrNull(f.code),
        message: String(f.message ?? ""),
      })),
      sample: arr(r.sample).map((s) => ({
        rowNumber: num(s.row_number),
        status: String(s.status ?? ""),
        action: String(s.action ?? ""),
        data: obj(s.data),
      })),
    },
  };
}

export interface MaintenanceImportOutcome {
  createdRows: number;
  updatedRows: number;
  skippedRows: number;
  maintenancesCreated: number;
}

/** Grava as próximas `limit` linhas válidas; a última parte fecha o lote. */
export async function processMaintenanceChunk(
  batchId: string,
  limit: number,
): Promise<StepResult<{ done: boolean; remaining: number; outcome?: MaintenanceImportOutcome }>> {
  const { organization } = await requireOrganization("maintenance.import");
  const { data, error } = await rpc("process_maintenance_import", {
    p_organization_id: organization.organizationId,
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
  return {
    ok: true,
    data: {
      done: true,
      remaining: 0,
      outcome: {
        createdRows: num(r.created_rows),
        updatedRows: num(r.updated_rows),
        skippedRows: num(r.skipped_rows),
        maintenancesCreated: num(obj(r.summary).maintenances_created),
      },
    },
  };
}

/** Descarta um lote que não será gravado (só o do próprio autor, ainda aberto). */
export async function cancelMaintenanceImport(batchId: string): Promise<StepResult<undefined>> {
  const { organization } = await requireOrganization("maintenance.import");
  const { error } = await rpc("cancel_maintenance_import", {
    p_organization_id: organization.organizationId,
    p_batch_id: batchId,
  });
  if (error) return { ok: false, error: toMessage(error, "Não foi possível descartar a importação.") };
  revalidatePath(MODULE_PATH);
  return { ok: true };
}
