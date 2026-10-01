import type { MaintenanceCatalog } from "@/lib/maintenance/types";
import type { MaintenancePerms, WizardPreset } from "@/app/(app)/frota/manutencao/shared";
import type {
  ActionPlanCatalog,
  ActionPlanDashboard,
  ActionPlanFilters,
  ActionPlanPage,
  ActionPlansTab,
  ActionPlanSortKey,
  ActionPlanDetail,
  ExecutionTrace,
  GroupRow,
  MaintenanceCandidate,
  Grouping,
  HealthData,
  HistoryPage,
  MappingData,
  MyViewData,
  QualityData,
  ReconciliationPage,
} from "@/lib/action-plans/types";
import type { HistoryFilters } from "@/lib/action-plans/queries";

/**
 * Gestão de Checklist › Planos de Ação — contratos entre a página, a casca e
 * os painéis. O estado vive na URL; cada painel recebe só o que a aba aberta
 * carregou no servidor.
 */

export const BASE_PATH = "/checklist/planos-acao";

export const TAB_LABEL: Record<ActionPlansTab, string> = {
  "visao-geral": "Visão geral",
  planos: "Planos de manutenção",
  conciliacao: "Conciliação × Manutenções",
  parametros: "Parâmetros & Mapeamento",
  qualidade: "Qualidade & Auditoria",
  "minha-visao": "Minha visão",
  historico: "Histórico de checklists",
};

/** Permissões do módulo (o servidor confere de novo em cada rotina). */
export interface ActionPlanPerms {
  view: boolean;
  viewOwn: boolean;
  viewDashboard: boolean;
  manage: boolean;
  assign: boolean;
  changePriority: boolean;
  openMaintenance: boolean;
  linkMaintenance: boolean;
  resolveWithoutMaintenance: boolean;
  markImproper: boolean;
  cancel: boolean;
  reopen: boolean;
  manageParameters: boolean;
  manageMappings: boolean;
  reconcile: boolean;
  import: boolean;
  export: boolean;
  viewAudit: boolean;
  reprocess: boolean;
  /** Manutenção › Abrir manutenção (o assistente oficial exige as duas). */
  maintenanceCreate: boolean;
  /** Manutenção › Ver (para abrir o detalhe da manutenção vinculada). */
  maintenanceView: boolean;
}

export const PERMISSION_CODES: Record<keyof ActionPlanPerms, string> = {
  view: "action_plans.view",
  viewOwn: "action_plans.view_own",
  viewDashboard: "action_plans.view_dashboard",
  manage: "action_plans.manage",
  assign: "action_plans.assign",
  changePriority: "action_plans.change_priority",
  openMaintenance: "action_plans.open_maintenance",
  linkMaintenance: "action_plans.link_maintenance",
  resolveWithoutMaintenance: "action_plans.resolve_without_maintenance",
  markImproper: "action_plans.mark_improper",
  cancel: "action_plans.cancel",
  reopen: "action_plans.reopen",
  manageParameters: "action_plans.manage_parameters",
  manageMappings: "action_plans.manage_mappings",
  reconcile: "action_plans.reconcile",
  import: "action_plans.import",
  export: "action_plans.export",
  viewAudit: "action_plans.view_audit",
  reprocess: "action_plans.reprocess",
  maintenanceCreate: "maintenance.create",
  maintenanceView: "maintenance.view",
};

export function buildPerms(has: (code: string) => boolean): ActionPlanPerms {
  const out = {} as ActionPlanPerms;
  for (const [key, code] of Object.entries(PERMISSION_CODES)) out[key as keyof ActionPlanPerms] = has(code);
  return out;
}

/** Abas visíveis para as permissões, na ordem oficial. */
export function visibleTabs(p: ActionPlanPerms): ActionPlansTab[] {
  const tabs: ActionPlansTab[] = [];
  if (p.viewDashboard) tabs.push("visao-geral");
  tabs.push("planos", "conciliacao", "parametros");
  if (p.viewAudit) tabs.push("qualidade");
  tabs.push("minha-visao", "historico");
  return tabs;
}

export type Navigate = (patch: Record<string, string | null>) => void;

/** O que os painéis usam para navegar, recarregar e abrir gaveta/assistente. */
export interface PanelActions {
  navigate: Navigate;
  pending: boolean;
  refresh: () => void;
  /** Abre a gaveta do plano (?plano=). */
  openPlan: (planId: string) => void;
  /** Abre o detalhe da manutenção (gaveta oficial da Manutenção). */
  openMaintenance: (maintenanceId: string) => void;
  /** Abre o assistente oficial de Manutenção, pré-preenchido pelo plano. */
  openWizard: (preset: WizardPreset) => void;
  /** Abre o rastro de um checklist (checklist → inconformidade → plano → manutenção → resolução). */
  openTrace: (executionId: string) => void;
}

export interface ListState {
  sort: ActionPlanSortKey;
  dir: "asc" | "desc";
  page: number;
  pageSize: number;
}

/**
 * Dados fixos para a prévia de desenvolvimento (/dev/preview-planos-acao): as
 * gavetas leem daqui em vez de chamar o servidor. Nunca preenchido na tela real.
 */
export interface PreviewFixtures {
  details?: Record<string, ActionPlanDetail>;
  candidates?: Record<string, MaintenanceCandidate[]>;
  traces?: Record<string, ExecutionTrace>;
}

export interface ActionPlansViewData {
  /** Caminho da tela (a prévia de desenvolvimento usa o seu). */
  basePath: string;
  tab: ActionPlansTab;
  today: string;
  orgId: string;
  filters: ActionPlanFilters;
  catalog: ActionPlanCatalog;
  perms: ActionPlanPerms;
  /** Catálogo da Manutenção (serviços, origens…) — para o assistente e a gaveta oficiais. */
  maintenanceCatalog: MaintenanceCatalog | null;
  maintenancePerms: MaintenancePerms | null;
  /** Visão geral */
  dashboard?: ActionPlanDashboard | null;
  /** Planos: agrupamento escolhido, árvore e lista paginada */
  plans?: {
    grouping: Grouping | "list";
    groups: GroupRow[] | null;
    page: ActionPlanPage | null;
    list: ListState;
  };
  /** Conciliação */
  reconciliation?: { page: ReconciliationPage | null; confidence: string | null; list: ListState };
  /** Parâmetros & mapeamento */
  mapping?: MappingData | null;
  /** Qualidade & auditoria, saúde da integração */
  quality?: { quality: QualityData | null; health: HealthData | null; days: number; section: "qualidade" | "saude" | "importacao" };
  /** Minha visão */
  myView?: MyViewData | null;
  /** Histórico de checklists */
  history?: { page: HistoryPage | null; filters: HistoryFilters; list: ListState };
  /** Só na prévia de desenvolvimento. */
  fixtures?: PreviewFixtures;
}

export const PAGE_SIZES = [25, 50, 100, 200];
