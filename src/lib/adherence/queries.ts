import "server-only";

import { createClient } from "@/lib/supabase/server";
import type { Competence } from "@/lib/governance/competence";
import type { Json } from "@/types/database.types";

/**
 * Leituras da Aderência (Etapa 11).
 *
 * Tudo passa por rotina do banco, `security invoker`, sobre a view
 * `adherence_obligation_status`: a RLS das obrigações decide o que cada pessoa
 * enxerga e os indicadores herdam o escopo. A fórmula mora no banco — uma vez —
 * e a tela só apresenta: numerador ÷ denominador, soma sobre soma, "sem base"
 * quando o denominador é zero (§34, §35, §37).
 */

export type ChecklistContext = "saida" | "retorno";
export type StatusTone = "success" | "danger" | "warning" | "info" | "neutral" | "pending";

export interface AdherenceFilters {
  operationId?: string;
  stateId?: string;
  cityId?: string;
  branchId?: string;
  leaderEmployeeId?: string;
  brId?: string;
  vehicleTypeId?: string;
  vehicleId?: string;
  status?: string;
  q?: string;
  /** Situação da justificativa (§36): pending | approved | rejected | none. */
  justification?: string;
}

const filtersPayload = (f: AdherenceFilters): Record<string, string> => {
  const out: Record<string, string> = {};
  if (f.operationId) out.operation_id = f.operationId;
  if (f.stateId) out.state_id = f.stateId;
  if (f.cityId) out.city_id = f.cityId;
  if (f.branchId) out.organization_unit_id = f.branchId;
  if (f.leaderEmployeeId) out.leader_employee_id = f.leaderEmployeeId;
  if (f.brId) out.operation_br_id = f.brId;
  if (f.vehicleTypeId) out.vehicle_type_id = f.vehicleTypeId;
  if (f.vehicleId) out.vehicle_id = f.vehicleId;
  if (f.status) out.status = f.status;
  if (f.q) out.q = f.q.trim();
  if (f.justification) out.justification = f.justification;
  return out;
};

type Raw = Record<string, unknown>;
const obj = (v: unknown): Raw => (v && typeof v === "object" && !Array.isArray(v) ? (v as Raw) : {});
const arr = (v: unknown): Raw[] => (Array.isArray(v) ? (v as Raw[]) : []);
const num = (v: unknown, fallback = 0): number => (typeof v === "number" ? v : v == null ? fallback : Number(v));
const numOrNull = (v: unknown): number | null => (v == null ? null : Number(v));
const str = (v: unknown): string => (v == null ? "" : String(v));
const strOrNull = (v: unknown): string | null => (v == null ? null : String(v));
const bool = (v: unknown): boolean => v === true;

// ---------------------------------------------------------------------------
// Visão consolidada (§44)
// ---------------------------------------------------------------------------
export interface AdherenceGroup {
  key: string;
  label: string;
  obligations: number;
  done: number;
  notDone: number;
  excluded: number;
  pendingRequests: number;
  numerator: number;
  denominator: number;
  adherencePct: number | null;
}

export interface AdherenceSummary {
  obligations: number;
  done: number;
  notDone: number;
  pendingReturn: number;
  planned: number;
  excluded: number;
  pendingRequests: number;
  provisional: number;
  numerator: number;
  denominator: number;
  adherencePct: number | null;
  targetPct: number | null;
  gapPct: number | null;
  groupBy: string | null;
  groups: AdherenceGroup[];
}

export type AdherenceGroupBy =
  | "operation" | "state" | "city" | "branch" | "leader" | "br" | "vehicle_type" | "vehicle";

export async function getAdherenceSummary(
  organizationId: string,
  from: string,
  to: string,
  context: ChecklistContext,
  filters: AdherenceFilters = {},
  groupBy?: AdherenceGroupBy,
): Promise<AdherenceSummary> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("adherence_summary", {
    p_organization_id: organizationId,
    p_from: from,
    p_to: to,
    p_context: context,
    p_filters: filtersPayload(filters),
    p_group_by: groupBy,
  });
  if (error) throw new Error(error.message);
  const r = obj(data);
  return {
    obligations: num(r.obligations),
    done: num(r.done),
    notDone: num(r.not_done),
    pendingReturn: num(r.pending_return),
    planned: num(r.planned),
    excluded: num(r.excluded),
    pendingRequests: num(r.pending_requests),
    provisional: num(r.provisional),
    numerator: num(r.numerator),
    denominator: num(r.denominator),
    adherencePct: numOrNull(r.adherence_pct),
    targetPct: numOrNull(r.target_pct),
    gapPct: numOrNull(r.gap_pct),
    groupBy: strOrNull(r.group_by),
    groups: arr(r.groups).map((g) => ({
      key: str(g.key),
      label: str(g.label) || "—",
      obligations: num(g.obligations),
      done: num(g.done),
      notDone: num(g.not_done),
      excluded: num(g.excluded),
      pendingRequests: num(g.pending_requests),
      numerator: num(g.numerator),
      denominator: num(g.denominator),
      adherencePct: numOrNull(g.adherence_pct),
    })),
  };
}

// ---------------------------------------------------------------------------
// Heatmap (§46)
// ---------------------------------------------------------------------------
export interface HeatmapDay {
  date: string;
  day: number;
  isToday: boolean;
  isFuture: boolean;
  obligations: number;
  done: number;
  notDone: number;
  pendingReturn: number;
  excluded: number;
  pendingRequests: number;
  numerator: number;
  denominator: number;
  adherencePct: number | null;
  targetPct: number | null;
}

export async function getAdherenceHeatmap(
  organizationId: string,
  competence: Competence,
  context: ChecklistContext,
  filters: AdherenceFilters = {},
): Promise<HeatmapDay[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("adherence_heatmap", {
    p_organization_id: organizationId,
    p_year: competence.year,
    p_month: competence.month,
    p_context: context,
    p_filters: filtersPayload(filters),
  });
  if (error) throw new Error(error.message);
  return arr(data).map((d) => ({
    date: str(d.date),
    day: num(d.day),
    isToday: bool(d.is_today),
    isFuture: bool(d.is_future),
    obligations: num(d.obligations),
    done: num(d.done),
    notDone: num(d.not_done),
    pendingReturn: num(d.pending_return),
    excluded: num(d.excluded),
    pendingRequests: num(d.pending_requests),
    numerator: num(d.numerator),
    denominator: num(d.denominator),
    adherencePct: numOrNull(d.adherence_pct),
    targetPct: numOrNull(d.target_pct),
  }));
}

// ---------------------------------------------------------------------------
// Matriz mês/dia (§47)
// ---------------------------------------------------------------------------
export interface MatrixCell {
  id: string;
  status: string;
  due: boolean;
  done: boolean;
  excluded: boolean;
  provisional: boolean;
  pendingRequest: boolean;
  condition: string | null;
}

export interface MatrixRow {
  vehicleId: string;
  fleetCode: string | null;
  licensePlate: string | null;
  operationName: string | null;
  cityName: string | null;
  stateUf: string | null;
  brCode: string | null;
  leaderName: string | null;
  vehicleTypeName: string | null;
  days: Record<string, MatrixCell>;
}

export interface MatrixPage {
  total: number;
  page: number;
  pageSize: number;
  rows: MatrixRow[];
}

export async function getAdherenceMatrix(
  organizationId: string,
  competence: Competence,
  context: ChecklistContext,
  filters: AdherenceFilters = {},
  page = 1,
  pageSize = 50,
): Promise<MatrixPage> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("adherence_matrix", {
    p_organization_id: organizationId,
    p_year: competence.year,
    p_month: competence.month,
    p_context: context,
    p_filters: filtersPayload(filters),
    p_page: page,
    p_page_size: pageSize,
  });
  if (error) throw new Error(error.message);
  const r = obj(data);
  return {
    total: num(r.total),
    page: num(r.page, page),
    pageSize: num(r.page_size, pageSize),
    rows: arr(r.rows).map((row) => {
      const days: Record<string, MatrixCell> = {};
      for (const [day, cell] of Object.entries(obj(row.days))) {
        const c = obj(cell);
        days[day] = {
          id: str(c.id),
          status: str(c.status),
          due: bool(c.due),
          done: bool(c.done),
          excluded: bool(c.excluded),
          provisional: bool(c.provisional),
          pendingRequest: bool(c.pending_request),
          condition: strOrNull(c.condition),
        };
      }
      return {
        vehicleId: str(row.vehicle_id),
        fleetCode: strOrNull(row.fleet_code),
        licensePlate: strOrNull(row.license_plate),
        operationName: strOrNull(row.operation_name),
        cityName: strOrNull(row.city_name),
        stateUf: strOrNull(row.state_uf),
        brCode: strOrNull(row.br_code),
        leaderName: strOrNull(row.leader_name),
        vehicleTypeName: strOrNull(row.vehicle_type_name),
        days,
      };
    }),
  };
}

// ---------------------------------------------------------------------------
// Detalhe da obrigação (§48)
// ---------------------------------------------------------------------------
export interface ObligationRequest {
  id: string;
  status: string;
  source: string;
  isOverride: boolean;
  reasonCode: string;
  reasonName: string;
  effect: string;
  justification: string;
  evidenceReference: string | null;
  requestedAt: string;
  requestedByName: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
  decidedByName: string | null;
  decisionEffect: string | null;
  statusCodeApplied: string | null;
}

export interface ObligationDetail {
  id: string;
  vehicleId: string;
  fleetCode: string | null;
  licensePlate: string | null;
  operationalDate: string;
  context: ChecklistContext;
  statusCode: string;
  statusLabel: string;
  statusTone: StatusTone;
  isDone: boolean;
  isDue: boolean;
  isExcluded: boolean;
  isProvisional: boolean;
  hasPendingRequest: boolean;
  detectedCondition: string | null;
  operationName: string | null;
  cityName: string | null;
  stateUf: string | null;
  brCode: string | null;
  branchName: string | null;
  leaderName: string | null;
  vehicleTypeName: string | null;
  source: string;
  ruleName: string | null;
  ruleVersion: number | null;
  expectedAt: string;
  deadlineAt: string;
  execution: {
    id: string;
    submittedAt: string | null;
    employeeName: string | null;
    versionLabel: string | null;
    applicableQuestions: number;
    conforming: number;
    nonConforming: number;
    criticalNonConforming: number;
    matchSource: string;
  } | null;
  otherExecutions: { id: string; submittedAt: string | null; invalidReason: string | null }[];
  requests: ObligationRequest[];
  sibling: { id: string; context: ChecklistContext; status: string } | null;
}

export async function getObligationDetail(
  organizationId: string,
  obligationId: string,
): Promise<ObligationDetail | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("adherence_obligation_detail", {
    p_organization_id: organizationId,
    p_obligation_id: obligationId,
  });
  if (error) throw new Error(error.message);
  const r = obj(data);
  const o = obj(r.obligation);
  if (!o.id) return null;
  const ex = r.execution ? obj(r.execution) : null;
  const sib = r.sibling ? obj(r.sibling) : null;
  return {
    id: str(o.id),
    vehicleId: str(o.vehicle_id),
    fleetCode: strOrNull(o.fleet_code_snapshot),
    licensePlate: strOrNull(o.license_plate_snapshot),
    operationalDate: str(o.operational_date),
    context: o.checklist_context === "retorno" ? "retorno" : "saida",
    statusCode: str(o.status_code),
    statusLabel: str(o.status_label),
    statusTone: (str(o.status_tone) || "neutral") as StatusTone,
    isDone: bool(o.is_done),
    isDue: bool(o.is_due),
    isExcluded: bool(o.is_excluded),
    isProvisional: bool(o.is_provisional),
    hasPendingRequest: bool(o.has_pending_request),
    detectedCondition: strOrNull(o.detected_condition),
    operationName: strOrNull(o.operation_name),
    cityName: strOrNull(o.city_name),
    stateUf: strOrNull(o.state_uf),
    brCode: strOrNull(o.br_code),
    branchName: strOrNull(o.branch_name),
    leaderName: strOrNull(o.leader_name),
    vehicleTypeName: strOrNull(o.vehicle_type_name),
    source: str(o.source),
    ruleName: strOrNull(o.rule_name),
    ruleVersion: numOrNull(o.eligibility_rule_version),
    expectedAt: str(o.expected_at),
    deadlineAt: str(o.deadline_at),
    execution: ex && ex.id
      ? {
          id: str(ex.id),
          submittedAt: strOrNull(ex.submitted_at),
          employeeName: strOrNull(ex.employee_name),
          versionLabel: strOrNull(ex.version_label),
          applicableQuestions: num(ex.applicable_questions),
          conforming: num(ex.conforming_answers),
          nonConforming: num(ex.non_conforming_answers),
          criticalNonConforming: num(ex.critical_non_conforming),
          matchSource: str(ex.match_source),
        }
      : null,
    otherExecutions: arr(r.other_executions).map((e) => ({
      id: str(e.id),
      submittedAt: strOrNull(e.submitted_at),
      invalidReason: strOrNull(e.invalid_reason),
    })),
    requests: arr(r.requests).map((q) => ({
      id: str(q.id),
      status: str(q.status),
      source: str(q.source),
      isOverride: bool(q.is_override),
      reasonCode: str(q.reason_code),
      reasonName: str(q.reason_name),
      effect: str(q.effect),
      justification: str(q.justification),
      evidenceReference: strOrNull(q.evidence_reference),
      requestedAt: str(q.requested_at),
      requestedByName: strOrNull(q.requested_by_name),
      decidedAt: strOrNull(q.decided_at),
      decisionNote: strOrNull(q.decision_note),
      decidedByName: strOrNull(q.decided_by_name),
      decisionEffect: strOrNull(q.decision_effect),
      statusCodeApplied: strOrNull(q.status_code_applied),
    })),
    sibling: sib && sib.id
      ? { id: str(sib.id), context: sib.context === "retorno" ? "retorno" : "saida", status: str(sib.status) }
      : null,
  };
}

// ---------------------------------------------------------------------------
// Jornada (§53)
// ---------------------------------------------------------------------------
export type JourneyState =
  | "prevista" | "excecao" | "completa" | "em_rota" | "incompleta" | "nao_realizada";

export interface JourneyRow {
  vehicleId: string;
  fleetCode: string | null;
  licensePlate: string | null;
  operationName: string | null;
  cityName: string | null;
  brCode: string | null;
  leaderName: string | null;
  departureStatus: string | null;
  departureId: string | null;
  returnStatus: string | null;
  returnId: string | null;
  journey: JourneyState;
}

export async function getChecklistJourney(
  organizationId: string,
  date: string,
  filters: AdherenceFilters = {},
): Promise<JourneyRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("adherence_journey", {
    p_organization_id: organizationId,
    p_date: date,
    p_filters: filtersPayload(filters),
  });
  if (error) throw new Error(error.message);
  return arr(data).map((j) => ({
    vehicleId: str(j.vehicle_id),
    fleetCode: strOrNull(j.fleet_code),
    licensePlate: strOrNull(j.license_plate),
    operationName: strOrNull(j.operation_name),
    cityName: strOrNull(j.city_name),
    brCode: strOrNull(j.br_code),
    leaderName: strOrNull(j.leader_name),
    departureStatus: strOrNull(j.departure_status),
    departureId: strOrNull(j.departure_id),
    returnStatus: strOrNull(j.return_status),
    returnId: strOrNull(j.return_id),
    journey: (str(j.journey) || "nao_realizada") as JourneyState,
  }));
}

// ---------------------------------------------------------------------------
// Pendências (§30)
// ---------------------------------------------------------------------------
export interface PendingRow {
  id: string;
  vehicleId: string;
  fleetCode: string | null;
  licensePlate: string | null;
  operationalDate: string;
  context: ChecklistContext;
  status: string;
  provisional: boolean;
  pendingRequest: boolean;
  condition: string | null;
  operationName: string | null;
  cityName: string | null;
  brCode: string | null;
  leaderName: string | null;
}

export async function listPendingObligations(
  organizationId: string,
  from: string,
  to: string,
  context: ChecklistContext | null,
  filters: AdherenceFilters = {},
  limit = 200,
): Promise<PendingRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("adherence_pending_list", {
    p_organization_id: organizationId,
    p_from: from,
    p_to: to,
    p_context: context ?? undefined,
    p_filters: filtersPayload(filters),
    p_limit: limit,
  });
  if (error) throw new Error(error.message);
  return arr(data).map((p) => ({
    id: str(p.id),
    vehicleId: str(p.vehicle_id),
    fleetCode: strOrNull(p.fleet_code),
    licensePlate: strOrNull(p.license_plate),
    operationalDate: str(p.operational_date),
    context: p.context === "retorno" ? "retorno" : "saida",
    status: str(p.status),
    provisional: bool(p.provisional),
    pendingRequest: bool(p.pending_request),
    condition: strOrNull(p.condition),
    operationName: strOrNull(p.operation_name),
    cityName: strOrNull(p.city_name),
    brCode: strOrNull(p.br_code),
    leaderName: strOrNull(p.leader_name),
  }));
}

// ---------------------------------------------------------------------------
// Solicitações e expurgos (§51, §52)
// ---------------------------------------------------------------------------
export interface RequestRow {
  id: string;
  obligationId: string;
  status: "pending" | "approved" | "rejected" | "cancelled";
  source: string;
  isOverride: boolean;
  context: ChecklistContext;
  operationalDate: string;
  vehicleId: string;
  fleetCode: string | null;
  licensePlate: string | null;
  operationName: string | null;
  cityName: string | null;
  brCode: string | null;
  leaderName: string | null;
  reasonCode: string;
  reasonName: string;
  reasonEffect: string;
  justification: string;
  evidenceReference: string | null;
  requestedAt: string;
  requestedByName: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
  decidedByName: string | null;
  obligationStatus: string;
  waitHours: number;
}

export interface RequestStats {
  total: number;
  pending: number;
  approved: number;
  rejected: number;
  avgWaitHours: number;
  byOperation: { key: string; label: string; total: number; pending: number }[];
  byLeader: { key: string; label: string; total: number; pending: number }[];
}

export interface RequestFilters {
  status?: string;
  context?: string;
  reasonCode?: string;
  operationId?: string;
  cityId?: string;
  leaderEmployeeId?: string;
  dateFrom?: string;
  dateTo?: string;
  q?: string;
}

export interface RequestsPage {
  stats: RequestStats;
  total: number;
  page: number;
  pageSize: number;
  rows: RequestRow[];
}

export async function listAdherenceRequests(
  organizationId: string,
  filters: RequestFilters = {},
  page = 1,
  pageSize = 50,
): Promise<RequestsPage> {
  const supabase = await createClient();
  const p: Record<string, string> = {};
  if (filters.status) p.status = filters.status;
  if (filters.context) p.context = filters.context;
  if (filters.reasonCode) p.reason_code = filters.reasonCode;
  if (filters.operationId) p.operation_id = filters.operationId;
  if (filters.cityId) p.city_id = filters.cityId;
  if (filters.leaderEmployeeId) p.leader_employee_id = filters.leaderEmployeeId;
  if (filters.dateFrom) p.date_from = filters.dateFrom;
  if (filters.dateTo) p.date_to = filters.dateTo;
  if (filters.q) p.q = filters.q.trim();

  const { data, error } = await supabase.rpc("adherence_requests_list", {
    p_organization_id: organizationId,
    p_filters: p,
    p_page: page,
    p_page_size: pageSize,
  });
  if (error) throw new Error(error.message);
  const r = obj(data);
  const s = obj(r.stats);
  const group = (v: unknown) =>
    arr(v).map((g) => ({ key: str(g.key), label: str(g.label) || "—", total: num(g.total), pending: num(g.pending) }));
  return {
    stats: {
      total: num(s.total),
      pending: num(s.pending),
      approved: num(s.approved),
      rejected: num(s.rejected),
      avgWaitHours: num(s.avg_wait_hours),
      byOperation: group(s.by_operation),
      byLeader: group(s.by_leader),
    },
    total: num(r.total),
    page: num(r.page, page),
    pageSize: num(r.page_size, pageSize),
    rows: arr(r.rows).map((q) => ({
      id: str(q.id),
      obligationId: str(q.obligation_id),
      status: (str(q.status) || "pending") as RequestRow["status"],
      source: str(q.source),
      isOverride: bool(q.is_override),
      context: q.context === "retorno" ? "retorno" : "saida",
      operationalDate: str(q.operational_date),
      vehicleId: str(q.vehicle_id),
      fleetCode: strOrNull(q.fleet_code),
      licensePlate: strOrNull(q.license_plate),
      operationName: strOrNull(q.operation_name),
      cityName: strOrNull(q.city_name),
      brCode: strOrNull(q.br_code),
      leaderName: strOrNull(q.leader_name),
      reasonCode: str(q.reason_code),
      reasonName: str(q.reason_name),
      reasonEffect: str(q.reason_effect),
      justification: str(q.justification),
      evidenceReference: strOrNull(q.evidence_reference),
      requestedAt: str(q.requested_at),
      requestedByName: strOrNull(q.requested_by_name),
      decidedAt: strOrNull(q.decided_at),
      decisionNote: strOrNull(q.decision_note),
      decidedByName: strOrNull(q.decided_by_name),
      obligationStatus: str(q.obligation_status),
      waitHours: num(q.wait_hours),
    })),
  };
}

// ---------------------------------------------------------------------------
// Opções e parâmetros
// ---------------------------------------------------------------------------
export interface StatusOption { code: string; label: string; tone: StatusTone; description: string | null }
export interface ReasonOption {
  id: string;
  code: string;
  name: string;
  description: string | null;
  effect: "exclude" | "count_done" | "none";
  statusCode: string | null;
  requiresEvidence: boolean;
  requiresApproval: boolean;
  appliesToDeparture: boolean;
  appliesToReturn: boolean;
  inheritsToReturn: boolean;
  isActive: boolean;
}
export interface RuleOption {
  id: string;
  name: string;
  description: string | null;
  priority: number;
  operationId: string | null;
  operationName: string | null;
  vehicleTypeId: string | null;
  vehicleTypeName: string | null;
  vehicleStatus: string | null;
  requiresChecklist: boolean;
  appliesToDeparture: boolean;
  appliesToReturn: boolean;
  weekdays: number[];
  validFrom: string;
  validTo: string | null;
  version: number;
  isActive: boolean;
}
export interface TargetOption {
  id: string;
  operationId: string | null;
  operationName: string | null;
  context: string | null;
  targetPct: number;
  validFrom: string;
  validTo: string | null;
  notes: string | null;
}
export interface RunRow {
  id: string;
  kind: string;
  dateFrom: string | null;
  dateTo: string | null;
  reason: string | null;
  isPreview: boolean;
  status: string;
  stats: Record<string, unknown>;
  errorMessage: string | null;
  startedAt: string;
  finishedAt: string | null;
  requestedByName: string | null;
}
export interface InconsistencyRow {
  id: string;
  kind: string;
  vehicleId: string | null;
  fleetCode: string | null;
  operationalDate: string | null;
  context: string | null;
  details: Record<string, unknown>;
  createdAt: string;
}
export interface AdherenceOptions {
  statuses: StatusOption[];
  reasons: ReasonOption[];
  rules: RuleOption[];
  targets: TargetOption[];
  settings: {
    timezone: string;
    departureExpectedTime: string;
    returnExpectedTime: string;
    returnDeadlineTime: string;
    returnDeadlineNextDay: boolean;
    generationHorizonDays: number;
  } | null;
  runs: RunRow[];
  inconsistencies: InconsistencyRow[];
  today: string;
}

export async function getAdherenceOptions(organizationId: string): Promise<AdherenceOptions> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("adherence_options", { p_organization_id: organizationId });
  if (error) throw new Error(error.message);
  const r = obj(data);
  const st = r.settings ? obj(r.settings) : null;
  return {
    statuses: arr(r.statuses).map((s) => ({
      code: str(s.code), label: str(s.label), tone: (str(s.tone) || "neutral") as StatusTone, description: strOrNull(s.description),
    })),
    reasons: arr(r.reasons).map((x) => ({
      id: str(x.id), code: str(x.code), name: str(x.name), description: strOrNull(x.description),
      effect: (str(x.effect) || "none") as ReasonOption["effect"], statusCode: strOrNull(x.status_code),
      requiresEvidence: bool(x.requires_evidence), requiresApproval: bool(x.requires_approval),
      appliesToDeparture: bool(x.applies_to_departure), appliesToReturn: bool(x.applies_to_return),
      inheritsToReturn: bool(x.inherits_to_return), isActive: bool(x.is_active),
    })),
    rules: arr(r.rules).map((x) => ({
      id: str(x.id), name: str(x.name), description: strOrNull(x.description), priority: num(x.priority),
      operationId: strOrNull(x.operation_id), operationName: strOrNull(x.operation_name),
      vehicleTypeId: strOrNull(x.vehicle_type_id), vehicleTypeName: strOrNull(x.vehicle_type_name),
      vehicleStatus: strOrNull(x.vehicle_status), requiresChecklist: bool(x.requires_checklist),
      appliesToDeparture: bool(x.applies_to_departure), appliesToReturn: bool(x.applies_to_return),
      weekdays: arr(x.weekdays as unknown).length ? (x.weekdays as number[]) : [],
      validFrom: str(x.valid_from), validTo: strOrNull(x.valid_to), version: num(x.version), isActive: bool(x.is_active),
    })),
    targets: arr(r.targets).map((x) => ({
      id: str(x.id), operationId: strOrNull(x.operation_id), operationName: strOrNull(x.operation_name),
      context: strOrNull(x.context), targetPct: num(x.target_pct), validFrom: str(x.valid_from),
      validTo: strOrNull(x.valid_to), notes: strOrNull(x.notes),
    })),
    settings: st
      ? {
          timezone: str(st.timezone),
          departureExpectedTime: str(st.departure_expected_time),
          returnExpectedTime: str(st.return_expected_time),
          returnDeadlineTime: str(st.return_deadline_time),
          returnDeadlineNextDay: bool(st.return_deadline_next_day),
          generationHorizonDays: num(st.generation_horizon_days),
        }
      : null,
    runs: arr(r.runs).map((x) => ({
      id: str(x.id), kind: str(x.kind), dateFrom: strOrNull(x.date_from), dateTo: strOrNull(x.date_to),
      reason: strOrNull(x.reason), isPreview: bool(x.is_preview), status: str(x.status),
      stats: obj(x.stats), errorMessage: strOrNull(x.error_message), startedAt: str(x.started_at),
      finishedAt: strOrNull(x.finished_at), requestedByName: strOrNull(x.requested_by_name),
    })),
    inconsistencies: arr(r.inconsistencies).map((x) => ({
      id: str(x.id), kind: str(x.kind), vehicleId: strOrNull(x.vehicle_id), fleetCode: strOrNull(x.fleet_code),
      operationalDate: strOrNull(x.operational_date), context: strOrNull(x.context), details: obj(x.details),
      createdAt: str(x.created_at),
    })),
    today: str(r.today),
  };
}

// ---------------------------------------------------------------------------
// Listas de apoio aos filtros (§45): filiais e tipos, pelo próprio cliente
// ---------------------------------------------------------------------------
export interface SimpleOption { id: string; name: string }

export async function listAdherenceFilterOptions(organizationId: string): Promise<{
  branches: SimpleOption[];
  vehicleTypes: SimpleOption[];
}> {
  const supabase = await createClient();
  const [branches, types] = await Promise.all([
    supabase
      .from("organization_units")
      .select("id, name, code")
      .eq("organization_id", organizationId)
      .is("deleted_at", null)
      .order("name"),
    supabase
      .from("vehicle_types")
      .select("id, name")
      .or(`organization_id.eq.${organizationId},organization_id.is.null`)
      .is("deleted_at", null)
      .order("sort_order"),
  ]);
  if (branches.error) throw new Error(branches.error.message);
  if (types.error) throw new Error(types.error.message);
  return {
    branches: (branches.data ?? []).map((b) => ({ id: b.id, name: b.code ? `${b.code} · ${b.name}` : b.name })),
    vehicleTypes: (types.data ?? []).map((t) => ({ id: t.id, name: t.name })),
  };
}

// ---------------------------------------------------------------------------
// Dashboard mensal (§25) — o ano mês a mês, mesma fórmula
// ---------------------------------------------------------------------------
export interface MonthlyRow {
  month: number;
  isFuture: boolean;
  isCurrent: boolean;
  obligations: number;
  done: number;
  notDone: number;
  excluded: number;
  pendingRequests: number;
  numerator: number;
  denominator: number;
  adherencePct: number | null;
  targetPct: number | null;
  gapPct: number | null;
}

export interface AdherenceMonthly {
  year: number;
  context: ChecklistContext;
  months: MonthlyRow[];
  total: { numerator: number; denominator: number; excluded: number; adherencePct: number | null };
}

export function mapMonthly(raw: unknown): AdherenceMonthly {
  const r = obj(raw);
  const t = obj(r.total);
  return {
    year: num(r.year),
    context: str(r.context) === "retorno" ? "retorno" : "saida",
    months: arr(r.months).map((m) => ({
      month: num(m.month), isFuture: bool(m.is_future), isCurrent: bool(m.is_current),
      obligations: num(m.obligations), done: num(m.done), notDone: num(m.not_done), excluded: num(m.excluded),
      pendingRequests: num(m.pending_requests), numerator: num(m.numerator), denominator: num(m.denominator),
      adherencePct: numOrNull(m.adherence_pct), targetPct: numOrNull(m.target_pct), gapPct: numOrNull(m.gap_pct),
    })),
    total: { numerator: num(t.numerator), denominator: num(t.denominator), excluded: num(t.excluded), adherencePct: numOrNull(t.adherence_pct) },
  };
}

export async function getAdherenceMonthly(
  organizationId: string,
  year: number,
  context: ChecklistContext,
  filters: AdherenceFilters = {},
): Promise<AdherenceMonthly> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("adherence_monthly", {
    p_organization_id: organizationId, p_year: year, p_context: context, p_filters: filtersPayload(filters),
  });
  if (error) throw new Error(error.message);
  return mapMonthly(data);
}

// ---------------------------------------------------------------------------
// Detalhe do dia (§31) — o painel que o Heatmap abre
// ---------------------------------------------------------------------------
export interface DayGroup {
  key: string;
  label: string;
  obligations: number;
  done: number;
  notDone: number;
  excluded: number;
  numerator: number;
  denominator: number;
  adherencePct: number | null;
}

export interface DayVehicle {
  id: string;
  vehicleId: string | null;
  fleetCode: string | null;
  licensePlate: string | null;
  operationName: string | null;
  cityName: string | null;
  brCode: string | null;
  leaderName: string | null;
  provisional: boolean;
  pendingRequest: boolean;
  condition: string | null;
}

export interface DayDetail {
  date: string;
  context: ChecklistContext;
  isToday: boolean;
  isFuture: boolean;
  obligations: number;
  done: number;
  notDone: number;
  pendingReturn: number;
  planned: number;
  excluded: number;
  pendingRequests: number;
  provisional: number;
  numerator: number;
  denominator: number;
  adherencePct: number | null;
  targetPct: number | null;
  byOperation: DayGroup[];
  byCity: DayGroup[];
  byLeader: DayGroup[];
  notDoneVehicles: DayVehicle[];
  excludedVehicles: { id: string; fleetCode: string | null; licensePlate: string | null; status: string; reasonName: string | null }[];
}

const mapGroup = (g: Raw): DayGroup => ({
  key: str(g.key), label: str(g.label), obligations: num(g.obligations), done: num(g.done), notDone: num(g.not_done),
  excluded: num(g.excluded), numerator: num(g.numerator), denominator: num(g.denominator), adherencePct: numOrNull(g.adherence_pct),
});

export function mapDayDetail(raw: unknown): DayDetail {
  const r = obj(raw);
  return {
    date: str(r.date),
    context: str(r.context) === "retorno" ? "retorno" : "saida",
    isToday: bool(r.is_today), isFuture: bool(r.is_future),
    obligations: num(r.obligations), done: num(r.done), notDone: num(r.not_done), pendingReturn: num(r.pending_return),
    planned: num(r.planned), excluded: num(r.excluded), pendingRequests: num(r.pending_requests), provisional: num(r.provisional),
    numerator: num(r.numerator), denominator: num(r.denominator),
    adherencePct: numOrNull(r.adherence_pct), targetPct: numOrNull(r.target_pct),
    byOperation: arr(r.by_operation).map(mapGroup),
    byCity: arr(r.by_city).map(mapGroup),
    byLeader: arr(r.by_leader).map(mapGroup),
    notDoneVehicles: arr(r.not_done_vehicles).map((v) => ({
      id: str(v.id), vehicleId: strOrNull(v.vehicle_id), fleetCode: strOrNull(v.fleet_code), licensePlate: strOrNull(v.license_plate),
      operationName: strOrNull(v.operation_name), cityName: strOrNull(v.city_name), brCode: strOrNull(v.br_code),
      leaderName: strOrNull(v.leader_name), provisional: bool(v.provisional), pendingRequest: bool(v.pending_request),
      condition: strOrNull(v.condition),
    })),
    excludedVehicles: arr(r.excluded_vehicles).map((v) => ({
      id: str(v.id), fleetCode: strOrNull(v.fleet_code), licensePlate: strOrNull(v.license_plate), status: str(v.status),
      reasonName: strOrNull(v.reason_name),
    })),
  };
}

export async function getAdherenceDayDetail(
  organizationId: string,
  date: string,
  context: ChecklistContext,
  filters: AdherenceFilters = {},
): Promise<DayDetail> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("adherence_day_detail", {
    p_organization_id: organizationId, p_date: date, p_context: context, p_filters: filtersPayload(filters),
  });
  if (error) throw new Error(error.message);
  return mapDayDetail(data);
}

// ---------------------------------------------------------------------------
// Acompanhamento do Retorno (§46–§50)
// ---------------------------------------------------------------------------
export type ReturnSituation = "awaiting_return" | "not_departed" | "overdue_after_departure" | "overdue";

export interface ReturnRow {
  id: string;
  vehicleId: string;
  fleetCode: string | null;
  licensePlate: string | null;
  operationalDate: string;
  operationName: string | null;
  cityName: string | null;
  brCode: string | null;
  leaderName: string | null;
  expectedAt: string | null;
  deadlineAt: string | null;
  status: string;
  departureStatus: string | null;
  departureDone: boolean;
  pendingRequest: boolean;
  provisional: boolean;
  situation: ReturnSituation;
}

export interface ReturnLeaderRow {
  key: string;
  label: string;
  expected: number;
  done: number;
  pending: number;
  overdue: number;
  excluded: number;
  adherencePct: number | null;
}

export interface ReturnTracking {
  dateFrom: string;
  dateTo: string;
  today: string;
  stats: {
    expected: number;
    done: number;
    pendingInDeadline: number;
    awaitingReturn: number;
    overdue: number;
    excluded: number;
    planned: number;
    pendingRequests: number;
    departureDoneReturnMissing: number;
    numerator: number;
    denominator: number;
    adherencePct: number | null;
    targetPct: number | null;
  };
  byLeader: ReturnLeaderRow[];
  rows: ReturnRow[];
  rowsTotal: number;
}

export function mapReturnTracking(raw: unknown): ReturnTracking {
  const r = obj(raw);
  const s = obj(r.stats);
  return {
    dateFrom: str(r.date_from), dateTo: str(r.date_to), today: str(r.today),
    stats: {
      expected: num(s.expected), done: num(s.done), pendingInDeadline: num(s.pending_in_deadline),
      awaitingReturn: num(s.awaiting_return), overdue: num(s.overdue), excluded: num(s.excluded), planned: num(s.planned),
      pendingRequests: num(s.pending_requests), departureDoneReturnMissing: num(s.departure_done_return_missing),
      numerator: num(s.numerator), denominator: num(s.denominator),
      adherencePct: numOrNull(s.adherence_pct), targetPct: numOrNull(s.target_pct),
    },
    byLeader: arr(r.by_leader).map((l) => ({
      key: str(l.key), label: str(l.label), expected: num(l.expected), done: num(l.done), pending: num(l.pending),
      overdue: num(l.overdue), excluded: num(l.excluded), adherencePct: numOrNull(l.adherence_pct),
    })),
    rows: arr(r.rows).map((x) => ({
      id: str(x.id), vehicleId: str(x.vehicle_id), fleetCode: strOrNull(x.fleet_code), licensePlate: strOrNull(x.license_plate),
      operationalDate: str(x.operational_date), operationName: strOrNull(x.operation_name), cityName: strOrNull(x.city_name),
      brCode: strOrNull(x.br_code), leaderName: strOrNull(x.leader_name), expectedAt: strOrNull(x.expected_at),
      deadlineAt: strOrNull(x.deadline_at), status: str(x.status), departureStatus: strOrNull(x.departure_status),
      departureDone: bool(x.departure_done), pendingRequest: bool(x.pending_request), provisional: bool(x.provisional),
      situation: (str(x.situation) || "overdue") as ReturnSituation,
    })),
    rowsTotal: num(r.rows_total),
  };
}

export async function getReturnTracking(
  organizationId: string,
  from: string,
  to: string,
  filters: AdherenceFilters = {},
  /** Linhas da lista; `null` = todas (a exportação não tem teto). */
  limit: number | null = 300,
): Promise<ReturnTracking> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("adherence_return_tracking", {
    p_organization_id: organizationId, p_from: from, p_to: to, p_filters: filtersPayload(filters),
    p_limit: limit ?? 2147483647,
  });
  if (error) throw new Error(error.message);
  return mapReturnTracking(data);
}

// ---------------------------------------------------------------------------
// Insights gerenciais (§27)
// ---------------------------------------------------------------------------
export interface AdherenceInsights {
  competence: string;
  context: ChecklistContext;
  today: string;
  isFutureMonth: boolean;
  current: { adherencePct: number | null; numerator: number; denominator: number; targetPct: number | null; gapPct: number | null; notDone: number; excluded: number; pendingRequests: number };
  previous: { competence: string; adherencePct: number | null; numerator: number; denominator: number };
  variationPts: number | null;
  today_: { obligations: number; done: number; notDone: number; provisional: number; pendingRequests: number } | null;
  daysWithBase: number;
  daysBelowTarget: number;
  operationsBelowTarget: AdherenceGroup[];
  citiesBelowTarget: AdherenceGroup[];
  operationsWithPending: AdherenceGroup[];
  bestOperation: AdherenceGroup | null;
  worstOperation: AdherenceGroup | null;
}

const mapAgg = (g: Raw): AdherenceGroup => ({
  key: str(g.key), label: str(g.label), obligations: num(g.obligations), done: num(g.done), notDone: num(g.not_done),
  excluded: num(g.excluded), pendingRequests: num(g.pending_requests), numerator: num(g.numerator),
  denominator: num(g.denominator), adherencePct: numOrNull(g.adherence_pct),
});

export function mapInsights(raw: unknown): AdherenceInsights {
  const r = obj(raw);
  const c = obj(r.current); const p = obj(r.previous); const t = r.today_stats ?? r.today;
  const todayStats = t && typeof t === "object" ? obj(t) : null;
  return {
    competence: str(r.competence),
    context: str(r.context) === "retorno" ? "retorno" : "saida",
    today: typeof r.today === "string" ? r.today : "",
    isFutureMonth: bool(r.is_future_month),
    current: {
      adherencePct: numOrNull(c.adherence_pct), numerator: num(c.numerator), denominator: num(c.denominator),
      targetPct: numOrNull(c.target_pct), gapPct: numOrNull(c.gap_pct), notDone: num(c.not_done), excluded: num(c.excluded),
      pendingRequests: num(c.pending_requests),
    },
    previous: { competence: str(p.competence), adherencePct: numOrNull(p.adherence_pct), numerator: num(p.numerator), denominator: num(p.denominator) },
    variationPts: numOrNull(r.variation_pts),
    today_: todayStats && Object.keys(todayStats).length > 0
      ? { obligations: num(todayStats.obligations), done: num(todayStats.done), notDone: num(todayStats.not_done), provisional: num(todayStats.provisional), pendingRequests: num(todayStats.pending_requests) }
      : null,
    daysWithBase: num(r.days_with_base),
    daysBelowTarget: num(r.days_below_target),
    operationsBelowTarget: arr(r.operations_below_target).map(mapAgg),
    citiesBelowTarget: arr(r.cities_below_target).map(mapAgg),
    operationsWithPending: arr(r.operations_with_pending).map(mapAgg),
    bestOperation: r.best_operation ? mapAgg(obj(r.best_operation)) : null,
    worstOperation: r.worst_operation ? mapAgg(obj(r.worst_operation)) : null,
  };
}

export async function getAdherenceInsights(
  organizationId: string,
  competence: Competence,
  context: ChecklistContext,
  filters: AdherenceFilters = {},
): Promise<AdherenceInsights> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("adherence_insights", {
    p_organization_id: organizationId, p_year: competence.year, p_month: competence.month, p_context: context,
    p_filters: filtersPayload(filters),
  });
  if (error) throw new Error(error.message);
  return mapInsights(data);
}

// ---------------------------------------------------------------------------
// Histórico de importações (§67)
// ---------------------------------------------------------------------------
export interface ImportHistoryRow {
  id: string;
  fileName: string | null;
  status: string;
  totalRows: number;
  validRows: number;
  warningRows: number;
  errorRows: number;
  createdRows: number;
  skippedRows: number;
  summary: Record<string, unknown>;
  errorMessage: string | null;
  createdAt: string;
  processedAt: string | null;
  createdByName: string | null;
  errors: { row: number; message: string }[];
}

export async function listAdherenceImportHistory(organizationId: string, limit = 20): Promise<ImportHistoryRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("adherence_import_history", { p_organization_id: organizationId, p_limit: limit });
  if (error) throw new Error(error.message);
  return arr(data).map((b) => ({
    id: str(b.id), fileName: strOrNull(b.file_name), status: str(b.status), totalRows: num(b.total_rows), validRows: num(b.valid_rows),
    warningRows: num(b.warning_rows), errorRows: num(b.error_rows), createdRows: num(b.created_rows), skippedRows: num(b.skipped_rows),
    summary: obj(b.summary), errorMessage: strOrNull(b.error_message), createdAt: str(b.created_at), processedAt: strOrNull(b.processed_at),
    createdByName: strOrNull(b.created_by_name),
    errors: arr(b.errors).map((e) => ({ row: num(e.row), message: str(e.message) })),
  }));
}

export type { Json };
