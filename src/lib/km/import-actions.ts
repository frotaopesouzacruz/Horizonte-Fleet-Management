"use server";

import { revalidatePath } from "next/cache";
import { resolveOrganization } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import type { StepResult } from "@/lib/import/client";
import { clampLimit, stepError } from "@/lib/import/server";
import type { Json } from "@/types/database.types";
import {
  isKmBatchId, kmCodeMap, kmSummaryFromRaw,
  type KmFindingsPage, type KmImportFinding, type KmImportSummary,
} from "./batches";
import type { KmSheetField, KmSheetRow } from "./import-sheet";
import { camelize } from "./types";

/**
 * Importação de KM (aba Controle KM Rodado) — o lado do servidor.
 *
 * Cada função é uma etapa do pipeline oficial de lotes, executada por uma
 * rotina do banco sob o cliente da própria pessoa (permissão `km.import`,
 * escopo e trilha decididos lá):
 *
 *   load (staging em blocos; o primeiro cria o lote) → validate → finalize
 *   (prévia: duplicidade, continuidade do hodômetro, resumo e comparação)
 *   → process (consolidação em blocos + hodômetro do veículo + eventos)
 *
 * `cancel_km_import` descarta um lote em rascunho ou validado. Nada aqui
 * decide KM, status ou ação de uma linha: as actions só conferem a sessão,
 * repassam o payload exato da rotina e traduzem o erro.
 */

const MODULE_PATH = "/frota/km";
const PERMISSION = "km.import";

type Raw = Record<string, unknown>;
const obj = (v: unknown): Raw => (v && typeof v === "object" && !Array.isArray(v) ? (v as Raw) : {});
const num = (v: unknown): number => (typeof v === "number" ? v : v == null ? 0 : Number(v) || 0);

type Rpc = (
  fn: string,
  args: Record<string, Json>,
) => Promise<{ data: unknown; error: { code?: string; message?: string } | null }>;

async function rpc(fn: string, args: Record<string, Json>) {
  const supabase = await createClient();
  return (supabase.rpc as unknown as Rpc)(fn, args);
}

/** As rotinas levantam mensagens prontas para quem opera; só códigos crus viram texto aqui. */
function toMessage(error: { code?: string; message?: string }, fallback: string): string {
  const message = error.message ?? "";
  if (message && /^[A-ZÀ-Ý]/.test(message.trim())) return message;
  if (error.code === "42501") return "Você não possui permissão para importar KM.";
  return fallback;
}

const NO_ACCESS = "Você não possui permissão para importar KM (km.import) ou a sessão expirou. Entre de novo.";

async function organizationId(): Promise<string | null> {
  const ctx = await resolveOrganization(PERMISSION);
  return ctx?.organization.organizationId ?? null;
}

// ---------------------------------------------------------------------------
// Prévia
// ---------------------------------------------------------------------------
export interface KmImportPreview {
  batchId: string;
  fileName: string;
  totalRows: number;
  validRows: number;
  warningRows: number;
  errorRows: number;
  summary: KmImportSummary;
  /** Achados por código, pelas chaves do banco (`unregistered_plate`…). */
  categories: Record<string, number>;
}

function previewFrom(data: unknown, batchId: string): KmImportPreview {
  const r = obj(data);
  return {
    batchId: String(r.batch_id ?? batchId),
    fileName: String(r.file_name ?? ""),
    totalRows: num(r.total_rows),
    validRows: num(r.valid_rows),
    warningRows: num(r.warning_rows),
    errorRows: num(r.error_rows),
    summary: kmSummaryFromRaw(r.summary),
    categories: kmCodeMap(r.categories),
  };
}

// ---------------------------------------------------------------------------
// load
// ---------------------------------------------------------------------------
export interface KmStageChunkInput {
  /** null no primeiro bloco: a rotina cria o lote. */
  batchId: string | null;
  file: { name: string; size: number; hash: string };
  sheetName: string;
  headerRow: number;
  /** Cabeçalho da planilha → campo (guardado no lote). */
  columnMapping: Record<string, string>;
  rows: KmSheetRow[];
}

const FIELDS: KmSheetField[] = ["ref", "plate", "fleet", "type", "model", "date", "start", "end", "km"];
const MAX_ROWS_PER_CALL = 5000;

/** Só os campos da aba, com valores escalares: o que a rotina espera em `rows`. */
function cleanRows(rows: KmSheetRow[]): Json[] | null {
  if (!Array.isArray(rows) || rows.length === 0 || rows.length > MAX_ROWS_PER_CALL) return null;
  const out: Json[] = [];
  for (const row of rows) {
    const n = Number(row?.row_number);
    if (!Number.isInteger(n) || n < 1) return null;
    const clean: Record<string, Json> = { row_number: n };
    for (const f of FIELDS) {
      const v = row[f];
      if (v === undefined) continue;
      clean[f] = typeof v === "number" ? (Number.isFinite(v) ? v : null) : v === null ? null : String(v).slice(0, 200);
    }
    out.push(clean);
  }
  return out;
}

/** Grava um bloco da aba no staging (cada linha já avaliada); o primeiro bloco abre o lote. */
export async function stageKmChunk(input: KmStageChunkInput): Promise<StepResult<{ batchId: string; loaded: number }>> {
  const org = await organizationId();
  if (!org) return { ok: false, error: NO_ACCESS };
  if (input.batchId !== null && !isKmBatchId(input.batchId)) return { ok: false, error: "Lote inválido." };
  const rows = cleanRows(input.rows);
  if (!rows) return { ok: false, error: "Bloco de linhas inválido." };

  const payload: Record<string, Json> = { phase: "load", rows };
  if (input.batchId) {
    payload.batch_id = input.batchId;
  } else {
    payload.file_name = String(input.file?.name ?? "").slice(0, 255);
    payload.file_hash = String(input.file?.hash ?? "").slice(0, 128);
    payload.file_size = Number.isFinite(input.file?.size) ? Math.trunc(input.file.size) : null;
    payload.sheet_name = String(input.sheetName ?? "");
    payload.header_row = Number.isInteger(input.headerRow) ? input.headerRow : null;
    const mapping: Record<string, Json> = {};
    for (const [header, field] of Object.entries(input.columnMapping ?? {})) {
      if (FIELDS.includes(field as KmSheetField)) mapping[String(header).slice(0, 120)] = field;
    }
    payload.column_mapping = mapping;
  }

  const { data, error } = await rpc("stage_km_import", { p_organization_id: org, p_payload: payload });
  if (error) return stepError(error, (e) => toMessage(e, "Não foi possível enviar as linhas da planilha."));
  const r = obj(data);
  return { ok: true, data: { batchId: String(r.batch_id ?? input.batchId ?? ""), loaded: num(r.loaded) } };
}

// ---------------------------------------------------------------------------
// validate / finalize
// ---------------------------------------------------------------------------
/** Valida as próximas `limit` linhas pendentes; devolve quantas ainda faltam. */
export async function validateKmImport(batchId: string, limit: number): Promise<StepResult<{ pending: number }>> {
  const org = await organizationId();
  if (!org) return { ok: false, error: NO_ACCESS };
  if (!isKmBatchId(batchId)) return { ok: false, error: "Lote inválido." };
  const { data, error } = await rpc("stage_km_import", {
    p_organization_id: org,
    p_payload: { phase: "validate", batch_id: batchId, limit: clampLimit(limit) },
  });
  if (error) return stepError(error, (e) => toMessage(e, "Não foi possível validar a importação."));
  return { ok: true, data: { pending: num(obj(data).pending) } };
}

/**
 * Fecha a prévia: duplicidade no arquivo, continuidade do hodômetro, resumo e
 * comparação com a base. Um lote já validado pode ser finalizado de novo
 * (retomada): o resumo é refeito com a base de agora.
 */
export async function finalizeKmImport(batchId: string): Promise<StepResult<KmImportPreview>> {
  const org = await organizationId();
  if (!org) return { ok: false, error: NO_ACCESS };
  if (!isKmBatchId(batchId)) return { ok: false, error: "Lote inválido." };
  const { data, error } = await rpc("stage_km_import", {
    p_organization_id: org,
    p_payload: { phase: "finalize", batch_id: batchId },
  });
  if (error) return stepError(error, (e) => toMessage(e, "Não foi possível montar a prévia da importação."));
  revalidatePath(MODULE_PATH);
  return { ok: true, data: previewFrom(data, batchId) };
}

// ---------------------------------------------------------------------------
// process / cancel
// ---------------------------------------------------------------------------
export interface KmImportOutcome {
  batchId: string;
  createdRows: number;
  updatedRows: number;
  skippedRows: number;
  milestoneEvents: number;
}

/** Consolida as próximas `limit` linhas no razão diário; o último bloco conclui o lote. */
export async function processKmChunk(
  batchId: string,
  limit: number,
): Promise<StepResult<{ done: boolean; remaining: number; outcome?: KmImportOutcome }>> {
  const org = await organizationId();
  if (!org) return { ok: false, error: NO_ACCESS };
  if (!isKmBatchId(batchId)) return { ok: false, error: "Lote inválido." };
  const { data, error } = await rpc("process_km_import", {
    p_organization_id: org,
    p_batch_id: batchId,
    p_limit: Math.min(2000, clampLimit(limit)),
  });
  if (error) {
    return stepError(error, (e) =>
      toMessage(e, "A gravação parou neste bloco. O que já foi gravado continua gravado; confirme de novo para continuar."),
    );
  }
  const r = obj(data);
  if (r.done !== true) return { ok: true, data: { done: false, remaining: num(r.remaining) } };
  revalidatePath(MODULE_PATH);
  const o = obj(r.outcome);
  return {
    ok: true,
    data: {
      done: true,
      remaining: 0,
      outcome: {
        batchId: String(o.batch_id ?? batchId),
        createdRows: num(o.created_rows),
        updatedRows: num(o.updated_rows),
        skippedRows: num(o.skipped_rows),
        milestoneEvents: num(o.milestone_events),
      },
    },
  };
}

/** Descarta um lote em rascunho ou validado (nada foi gravado no razão). */
export async function cancelKmImport(batchId: string): Promise<StepResult<{ cancelled: boolean }>> {
  const org = await organizationId();
  if (!org) return { ok: false, error: NO_ACCESS };
  if (!isKmBatchId(batchId)) return { ok: false, error: "Lote inválido." };
  const { data, error } = await rpc("cancel_km_import", { p_organization_id: org, p_batch_id: batchId });
  if (error) return { ok: false, error: toMessage(error, "Não foi possível cancelar o lote.") };
  revalidatePath(MODULE_PATH);
  if (data !== true) {
    return { ok: false, error: "Este lote não está mais em rascunho nem validado: não pode ser cancelado." };
  }
  return { ok: true, data: { cancelled: true } };
}

// ---------------------------------------------------------------------------
// Achados
// ---------------------------------------------------------------------------
/** Uma página de achados do lote (todos ou de um código), na ordem do banco: erros primeiro. */
export async function kmImportFindings(
  batchId: string,
  code: string | null,
  offset: number,
  limit = 100,
): Promise<StepResult<KmFindingsPage>> {
  const ctx = await resolveOrganization();
  if (!ctx) return { ok: false, error: "A sessão expirou. Entre de novo." };
  if (!isKmBatchId(batchId)) return { ok: false, error: "Lote inválido." };
  const safeCode = code && /^[a-z_]{1,64}$/.test(code) ? code : null;
  const safeOffset = Math.max(0, Math.trunc(Number(offset) || 0));
  const safeLimit = Math.min(1000, Math.max(1, Math.trunc(Number(limit) || 100)));
  const { data, error } = await rpc("km_import_findings", {
    p_batch_id: batchId,
    p_code: safeCode,
    p_limit: safeLimit,
    p_offset: safeOffset,
  });
  if (error) return { ok: false, error: toMessage(error, "Não foi possível carregar os achados do lote.") };
  const r = camelize<{ total?: number; rows?: KmImportFinding[] }>(data);
  return {
    ok: true,
    data: { code: safeCode, offset: safeOffset, total: num(r?.total), rows: Array.isArray(r?.rows) ? r.rows : [] },
  };
}
