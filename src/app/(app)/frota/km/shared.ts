/**
 * Contratos da tela Gestão de Frota → Gestão de KM Rodado.
 *
 * O servidor carrega só a aba aberta (mais as opções dos filtros); cada
 * painel recebe os dados da aba e este contexto. Todo o estado mora na URL —
 * um link copiado abre a mesma visão.
 */
import type { KmFilterOptions } from "@/lib/km/options";
import type { KmFilters, KmNavigate, KmPerms, KmTab } from "@/lib/km/types";

export interface KmPanelContext {
  basePath: string;
  tab: KmTab;
  filters: KmFilters;
  options: KmFilterOptions;
  perms: KmPerms;
  /** Parâmetros crus da URL (estado próprio da aba). */
  params: Record<string, string>;
  navigate: KmNavigate;
  pending: boolean;
  refresh: () => void;
  /** Erro de carga da aba (o painel mostra; o resto da tela segue). */
  error: string | null;
}

export interface KmViewData<T = unknown> {
  basePath: string;
  tab: KmTab;
  tabs: KmTab[];
  filters: KmFilters;
  options: KmFilterOptions;
  perms: KmPerms;
  params: Record<string, string>;
  tabData: T | null;
  error: string | null;
}
