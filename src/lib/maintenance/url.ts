import {
  DEFAULT_HIERARCHY_LEVELS,
  FILTER_PARAM,
  HIERARCHY_LEVEL_PARAM,
  HIERARCHY_LEVELS,
  SCHEDULE_QUEUES,
  type HierarchyLevel,
  type MaintenanceFilters,
  type ScheduleQueue,
} from "./types";

/**
 * Filtros da Manutenção ↔ URL. Um lugar só: a tela, a exportação e os links
 * entre abas leem e escrevem os mesmos parâmetros.
 */
export type SearchParamsLike = Record<string, string | string[] | undefined>;

export const firstParam = (
  params: SearchParamsLike,
  key: string,
): string | undefined => {
  const value = params[key];
  const v = Array.isArray(value) ? value[0] : value;
  return v === "" ? undefined : v;
};

const isoDate = (v: string | undefined) =>
  v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined;

export function parseMaintenanceFilters(
  params: SearchParamsLike,
): MaintenanceFilters {
  const get = (key: keyof MaintenanceFilters) =>
    firstParam(params, FILTER_PARAM[key]);
  const fleet = get("fleet");
  const queue = get("queue");
  return {
    from: isoDate(get("from")),
    to: isoDate(get("to")),
    q: get("q"),
    status: get("status"),
    type: get("type"),
    origin: get("origin"),
    priority: get("priority"),
    vehicleType: get("vehicleType"),
    operation: get("operation"),
    state: get("state"),
    city: get("city"),
    leader: get("leader"),
    unit: get("unit"),
    supplier: get("supplier"),
    cluster: get("cluster"),
    service: get("service"),
    vehicle: get("vehicle"),
    km: get("km"),
    fleet: fleet === "inactive" || fleet === "all" ? fleet : undefined,
    openOnly: get("openOnly") === "1",
    queue: (SCHEDULE_QUEUES as string[]).includes(queue ?? "")
      ? (queue as ScheduleQueue)
      : undefined,
  };
}

/** Quantos filtros comuns estão ativos (período e busca contam). */
export function activeFilterCount(f: MaintenanceFilters): number {
  return (Object.keys(FILTER_PARAM) as (keyof MaintenanceFilters)[]).filter(
    (k) => {
      const v = f[k];
      return v !== undefined && v !== false && v !== "";
    },
  ).length;
}

// ---------------------------------------------------------------------------
// Níveis da hierarquia da Base geral (`niveis=operacao,cidade,placa`)
// ---------------------------------------------------------------------------
const LEVEL_BY_PARAM = Object.fromEntries(
  (Object.entries(HIERARCHY_LEVEL_PARAM) as [HierarchyLevel, string][]).map(
    ([level, code]) => [code, level],
  ),
) as Record<string, HierarchyLevel>;

/** Códigos desconhecidos são ignorados; repetidos viram um; a ordem é sempre a canônica. */
export function parseHierarchyLevels(
  value: string | undefined,
): HierarchyLevel[] {
  const chosen = new Set<HierarchyLevel>();
  for (const code of (value ?? "").split(",")) {
    const level = LEVEL_BY_PARAM[code.trim().toLowerCase()];
    if (level) chosen.add(level);
  }
  const levels = HIERARCHY_LEVELS.filter((level) => chosen.has(level));
  return levels.length ? levels : DEFAULT_HIERARCHY_LEVELS;
}

export function hierarchyLevelsParam(levels: HierarchyLevel[]): string {
  return HIERARCHY_LEVELS.filter((level) => levels.includes(level))
    .map((level) => HIERARCHY_LEVEL_PARAM[level])
    .join(",");
}
