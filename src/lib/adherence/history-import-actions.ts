"use server";

import { revalidatePath } from "next/cache";
import { requireOrganization } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import type { CellValue } from "@/lib/admin/qlp";
import { rawRow } from "@/lib/import/sheet-core";
import type { StepResult } from "@/lib/import/client";
import { clampLimit, stepError } from "@/lib/import/server";
import type { Json } from "@/types/database.types";
import {
  buildHistoryRow, mapHistoryColumns, type ChecklistHistoryLayout, type HistoryColumnMapping,
} from "./history-import-columns";
import { parseChecklistHistoryLayout } from "./history-layout";

/**
 * Importação do histórico de Check List — as actions.
 *
 * A action lê a parte do arquivo que o navegador enviou, mapeia as colunas
 * pelo catálogo oficial de perguntas e entrega linhas normalizadas às rotinas
 * do banco: `stage_checklist_history_import` valida e devolve a prévia;
 * `process_checklist_history_import` gera as obrigações do período e grava
 * (execuções oficiais, expurgos ou solicitações). Nada aqui cria veículo,
 * colaborador ou pergunta; nada aprova "Fez" sem execução.
 */

const MODULE_PATH = "/checklist/aderencia";

type Rpc = (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { code?: string; message: string } | null }>;
type Raw = Record<string, unknown>;
const obj = (v: unknown): Raw => (v && typeof v === "object" && !Array.isArray(v) ? (v as Raw) : {});
const arr = (v: unknown): Raw[] => (Array.isArray(v) ? (v as Raw[]) : []);
const num = (v: unknown): number => (typeof v === "number" ? v : v == null ? 0 : Number(v) || 0);
const strOrNull = (v: unknown): string | null => (v == null ? null : String(v));

function toMessage(error: { code?: string; message?: string }, fallback: string): string {
  const message = error.message ?? "";
  if (message && /^[A-ZÀ-Ý]/.test(message.trim())) return message;
  if (error.code === "42501") return "Você não possui permissão para importar aderência.";
  return fallback;
}

export interface HistoryImportFinding {
  rowNumber: number | null;
  level: string;
  field: string | null;
  code: string | null;
  message: string;
}

export interface HistoryImportSampleRow {
  rowNumber: number;
  status: string;
  kind: string | null;
  licensePlate: string | null;
  operationalDate: string | null;
  context: string | null;
  statusRaw: string | null;
  employeeCode: string | null;
  employeeName: string | null;
  answersCount: number;
  code: string | null;
}

export interface HistoryImportPreview {
  batchId: string;
  fileName: string;
  sheetName: string;
  totalRows: number;
  validRows: number;
  warningRows: number;
  errorRows: number;
  executions: number;
  overrides: number;
  requests: number;
  noChange: number;
  answers: number;
  vehicles: number;
  dateFrom: string | null;
  dateTo: string | null;
  byStatus: Record<string, number>;
  unknownEmployees: { code: string | null; name: string | null; rows: number }[];
  unknownPlates: string[];
  alreadyImported: boolean;
  applyExclusions: boolean;
  canOverride: boolean;
  columns: Pick<HistoryColumnMapping, "mapped" | "unmapped" | "duplicated" | "unansweredQuestions">;
  findings: HistoryImportFinding[];
  sample: HistoryImportSampleRow[];
}

export interface HistoryImportOutcome {
  executionsCreated: number;
  answersCreated: number;
  nonConforming: number;
  overridesApplied: number;
  requestsCreated: number;
  noChange: number;
  skipped: number;
  failed: number;
  inconsistencies: number;
  monthsGenerated: number;
  obligationsCreated: number;
}

export interface HistoryImportOptions {
  /** Aplicar os expurgos como exceção autorizada (exige `adherence.override`). */
  applyExclusions: boolean;
}

/** O catálogo publicado, para o modelo e para o mapeamento das colunas. */
export async function getChecklistHistoryLayoutAction(): Promise<StepResult<ChecklistHistoryLayout>> {
  const { organization } = await requireOrganization("adherence.import");
  const supabase = await createClient();
  const { data, error } = await (supabase.rpc as unknown as Rpc)("checklist_history_import_layout", {
    p_organization_id: organization.organizationId,
  });
  if (error) return stepError(error, (e) => toMessage(e, "Não foi possível carregar o catálogo do Check List."));
  return { ok: true, data: parseChecklistHistoryLayout(data) };
}

export interface HistoryChunkInput {
  batchId: string | null;
  file: { name: string; size: number; hash: string };
  sheetName: string;
  headers: string[];
  rows: CellValue[][];
  firstRowNumber: number;
  layout: ChecklistHistoryLayout;
  options: HistoryImportOptions;
}

/** Grava uma parte do arquivo como linhas pendentes; a primeira abre o lote. */
export async function stageHistoryChunk(input: HistoryChunkInput): Promise<StepResult<{ batchId: string }>> {
  const { organization } = await requireOrganization("adherence.import");
  const columns = mapHistoryColumns(input.headers, input.layout);
  if (columns.missing.length) {
    return { ok: false, error: `Colunas obrigatórias não encontradas: ${columns.missing.join(", ")}.` };
  }
  if (columns.duplicated.length) {
    return { ok: false, error: `Cabeçalhos repetidos ou ambíguos: ${columns.duplicated.join(", ")}. Use os cabeçalhos da planilha modelo.` };
  }

  const rows = input.rows.map((values, index) =>
    buildHistoryRow(input.firstRowNumber + index, input.headers, values, columns, input.layout, rawRow(input.headers, values)),
  ) as unknown as Json[];

  const supabase = await createClient();
  const { data, error } = await (supabase.rpc as unknown as Rpc)("stage_checklist_history_import", {
    p_organization_id: organization.organizationId,
    p_payload: {
      phase: "load",
      batch_id: input.batchId,
      file_name: input.file.name,
      file_hash: input.file.hash,
      file_size: input.file.size,
      apply_exclusions: input.options.applyExclusions,
      version_id: input.layout.version.id,
      column_mapping: Object.fromEntries(columns.mapped.map((m) => [m.header, m.label])),
      rows,
    },
  });
  if (error) return stepError(error, (e) => toMessage(e, "Não foi possível enviar as linhas do arquivo."));
  return { ok: true, data: { batchId: String(obj(data).batch_id ?? "") } };
}

export async function validateHistoryChunk(batchId: string, limit: number): Promise<StepResult<{ pending: number }>> {
  const { organization } = await requireOrganization("adherence.import");
  const supabase = await createClient();
  const { data, error } = await (supabase.rpc as unknown as Rpc)("stage_checklist_history_import", {
    p_organization_id: organization.organizationId,
    p_payload: { phase: "validate", batch_id: batchId, limit: clampLimit(limit) },
  });
  if (error) return stepError(error, (e) => toMessage(e, "Não foi possível validar a importação."));
  return { ok: true, data: { pending: num(obj(data).pending) } };
}

export async function finalizeHistoryImport(
  batchId: string,
  sheet: { fileName: string; sheetName: string; headers: string[] },
  layout: ChecklistHistoryLayout,
): Promise<StepResult<HistoryImportPreview>> {
  const { organization } = await requireOrganization("adherence.import");
  const supabase = await createClient();
  const { data, error } = await (supabase.rpc as unknown as Rpc)("stage_checklist_history_import", {
    p_organization_id: organization.organizationId,
    p_payload: { phase: "finalize", batch_id: batchId },
  });
  if (error) return stepError(error, (e) => toMessage(e, "Não foi possível fechar a prévia da importação."));

  const columns = mapHistoryColumns(sheet.headers, layout);
  const r = obj(data);
  const byStatus: Record<string, number> = {};
  for (const [k, v] of Object.entries(obj(r.by_status))) byStatus[k] = num(v);
  return {
    ok: true,
    data: {
      batchId: String(r.batch_id ?? batchId),
      fileName: sheet.fileName,
      sheetName: sheet.sheetName,
      totalRows: num(r.total_rows),
      validRows: num(r.valid_rows),
      warningRows: num(r.warning_rows),
      errorRows: num(r.error_rows),
      executions: num(r.executions),
      overrides: num(r.overrides),
      requests: num(r.requests),
      noChange: num(r.no_change),
      answers: num(r.answers),
      vehicles: num(r.vehicles),
      dateFrom: strOrNull(r.date_from),
      dateTo: strOrNull(r.date_to),
      byStatus,
      unknownEmployees: arr(r.unknown_employees).map((u) => ({ code: strOrNull(u.code), name: strOrNull(u.name), rows: num(u.rows) })),
      unknownPlates: arr(r.unknown_plates).map((p) => String(p)),
      alreadyImported: r.already_imported === true,
      applyExclusions: r.apply_exclusions === true,
      canOverride: r.can_override === true,
      columns: { mapped: columns.mapped, unmapped: columns.unmapped, duplicated: columns.duplicated, unansweredQuestions: columns.unansweredQuestions },
      findings: arr(r.findings).map((f) => ({
        rowNumber: f.row_number == null ? null : num(f.row_number),
        level: String(f.level ?? ""),
        field: strOrNull(f.field),
        code: strOrNull(f.code),
        message: String(f.message ?? ""),
      })),
      sample: arr(r.sample).map((s) => {
        const d = obj(s.data);
        return {
          rowNumber: num(s.row_number),
          status: String(s.status ?? ""),
          kind: strOrNull(d.kind),
          licensePlate: strOrNull(d.license_plate),
          operationalDate: strOrNull(d.operational_date),
          context: strOrNull(d.context),
          statusRaw: strOrNull(d.status_raw),
          employeeCode: strOrNull(d.employee_code),
          employeeName: strOrNull(d.employee_name),
          answersCount: num(d.answers_count),
          code: strOrNull(d.code),
        };
      }),
    },
  };
}

/**
 * Grava as próximas `limit` linhas. As primeiras chamadas geram as obrigações
 * do período, mês a mês; depois vêm as execuções, os expurgos e as
 * solicitações. Um lote interrompido continua de onde parou.
 */
export async function processHistoryChunk(
  batchId: string,
  limit: number,
): Promise<StepResult<{ done: boolean; remaining: number; outcome?: HistoryImportOutcome; phase?: string; month?: string }>> {
  const { organization } = await requireOrganization("adherence.import");
  const supabase = await createClient();
  const { data, error } = await (supabase.rpc as unknown as Rpc)("process_checklist_history_import", {
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
  if (r.done !== true) {
    return { ok: true, data: { done: false, remaining: num(r.remaining), phase: strOrNull(r.phase) ?? undefined, month: strOrNull(r.month) ?? undefined } };
  }
  revalidatePath(MODULE_PATH);
  revalidatePath("/checklist/planos-acao");
  return {
    ok: true,
    data: {
      done: true,
      remaining: 0,
      outcome: {
        executionsCreated: num(r.executions_created),
        answersCreated: num(r.answers_created),
        nonConforming: num(r.non_conforming),
        overridesApplied: num(r.overrides_applied),
        requestsCreated: num(r.requests_created),
        noChange: num(r.no_change),
        skipped: num(r.skipped),
        failed: num(r.failed),
        inconsistencies: num(r.inconsistencies),
        monthsGenerated: num(r.months_generated),
        obligationsCreated: num(r.obligations_created),
      },
    },
  };
}
