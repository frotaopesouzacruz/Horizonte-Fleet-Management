/**
 * Gestão de Pneus — contratos comuns (abas, filtros, permissões, status e o
 * formato das rotinas `tires_*` / `tire_*` já em camelCase).
 *
 * Tudo o que a tela mostra vem do banco: prazos de medição e calibragem,
 * classe do sulco, regra de PSI aplicável, severidade, aderência e qualidade
 * são calculados por `private.tire_rows`. O navegador só apresenta.
 *
 * Fora do escopo desta etapa: CPK, custo por km, custo por vida, ROI de
 * recapagem. Nenhum tipo, rota ou campo financeiro de pneus existe aqui.
 */
export { camelize, formatDate, formatStamp } from "@/lib/maintenance/types";

export const TIRES_BASE_PATH = "/frota/pneus";
export const TIRES_APP_PATH = "/aplicativos/vistoria-pneus";

export const TIRES_TABS = [
  "visao-geral",
  "base",
  "medicao",
  "calibragem",
  "cronograma",
  "vistorias",
  "servicos",
  "qualidade",
  "historico",
  "importacao",
  "parametros",
] as const;
export type TiresTab = (typeof TIRES_TABS)[number];

export const TIRES_TAB_LABEL: Record<TiresTab, string> = {
  "visao-geral": "Visão geral",
  base: "Base geral",
  medicao: "Aderência MM",
  calibragem: "Aderência calibragem",
  cronograma: "Cronograma",
  vistorias: "Vistorias recebidas",
  servicos: "Serviços",
  qualidade: "Qualidade de dados",
  historico: "Histórico",
  importacao: "Importação Rodopar",
  parametros: "Parâmetros",
};

// ---------------------------------------------------------------------------
// Permissões (códigos oficiais em Perfis & Permissões — nunca por nome de perfil)
// ---------------------------------------------------------------------------
export interface TiresPerms {
  view: boolean;
  dashboard: boolean;
  base: boolean;
  history: boolean;
  measurement: boolean;
  calibration: boolean;
  schedule: boolean;
  review: boolean;
  import: boolean;
  export: boolean;
  parameters: boolean;
  servicesView: boolean;
  servicesManage: boolean;
  quality: boolean;
  audit: boolean;
  appExecute: boolean;
}

/**
 * `tires.inspection.submit` (nome do requisito) é a permissão do aplicativo
 * `applications.tires.execute`, no mesmo padrão dos demais apps do HFM.
 */
export const TIRES_PERMISSION_CODES: Record<keyof TiresPerms, string> = {
  view: "tires.view",
  dashboard: "tires.dashboard.view",
  base: "tires.base.view",
  history: "tires.history.view",
  measurement: "tires.measurement.view",
  calibration: "tires.calibration.view",
  schedule: "tires.schedule.view",
  review: "tires.inspection.review",
  import: "tires.import",
  export: "tires.export",
  parameters: "tires.parameters.manage",
  servicesView: "tires.services.view",
  servicesManage: "tires.services.manage",
  quality: "tires.quality.view",
  audit: "tires.audit.view",
  appExecute: "applications.tires.execute",
};

export function tiresVisibleTabs(p: TiresPerms): TiresTab[] {
  const out: TiresTab[] = [];
  if (p.dashboard) out.push("visao-geral");
  if (p.base) out.push("base");
  if (p.measurement) out.push("medicao");
  if (p.calibration) out.push("calibragem");
  if (p.schedule) out.push("cronograma");
  if (p.view) out.push("vistorias");
  if (p.servicesView) out.push("servicos");
  if (p.quality) out.push("qualidade");
  if (p.history || p.audit) out.push("historico");
  if (p.import || p.audit) out.push("importacao");
  if (p.view) out.push("parametros");
  return out;
}

// ---------------------------------------------------------------------------
// Filtros (estado na URL; o banco recebe ids)
// ---------------------------------------------------------------------------
export interface TiresFilters {
  reference?: string;
  operation?: string;
  state?: string;
  city?: string;
  br?: string;
  leader?: string;
  unit?: string;
  vehicleType?: string;
  vehicle?: string;
  status?: string;
  brand?: string;
  model?: string;
  dimension?: string;
  life?: string;
  position?: string;
  tread?: string;
  measurement?: string;
  calibration?: string;
  psi?: string;
  severity?: string;
  quality?: string;
  retread?: string;
  q?: string;
}

export const TIRES_FILTER_PARAM: Record<keyof TiresFilters, string> = {
  reference: "foto",
  operation: "operacao",
  state: "uf",
  city: "local",
  br: "br",
  leader: "lideranca",
  unit: "filial",
  vehicleType: "tipo",
  vehicle: "veiculo",
  status: "situacao",
  brand: "marca",
  model: "modelo",
  dimension: "dimensao",
  life: "vida",
  position: "posicao",
  tread: "sulco",
  measurement: "medicao",
  calibration: "calibragem",
  psi: "pressao",
  severity: "severidade",
  quality: "qualidade",
  retread: "ressolagem",
  q: "q",
};

export type TiresNavigate = (patch: Record<string, string | null>) => void;

// ---------------------------------------------------------------------------
// Vocabulário (rótulos e tons)
// ---------------------------------------------------------------------------
export type TiresTone = "success" | "warning" | "danger" | "info" | "neutral" | "pending" | "progress";

export type CanonicalStatus = "em_uso" | "estoque" | "ressolagem" | "descartado" | "baixado" | "outro";
export const STATUS_LABEL: Record<CanonicalStatus, string> = {
  em_uso: "Em uso",
  estoque: "Estoque",
  ressolagem: "Ressolagem",
  descartado: "Descartado",
  baixado: "Baixado",
  outro: "Outro",
};
export const STATUS_TONE: Record<CanonicalStatus, TiresTone> = {
  em_uso: "success",
  estoque: "info",
  ressolagem: "progress",
  descartado: "neutral",
  baixado: "neutral",
  outro: "pending",
};
export const STATUS_ORDER: CanonicalStatus[] = ["em_uso", "estoque", "ressolagem", "descartado", "baixado", "outro"];

export type TreadClass = "abaixo_legal" | "critico" | "atencao" | "adequado" | "sem_medicao";
export const TREAD_LABEL: Record<TreadClass, string> = {
  abaixo_legal: "Abaixo do legal",
  critico: "Crítico",
  atencao: "Atenção",
  adequado: "Adequado",
  sem_medicao: "Sem medição",
};
export const TREAD_TONE: Record<TreadClass, TiresTone> = {
  abaixo_legal: "danger",
  critico: "danger",
  atencao: "warning",
  adequado: "success",
  sem_medicao: "pending",
};
export const TREAD_ORDER: TreadClass[] = ["abaixo_legal", "critico", "atencao", "adequado", "sem_medicao"];

export type DeadlineStatus = "em_dia" | "proximo" | "vencido" | "sem_registro";
export const DEADLINE_LABEL: Record<DeadlineStatus, string> = {
  em_dia: "Em dia",
  proximo: "Próximo do vencimento",
  vencido: "Vencido",
  sem_registro: "Sem registro",
};
export const DEADLINE_SHORT: Record<DeadlineStatus, string> = {
  em_dia: "Em dia",
  proximo: "Próximo",
  vencido: "Vencido",
  sem_registro: "Sem registro",
};
export const DEADLINE_TONE: Record<DeadlineStatus, TiresTone> = {
  em_dia: "success",
  proximo: "warning",
  vencido: "danger",
  sem_registro: "pending",
};
export const DEADLINE_ORDER: DeadlineStatus[] = ["vencido", "proximo", "em_dia", "sem_registro"];

export type PsiStatus = "adequada" | "baixa" | "excesso" | "sem_parametro" | "sem_calibragem";
export const PSI_LABEL: Record<PsiStatus, string> = {
  adequada: "Adequada",
  baixa: "Abaixo do mínimo",
  excesso: "Acima do máximo",
  sem_parametro: "Sem parâmetro",
  sem_calibragem: "Sem calibragem",
};
export const PSI_TONE: Record<PsiStatus, TiresTone> = {
  adequada: "success",
  baixa: "danger",
  excesso: "warning",
  sem_parametro: "pending",
  sem_calibragem: "neutral",
};
export const PSI_ORDER: PsiStatus[] = ["baixa", "excesso", "adequada", "sem_parametro", "sem_calibragem"];

export type Severity = "critica" | "alta" | "media" | "baixa" | "ok";
export const SEVERITY_LABEL: Record<Severity, string> = {
  critica: "Crítica",
  alta: "Alta",
  media: "Média",
  baixa: "Baixa",
  ok: "Sem pendência",
};
export const SEVERITY_TONE: Record<Severity, TiresTone> = {
  critica: "danger",
  alta: "warning",
  media: "info",
  baixa: "neutral",
  ok: "success",
};

export type EnrichmentStatus = "ok" | "sem_frota" | "frota_nao_encontrada" | "sem_contexto";
export const ENRICHMENT_LABEL: Record<EnrichmentStatus, string> = {
  ok: "Contexto completo",
  sem_frota: "Sem frota no relatório",
  frota_nao_encontrada: "Frota não encontrada no HFM",
  sem_contexto: "Sem operação na data",
};

export type InspectionStatus = "pendente_revisao" | "pendente_rodopar" | "sincronizado_rodopar" | "retornar_divergencia" | "substituida";
export const INSPECTION_STATUS_LABEL: Record<InspectionStatus, string> = {
  pendente_revisao: "Pendente de revisão",
  pendente_rodopar: "Pendente de lançamento no Rodopar",
  sincronizado_rodopar: "Sincronizada com o Rodopar",
  retornar_divergencia: "Retornada por divergência",
  substituida: "Substituída por nova medição",
};
export const INSPECTION_STATUS_SHORT: Record<InspectionStatus, string> = {
  pendente_revisao: "Em revisão",
  pendente_rodopar: "Pendente Rodopar",
  sincronizado_rodopar: "Sincronizada",
  retornar_divergencia: "Retornada",
  substituida: "Substituída",
};
export const INSPECTION_STATUS_TONE: Record<InspectionStatus, TiresTone> = {
  pendente_revisao: "warning",
  pendente_rodopar: "progress",
  sincronizado_rodopar: "success",
  retornar_divergencia: "danger",
  substituida: "neutral",
};
export const INSPECTION_STATUSES = Object.keys(INSPECTION_STATUS_LABEL) as InspectionStatus[];

export type DivergenceType =
  | "SEM_REFERENCIA"
  | "PNEU_DIFERENTE"
  | "POSICAO_NAO_ENCONTRADA"
  | "SULCO_DIVERGENTE"
  | "PSI_DIVERGENTE"
  | "MEDICAO_INCOMPLETA";
export const DIVERGENCE_LABEL: Record<DivergenceType, string> = {
  SEM_REFERENCIA: "Sem referência oficial",
  PNEU_DIFERENTE: "Pneu diferente",
  POSICAO_NAO_ENCONTRADA: "Pneu está em outra posição",
  SULCO_DIVERGENTE: "Sulco divergente",
  PSI_DIVERGENTE: "PSI divergente",
  MEDICAO_INCOMPLETA: "Medição incompleta",
};
export const DIVERGENCE_TONE: Record<DivergenceType, TiresTone> = {
  SEM_REFERENCIA: "pending",
  PNEU_DIFERENTE: "danger",
  POSICAO_NAO_ENCONTRADA: "danger",
  SULCO_DIVERGENTE: "warning",
  PSI_DIVERGENTE: "warning",
  MEDICAO_INCOMPLETA: "neutral",
};

export type SyncStatus = "pending" | "synced" | "persistent" | "not_applicable";
export const SYNC_LABEL: Record<SyncStatus, string> = {
  pending: "Aguardando o Rodopar",
  synced: "Chegou ao Rodopar",
  persistent: "Divergência persistente",
  not_applicable: "Não medida",
};
export const SYNC_TONE: Record<SyncStatus, TiresTone> = {
  pending: "progress",
  synced: "success",
  persistent: "danger",
  not_applicable: "neutral",
};

export const EVENT_TYPE_LABEL: Record<string, string> = {
  TIRE_CREATED: "Primeira fotografia",
  TIRE_IMPORTED: "Cadastro atualizado",
  TIRE_MOVED: "Movimentado para outra frota",
  TIRE_POSITION_CHANGED: "Troca de posição",
  TIRE_MEASURED: "Medição de sulco",
  TIRE_PRESSURE_UPDATED: "Calibragem",
  TIRE_LIFE_CHANGED: "Mudança de vida",
  TIRE_STATUS_CHANGED: "Mudança de situação",
  TIRE_REMOVED: "Retirado da frota",
  TIRE_RETURNED_TO_STOCK: "Devolvido ao estoque",
  TIRE_SENT_TO_RETREAD: "Enviado para ressolagem",
  TIRE_DISCARDED: "Descartado / baixado",
  TIRE_ABSENT: "Ausente no relatório",
  TIRE_REAPPEARED: "Voltou ao relatório",
};
export const EVENT_TYPES = Object.keys(EVENT_TYPE_LABEL);
export const eventTypeLabel = (t: string) => EVENT_TYPE_LABEL[t] ?? t;
export const EVENT_TONE: Record<string, TiresTone> = {
  TIRE_CREATED: "info",
  TIRE_IMPORTED: "neutral",
  TIRE_MOVED: "progress",
  TIRE_POSITION_CHANGED: "progress",
  TIRE_MEASURED: "success",
  TIRE_PRESSURE_UPDATED: "success",
  TIRE_LIFE_CHANGED: "warning",
  TIRE_STATUS_CHANGED: "warning",
  TIRE_REMOVED: "warning",
  TIRE_RETURNED_TO_STOCK: "info",
  TIRE_SENT_TO_RETREAD: "warning",
  TIRE_DISCARDED: "danger",
  TIRE_ABSENT: "danger",
  TIRE_REAPPEARED: "info",
};

/** Inconsistências da importação e da base (códigos do banco). */
export const ISSUE_LABEL: Record<string, string> = {
  fogo_ausente: "Linha sem Nº Fogo",
  fogo_invalido: "Nº Fogo com caracteres inválidos",
  fogo_duplicado: "Nº Fogo duplicado no arquivo",
  colisao_posicao: "Dois pneus na mesma frota e posição",
  sulco_invalido: "Sulco fora do limite técnico",
  menor_mm_divergente: "Menor milimetragem informada difere da medida",
  sem_milimetragem: "Pneu em uso sem milimetragem",
  psi_invalido: "PSI fora do limite técnico",
  numero_formatado_como_data: "Número gravado como data no Rodopar",
  data_invalida: "Data inválida",
  data_futura: "Data posterior à fotografia",
  km_rodado_invalido: "KM rodado inválido",
  km_real_negativo: "KM Real negativo",
  vida_invalida: "Nº da vida inválido",
  situacao_nao_reconhecida: "Situação não reconhecida",
  em_uso_sem_frota: "Em uso sem frota",
  em_uso_sem_posicao: "Em uso sem posição",
  fora_de_uso_com_frota: "Fora de uso com frota ou posição",
  posicao_desconhecida: "Posição fora do dicionário",
  frota_nao_encontrada: "Frota não existe no HFM",
  vida_regrediu: "Vida regrediu",
  reativado_apos_baixa: "Voltou após descarte/baixa",
  sem_data_medicao: "Em uso sem data de medição",
  sem_data_calibragem: "Em uso sem data de calibragem",
  sem_medicao: "Em uso sem medição registrada",
  sem_calibragem: "Em uso sem calibragem registrada",
  sem_parametro_psi: "Sem parâmetro de PSI",
  posicao_fora_layout: "Posição fora do layout do veículo",
  posicao_layout_vazia: "Posição do layout sem pneu",
  ausente_ultima_importacao: "Ausente no último relatório",
};
/** Aceita o código como veio do banco (snake) ou camelizado (chave de contador). */
export const issueCode = (code: string) => code.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`).replace(/([a-z])(\d)/g, "$1_$2");
export const issueLabel = (code: string) => ISSUE_LABEL[code] ?? ISSUE_LABEL[issueCode(code)] ?? code;
export const ERROR_ISSUES = new Set(["fogo_ausente", "fogo_invalido", "fogo_duplicado", "colisao_posicao"]);

export type ImportBatchStatus = "staging" | "validated" | "blocked" | "confirmed" | "cancelled";
export const BATCH_STATUS_LABEL: Record<ImportBatchStatus, string> = {
  staging: "Recebendo linhas",
  validated: "Validado — pronto para confirmar",
  blocked: "Bloqueado",
  confirmed: "Confirmado (fotografia oficial)",
  cancelled: "Descartado",
};
export const BATCH_STATUS_TONE: Record<ImportBatchStatus, TiresTone> = {
  staging: "pending",
  validated: "info",
  blocked: "danger",
  confirmed: "success",
  cancelled: "neutral",
};

export const CHANGE_LABEL: Record<string, string> = {
  status: "Situação",
  vehicle: "Frota",
  position: "Posição",
  life: "Vida",
  measurement: "Medição",
  calibration: "Calibragem",
  attributes: "Cadastro",
};

export type RepairResolution = "snapshot_exact" | "snapshot_previous" | "event" | "manual" | "unresolved";
export const RESOLUTION_LABEL: Record<RepairResolution, string> = {
  snapshot_exact: "Fotografia da própria data",
  snapshot_previous: "Fotografia anterior",
  event: "Movimentação registrada",
  manual: "Informado manualmente",
  unresolved: "Veículo não resolvido",
};
export const CONFIDENCE_LABEL: Record<string, string> = { high: "Alta", medium: "Média", low: "Baixa", manual: "Manual" };

export type ServiceKind = "alignment" | "balancing" | "alignment_balancing" | "tire_service";
export const SERVICE_KIND_LABEL: Record<ServiceKind, string> = {
  alignment: "Alinhamento",
  balancing: "Balanceamento",
  alignment_balancing: "Alinhamento e balanceamento",
  tire_service: "Serviço de pneu",
};

export type AxleGroup = "front" | "rear" | "spare" | "other";
export const AXLE_LABEL: Record<AxleGroup, string> = { front: "Dianteiro", rear: "Traseiro", spare: "Estepe", other: "Outro" };
export const SIDE_LABEL: Record<string, string> = { left: "Esquerdo", right: "Direito", center: "Centro" };
export const SLOT_LABEL: Record<string, string> = { single: "Simples", outer: "Externo", inner: "Interno" };

export const LAYOUT_SOURCE_LABEL: Record<string, string> = {
  vehicle: "Configuração do veículo",
  vehicle_type: "Padrão do tipo de equipamento",
  inferred: "Inferido pelas posições em uso",
  snapshot: "Posições da fotografia (sem layout cadastrado)",
};

// ---------------------------------------------------------------------------
// Formatadores (pt-BR)
// ---------------------------------------------------------------------------
const nf0 = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const nf2 = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
export const fmtInt = (v: number | null | undefined) => (v == null ? "—" : nf0.format(v));
export const fmt1 = (v: number | null | undefined) => (v == null ? "—" : nf1.format(v));
export const fmtNum = (v: number | null | undefined) => (v == null ? "—" : nf2.format(v));
export const fmtPct = (v: number | null | undefined) => (v == null ? "—" : `${nf1.format(v)}%`);
export const fmtMm = (v: number | null | undefined) => (v == null ? "—" : `${nf2.format(v)} mm`);
export const fmtPsi = (v: number | null | undefined) => (v == null ? "—" : `${nf2.format(v)} PSI`);
export const fmtKm = (v: number | null | undefined) => (v == null ? "—" : `${nf0.format(v)} km`);
export const fmtDays = (v: number | null | undefined) => (v == null ? "—" : `${nf0.format(v)} ${v === 1 ? "dia" : "dias"}`);
export const plural = (n: number | null | undefined, one: string, many: string) => (n === 1 ? one : many);

// ---------------------------------------------------------------------------
// Parâmetros e cadastros
// ---------------------------------------------------------------------------
export interface TireParameterSet {
  id: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  measurementOkDays: number;
  measurementWarningDays: number;
  calibrationOkDays: number;
  calibrationWarningDays: number;
  treadCriticalMm: number;
  treadAttentionMm: number;
  maxValidTreadMm: number;
  maxValidPsi: number;
  futureDateToleranceDays: number;
  treadMinDivergenceToleranceMm: number;
  inspectionTreadToleranceMm: number;
  inspectionPsiTolerance: number;
  staleUpdateDays: number;
  reviewSlaDays: number;
  rodoparSyncSlaDays: number;
  repairResolutionMaxAgeDays: number;
  retreadAlertUseRodoparCondition: boolean;
  retreadAlertTreadMm: number | null;
  note: string | null;
  updatedAt?: string;
}

export interface TirePressureRule {
  id: string;
  vehicleTypeId: string | null;
  vehicleTypeName: string | null;
  dimension: string | null;
  dimensionKey: string | null;
  positionCode: string | null;
  axleGroup: "front" | "rear" | "spare" | null;
  minPsi: number;
  idealPsi: number;
  maxPsi: number;
  minLegalTreadMm: number | null;
  attentionTreadMm: number | null;
  isActive: boolean;
  validFrom: string;
  validTo: string | null;
  notes: string | null;
}

export interface TirePosition {
  id: string;
  code: string;
  label: string;
  axleGroup: AxleGroup;
  axleIndex: number;
  side: "left" | "right" | "center";
  slot: "single" | "outer" | "inner";
  sortOrder: number;
  aliases: string[];
  isActive: boolean;
}

export interface TireLayout {
  id: string;
  code: string;
  name: string;
  description: string | null;
  positionCodes: string[];
  isActive: boolean;
  vehicleTypes: { id: string; name: string }[];
  vehicles: number;
}

export interface TiresCatalog {
  today: string;
  latestReferenceDate: string | null;
  parameters: TireParameterSet | null;
  parameterHistory: TireParameterSet[];
  pressureRules: TirePressureRule[];
  positions: TirePosition[];
  layouts: TireLayout[];
  vehicleTypeLayouts: { vehicleTypeId: string; vehicleTypeName: string; layoutId: string | null }[];
  vehicleLayouts: { vehicleId: string; licensePlate: string | null; fleetCode: string | null; layoutId: string | null; reason: string | null; updatedAt: string }[];
  serviceKinds: { serviceId: string; serviceName: string; clusterName: string | null; kind: ServiceKind; isActive: boolean }[];
  services: { id: string; name: string; clusterName: string | null }[];
  vehicleTypes: { id: string; name: string }[];
  observedDimensions: { key: string; label: string; tires: number }[];
  observedPositions: { code: string; tires: number }[];
}

// ---------------------------------------------------------------------------
// Linha avaliada da fotografia (private.tire_rows)
// ---------------------------------------------------------------------------
export interface TireRow {
  snapshotId: string;
  tireId: string;
  fireNumber: string;
  referenceDate: string;
  importBatchId: string;
  canonicalStatus: CanonicalStatus;
  rodoparStatusRaw: string | null;
  rodoparStatusLabel: string | null;
  rodoparCondition: string | null;
  brand: string | null;
  model: string | null;
  dimension: string | null;
  dimensionKey: string | null;
  serialNumber: string | null;
  dot: string | null;
  drawing: string | null;
  rubber: string | null;
  life: number | null;
  positionCode: string | null;
  positionLabel: string | null;
  positionSort: number;
  axleGroup: AxleGroup | null;
  vehicleId: string | null;
  licensePlate: string | null;
  fleetNumber: string | null;
  fleetNumberRaw: string | null;
  vehicleTypeId: string | null;
  vehicleTypeName: string | null;
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
  enrichmentStatus: EnrichmentStatus;
  tread1: number | null;
  tread2: number | null;
  tread3: number | null;
  tread4: number | null;
  treadMinRaw: number | null;
  treadMinCalculated: number | null;
  treadMin: number | null;
  treadDivergence: boolean;
  treadClass: TreadClass;
  legalTreadMm: number | null;
  measurementDate: string | null;
  measurementDays: number | null;
  measurementStatus: DeadlineStatus;
  measurementDueDate: string | null;
  psi: number | null;
  calibrationDate: string | null;
  calibrationDays: number | null;
  calibrationStatus: DeadlineStatus;
  calibrationDueDate: string | null;
  pressureRuleId: string | null;
  psiMin: number | null;
  psiIdeal: number | null;
  psiMax: number | null;
  psiStatus: PsiStatus;
  kmRodado: number | null;
  kmReal: number | null;
  rodoparUpdatedAt: string | null;
  staleDays: number | null;
  retreadAlert: boolean;
  qualityFlags: string[];
  severityScore: number;
  severity: Severity;
}

// ---------------------------------------------------------------------------
// Visão geral
// ---------------------------------------------------------------------------
export interface TireOverviewKpis {
  total: number;
  emUso: number;
  estoque: number;
  ressolagem: number;
  descartado: number;
  baixado: number;
  outro: number;
  belowLegal: number;
  critical: number;
  attention: number;
  treadUnknown: number;
  measurementOverdue: number;
  measurementDueSoon: number;
  measurementMissing: number;
  measurementOk: number;
  calibrationOverdue: number;
  calibrationDueSoon: number;
  calibrationMissing: number;
  calibrationOk: number;
  psiLow: number;
  psiHigh: number;
  psiAdequate: number;
  psiNoRule: number;
  psiMissing: number;
  inUseWithoutVehicle: number;
  retreadAlerts: number;
  qualityIssueTires: number;
  stale: number;
  fleets: number;
  fleetsCompliant: number;
  fleetsWithCritical: number;
  treadAvg: number | null;
  treadMedian: number | null;
  movements30d: number;
  lifeChanges30d: number;
  absent: number;
  pctEmUso: number | null;
  pctEstoque: number | null;
  measurementCoveragePct: number | null;
  measurementAdherencePct: number | null;
  calibrationCoveragePct: number | null;
  calibrationAdherencePct: number | null;
  pressureAdequatePct: number | null;
  qualityScore: number | null;
  psiRuleGaps: number;
  inspections: {
    pendingReview: number;
    pendingRodopar: number;
    pendingRodoparOverSla: number;
    returned: number;
    persistent: number;
  };
}

export interface TireDistItem {
  key: string;
  label?: string;
  count: number;
  critical?: number;
  overdue?: number;
}

export interface TireDistributions {
  status: TireDistItem[];
  treadClass: TireDistItem[];
  measurementStatus: TireDistItem[];
  calibrationStatus: TireDistItem[];
  psiStatus: TireDistItem[];
  brand: TireDistItem[];
  model: TireDistItem[];
  dimension: TireDistItem[];
  life: TireDistItem[];
  position: TireDistItem[];
  vehicleType: TireDistItem[];
  operation: TireDistItem[];
  city: TireDistItem[];
  br: TireDistItem[];
}

export type TirePriorityRow = Pick<
  TireRow,
  | "tireId" | "fireNumber" | "positionCode" | "positionLabel" | "positionSort" | "vehicleId" | "licensePlate" | "fleetNumber"
  | "operationId" | "operationName" | "cityId" | "cityName" | "stateUf" | "operationBrId" | "brCode" | "treadMin" | "tread1"
  | "tread2" | "tread3" | "tread4" | "treadClass" | "legalTreadMm" | "measurementDate" | "measurementDays" | "measurementStatus"
  | "psi" | "psiMin" | "psiMax" | "calibrationDate" | "calibrationDays" | "calibrationStatus" | "psiStatus" | "treadDivergence"
  | "retreadAlert" | "severityScore" | "severity"
>;

export interface TireInsight {
  key: string;
  tone: "danger" | "warning" | "info" | "success";
  count: number;
  text: string;
}

export interface TireTrendPoint {
  referenceDate: string;
  total: number;
  inUse: number;
  critical: number;
  psiOut: number;
  measurementCoveragePct: number | null;
  measurementAdherencePct: number | null;
  calibrationCoveragePct: number | null;
  calibrationAdherencePct: number | null;
  qualityScore: number | null;
}

export interface TirePhoto {
  batchId: string;
  fileName: string;
  confirmedAt: string;
  confirmedByName: string | null;
  totalRows: number;
  referenceDate: string;
}

export interface TireOverview {
  empty: boolean;
  today: string;
  asOf?: string;
  referenceDate: string | null;
  latestReferenceDate?: string | null;
  previousReferenceDate?: string | null;
  isLatest?: boolean;
  photo?: TirePhoto | null;
  parameters?: TireParameterSet;
  kpis?: TireOverviewKpis;
  distributions?: TireDistributions;
  priorities?: TirePriorityRow[];
  insights?: TireInsight[];
  trend?: TireTrendPoint[];
}

export interface TireFilterOptions {
  referenceDates: { referenceDate: string; fileName: string; confirmedAt: string; batchId: string }[];
  operations: { id: string; name: string }[];
  states: { id: number; uf: string }[];
  cities: { id: number; name: string; stateId: number; uf: string }[];
  brs: { id: string; code: string; operationId: string }[];
  leaders: { id: string; name: string }[];
  units: { id: string; name: string }[];
  vehicleTypes: { id: string; name: string }[];
  vehicles: { id: string; plate: string | null; fleet: string | null }[];
  brands: string[];
  models: string[];
  dimensions: { key: string; label: string }[];
  lives: number[];
  positions: { code: string; label: string }[];
}

// ---------------------------------------------------------------------------
// Base geral
// ---------------------------------------------------------------------------
export type TiresBaseView = "frota" | "fogo" | "fora";

export interface TireVehicleLayout {
  layoutId: string | null;
  layoutCode: string | null;
  layoutName: string | null;
  layoutSource: "vehicle" | "vehicle_type" | "inferred" | "snapshot";
  positionCodes: string[];
}

export interface TireFleetGroup {
  key: string;
  vehicleId: string | null;
  licensePlate: string | null;
  fleetNumber: string | null;
  vehicleTypeName: string | null;
  operationName: string | null;
  cityName: string | null;
  stateUf: string | null;
  brCode: string | null;
  leaderName: string | null;
  unitName: string | null;
  tires: number;
  belowLegal: number;
  critical: number;
  attention: number;
  psiOut: number;
  psiNoRule: number;
  measurementOverdue: number;
  measurementMissing: number;
  calibrationOverdue: number;
  calibrationMissing: number;
  oldestMeasurement: string | null;
  oldestCalibration: string | null;
  worstTread: number | null;
  status: "critico" | "atencao" | "ok";
  layout: TireVehicleLayout | null;
  tireRows: TireRow[];
}

export interface TiresBaseFleet {
  empty?: boolean;
  view: "frota";
  referenceDate: string;
  asOf: string;
  limit: number;
  offset: number;
  total: number;
  summary: { fleets: number; critical: number; attention: number; ok: number; tires: number };
  groups: TireFleetGroup[];
}

export interface TiresBaseRows {
  empty?: boolean;
  view: "fogo" | "fora";
  referenceDate: string;
  asOf: string;
  limit: number;
  offset: number;
  total: number;
  statusCounts: { key: CanonicalStatus; count: number }[];
  summary: {
    total: number;
    inUse: number;
    measurementOverdue: number;
    measurementDueSoon: number;
    measurementMissing: number;
    psiOut: number;
    withoutVehicle: number;
    treadDivergence: number;
    kmRealNegative: number;
    retreadAlerts: number;
  };
  rows: TireRow[];
}

export type TiresBase = TiresBaseFleet | TiresBaseRows;

// ---------------------------------------------------------------------------
// Aderências, cronograma, qualidade
// ---------------------------------------------------------------------------
export interface TireBreakdownItem {
  id: string | null;
  name: string | null;
  total: number;
  emDia: number;
  proximo: number;
  vencido: number;
  semRegistro: number;
  coveragePct: number | null;
  adherencePct: number | null;
}

export type TireBreakdownDim = "operation" | "state" | "city" | "br" | "unit" | "leader" | "vehicleType";
export const BREAKDOWN_LABEL: Record<TireBreakdownDim, string> = {
  operation: "Operação",
  state: "Estado",
  city: "Local",
  br: "BR",
  unit: "Filial",
  leader: "Liderança",
  vehicleType: "Tipo de equipamento",
};

export interface TirePendingRow {
  tireId: string;
  fireNumber: string;
  positionCode: string | null;
  positionLabel: string | null;
  positionSort: number;
  vehicleId: string | null;
  licensePlate: string | null;
  fleetNumber: string | null;
  operationName: string | null;
  cityId: number | null;
  cityName: string | null;
  stateUf: string | null;
  unitName: string | null;
  leaderName: string | null;
  brCode: string | null;
  treadMin: number | null;
  tread1: number | null;
  tread2: number | null;
  tread3: number | null;
  tread4: number | null;
  treadClass: TreadClass;
  psi: number | null;
  psiMin: number | null;
  psiIdeal: number | null;
  psiMax: number | null;
  psiStatus: PsiStatus;
  lastDate: string | null;
  days: number | null;
  status: DeadlineStatus;
  dueDate: string | null;
}

export interface TiresAdherence {
  empty?: boolean;
  kind: "measurement" | "calibration";
  referenceDate: string;
  asOf: string;
  isLatest: boolean;
  parameters: { okDays: number; warningDays: number };
  kpis: {
    eligible: number;
    withRecord: number;
    emDia: number;
    proximo: number;
    vencido: number;
    semRegistro: number;
    coveragePct: number | null;
    adherencePct: number | null;
    psiAdequate: number;
    psiLow: number;
    psiHigh: number;
    psiNoRule: number;
    psiMissing: number;
    pressureAdequatePct: number | null;
    treadCritical: number;
    treadAttention: number;
  };
  breakdowns: Partial<Record<TireBreakdownDim, TireBreakdownItem[]>>;
  ranking: {
    vehicleId: string | null;
    licensePlate: string | null;
    fleetNumber: string | null;
    operationName: string | null;
    cityName: string | null;
    tires: number;
    overdue: number;
    missing: number;
    worstDays: number | null;
    adherencePct: number | null;
  }[];
  gaps: { vehicleTypeId: string | null; vehicleTypeName: string | null; dimension: string | null; dimensionKey: string | null; positionCode: string | null; tires: number }[];
  pendingTotal: number;
  pending: TirePendingRow[];
  limit: number;
  offset: number;
}

export type ScheduleWindow = "todos" | "vencidos" | "hoje" | "7d" | "15d" | "proximos" | "sem_medicao" | "sem_calibragem";
export const SCHEDULE_WINDOW_LABEL: Record<ScheduleWindow, string> = {
  todos: "Todas as frotas",
  vencidos: "Vencidos",
  hoje: "Vence hoje",
  "7d": "Próximos 7 dias",
  "15d": "Próximos 15 dias",
  proximos: "Próximos do vencimento",
  sem_medicao: "Sem medição",
  sem_calibragem: "Sem calibragem",
};

export interface TireScheduleRow {
  vehicleId: string | null;
  licensePlate: string | null;
  fleetNumber: string | null;
  vehicleTypeName: string | null;
  operationName: string | null;
  cityName: string | null;
  stateUf: string | null;
  brCode: string | null;
  leaderName: string | null;
  tires: number;
  lastMeasurement: string | null;
  lastCalibration: string | null;
  nextMeasurement: string | null;
  nextCalibration: string | null;
  nextDue: string | null;
  measurementStatus: DeadlineStatus;
  calibrationStatus: DeadlineStatus;
  worst: number;
  tireRows: {
    tireId: string;
    fireNumber: string;
    positionCode: string | null;
    positionLabel: string | null;
    measurementDate: string | null;
    measurementStatus: DeadlineStatus;
    calibrationDate: string | null;
    calibrationStatus: DeadlineStatus;
  }[];
}

export interface TiresSchedule {
  empty?: boolean;
  referenceDate: string;
  asOf: string;
  today: string;
  window: ScheduleWindow;
  parameters: { measurementOkDays: number; measurementWarningDays: number; calibrationOkDays: number; calibrationWarningDays: number };
  kpis: {
    units: number;
    measurementOverdue: number;
    measurementDueSoon: number;
    measurementMissing: number;
    calibrationOverdue: number;
    calibrationDueSoon: number;
    calibrationMissing: number;
  };
  agenda: { vencidos: number; hoje: number; proximos7: number; proximos15: number; semMedicao: number; semCalibragem: number };
  total: number;
  rows: TireScheduleRow[];
  limit: number;
  offset: number;
}

export interface TireQualityRow {
  tireId: string | null;
  fireNumber: string | null;
  vehicleId: string | null;
  licensePlate: string | null;
  fleetNumber: string | null;
  positionCode: string | null;
  code: string;
  detail: string | null;
}

export interface TiresQuality {
  empty?: boolean;
  referenceDate: string;
  asOf: string;
  totalTires: number;
  tiresWithRodoparIssue: number;
  qualityScore: number | null;
  issues: { code: string; count: number; tires: number }[];
  lastBatch: {
    id: string;
    status: ImportBatchStatus;
    fileName: string;
    referenceDate: string;
    errorRows: number;
    warningRows: number;
    totalRows: number;
    counters: TireImportCounters;
    blockReason: string | null;
    createdAt: string;
  } | null;
  issue: string | null;
  issueTotal: number;
  rows: TireQualityRow[];
  limit: number;
  offset: number;
}

// ---------------------------------------------------------------------------
// Histórico e ficha
// ---------------------------------------------------------------------------
export interface TireEventRow {
  id: string;
  tireId: string;
  fireNumber: string;
  eventType: string;
  referenceDate: string;
  occurredAt: string;
  vehicleId: string | null;
  licensePlate: string | null;
  fleetNumber: string | null;
  previousVehicleId: string | null;
  previousLicensePlate: string | null;
  previousFleetNumber: string | null;
  positionCode: string | null;
  previousPositionCode: string | null;
  previous: Record<string, unknown>;
  current: Record<string, unknown>;
  source: "rodopar_import" | "system";
  importBatchId: string | null;
}

export interface TiresEventsList {
  total: number;
  counts: Record<string, number>;
  rows: TireEventRow[];
  limit: number;
  offset: number;
}

export interface TireSheetSnapshot {
  referenceDate: string;
  canonicalStatus: CanonicalStatus;
  rodoparStatusRaw: string | null;
  vehicleId: string | null;
  licensePlate: string | null;
  fleetNumber: string | null;
  positionCode: string | null;
  life: number | null;
  treadMin: number | null;
  tread1: number | null;
  tread2: number | null;
  tread3: number | null;
  tread4: number | null;
  measurementDate: string | null;
  psi: number | null;
  calibrationDate: string | null;
  operationName: string | null;
  cityName: string | null;
  brCode: string | null;
  qualityFlags: string[];
}

export interface TireSheet {
  tire: {
    id: string;
    fireNumber: string;
    serialNumber: string | null;
    brand: string | null;
    model: string | null;
    dimension: string | null;
    dot: string | null;
    drawing: string | null;
    rubber: string | null;
    purchaseDate: string | null;
    registrationDate: string | null;
    currentLife: number | null;
    currentStatus: CanonicalStatus;
    rodoparStatusRaw: string | null;
    currentVehicleId: string | null;
    currentPositionCode: string | null;
    firstReferenceDate: string;
    lastReferenceDate: string;
    presenceStatus: "present" | "absent";
    absentSince: string | null;
  };
  latestReferenceDate: string | null;
  current: TireRow | null;
  layout: TireVehicleLayout | null;
  rodopar: {
    rodoparTireBranch: string | null;
    unitCode: string | null;
    costCode: string | null;
    fleetBranch: string | null;
    fleetNumberRaw: string | null;
    rodoparStatusRaw: string | null;
    rodoparStatusLabel: string | null;
    rodoparCondition: string | null;
    rodoparClassification: string | null;
    registrationAt: string | null;
    rodoparCreatedBy: string | null;
    rodoparUpdatedBy: string | null;
    rodoparUpdatedAt: string | null;
    measurementAt: string | null;
    calibrationAt: string | null;
    kmRodado: number | null;
    kmReal: number | null;
    qualityFlags: string[];
    enrichmentStatus: EnrichmentStatus;
    referenceDate: string;
    importBatchId: string;
  };
  snapshots: TireSheetSnapshot[];
  events: {
    id: string;
    eventType: string;
    referenceDate: string;
    occurredAt: string;
    previous: Record<string, unknown>;
    current: Record<string, unknown>;
    vehicleId: string | null;
    previousVehicleId: string | null;
    positionCode: string | null;
    previousPositionCode: string | null;
    source: string;
    note: string | null;
    importBatchId: string | null;
  }[];
  repairs: {
    id: string;
    serviceDate: string;
    repairType: string;
    supplierName: string | null;
    serviceOrderNumber: string | null;
    notes: string | null;
    licensePlate: string | null;
    fleetCode: string | null;
    vehicleResolution: RepairResolution;
    resolutionConfidence: string | null;
    status: "active" | "voided";
  }[];
  inspections: {
    inspectionId: string;
    protocol: string;
    status: InspectionStatus;
    inspectionDate: string;
    positionCode: string;
    fireNumberRead: string | null;
    tread1: number | null;
    tread2: number | null;
    tread3: number | null;
    tread4: number | null;
    psiRead: number | null;
    divergences: { type: DivergenceType; detail: string }[];
    syncStatus: SyncStatus;
    inspectorName: string;
  }[];
}

export interface TirePositionInfo {
  code: string;
  label: string;
  axleGroup: AxleGroup;
  axleIndex: number;
  side: "left" | "right" | "center";
  slot: "single" | "outer" | "inner";
  sortOrder: number;
}

export interface TireVehicleSummary {
  empty: boolean;
  organizationId?: string;
  referenceDate?: string;
  layout?: TireVehicleLayout | null;
  tires?: TireRow[];
  positions?: TirePositionInfo[];
  inspections?: { id: string; protocol: string; status: InspectionStatus; inspectionDate: string; positionsMeasured: number; positionsDivergent: number }[];
}

// ---------------------------------------------------------------------------
// Importação Rodopar 10
// ---------------------------------------------------------------------------
export interface TireImportCounters {
  status?: Record<string, number>;
  changes?: Record<string, number>;
  issues?: Record<string, number>;
  vehiclesResolved?: number;
  fleetsInFile?: number;
  fleetsNotFound?: number;
  maxUpdatedAt?: string | null;
  referenceBeforeLastChange?: boolean;
  missingColumns?: string[];
  blockReasons?: string[];
}

export interface TireImportBatch {
  id: string;
  organizationId: string;
  fileName: string;
  fileHash: string;
  fileSize: number | null;
  sheetName: string | null;
  headerRow: number | null;
  layoutVersion: string;
  windowStart: string | null;
  windowEnd: string | null;
  recognizedColumns?: string[];
  unrecognizedColumns?: string[];
  ignoredColumns?: string[];
  referenceDate: string;
  suggestedReferenceDate: string | null;
  previousReferenceDate: string | null;
  status: ImportBatchStatus;
  totalRows: number;
  validRows: number;
  warningRows: number;
  errorRows: number;
  newTires: number;
  updatedTires: number;
  unchangedTires: number;
  absentTires: number;
  reappearedTires: number;
  counters: TireImportCounters;
  reconciliation: { checked?: number; synced?: number; persistent?: number; pending?: number };
  blockReason: string | null;
  createdByName: string | null;
  createdAt: string;
  validatedAt: string | null;
  confirmedByName: string | null;
  confirmedAt: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
}

export type ImportPreviewSection = "issues" | "changes" | "new" | "rows" | "absent" | "reappeared";

export interface TireImportPreviewRow {
  rowNumber: number;
  fireNumber: string | null;
  severity: "ok" | "warning" | "error" | "pending";
  action: "new" | "updated" | "unchanged" | null;
  changes: string[];
  issues: { code: string; severity: "error" | "warning"; field?: string; value?: string; message: string }[];
  canonicalStatus: CanonicalStatus | null;
  rodoparStatusRaw: string | null;
  fleetNumberRaw: string | null;
  positionCode: string | null;
  life: number | null;
  treadMinRaw: number | null;
  treadMinCalculated: number | null;
  tread1: number | null;
  tread2: number | null;
  tread3: number | null;
  tread4: number | null;
  psi: number | null;
  measurementAt: string | null;
  calibrationAt: string | null;
  vehicleId: string | null;
  licensePlate: string | null;
  brand: string | null;
  model: string | null;
  dimension: string | null;
  prevStatus: CanonicalStatus | null;
  prevFleet: string | null;
  prevPlate: string | null;
  prevPosition: string | null;
  prevLife: number | null;
  prevTreadMin: number | null;
  prevPsi: number | null;
  prevMeasurementDate: string | null;
  prevCalibrationDate: string | null;
}

export interface TireImportAbsentRow {
  id: string;
  fireNumber: string;
  currentStatus: CanonicalStatus;
  currentPositionCode: string | null;
  licensePlate: string | null;
  fleetCode: string | null;
  lastReferenceDate: string;
  brand: string | null;
  model: string | null;
}

export interface TireImportPreview {
  batch: TireImportBatch;
  section: ImportPreviewSection;
  filter: string | null;
  total: number;
  rows: (TireImportPreviewRow | TireImportAbsentRow)[];
  limit: number;
  offset: number;
}

export interface TireImportHistory {
  total: number;
  latestReferenceDate: string | null;
  rows: TireImportBatch[];
  limit: number;
  offset: number;
}

// ---------------------------------------------------------------------------
// Vistorias
// ---------------------------------------------------------------------------
export interface TireInspectionRow {
  id: string;
  protocol: string;
  status: InspectionStatus;
  vehicleId: string;
  licensePlate: string;
  fleetCode: string | null;
  vehicleTypeName: string | null;
  operationName: string | null;
  cityName: string | null;
  stateUf: string | null;
  brCode: string | null;
  leaderName: string | null;
  inspectorName: string;
  inspectionDate: string;
  submittedAt: string;
  positionsExpected: number;
  positionsMeasured: number;
  positionsDivergent: number;
  reviewedByName: string | null;
  reviewedAt: string | null;
  approvedAt: string | null;
  syncedAt: string | null;
  persistentDivergence: boolean;
  parentInspectionId: string | null;
  waitingDays: number | null;
}

export interface TiresInspectionsReceived {
  kpis: {
    pendenteRevisao: number;
    pendenteRodopar: number;
    sincronizadoRodopar: number;
    retornarDivergencia: number;
    substituida: number;
    pendingWithDivergence: number;
    reviewOverSla: number;
    rodoparOverSla: number;
    persistent: number;
    avgReviewHours: number | null;
    reviewSlaDays: number;
    rodoparSyncSlaDays: number;
  };
  inspectors: { id: string; name: string }[];
  total: number;
  rows: TireInspectionRow[];
  limit: number;
  offset: number;
}

export interface TireInspectionItem {
  id: string;
  positionCode: string;
  positionLabelSnapshot: string | null;
  sortOrder: number;
  measured: boolean;
  fireNumberRead: string | null;
  tread1: number | null;
  tread2: number | null;
  tread3: number | null;
  tread4: number | null;
  psiRead: number | null;
  observation: string | null;
  expectedTireId: string | null;
  expectedFireNumber: string | null;
  refSnapshotId: string | null;
  refTread1: number | null;
  refTread2: number | null;
  refTread3: number | null;
  refTread4: number | null;
  refTreadMin: number | null;
  refPsi: number | null;
  refMeasurementDate: string | null;
  refCalibrationDate: string | null;
  divergences: { type: DivergenceType; detail: string }[];
  hasDivergence: boolean;
  syncStatus: SyncStatus;
  syncedSnapshotId: string | null;
  syncNote: string | null;
}

export interface TireInspectionDetail {
  id: string;
  protocol: string;
  status: InspectionStatus;
  vehicleId: string;
  licensePlateSnapshot: string;
  fleetCodeSnapshot: string | null;
  vehicleTypeNameSnapshot: string | null;
  operationNameSnapshot: string | null;
  cityNameSnapshot: string | null;
  stateUfSnapshot: string | null;
  brCodeSnapshot: string | null;
  unitNameSnapshot: string | null;
  leaderNameSnapshot: string | null;
  inspectorNameSnapshot: string;
  inspectorCodeSnapshot: string | null;
  inspectionDate: string;
  startedAt: string | null;
  inspectedAt: string;
  submittedAt: string;
  referenceSnapshotDate: string | null;
  layoutSource: string;
  positionsExpected: number;
  positionsMeasured: number;
  positionsDivergent: number;
  divergenceCount: number;
  generalObservation: string | null;
  reviewedByName: string | null;
  reviewedAt: string | null;
  reviewNote: string | null;
  approvedAt: string | null;
  syncedBatchId: string | null;
  syncedAt: string | null;
  syncResult: Record<string, unknown>;
  persistentDivergence: boolean;
  lastReconciledAt: string | null;
  parentInspectionId: string | null;
  items: TireInspectionItem[];
  history: { id: string; fromStatus: InspectionStatus | null; toStatus: InspectionStatus; reason: string | null; source: "user" | "import" | "system"; actorName: string | null; createdAt: string }[];
  children: { id: string; protocol: string; status: InspectionStatus; submittedAt: string }[];
  canReview: boolean;
  transitions: InspectionStatus[];
}

// ---------------------------------------------------------------------------
// Aplicativo (leitura cega)
// ---------------------------------------------------------------------------
export interface TireAppContext {
  today: string;
  app: { id: string; name: string; isActive: boolean } | null;
  actor: { userId: string; name: string; code: string | null; hasEmployee: boolean };
  limits: { maxTreadMm: number; maxPsi: number; fireNumberPattern: string };
  hasOfficialPhoto: boolean;
  counts: { minePending: number; mineReturned: number };
}

export interface TireAppVehicle {
  id: string;
  licensePlate: string;
  fleetCode: string | null;
  vehicleTypeName: string | null;
  operationName: string | null;
  cityName: string | null;
  stateUf: string | null;
  brCode: string | null;
  positions: number;
  returnedInspectionId: string | null;
  lastInspectionDate: string | null;
}

export interface TireAppVehicles {
  appAvailable: boolean;
  total: number;
  vehicles: TireAppVehicle[];
}

export interface TireAppPositions {
  vehicle: {
    id: string;
    licensePlate: string;
    fleetCode: string | null;
    operationName: string | null;
    cityName: string | null;
    stateUf: string | null;
    brCode: string | null;
    leaderName: string | null;
    vehicleTypeName: string | null;
  };
  layout: { source: string | null; name: string | null };
  positions: TirePositionInfo[];
  returnedInspection: { id: string; protocol: string; reviewNote: string | null; reviewedAt: string | null } | null;
}

export interface TireAppSubmitResult {
  id: string;
  protocol: string;
  submittedAt: string;
  positionsExpected: number;
  positionsMeasured: number;
  duplicate: boolean;
}

export interface TireMyInspectionRow {
  id: string;
  protocol: string;
  vehicleId: string;
  licensePlate: string;
  fleetCode: string | null;
  inspectionDate: string;
  submittedAt: string;
  status: InspectionStatus;
  positionsExpected: number;
  positionsMeasured: number;
  reviewNote: string | null;
  reviewedAt: string | null;
}

export interface TireMyInspections {
  total: number;
  rows: TireMyInspectionRow[];
  limit: number;
  offset: number;
}

export interface TireMyInspectionDetail {
  id: string;
  protocol: string;
  status: InspectionStatus;
  vehicleId: string;
  licensePlate: string;
  fleetCode: string | null;
  operationName: string | null;
  cityName: string | null;
  inspectionDate: string;
  submittedAt: string;
  generalObservation: string | null;
  reviewNote: string | null;
  reviewedAt: string | null;
  positionsExpected: number;
  positionsMeasured: number;
  items: {
    positionCode: string;
    positionLabel: string | null;
    measured: boolean;
    fireNumberRead: string | null;
    tread1: number | null;
    tread2: number | null;
    tread3: number | null;
    tread4: number | null;
    psiRead: number | null;
    observation: string | null;
    divergenceTypes: DivergenceType[];
  }[];
  history: { fromStatus: InspectionStatus | null; toStatus: InspectionStatus; reason: string | null; createdAt: string }[];
}

// ---------------------------------------------------------------------------
// Serviços
// ---------------------------------------------------------------------------
export interface TireRepairRow {
  id: string;
  tireId: string;
  fireNumberSnapshot: string;
  serviceDate: string;
  repairType: string;
  serviceId: string | null;
  supplierId: string | null;
  supplierNameSnapshot: string | null;
  serviceOrderNumber: string | null;
  notes: string | null;
  vehicleId: string | null;
  licensePlateSnapshot: string | null;
  fleetCodeSnapshot: string | null;
  positionCodeSnapshot: string | null;
  vehicleResolution: RepairResolution;
  resolutionReferenceDate: string | null;
  resolutionConfidence: string | null;
  overrideReason: string | null;
  status: "active" | "voided";
  voidReason: string | null;
  createdByName: string | null;
  createdAt: string;
}

export interface TiresRepairsList {
  kpis: { total: number; tires: number; unresolved: number; manual: number; topTypes: { type: string; count: number }[] };
  total: number;
  rows: TireRepairRow[];
  suppliers: { id: string; name: string }[];
  services: { id: string; name: string }[];
  knownTypes: string[];
  limit: number;
  offset: number;
}

export interface TireRepairSuggestion {
  found: boolean;
  tire?: { id: string; fireNumber: string; brand: string | null; model: string | null; dimension: string | null; currentStatus: CanonicalStatus };
  suggestion?: {
    vehicleId: string | null;
    licensePlate: string | null;
    fleetCode: string | null;
    positionCode: string | null;
    resolution: RepairResolution;
    referenceDate: string | null;
    confidence: string | null;
    message: string;
  };
}

export interface TireMaintenanceServiceRow {
  id: string;
  code: string;
  vehicleId: string | null;
  licensePlateSnapshot: string | null;
  fleetCodeSnapshot: string | null;
  status: string;
  priority: string | null;
  requestedOn: string | null;
  scheduledDate: string | null;
  entryDate: string | null;
  exitDate: string | null;
  serviceOrderNumber: string | null;
  operationId: string | null;
  operationNameSnapshot: string | null;
  cityNameSnapshot: string | null;
  stateUfSnapshot: string | null;
  maintenanceTypeCode: string | null;
  supplierName: string | null;
  kinds: ServiceKind[];
  services: string | null;
  kind: ServiceKind;
}

export interface TiresMaintenanceServices {
  kpis: {
    total: number;
    alignment: number;
    balancing: number;
    alignmentBalancing: number;
    tireService: number;
    open: number;
    completed: number;
    avgDays: number | null;
  };
  mappedServices: number;
  total: number;
  rows: TireMaintenanceServiceRow[];
  limit: number;
  offset: number;
}

export interface TireAuditRow {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  summary: string | null;
  previousValues: Record<string, unknown> | null;
  currentValues: Record<string, unknown> | null;
  actorUserId: string | null;
  actorName: string | null;
  createdAt: string;
}

export interface TiresAuditList {
  total: number;
  actions: string[];
  rows: TireAuditRow[];
  limit: number;
  offset: number;
}

export const AUDIT_ACTION_LABEL: Record<string, string> = {
  import: "Importação",
  inspection: "Vistoria",
  repair: "Conserto",
  parameters: "Parâmetros",
  pressure_rule: "Regra de PSI",
  position: "Posição",
  layout: "Layout",
  service_kind: "Serviço da Manutenção",
  export: "Exportação",
};
