"use server";

import { revalidatePath } from "next/cache";
import { resolveOrganization } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import type { CellValue } from "@/lib/admin/qlp";
import { rawRow } from "@/lib/import/sheet-core";
import type { StepResult } from "@/lib/import/client";
import { clampLimit, stepError } from "@/lib/import/server";
import type { Json } from "@/types/database.types";
import {
  BRANCH_IMPORT_COLUMNS, BRANCH_REQUIRED, cellToText, mapColumns,
  type BranchImportField,
} from "./import-columns";

/**
 * Importação de Filiais pela tela (Etapa 09, §58–§62).
 *
 * A action só lê a planilha e mapeia as colunas. Tudo o mais é do banco:
 * `stage_branch_import` valida cada linha e devolve a prévia com atual ×
 * recebido; `process_branch_import` grava o que a prévia prometeu, e só para
 * quem a validou. Nada aqui cria filial, vincula operação ou mexe em perfil de
 * acesso por conta própria — a §62 é o contrato daquelas duas rotinas.
 *
 * Sem teto de linhas: a planilha é lida no navegador e chega em partes; o
 * banco valida e grava em partes, e a prévia é a mesma de um arquivo validado
 * de uma vez.
 */

const MODULE_PATH = "/estrutura/filiais";

const SESSION_LOST =
  "Sua sessão expirou ou o acesso mudou. Recarregue a página e tente de novo.";

export interface BranchImportIssue {
  level: "error" | "warning";
  field: string | null;
  code: string | null;
  message: string;
}

export interface BranchImportChange {
  field: string;
  label: string;
  current: string | null;
  received: string | null;
}

export interface BranchImportOperation {
  id: string;
  code: string | null;
  name: string;
  /** `add` vira vínculo novo; `kept` já está vinculada e fica como está. */
  link: "add" | "kept";
}

export interface BranchImportRow {
  rowNumber: number;
  status: "valid" | "warning" | "error";
  action: "create" | "update" | "skip";
  code: string | null;
  name: string | null;
  currentName: string | null;
  legalName: string | null;
  documentNumber: string | null;
  statusValue: string | null;
  currentStatus: string | null;
  postalCode: string | null;
  stateUf: string | null;
  cityName: string | null;
  street: string | null;
  streetNumber: string | null;
  complement: string | null;
  district: string | null;
  notes: string | null;
  operations: BranchImportOperation[];
  /** Vínculos atuais que não vieram no arquivo — mantidos, nunca removidos. */
  linksKept: string[];
  changes: BranchImportChange[];
  issues: BranchImportIssue[];
}

export interface BranchImportPreview {
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
  rows: BranchImportRow[];
}

export interface BranchImportOutcome {
  created: number;
  updated: number;
  linksAdded: number;
  skipped: number;
  failed: number;
  errors: { rowNumber: number; message: string }[];
}

type Raw = Record<string, unknown>;
const obj = (v: unknown): Raw => (v && typeof v === "object" && !Array.isArray(v) ? (v as Raw) : {});
const arr = (v: unknown): Raw[] => (Array.isArray(v) ? (v as Raw[]) : []);
const num = (v: unknown): number => (typeof v === "number" ? v : v == null ? 0 : Number(v));
const str = (v: unknown): string | null => (v == null || v === "" ? null : String(v));

function toMessage(error: { code?: string; message?: string }, fallback: string): string {
  const message = error.message ?? "";
  if (message && /^[A-ZÀ-Ý]/.test(message.trim()) && !message.includes("violates")) return message;
  if (error.code === "42501") return "Você não possui permissão para importar filiais.";
  return fallback;
}

/**
 * Um número inteiro numa célula de XLSX perdeu os zeros à esquerda no Excel.
 * No CNPJ e no CEP o tamanho é fixo, então completá-los é recuperar o que o
 * Excel apagou, não adivinhar. No código não há tamanho fixo — ali a linha só
 * ganha um aviso (`code_numeric`), e a pessoa confere.
 */
function padNumeric(value: unknown, width: number): string | null {
  if (typeof value === "number" && Number.isInteger(value) && value >= 0) {
    return String(value).padStart(width, "0");
  }
  return cellToText(value);
}

function mapBranchImportRow(row: Raw): BranchImportRow {
  const d = obj(row.data);
  return {
    rowNumber: num(row.row_number),
    status: (row.status === "valid" || row.status === "warning" ? row.status : "error") as BranchImportRow["status"],
    action: (row.action === "create" || row.action === "update" ? row.action : "skip") as BranchImportRow["action"],
    code: str(d.code),
    name: str(d.name),
    currentName: str(d.current_name),
    legalName: str(d.legal_name),
    documentNumber: str(d.document_number),
    statusValue: str(d.status),
    currentStatus: str(d.current_status),
    postalCode: str(d.postal_code),
    stateUf: str(d.state_uf),
    cityName: str(d.city_name),
    street: str(d.street),
    streetNumber: str(d.street_number),
    complement: str(d.complement),
    district: str(d.district),
    notes: str(d.notes),
    operations: arr(d.operations).map((o) => ({
      id: String(o.id ?? ""),
      code: str(o.code),
      name: String(o.name ?? ""),
      link: o.link === "kept" ? "kept" : "add",
    })),
    linksKept: Array.isArray(d.links_kept_outside_file) ? (d.links_kept_outside_file as unknown[]).map(String) : [],
    changes: arr(d.changes).map((c) => ({
      field: String(c.field ?? ""),
      label: String(c.label ?? ""),
      current: str(c.current),
      received: str(c.received),
    })),
    issues: arr(row.issues).map((i) => ({
      level: i.level === "error" ? "error" : "warning",
      field: str(i.field),
      code: str(i.code),
      message: String(i.message ?? ""),
    })),
  };
}

/** Uma parte do arquivo, como o navegador a leu. */
export interface BranchImportChunkInput {
  batchId: string | null;
  file: { name: string; size: number; hash: string };
  sheetName: string;
  headers: string[];
  rows: CellValue[][];
  /** Número, na planilha, da primeira linha desta parte (a linha 1 é o cabeçalho). */
  firstRowNumber: number;
}

/** §58 — grava uma parte do arquivo como linhas pendentes; a primeira abre o lote. */
export async function stageBranchChunk(input: BranchImportChunkInput): Promise<StepResult<{ batchId: string }>> {
  const context = await resolveOrganization("branches.import");
  if (!context) return { ok: false, error: SESSION_LOST };

  const columns = mapColumns<BranchImportField>(input.headers, BRANCH_IMPORT_COLUMNS, BRANCH_REQUIRED);
  if (columns.missing.length) {
    return { ok: false, error: `Colunas obrigatórias não encontradas: ${columns.missing.join(", ")}.` };
  }

  const rows: Json[] = input.rows.map((values, index) => {
    const mapped: Partial<Record<BranchImportField, string | null>> = {};
    let codeNumeric = false;
    input.headers.forEach((_, columnIndex) => {
      const value = values[columnIndex] ?? null;
      const field = columns.mapping[columnIndex];
      if (!field) return;
      if (field === "document_number") mapped[field] = padNumeric(value, 14);
      else if (field === "postal_code") mapped[field] = padNumeric(value, 8);
      else {
        if (field === "code" && typeof value === "number") codeNumeric = true;
        mapped[field] = cellToText(value);
      }
    });
    return {
      row_number: input.firstRowNumber + index,
      raw: rawRow(input.headers, values),
      code: mapped.code ?? null,
      code_numeric: codeNumeric,
      name: mapped.name ?? null,
      legal_name: mapped.legal_name ?? null,
      document_number: mapped.document_number ?? null,
      status: mapped.status ?? null,
      postal_code: mapped.postal_code ?? null,
      state: mapped.state ?? null,
      city: mapped.city ?? null,
      street: mapped.street ?? null,
      street_number: mapped.street_number ?? null,
      complement: mapped.complement ?? null,
      district: mapped.district ?? null,
      operations: mapped.operations ?? null,
      notes: mapped.notes ?? null,
    };
  });

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("stage_branch_import", {
    p_organization_id: context.organization.organizationId,
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
export async function validateBranchChunk(batchId: string, limit: number): Promise<StepResult<{ pending: number }>> {
  const context = await resolveOrganization("branches.import");
  if (!context) return { ok: false, error: SESSION_LOST };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("stage_branch_import", {
    p_organization_id: context.organization.organizationId,
    p_payload: { phase: "validate", batch_id: batchId, limit: clampLimit(limit) },
  });
  if (error) return stepError(error, (e) => toMessage(e, "Não foi possível validar a importação."));
  return { ok: true, data: { pending: num(obj(data).pending) } };
}

/** §59–§60 — fecha a validação e devolve a prévia com atual × recebido. */
export async function finalizeBranchImport(
  batchId: string,
  sheet: { fileName: string; sheetName: string; headers: string[] },
): Promise<StepResult<BranchImportPreview>> {
  const context = await resolveOrganization("branches.import");
  if (!context) return { ok: false, error: SESSION_LOST };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("stage_branch_import", {
    p_organization_id: context.organization.organizationId,
    p_payload: { phase: "finalize", batch_id: batchId },
  });
  if (error) return stepError(error, (e) => toMessage(e, "Não foi possível validar a importação."));

  const columns = mapColumns<BranchImportField>(sheet.headers, BRANCH_IMPORT_COLUMNS, BRANCH_REQUIRED);
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
      updateRows: num(r.update_rows),
      skipRows: num(r.skip_rows),
      alreadyImported: r.already_imported === true,
      mappedColumns: columns.mapped,
      unmappedColumns: columns.unmapped,
      rows: arr(r.rows).map(mapBranchImportRow),
    },
  };
}

/**
 * Grava as próximas `limit` linhas de um lote validado. Só a própria pessoa
 * que validou pode confirmar; um lote interrompido continua de onde parou.
 */
export async function processBranchChunk(
  batchId: string,
  limit: number,
): Promise<StepResult<{ done: boolean; remaining: number; outcome?: BranchImportOutcome }>> {
  const context = await resolveOrganization("branches.import");
  if (!context) return { ok: false, error: SESSION_LOST };
  const supabase = await createClient();

  const { data, error } = await supabase.rpc("process_branch_import", {
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
  return {
    ok: true,
    data: {
      done: true,
      remaining: 0,
      outcome: {
        created: num(r.created),
        updated: num(r.updated),
        linksAdded: num(r.links_added),
        skipped: num(r.skipped),
        failed: num(r.failed),
        errors: arr(r.errors).map((e) => ({ rowNumber: num(e.row_number), message: String(e.message ?? "") })),
      },
    },
  };
}
