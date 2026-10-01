import { FILTER_PARAM, type ActionPlanFilters, type Deadline } from "./types";

/**
 * Filtros do Plano de Ação ↔ URL. Um lugar só: a tela, o drill-down dos
 * indicadores e a exportação leem e escrevem os mesmos parâmetros.
 */
export type SearchParamsLike = Record<string, string | string[] | undefined>;

export const firstParam = (params: SearchParamsLike, key: string): string | undefined => {
  const value = params[key];
  const v = Array.isArray(value) ? value[0] : value;
  return v === "" ? undefined : v;
};

const isoDate = (v: string | undefined) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined);

const DEADLINES: Deadline[] = ["overdue", "today", "soon", "on_time", "no_due", "treated_on_time", "treated_late", "cancelled"];

export function parseActionPlanFilters(params: SearchParamsLike): ActionPlanFilters {
  const get = (key: keyof ActionPlanFilters) => firstParam(params, FILTER_PARAM[key]);
  const group = get("statusGroup");
  const fleet = get("fleet");
  const withM = get("withMaintenance");
  const deadline = get("deadline");
  return {
    from: isoDate(get("from")),
    to: isoDate(get("to")),
    q: get("q"),
    status: get("status"),
    statusGroup: group === "open" || group === "closed" ? group : undefined,
    priority: get("priority"),
    operation: get("operation"),
    state: get("state"),
    city: get("city"),
    unit: get("unit"),
    br: get("br"),
    leader: get("leader"),
    vehicle: get("vehicle"),
    vehicleType: get("vehicleType"),
    cluster: get("cluster"),
    question: get("question"),
    actionKey: get("actionKey"),
    responsible: get("responsible"),
    unassigned: get("unassigned") === "1",
    withMaintenance: withM === "yes" || withM === "no" ? withM : undefined,
    deadline: (DEADLINES as string[]).includes(deadline ?? "") ? (deadline as Deadline) : undefined,
    recurrence: get("recurrence") === "1",
    fleet: fleet === "active" || fleet === "inactive" || fleet === "all" ? fleet : undefined,
    mine: get("mine") === "1",
  };
}

/** Filtros → parâmetros de URL (para links de drill-down e para a navegação). */
export function filtersToParams(f: ActionPlanFilters): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of Object.keys(FILTER_PARAM) as (keyof ActionPlanFilters)[]) {
    const v = f[key];
    if (v === undefined || v === false || v === "") continue;
    out[FILTER_PARAM[key]] = v === true ? "1" : String(v);
  }
  return out;
}

/** Quantos filtros estão ativos (período e busca contam). */
export function activeFilterCount(f: ActionPlanFilters): number {
  return (Object.keys(FILTER_PARAM) as (keyof ActionPlanFilters)[]).filter((k) => {
    const v = f[k];
    return v !== undefined && v !== false && v !== "";
  }).length;
}

export const MODULE_PATH = "/checklist/planos-acao";

/** Link para o portal de planos com filtros (drill-down). */
export function plansHref(filters: ActionPlanFilters, extra: Record<string, string> = {}): string {
  const params = new URLSearchParams({ aba: "planos", ...filtersToParams(filters), ...extra });
  return `${MODULE_PATH}?${params.toString()}`;
}
