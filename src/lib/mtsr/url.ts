import type { Json } from "@/types/database.types";
import { MTSR_FILTER_PARAM, type MtsrFilters, type MtsrSortKey } from "./types";

/**
 * Filtros do MTSR ↔ URL ↔ payload das rotinas. Um lugar só: a tela, a
 * exportação e os links entre abas leem e escrevem os mesmos parâmetros, e o
 * banco recebe sempre ids (nunca nomes).
 */
export type SearchParamsLike = Record<string, string | string[] | undefined>;

export const firstParam = (params: SearchParamsLike, key: string): string | undefined => {
  const value = params[key];
  const v = Array.isArray(value) ? value[0] : value;
  return v === "" ? undefined : v;
};

export function parseMtsrFilters(params: SearchParamsLike): MtsrFilters {
  const get = (key: keyof MtsrFilters) => firstParam(params, MTSR_FILTER_PARAM[key]);
  const fleet = get("fleet");
  return {
    operation: get("operation"),
    state: get("state"),
    city: get("city"),
    br: get("br"),
    leader: get("leader"),
    unit: get("unit"),
    vehicleType: get("vehicleType"),
    vehicle: get("vehicle"),
    deadline: get("deadline"),
    conformity: get("conformity"),
    criticality: get("criticality"),
    component: get("component"),
    componentStatus: get("componentStatus"),
    awaiting: get("awaiting"),
    fleet: fleet === "default" || fleet === "inactive" || fleet === "all" ? fleet : undefined,
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

/** Filtros da tela → chaves de `private.mtsr_fleet_filtered`. */
export function mtsrFiltersPayload(f: MtsrFilters): Record<string, Json> {
  const out: Record<string, Json> = {};
  const put = (key: string, values: (string | number)[]) => {
    if (values.length) out[key] = values;
  };
  put("operation_ids", list(f.operation));
  put("state_ids", ints(f.state));
  put("city_ids", ints(f.city));
  put("br_ids", list(f.br));
  put("leader_ids", list(f.leader));
  put("unit_ids", list(f.unit));
  put("vehicle_type_ids", list(f.vehicleType));
  put("vehicle_ids", list(f.vehicle));
  put("deadline_statuses", list(f.deadline));
  put("conformity_statuses", list(f.conformity));
  put("criticalities", list(f.criticality));
  if (f.component) {
    out.component_id = f.component;
    put("component_statuses", list(f.componentStatus));
  }
  if (f.awaiting === "1" || f.awaiting === "true") out.awaiting_revalidation = true;
  if (f.fleet && f.fleet !== "default") out.fleet_status = f.fleet;
  if (f.q?.trim()) out.search = f.q.trim();
  return out;
}

/** Filtros → query string (para links e para as rotas de exportação). */
export function mtsrFiltersQuery(f: MtsrFilters, extra: Record<string, string | null | undefined> = {}): string {
  const p = new URLSearchParams();
  for (const [key, param] of Object.entries(MTSR_FILTER_PARAM) as [keyof MtsrFilters, string][]) {
    const v = f[key];
    if (v) p.set(param, String(v));
  }
  for (const [k, v] of Object.entries(extra)) if (v) p.set(k, v);
  return p.toString();
}

/** Quantos filtros estão ativos (fora a busca). */
export function mtsrActiveFilterCount(f: MtsrFilters): number {
  return (Object.keys(MTSR_FILTER_PARAM) as (keyof MtsrFilters)[]).filter((k) => k !== "q" && Boolean(f[k])).length;
}

const SORT_KEYS: MtsrSortKey[] = ["criticality", "deadline", "nok", "last_inspection", "plate", "operation"];
export function parseSort(params: SearchParamsLike): { sort: MtsrSortKey; dir: "asc" | "desc" } {
  const s = firstParam(params, "ordem");
  const d = firstParam(params, "dir");
  return {
    sort: s && (SORT_KEYS as string[]).includes(s) ? (s as MtsrSortKey) : "criticality",
    dir: d === "asc" ? "asc" : "desc",
  };
}

export function parsePage(params: SearchParamsLike, key = "pagina", size = 50): { limit: number; offset: number; page: number } {
  const n = Number(firstParam(params, key) ?? "1");
  const page = Number.isInteger(n) && n > 0 ? n : 1;
  return { limit: size, offset: (page - 1) * size, page };
}
