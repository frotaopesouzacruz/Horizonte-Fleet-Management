import "server-only";

import type { KmLoadContext } from "./context";
import { kmRpcRaw } from "./rpc";
import { camelize } from "./types";

/**
 * Análise gerencial do KM (`km_analysis`): totais, recortes por operação e por
 * local (grouping sets), coortes técnicas com dispersão e outliers, quadrantes,
 * projeções do hodômetro, próximo marco preventivo e leituras determinísticas.
 * Tudo calculado no banco sobre a mesma grade veículo × dia; a tela só
 * apresenta, ordena e agrupa para exibir.
 */
export interface KmAnalysisPeriod {
  from: string;
  to: string;
  previousFrom?: string | null;
  previousTo?: string | null;
}

export interface KmAnalysisTotals {
  km: number | null;
  vehicles: number | null;
  /** Dias com KM que conta nos totais. */
  days: number | null;
}

export interface KmAnalysisOperationRow {
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

/**
 * Linha de `by_location` (grouping sets): só operação = nível 1; + estado =
 * nível 2; + cidade = nível 3; + BR = nível 4. `city` volta "Sem local" quando
 * a cidade não entra no agrupamento ou é nula.
 */
export interface KmAnalysisLocationRow {
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

/** Coorte técnica (tipo · subcategoria · modelo, com recuo N1 → N3). Estatísticas sobre KM/dia. */
export interface KmAnalysisCohort {
  key: string;
  level: string | null;
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
  aboveP90?: number | null;
  outliers?: number | null;
}

export interface KmAnalysisProjection {
  d30: number | null;
  d60: number | null;
  d90: number | null;
  confidence: "high" | "medium" | "low" | string | null;
}

export interface KmAnalysisPreventive {
  cycleNumber: number | null;
  milestoneKm: number | null;
  kmRemaining: number | null;
  daysEstimate: number | null;
}

export interface KmAnalysisVehicle {
  vehicleId: string;
  plate: string;
  fleetCode: string | null;
  status: string | null;
  type: string | null;
  subcategory: string | null;
  model: string | null;
  vehicleTypeId?: string | null;
  subcategoryId?: string | null;
  modelId?: string | null;
  cohortKey: string;
  cohortLabel: string | null;
  cohortLevel: string | null;
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
  /** Código de KM_BAND. */
  band: string | null;
  /** Código de KM_OUTLIER (ponto para análise, nunca erro). */
  outlier: string | null;
  /** Código de KM_QUADRANT. */
  quadrant: string | null;
  deviationPct: number | null;
  operation: string | null;
  br: string | null;
  local: string | null;
  projection: KmAnalysisProjection | null;
  preventive: KmAnalysisPreventive | null;
}

export interface KmAnalysisInsight {
  tone: "success" | "warning" | "danger" | "info" | "neutral" | string;
  text: string;
}

export interface KmAnalysisData {
  period?: KmAnalysisPeriod;
  totals?: KmAnalysisTotals;
  byOperation?: KmAnalysisOperationRow[];
  byLocation?: KmAnalysisLocationRow[];
  cohorts?: KmAnalysisCohort[];
  vehicles?: KmAnalysisVehicle[];
  /** Contagem por quadrante — chaves nos códigos do banco (KM_QUADRANT). */
  quadrants?: Record<string, number>;
  insights?: KmAnalysisInsight[];
}

export async function loadAnalysis(ctx: KmLoadContext): Promise<KmAnalysisData> {
  const raw = await kmRpcRaw<Record<string, unknown> | null>("km_analysis", {
    p_organization_id: ctx.organizationId,
    p_filters: ctx.payload,
  });
  if (!raw) return {};
  const data = camelize<KmAnalysisData>(raw);
  // As chaves de `quadrants` são códigos (high_km_high_use…): ficam como o banco devolve.
  const quadrants = raw.quadrants;
  data.quadrants = quadrants && typeof quadrants === "object" ? (quadrants as Record<string, number>) : {};
  return data;
}
