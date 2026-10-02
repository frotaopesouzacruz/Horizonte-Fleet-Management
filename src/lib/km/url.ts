import type { Json } from "@/types/database.types";
import { KM_FILTER_PARAM, type KmFilters } from "./types";

/**
 * Filtros do KM ↔ URL ↔ payload das rotinas. Um lugar só: a tela, os
 * relatórios e os links entre abas leem e escrevem os mesmos parâmetros, e o
 * banco recebe sempre ids (nunca nomes).
 */
export type SearchParamsLike = Record<string, string | string[] | undefined>;

export const firstParam = (params: SearchParamsLike, key: string): string | undefined => {
  const value = params[key];
  const v = Array.isArray(value) ? value[0] : value;
  return v === "" ? undefined : v;
};

const isoDate = (v: string | undefined) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined);
const competence = (v: string | undefined) => (v && /^\d{4}-(0[1-9]|1[0-2])$/.test(v) ? v : undefined);

export function parseKmFilters(params: SearchParamsLike): KmFilters {
  const get = (key: keyof KmFilters) => firstParam(params, KM_FILTER_PARAM[key]);
  const fleet = get("fleet");
  return {
    competence: competence(get("competence")),
    from: isoDate(get("from")),
    to: isoDate(get("to")),
    operation: get("operation"),
    state: get("state"),
    city: get("city"),
    br: get("br"),
    leader: get("leader"),
    unit: get("unit"),
    vehicleType: get("vehicleType"),
    subcategory: get("subcategory"),
    model: get("model"),
    vehicle: get("vehicle"),
    status: get("status"),
    fleet: fleet === "active" || fleet === "inactive" || fleet === "all" ? fleet : undefined,
    q: get("q"),
  };
}

const list = (value: string | undefined): string[] =>
  (value ?? "")
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
const ints = (value: string | undefined): number[] =>
  list(value)
    .map(Number)
    .filter((n) => Number.isInteger(n));

/** Filtros da tela → chaves de `private.km_grid` / `private.km_period`. */
export function kmFiltersPayload(f: KmFilters, opts: { withPeriod?: boolean } = {}): Record<string, Json> {
  const out: Record<string, Json> = {};
  const put = (key: string, values: (string | number)[]) => {
    if (values.length) out[key] = values;
  };
  if (opts.withPeriod !== false) {
    if (f.from && f.to) {
      out.date_from = f.from;
      out.date_to = f.to;
    } else if (f.competence) {
      out.competence = f.competence;
    }
  }
  put("operation_ids", list(f.operation));
  put("state_ids", ints(f.state));
  put("city_ids", ints(f.city));
  put("br_ids", list(f.br));
  put("leader_ids", list(f.leader));
  put("unit_ids", list(f.unit));
  put("vehicle_type_ids", list(f.vehicleType));
  put("subcategory_ids", list(f.subcategory));
  put("model_ids", list(f.model));
  put("vehicle_ids", list(f.vehicle));
  put("reading_statuses", list(f.status));
  if (f.fleet) out.fleet_status = f.fleet;
  if (f.q?.trim()) out.search = f.q.trim();
  return out;
}

/** Filtros → query string (para links e para as rotas de exportação). */
export function kmFiltersQuery(f: KmFilters, extra: Record<string, string | null | undefined> = {}): string {
  const p = new URLSearchParams();
  for (const [key, param] of Object.entries(KM_FILTER_PARAM) as [keyof KmFilters, string][]) {
    const v = f[key];
    if (v) p.set(param, String(v));
  }
  for (const [k, v] of Object.entries(extra)) if (v) p.set(k, v);
  return p.toString();
}

/** Quantos filtros (fora o período) estão ativos. */
export function kmActiveFilterCount(f: KmFilters): number {
  return (Object.keys(KM_FILTER_PARAM) as (keyof KmFilters)[]).filter(
    (k) => !["competence", "from", "to"].includes(k) && Boolean(f[k]),
  ).length;
}
