import "server-only";

import { createClient } from "@/lib/supabase/server";
import type { Competence } from "@/lib/governance/competence";
import type { ChecklistContext } from "@/lib/adherence/queries";

/**
 * "Minha situação" (§63): a aderência da própria pessoa.
 *
 * Uma rotina do banco (`adherence_my_situation`, `security definer`) resolve o
 * colaborador a partir da sessão — nunca de um parâmetro —, exige
 * `adherence.view_own` e devolve só o que é dela: as obrigações da BR em que é
 * motorista titular fidelizado, nos dias do vínculo, e as que ela mesma
 * cumpriu com um checklist. Status e fórmula são os da view oficial; a tela
 * não recalcula nada.
 */

export type MySituationState = "ok" | "no_employee" | "not_driver";

export interface MySituationCounts {
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
}

export interface MySituationCell {
  status: string;
  due: boolean;
  done: boolean;
  excluded: boolean;
  provisional: boolean;
  pendingRequest: boolean;
  condition: string | null;
  performedByMe: boolean;
  expectedAt: string | null;
  deadlineAt: string | null;
}

export interface MySituationDay {
  date: string;
  journey: number;
  brCode: string | null;
  operationName: string | null;
  cityName: string | null;
  fleetCode: string | null;
  licensePlate: string | null;
  /** Obrigação da BR em que a pessoa é motorista titular na data. */
  byFidelization: boolean;
  /** Obrigação cumprida com checklist enviado pela própria pessoa. */
  byExecution: boolean;
  saida: MySituationCell | null;
  retorno: MySituationCell | null;
}

export interface MySituationPosition {
  operationBrId: string;
  brCode: string;
  operationName: string | null;
  cityName: string | null;
  uf: string | null;
  fleetCode: string | null;
  licensePlate: string | null;
  dateFrom: string;
  dateTo: string;
}

/** Mesma leitura do Acompanhamento do Retorno (§50): retorno no prazo nunca é falta. */
export type MyPendingSituation =
  | "provisional"
  | "overdue"
  | "overdue_after_departure"
  | "awaiting_return"
  | "not_departed";

export interface MySituationPending {
  date: string;
  context: ChecklistContext;
  status: string;
  brCode: string | null;
  operationName: string | null;
  cityName: string | null;
  fleetCode: string | null;
  licensePlate: string | null;
  expectedAt: string | null;
  deadlineAt: string | null;
  provisional: boolean;
  pendingRequest: boolean;
  departureDone: boolean | null;
  situation: MyPendingSituation;
}

export interface MySituation {
  state: MySituationState;
  year: number;
  month: number;
  dateFrom: string;
  dateTo: string;
  /** Dia operacional vigente, do servidor (§5). */
  today: string;
  employeeName: string | null;
  summary: { total: MySituationCounts; saida: MySituationCounts; retorno: MySituationCounts } | null;
  positions: MySituationPosition[];
  days: MySituationDay[];
  pending: MySituationPending[];
  pendingTotal: number;
  executions: { submitted: number; linked: number };
}

export type MySituationResult = { ok: true; data: MySituation } | { ok: false; error: string };

/** Quem carrega a situação: o servidor na rota real, dados fixos na prévia. */
export type MySituationLoader = (organizationId: string, competence: Competence) => Promise<MySituationResult>;

type Raw = Record<string, unknown>;
const obj = (v: unknown): Raw => (v && typeof v === "object" && !Array.isArray(v) ? (v as Raw) : {});
const arr = (v: unknown): Raw[] => (Array.isArray(v) ? (v as Raw[]) : []);
const num = (v: unknown): number => (v == null ? 0 : Number(v));
const numOrNull = (v: unknown): number | null => (v == null ? null : Number(v));
const str = (v: unknown): string => (v == null ? "" : String(v));
const strOrNull = (v: unknown): string | null => (v == null ? null : String(v));
const bool = (v: unknown): boolean => v === true;

const STATES: MySituationState[] = ["ok", "no_employee", "not_driver"];
const SITUATIONS: MyPendingSituation[] = ["provisional", "overdue", "overdue_after_departure", "awaiting_return", "not_departed"];

function mapCounts(v: unknown): MySituationCounts {
  const r = obj(v);
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
  };
}

function mapCell(v: unknown): MySituationCell | null {
  if (v == null) return null;
  const r = obj(v);
  return {
    status: str(r.status),
    due: bool(r.due),
    done: bool(r.done),
    excluded: bool(r.excluded),
    provisional: bool(r.provisional),
    pendingRequest: bool(r.pending_request),
    condition: strOrNull(r.condition),
    performedByMe: bool(r.performed_by_me),
    expectedAt: strOrNull(r.expected_at),
    deadlineAt: strOrNull(r.deadline_at),
  };
}

/** Converte o JSON da rotina. Pura: a prévia e os testes usam a mesma. */
export function mapMySituation(data: unknown): MySituation {
  const r = obj(data);
  const summary = r.summary == null ? null : obj(r.summary);
  const state = STATES.includes(r.state as MySituationState) ? (r.state as MySituationState) : "not_driver";
  return {
    state,
    year: num(r.year),
    month: num(r.month),
    dateFrom: str(r.date_from),
    dateTo: str(r.date_to),
    today: str(r.today),
    employeeName: strOrNull(r.employee_name),
    summary: summary
      ? { total: mapCounts(summary.total), saida: mapCounts(summary.saida), retorno: mapCounts(summary.retorno) }
      : null,
    positions: arr(r.positions).map((p) => ({
      operationBrId: str(p.operation_br_id),
      brCode: str(p.br_code),
      operationName: strOrNull(p.operation_name),
      cityName: strOrNull(p.city_name),
      uf: strOrNull(p.uf),
      fleetCode: strOrNull(p.fleet_code),
      licensePlate: strOrNull(p.license_plate),
      dateFrom: str(p.d_from),
      dateTo: str(p.d_to),
    })),
    days: arr(r.days).map((d) => ({
      date: str(d.date),
      journey: num(d.journey) || 1,
      brCode: strOrNull(d.br_code),
      operationName: strOrNull(d.operation_name),
      cityName: strOrNull(d.city_name),
      fleetCode: strOrNull(d.fleet_code),
      licensePlate: strOrNull(d.license_plate),
      byFidelization: bool(d.by_fidelization),
      byExecution: bool(d.by_execution),
      saida: mapCell(d.saida),
      retorno: mapCell(d.retorno),
    })),
    pending: arr(r.pending).map((p) => ({
      date: str(p.date),
      context: p.context === "retorno" ? "retorno" : "saida",
      status: str(p.status),
      brCode: strOrNull(p.br_code),
      operationName: strOrNull(p.operation_name),
      cityName: strOrNull(p.city_name),
      fleetCode: strOrNull(p.fleet_code),
      licensePlate: strOrNull(p.license_plate),
      expectedAt: strOrNull(p.expected_at),
      deadlineAt: strOrNull(p.deadline_at),
      provisional: bool(p.provisional),
      pendingRequest: bool(p.pending_request),
      departureDone: p.departure_done == null ? null : bool(p.departure_done),
      situation: SITUATIONS.includes(p.situation as MyPendingSituation) ? (p.situation as MyPendingSituation) : "overdue",
    })),
    pendingTotal: num(r.pending_total),
    executions: { submitted: num(obj(r.executions).submitted), linked: num(obj(r.executions).linked) },
  };
}

/**
 * A situação da pessoa da sessão na competência. Recusa (sem permissão, outra
 * organização) volta como erro legível — a rota já filtrou a permissão, isto
 * cobre a matriz mudando entre o clique e a consulta.
 */
export const getMySituation: MySituationLoader = async (organizationId, competence) => {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("adherence_my_situation", {
    p_organization_id: organizationId,
    p_year: competence.year,
    p_month: competence.month,
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: mapMySituation(data) };
};
