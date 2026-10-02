import "server-only";

import type { Json } from "@/types/database.types";
import type { KmLoadContext } from "./context";
import { kmRpc } from "./rpc";
import type { KmFilters, KmReadingStatus, KmVehicleCard } from "./types";

/**
 * Planner mês/dia — `km_planner`: a grade veículo × dia da competência, com
 * todas as frotas elegíveis (inclusive as sem leitura), totais por dia, por
 * tipo e por local. A tela e o Controle Mensal (XLSX) leem exatamente este
 * conjunto, com os mesmos filtros.
 */

/** Situação da célula: a do catálogo, ou "future" / "out_of_filter" (dia em outro contexto). */
export type KmPlannerCellStatus = KmReadingStatus | "future" | "out_of_filter";

/** [situação, hodômetro inicial, hodômetro final, KM validado] — KM nulo quando não há KM confiável. */
export type KmPlannerCell = [
  status: KmPlannerCellStatus | (string & {}),
  odometerStart: number | null,
  odometerEnd: number | null,
  km: number | null,
];

export interface KmPlannerDay {
  /** aaaa-mm-dd */
  date: string;
  /** 1 = segunda … 7 = domingo */
  dow: number;
}

export interface KmPlannerRow extends KmVehicleCard {
  /** BR do último dia com contexto no período. */
  br: string | null;
  /** Todos os BRs do período (contexto histórico na data). */
  brs: string[];
  local: string | null;
  locals: string[];
  operation: string | null;
  leader: string | null;
  multiBr: boolean;
  /** KM validado do período (só situações que contam); nulo sem leitura que conte. */
  totalKm: number | null;
  readingDays: number;
  cells: KmPlannerCell[];
}

export interface KmPlannerGroup {
  km: number;
  vehicles: number;
  /** KM por dia, na ordem de `days`. */
  days: (number | null)[];
}

export interface KmPlannerTypeGroup extends KmPlannerGroup {
  type: string;
  vehicleTypeId: string | null;
}

export interface KmPlannerLocalGroup extends KmPlannerGroup {
  local: string;
  cityId: number | null;
}

/** Resumo por operação — quando a rotina passar a devolver (`by_operation`). */
export interface KmPlannerOperationGroup extends KmPlannerGroup {
  operation: string;
  operationId?: string | null;
}

export interface KmPlannerTotals {
  km: number;
  vehicles: number;
  vehiclesWithReading: number;
  /** Veículo-dia com leitura. */
  readingDays: number;
  /** Veículo-dia já decorridos (sem futuro). */
  elapsedVehicleDays: number;
  /** Dias do período com algum KM que conta. */
  daysWithKm: number;
}

export interface KmPlannerData {
  period: { from: string; to: string; competence: string; today: string };
  days: KmPlannerDay[];
  rows: KmPlannerRow[];
  dayTotals: (number | null)[];
  dayReadings: (number | null)[];
  byType: KmPlannerTypeGroup[];
  byLocal: KmPlannerLocalGroup[];
  byOperation?: KmPlannerOperationGroup[];
  totals: KmPlannerTotals;
  generatedAt: string | null;
  /** Extra do carregador: período personalizado da tela, que o planner não usa (trabalha por competência). */
  ignoredPeriod: { from: string; to: string } | null;
}

/**
 * Filtros da tela → `p_filters` do planner. A rotina trabalha por competência:
 * o período personalizado sai do payload e, sem competência explícita, vale o
 * mês da data inicial do período (em vez do último mês com leitura).
 */
export function kmPlannerPayload(filters: KmFilters, payload: Record<string, Json>): Record<string, Json> {
  const out: Record<string, Json> = { ...payload };
  delete out.date_from;
  delete out.date_to;
  if (!out.competence) {
    const competence = filters.competence ?? filters.from?.slice(0, 7);
    if (competence) out.competence = competence;
  }
  return out;
}

/** JSON camelizado da rotina → contrato estável (listas nunca nulas). */
export function normalizePlanner(raw: Partial<KmPlannerData> | null, filters: KmFilters): KmPlannerData {
  const r = raw ?? {};
  const totals = r.totals ?? ({} as Partial<KmPlannerTotals>);
  return {
    period: {
      from: r.period?.from ?? "",
      to: r.period?.to ?? "",
      competence: r.period?.competence ?? r.period?.from?.slice(0, 7) ?? "",
      today: r.period?.today ?? "",
    },
    days: r.days ?? [],
    rows: (r.rows ?? []).map((row) => ({
      ...row,
      brs: row.brs ?? [],
      locals: row.locals ?? [],
      cells: row.cells ?? [],
      readingDays: row.readingDays ?? 0,
      multiBr: Boolean(row.multiBr),
    })),
    dayTotals: r.dayTotals ?? [],
    dayReadings: r.dayReadings ?? [],
    byType: r.byType ?? [],
    byLocal: r.byLocal ?? [],
    byOperation: r.byOperation ?? undefined,
    totals: {
      km: totals.km ?? 0,
      vehicles: totals.vehicles ?? 0,
      vehiclesWithReading: totals.vehiclesWithReading ?? 0,
      readingDays: totals.readingDays ?? 0,
      elapsedVehicleDays: totals.elapsedVehicleDays ?? 0,
      daysWithKm: totals.daysWithKm ?? 0,
    },
    generatedAt: r.generatedAt ?? null,
    ignoredPeriod: filters.from && filters.to ? { from: filters.from, to: filters.to } : null,
  };
}

/** A mesma leitura para a tela e para o arquivo. */
export async function fetchPlanner(organizationId: string, filters: KmFilters, payload: Record<string, Json>): Promise<KmPlannerData> {
  const raw = await kmRpc<Partial<KmPlannerData> | null>("km_planner", {
    p_organization_id: organizationId,
    p_filters: kmPlannerPayload(filters, payload),
  });
  return normalizePlanner(raw, filters);
}

export async function loadPlanner(ctx: KmLoadContext): Promise<KmPlannerData> {
  return fetchPlanner(ctx.organizationId, ctx.filters, ctx.payload);
}
