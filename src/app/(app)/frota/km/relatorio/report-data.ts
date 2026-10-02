import "server-only";

import { kmRpc } from "@/lib/km/rpc";
import { kmFiltersPayload } from "@/lib/km/url";
import type { KmFilters, KmVehicleCard } from "@/lib/km/types";

/**
 * Dados do Relatório Gerencial — `km_overview` + `km_analysis` com os mesmos
 * filtros da tela (paridade: o arquivo e a página imprimível mostram o mesmo
 * conjunto que a pessoa vê). Chaves já em camelCase; mapas indexados por
 * código (situação, atualização, quadrante) devem ser lidos com `byCode`.
 */

export interface ReportInsight {
  tone: "success" | "warning" | "danger" | "info" | "neutral" | string;
  text: string;
}

export interface ReportRankedVehicle extends KmVehicleCard {
  km: number | null;
  readingDays: number | null;
  avgDaily: number | null;
}

export interface ReportOverview {
  period: { from: string; to: string; today?: string; referenceDay: string | null; competence?: string };
  kpis: {
    kmTotal: number | null;
    vehicles: number | null;
    activeVehicles: number | null;
    vehiclesUpdated: number | null;
    vehiclesStale: number | null;
    coverageRefCount: number | null;
    coverageRefTotal: number | null;
    coveragePeriodPct: number | null;
    vehiclesWithoutReadingRef: number | null;
    kmRefDay: number | null;
    avgDailyFleet: number | null;
    medianDailyFleet: number | null;
    avgPerVehicle: number | null;
    medianPerVehicle: number | null;
    avgDailyPerVehicle: number | null;
    noMovementRef: number | null;
    highMileageDays: number | null;
    highMileageVehicles: number | null;
    highMileageKm: number | null;
    inconsistencies: number | null;
    validDays: number | null;
    lastUpdate: string | null;
  };
  byOperation?: { operationId: string | null; operation: string; km: number | null; vehicles: number | null }[];
  byType?: { vehicleTypeId: string | null; type: string; km: number | null; vehicles: number | null }[];
  byStatus?: Record<string, number> | null;
  freshness?: Record<string, number> | null;
  topVehicles?: ReportRankedVehicle[];
  bottomVehicles?: ReportRankedVehicle[];
  insights?: ReportInsight[];
}

export interface ReportOperationRow {
  operationId: string | null;
  operation: string;
  km: number | null;
  vehicles: number | null;
  avgPerVehicle: number | null;
  medianPerVehicle: number | null;
  p90PerVehicle: number | null;
  kmPerDay: number | null;
  coveragePct: number | null;
  deviationVsOverallPct: number | null;
  sharePct: number | null;
}

export interface ReportLocationRow {
  operationId: string | null;
  operation: string;
  state: string | null;
  city: string | null;
  br: string | null;
  km: number | null;
  vehicles: number | null;
  avgPerVehicle: number | null;
  medianPerVehicle: number | null;
  kmPerDay: number | null;
  coveragePct: number | null;
  sharePct: number | null;
}

export interface ReportCohort {
  key: string;
  level: string;
  label: string;
  vehicles: number;
  eligible: number;
  sufficient: boolean;
  mean: number | null;
  median: number | null;
  q1: number | null;
  q3: number | null;
  p10: number | null;
  p90: number | null;
  min: number | null;
  max: number | null;
  range: number | null;
  iqr: number | null;
  cvPct: number | null;
  odometerMedian: number | null;
  odometerIqr: number | null;
  odometerIqrPrevious: number | null;
  aboveP90: number;
  outliers: number;
}

export interface ReportVehicle extends KmVehicleCard {
  cohortKey: string;
  cohortLabel: string;
  cohortLevel: string;
  eligible: boolean;
  kmPeriod: number | null;
  readingDays: number | null;
  coveragePct: number | null;
  dailyAvg: number | null;
  odometer: number | null;
  cohortSize: number | null;
  cohortDailyMedian: number | null;
  cohortOdometerMedian: number | null;
  dailyPercentile: number | null;
  odometerPercentile: number | null;
  robustZ: number | null;
  band: string | null;
  outlier: string | null;
  quadrant: string | null;
  deviationPct: number | null;
  operation: string | null;
  br: string | null;
  local: string | null;
  projection: { d30: number; d60: number; d90: number; confidence: string } | null;
  preventive: { cycleNumber: number | null; milestoneKm: number | null; kmRemaining: number | null; daysEstimate: number | null } | null;
}

export interface ReportAnalysis {
  period: { from: string; to: string; previousFrom: string; previousTo: string };
  totals: { km: number | null; vehicles: number | null; days: number | null };
  byOperation: ReportOperationRow[];
  byLocation: ReportLocationRow[];
  cohorts: ReportCohort[];
  vehicles: ReportVehicle[];
  quadrants: Record<string, number> | null;
  insights: ReportInsight[];
}

export interface ManagementReport {
  overview: ReportOverview | null;
  analysis: ReportAnalysis | null;
  /** Leituras que falharam (ex.: sem permissão para a análise) — o relatório sai com o que veio. */
  errors: string[];
  period: { from: string; to: string } | null;
  payload: ReturnType<typeof kmFiltersPayload>;
}

const message = (reason: unknown) =>
  (reason instanceof Error ? reason.message : String(reason)).replace(/^km_\w+:\s*/, "");

export async function loadManagementReport(organizationId: string, filters: KmFilters): Promise<ManagementReport> {
  const payload = kmFiltersPayload(filters);
  const [ov, an] = await Promise.allSettled([
    kmRpc<ReportOverview>("km_overview", { p_organization_id: organizationId, p_filters: payload }),
    kmRpc<ReportAnalysis>("km_analysis", { p_organization_id: organizationId, p_filters: payload }),
  ]);
  const overview = ov.status === "fulfilled" ? ov.value : null;
  const analysis = an.status === "fulfilled" ? an.value : null;
  const errors: string[] = [];
  if (ov.status === "rejected") errors.push(`Visão geral: ${message(ov.reason)}`);
  if (an.status === "rejected") errors.push(`Análise gerencial: ${message(an.reason)}`);
  const period = analysis?.period ?? overview?.period ?? null;
  return {
    overview,
    analysis,
    errors,
    period: period ? { from: period.from, to: period.to } : null,
    payload,
  };
}

/**
 * Faixas de localização vêm em níveis (operação › UF › cidade › BR) num único
 * conjunto. Rótulo do nível pelo que a linha traz, e linhas idênticas uma vez só.
 */
export function locationRows(rows: ReportLocationRow[]): (ReportLocationRow & { level: string })[] {
  const seen = new Set<string>();
  const out: (ReportLocationRow & { level: string })[] = [];
  for (const r of rows) {
    const level = r.br ? "BR" : r.city && r.city !== "Sem local" ? "Cidade" : r.state ? "UF" : "Operação";
    const key = JSON.stringify([level, r.operationId, r.state, r.city, r.br, r.km, r.vehicles]);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ ...r, level });
  }
  return out;
}
