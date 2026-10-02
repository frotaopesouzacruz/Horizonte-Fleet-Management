import type { Json } from "@/types/database.types";
import type { KmFilters, KmPerms } from "./types";
import type { SearchParamsLike } from "./url";

/** O que cada carregador de aba recebe do servidor. */
export interface KmLoadContext {
  organizationId: string;
  filters: KmFilters;
  /** Filtros já no formato das rotinas (ids). */
  payload: Record<string, Json>;
  /** Parâmetros crus da URL (estado próprio de cada aba: dia, veículo, sub-aba…). */
  params: SearchParamsLike;
  perms: KmPerms;
}
