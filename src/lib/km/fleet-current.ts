import "server-only";

import type { KmLoadContext } from "./context";
import { kmRpc } from "./rpc";
import { parseCurrentFreshness, type KmCurrentFreshness, type KmVehicleCard } from "./types";
import { firstParam, kmFiltersPayload } from "./url";

/**
 * KM atual das frotas — `km_fleet_current`: uma linha por frota do recorte
 * com o hodômetro oficial vigente (a leitura mais recente de qualquer origem,
 * a mesma que o Cadastro de Frotas e a Manutenção usam), o contexto de hoje e
 * a atualização. O período não se aplica: a tela é um retrato de hoje.
 */
export interface KmFleetCurrentRow extends KmVehicleCard {
  operationId: string | null;
  operation: string | null;
  state: string | null;
  city: string | null;
  br: string | null;
  leader: string | null;
  contextSource: string | null;
  lastReadingDate: string | null;
  odometerKm: number | null;
  /** Origem da leitura vigente (`vehicle_odometer_readings.source`). */
  source: string | null;
  /** A leitura vigente veio da Gestão de KM (ligada a um dia do razão). */
  fromKmModule: boolean;
  daysSince: number | null;
  freshness: KmCurrentFreshness;
  /** Última leitura do próprio razão de KM, para comparação. */
  kmReadingDate: string | null;
  kmOdometer: number | null;
}

export interface KmFleetCurrentSummary {
  vehicles: number;
  recent: number;
  stale: number;
  never: number;
  avgDays: number | null;
  maxDays: number | null;
  operations: number;
  fromKmModule: number;
  lastReadingDate: string | null;
}

export interface KmFleetCurrentData {
  today: string;
  summary: KmFleetCurrentSummary;
  rows: KmFleetCurrentRow[];
  /** Filtro de atualização ativo (da URL). */
  freshnessFilter: KmCurrentFreshness[];
}

/** Os mesmos filtros da tela, mais a atualização escolhida (`leitura`). */
export function kmFleetCurrentPayload(ctx: Pick<KmLoadContext, "filters" | "params">) {
  const freshness = parseCurrentFreshness(firstParam(ctx.params, "leitura"));
  return {
    freshness,
    payload: { ...kmFiltersPayload(ctx.filters, { withPeriod: false }), freshness: freshness.length ? freshness : null },
  };
}

export async function fetchFleetCurrent(
  organizationId: string,
  payload: Record<string, unknown>,
): Promise<Omit<KmFleetCurrentData, "freshnessFilter">> {
  return kmRpc<Omit<KmFleetCurrentData, "freshnessFilter">>("km_fleet_current", {
    p_organization_id: organizationId,
    p_filters: payload,
  });
}

export async function loadFleetCurrent(ctx: KmLoadContext): Promise<KmFleetCurrentData> {
  const { freshness, payload } = kmFleetCurrentPayload(ctx);
  const data = await fetchFleetCurrent(ctx.organizationId, payload);
  return { ...data, freshnessFilter: freshness };
}
