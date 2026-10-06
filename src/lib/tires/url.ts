import type { Json } from "@/types/database.types";
import { TIRES_FILTER_PARAM, type TiresFilters } from "./types";

/**
 * Filtros da Gestão de Pneus ↔ URL ↔ payload das rotinas. Um lugar só: a
 * tela, a exportação e os links entre abas leem e escrevem os mesmos
 * parâmetros, e o banco recebe sempre ids e códigos canônicos (nunca nomes).
 */
export type SearchParamsLike = Record<string, string | string[] | undefined>;

export const firstParam = (params: SearchParamsLike, key: string): string | undefined => {
  const value = params[key];
  const v = Array.isArray(value) ? value[0] : value;
  return v === "" ? undefined : v;
};

export function parseTiresFilters(params: SearchParamsLike): TiresFilters {
  const out: TiresFilters = {};
  for (const [key, param] of Object.entries(TIRES_FILTER_PARAM) as [keyof TiresFilters, string][]) {
    const v = firstParam(params, param);
    if (v) out[key] = v;
  }
  if (out.reference && !/^\d{4}-\d{2}-\d{2}$/.test(out.reference)) delete out.reference;
  return out;
}

export const splitList = (value: string | undefined): string[] =>
  (value ?? "")
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
const ints = (value: string | undefined): number[] =>
  splitList(value)
    .map(Number)
    .filter((n) => Number.isInteger(n));
const truthy = (v: string | undefined) => v === "1" || v === "true";

/** Filtros da tela → chaves de `private.tire_rows`. */
export function tiresFiltersPayload(f: TiresFilters): Record<string, Json> {
  const out: Record<string, Json> = {};
  const put = (key: string, values: (string | number)[]) => {
    if (values.length) out[key] = values;
  };
  if (f.reference) out.reference_date = f.reference;
  put("operation_ids", splitList(f.operation));
  put("state_ids", ints(f.state));
  put("city_ids", ints(f.city));
  put("br_ids", splitList(f.br));
  put("leader_ids", splitList(f.leader));
  put("unit_ids", splitList(f.unit));
  put("vehicle_type_ids", splitList(f.vehicleType));
  put("vehicle_ids", splitList(f.vehicle));
  put("statuses", splitList(f.status));
  put("brands", splitList(f.brand));
  put("models", splitList(f.model));
  put("dimensions", splitList(f.dimension));
  put("lives", ints(f.life));
  put("positions", splitList(f.position));
  put("tread_classes", splitList(f.tread));
  put("measurement_statuses", splitList(f.measurement));
  put("calibration_statuses", splitList(f.calibration));
  put("psi_statuses", splitList(f.psi));
  put("severities", splitList(f.severity));
  if (truthy(f.quality)) out.quality_only = true;
  if (truthy(f.retread)) out.retread_only = true;
  if (f.q?.trim()) out.search = f.q.trim();
  return out;
}

/** Filtros → query string (para links e para as rotas de exportação). */
export function tiresFiltersQuery(f: TiresFilters, extra: Record<string, string | null | undefined> = {}): string {
  const p = new URLSearchParams();
  for (const [key, param] of Object.entries(TIRES_FILTER_PARAM) as [keyof TiresFilters, string][]) {
    const v = f[key];
    if (v) p.set(param, String(v));
  }
  for (const [k, v] of Object.entries(extra)) if (v) p.set(k, v);
  return p.toString();
}

/** Quantos filtros estão ativos (fora a busca e a fotografia). */
export function tiresActiveFilterCount(f: TiresFilters): number {
  return (Object.keys(TIRES_FILTER_PARAM) as (keyof TiresFilters)[]).filter(
    (k) => k !== "q" && k !== "reference" && Boolean(f[k]),
  ).length;
}

export function parsePage(params: SearchParamsLike, key = "pagina", size = 50): { limit: number; offset: number; page: number } {
  const n = Number(firstParam(params, key) ?? "1");
  const page = Number.isInteger(n) && n > 0 ? n : 1;
  return { limit: size, offset: (page - 1) * size, page };
}

/** Ordenações aceitas por `tires_base` (o padrão é a severidade). */
const BASE_SORTS = ["fire_number", "status", "plate", "fleet", "brand", "position", "tread", "measurement", "calibration", "psi", "life", "km", "operation"] as const;
export type TiresBaseSort = (typeof BASE_SORTS)[number];
export function parseBaseSort(params: SearchParamsLike): { sort: TiresBaseSort | null; dir: "asc" | "desc" } {
  const s = firstParam(params, "ordem");
  const d = firstParam(params, "dir");
  return {
    sort: s && (BASE_SORTS as readonly string[]).includes(s) ? (s as TiresBaseSort) : null,
    dir: d === "desc" ? "desc" : "asc",
  };
}
