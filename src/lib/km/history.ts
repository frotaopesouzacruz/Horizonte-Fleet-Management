import "server-only";

import type { KmLoadContext } from "./context";
import { kmRpc } from "./rpc";
import type { KmFreshnessBucket, KmVehicleCard } from "./types";
import { firstParam } from "./url";

/**
 * Histórico por frota — `km_vehicle_history(p_vehicle_id, p_from, p_to)`.
 *
 * O veículo vem do parâmetro `veiculo` (o mesmo do filtro global) e o período
 * de `de`/`ate`, ambos opcionais: sem período, a rotina devolve os últimos
 * seis meses até a última leitura (no máximo 400 dias). Sem veículo, a tela
 * pede a escolha — nada é carregado.
 */

/** Saúde do hodômetro (`private.km_odometer_health`). */
export type KmOdometerHealth = "healthy" | "attention" | "critical" | "no_data";

export interface KmHistoryKpis {
  /** Hodômetro da última leitura confiável (até hoje). */
  currentKm: number | null;
  lastReadingDate: string | null;
  /** Dias desde a última leitura (até ontem). */
  missingDays: number | null;
  freshness: KmFreshnessBucket | null;
  readingDays: number;
  noReadingDays: number;
  noMovementDays: number;
  kmPeriod: number;
  avgDaily: number | null;
  medianDaily: number | null;
  maxDaily: number | null;
  regressions: number;
  jumps: number;
  divergences: number;
  coveragePct: number | null;
  health: KmOdometerHealth | null;
}

/** Um dia da grade do veículo. `status` = "future" para dias depois de hoje. */
export interface KmHistoryDay {
  day: string;
  status: string;
  odometerStart: number | null;
  odometerEnd: number | null;
  /** KM validado do dia (nulo quando não conta: sem leitura, inconsistente). */
  km: number | null;
  kmInformed: number | null;
  alerts: string[] | null;
  readingId: string | null;
  corrected: boolean | null;
  br: string | null;
  local: string | null;
}

export interface KmHistoryMonth {
  month: string;
  km: number;
  readingDays: number;
  noReadingDays: number;
  noMovementDays: number;
  avgDaily: number | null;
  medianDaily: number | null;
}

export interface KmHistoryProjection {
  /** Mediana do KM/dia nos dias com leitura dos últimos 30 dias. */
  rateKmDay: number | null;
  coverage30dPct: number | null;
  confidence: "high" | "medium" | "low" | "none";
  horizons: { days: number; km: number; odometer: number }[] | null;
}

export interface KmHistoryPreventive {
  cycleNumber: number | null;
  milestoneKm: number | null;
  kmRemaining: number | null;
  daysEstimate: number | null;
  dateEstimate: string | null;
  overdue: boolean | null;
}

export interface KmHistoryAuditEntry {
  at: string;
  day: string | null;
  action: string;
  /** { campo: { from, to } } — chaves já em camelCase. */
  changes: Record<string, { from?: unknown; to?: unknown } | null> | null;
  reason: string | null;
  actor: string | null;
}

export interface KmHistoryData {
  /** Nulo quando nenhum veículo foi escolhido. */
  vehicle: KmVehicleCard | null;
  period?: { from: string; to: string };
  kpis?: KmHistoryKpis;
  daily?: KmHistoryDay[];
  monthly?: KmHistoryMonth[];
  projection?: KmHistoryProjection | null;
  preventive?: KmHistoryPreventive | null;
  /** Só vem com `km.view_audit` (senão, nulo). */
  audit?: KmHistoryAuditEntry[] | null;
  canCorrect?: boolean;
  /** O que a URL pediu (o período devolvido pode ter sido ajustado pela rotina). */
  request?: { vehicleId: string | null; from: string | null; to: string | null };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO = /^\d{4}-\d{2}-\d{2}$/;

/** Primeiro id válido de `veiculo` (o filtro global aceita lista separada por vírgula). */
function vehicleParam(ctx: KmLoadContext): string | null {
  const raw = firstParam(ctx.params, "veiculo") ?? ctx.filters.vehicle ?? "";
  const id = raw
    .split(",")
    .map((v) => v.trim())
    .find(Boolean);
  return id && UUID.test(id) ? id : null;
}

function dateParam(ctx: KmLoadContext, key: "de" | "ate"): string | null {
  const v = firstParam(ctx.params, key);
  return v && ISO.test(v) ? v : null;
}

export async function loadHistory(ctx: KmLoadContext): Promise<KmHistoryData> {
  const vehicleId = vehicleParam(ctx);
  let from = dateParam(ctx, "de");
  let to = dateParam(ctx, "ate");
  // Datas trocadas: o intervalo é o mesmo, só na ordem certa.
  if (from && to && from > to) [from, to] = [to, from];
  const request = { vehicleId, from, to };
  if (!vehicleId) return { vehicle: null, request };

  const data = await kmRpc<Omit<KmHistoryData, "request"> | null>("km_vehicle_history", {
    p_vehicle_id: vehicleId,
    p_from: from,
    p_to: to,
  });
  if (!data) return { vehicle: null, request };
  return { ...data, vehicle: data.vehicle ?? null, request };
}
