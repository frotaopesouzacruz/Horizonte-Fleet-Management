import "server-only";

import { createClient } from "@/lib/supabase/server";
import type { Answer, ChecklistType, Criticality } from "./queries";

/**
 * Leituras do HISTÓRICO do Check List de Frota (§59, §60, §64).
 *
 * Duas rotinas `security invoker`: o detalhe de UMA execução e a lista do
 * escopo com filtros. A RLS das execuções decide o alcance — o executor vê as
 * suas, a liderança vê o escopo — e a rotina só formata. Quando a pessoa não
 * pode ver a execução, o detalhe volta nulo, não vazio: a tela distingue
 * "não encontrado" de "sem respostas".
 */

/** O valor do campo condicional, como foi gravado: `{ lado_freio: "esquerdo" }`, `{ farois: ["farol_esquerdo"] }`. */
export type ConditionalValue = Record<string, string | string[]>;

export interface ExecutionAnswer {
  questionKey: string;
  text: string;
  answer: Answer;
  /** Calculado no envio contra a resposta conforme DA PERGUNTA (§37): SIM pode ser inconformidade. */
  isConforming: boolean;
  criticality: Criticality;
  conditionalValue: ConditionalValue | null;
  note: string | null;
}

export interface ExecutionCluster {
  clusterKey: string;
  name: string;
  applicable: number;
  nonConforming: number;
  answers: ExecutionAnswer[];
}

export interface ExecutionDetail {
  id: string;
  operationalDate: string;
  checklistType: ChecklistType;
  licensePlate: string | null;
  fleetCode: string | null;
  operationName: string;
  brCode: string | null;
  cityName: string | null;
  stateUf: string | null;
  versionLabel: string | null;
  employeeName: string | null;
  /** Ainda não vem da rotina; fica preparado para quando vier. */
  employeeCode: string | null;
  leaderName: string | null;
  startedAt: string | null;
  submittedAt: string | null;
  durationSeconds: number | null;
  applicable: number;
  conforming: number;
  nonConforming: number;
  criticalNonConforming: number;
  clusters: ExecutionCluster[];
}

export interface ScopeExecution {
  id: string;
  operationalDate: string;
  checklistType: ChecklistType;
  licensePlate: string | null;
  fleetCode: string | null;
  operationName: string;
  brCode: string | null;
  employeeName: string | null;
  employeeCode: string | null;
  submittedAt: string | null;
  durationSeconds: number | null;
  applicable: number;
  conforming: number;
  nonConforming: number;
  criticalNonConforming: number;
  status: string;
}

export interface ScopeFilters {
  /** YYYY-MM-DD, inclusivo. */
  dateFrom?: string;
  /** YYYY-MM-DD, inclusivo. */
  dateTo?: string;
  operationId?: string;
  /** Vazio ou ausente = ambos. */
  checklistType?: ChecklistType | "";
  /** Placa, código de frota, nome ou matrícula do colaborador. */
  search?: string;
  /** A rotina aceita de 1 a 200; sem valor, 100. */
  limit?: number;
}

type Raw = Record<string, unknown>;
const obj = (v: unknown): Raw => (v && typeof v === "object" && !Array.isArray(v) ? (v as Raw) : {});
const arr = (v: unknown): Raw[] => (Array.isArray(v) ? (v as Raw[]) : []);
const num = (v: unknown): number => (typeof v === "number" ? v : v == null ? 0 : Number(v));
const numOrNull = (v: unknown): number | null => (v == null ? null : Number(v));
const str = (v: unknown): string => (v == null ? "" : String(v));
const strOrNull = (v: unknown): string | null => (v == null ? null : String(v));
const asType = (v: unknown): ChecklistType => (v === "retorno" ? "retorno" : "saida");
const asAnswer = (v: unknown): Answer => (v === "no" ? "no" : "yes");
const asCriticality = (v: unknown): Criticality => (v === "critica" ? "critica" : "media");

function toConditionalValue(raw: unknown): ConditionalValue | null {
  const out: ConditionalValue = {};
  for (const [key, value] of Object.entries(obj(raw))) {
    if (Array.isArray(value)) out[key] = value.map(String);
    else if (value != null && value !== "") out[key] = String(value);
  }
  return Object.keys(out).length > 0 ? out : null;
}

// ---------------------------------------------------------------------------
// Detalhe de uma execução (§60)
// ---------------------------------------------------------------------------

/**
 * Tudo o que foi respondido, como foi respondido, agrupado por cluster.
 *
 * Não recebe a organização: a execução já pertence a uma, e é a RLS quem
 * responde se esta pessoa pode vê-la. Devolve `null` quando não pode.
 */
export async function getExecutionDetail(executionId: string): Promise<ExecutionDetail | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("checklist_execution_detail", {
    p_execution_id: executionId,
  });
  if (error) throw new Error(error.message);

  const r = obj(data);
  if (!r.id) return null;

  return {
    id: str(r.id),
    operationalDate: str(r.operational_date),
    checklistType: asType(r.checklist_type),
    licensePlate: strOrNull(r.license_plate),
    fleetCode: strOrNull(r.fleet_code),
    operationName: str(r.operation_name) || "—",
    brCode: strOrNull(r.br_code),
    cityName: strOrNull(r.city_name),
    stateUf: strOrNull(r.state_uf),
    versionLabel: strOrNull(r.version_label),
    employeeName: strOrNull(r.employee_name),
    employeeCode: strOrNull(r.employee_code),
    leaderName: strOrNull(r.leader_name),
    startedAt: strOrNull(r.started_at),
    submittedAt: strOrNull(r.submitted_at),
    durationSeconds: numOrNull(r.duration_seconds),
    applicable: num(r.applicable),
    conforming: num(r.conforming),
    nonConforming: num(r.non_conforming),
    criticalNonConforming: num(r.critical_non_conforming),
    clusters: arr(r.clusters).map((c) => ({
      clusterKey: str(c.cluster_key),
      name: str(c.name) || str(c.cluster_key),
      applicable: num(c.applicable),
      nonConforming: num(c.non_conforming),
      answers: arr(c.answers).map((a) => ({
        questionKey: str(a.question_key),
        text: str(a.text),
        answer: asAnswer(a.answer),
        isConforming: a.is_conforming === true,
        criticality: asCriticality(a.criticality),
        conditionalValue: toConditionalValue(a.conditional_value),
        note: strOrNull(a.note),
      })),
    })),
  };
}

// ---------------------------------------------------------------------------
// Histórico do escopo (§64)
// ---------------------------------------------------------------------------

function filtersPayload(filters: ScopeFilters): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  if (filters.dateFrom) out.date_from = filters.dateFrom;
  if (filters.dateTo) out.date_to = filters.dateTo;
  if (filters.operationId) out.operation_id = filters.operationId;
  if (filters.checklistType) out.checklist_type = filters.checklistType;
  if (filters.search?.trim()) out.search = filters.search.trim();
  if (filters.limit) out.limit = filters.limit;
  return out;
}

/**
 * As execuções enviadas que esta pessoa alcança, mais recentes primeiro.
 *
 * A rotina filtra; a RLS delimita. Quem tem `view_details` e escopo numa
 * operação vê aquela operação — o filtro de operação não amplia nada.
 */
export async function listScopeExecutions(
  organizationId: string,
  filters: ScopeFilters = {},
): Promise<ScopeExecution[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("checklist_scope_executions", {
    p_organization_id: organizationId,
    p_filters: filtersPayload(filters),
  });
  if (error) throw new Error(error.message);

  return arr(data).map((e) => ({
    id: str(e.id),
    operationalDate: str(e.operational_date),
    checklistType: asType(e.checklist_type),
    licensePlate: strOrNull(e.license_plate),
    fleetCode: strOrNull(e.fleet_code),
    operationName: str(e.operation_name) || "—",
    brCode: strOrNull(e.br_code),
    employeeName: strOrNull(e.employee_name),
    employeeCode: strOrNull(e.employee_code),
    submittedAt: strOrNull(e.submitted_at),
    durationSeconds: numOrNull(e.duration_seconds),
    applicable: num(e.applicable),
    conforming: num(e.conforming),
    nonConforming: num(e.non_conforming),
    criticalNonConforming: num(e.critical_non_conforming),
    status: str(e.status) || "submitted",
  }));
}
