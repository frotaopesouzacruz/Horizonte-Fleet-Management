import "server-only";

import type { KmLoadContext } from "./context";
import { kmRpcRaw } from "./rpc";
import { camelize, type KmFreshnessBucket, type KmTone, type KmVehicleCard } from "./types";

/**
 * Visão geral do KM — `km_overview` (mesma grade veículo × dia de todas as
 * abas). O navegador só apresenta: totais, médias, medianas, cobertura,
 * faixas de atualização e insights chegam prontos da rotina.
 */
export interface KmOverviewPeriod {
  from: string;
  to: string;
  /** "Hoje" da organização (fuso dela). Dias depois dele são futuros. */
  today: string;
  competence: string;
  /** Último dia do período com KM validado (nunca um dia só "Sem leitura"). */
  referenceDay: string | null;
}

export interface KmOverviewKpis {
  vehicles: number;
  activeVehicles: number;
  vehiclesUpdated: number;
  coverageRefCount: number;
  coverageRefTotal: number;
  coveragePeriodPct: number | null;
  vehiclesWithoutReadingRef: number;
  vehiclesStale: number;
  kmTotal: number | null;
  kmRefDay: number | null;
  avgDailyFleet: number | null;
  medianDailyFleet: number | null;
  avgPerVehicle: number | null;
  medianPerVehicle: number | null;
  avgDailyPerVehicle: number | null;
  noMovementRef: number;
  highMileageDays: number;
  highMileageVehicles: number;
  inconsistencies: number;
  validDays: number;
  lastUpdate: string | null;
  highMileageKm: number | null;
}

/** Frota ativa sem leitura no dia de referência, com a faixa de atualização. */
export interface KmOverviewMissingVehicle {
  vehicleId: string;
  plate: string | null;
  fleetCode: string | null;
  lastReadingDate: string | null;
  missingDays: number | null;
  bucket: KmFreshnessBucket;
}

export interface KmOverviewDay {
  day: string;
  /** KM validado do dia; nulo quando ninguém tem KM que conta. */
  km: number | null;
  withReading: number;
  moving: number;
  /** Frotas sem leitura no dia (dias futuros ficam fora: 0). */
  withoutReading: number;
}

export interface KmOverviewOperation {
  operationId: string | null;
  operation: string;
  km: number | null;
  vehicles: number;
}

export interface KmOverviewType {
  vehicleTypeId: string | null;
  type: string;
  km: number | null;
  vehicles: number;
}

export interface KmOverviewVehicle extends KmVehicleCard {
  km: number | null;
  readingDays: number;
  avgDaily: number | null;
}

export interface KmInsight {
  tone: KmTone;
  text: string;
}

/** Parâmetros que explicam os números (de `km_settings_get`; opcionais). */
export interface KmOverviewSettings {
  minCoveragePct: number | null;
  noMovementToleranceKm: number | null;
  highMileageKm: number | null;
}

export interface KmOverviewData {
  period: KmOverviewPeriod;
  kpis: KmOverviewKpis;
  /**
   * Faixas de atualização por código (`updated`, `d1`, `d2_3`, `d4_7`,
   * `d7_plus`, `never`). Chaves mantidas como no banco (são códigos, não campos).
   */
  freshness: Partial<Record<KmFreshnessBucket, number>>;
  missingVehicles: KmOverviewMissingVehicle[];
  daily: KmOverviewDay[];
  byOperation: KmOverviewOperation[];
  byType: KmOverviewType[];
  /** Veículo × dia por situação (código do catálogo → quantidade), sem dias futuros. */
  byStatus: Record<string, number>;
  topVehicles: KmOverviewVehicle[];
  bottomVehicles: KmOverviewVehicle[];
  insights: KmInsight[];
  /** Extra do carregador: parâmetros vigentes (nulo se a leitura falhar). */
  settings: KmOverviewSettings | null;
}

type RawOverview = Record<string, unknown> & {
  freshness?: Record<string, number> | null;
  by_status?: Record<string, number> | null;
};

type RawSettings = { min_coverage_pct?: number | null; no_movement_tolerance_km?: number | null; high_mileage_km?: number | null };

export async function loadOverview(ctx: KmLoadContext): Promise<KmOverviewData> {
  const [raw, settings] = await Promise.all([
    kmRpcRaw<RawOverview>("km_overview", { p_organization_id: ctx.organizationId, p_filters: ctx.payload }),
    // Só para explicar os critérios na tela (cobertura mínima do "menor rodagem").
    kmRpcRaw<RawSettings>("km_settings_get", { p_organization_id: ctx.organizationId }).catch(() => null),
  ]);
  const { freshness, by_status: byStatus, ...rest } = raw ?? {};
  const data = camelize<Omit<KmOverviewData, "freshness" | "byStatus" | "settings">>(rest);
  return {
    ...data,
    missingVehicles: data.missingVehicles ?? [],
    daily: data.daily ?? [],
    byOperation: data.byOperation ?? [],
    byType: data.byType ?? [],
    topVehicles: data.topVehicles ?? [],
    bottomVehicles: data.bottomVehicles ?? [],
    insights: data.insights ?? [],
    // mapas cujas chaves são códigos: não passam pelo camelCase ("d2_3", "no_reading")
    freshness: (freshness ?? {}) as KmOverviewData["freshness"],
    byStatus: byStatus ?? {},
    settings: settings
      ? {
          minCoveragePct: settings.min_coverage_pct ?? null,
          noMovementToleranceKm: settings.no_movement_tolerance_km ?? null,
          highMileageKm: settings.high_mileage_km ?? null,
        }
      : null,
  };
}
