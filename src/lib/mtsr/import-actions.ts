"use server";

import { revalidatePath } from "next/cache";
import { resolveOrganization } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import type { StepResult } from "@/lib/import/client";
import { clampLimit, stepError } from "@/lib/import/server";
import type { Json } from "@/types/database.types";
import type { MtsrSheetRow } from "./import-sheet";
import { MTSR_BASE_PATH } from "./types";

/**
 * Importação histórica de conformidade MTSR — o lado do servidor.
 *
 *   load (staging em blocos; o primeiro cria o lote) → validate → finalize
 *   (prévia: placas desconhecidas, datas, valores parciais, resumo por
 *   componente) → process (ingestão pela fonte manual_import, com prioridade
 *   por componente e idempotência por hash)
 *
 * Nada aqui decide status, veículo ou prioridade: as actions só conferem a
 * sessão, repassam o payload exato da rotina e traduzem o erro.
 */
const PERMISSION = "mtsr.import";
type Raw = Record<string, unknown>;
const obj = (v: unknown): Raw => (v && typeof v === "object" && !Array.isArray(v) ? (v as Raw) : {});
const num = (v: unknown): number => (typeof v === "number" ? v : v == null ? 0 : Number(v) || 0);
const isUuid = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f-]{36}$/i.test(v);

type Rpc = (fn: string, args: Record<string, Json>) => Promise<{ data: unknown; error: { code?: string; message?: string } | null }>;
async function rpc(fn: string, args: Record<string, Json>) {
  const supabase = await createClient();
  return (supabase.rpc as unknown as Rpc)(fn, args);
}
function toMessage(error: { code?: string; message?: string }, fallback: string): string {
  const message = error.message ?? "";
  if (message && /^[A-ZÀ-Ý]/.test(message.trim())) return message;
  if (error.code === "42501") return "Você não possui permissão para importar a conformidade MTSR.";
  return fallback;
}
const NO_ACCESS = "Você não possui permissão para importar (mtsr.import) ou a sessão expirou. Entre de novo.";
async function organizationId(): Promise<string | null> {
  const ctx = await resolveOrganization(PERMISSION);
  return ctx?.organization.organizationId ?? null;
}

export interface MtsrImportFinding {
  row: number;
  level: string;
  code: string;
  message: string;
}

export interface MtsrImportPreview {
  batchId: string;
  totalRows: number;
  validRows: number;
  warningRows: number;
  errorRows: number;
  vehicles: number;
  withLastInspection: number;
  cells: number;
  dateFrom: string | null;
  dateTo: string | null;
  byComponent: Record<string, { name: string; ok: number; nok: number; semInformacao: number }>;
  unknownPlates: string[];
  findings: MtsrImportFinding[];
  sample: { row: number; status: string; licensePlate: string | null; fleetCode: string | null; lastInspectionDate: string | null; components: Record<string, string>; code: string | null }[];
  alreadyImported: boolean;
  referenceDefault: string | null;
}

function previewFrom(data: unknown, batchId: string): MtsrImportPreview {
  const r = obj(data);
  const byComp: MtsrImportPreview["byComponent"] = {};
  for (const [k, v] of Object.entries(obj(r.by_component))) {
    const c = obj(v);
    byComp[k] = { name: String(c.name ?? k), ok: num(c.ok), nok: num(c.nok), semInformacao: num(c.sem_informacao) };
  }
  return {
    batchId: String(r.batch_id ?? batchId),
    totalRows: num(r.total_rows),
    validRows: num(r.valid_rows),
    warningRows: num(r.warning_rows),
    errorRows: num(r.error_rows),
    vehicles: num(r.vehicles),
    withLastInspection: num(r.with_last_inspection),
    cells: num(r.cells),
    dateFrom: (r.date_from as string | null) ?? null,
    dateTo: (r.date_to as string | null) ?? null,
    byComponent: byComp,
    unknownPlates: Array.isArray(r.unknown_plates) ? (r.unknown_plates as unknown[]).map(String) : [],
    findings: Array.isArray(r.findings)
      ? (r.findings as Raw[]).map((f) => ({ row: num(f.row), level: String(f.level ?? ""), code: String(f.code ?? ""), message: String(f.message ?? "") }))
      : [],
    sample: Array.isArray(r.sample)
      ? (r.sample as Raw[]).map((s) => ({
          row: num(s.row),
          status: String(s.status ?? ""),
          licensePlate: (s.license_plate as string | null) ?? null,
          fleetCode: (s.fleet_code as string | null) ?? null,
          lastInspectionDate: (s.last_inspection_date as string | null) ?? null,
          components: Object.fromEntries(Object.entries(obj(s.components)).map(([k, v]) => [k, String(v)])),
          code: (s.code as string | null) ?? null,
        }))
      : [],
    alreadyImported: r.already_imported === true,
    referenceDefault: (r.reference_default as string | null) ?? null,
  };
}

export interface MtsrStageChunkInput {
  batchId: string | null;
  file: { name: string; size: number; hash: string };
  columnMapping: Record<string, string>;
  referenceDefault?: string | null;
  rows: MtsrSheetRow[];
}

const MAX_ROWS_PER_CALL = 2000;

function cleanRows(rows: MtsrSheetRow[]): Json[] | null {
  if (!Array.isArray(rows) || rows.length === 0 || rows.length > MAX_ROWS_PER_CALL) return null;
  const out: Json[] = [];
  for (const row of rows) {
    const n = Number(row?.row_number);
    if (!Number.isInteger(n) || n < 1) return null;
    const comps: Record<string, Json> = {};
    for (const [k, v] of Object.entries(row.components ?? {})) comps[String(k).slice(0, 80)] = String(v).slice(0, 60);
    const raw: Record<string, Json> = {};
    for (const [k, v] of Object.entries(row.raw ?? {})) raw[String(k).slice(0, 120)] = v as Json;
    out.push({
      row_number: n,
      license_plate: row.license_plate ? String(row.license_plate).slice(0, 20) : null,
      fleet_code: row.fleet_code ? String(row.fleet_code).slice(0, 40) : null,
      last_inspection_date: row.last_inspection_date ? String(row.last_inspection_date).slice(0, 20) : null,
      observation: row.observation ? String(row.observation).slice(0, 500) : null,
      components: comps,
      raw,
    });
  }
  return out;
}

export async function stageMtsrChunk(input: MtsrStageChunkInput): Promise<StepResult<{ batchId: string; loaded: number }>> {
  const org = await organizationId();
  if (!org) return { ok: false, error: NO_ACCESS };
  if (input.batchId !== null && !isUuid(input.batchId)) return { ok: false, error: "Lote inválido." };
  const rows = cleanRows(input.rows);
  if (!rows) return { ok: false, error: "Bloco de linhas inválido." };
  const payload: Record<string, Json> = { phase: "load", rows };
  if (input.batchId) payload.batch_id = input.batchId;
  else {
    payload.file_name = String(input.file?.name ?? "").slice(0, 255);
    payload.file_hash = String(input.file?.hash ?? "").slice(0, 128);
    payload.file_size = Number.isFinite(input.file?.size) ? Math.trunc(input.file.size) : null;
    payload.column_mapping = Object.fromEntries(Object.entries(input.columnMapping ?? {}).map(([h, f]) => [String(h).slice(0, 120), String(f).slice(0, 80)]));
    if (input.referenceDefault) payload.reference_default = input.referenceDefault;
  }
  const { data, error } = await rpc("stage_mtsr_import", { p_organization_id: org, p_payload: payload });
  if (error) return stepError(error, (e) => toMessage(e, "Não foi possível enviar as linhas da planilha."));
  const r = obj(data);
  return { ok: true, data: { batchId: String(r.batch_id ?? input.batchId ?? ""), loaded: num(r.loaded) } };
}

export async function validateMtsrImport(batchId: string, limit: number): Promise<StepResult<{ pending: number }>> {
  const org = await organizationId();
  if (!org) return { ok: false, error: NO_ACCESS };
  if (!isUuid(batchId)) return { ok: false, error: "Lote inválido." };
  const { data, error } = await rpc("stage_mtsr_import", { p_organization_id: org, p_payload: { phase: "validate", batch_id: batchId, limit: clampLimit(limit) } });
  if (error) return stepError(error, (e) => toMessage(e, "Não foi possível validar a importação."));
  return { ok: true, data: { pending: num(obj(data).remaining) } };
}

export async function finalizeMtsrImport(batchId: string): Promise<StepResult<MtsrImportPreview>> {
  const org = await organizationId();
  if (!org) return { ok: false, error: NO_ACCESS };
  if (!isUuid(batchId)) return { ok: false, error: "Lote inválido." };
  const { data, error } = await rpc("stage_mtsr_import", { p_organization_id: org, p_payload: { phase: "finalize", batch_id: batchId } });
  if (error) return stepError(error, (e) => toMessage(e, "Não foi possível montar a prévia da importação."));
  revalidatePath(MTSR_BASE_PATH);
  return { ok: true, data: previewFrom(data, batchId) };
}

export interface MtsrImportOutcome {
  batchId: string;
  applied: number;
  ignored: number;
  conflict: number;
  rejected: number;
  duplicate: number;
  rows: number;
  facts: number;
}

export async function processMtsrChunk(batchId: string, limit: number): Promise<StepResult<{ done: boolean; remaining: number; outcome?: MtsrImportOutcome }>> {
  const org = await organizationId();
  if (!org) return { ok: false, error: NO_ACCESS };
  if (!isUuid(batchId)) return { ok: false, error: "Lote inválido." };
  const { data, error } = await rpc("process_mtsr_import", { p_organization_id: org, p_batch_id: batchId, p_limit: Math.min(500, clampLimit(limit)) });
  if (error) return stepError(error, (e) => toMessage(e, "A gravação parou neste bloco. O que já foi gravado continua gravado; confirme de novo para continuar."));
  const r = obj(data);
  const s = obj(r.stats);
  const outcome: MtsrImportOutcome = {
    batchId,
    applied: num(s.applied),
    ignored: num(s.ignored),
    conflict: num(s.conflict),
    rejected: num(s.rejected),
    duplicate: num(s.duplicate),
    rows: num(s.rows),
    facts: num(s.facts),
  };
  if (r.done !== true) return { ok: true, data: { done: false, remaining: num(r.remaining), outcome } };
  revalidatePath(MTSR_BASE_PATH);
  return { ok: true, data: { done: true, remaining: 0, outcome } };
}
