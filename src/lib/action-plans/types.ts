/**
 * Gestão de Checklist › Planos de Ação — Plano de Ação de Manutenção.
 *
 * Os tipos espelham o JSON das rotinas do banco (convertido para camelCase por
 * `camelize`). Nenhuma regra mora aqui: situação, prazo, confiança da
 * conciliação e indicadores vêm calculados do servidor.
 */

export type PlanStatus =
  | "new"
  | "in_analysis"
  | "awaiting_maintenance"
  | "maintenance_open"
  | "maintenance_scheduled"
  | "maintenance_in_progress"
  | "pending_new_action"
  | "resolved_without_maintenance"
  | "improper"
  | "resolved"
  | "cancelled";

export type ItemStatus =
  | "pending"
  | "in_maintenance"
  | "needs_action"
  | "resolved"
  | "resolved_without_maintenance"
  | "improper"
  | "cancelled";

export type Priority = "low" | "medium" | "high" | "critical";
export type AnalysisState = "new" | "in_analysis" | "awaiting_maintenance";
/** "upcoming" só existe como filtro: vence hoje ou em breve. */
export type Deadline = "overdue" | "today" | "soon" | "upcoming" | "on_time" | "no_due" | "treated_on_time" | "treated_late" | "cancelled";
export type Confidence = "high" | "medium" | "manual_review" | "none";
export type Grouping = "operation" | "cluster" | "vehicle" | "priority" | "responsible";
export type ResolutionKind = "resolved_without_maintenance" | "improper" | "cancelled" | "validated_by_maintenance";

export type ActionPlansTab =
  | "visao-geral"
  | "planos"
  | "conciliacao"
  | "parametros"
  | "qualidade"
  | "minha-visao"
  | "historico";

export interface MaintenanceRef {
  id: string;
  code: string;
  status: string;
  origin?: string;
  resolutive?: boolean;
}

/** Uma linha do portal (private.action_plan_row_json). */
export interface ActionPlanRow {
  id: string;
  code: string;
  vehicleId: string;
  licensePlate: string | null;
  fleetCode: string | null;
  title: string;
  detailLabel: string | null;
  planKey: string;
  actionKey: string;
  questionKey: string;
  clusterKey: string | null;
  clusterName: string | null;
  criticality: string | null;
  status: PlanStatus;
  analysisState: AnalysisState;
  priority: Priority;
  prioritySource: "parameter" | "criticality" | "user";
  dueOn: string | null;
  dueSource: "sla" | "user";
  deadline: Deadline;
  daysOverdue: number | null;
  ageDays: number | null;
  responsibleUserId: string | null;
  responsibleName: string | null;
  firstOccurrenceAt: string;
  lastOccurrenceAt: string;
  firstOperationalDate: string;
  lastOperationalDate: string;
  occurrences: number;
  openItems: number;
  resolvedItems: number;
  operationId: string | null;
  operationName: string | null;
  stateId: number | null;
  stateUf: string | null;
  cityId: number | null;
  cityName: string | null;
  brId: string | null;
  brCode: string | null;
  unitId: string | null;
  unitName: string | null;
  leaderId: string | null;
  leaderName: string | null;
  vehicleTypeId: string | null;
  vehicleTypeName: string | null;
  maintenances: MaintenanceRef[];
  isRecurrence: boolean;
  cycleNumber: number;
  previousPlanId: string | null;
  reopenedCount: number;
  lastTreatment: string | null;
  lastTreatmentAt: string | null;
  closedAt: string | null;
  autoClosed: boolean;
  requiresMaintenance: boolean;
  tmrDays: number | null;
}

export interface ActionPlanPage {
  total: number;
  rows: ActionPlanRow[];
  limit: number;
  offset: number;
  today: string;
}

export interface GroupNode {
  key: string | number | null;
  label: string;
  sub?: string | null;
}

export interface GroupRow {
  path: GroupNode[];
  plans: number;
  open: number;
  closed: number;
  overdue: number;
  onTime: number;
  critical: number;
  openItems: number;
  occurrences: number;
  recurrences: number;
}

export interface KeyValue {
  key: string;
  value: number;
}

export interface ActionPlanDashboard {
  period: { from: string; to: string; bucket: "day" | "week" | "month"; today: string };
  kpis: {
    findingsReceived: number;
    findingsDamage: number;
    findingsNotEligible: number;
    items: number;
    itemsOpen: number;
    itemsTreated: number;
    itemsRwm: number;
    itemsImproper: number;
    itemsCancelled: number;
    itemsInMaintenance: number;
    plansTotal: number;
    plansActive: number;
    plansOverdue: number;
    plansCritical: number;
    plansWithMaintenance: number;
    plansWithoutMaintenance: number;
    plansRwm: number;
    plansImproper: number;
    plansResolved: number;
    vehiclesPending: number;
    recurrences: number;
    treatmentAdherence: number | null;
    tmrAvgDays: number | null;
    tmrMedianDays: number | null;
    tmrP90Days: number | null;
    onTimePct: number | null;
  };
  funnel: KeyValue[];
  deadline: Partial<Record<Deadline, number>> | null;
  aging: KeyValue[];
  byPriority: { key: Priority; open: number; total: number }[];
  byStatus: { key: PlanStatus; value: number }[];
  byOperation: { key: string | null; label: string; open: number; overdue: number; total: number }[];
  byCity: { key: number | null; label: string; open: number; total: number }[];
  byLeader: { key: string | null; label: string; open: number; total: number }[];
  byCluster: { key: string | null; label: string; open: number; total: number; items: number }[];
  topItems: { key: string; label: string; items: number; plans: number; open: number }[];
  topRecurrentVehicles: { key: string; label: string; sub: string | null; recurrences: number; occurrences: number; open: number }[];
  resolutionOrigin: KeyValue[];
  tmrByPriority: { key: Priority; avg: number | null; median: number | null; n: number }[];
  tmrByCluster: { key: string | null; label: string; avg: number | null; n: number }[];
  trend: { bucket: string; newItems: number; treatedItems: number; newPlans: number; closedPlans: number; backlog: number }[];
  coverage: Coverage;
}

export interface Coverage {
  actionKeys: number;
  mapped: number;
  unmapped: number;
  conflicting: number;
  inactive: number;
  autoResolve: number;
  pct: number | null;
}

export interface PlanItem {
  id: string;
  executionId: string;
  answerId: string;
  questionKey: string;
  question: string;
  answer: "yes" | "no";
  fieldKey: string | null;
  optionValue: string | null;
  optionLabel: string | null;
  conditionalValue: Record<string, unknown> | null;
  detailText: string | null;
  note: string | null;
  checklistType: string | null;
  operationalDate: string;
  occurredAt: string;
  employeeId: string | null;
  employeeName: string | null;
  employeeCode: string | null;
  userName: string | null;
  licensePlate: string | null;
  operationName: string | null;
  brCode: string | null;
  leaderName: string | null;
  status: ItemStatus;
  statusSource: "system" | "user" | "maintenance" | "correction";
  resolvedAt: string | null;
  resolvedByName: string | null;
  resolvedMaintenanceId: string | null;
  resolvedMaintenanceCode: string | null;
  maintenances: { id: string; code: string; status: string; resolutionStatus: string }[];
  lastResolution: {
    type: string;
    reasonCode: string | null;
    reason: string | null;
    observation: string | null;
    by: string | null;
    at: string;
    source: string;
  } | null;
}

export interface PlanResolution {
  id: string;
  itemId: string;
  type: string;
  from: string | null;
  to: string;
  maintenanceId: string | null;
  maintenanceCode: string | null;
  source: string;
  confidence: string | null;
  reasonCode: string | null;
  reason: string | null;
  observation: string | null;
  by: string | null;
  at: string;
  optionLabel: string | null;
  operationalDate: string | null;
}

export interface PlanMaintenanceLink {
  id: string;
  maintenanceId: string;
  code: string;
  status: string;
  type: string;
  originName: string | null;
  requestedOn: string | null;
  scheduledDate: string | null;
  entryDate: string | null;
  exitDate: string | null;
  serviceOrderNumber: string | null;
  supplierName: string | null;
  services: string | null;
  linkStatus: "active" | "unlinked" | "discarded";
  origin: string;
  confidence: string | null;
  rule: string | null;
  resolutive: boolean;
  reason: string | null;
  linkedBy: string | null;
  linkedAt: string;
  unlinkedBy: string | null;
  unlinkedAt: string | null;
  answers: number;
  answersResolved: number;
}

export interface PlanEvent {
  id: string;
  type: string;
  from: string | null;
  to: string | null;
  reason: string | null;
  payload: Record<string, unknown>;
  source: string;
  actor: string | null;
  at: string;
}

export interface PlanExecution {
  id: string;
  operationalDate: string;
  checklistType: string | null;
  submittedAt: string | null;
  employeeName: string | null;
  employeeCode: string | null;
  nonConforming: number;
  licensePlate: string | null;
}

export interface ActionPlanDetail extends ActionPlanRow {
  appId: string;
  fieldKey: string | null;
  optionValue: string | null;
  firstExecutionId: string | null;
  canReopen: boolean;
  openPlanSameProblem: { id: string; code: string } | null;
  previousPlan: { id: string; code: string; status: PlanStatus; closedAt: string | null } | null;
  nextPlans: { id: string; code: string; status: PlanStatus; firstOperationalDate: string }[];
  services: { serviceId: string; name: string; clusterId: string | null; cluster: string | null; autoResolve: boolean; fieldKey: string | null }[];
  items: PlanItem[];
  resolutions: PlanResolution[];
  maintenanceLinks: PlanMaintenanceLink[];
  events: PlanEvent[];
  executions: PlanExecution[];
}

export interface MaintenanceCandidate {
  maintenanceId: string;
  code: string;
  status: string;
  type: string;
  requestedOn: string | null;
  scheduledDate: string | null;
  entryDate: string | null;
  exitDate: string | null;
  services: string | null;
  serviceMatch: boolean;
  autoResolveMatch: boolean;
  clusterMatch: boolean;
  contested: boolean;
  confidence: Exclude<Confidence, "none">;
  rule: string;
}

export interface ReconciliationRow extends ActionPlanRow {
  bestConfidence: Confidence;
  candidates: MaintenanceCandidate[];
}

export interface ReconciliationPage {
  total: number;
  counts: Partial<Record<Confidence, number>>;
  rows: ReconciliationRow[];
  coverage: Coverage;
}

export interface ActionParameter {
  id: string;
  appId: string;
  questionKey: string;
  fieldKey: string | null;
  actionKey: string;
  actionDomain: "maintenance" | "damage";
  questionRole: "trigger" | "standalone" | "detail" | "description";
  generatesPlan: boolean;
  planGrouping: "option" | "question";
  actionTitle: string | null;
  defaultPriority: Priority | null;
  slaDays: number | null;
  requiresMaintenance: boolean;
  requiresManualAnalysis: boolean;
  driverVisible: boolean;
  status: "active" | "inactive";
  notes: string | null;
  updatedAt: string;
}

export interface MappingRow {
  appId: string;
  questionKey: string;
  fieldKey: string | null;
  actionKey: string;
  question: string;
  fieldLabel: string | null;
  fieldType: "text" | "single_select" | "multi_select" | null;
  options: { value: string; label: string }[] | null;
  criticality: string | null;
  clusterKey: string;
  clusterName: string;
  versionLabel: string;
  parameter: ActionParameter | null;
  services: {
    serviceId: string;
    name: string;
    autoResolve: boolean;
    isActive: boolean;
    serviceStatus: string;
    archived: boolean;
    cluster: string | null;
  }[];
  openPlans: number;
}

export interface ActionPlanSettings {
  slaDaysCritical: number;
  slaDaysHigh: number;
  slaDaysMedium: number;
  slaDaysLow: number;
  dueSoonDays: number;
  recurrenceWindowDays: number;
  reconciliationWindowDays: number;
  autoReconcile: boolean;
  updatedAt?: string;
}

export const DEFAULT_SETTINGS: ActionPlanSettings = {
  slaDaysCritical: 1,
  slaDaysHigh: 3,
  slaDaysMedium: 7,
  slaDaysLow: 15,
  dueSoonDays: 3,
  recurrenceWindowDays: 30,
  reconciliationWindowDays: 30,
  autoReconcile: true,
};

export interface MappingData {
  rows: MappingRow[];
  coverage: Coverage;
  settings: ActionPlanSettings;
}

export interface QualityCheck {
  key: string;
  count: number;
  class: "safe" | "review" | "blocked";
  sample: Record<string, unknown>[];
}

export interface QualityData {
  checks: QualityCheck[];
  events: { id: string; planId: string; code: string | null; type: string; reason: string | null; source: string; actor: string | null; at: string }[];
}

export interface HealthData {
  days: number;
  from: string;
  executionsSubmitted: number;
  executionsWithFindings: number;
  processed: number;
  failed: number;
  pending: number;
  findings: number;
  maintenanceFindings: number;
  damageFindings: number;
  notEligible: number;
  itemsCreated: number;
  plansCreated: number;
  plansUpdated: number;
  reprocessed: number;
  damageEventsPending: number;
  lastProcessedAt: string | null;
  recentFailures: { executionId: string; error: string | null; attempts: number; at: string }[];
  byDay: { date: string; executions: number; items: number }[];
}

export interface MyViewData {
  today: string;
  scope: {
    plansOpen: number;
    itemsOpen: number;
    overdue: number;
    dueSoon: number;
    critical: number;
    inMaintenance: number;
    pendingNewAction: number;
    withoutTreatment: number;
  };
  mine: { plansOpen: number; overdue: number };
  attention: ActionPlanRow[];
  byOperation: { key: string | null; label: string; open: number; overdue: number }[];
}

export interface MyReportRow {
  itemId: string;
  operationalDate: string;
  checklistType: string | null;
  licensePlate: string | null;
  question: string;
  title: string;
  detail: string | null;
  note: string | null;
  detailText: string | null;
  clusterName: string | null;
  itemStatus: ItemStatus;
  planStatus: PlanStatus;
  planCode: string;
  resolvedAt: string | null;
  maintenance: {
    code: string;
    status: string;
    scheduledDate: string | null;
    entryDate: string | null;
    exitDate: string | null;
    serviceOrderNumber: string | null;
    supplierName: string | null;
    services: string | null;
  } | null;
  daysToTreat: number | null;
}

export interface HistoryRow {
  id: string;
  operationalDate: string;
  checklistType: string | null;
  submittedAt: string | null;
  licensePlate: string | null;
  fleetCode: string | null;
  vehicleId: string;
  employeeName: string | null;
  employeeCode: string | null;
  operationName: string | null;
  brCode: string | null;
  nonConforming: number;
  critical: number;
  items: number;
  itemsOpen: number;
  damage: number | null;
  ingestionStatus: "pending" | "processed" | "failed" | null;
}

export interface HistoryPage {
  total: number;
  rows: HistoryRow[];
  limit: number;
  offset: number;
}

export interface ExecutionTrace {
  execution: {
    id: string;
    operationalDate: string;
    checklistType: string | null;
    licensePlate: string | null;
    submittedAt: string | null;
    employeeName: string | null;
    nonConforming: number;
  };
  ingestion: { status: string; source: string; attempts: number; lastError: string | null; processedAt: string | null } | null;
  findings: {
    answerId: string;
    questionKey: string;
    question: string;
    answer: string;
    conditionalValue: Record<string, unknown> | null;
    note: string | null;
    route: "maintenance" | "damage" | "not_eligible" | "conforming" | "not_submitted" | null;
    items: {
      itemId: string;
      optionLabel: string | null;
      status: ItemStatus;
      planId: string;
      planCode: string;
      planStatus: PlanStatus;
      title: string;
      maintenances: { id: string; code: string; status: string; resolutionStatus: string }[];
      resolution: { type: string; reason: string | null; at: string; by: string | null } | null;
    }[];
  }[];
}

export interface ActionPlanCatalog {
  appId: string | null;
  operations: { id: string; name: string }[];
  states: { id: number; uf: string }[];
  cities: { id: number; name: string; stateId: number }[];
  units: { id: string; name: string }[];
  brs: { id: string; code: string; operationId: string }[];
  leaders: { id: string; name: string }[];
  vehicleTypes: { id: string; name: string }[];
  clusters: { key: string; name: string }[];
  actionKeys: { key: string; title: string; questionKey: string; clusterKey: string | null }[];
  responsibles: { id: string; name: string }[];
  settings: ActionPlanSettings;
}

export interface FollowupRow {
  row: number;
  planCode: string | null;
  action: string;
  ok: boolean;
  message: string | null;
}

export interface FollowupResult {
  applied: boolean;
  ok: number;
  errors: number;
  rows: FollowupRow[];
}

/** Filtros do portal (todos opcionais; vários valores separados por vírgula). */
export interface ActionPlanFilters {
  from?: string;
  to?: string;
  q?: string;
  status?: string;
  /** all = todas as situações (o portal abre nos abertos quando nada é escolhido). */
  statusGroup?: "open" | "closed" | "all";
  priority?: string;
  operation?: string;
  state?: string;
  city?: string;
  unit?: string;
  br?: string;
  leader?: string;
  vehicle?: string;
  vehicleType?: string;
  cluster?: string;
  question?: string;
  actionKey?: string;
  responsible?: string;
  unassigned?: boolean;
  withMaintenance?: "yes" | "no";
  deadline?: Deadline;
  recurrence?: boolean;
  fleet?: "active" | "inactive" | "all";
  mine?: boolean;
}

export type ActionPlanSortKey = "priority" | "due" | "first" | "last" | "occurrences" | "open_items" | "code" | "plate" | "status" | "age";

/** Parâmetro de URL de cada filtro (um lugar só para tela, exportação e drill-down). */
export const FILTER_PARAM: Record<keyof ActionPlanFilters, string> = {
  from: "de",
  to: "ate",
  q: "q",
  status: "situacao",
  statusGroup: "grupo",
  priority: "prioridade",
  operation: "operacao",
  state: "uf",
  city: "cidade",
  unit: "filial",
  br: "br",
  leader: "lideranca",
  vehicle: "veiculo",
  vehicleType: "tipo",
  cluster: "cluster",
  question: "pergunta",
  actionKey: "item",
  responsible: "responsavel",
  unassigned: "sem_responsavel",
  withMaintenance: "manutencao",
  deadline: "prazo",
  recurrence: "reincidente",
  fleet: "frota",
  mine: "meus",
};

function camelKey(key: string): string {
  return key.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());
}

/** snake_case do banco → camelCase da tela, em profundidade. */
export function camelize<T>(value: unknown): T {
  if (Array.isArray(value)) return value.map((v) => camelize(v)) as T;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[camelKey(k)] = camelize(v);
    return out as T;
  }
  return value as T;
}
