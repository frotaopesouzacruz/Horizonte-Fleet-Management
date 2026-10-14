/**
 * Aplicativos → Verificação Preditiva de Frota — contratos do aplicativo.
 *
 * Tudo vem das rotinas `maintenance_predictive_app_*`: a lista de frotas já
 * filtrada por escopo e elegibilidade, o roteiro técnico por cluster com a
 * situação de cada item e o KM oficial, o envio idempotente (protocolo VPF) e
 * o histórico próprio. O navegador não calcula situação nem decide o desfecho.
 */
import type {
  ChecklistResponseType,
  Conformity,
  Criticality,
  MaintenanceStatus,
  PredictiveChecklistStep,
  PredictiveExecution,
  PredictiveStatus,
  VerificationResult,
} from "./types";

export { camelize, formatDate, formatInt, formatKm, formatStamp } from "./types";

export const PREDICTIVE_APP_PATH = "/aplicativos/verificacao-preditiva";
export const PREDICTIVE_APP_PERMISSION = "applications.predictive.execute";
export const PREDICTIVE_APP_CODE = "verificacao_preditiva";

export interface PredictiveAppContext {
  available: boolean;
  reason: "nao_cadastrado" | "inativo" | null;
  today: string;
  app: { id: string; name: string; slug: string } | null;
  actor: { userId: string | null; employeeId: string | null; name: string | null; employeeCode: string | null };
  rules: {
    maxDaysBack: number;
    kmMaxAgeDays: number;
    kmToleranceMin: number;
    kmTolerancePct: number;
    notesMinLength: number;
    justificationMinLength: number;
  };
  results: { code: VerificationResult; label: string; decision: string }[];
}

export interface PredictiveAppVehicle {
  id: string;
  licensePlate: string | null;
  fleetCode: string | null;
  vehicleTypeId: string | null;
  vehicleTypeName: string | null;
  modelName: string | null;
  makeName: string | null;
  operationId: string | null;
  operationName: string | null;
  cityName: string | null;
  stateUf: string | null;
  brCode: string | null;
  leaderName: string | null;
  planName: string | null;
  items: number;
  worstStatus: PredictiveStatus | "no_plan";
  critical: number;
  due: number;
  toSchedule: number;
  upcoming: number;
  ok: number;
  initialInspection: number;
  noKm: number;
  awaitingCorrective: number;
  monitoring: number;
  kmStale: boolean;
  currentKm: number | null;
  currentKmDate: string | null;
  lastVerificationOn: string | null;
  lastSubmissionOn: string | null;
}

export interface PredictiveAppRoadmapItem {
  cycleId: string;
  itemId: string;
  itemName: string;
  clusterId: string;
  clusterName: string;
  criticality: Criticality;
  intervalKm: number | null;
  intervalDays: number | null;
  technicalStatus: PredictiveStatus;
  executionStatus: PredictiveExecution;
  conformity: Conformity;
  referenceType: string;
  referenceDate: string | null;
  referenceKm: number | null;
  monitoringActive: boolean;
  monitoringKm: number | null;
  monitoringDays: number | null;
  nextKm: number | null;
  nextDate: string | null;
  kmRemaining: number | null;
  daysRemaining: number | null;
  pctConsumed: number | null;
  severity: number;
  openMaintenanceId: string | null;
  openMaintenanceCode: string | null;
  openMaintenanceStatus: string | null;
  lastVerificationOn: string | null;
  lastResult: VerificationResult | null;
  checklist: PredictiveChecklistStep[];
  services: { id: string; name: string; coverage: "full" | "partial" }[];
}

export interface PredictiveAppRoadmap {
  today: string;
  date: string;
  vehicle: {
    id: string;
    licensePlate: string | null;
    fleetCode: string | null;
    vehicleTypeId: string | null;
    vehicleTypeName: string | null;
    modelName: string | null;
    makeName: string | null;
    modelYear: number | null;
    active: boolean;
  };
  context: {
    operationId: string | null;
    operationName: string | null;
    cityName: string | null;
    stateUf: string | null;
    brCode: string | null;
    leaderName: string | null;
    unitName: string | null;
  };
  eligible: boolean;
  km: {
    official: number | null;
    status: string | null;
    source: string | null;
    readingDate: string | null;
    ageDays: number | null;
    stale: boolean;
    tolerance: number;
    maxAgeDays: number;
  };
  plan: { id: string; code: string; name: string; version: number; approvalStatus: string } | null;
  planAmbiguous: boolean;
  items: PredictiveAppRoadmapItem[];
  recentSubmissions: { id: string; protocol: string; verifiedOn: string; inspector: string | null; totalItems: number; totalNonConforming: number }[];
}

export interface PredictiveAppAnswer {
  key: string;
  answer: string;
}

export interface PredictiveAppSubmitItem {
  cycleId: string;
  result: VerificationResult;
  notes?: string | null;
  checklist: PredictiveAppAnswer[];
  monitorKm?: number | null;
  monitorDays?: number | null;
  openMaintenance?: boolean;
}

export interface PredictiveAppSubmitInput {
  clientSubmissionId: string;
  vehicleId: string;
  verifiedOn?: string | null;
  kmInformed?: number | null;
  kmJustification?: string | null;
  generalObservation?: string | null;
  items: PredictiveAppSubmitItem[];
}

export interface PredictiveAppSubmitResult {
  id: string;
  protocol: string;
  submittedAt: string;
  totalItems: number;
  totalConforming: number;
  totalMonitoring: number;
  totalNonConforming: number;
  totalNotPerformed: number;
  maintenancesOpened: number;
  maintenances: { id: string; code: string; status: MaintenanceStatus; created: boolean }[];
  items?: { cycleId: string; verificationId: string; result: VerificationResult; decision: string }[];
  km?: { used: number | null; official: number | null; informed: number | null; divergent: boolean };
  duplicate: boolean;
}

export interface PredictiveMySubmission {
  id: string;
  protocol: string;
  vehicleId: string;
  licensePlate: string | null;
  fleetCode: string | null;
  verifiedOn: string;
  createdAt: string;
  operationName: string | null;
  cityName: string | null;
  totalItems: number;
  totalConforming: number;
  totalMonitoring: number;
  totalNonConforming: number;
  totalNotPerformed: number;
  maintenancesOpened: number;
  kmDivergent: boolean;
}

/** Como o app pede cada tipo de resposta do roteiro. */
export const APP_RESPONSE_HINT: Record<ChecklistResponseType, string> = {
  conformity: "OK, Fora ou N/A",
  yes_no: "Sim ou Não",
  number: "Informe o número medido",
  text: "Descreva em poucas palavras",
  choice: "Escolha uma opção",
  photo: "Descreva/identifique a foto tirada",
};

/** Divergência entre KM informado e oficial: a mesma regra do servidor (maior entre 500 km e 5%). */
export function kmDivergent(informed: number | null, official: number | null, tolerance: number): boolean {
  if (informed == null || official == null) return false;
  return Math.abs(informed - official) > tolerance;
}
