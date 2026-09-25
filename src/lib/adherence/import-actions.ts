"use server";

import { revalidatePath } from "next/cache";
import { requireOrganization } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import type { CellValue } from "@/lib/admin/qlp";
import { rawRow } from "@/lib/import/sheet-core";
import type { StepResult } from "@/lib/import/client";
import { clampLimit, stepError } from "@/lib/import/server";
import type { Json } from "@/types/database.types";
import { cellToText, mapImportColumns, toIsoDate, type ImportField } from "./import-columns";

/**
 * Importação de bases de status diário (§54–§56).
 *
 * A action lê a planilha e mapeia colunas; tudo o mais acontece em duas
 * rotinas do banco: `stage_adherence_import` valida linha a linha e devolve a
 * prévia; `process_adherence_import` abre as solicitações — sempre PENDENTES —
 * e registra inconsistências para o que não entendeu. Nada aqui cria veículo,
 * obrigação ou execução, nada aprova, nada toca em perfil de acesso.
 *
 * Sem teto de linhas: a planilha é lida no navegador e chega em partes; o
 * banco valida e grava em partes, e a prévia é a mesma de um arquivo validado
 * de uma vez.
 */

const MODULE_PATH = "/checklist/aderencia";

export interface ImportFinding {
  rowNumber: number | null;
  level: string;
  field: string | null;
  code: string | null;
  message: string;
}

export interface ImportSampleRow {
  rowNumber: number;
  status: string;
  action: string;
  fleetCode: string | null;
  licensePlate: string | null;
  operationalDate: string | null;
  context: string | null;
  statusRaw: string | null;
  reasonCode: string | null;
  currentStatus: string | null;
}

export interface AdherenceImportPreview {
  batchId: string;
  fileName: string;
  sheetName: string;
  totalRows: number;
  validRows: number;
  warningRows: number;
  errorRows: number;
  createRows: number;
  alreadyImported: boolean;
  mappedColumns: { header: string; field: ImportField; label: string }[];
  unmappedColumns: string[];
  findings: ImportFinding[];
  sample: ImportSampleRow[];
}

type Raw = Record<string, unknown>;
const obj = (v: unknown): Raw => (v && typeof v === "object" && !Array.isArray(v) ? (v as Raw) : {});
const arr = (v: unknown): Raw[] => (Array.isArray(v) ? (v as Raw[]) : []);
const num = (v: unknown): number => (typeof v === "number" ? v : v == null ? 0 : Number(v));
const strOrNull = (v: unknown): string | null => (v == null ? null : String(v));

function toMessage(error: { code?: string; message?: string }, fallback: string): string {
  const message = error.message ?? "";
  if (message && /^[A-ZÀ-Ý]/.test(message.trim())) return message;
  if (error.code === "42501") return "Você não possui permissão para importar aderência.";
  return fallback;
}

/** Uma parte do arquivo, como o navegador a leu. */
export interface AdherenceImportChunkInput {
  batchId: string | null;
  file: { name: string; size: number; hash: string };
  sheetName: string;
  headers: string[];
  rows: CellValue[][];
  /** Número, na planilha, da primeira linha desta parte (a linha 1 é o cabeçalho). */
  firstRowNumber: number;
}

/** §54 — grava uma parte do arquivo como linhas pendentes; a primeira abre o lote. */
export async function stageAdherenceChunk(input: AdherenceImportChunkInput): Promise<StepResult<{ batchId: string }>> {
  const { organization } = await requireOrganization("adherence.import");
  const columns = mapImportColumns(input.headers);
  if (columns.missing.length) {
    return { ok: false, error: `Colunas obrigatórias não encontradas: ${columns.missing.join(", ")}.` };
  }

  const rows: Json[] = input.rows.map((values, index) => {
    const mapped: Partial<Record<ImportField, string | null>> = {};
    input.headers.forEach((_, columnIndex) => {
      const value = values[columnIndex] ?? null;
      const field = columns.mapping[columnIndex];
      if (field) mapped[field] = field === "operational_date" ? toIsoDate(value) : cellToText(value);
    });
    return {
      row_number: input.firstRowNumber + index,
      raw: rawRow(input.headers, values),
      fleet_code: mapped.fleet_code ?? null,
      license_plate: mapped.license_plate ?? null,
      operational_date: mapped.operational_date ?? null,
      context: mapped.context ?? null,
      status: mapped.status ?? null,
      justification: mapped.justification ?? null,
      evidence_reference: mapped.evidence_reference ?? null,
    };
  });

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("stage_adherence_import", {
    p_organization_id: organization.organizationId,
    p_payload: {
      phase: "load",
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

/** Valida as próximas `limit` linhas pendentes, na ordem do arquivo. */
export async function validateAdherenceChunk(batchId: string, limit: number): Promise<StepResult<{ pending: number }>> {
  const { organization } = await requireOrganization("adherence.import");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("stage_adherence_import", {
    p_organization_id: organization.organizationId,
    p_payload: { phase: "validate", batch_id: batchId, limit: clampLimit(limit) },
  });
  if (error) return stepError(error, (e) => toMessage(e, "Não foi possível validar a importação."));
  return { ok: true, data: { pending: num(obj(data).pending) } };
}

/** §55 — fecha a validação e devolve a prévia. */
export async function finalizeAdherenceImport(
  batchId: string,
  sheet: { fileName: string; sheetName: string; headers: string[] },
): Promise<StepResult<AdherenceImportPreview>> {
  const { organization } = await requireOrganization("adherence.import");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("stage_adherence_import", {
    p_organization_id: organization.organizationId,
    p_payload: { phase: "finalize", batch_id: batchId },
  });
  if (error) return stepError(error, (e) => toMessage(e, "Não foi possível validar a importação."));

  const columns = mapImportColumns(sheet.headers);
  const r = obj(data);
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
      createRows: num(r.create_rows),
      alreadyImported: r.already_imported === true,
      mappedColumns: columns.mapped,
      unmappedColumns: columns.unmapped,
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
          action: String(s.action ?? ""),
          fleetCode: strOrNull(d.fleet_code),
          licensePlate: strOrNull(d.license_plate),
          operationalDate: strOrNull(d.operational_date),
          context: strOrNull(d.context),
          statusRaw: strOrNull(d.status_raw),
          reasonCode: strOrNull(d.reason_code),
          currentStatus: strOrNull(d.current_status),
        };
      }),
    },
  };
}

export interface AdherenceImportOutcome {
  requestsCreated: number;
  skipped: number;
  inconsistencies: number;
}

/**
 * §56 — abre as solicitações das próximas `limit` linhas válidas. A última
 * parte registra as inconsistências e fecha o lote; um lote interrompido
 * continua de onde parou.
 */
export async function processAdherenceChunk(
  batchId: string,
  limit: number,
): Promise<StepResult<{ done: boolean; remaining: number; outcome?: AdherenceImportOutcome }>> {
  const { organization } = await requireOrganization("adherence.import");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("process_adherence_import", {
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
        requestsCreated: num(r.requests_created),
        skipped: num(r.skipped),
        inconsistencies: num(r.inconsistencies),
      },
    },
  };
}
