/**
 * Gestão de MTSR — contratos comuns (abas, filtros, permissões, status).
 *
 * Tudo o que a tela mostra vem de rotinas do banco (`mtsr_*`): conformidade,
 * prazo e criticidade são calculados lá, sobre a mesma função de filtro
 * (`private.mtsr_fleet_filtered`). O navegador só apresenta — nunca recalcula
 * status, prazo, criticidade ou prioridade de fonte.
 */
export { camelize, formatDate, formatStamp } from "@/lib/maintenance/types";

export const MTSR_BASE_PATH = "/seguranca/mtsr";
export const MTSR_APP_PATH = "/aplicativos/vistoria-mtsr";

export const MTSR_TABS = [
  "visao-geral",
  "conformidade",
  "vistorias",
  "manutencoes",
  "ingestao",
  "cadastros",
  "auditoria",
  "saude",
] as const;
export type MtsrTab = (typeof MTSR_TABS)[number];

export const MTSR_TAB_LABEL: Record<MtsrTab, string> = {
  "visao-geral": "Visão geral",
  conformidade: "Conformidade",
  vistorias: "Vistorias recebidas",
  manutencoes: "Manutenções",
  ingestao: "Ingestão",
  cadastros: "Cadastros",
  auditoria: "Auditoria",
  saude: "Saúde e cobertura",
};

// ---------------------------------------------------------------------------
// Permissões (códigos oficiais em Perfis & Permissões — nunca por nome de perfil)
// ---------------------------------------------------------------------------
export interface MtsrPerms {
  view: boolean;
  dashboard: boolean;
  conformity: boolean;
  review: boolean;
  validate: boolean;
  return: boolean;
  reject: boolean;
  componentManage: boolean;
  parametersManage: boolean;
  backofficeUpdate: boolean;
  ingestionManage: boolean;
  maintenanceOpen: boolean;
  maintenanceLink: boolean;
  maintenanceCreate: boolean;
  maintenanceView: boolean;
  export: boolean;
  import: boolean;
  audit: boolean;
  appExecute: boolean;
}

export const MTSR_PERMISSION_CODES: Record<keyof MtsrPerms, string> = {
  view: "mtsr.view",
  dashboard: "mtsr.dashboard.view",
  conformity: "mtsr.conformity.view",
  review: "mtsr.inspection.review",
  validate: "mtsr.inspection.validate",
  return: "mtsr.inspection.return",
  reject: "mtsr.inspection.reject",
  componentManage: "mtsr.component.manage",
  parametersManage: "mtsr.parameters.manage",
  backofficeUpdate: "mtsr.backoffice.update",
  ingestionManage: "mtsr.ingestion.manage",
  maintenanceOpen: "mtsr.maintenance.open",
  maintenanceLink: "mtsr.maintenance.link",
  maintenanceCreate: "maintenance.create",
  maintenanceView: "maintenance.view",
  export: "mtsr.export",
  import: "mtsr.import",
  audit: "mtsr.audit.view",
  appExecute: "applications.mtsr.execute",
};

/** Abas visíveis para quem tem as permissões. */
export function mtsrVisibleTabs(p: MtsrPerms): MtsrTab[] {
  const out: MtsrTab[] = [];
  if (p.dashboard) out.push("visao-geral");
  if (p.conformity) out.push("conformidade");
  if (p.review) out.push("vistorias");
  if (p.view) out.push("manutencoes");
  if (p.ingestionManage || p.backofficeUpdate || p.import) out.push("ingestao");
  if (p.componentManage || p.parametersManage || p.ingestionManage) out.push("cadastros");
  if (p.audit) out.push("auditoria");
  if (p.dashboard) out.push("saude");
  return out;
}

// ---------------------------------------------------------------------------
// Filtros (estado na URL; o banco recebe ids)
// ---------------------------------------------------------------------------
export type MtsrFleetScope = "default" | "all" | "inactive";

export interface MtsrFilters {
  operation?: string;
  state?: string;
  city?: string;
  br?: string;
  leader?: string;
  unit?: string;
  vehicleType?: string;
  vehicle?: string;
  deadline?: string;
  conformity?: string;
  criticality?: string;
  component?: string;
  componentStatus?: string;
  awaiting?: string;
  fleet?: MtsrFleetScope;
  q?: string;
}

export const MTSR_FILTER_PARAM: Record<keyof MtsrFilters, string> = {
  operation: "operacao",
  state: "uf",
  city: "cidade",
  br: "br",
  leader: "lideranca",
  unit: "filial",
  vehicleType: "tipo",
  vehicle: "veiculos",
  deadline: "prazo",
  conformity: "conformidade",
  criticality: "criticidade",
  component: "componente",
  componentStatus: "status_componente",
  awaiting: "revalidacao",
  fleet: "frota",
  q: "q",
};

export type MtsrNavigate = (patch: Record<string, string | null>) => void;

// ---------------------------------------------------------------------------
// Catálogo de status (o banco é a fonte; aqui só rótulos e tons)
// ---------------------------------------------------------------------------
export type MtsrTone = "success" | "warning" | "danger" | "info" | "neutral" | "pending" | "progress";

export type DeadlineStatus = "conforme" | "atencao" | "vencido" | "pendente";
export const DEADLINE_LABEL: Record<DeadlineStatus, string> = {
  conforme: "Conforme",
  atencao: "Atenção",
  vencido: "Vencido",
  pendente: "Pendente",
};
export const DEADLINE_TONE: Record<DeadlineStatus, MtsrTone> = {
  conforme: "success",
  atencao: "warning",
  vencido: "danger",
  pendente: "neutral",
};

export type ConformityStatus = "conforme" | "nao_conforme" | "sem_informacao";
export const CONFORMITY_LABEL: Record<ConformityStatus, string> = {
  conforme: "Conforme",
  nao_conforme: "Não conforme",
  sem_informacao: "Sem informação",
};
export const CONFORMITY_TONE: Record<ConformityStatus, MtsrTone> = {
  conforme: "success",
  nao_conforme: "danger",
  sem_informacao: "neutral",
};

export type Criticality = "critica" | "alta" | "media" | "sem_criticidade";
export const CRITICALITY_LABEL: Record<Criticality, string> = {
  critica: "Crítica",
  alta: "Alta",
  media: "Média",
  sem_criticidade: "Sem criticidade",
};
export const CRITICALITY_TONE: Record<Criticality, MtsrTone> = {
  critica: "danger",
  alta: "warning",
  media: "info",
  sem_criticidade: "neutral",
};
export const CRITICALITY_ORDER: Criticality[] = ["critica", "alta", "media", "sem_criticidade"];

export type ComponentStatus = "ok" | "nok" | "sem_informacao";
export const COMPONENT_STATUS_LABEL: Record<ComponentStatus, string> = {
  ok: "OK",
  nok: "NOK",
  sem_informacao: "Sem informação",
};
export const COMPONENT_STATUS_TONE: Record<ComponentStatus, MtsrTone> = {
  ok: "success",
  nok: "danger",
  sem_informacao: "neutral",
};

export type VerificationMode = "field" | "backoffice";
export const VERIFICATION_MODE_LABEL: Record<VerificationMode, string> = {
  field: "Campo (vistoria)",
  backoffice: "Backoffice",
};

export type InspectionStatus = "pendente_validacao" | "validada" | "retornada" | "rejeitada";
export const INSPECTION_STATUS_LABEL: Record<InspectionStatus, string> = {
  pendente_validacao: "Pendente de validação",
  validada: "Validada",
  retornada: "Retornada",
  rejeitada: "Rejeitada",
};
export const INSPECTION_STATUS_TONE: Record<InspectionStatus, MtsrTone> = {
  pendente_validacao: "pending",
  validada: "success",
  retornada: "warning",
  rejeitada: "danger",
};

export type RevalidationStatus = "pending" | "awaiting" | "done" | "not_required" | "cancelled";
export const REVALIDATION_LABEL: Record<RevalidationStatus, string> = {
  pending: "Manutenção em andamento",
  awaiting: "Aguardando revalidação",
  done: "Revalidado",
  not_required: "Sem revalidação",
  cancelled: "Cancelada",
};
export const REVALIDATION_TONE: Record<RevalidationStatus, MtsrTone> = {
  pending: "progress",
  awaiting: "warning",
  done: "success",
  not_required: "neutral",
  cancelled: "neutral",
};

export type SourceType = "field_inspection" | "manual_import" | "backoffice_manual" | "geotab_api" | "mdvr_api" | "cftv_api" | "other_connector" | "system";
export const SOURCE_TYPE_LABEL: Record<string, string> = {
  field_inspection: "Vistoria de campo",
  manual_import: "Importação manual",
  backoffice_manual: "Backoffice manual",
  geotab_api: "Geotab (API)",
  mdvr_api: "MDVR (API)",
  cftv_api: "CFTV (API)",
  other_connector: "Outro conector",
  system: "Sistema",
};

export type IngestionOutcome = "received" | "applied" | "ignored" | "rejected" | "conflict";
export const INGESTION_OUTCOME_LABEL: Record<IngestionOutcome, string> = {
  received: "Recebido",
  applied: "Aplicado",
  ignored: "Ignorado",
  rejected: "Rejeitado",
  conflict: "Conflito",
};
export const INGESTION_OUTCOME_TONE: Record<IngestionOutcome, MtsrTone> = {
  received: "pending",
  applied: "success",
  ignored: "neutral",
  rejected: "danger",
  conflict: "warning",
};
export const INGESTION_REASON_LABEL: Record<string, string> = {
  stale: "Leitura mais antiga que a atual",
  no_change: "Sem mudança",
  lower_priority_source: "Fonte de menor prioridade",
  vehicle_not_found: "Veículo não encontrado",
  component_not_found: "Componente não encontrado",
  status_unknown: "Status não reconhecido",
  future_date: "Data futura",
};

export const EVENT_TYPE_LABEL: Record<string, string> = {
  STATUS_COMPONENTE_ALTERADO: "Status de componente alterado",
  VISTORIA_ENVIADA: "Vistoria enviada",
  VISTORIA_VALIDADA: "Vistoria validada",
  VISTORIA_RETORNADA: "Vistoria retornada",
  VISTORIA_REJEITADA: "Vistoria rejeitada",
  NOK_IDENTIFICADO: "NOK identificado",
  MANUTENCAO_ABERTA: "Manutenção aberta",
  MANUTENCAO_VINCULADA: "Manutenção vinculada",
  MANUTENCAO_DESVINCULADA: "Manutenção desvinculada",
  MANUTENCAO_CONCLUIDA: "Manutenção concluída",
  MANUTENCAO_CANCELADA: "Manutenção cancelada",
  MANUTENCAO_REABERTA: "Manutenção reaberta",
  REVALIDACAO_REALIZADA: "Revalidação realizada",
  ATUALIZACAO_BACKOFFICE: "Atualização backoffice",
  IMPORTACAO: "Importação",
  ALTERACAO_MANUAL: "Alteração manual",
  INGESTAO_IGNORADA: "Ingestão ignorada",
  INGESTAO_CONFLITO: "Conflito de ingestão",
  PARAMETROS_ALTERADOS: "Parâmetros alterados",
  COMPONENTE_ALTERADO: "Componente alterado",
  FONTE_ALTERADA: "Fonte alterada",
  EVIDENCIA_EXPURGADA: "Evidência expurgada",
  EXPORTACAO: "Exportação",
};
export const EVENT_TYPES = Object.keys(EVENT_TYPE_LABEL);

export const eventTypeLabel = (t: string) => EVENT_TYPE_LABEL[t] ?? t;
export const sourceTypeLabel = (t: string | null | undefined) => (t ? (SOURCE_TYPE_LABEL[t] ?? t) : "—");

// ---------------------------------------------------------------------------
// Saídas das rotinas (camelCase)
// ---------------------------------------------------------------------------
export interface MtsrParameterSet {
  id: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  conformeMaxDays: number;
  attentionMinDays: number;
  attentionMaxDays: number;
  evidenceRetentionInspections: number;
  evidenceRetentionDays: number | null;
  reviewSlaDays: number;
  maintenanceOpenSlaDays: number;
  revalidationSlaDays: number;
  note: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface MtsrComponent {
  id: string;
  code: string;
  name: string;
  description: string | null;
  verificationMode: VerificationMode;
  baseCriticality: Exclude<Criticality, "sem_criticidade">;
  priority: number;
  sortOrder: number;
  isActive: boolean;
  contextLabel: string | null;
  evidenceRequiredWhenOk: boolean;
  evidenceRequiredWhenNok: boolean;
  observationRequiredWhenNok: boolean;
  aliases: string[];
}

export interface MtsrSource {
  id: string;
  code: string;
  name: string;
  sourceType: string;
  sourceSystem: string | null;
  isEnabled: boolean;
  isAvailable: boolean;
  priority: number;
  lastEventAt: string | null;
  notes: string | null;
}

export interface MtsrComponentSource {
  componentId: string;
  sourceId: string;
  priority: number;
  isEnabled: boolean;
}

export interface MtsrComponentService {
  id: string;
  componentId: string;
  serviceId: string;
  isDefault: boolean;
  isActive: boolean;
  serviceName: string;
  clusterName: string | null;
}

export interface MtsrServiceOption {
  id: string;
  name: string;
  clusterId: string | null;
  clusterName: string | null;
  criticality: string | null;
}

export interface MtsrCatalog {
  today: string;
  components: MtsrComponent[];
  sources: MtsrSource[];
  componentSources: MtsrComponentSource[];
  componentServices: MtsrComponentService[];
  services: MtsrServiceOption[];
  parameters: MtsrParameterSet;
  parameterHistory: MtsrParameterSet[];
  originMtsrId: string | null;
}

/** Uma linha da frota avaliada (`private.mtsr_fleet_filtered`). */
export interface MtsrFleetRow {
  vehicleId: string;
  licensePlate: string;
  fleetCode: string | null;
  vehicleStatus: string;
  vehicleTypeId: string | null;
  vehicleTypeName: string | null;
  subcategoryName: string | null;
  modelName: string | null;
  contextSource: string | null;
  operationId: string | null;
  operationName: string | null;
  operationCityId: string | null;
  stateId: number | null;
  stateUf: string | null;
  cityId: number | null;
  cityName: string | null;
  operationBrId: string | null;
  brCode: string | null;
  leaderEmployeeId: string | null;
  leaderName: string | null;
  organizationUnitId: string | null;
  unitName: string | null;
  lastValidInspectionDate: string | null;
  daysSince: number | null;
  deadlineStatus: DeadlineStatus;
  conformityStatus: ConformityStatus;
  criticality: Criticality;
  nokCount: number;
  okCount: number;
  knownCount: number;
  unknownCount: number;
  awaitingCount: number;
  mainComponentId: string | null;
  mainComponentName: string | null;
  openMaintenances: number;
  pendingInspections: number;
  lastSubmissionAt: string | null;
}

export interface MtsrFleetCell {
  componentId: string;
  code: string;
  name: string;
  verificationMode: VerificationMode;
  status: ComponentStatus;
  referenceDate: string | null;
  sourceType: string | null;
  awaitingRevalidation: boolean;
  observation: string | null;
}

export type MtsrFleetStatusRow = MtsrFleetRow & { components: MtsrFleetCell[] };

export interface MtsrFleetGroup {
  operationId: string | null;
  operationName: string | null;
  total: number;
  naoConforme: number;
  critica: number;
  vencido: number;
}

export interface MtsrFleetSummary {
  vehicles: number;
  conforme: number;
  naoConforme: number;
  semInformacao: number;
  critica: number;
  alta: number;
  media: number;
  vencido: number;
  atencao: number;
  pendente: number;
  awaiting: number;
}

export type MtsrSortKey = "criticality" | "deadline" | "nok" | "last_inspection" | "plate" | "operation";

export interface MtsrFleetStatus {
  total: number;
  rows: MtsrFleetStatusRow[];
  groups: MtsrFleetGroup[];
  summary: MtsrFleetSummary;
  limit: number;
  offset: number;
  today: string;
}

export interface MtsrDashboardKpis {
  vehicles: number;
  monitored: number;
  withInspection: number;
  conforme: number;
  naoConforme: number;
  semInformacao: number;
  conformityPct: number | null;
  critica: number;
  alta: number;
  media: number;
  vencido: number;
  atencao: number;
  pendente: number;
  conformePrazo: number;
  awaitingVehicles: number;
  awaitingComponents: number;
  nokComponents: number;
  openMaintenances: number;
  pendingInspections: number;
  avgDaysSinceInspection: number | null;
  coveragePct: number | null;
  pendingOverSla: number;
  avgReviewHours: number | null;
  inspections30d: number;
  returnedRatePct: number | null;
  nokWithoutMaintenance: number;
  nokOverOpenSla: number;
  awaitingOverSla: number;
  avgDaysNokToMaintenance: number | null;
}

export interface MtsrKeyTotal {
  key: string;
  total: number;
}

export interface MtsrDashboard {
  today: string;
  empty: boolean;
  parameters: MtsrParameterSet;
  kpis: MtsrDashboardKpis;
  byComponent: {
    componentId: string;
    code: string;
    name: string;
    verificationMode: VerificationMode;
    ok: number;
    nok: number;
    semInformacao: number;
    awaiting: number;
  }[];
  rankingNok: { componentId: string; name: string; total: number }[];
  byCriticality: MtsrKeyTotal[];
  byDeadline: MtsrKeyTotal[];
  byConformity: MtsrKeyTotal[];
  byOperation: { operationId: string | null; name: string | null; total: number; naoConforme: number; critica: number; vencido: number }[];
  byCity: { cityId: number | null; name: string | null; stateUf: string | null; total: number; naoConforme: number }[];
  byVehicleType: { vehicleTypeId: string | null; name: string | null; total: number; naoConforme: number }[];
  maintenanceByStatus: { status: string; label: string; total: number }[];
  maintenanceAging: { bucket: string; total: number }[];
  inspectionsByStatus: { status: InspectionStatus; total: number }[];
  inspectionsTrend: { weekStart: string; submitted: number; validated: number; nok: number }[];
  sources: {
    code: string;
    name: string;
    sourceType: string;
    isEnabled: boolean;
    isAvailable: boolean;
    lastEventAt: string | null;
    daysSince: number | null;
    events30d: number;
  }[];
}

export interface MtsrEvidence {
  id: string;
  bucketId: string;
  storagePath: string;
  mimeType: string;
  sizeBytes: number | null;
  capturedAt: string | null;
  purgedAt: string | null;
}

export interface MtsrInspectionItem {
  id: string;
  componentId: string;
  componentCode: string;
  componentName: string;
  status: "ok" | "nok";
  observation: string | null;
  evidenceCount: number;
  appliedAt: string | null;
  skippedReason: string | null;
  officialStatus: ComponentStatus;
  officialReferenceDate: string | null;
  officialSourceType: string | null;
  awaitingRevalidation: boolean;
  maintenance: { id: string; code: string; status: string; label: string; linkId: string } | null;
  evidence: MtsrEvidence[];
}

export interface MtsrInspectionEvent {
  id: string;
  eventType: string;
  actorName: string | null;
  reason: string | null;
  payload: Record<string, unknown> | null;
  occurredAt: string;
}

export interface MtsrInspection {
  id: string;
  protocol: string;
  appId: string | null;
  source: string;
  vehicleId: string;
  licensePlateSnapshot: string;
  fleetCodeSnapshot: string | null;
  vehicleTypeId: string | null;
  contextDate: string | null;
  contextSource: string | null;
  operationId: string | null;
  operationNameSnapshot: string | null;
  cityNameSnapshot: string | null;
  stateUfSnapshot: string | null;
  brCodeSnapshot: string | null;
  unitNameSnapshot: string | null;
  leaderNameSnapshot: string | null;
  inspectorUserId: string | null;
  inspectorEmployeeId: string | null;
  inspectorNameSnapshot: string | null;
  inspectorCodeSnapshot: string | null;
  inspectionDate: string;
  inspectedAt: string;
  submittedAt: string;
  status: InspectionStatus;
  generalObservation: string | null;
  itemCount: number;
  nokCount: number;
  evidenceCount: number;
  reviewedBy: string | null;
  reviewedAt: string | null;
  reviewerNameSnapshot: string | null;
  reviewReason: string | null;
  clientSubmissionId: string;
  createdAt: string;
}

export interface MtsrInspectionDetail extends MtsrInspection {
  items: MtsrInspectionItem[];
  events: MtsrInspectionEvent[];
  card: Record<string, unknown> | null;
  daysWaiting: number | null;
  canReview?: boolean;
  canValidate?: boolean;
  canReturn?: boolean;
  canReject?: boolean;
  canOpenMaintenance?: boolean;
  isOwn?: boolean;
}

export type MtsrInspectionRow = MtsrInspection & {
  daysWaiting: number | null;
  overSla: boolean;
  vehicleTypeName: string | null;
};

export interface MtsrInspectionsReceived {
  total: number;
  rows: MtsrInspectionRow[];
  kpis: {
    pendentes: number;
    comNok: number;
    validadas: number;
    retornadas: number;
    rejeitadas: number;
    acimaSla: number;
    esperaMediaDias: number | null;
    validacaoMediaHoras: number | null;
    ultimos30d: number;
  };
  options: {
    inspectors: { id: string | null; name: string | null }[];
    operations: { id: string; name: string | null }[];
  };
  limit: number;
  offset: number;
  today: string;
  reviewSlaDays: number;
}

export interface MtsrSheetComponent {
  componentId: string;
  code: string;
  name: string;
  verificationMode: VerificationMode;
  baseCriticality: string;
  priority: number;
  status: ComponentStatus;
  referenceDate: string | null;
  sourceType: string | null;
  sourceSystem: string | null;
  observation: string | null;
  awaitingRevalidation: boolean;
  awaitingSince: string | null;
  awaitingMaintenanceId: string | null;
  statusChangedAt: string | null;
  inspectionId: string | null;
  openMaintenance: { id: string; code: string; status: string; label: string } | null;
  history: {
    id: string;
    previousStatus: ComponentStatus | null;
    newStatus: ComponentStatus;
    referenceDate: string | null;
    sourceType: string | null;
    sourceSystem: string | null;
    inspectionId: string | null;
    observation: string | null;
    actorName: string | null;
    occurredAt: string;
  }[];
}

export interface MtsrSheetInspection {
  id: string;
  protocol: string;
  status: InspectionStatus;
  inspectionDate: string;
  submittedAt: string;
  inspectorName: string | null;
  inspectorCode: string | null;
  itemCount: number;
  nokCount: number;
  evidenceCount: number;
  reviewedAt: string | null;
  reviewerName: string | null;
  reviewReason: string | null;
  items: { componentId: string; componentName: string; status: "ok" | "nok"; observation: string | null; evidenceCount: number }[];
}

export interface MtsrSheetMaintenance {
  linkId: string;
  maintenanceId: string;
  code: string;
  status: string;
  label: string;
  componentId: string;
  componentName: string;
  linkType: string;
  linkStatus: string;
  revalidationStatus: RevalidationStatus;
  maintenanceConcludedAt: string | null;
  revalidatedAt: string | null;
  requestedOn: string | null;
  scheduledDate: string | null;
  exitDate: string | null;
  serviceOrderNumber: string | null;
  supplier: string | null;
  linkedAt: string;
  inspectionId: string | null;
}

export interface MtsrEvent {
  id: string;
  eventType: string;
  componentId: string | null;
  componentName: string | null;
  sourceType: string | null;
  inspectionId: string | null;
  maintenanceId: string | null;
  payload: Record<string, unknown> | null;
  reason: string | null;
  actorName: string | null;
  source: string;
  occurredAt: string;
  vehicleId?: string | null;
  licensePlate?: string | null;
  fleetCode?: string | null;
}

export interface MtsrVehicleSheet {
  today: string;
  vehicle: MtsrFleetRow | null;
  card: Record<string, unknown> | null;
  facts: {
    vehicleId: string;
    lastValidInspectionDate: string | null;
    lastValidInspectionId: string | null;
    lastValidSource: string | null;
    lastSubmissionAt: string | null;
  } | null;
  components: MtsrSheetComponent[];
  inspections: MtsrSheetInspection[];
  maintenances: MtsrSheetMaintenance[];
  events: MtsrEvent[];
}

export interface MtsrVehicleSummary {
  today: string;
  vehicle: MtsrFleetRow | null;
  components: { componentId: string; name: string; verificationMode: VerificationMode; status: ComponentStatus; referenceDate: string | null; awaitingRevalidation: boolean }[];
  lastInspection: { id: string; protocol: string; status: InspectionStatus; inspectionDate: string; nokCount: number } | null;
}

export interface MtsrEventsList {
  total: number;
  rows: MtsrEvent[];
  limit: number;
  offset: number;
}

export interface MtsrHealth {
  today: string;
  vehiclesActive: number;
  vehiclesWithoutAnyStatus: number;
  vehiclesWithoutInspection: number;
  fieldCellsMissing: number;
  backofficeCellsMissing: number;
  awaitingRevalidation: number;
  awaitingOverSla: number;
  pendingInspections: number;
  pendingOverSla: number;
  nokWithoutMaintenance: number;
  componentsWithoutService: number;
  componentsWithoutSource: number;
  evidenceLive: number;
  evidencePurged: number;
  ingestionRejected30d: number;
  ingestionConflict30d: number;
  appEnabledOperations: number;
  appEnabledVehicleTypes: number;
  sources: { code: string; name: string; isEnabled: boolean; isAvailable: boolean; lastEventAt: string | null }[];
}

export interface MtsrMaintenanceLinkRow {
  id: string;
  maintenanceId: string;
  vehicleId: string;
  componentId: string;
  componentName: string;
  linkType: string;
  status: string;
  revalidationStatus: RevalidationStatus;
  maintenanceConcludedAt: string | null;
  revalidatedAt: string | null;
  linkedAt: string;
  reason: string | null;
  inspectionId: string | null;
  maintenance: { code: string; status: string; requestedOn: string | null; scheduledDate: string | null; exitDate: string | null; priority: string | null } | null;
  vehicle: { licensePlate: string; fleetCode: string | null } | null;
}

export interface MtsrIngestionEventRow {
  id: string;
  sourceId: string | null;
  sourceType: string | null;
  sourceSystem: string | null;
  sourceRecordId: string | null;
  licensePlateRaw: string | null;
  vehicleId: string | null;
  componentCodeRaw: string | null;
  componentId: string | null;
  statusRaw: string | null;
  normalized: Record<string, unknown> | null;
  status: IngestionOutcome;
  outcomeReason: string | null;
  receivedAt: string;
  actorName: string | null;
  importBatchId: string | null;
}

export interface MtsrForMaintenance {
  canViewMtsr: boolean;
  links: {
    linkId: string;
    componentId: string;
    componentName: string;
    linkType: string;
    revalidationStatus: RevalidationStatus;
    maintenanceConcludedAt: string | null;
    revalidatedAt: string | null;
    inspectionId: string | null;
    protocol: string | null;
    linkedAt: string;
    officialStatus: ComponentStatus;
    awaitingRevalidation: boolean;
  }[];
}

export interface MtsrMaintenanceCandidate {
  id: string;
  code: string;
  status: string;
  label: string;
  maintenanceTypeCode: string;
  requestedOn: string | null;
  scheduledDate: string | null;
  exitDate: string | null;
  description: string | null;
  services: string[];
  alreadyLinked: boolean;
  mappedService: boolean;
}

// ---------------------------------------------------------------------------
// App Vistoria MTSR
// ---------------------------------------------------------------------------
export interface MtsrAppComponent {
  id: string;
  code: string;
  name: string;
  description: string | null;
  evidenceRequiredWhenOk: boolean;
  evidenceRequiredWhenNok: boolean;
  observationRequiredWhenNok: boolean;
}

export interface MtsrAppContext {
  available: boolean;
  reason: "nao_cadastrado" | "inativo" | null;
  today: string;
  app: { id: string; name: string; slug: string; allowsAttachments: boolean } | null;
  actor: { userId: string | null; employeeId: string | null; name: string | null; employeeCode: string | null };
  components: MtsrAppComponent[];
  backofficeComponents: string[];
  evidence: { bucket: string; maxBytes: number; mimeTypes: string[]; maxPerItem: number };
}

export interface MtsrAppVehicle {
  id: string;
  licensePlate: string;
  fleetCode: string | null;
  vehicleTypeId: string | null;
  vehicleTypeName: string | null;
  operationId: string | null;
  operationName: string | null;
  cityName: string | null;
  stateUf: string | null;
  brCode: string | null;
  leaderName: string | null;
  lastValidInspectionDate: string | null;
  deadlineStatus: DeadlineStatus;
  daysSince: number | null;
  nokCount: number;
  conformityStatus: ConformityStatus;
  pendingInspection: boolean;
}

export interface MtsrSubmitResult {
  id: string;
  protocol: string;
  submittedAt: string;
  itemCount: number;
  nokCount: number;
  evidenceCount: number;
  duplicate: boolean;
}

// ---------------------------------------------------------------------------
// Formatação
// ---------------------------------------------------------------------------
const nf0 = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
export const fmtInt = (v: number | null | undefined) => (v == null ? "—" : nf0.format(v));
export const fmt1 = (v: number | null | undefined) => (v == null ? "—" : nf1.format(v));
export const fmtPct = (v: number | null | undefined) => (v == null ? "—" : `${nf1.format(v)}%`);
export const fmtDays = (v: number | null | undefined) => (v == null ? "—" : v === 1 ? "1 dia" : `${nf0.format(v)} dias`);

export const deadlineLabel = (s: string | null | undefined) => DEADLINE_LABEL[(s ?? "pendente") as DeadlineStatus] ?? s ?? "—";
export const conformityLabel = (s: string | null | undefined) => CONFORMITY_LABEL[(s ?? "sem_informacao") as ConformityStatus] ?? s ?? "—";
export const criticalityLabel = (s: string | null | undefined) => CRITICALITY_LABEL[(s ?? "sem_criticidade") as Criticality] ?? s ?? "—";
export const componentStatusLabel = (s: string | null | undefined) => COMPONENT_STATUS_LABEL[(s ?? "sem_informacao") as ComponentStatus] ?? s ?? "—";
