/**
 * Contratos da tela Gestão de Frota → Gestão de Pneus.
 *
 * O servidor carrega só a aba aberta (mais as opções dos filtros); cada
 * painel recebe os dados da aba e este contexto. Todo o estado mora na URL —
 * um link copiado abre a mesma visão.
 */
import type { TireFilterOptions, TiresFilters, TiresNavigate, TiresPerms, TiresTab } from "@/lib/tires/types";

export interface TiresPanelContext {
  basePath: string;
  tab: TiresTab;
  filters: TiresFilters;
  /** Opções oficiais dos filtros (null quando a leitura falhou: os filtros somem, a aba segue). */
  options: TireFilterOptions | null;
  perms: TiresPerms;
  /** Parâmetros crus da URL (estado próprio da aba: página, ordem, sub-aba…). */
  params: Record<string, string>;
  navigate: TiresNavigate;
  pending: boolean;
  refresh: () => void;
  /** Erro de carga da aba (o painel mostra; o resto da tela segue). */
  error: string | null;
}

export interface TiresViewData<T = unknown> {
  basePath: string;
  tab: TiresTab;
  tabs: TiresTab[];
  filters: TiresFilters;
  options: TireFilterOptions | null;
  perms: TiresPerms;
  params: Record<string, string>;
  tabData: T | null;
  error: string | null;
}
