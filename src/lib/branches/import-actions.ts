"use server";

import { createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import { resolveOrganization } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { parseSpreadsheet } from "@/lib/admin/spreadsheet";
import type { Json } from "@/types/database.types";
import type { Result } from "./actions";
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
 */

const MODULE_PATH = "/estrutura/filiais";
const MAX_ROWS = 5000;
const MAX_FILE_BYTES = 10 * 1024 * 1024;

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

/** §58–§60 — envia o arquivo de filiais para validação e devolve a prévia. */
export async function uploadBranchImport(formData: FormData): Promise<Result<BranchImportPreview>> {
  const context = await resolveOrganization("branches.import");
  if (!context) return { ok: false, error: SESSION_LOST };

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

  const columns = mapColumns<BranchImportField>(sheet.headers, BRANCH_IMPORT_COLUMNS, BRANCH_REQUIRED);
  if (columns.missing.length) {
    return { ok: false, error: `Colunas obrigatórias não encontradas: ${columns.missing.join(", ")}.` };
  }

  const rows: Json[] = sheet.rows.map((values, index) => {
    const raw: Record<string, Json> = {};
    const mapped: Partial<Record<BranchImportField, string | null>> = {};
    let codeNumeric = false;
    sheet.headers.forEach((header, columnIndex) => {
      const value = values[columnIndex] ?? null;
      raw[header || `col_${columnIndex + 1}`] = value instanceof Date ? value.toISOString() : (value as Json);
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
      row_number: index + 2,
      raw,
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
      rows: arr(r.rows).map(mapBranchImportRow),
    },
  };
}

/** Grava um lote validado. Só a própria pessoa que validou pode confirmar. */
export async function confirmBranchImport(batchId: string): Promise<Result<BranchImportOutcome>> {
  const context = await resolveOrganization("branches.import");
  if (!context) return { ok: false, error: SESSION_LOST };
  const supabase = await createClient();

  const { data, error } = await supabase.rpc("process_branch_import", {
    p_organization_id: context.organization.organizationId,
    p_batch_id: batchId,
  });
  if (error) return { ok: false, error: toMessage(error, "A importação falhou e nenhuma filial foi alterada.") };

  revalidatePath(MODULE_PATH);
  const r = obj(data);
  return {
    ok: true,
    data: {
      created: num(r.created),
      updated: num(r.updated),
      linksAdded: num(r.links_added),
      skipped: num(r.skipped),
      failed: num(r.failed),
      errors: arr(r.errors).map((e) => ({ rowNumber: num(e.row_number), message: String(e.message ?? "") })),
    },
  };
}
