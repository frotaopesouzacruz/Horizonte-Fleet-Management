import { TIRES_FILTER_PARAM, type TiresFilters, type TiresGroupBy, type TiresTab } from "@/lib/tires/types";
import { splitList } from "@/lib/tires/url";
import type { TiresNavLink } from "../tires-ui";

/**
 * Peças comuns das seções da Visão Geral: o link para outra aba (que não leva
 * junto o estado próprio desta) e o filtro cruzado — clicar numa barra aplica o
 * filtro global correspondente, e clicar de novo o retira.
 */

/** Link para outra aba (null quando o perfil não vê a aba). */
export type Nav = (tab: TiresTab, patch?: Record<string, string | null>) => TiresNavLink | null;

/** Estado próprio da Visão Geral na URL: sai quando um link leva a outra aba. */
export const OVERVIEW_OWNED: Record<string, null> = { grupo: null, prioridade: null, pagina: null, perfil: null, onde: null };

/** Grupo vazio ("sem operação/local/liderança", marca sem nome…) como o banco devolve. */
export const NONE_KEY = "—";

/** Filtros globais que um clique nos gráficos da Visão Geral aplica. */
export type CrossField =
  | "operation" | "city" | "leader" | "vehicleType" | "brand" | "model" | "dimension" | "life" | "status"
  | "tread" | "measurement" | "calibration" | "psi";

/** O grupo vazio de operação/local/liderança vira o filtro `sem=`; os demais não filtram. */
const MISSING_PARAM: Partial<Record<CrossField, string>> = { operation: "operacao", city: "local", leader: "lideranca" };

export const GROUP_FIELD: Record<TiresGroupBy, CrossField> = { operation: "operation", city: "city", leader: "leader" };

/** O item já é o filtro aplicado? */
export function isFilterActive(filters: TiresFilters, field: CrossField, key: string): boolean {
  if (key === NONE_KEY || key === "") {
    const missing = MISSING_PARAM[field];
    return Boolean(missing) && !filters[field] && splitList(filters.missing).includes(missing as string);
  }
  return filters[field] === key;
}

/** O item pode virar filtro? ("—" só para operação, local e liderança.) */
export const canFilter = (field: CrossField, key: string) => (key !== NONE_KEY && key !== "") || Boolean(MISSING_PARAM[field]);

/**
 * Patch de URL que aplica (ou, em "toggle", retira quando já aplicado) o filtro
 * de um item. O grupo vazio usa `sem=` e nunca convive com o id do mesmo campo.
 * null = o item não filtra.
 */
export function filterPatch(
  filters: TiresFilters,
  field: CrossField,
  key: string,
  mode: "toggle" | "set" = "toggle",
): Record<string, string | null> | null {
  if (!canFilter(field, key)) return null;
  const param = TIRES_FILTER_PARAM[field];
  const missing = MISSING_PARAM[field];
  const sem = splitList(filters.missing);
  const off = mode === "toggle" && isFilterActive(filters, field, key);
  if (key === NONE_KEY || key === "") {
    const rest = sem.filter((m) => m !== missing);
    return { [param]: null, [TIRES_FILTER_PARAM.missing]: (off ? rest : [...rest, missing as string]).join(",") || null };
  }
  const patch: Record<string, string | null> = { [param]: off ? null : key };
  if (missing && sem.includes(missing)) patch[TIRES_FILTER_PARAM.missing] = sem.filter((m) => m !== missing).join(",") || null;
  return patch;
}

/** Participação em % com uma casa (só apresentação: a contagem vem pronta do banco). */
export const shareOf = (part: number | null | undefined, total: number | null | undefined): number | null =>
  part == null || !total ? null : Math.round((1000 * part) / total) / 10;
