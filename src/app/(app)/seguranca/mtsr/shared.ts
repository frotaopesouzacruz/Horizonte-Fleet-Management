/**
 * Contratos da tela Segurança → Gestão de MTSR.
 *
 * O servidor carrega só a aba aberta (mais as opções dos filtros); cada
 * painel recebe os dados da aba e este contexto. Todo o estado mora na URL —
 * um link copiado abre a mesma visão.
 */
import type { MtsrFilterOptions } from "@/lib/mtsr/queries";
import type { MtsrFilters, MtsrNavigate, MtsrPerms, MtsrTab } from "@/lib/mtsr/types";

export interface MtsrPanelContext {
  basePath: string;
  tab: MtsrTab;
  filters: MtsrFilters;
  options: MtsrFilterOptions;
  perms: MtsrPerms;
  /** Parâmetros crus da URL (estado próprio da aba: página, ordem, sub-aba…). */
  params: Record<string, string>;
  navigate: MtsrNavigate;
  pending: boolean;
  refresh: () => void;
  /** Erro de carga da aba (o painel mostra; o resto da tela segue). */
  error: string | null;
}

export interface MtsrViewData<T = unknown> {
  basePath: string;
  tab: MtsrTab;
  tabs: MtsrTab[];
  filters: MtsrFilters;
  options: MtsrFilterOptions;
  perms: MtsrPerms;
  params: Record<string, string>;
  tabData: T | null;
  error: string | null;
}
