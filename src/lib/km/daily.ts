import "server-only";

import type { KmLoadContext } from "./context";
import { kmRpc } from "./rpc";
import type { KmVehicleCard } from "./types";
import { firstParam, kmFiltersPayload } from "./url";

/**
 * Visão diária do KM — `km_daily` sobre a mesma grade veículo × dia. O dia vem
 * do parâmetro `dia` (aaaa-mm-dd); sem ele, a rotina usa o último dia com KM
 * validado. Os filtros vão sem período: o dia é o recorte.
 */
export interface KmDailyKpis {
  kmTotal: number | null;
  vehicles: number;
  vehiclesUsed: number;
  noMovement: number;
  /** Sem leitura (fora as inconsistentes, que estão na lista de inconsistências). */
  noReading: number;
  /** Mesmo critério da lista `inconsistencies` (paridade KPI × lista). */
  inconsistencies: number;
  highMileage: number;
  avgPerVehicle: number | null;
  medianPerVehicle: number | null;
  /** Média diária do mês, do dia 1 até o dia, nos dias com leitura. */
  monthDailyAvg: number | null;
  diffVsMonthAvgPct: number | null;
}

/** Veículo com KM validado no dia (ordem da rotina: maior KM primeiro). */
export interface KmDailyRankRow extends KmVehicleCard {
  km: number | null;
  status: string;
  br: string | null;
  local: string | null;
  operation: string | null;
  leader: string | null;
  odometerStart: number | null;
  odometerEnd: number | null;
}

export interface KmDailyBand {
  band: string;
  label: string;
  vehicles: number;
}

export interface KmDailyGroup {
  label: string;
  km: number | null;
  vehicles: number;
  withReading: number;
}

export interface KmDailyMissing extends KmVehicleCard {
  status: string;
  br: string | null;
  local: string | null;
}

export interface KmDailyInconsistency extends KmVehicleCard {
  readingId: string | null;
  status: string;
  alerts: string[] | null;
  odometerStart: number | null;
  odometerEnd: number | null;
  kmInformed: number | null;
  kmCalculated: number | null;
  /** KM informado − KM calculado. */
  diff: number | null;
  br: string | null;
  local: string | null;
}

export interface KmDailyData {
  /** Dia efetivamente mostrado. */
  date: string;
  /** Extra do carregador: o dia pedido na URL (nulo = padrão da rotina). */
  requestedDay: string | null;
  /** Extra do carregador: "hoje" no fuso padrão da organização, para não avançar ao futuro. */
  today: string;
  kpis: KmDailyKpis;
  ranking: KmDailyRankRow[];
  bands: KmDailyBand[];
  withoutReading: KmDailyMissing[];
  byOperation: KmDailyGroup[];
  byLocal: KmDailyGroup[];
  byBr: KmDailyGroup[];
  byLeader: KmDailyGroup[];
  byType: KmDailyGroup[];
  inconsistencies: KmDailyInconsistency[];
}

/** aaaa-mm-dd de um dia que existe no calendário (31/02 não passa). */
function validDay(v: string | undefined): string | null {
  if (!v || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  const [y, m, d] = v.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return y >= 2000 && dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d ? v : null;
}

/** Hoje em America/Sao_Paulo (fuso padrão das organizações). */
function todayIso(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

export async function loadDaily(ctx: KmLoadContext): Promise<KmDailyData> {
  const requestedDay = validDay(firstParam(ctx.params, "dia"));
  const data = await kmRpc<Omit<KmDailyData, "requestedDay" | "today">>("km_daily", {
    p_organization_id: ctx.organizationId,
    p_date: requestedDay,
    p_filters: kmFiltersPayload(ctx.filters, { withPeriod: false }),
  });
  return {
    ...data,
    ranking: data.ranking ?? [],
    bands: data.bands ?? [],
    withoutReading: data.withoutReading ?? [],
    byOperation: data.byOperation ?? [],
    byLocal: data.byLocal ?? [],
    byBr: data.byBr ?? [],
    byLeader: data.byLeader ?? [],
    byType: data.byType ?? [],
    inconsistencies: data.inconsistencies ?? [],
    requestedDay,
    today: todayIso(),
  };
}
