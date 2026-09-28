/**
 * Manutenção (Etapa 16) — tipos e vocabulário compartilhados.
 *
 * Sem `"server-only"` e sem `"use server"`: a tela e as rotinas de servidor
 * falam a mesma língua. Os códigos são os do banco; os rótulos, os da operação.
 * Nenhuma regra mora aqui — status, KM, TMM e bandas chegam calculados.
 */
import type { StatusTone } from "@/components/ui/status-badge";

export type MaintenanceStatus = "to_schedule" | "scheduled" | "in_progress" | "completed" | "cancelled" | "not_performed";
export type MaintenanceTypeCode = "preventive" | "corrective" | "predictive" | (string & {});
export type Criticality = "low" | "medium" | "high" | "critical";
export type KmStatus =
  | "validated" | "compatible" | "estimated" | "manual" | "divergent" | "not_found" | "pending_future" | "to_review";
export type KmSource = "official_reading" | "interpolated" | "manual" | "import";
export type ItemStatus = "pending" | "done" | "not_done" | "cancelled";
export type ItemResult = "resolved" | "partially_resolved" | "not_resolved";
export type PreventiveStatus = "completed" | "no_km" | "not_reached" | "to_schedule" | "due" | "critical";
export type PredictiveStatus = "critical" | "due" | "to_schedule" | "upcoming" | "ok" | "initial_inspection" | "no_km";
export type PredictiveExecution = "to_schedule" | "scheduled" | "in_progress" | "awaiting_corrective" | "not_programmed";
export type Conformity = "conforming" | "monitor" | "non_conforming" | "not_performed" | "no_verification";
export type VerificationResult = "conforming" | "monitor" | "non_conforming" | "not_performed";
export type PlanStatus = "draft" | "in_review" | "approved" | "archived";

export type MaintenanceTab = "visao-geral" | "programacao" | "preventiva" | "preditiva" | "base" | "cadastros" | "importacoes";
export const MAINTENANCE_TABS: MaintenanceTab[] = [
  "visao-geral", "programacao", "preventiva", "preditiva", "base", "cadastros", "importacoes",
];
export const TAB_LABEL: Record<MaintenanceTab, string> = {
  "visao-geral": "Visão geral",
  programacao: "Programação & execução",
  preventiva: "Preventiva",
  preditiva: "Preditiva",
  base: "Base geral",
  cadastros: "Cadastros",
  importacoes: "Importações",
};

// ---------------------------------------------------------------------------
// Vocabulário
// ---------------------------------------------------------------------------
export const STATUS_LABEL: Record<MaintenanceStatus, string> = {
  to_schedule: "Há agendar",
  scheduled: "Agendado",
  in_progress: "Em execução",
  completed: "Concluído",
  cancelled: "Cancelado",
  not_performed: "Não realizada",
};
export const STATUS_TONE: Record<MaintenanceStatus, StatusTone> = {
  to_schedule: "warning",
  scheduled: "info",
  in_progress: "progress",
  completed: "success",
  cancelled: "neutral",
  not_performed: "danger",
};
export const OPEN_STATUSES: MaintenanceStatus[] = ["to_schedule", "scheduled", "in_progress"];

export const TYPE_LABEL: Record<string, string> = {
  preventive: "Preventiva",
  corrective: "Corretiva",
  predictive: "Preditiva",
};
export const typeLabel = (code: string | null | undefined, fallback?: string | null) =>
  (code && TYPE_LABEL[code]) || fallback || code || "—";

export const CRITICALITY_LABEL: Record<Criticality, string> = {
  low: "Baixa",
  medium: "Média",
  high: "Alta",
  critical: "Crítica",
};
export const CRITICALITY_TONE: Record<Criticality, StatusTone> = {
  low: "neutral",
  medium: "info",
  high: "warning",
  critical: "danger",
};

export const KM_STATUS_LABEL: Record<KmStatus, string> = {
  validated: "Validado",
  compatible: "Compatível",
  estimated: "Estimado",
  manual: "Manual",
  divergent: "Divergente",
  not_found: "Não encontrado",
  pending_future: "Pendente (data futura)",
  to_review: "A revisar",
};
export const KM_STATUS_TONE: Record<KmStatus, StatusTone> = {
  validated: "success",
  compatible: "success",
  estimated: "info",
  manual: "neutral",
  divergent: "danger",
  not_found: "warning",
  pending_future: "pending",
  to_review: "warning",
};
export const KM_STATUS_HINT: Record<KmStatus, string> = {
  validated: "Leitura oficial na própria data de referência.",
  compatible: "Leitura oficial a poucos dias da referência (janela configurada).",
  estimated: "Interpolado entre leituras oficiais ou a leitura mais próxima dentro da janela de estimativa.",
  manual: "Informado na manutenção, com justificativa, e coerente com as leituras oficiais.",
  divergent: "Informado na manutenção e incoerente com as leituras oficiais vizinhas. Não bloqueia; fica sinalizado.",
  not_found: "O veículo não tem leitura oficial de KM.",
  pending_future: "A referência é futura; o KM será resolvido quando a data chegar.",
  to_review: "Há leituras, mas longe demais da referência para estimar com segurança.",
};
export const KM_SOURCE_LABEL: Record<KmSource, string> = {
  official_reading: "Leitura oficial",
  interpolated: "Interpolação",
  manual: "Informado",
  import: "Importação",
};

export const ITEM_STATUS_LABEL: Record<ItemStatus, string> = {
  pending: "Pendente",
  done: "Executado",
  not_done: "Não executado",
  cancelled: "Removido",
};
export const ITEM_RESULT_LABEL: Record<ItemResult, string> = {
  resolved: "Resolvido",
  partially_resolved: "Parcialmente resolvido",
  not_resolved: "Não resolvido",
};
export const RESOLUTION_LABEL: Record<string, string> = {
  pending: "Pendente",
  resolved: "Resolvido",
  partially_resolved: "Parcialmente resolvido",
  not_resolved: "Não resolvido",
};

export const PREVENTIVE_STATUS_LABEL: Record<PreventiveStatus, string> = {
  completed: "Realizada",
  no_km: "Sem KM",
  not_reached: "Não atingida",
  to_schedule: "A programar",
  due: "Vencida",
  critical: "Crítica",
};
export const PREVENTIVE_STATUS_TONE: Record<PreventiveStatus, StatusTone> = {
  completed: "success",
  no_km: "pending",
  not_reached: "neutral",
  to_schedule: "info",
  due: "warning",
  critical: "danger",
};
export const ADHERENCE_LABEL: Record<string, string> = {
  early: "Antecipada",
  on_time: "No prazo",
  late: "Atrasada",
};

export const PREDICTIVE_STATUS_LABEL: Record<PredictiveStatus, string> = {
  critical: "Crítico",
  due: "Vencido",
  to_schedule: "A programar",
  upcoming: "Próximo",
  ok: "Em dia",
  initial_inspection: "Inspeção inicial",
  no_km: "Sem KM",
};
export const PREDICTIVE_STATUS_TONE: Record<PredictiveStatus, StatusTone> = {
  critical: "danger",
  due: "warning",
  to_schedule: "info",
  upcoming: "progress",
  ok: "success",
  initial_inspection: "pending",
  no_km: "neutral",
};
export const EXECUTION_LABEL: Record<PredictiveExecution, string> = {
  to_schedule: "Há agendar",
  scheduled: "Agendada",
  in_progress: "Em execução",
  awaiting_corrective: "Aguardando corretiva",
  not_programmed: "Não programada",
};
export const CONFORMITY_LABEL: Record<Conformity, string> = {
  conforming: "Conforme",
  monitor: "Monitorar",
  non_conforming: "Não conforme",
  not_performed: "Não realizado",
  no_verification: "Sem verificação",
};
export const VERIFICATION_RESULT_LABEL: Record<VerificationResult, string> = {
  conforming: "CONFORME",
  monitor: "MONITORAR",
  non_conforming: "NÃO CONFORME",
  not_performed: "NÃO REALIZADO",
};
export const VERIFICATION_RESULT_TONE: Record<VerificationResult, StatusTone> = {
  conforming: "success",
  monitor: "warning",
  non_conforming: "danger",
  not_performed: "neutral",
};
export const DECISION_LABEL: Record<string, string> = {
  restart_cycle: "Ciclo reiniciado",
  continue_monitoring: "Segue em monitoramento",
  reduce_interval: "Intervalo reduzido (monitorar)",
  open_maintenance: "Manutenção aberta",
  close_monitoring: "Monitoramento encerrado",
  none: "Sem decisão",
};
export const REFERENCE_TYPE_LABEL: Record<string, string> = {
  verification: "Verificação",
  maintenance: "Manutenção",
  manual_reset: "Reinício manual",
  history: "Histórico",
  none: "Sem referência",
};
export const PLAN_STATUS_LABEL: Record<PlanStatus, string> = {
  draft: "Rascunho",
  in_review: "Em revisão",
  approved: "Aprovado",
  archived: "Arquivado",
};
export const PLAN_STATUS_TONE: Record<PlanStatus, StatusTone> = {
  draft: "pending",
  in_review: "info",
  approved: "success",
  archived: "neutral",
};
export const PLAN_SOURCE_LABEL: Record<string, string> = {
  oem: "Fabricante (OEM)",
  internal: "Interno",
  history: "Histórico",
  other: "Outro",
};

export const EVENT_LABEL: Record<string, string> = {
  created: "Aberta",
  scheduled: "Agendada",
  rescheduled: "Reprogramada",
  started: "Entrada na oficina",
  completed: "Concluída",
  reopened: "Reaberta",
  cancelled: "Cancelada",
  not_performed: "Não realizada",
  unscheduled: "Agendamento desfeito",
  supplier_changed: "Fornecedor alterado",
  items_added: "Serviços adicionados",
  item_removed: "Serviço removido",
  item_updated: "Serviço atualizado",
  km_changed: "KM de entrada alterado",
  details_updated: "Dados alterados",
  finding_linked: "Apontamento vinculado",
  finding_unlinked: "Apontamento desvinculado",
  finding_resolved: "Apontamento tratado",
  preventive_updated: "Ciclo preventivo atualizado",
  predictive_updated: "Ciclo preditivo atualizado",
  imported: "Importada",
  import_updated: "Atualizada por importação",
};
export const EVENT_SOURCE_LABEL: Record<string, string> = {
  user: "Usuário",
  import: "Importação",
  system: "Rotina do sistema",
};

export const IMPORT_KIND_LABEL: Record<string, string> = {
  records: "Base de manutenções",
  clusters: "Clusters técnicos",
  services: "Serviços",
  suppliers: "Fornecedores",
  preventive_rules: "Parâmetros preventivos",
};

// ---------------------------------------------------------------------------
// Filtros (URL ↔ banco)
// ---------------------------------------------------------------------------
export interface MaintenanceFilters {
  from?: string;
  to?: string;
  q?: string;
  status?: string;
  type?: string;
  origin?: string;
  priority?: string;
  vehicleType?: string;
  operation?: string;
  state?: string;
  city?: string;
  br?: string;
  leader?: string;
  unit?: string;
  supplier?: string;
  cluster?: string;
  service?: string;
  vehicle?: string;
  km?: string;
  fleet?: "active" | "inactive" | "all";
  openOnly?: boolean;
  /** Fila da Programação — as mesmas definições dos indicadores. */
  queue?: ScheduleQueue;
}

export type ScheduleQueue =
  | "scheduled_today" | "late_entry" | "exit_overdue" | "unscheduled_overdue" | "over_sla" | "completed_today";
export const SCHEDULE_QUEUES: ScheduleQueue[] = [
  "scheduled_today", "late_entry", "exit_overdue", "unscheduled_overdue", "over_sla", "completed_today",
];

/** Nome do parâmetro na URL para cada filtro — curto e em português. */
export const FILTER_PARAM: Record<keyof MaintenanceFilters, string> = {
  from: "de",
  to: "ate",
  q: "q",
  status: "situacao",
  type: "tipo",
  origin: "origem",
  priority: "prioridade",
  vehicleType: "equipamento",
  operation: "operacao",
  state: "uf",
  city: "cidade",
  br: "br",
  leader: "lideranca",
  unit: "filial",
  supplier: "fornecedor",
  cluster: "cluster",
  service: "servico",
  vehicle: "veiculo",
  km: "km",
  fleet: "frota",
  openOnly: "abertas",
  queue: "fila",
};

// ---------------------------------------------------------------------------
// Catálogo
// ---------------------------------------------------------------------------
export interface MaintenanceTypeOption { code: string; name: string; description: string | null }
export interface MaintenanceOrigin {
  id: string;
  code: string;
  name: string;
  description: string | null;
  isActive: boolean;
  isSystem: boolean;
  manualSelectable: boolean;
  organizationId: string | null;
}
export interface MaintenanceCluster {
  id: string;
  code: string;
  name: string;
  description: string | null;
  defaultCriticality: Criticality;
  status: "active" | "inactive";
  sortOrder: number;
  services: number;
}
export interface ChecklistServiceLink {
  id?: string;
  appId: string;
  appName?: string | null;
  questionKey: string;
  fieldKey: string | null;
  questionText?: string | null;
  autoResolve: boolean;
}
export interface MaintenanceService {
  id: string;
  clusterId: string;
  clusterName: string;
  name: string;
  description: string | null;
  criticality: Criticality;
  status: "active" | "inactive";
  isPredictive: boolean;
  expectedHours: number | null;
  maintenanceTypeCodes: string[];
  vehicleTypeIds: string[];
  checklistLinks: ChecklistServiceLink[];
}
export interface MaintenanceSupplier {
  id: string;
  name: string;
  tradeName: string | null;
  documentNumber: string | null;
  address: string | null;
  stateId: number | null;
  stateUf: string | null;
  cityId: number | null;
  cityName: string | null;
  clusterIds: string[];
  serviceIds: string[];
  servedCityIds: number[];
  status: "active" | "inactive";
  notes: string | null;
}
export interface MaintenanceSettings {
  agingBuckets: number[];
  recurrenceWindowDays: number;
  kmCompatibleDays: number;
  kmEstimatedMaxDays: number;
  defaultSlaHours: number;
  scheduleOverdueDays: number;
  predictiveForecastKm: number;
  predictiveForecastDays: number;
}
export const DEFAULT_SETTINGS: MaintenanceSettings = {
  agingBuckets: [2, 5, 10, 20],
  recurrenceWindowDays: 30,
  kmCompatibleDays: 3,
  kmEstimatedMaxDays: 30,
  defaultSlaHours: 72,
  scheduleOverdueDays: 5,
  predictiveForecastKm: 5000,
  predictiveForecastDays: 30,
};
export interface MaintenanceCatalog {
  types: MaintenanceTypeOption[];
  origins: MaintenanceOrigin[];
  clusters: MaintenanceCluster[];
  services: MaintenanceService[];
  suppliers: MaintenanceSupplier[];
  settings: MaintenanceSettings;
}

// ---------------------------------------------------------------------------
// Manutenção
// ---------------------------------------------------------------------------
export interface MaintenanceItemSummary {
  id: string;
  serviceId: string;
  service: string;
  clusterId: string;
  cluster: string;
  criticality: Criticality;
  status: ItemStatus;
  result: ItemResult | null;
}
export interface MaintenanceRow {
  id: string;
  code: string;
  type: string;
  typeName: string | null;
  status: MaintenanceStatus;
  priority: Criticality;
  originId: string | null;
  originName: string | null;
  vehicleId: string;
  licensePlate: string | null;
  fleetCode: string | null;
  operationId: string | null;
  operationName: string | null;
  stateUf: string | null;
  cityId: number | null;
  cityName: string | null;
  brId: string | null;
  brCode: string | null;
  leaderId: string | null;
  leaderName: string | null;
  unitName: string | null;
  supplierId: string | null;
  supplierName: string | null;
  serviceOrderNumber: string | null;
  description: string | null;
  requestedOn: string | null;
  scheduledDate: string | null;
  scheduledTime: string | null;
  expectedExitDate: string | null;
  expectedExitTime: string | null;
  entryDate: string | null;
  entryTime: string | null;
  exitDate: string | null;
  exitTime: string | null;
  durationHours: number | null;
  durationPrecision: "exact" | "date" | null;
  entryKm: number | null;
  entryKmStatus: KmStatus | null;
  entryKmSource: KmSource | null;
  currentKm: number | null;
  ageDays: number | null;
  lateEntry: boolean;
  exitOverdue: boolean;
  reopenCount: number;
  preventiveCycleId: string | null;
  predictiveCycleId: string | null;
  items: MaintenanceItemSummary[];
  createdAt: string;
  updatedAt: string;
  /** Só no histórico por veículo: possível reincidência na janela. */
  recurrent?: boolean;
}
export interface MaintenancePage {
  total: number;
  rows: MaintenanceRow[];
  limit: number;
  offset: number;
  today: string;
}
export type MaintenanceSortKey =
  | "reference" | "requested" | "scheduled" | "entry" | "exit" | "code" | "plate" | "status" | "duration";

export interface MaintenanceEvent {
  id: string;
  type: string;
  fromStatus: MaintenanceStatus | null;
  toStatus: MaintenanceStatus | null;
  reason: string | null;
  source: "user" | "import" | "system";
  actor: string | null;
  occurredAt: string;
  payload: Record<string, unknown>;
}
export interface MaintenanceItemDetail extends MaintenanceItemSummary {
  notes: string | null;
  expectedHours: number | null;
  completedAt: string | null;
}
export interface MaintenanceFindingLink {
  id: string;
  answerId: string;
  executionId: string;
  questionKey: string;
  fieldKey: string | null;
  question: string | null;
  answer: string | null;
  note: string | null;
  checklistDate: string | null;
  linkOrigin: string;
  resolutionStatus: string;
  resolvedAt: string | null;
}
export interface MaintenanceDetail extends MaintenanceRow {
  notes: string | null;
  completionNotes: string | null;
  schedulingNotes: string | null;
  duplicateJustification: string | null;
  contextDate: string | null;
  contextSource: "fidelization" | "allocation" | "none" | null;
  currentKmDate: string | null;
  entryKmOfficial: number | null;
  entryKmDifference: number | null;
  entryKmJustification: string | null;
  entryKmReferenceDate: string | null;
  recurrenceWindowDays: number;
  vehicle: {
    status: string;
    fleetCode: string | null;
    licensePlate: string | null;
    typeName: string | null;
    subcategoryName: string | null;
    makeName: string | null;
    modelName: string | null;
  };
  itemsAll: MaintenanceItemDetail[];
  events: MaintenanceEvent[];
  findings: MaintenanceFindingLink[];
  recurrence: { cluster: string; previousId: string; previousCode: string | null; daysBetween: number; sameService: boolean }[];
  transitions: MaintenanceStatus[];
}

export interface ScheduleKpis {
  today: string;
  toSchedule: number;
  scheduled: number;
  inProgress: number;
  scheduledToday: number;
  lateEntry: number;
  exitOverdue: number;
  unscheduledOverdue: number;
  overSla: number;
  completedToday: number;
  defaultSlaHours: number;
  scheduleOverdueDays: number;
}

export interface HierarchyRow {
  operationId: string | null;
  operationName: string | null;
  stateUf: string | null;
  cityId: number | null;
  cityName: string | null;
  brId: string | null;
  brCode: string | null;
  vehicleId: string;
  licensePlate: string | null;
  fleetCode: string | null;
  total: number;
  open: number;
  inProgress: number;
  lastReference: string | null;
}

export interface VehicleMaintenanceHistory {
  summary: {
    total: number;
    open: number;
    corrective: number;
    preventive: number;
    predictive: number;
    recurrences: number;
    avgDurationHours: number | null;
    lastExit: string | null;
  };
  suppliers: { supplier: string; count: number }[];
  maintenances: MaintenanceRow[];
  recurrenceWindowDays: number;
}

// ---------------------------------------------------------------------------
// Visão geral
// ---------------------------------------------------------------------------
export interface PeriodKpis {
  volume: number;
  completed: number;
  cancelled: number;
  notPerformed: number;
  corrective: number;
  preventive: number;
  predictive: number;
  tmmHours: number | null;
  tmmDays: number | null;
  tmmCorrectiveDays: number | null;
  tmmCorrectiveP90Days: number | null;
  downtimeHours: number;
  slaWithin: number;
  recurrences: number;
}
export interface DashboardKpis extends PeriodKpis {
  open: number;
  toSchedule: number;
  scheduled: number;
  inProgress: number;
  scheduledToday: number;
  lateEntry: number;
  exitOverdue: number;
  unscheduledOverdue: number;
  backlog7d: number;
  activeVehicles: number;
  immobilizedVehicles: number;
  ongoingDowntimeHours: number;
  recurrentVehicles: number;
  preventiveCritical: number;
  preventiveDue: number;
  preventiveToSchedule: number;
  preventiveEarly: number;
  preventiveOnTime: number;
  preventiveLate: number;
  predictiveCritical: number;
}
export interface MaintenanceDashboard {
  period: { from: string; to: string; days: number; today: string; previousFrom: string; previousTo: string };
  kpis: DashboardKpis;
  previous: PeriodKpis;
  monthly: { month: string; total: number; corrective: number; preventive: number; predictive: number }[];
  mix: { type: string; count: number }[];
  statuses: { status: MaintenanceStatus; count: number }[];
  aging: { bucket: string; upper: number | null; count: number }[];
  agingBuckets: number[];
  clusters: { cluster: string; count: number; completed: number; tmmDays: number | null; tmmMedianDays: number | null }[];
  services: { service: string; cluster: string; count: number; tmmDays: number | null }[];
  suppliers: { supplier: string; count: number; completed: number; open: number; tmmDays: number | null }[];
  recurrence: {
    vehicleId: string;
    licensePlate: string | null;
    cluster: string;
    recurrences: number;
    sameService: number;
    avgIntervalDays: number | null;
    last: string | null;
  }[];
  recurrenceWindowDays: number;
}

// ---------------------------------------------------------------------------
// Preventiva
// ---------------------------------------------------------------------------
export interface PreventiveCycleCell {
  id: string;
  number: number;
  status: PreventiveStatus;
  milestoneKm: number;
  kmRemaining: number | null;
  kmExceeded: number | null;
  completedOn: string | null;
  completedKm: number | null;
  completedMaintenanceId: string | null;
  adherence: "early" | "on_time" | "late" | null;
  adherenceKm: number | null;
  adherencePct: number | null;
  openMaintenance: { id: string; code: string; status: MaintenanceStatus } | null;
}
export interface PreventiveMatrixRow {
  vehicleId: string;
  licensePlate: string | null;
  fleetCode: string | null;
  typeName: string | null;
  subcategoryName: string | null;
  modelName: string | null;
  operationId: string | null;
  operationName: string | null;
  cityName: string | null;
  brCode: string | null;
  vehicleStatus: string;
  currentKm: number | null;
  currentKmDate: string | null;
  hasRule: boolean;
  /** Códigos (`no_rule`, `no_km`, `no_cycles`); a tela traduz. */
  diagnostics: string[];
  cycles: PreventiveCycleCell[];
}
export interface PreventiveMatrix {
  today: string;
  situation: "active" | "inactive";
  summary: {
    vehicles: number;
    noRule: number;
    noKm: number;
    notReached: number;
    toSchedule: number;
    due: number;
    critical: number;
    completed: number;
    programmed: number;
  };
  rows: PreventiveMatrixRow[];
}

// ---------------------------------------------------------------------------
// Preditiva
// ---------------------------------------------------------------------------
export interface PredictiveCell {
  cycleId: string;
  status: PredictiveStatus;
  execution: PredictiveExecution;
  conformity: Conformity;
  monitoring: boolean;
  nextKm: number | null;
  nextDate: string | null;
  kmRemaining: number | null;
  daysRemaining: number | null;
  referenceKm: number | null;
  referenceDate: string | null;
  referenceType: string;
  lastVerificationOn: string | null;
  openMaintenanceId: string | null;
  openMaintenanceCode: string | null;
}
export interface PredictiveAlert extends PredictiveCell {
  vehicleId: string;
  licensePlate: string | null;
  fleetCode: string | null;
  operationName: string | null;
  planName: string;
  cluster: string;
  item: string;
  criticality: Criticality;
  currentKm: number | null;
}
export interface PredictiveOverview {
  today: string;
  summary: {
    itemsMonitored: number;
    critical: number;
    due: number;
    toSchedule: number;
    upcoming: number;
    ok: number;
    initialInspection: number;
    noKm: number;
    monitoring: number;
    scheduled: number;
    inProgress: number;
    awaitingCorrective: number;
    forecastKm: number;
    forecastDays: number;
    forecastKmWindow: number;
    forecastDaysWindow: number;
  };
  coverage: { activeVehicles: number; coveredVehicles: number; uncoveredVehicles: number; coveragePct: number | null };
  /** Clusters com itens críticos/vencidos (`critical`) ou a programar (`toSchedule`). */
  criticalClusters: { cluster: string; critical: number; toSchedule: number }[];
  columns: { itemId: string; item: string; clusterId: string; cluster: string }[];
  rows: {
    vehicleId: string;
    licensePlate: string | null;
    fleetCode: string | null;
    typeName: string | null;
    modelName: string | null;
    operationName: string | null;
    cityName: string | null;
    planName: string | null;
    currentKm: number | null;
    currentKmDate: string | null;
    worst: number;
    /** Chave: id do item do plano. */
    cells: Record<string, PredictiveCell>;
  }[];
  alerts: PredictiveAlert[];
}
export interface PredictiveChecklistStep { key: string; description: string; required: boolean }
export interface PredictiveCycleHistory {
  item: {
    id: string;
    name: string;
    serviceId: string | null;
    intervalKm: number | null;
    intervalDays: number | null;
    technicalDescription: string | null;
    checklist: PredictiveChecklistStep[];
  };
  verifications: {
    id: string;
    result: VerificationResult;
    decision: string;
    verifiedOn: string;
    km: number | null;
    responsible: string | null;
    notes: string | null;
    monitorKm: number | null;
    monitorDays: number | null;
    maintenanceId: string | null;
    checklist: { key: string; answer: string }[];
    createdAt: string;
  }[];
  maintenances: {
    id: string;
    code: string;
    type: string;
    status: MaintenanceStatus;
    services: string | null;
    entryDate: string | null;
    exitDate: string | null;
    entryKm: number | null;
    serviceOrderNumber: string | null;
  }[];
}

// ---------------------------------------------------------------------------
// Parâmetros (Cadastros)
// ---------------------------------------------------------------------------
export interface PreventiveRule {
  id: string;
  vehicleTypeId: string;
  vehicleTypeName: string;
  vehicleSubcategoryId: string | null;
  vehicleSubcategoryName: string | null;
  vehicleModelId: string | null;
  vehicleModelName: string | null;
  serviceId: string | null;
  serviceName: string | null;
  intervalKm: number;
  initialKm: number;
  cycleCount: number;
  alertBeforePct: number;
  toleranceAfterPct: number;
  criticality: Criticality;
  status: "active" | "inactive";
  notes: string | null;
  vehicles: number;
  updatedAt: string;
}
export interface PredictivePlanItem {
  id: string;
  clusterId: string;
  clusterName: string;
  serviceId: string | null;
  serviceName: string | null;
  name: string;
  technicalDescription: string | null;
  intervalKm: number | null;
  intervalDays: number | null;
  intervalEngineHours: number | null;
  alertPct: number;
  schedulePct: number;
  tolerancePct: number;
  criticality: Criticality;
  sortOrder: number;
  isActive: boolean;
  checklist: PredictiveChecklistStep[];
  coverage: { serviceId: string; serviceName: string; coverage: "full" | "partial" }[];
}
export interface PredictivePlan {
  id: string;
  code: string;
  name: string;
  description: string | null;
  vehicleTypeId: string;
  vehicleTypeName: string;
  vehicleSubcategoryId: string | null;
  vehicleSubcategoryName: string | null;
  vehicleMakeId: string | null;
  vehicleMakeName: string | null;
  vehicleModelId: string | null;
  vehicleModelName: string | null;
  yearFrom: number | null;
  yearTo: number | null;
  source: string;
  referenceDocument: string | null;
  oemReference: string | null;
  version: number;
  approvalStatus: PlanStatus;
  approvedAt: string | null;
  approvedByName: string | null;
  isActive: boolean;
  notes: string | null;
  vehicles: number;
  updatedAt: string;
  items: PredictivePlanItem[];
  versions: { version: number; approvalStatus: PlanStatus; reason: string | null; createdAt: string; createdByName: string | null }[];
}
export interface MaintenanceParameters {
  preventiveRules: PreventiveRule[];
  predictivePlans: PredictivePlan[];
}

// ---------------------------------------------------------------------------
// Abertura (assistente)
// ---------------------------------------------------------------------------
export interface MaintenanceContext {
  date: string;
  source: "fidelization" | "allocation" | "none";
  operationId: string | null;
  operationName: string | null;
  operationCityId: string | null;
  stateId: number | null;
  stateUf: string | null;
  cityId: number | null;
  cityName: string | null;
  operationBrId: string | null;
  brCode: string | null;
  organizationUnitId: string | null;
  unitName: string | null;
  leaderEmployeeId: string | null;
  leaderName: string | null;
}
export interface KmResolution {
  km: number | null;
  /** Só no KM informado: diferença para o KM oficial da data. */
  difference?: number | null;
  status: KmStatus;
  source: KmSource | null;
  officialKm: number | null;
  readingId: string | null;
  readingDate: string | null;
  referenceDate: string;
}
export interface VehicleContext {
  vehicle: {
    id: string;
    status: string;
    archived: boolean;
    fleetCode: string | null;
    licensePlate: string | null;
    vehicleTypeId: string | null;
    typeName: string | null;
    subcategoryName: string | null;
    makeName: string | null;
    modelName: string | null;
  };
  context: MaintenanceContext;
  currentKm: { km: number | null; date: string | null };
  kmAtDate: KmResolution | null;
  open: OpenEquivalent[];
  preventiveRule: boolean;
  preventiveCycles: {
    id: string;
    number: number;
    status: PreventiveStatus;
    milestoneKm: number;
    kmRemaining: number | null;
    kmExceeded: number | null;
    openMaintenanceCode: string | null;
  }[];
  predictiveAttention: { cycleId: string; item: string; cluster: string; status: PredictiveStatus; execution: PredictiveExecution }[];
}
/** Manutenção aberta do mesmo veículo — base do aviso de duplicidade. */
export interface OpenEquivalent {
  id: string;
  code: string;
  status: MaintenanceStatus;
  statusLabel: string;
  type: string;
  requestedOn: string | null;
  scheduledDate: string | null;
  entryDate: string | null;
  sameService: boolean;
  sameCluster: boolean;
  items: { service: string; cluster: string }[];
}
export interface VehicleOption {
  id: string;
  licensePlate: string | null;
  fleetCode: string | null;
  typeName: string | null;
  status: string;
}
export interface ChecklistFinding {
  answerId: string;
  executionId: string;
  appId: string;
  operationalDate: string;
  submittedAt: string | null;
  checklistType: string;
  questionKey: string;
  clusterKey: string;
  questionText: string;
  answer: string;
  criticality: string;
  note: string | null;
  links: { linkId: string; maintenanceId: string; code: string; status: MaintenanceStatus; resolutionStatus: string }[];
  suggestedServiceIds: string[];
}

// ---------------------------------------------------------------------------
// Utilidades de leitura
// ---------------------------------------------------------------------------
const camelKey = (key: string) => key.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());

/**
 * snake_case → camelCase, em profundidade. As chaves que são ids (UUIDs, como
 * as colunas da matriz preditiva) não têm "_" e passam intactas.
 */
export function camelize<T>(value: unknown): T {
  if (Array.isArray(value)) return value.map((v) => camelize(v)) as T;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[camelKey(k)] = camelize(v);
    return out as T;
  }
  return value as T;
}

const nf0 = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

export const formatInt = (v: number | null | undefined) => (v == null ? "—" : nf0.format(v));
export const formatKm = (v: number | null | undefined) => (v == null ? "—" : `${nf0.format(v)} km`);
export const formatDays = (v: number | null | undefined) => (v == null ? "—" : `${nf1.format(v)} d`);
export const formatHours = (v: number | null | undefined) => (v == null ? "—" : `${nf1.format(v)} h`);

/** aaaa-mm-dd → dd/mm/aaaa, sem passar por Date (sem fuso). */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
}
export function formatTime(t: string | null | undefined): string {
  return t ? t.slice(0, 5) : "";
}
export function formatDateTime(date: string | null | undefined, time?: string | null): string {
  if (!date) return "—";
  const t = formatTime(time);
  return t ? `${formatDate(date)} ${t}` : formatDate(date);
}
/** Carimbo ISO completo, no fuso de São Paulo. */
export function formatStamp(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit",
  }).format(d);
}
export const vehicleLabel = (plate: string | null | undefined, fleet: string | null | undefined) =>
  [fleet, plate].filter(Boolean).join(" · ") || "—";
