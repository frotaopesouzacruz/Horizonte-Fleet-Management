import "server-only";

import type { KmLoadContext } from "./context";
import { kmRpc, kmRpcRaw } from "./rpc";
import { camelize } from "./types";

/**
 * Qualidade de dados do KM (`km_quality`): score documentado (0–100) com os
 * três componentes, indicadores, ocorrências para correção, frotas
 * desatualizadas, saúde do hodômetro e o último lote. Quem gerencia
 * parâmetros ou reprocessa recebe também os parâmetros vigentes e o catálogo
 * de status (`km_settings_get`).
 */
export interface KmQualityComponents {
  coveragePct: number | null;
  consistencyPct: number | null;
  freshnessPct: number | null;
  elapsedVehicleDays: number | null;
  readings: number | null;
  withReading: number | null;
  problems: number | null;
  activeVehicles: number | null;
  updatedVehicles: number | null;
}

export interface KmQualityIndicators {
  valid?: number | null;
  noReading?: number | null;
  noReadingInformed?: number | null;
  noMovement?: number | null;
  kmDivergence?: number | null;
  highMileage?: number | null;
  inconsistent?: number | null;
  pendingReview?: number | null;
  regression?: number | null;
  jump?: number | null;
  registryDivergence?: number | null;
  corrected?: number | null;
  staleVehicles?: number | null;
  unregisteredPlates?: number | null;
  duplicates?: number | null;
}

export interface KmQualityIssue {
  readingId: string;
  vehicleId: string;
  plate: string;
  fleetCode: string | null;
  type: string | null;
  subcategory: string | null;
  model: string | null;
  day: string;
  status: string | null;
  alerts: string[] | null;
  odometerStart: number | null;
  odometerEnd: number | null;
  kmInformed: number | null;
  kmCalculated: number | null;
  km: number | null;
  corrected: boolean | null;
}

export interface KmQualityStale {
  vehicleId: string;
  plate: string;
  fleetCode: string | null;
  type: string | null;
  subcategory: string | null;
  model: string | null;
  status: string | null;
  lastReadingDate: string | null;
  missingDays: number | null;
  /** Faixa de KM_FRESHNESS. */
  bucket: string;
}

export interface KmQualityLastBatch {
  id: string;
  fileName: string | null;
  processedAt: string | null;
  createdRows: number | null;
  updatedRows: number | null;
  errorRows: number | null;
  warningRows: number | null;
}

export interface KmStatusCatalogEntry {
  code: string;
  kind: "reading" | "alert" | "import" | string;
  tone: string;
  label: string;
  sortOrder: number | null;
  description: string | null;
  hasReading: boolean | null;
  countsDistance: boolean | null;
}

/** Parâmetros vigentes (`km_settings_of`) + catálogo de status. */
export interface KmSettings {
  noMovementToleranceKm: number | null;
  divergenceToleranceKm: number | null;
  highMileageKm: number | null;
  odometerJumpKm: number | null;
  regressionToleranceKm: number | null;
  minCoveragePct: number | null;
  minCohortSize: number | null;
  outlierIqrFactor: number | null;
  rotationMinGapKm: number | null;
  rotationStaleDays: number | null;
  updatedAt?: string | null;
  updatedBy?: string | null;
  statuses?: KmStatusCatalogEntry[] | null;
}

export interface KmQualityData {
  period?: { from: string; to: string };
  score?: number | null;
  components?: KmQualityComponents | null;
  indicators?: KmQualityIndicators | null;
  issues?: KmQualityIssue[];
  stale?: KmQualityStale[];
  /** Saúde do hodômetro por frota — chaves nos códigos do banco (healthy, attention, critical, no_data). */
  health?: Record<string, number> | null;
  lastBatch?: KmQualityLastBatch | null;
  canCorrect?: boolean;
  /** Só para quem gerencia parâmetros ou reprocessa. */
  settings?: KmSettings | null;
  /** Mensagem quando os parâmetros não puderam ser lidos (o resto da aba segue). */
  settingsError?: string | null;
}

export async function loadQuality(ctx: KmLoadContext): Promise<KmQualityData> {
  const wantsSettings = ctx.perms.manageParameters || ctx.perms.reprocess;
  const [raw, settings] = await Promise.all([
    kmRpcRaw<Record<string, unknown> | null>("km_quality", {
      p_organization_id: ctx.organizationId,
      p_filters: ctx.payload,
    }),
    wantsSettings
      ? kmRpc<KmSettings>("km_settings_get", { p_organization_id: ctx.organizationId }).then(
          (value) => ({ value, error: null as string | null }),
          (error: unknown) => ({ value: null, error: error instanceof Error ? error.message : String(error) }),
        )
      : Promise.resolve({ value: null, error: null as string | null }),
  ]);
  if (!raw) return { settings: settings.value, settingsError: settings.error };
  const data = camelize<KmQualityData>(raw);
  // Saúde: as chaves são códigos (no_data…), não nomes de campo.
  const health = raw.health;
  data.health = health && typeof health === "object" ? (health as Record<string, number>) : null;
  data.settings = settings.value;
  data.settingsError = settings.error;
  return data;
}
