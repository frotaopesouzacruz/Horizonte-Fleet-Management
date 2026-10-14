/**
 * Contratos da tela Gestão de Frota → Manutenção.
 *
 * O servidor carrega só a aba aberta (mais o catálogo e as opções de filtro,
 * que todas usam); cada painel recebe o que precisa por aqui. Todo o estado
 * mora na URL — um link copiado abre a mesma visão.
 */
import type {
  HierarchyLevel,
  HierarchyNode,
  MaintenanceCatalog,
  MaintenanceDashboard,
  MaintenanceFilters,
  MaintenancePage,
  MaintenanceParameters,
  MaintenanceSortKey,
  MaintenanceTab,
  PredictiveEvents,
  PredictiveIndicators,
  PredictiveOverview,
  PredictiveQuality,
  PredictiveSubmissionSearch,
  PredictiveSummary,
  PredictiveTrends,
  PredictiveVerificationSearch,
  PredictiveView,
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
  /** Capabilities da preditiva (`maintenance.predictive.*`); as legadas continuam valendo. */
  predictiveView: boolean;
  predictiveVerify: boolean;
  predictiveGenerate: boolean;
  predictiveReset: boolean;
  predictivePlans: boolean;
  predictiveRecalculate: boolean;
  predictiveAudit: boolean;
  predictiveApp: boolean;
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
  predictiveView: "maintenance.predictive.view",
  predictiveVerify: "maintenance.predictive.verify",
  predictiveGenerate: "maintenance.predictive.generate_maintenance",
  predictiveReset: "maintenance.predictive.manual_reset",
  predictivePlans: "maintenance.predictive.plans.manage",
  predictiveRecalculate: "maintenance.predictive.recalculate",
  predictiveAudit: "maintenance.predictive.audit.view",
  predictiveApp: "applications.predictive.execute",
};

/**
 * A tela só esconde; quem decide é o banco, na mesma transação da escrita.
 * As capabilities da preditiva aceitam a permissão nova OU a legada
 * (`maintenance.manage_predictive`, `maintenance.reprocess`,
 * `maintenance.view_audit`), exatamente como `private.maintenance_predictive_can`.
 */
export function buildPerms(has: (code: string) => boolean): MaintenancePerms {
  const out = {} as MaintenancePerms;
  for (const [key, code] of Object.entries(PERMISSION_CODES)) out[key as keyof MaintenancePerms] = has(code);
  const legacy = has("maintenance.manage_predictive");
  out.predictiveView = out.predictiveView || out.view;
  out.predictiveVerify = out.predictiveVerify || legacy;
  out.predictiveGenerate = out.predictiveGenerate || legacy;
  out.predictiveReset = out.predictiveReset || legacy;
  out.predictivePlans = out.predictivePlans || legacy;
  out.predictiveRecalculate = out.predictiveRecalculate || legacy || out.reprocess;
  out.predictiveAudit = out.predictiveAudit || out.viewAudit;
  // O que a tela chama de "gerir preditiva" é qualquer uma das capacidades de escrita.
  out.managePredictive = legacy || out.predictiveVerify || out.predictiveGenerate || out.predictiveReset || out.predictivePlans;
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

/**
 * Seções de Manutenção › Cadastros. Fornecedores saiu daqui: é um cadastro da
 * plataforma, em Administração › Fornecedores (`/administracao/fornecedores`);
 * o link antigo (`secao=fornecedores`) é redirecionado para lá.
 */
export type CatalogSection =
  | "clusters" | "servicos" | "preventiva" | "preditiva" | "origens" | "configuracoes";
export const CATALOG_SECTIONS: CatalogSection[] = [
  "clusters", "servicos", "preventiva", "preditiva", "origens", "configuracoes",
];
export const SUPPLIERS_PATH = "/administracao/fornecedores";

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
  /** Visão geral: resumo preditivo (críticos, vencidos, previstos, aguardando corretiva). */
  predictiveSummary?: PredictiveSummary | null;
  /** Programação & execução. */
  schedule?: { kpis: ScheduleKpis | null; page: MaintenancePage | null; list: ListState };
  /** Preventiva. */
  preventive?: { matrix: PreventiveMatrix | null; filters: PreventiveFilters };
  /** Preditiva: só a visão aberta é carregada (o painel sempre tem a visão geral). */
  predictive?: PredictiveViewData;
  /** Base geral. */
  base?: {
    view: "tabela" | "hierarquia";
    page: MaintenancePage | null;
    hierarchy: HierarchyNode[] | null;
    list: ListState;
    /** Níveis da hierarquia, na ordem canônica. */
    levels: HierarchyLevel[];
  };
  /** Cadastros. */
  cadastros?: { section: CatalogSection; parameters: MaintenanceParameters | null };
  /** Importações. */
  importacoes?: { history: MaintenanceImportHistoryRow[] | null };
}

export interface PredictiveViewData {
  view: PredictiveView;
  overview: PredictiveOverview | null;
  filters: PredictiveFilters;
  indicators?: PredictiveIndicators | null;
  trends?: PredictiveTrends | null;
  quality?: PredictiveQuality | null;
  events?: PredictiveEvents | null;
  submissions?: PredictiveSubmissionSearch | null;
  verifications?: PredictiveVerificationSearch | null;
  /** Página e tamanho das listas paginadas no servidor (auditoria, qualidade, envios). */
  page: number;
  pageSize: number;
  /** Parâmetros próprios das visões (pd_inconsistencia, pd_evento, pd_lista…), já achatados. */
  params: Record<string, string>;
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
  /** Abertura a partir de um Plano de Ação (Gestão de Checklist): grava pelo plano. */
  actionPlanId?: string;
  actionPlanCode?: string;
  actionPlanItemIds?: string[];
  description?: string;
  priority?: string;
  /** Abertura a partir de um componente NOK do MTSR: grava pela rotina do MTSR (origem "mtsr", vínculo componente × manutenção). */
  mtsrComponentId?: string;
  mtsrComponentName?: string;
  mtsrInspectionItemId?: string;
}
