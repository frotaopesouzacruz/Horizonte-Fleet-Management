/**
 * Contratos da tela Gestão de Frota → Manutenção.
 *
 * O servidor carrega só a aba aberta (mais o catálogo e as opções de filtro,
 * que todas usam); cada painel recebe o que precisa por aqui. Todo o estado
 * mora na URL — um link copiado abre a mesma visão.
 */
import type {
  HierarchyRow,
  MaintenanceCatalog,
  MaintenanceDashboard,
  MaintenanceFilters,
  MaintenancePage,
  MaintenanceParameters,
  MaintenanceSortKey,
  MaintenanceTab,
  PredictiveOverview,
  PreventiveMatrix,
  ScheduleKpis,
} from "@/lib/maintenance/types";
import type {
  MaintenanceFilterOptions,
  MaintenanceImportHistoryRow,
  PredictiveFilters,
  PreventiveFilters,
} from "@/lib/maintenance/queries";

export interface MaintenancePerms {
  view: boolean;
  viewDashboard: boolean;
  viewBase: boolean;
  create: boolean;
  edit: boolean;
  schedule: boolean;
  reschedule: boolean;
  start: boolean;
  complete: boolean;
  reopen: boolean;
  export: boolean;
  import: boolean;
  managePreventive: boolean;
  managePredictive: boolean;
  manageServices: boolean;
  manageClusters: boolean;
  manageSuppliers: boolean;
  manageParameters: boolean;
  viewAudit: boolean;
  reprocess: boolean;
}

export const PERMISSION_CODES: Record<keyof MaintenancePerms, string> = {
  view: "maintenance.view",
  viewDashboard: "maintenance.view_dashboard",
  viewBase: "maintenance.view_base",
  create: "maintenance.create",
  edit: "maintenance.edit",
  schedule: "maintenance.schedule",
  reschedule: "maintenance.reschedule",
  start: "maintenance.start",
  complete: "maintenance.complete",
  reopen: "maintenance.reopen",
  export: "maintenance.export",
  import: "maintenance.import",
  managePreventive: "maintenance.manage_preventive",
  managePredictive: "maintenance.manage_predictive",
  manageServices: "maintenance.manage_services",
  manageClusters: "maintenance.manage_clusters",
  manageSuppliers: "maintenance.manage_suppliers",
  manageParameters: "maintenance.manage_parameters",
  viewAudit: "maintenance.view_audit",
  reprocess: "maintenance.reprocess",
};

/** A tela só esconde; quem decide é o banco, na mesma transação da escrita. */
export function buildPerms(has: (code: string) => boolean): MaintenancePerms {
  const out = {} as MaintenancePerms;
  for (const [key, code] of Object.entries(PERMISSION_CODES)) out[key as keyof MaintenancePerms] = has(code);
  return out;
}

export const canSeeCatalog = (p: MaintenancePerms) =>
  p.manageServices || p.manageClusters || p.manageSuppliers || p.manageParameters || p.managePredictive || p.view;

/** Abas visíveis para as permissões (a ordem é a oficial da Etapa 16). */
export function visibleTabs(p: MaintenancePerms): MaintenanceTab[] {
  const tabs: MaintenanceTab[] = [];
  if (p.viewDashboard) tabs.push("visao-geral");
  tabs.push("programacao", "preventiva", "preditiva");
  if (p.viewBase) tabs.push("base");
  if (canSeeCatalog(p)) tabs.push("cadastros");
  if (p.import) tabs.push("importacoes");
  return tabs;
}

export type Navigate = (patch: Record<string, string | null>) => void;

export type CatalogSection =
  | "clusters" | "servicos" | "fornecedores" | "preventiva" | "preditiva" | "origens" | "configuracoes";
export const CATALOG_SECTIONS: CatalogSection[] = [
  "clusters", "servicos", "fornecedores", "preventiva", "preditiva", "origens", "configuracoes",
];

export interface ListState {
  sort: MaintenanceSortKey;
  dir: "asc" | "desc";
  page: number;
  pageSize: number;
}

export interface MaintenanceViewData {
  basePath: string;
  tab: MaintenanceTab;
  today: string;
  filters: MaintenanceFilters;
  catalog: MaintenanceCatalog;
  options: MaintenanceFilterOptions;
  perms: MaintenancePerms;
  /** Visão geral. */
  dashboard?: MaintenanceDashboard | null;
  /** Programação & execução. */
  schedule?: { kpis: ScheduleKpis | null; page: MaintenancePage | null; list: ListState };
  /** Preventiva. */
  preventive?: { matrix: PreventiveMatrix | null; filters: PreventiveFilters };
  /** Preditiva. */
  predictive?: { overview: PredictiveOverview | null; filters: PredictiveFilters };
  /** Base geral. */
  base?: { view: "tabela" | "hierarquia"; page: MaintenancePage | null; hierarchy: HierarchyRow[] | null; list: ListState };
  /** Cadastros. */
  cadastros?: { section: CatalogSection; parameters: MaintenanceParameters | null };
  /** Importações. */
  importacoes?: { history: MaintenanceImportHistoryRow[] | null };
}

/** O que os painéis usam para abrir a gaveta ou o assistente. */
export interface PanelActions {
  navigate: Navigate;
  pending: boolean;
  /** Reexecuta a leitura da página (depois de uma escrita). */
  refresh: () => void;
  openMaintenance: (id: string) => void;
  openWizard: (preset?: WizardPreset) => void;
}

export interface WizardPreset {
  vehicleId?: string;
  maintenanceTypeCode?: string;
  originCode?: string;
  checklistAnswerIds?: string[];
  serviceIds?: string[];
}
