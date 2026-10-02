import "server-only";

import { createClient } from "@/lib/supabase/server";
import type { KmLoadContext } from "./context";
import { kmRpc, kmRpcRaw } from "./rpc";
import { camelize } from "./types";
import { firstParam } from "./url";

/**
 * Gestão de KM → Importação e Lotes.
 *
 * Os lotes vêm de `km_import_batches` (paginado, mais recentes primeiro). Com
 * o parâmetro `lote`, carrega também o resumo completo daquele lote
 * (`import_batches.summary`, o mesmo bloco da prévia — a RLS decide se a
 * pessoa o vê), a primeira página de achados (`km_import_findings`) e o total
 * de achados por código. O navegador só apresenta: nenhum número é refeito.
 */

export const KM_BATCHES_PAGE_SIZE = 20;
export const KM_FINDINGS_PAGE_SIZE = 100;

/** Códigos de achado que o pipeline grava (import_errors.code), na ordem de leitura. */
export const KM_FINDING_CODES = [
  "missing_plate",
  "unregistered_plate",
  "archived_vehicle",
  "missing_date",
  "invalid_date",
  "invalid_number",
  "future_date",
  "duplicate_conflict",
  "duplicate_identical",
  "inconsistent",
  "km_divergence",
  "high_mileage",
  "odometer_regression",
  "odometer_jump",
  "registry_divergence",
  "inactive_vehicle",
  "manual_correction_kept",
] as const;

/** Uma linha de `km_import_batches` (camelCase). */
export interface KmImportBatch {
  id: string;
  fileName: string | null;
  status: string;
  createdAt: string | null;
  processedAt: string | null;
  totalRows: number | null;
  validRows: number | null;
  warningRows: number | null;
  errorRows: number | null;
  createdRows: number | null;
  updatedRows: number | null;
  skippedRows: number | null;
  fileHash: string | null;
  fileSize?: number | null;
  sheetName: string | null;
  headerRow: number | null;
  periodFrom: string | null;
  periodTo: string | null;
  kmTotal: number | null;
  sourceType: string | null;
  createdBy: string | null;
  errorMessage?: string | null;
}

export interface KmCompareMonth {
  month: string;
  kmFile: number | null;
  kmCurrent: number | null;
  newRows: number | null;
  updateRows: number | null;
}

export interface KmCompareVehicle {
  vehicleId: string | null;
  plate: string | null;
  fleet: string | null;
  kmFile: number | null;
  kmCurrent: number | null;
  diff: number | null;
}

export interface KmCompareOperation {
  operationId: string | null;
  operation: string | null;
  kmFile: number | null;
  kmCurrent: number | null;
}

/** `import_batches.summary` de um lote de KM (o mesmo bloco da prévia). */
export interface KmImportSummary {
  /** Hodômetros oficiais vigentes vindos do lote (km_import_batch). */
  odometersSynced?: number | null;
  kind?: string;
  sheetName?: string | null;
  headerRow?: number | null;
  sourceType?: string | null;
  periodFrom?: string | null;
  periodTo?: string | null;
  rows?: number | null;
  plates?: number | null;
  vehicles?: number | null;
  kmTotal?: number | null;
  createRows?: number | null;
  updateRows?: number | null;
  unchangedRows?: number | null;
  manualKeptRows?: number | null;
  /** Linhas por situação do catálogo, pelas chaves do banco (`no_reading`…). */
  byStatus?: Record<string, number>;
  noReadingRows?: number | null;
  noMovementRows?: number | null;
  inconsistentRows?: number | null;
  highMileageRows?: number | null;
  divergenceRows?: number | null;
  pendingReviewRows?: number | null;
  jumpRows?: number | null;
  registryDivergenceRows?: number | null;
  unregisteredPlates?: { plate: string; rows: number }[];
  duplicateRows?: number | null;
  futureRows?: number | null;
  futurePlaceholderRows?: number | null;
  errorRows?: number | null;
  alreadyImported?: boolean;
  compareMonths?: KmCompareMonth[];
  compareVehicles?: KmCompareVehicle[];
  compareOperations?: KmCompareOperation[];
  /** Hodômetro antes da gravação, por veículo (preenchido ao confirmar). */
  kmBefore?: Record<string, number>;
}

export interface KmImportFinding {
  rowNumber: number | null;
  level: string;
  field: string | null;
  code: string | null;
  message: string;
  plate: string | null;
  date: string | null;
}

export interface KmFindingsPage {
  code: string | null;
  offset: number;
  total: number;
  rows: KmImportFinding[];
}

export interface KmBatchDetail {
  id: string;
  /** Cabeçalho do lote (null = fora do acesso ou inexistente). */
  batch: KmImportBatch | null;
  /** Resumo completo; null quando a pessoa não pode ler o lote em `import_batches`. */
  summary: KmImportSummary | null;
  /** Achados por código, pelas chaves do banco. */
  categories: Record<string, number>;
  findings: KmFindingsPage | null;
  findingsError: string | null;
}

export interface KmBatchesData {
  total: number;
  rows: KmImportBatch[];
  page: number;
  pageSize: number;
  detail: KmBatchDetail | null;
}

type Raw = Record<string, unknown>;
const obj = (v: unknown): Raw => (v && typeof v === "object" && !Array.isArray(v) ? (v as Raw) : {});

/** Mapa por código como o banco gravou (o camelize trocaria `no_reading` por `noReading`). */
function codeMap(v: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, n] of Object.entries(obj(v))) out[k] = typeof n === "number" ? n : Number(n);
  return out;
}

/** summary cru (snake_case) → KmImportSummary, preservando os mapas por código. */
export function kmSummaryFromRaw(raw: unknown): KmImportSummary {
  const r = obj(raw);
  const summary = camelize<KmImportSummary>(r);
  summary.byStatus = codeMap(r.by_status);
  if (r.km_before !== undefined) summary.kmBefore = codeMap(r.km_before);
  return summary;
}

export { codeMap as kmCodeMap };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isKmBatchId = (v: string | null | undefined): v is string => Boolean(v && UUID.test(v));

interface BatchesRpc {
  total: number;
  rows: KmImportBatch[];
}

async function findingsPage(batchId: string, code: string | null, limit: number, offset: number): Promise<KmFindingsPage> {
  const res = await kmRpc<{ total: number; rows: KmImportFinding[] }>("km_import_findings", {
    p_batch_id: batchId,
    p_code: code,
    p_limit: limit,
    p_offset: offset,
  });
  return { code, offset, total: Number(res?.total ?? 0), rows: Array.isArray(res?.rows) ? res.rows : [] };
}

/** Total de achados de cada código (uma contagem por código, em paralelo). */
async function findingCounts(batchId: string): Promise<Record<string, number>> {
  const pairs = await Promise.all(
    KM_FINDING_CODES.map(async (code) => {
      try {
        const page = await findingsPage(batchId, code, 1, 0);
        return [code, page.total] as const;
      } catch {
        return [code, 0] as const;
      }
    }),
  );
  const out: Record<string, number> = {};
  for (const [code, total] of pairs) if (total > 0) out[code] = total;
  return out;
}

async function loadDetail(id: string, listRow: KmImportBatch | undefined): Promise<KmBatchDetail> {
  // `km_import_batch`: resumo e contagem por código numa chamada, sob km.import,
  // km.view_audit ou km.view_quality (sem depender da leitura direta da tabela).
  const [head, first] = await Promise.all([
    kmRpcRaw<Raw>("km_import_batch", { p_batch_id: id }).then(
      (row) => ({ row, error: null as string | null }),
      (error: unknown) => ({ row: null as Raw | null, error: error instanceof Error ? error.message : String(error) }),
    ),
    findingsPage(id, null, KM_FINDINGS_PAGE_SIZE, 0).then(
      (page) => ({ page, error: null as string | null }),
      (error: unknown) => ({ page: null, error: error instanceof Error ? error.message.replace(/^km_import_findings:\s*/, "") : String(error) }),
    ),
  ]);

  const row = head.row;
  const summaryRaw = row ? obj(row.summary) : null;
  const summary = summaryRaw ? kmSummaryFromRaw(summaryRaw) : null;
  if (summary && row && row.odometers_synced != null) summary.odometersSynced = Number(row.odometers_synced);

  let batch: KmImportBatch | null = listRow ? { ...listRow } : null;
  if (row) {
    const n = (v: unknown) => (v == null ? null : Number(v));
    batch = {
      ...(batch ?? ({} as KmImportBatch)),
      id: String(row.id),
      fileName: (row.file_name as string) ?? batch?.fileName ?? null,
      status: (row.status as string) ?? batch?.status,
      createdAt: (row.created_at as string) ?? batch?.createdAt,
      processedAt: (row.processed_at as string | null) ?? null,
      totalRows: n(row.total_rows),
      validRows: n(row.valid_rows),
      warningRows: n(row.warning_rows),
      errorRows: n(row.error_rows),
      createdRows: n(row.created_rows),
      updatedRows: n(row.updated_rows),
      skippedRows: n(row.skipped_rows),
      fileHash: (row.file_hash as string | null) ?? null,
      fileSize: n(row.file_size),
      sheetName: summary?.sheetName ?? batch?.sheetName ?? null,
      headerRow: summary?.headerRow ?? batch?.headerRow ?? null,
      periodFrom: summary?.periodFrom ?? batch?.periodFrom ?? null,
      periodTo: summary?.periodTo ?? batch?.periodTo ?? null,
      kmTotal: summary?.kmTotal ?? batch?.kmTotal ?? null,
      sourceType: summary?.sourceType ?? batch?.sourceType ?? null,
      createdBy: (row.created_by as string | null) ?? batch?.createdBy ?? null,
    } as KmImportBatch;
  }

  const categories = row ? codeMap(row.findings_by_code) : {};

  return { id, batch, summary, categories, findings: first.page, findingsError: first.error ?? head.error };
}

export async function loadBatches(ctx: KmLoadContext): Promise<KmBatchesData> {
  const page = Math.max(1, Number.parseInt(firstParam(ctx.params, "pagina") ?? "1", 10) || 1);
  const lote = firstParam(ctx.params, "lote");
  const list = await kmRpc<BatchesRpc>("km_import_batches", {
    p_organization_id: ctx.organizationId,
    p_limit: KM_BATCHES_PAGE_SIZE,
    p_offset: (page - 1) * KM_BATCHES_PAGE_SIZE,
  });
  const rows = Array.isArray(list?.rows) ? list.rows : [];
  const detail = isKmBatchId(lote) ? await loadDetail(lote, rows.find((r) => r.id === lote)) : null;
  return { total: Number(list?.total ?? 0), rows, page, pageSize: KM_BATCHES_PAGE_SIZE, detail };
}
