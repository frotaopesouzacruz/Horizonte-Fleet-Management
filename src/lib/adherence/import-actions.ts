"use server";

import { createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import { requireOrganization } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { parseSpreadsheet } from "@/lib/admin/spreadsheet";
import type { Json } from "@/types/database.types";
import type { Result } from "./actions";
import { cellToText, mapImportColumns, toIsoDate, type ImportField } from "./import-columns";

/**
 * Importação de bases de status diário (§54–§56).
 *
 * A action lê a planilha e mapeia colunas; tudo o mais acontece em duas
 * rotinas do banco: `stage_adherence_import` valida linha a linha e devolve a
 * prévia; `process_adherence_import` abre as solicitações — sempre PENDENTES —
 * e registra inconsistências para o que não entendeu. Nada aqui cria veículo,
 * obrigação ou execução, nada aprova, nada toca em perfil de acesso.
 */

const MODULE_PATH = "/checklist/aderencia";
const MAX_ROWS = 20000;
const MAX_FILE_BYTES = 10 * 1024 * 1024;

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

export async function uploadAdherenceImport(formData: FormData): Promise<Result<AdherenceImportPreview>> {
  const { organization } = await requireOrganization("adherence.import");
  const supabase = await createClient();

  const file = formData.get("file");
  if (!(file instanceof File)) return { ok: false, error: "Selecione um arquivo." };
  if (file.size === 0) return { ok: false, error: "O arquivo está vazio." };
  if (file.size > MAX_FILE_BYTES) return { ok: false, error: "O arquivo excede 10 MB." };
  if (!/\.(xlsx|csv)$/i.test(file.name)) return { ok: false, error: "Formato não suportado. Utilize XLSX ou CSV." };

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

  const columns = mapImportColumns(sheet.headers);
  if (columns.missing.length) {
    return { ok: false, error: `Colunas obrigatórias não encontradas: ${columns.missing.join(", ")}.` };
  }

  const rows: Json[] = sheet.rows.map((values, index) => {
    const raw: Record<string, Json> = {};
    const mapped: Partial<Record<ImportField, string | null>> = {};
    sheet.headers.forEach((header, columnIndex) => {
      const value = values[columnIndex] ?? null;
      raw[header || `col_${columnIndex + 1}`] = value instanceof Date ? value.toISOString() : (value as Json);
      const field = columns.mapping[columnIndex];
      if (field) mapped[field] = field === "operational_date" ? toIsoDate(value) : cellToText(value);
    });
    return {
      row_number: index + 2,
      raw,
      fleet_code: mapped.fleet_code ?? null,
      license_plate: mapped.license_plate ?? null,
      operational_date: mapped.operational_date ?? null,
      context: mapped.context ?? null,
      status: mapped.status ?? null,
      justification: mapped.justification ?? null,
      evidence_reference: mapped.evidence_reference ?? null,
    };
  });

  const { data, error } = await supabase.rpc("stage_adherence_import", {
    p_organization_id: organization.organizationId,
    p_payload: {
      file_name: file.name,
      file_hash: fileHash,
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

export async function confirmAdherenceImport(
  batchId: string,
): Promise<Result<{ requestsCreated: number; skipped: number; inconsistencies: number }>> {
  const { organization } = await requireOrganization("adherence.import");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("process_adherence_import", {
    p_organization_id: organization.organizationId,
    p_batch_id: batchId,
  });
  if (error) return { ok: false, error: toMessage(error, "Não foi possível processar a importação.") };
  revalidatePath(MODULE_PATH);
  const r = obj(data);
  return {
    ok: true,
    data: { requestsCreated: num(r.requests_created), skipped: num(r.skipped), inconsistencies: num(r.inconsistencies) },
  };
}
