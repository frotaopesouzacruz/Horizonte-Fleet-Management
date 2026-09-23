"use server";

import { revalidatePath } from "next/cache";
import { requireOrganization, resolveOrganization } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import type { Json } from "@/types/database.types";
import {
  getAdherenceDayDetail, getObligationDetail,
  type AdherenceFilters, type ChecklistContext, type DayDetail, type ObligationDetail,
} from "./queries";

const MODULE_PATH = "/checklist/aderencia";

export interface Result<T = undefined> {
  ok: boolean;
  error?: string;
  data?: T;
}

/**
 * Traduz o erro do banco para uma frase de operação.
 *
 * As rotinas da Aderência levantam mensagens já escritas para quem decide
 * ("O solicitante não pode decidir a própria solicitação."). Essas passam
 * intactas; só os códigos crus do Postgres viram texto aqui.
 */
function toMessage(error: { code?: string; message?: string }, fallback: string): string {
  const message = error.message ?? "";
  if (message && /^[A-ZÀ-Ý]/.test(message.trim())) return message;
  switch (error.code) {
    case "42501":
      return "Você não possui permissão para esta ação.";
    case "23505":
      return "Já existe uma solicitação pendente para esta obrigação.";
    case "40001":
      return "Outra gravação aconteceu ao mesmo tempo. Tente de novo.";
    default:
      return fallback;
  }
}

type PayloadRpc =
  | "decide_adherence_requests_bulk"
  | "request_adherence_exclusion"
  | "decide_adherence_request"
  | "cancel_adherence_request"
  | "override_adherence_status"
  | "bulk_adherence_override"
  | "set_adherence_target"
  | "save_adherence_rule"
  | "save_adherence_reason"
  | "reconcile_adherence_period"
  | "resolve_adherence_inconsistency";

type Raw = Record<string, unknown>;
const obj = (v: unknown): Raw => (v && typeof v === "object" && !Array.isArray(v) ? (v as Raw) : {});
const num = (v: unknown): number => (typeof v === "number" ? v : v == null ? 0 : Number(v));

/**
 * Toda escrita passa por uma rotina do banco com o payload inteiro: a
 * permissão, o escopo e a integridade dos ids são verificados lá, na mesma
 * transação da gravação (§41, §62). A action só traduz e revalida.
 */
async function callRpc<T>(
  permission: string,
  fn: PayloadRpc,
  payload: Record<string, Json | undefined>,
  fallback: string,
  map: (raw: unknown) => T,
): Promise<Result<T>> {
  const { organization } = await requireOrganization(permission);
  const supabase = await createClient();
  const clean: Record<string, Json> = {};
  for (const [k, v] of Object.entries(payload)) if (v !== undefined) clean[k] = v;
  const { data, error } = await supabase.rpc(fn, {
    p_organization_id: organization.organizationId,
    p_payload: clean,
  });
  if (error) return { ok: false, error: toMessage(error, fallback) };
  revalidatePath(MODULE_PATH);
  return { ok: true, data: map(data) };
}

// ---------------------------------------------------------------------------
// Detalhe (leitura sob demanda, ao clicar na célula — §48)
// ---------------------------------------------------------------------------
export async function loadObligationDetail(obligationId: string): Promise<Result<ObligationDetail>> {
  const resolved = await resolveOrganization("adherence.view");
  if (!resolved) return { ok: false, error: "Sua sessão expirou ou o acesso mudou. Recarregue a página." };
  try {
    const detail = await getObligationDetail(resolved.organization.organizationId, obligationId);
    if (!detail) return { ok: false, error: "Obrigação não encontrada no seu escopo." };
    return { ok: true, data: detail };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Não foi possível carregar o detalhe." };
  }
}

// ---------------------------------------------------------------------------
// Solicitações da liderança (§30) e decisões (§31)
// ---------------------------------------------------------------------------
export interface RequestExclusionInput {
  obligationId: string;
  reasonCode: string;
  justification: string;
  evidenceReference?: string | null;
  inheritToReturn?: boolean;
}

export async function requestExclusion(
  input: RequestExclusionInput,
): Promise<Result<{ id: string; inheritedId: string | null }>> {
  return callRpc(
    "adherence.request",
    "request_adherence_exclusion",
    {
      obligation_id: input.obligationId,
      reason_code: input.reasonCode,
      justification: input.justification,
      evidence_reference: input.evidenceReference ?? null,
      inherit_to_return: Boolean(input.inheritToReturn),
    },
    "Não foi possível registrar a solicitação.",
    (raw) => {
      const r = obj(raw);
      return { id: String(r.id ?? ""), inheritedId: r.inherited_id ? String(r.inherited_id) : null };
    },
  );
}

export interface DecideRequestInput {
  requestId: string;
  decision: "approve" | "reject" | "reclassify";
  note?: string | null;
  newReasonCode?: string | null;
}

export async function decideRequest(input: DecideRequestInput): Promise<Result<{ status: string }>> {
  return callRpc(
    "adherence.approve",
    "decide_adherence_request",
    {
      request_id: input.requestId,
      decision: input.decision,
      note: input.note ?? null,
      new_reason_code: input.newReasonCode ?? null,
    },
    "Não foi possível registrar a decisão.",
    (raw) => ({ status: String(obj(raw).status ?? "") }),
  );
}

export async function cancelRequest(input: { requestId: string; note?: string | null }): Promise<Result<undefined>> {
  return callRpc(
    "adherence.view",
    "cancel_adherence_request",
    { request_id: input.requestId, note: input.note ?? null },
    "Não foi possível cancelar a solicitação.",
    () => undefined,
  );
}

// ---------------------------------------------------------------------------
// Correção administrativa (§49) e alteração em massa (§50)
// ---------------------------------------------------------------------------
export interface OverrideInput {
  obligationId: string;
  reasonCode: string;
  justification: string;
}

export async function overrideStatus(input: OverrideInput): Promise<Result<undefined>> {
  return callRpc(
    "adherence.override",
    "override_adherence_status",
    { obligation_id: input.obligationId, reason_code: input.reasonCode, justification: input.justification },
    "Não foi possível aplicar a correção.",
    () => undefined,
  );
}

export interface BulkOverrideReport {
  preview: boolean;
  total: number;
  reasonCode: string;
  counts: Record<string, number>;
  appliedIds: string[];
}

export async function bulkOverride(input: {
  obligationIds: string[];
  reasonCode: string;
  justification: string;
  dryRun: boolean;
}): Promise<Result<BulkOverrideReport>> {
  return callRpc(
    "adherence.bulk_update",
    "bulk_adherence_override",
    {
      obligation_ids: input.obligationIds,
      reason_code: input.reasonCode,
      justification: input.justification,
      dry_run: input.dryRun,
    },
    "Não foi possível aplicar a alteração em massa.",
    (raw) => {
      const r = obj(raw);
      const counts: Record<string, number> = {};
      for (const [k, v] of Object.entries(obj(r.counts))) counts[k] = num(v);
      return {
        preview: r.preview === true,
        total: num(r.total),
        reasonCode: String(r.reason_code ?? ""),
        counts,
        appliedIds: Array.isArray(r.applied_ids) ? (r.applied_ids as unknown[]).map(String) : [],
      };
    },
  );
}

// ---------------------------------------------------------------------------
// Metas (§36), regras e motivos (§26, §28)
// ---------------------------------------------------------------------------
export async function setTarget(input: {
  operationId?: string | null;
  context?: "saida" | "retorno" | null;
  targetPct: number;
  validFrom?: string | null;
  notes?: string | null;
}): Promise<Result<{ id: string }>> {
  return callRpc(
    "adherence.manage_targets",
    "set_adherence_target",
    {
      operation_id: input.operationId ?? null,
      context: input.context ?? null,
      target_pct: input.targetPct,
      valid_from: input.validFrom ?? null,
      notes: input.notes ?? null,
    },
    "Não foi possível salvar a meta.",
    (raw) => ({ id: String(obj(raw).id ?? "") }),
  );
}

export async function saveRule(payload: Record<string, Json | undefined>): Promise<Result<{ id: string }>> {
  return callRpc(
    "adherence.manage_rules",
    "save_adherence_rule",
    payload,
    "Não foi possível salvar a regra.",
    (raw) => ({ id: String(obj(raw).id ?? "") }),
  );
}

export async function saveReason(payload: Record<string, Json | undefined>): Promise<Result<{ id: string }>> {
  return callRpc(
    "adherence.manage_rules",
    "save_adherence_reason",
    payload,
    "Não foi possível salvar o motivo.",
    (raw) => ({ id: String(obj(raw).id ?? "") }),
  );
}

// ---------------------------------------------------------------------------
// Reconciliação (§39, §40) e inconsistências
// ---------------------------------------------------------------------------
export interface ReconcileStats {
  preview: boolean;
  runId: string | null;
  dateFrom: string;
  dateTo: string;
  expected: number;
  create: number;
  reactivate: number;
  unchanged: number;
  retire: number;
  retireCandidates: number;
  protectedCount: number;
  planningConflicts: number;
  executionsRematched: number;
  executionsToRematch: number;
}

export async function reconcilePeriod(input: {
  dateFrom: string;
  dateTo: string;
  operationId?: string | null;
  context?: "saida" | "retorno" | null;
  reason?: string | null;
  preview: boolean;
}): Promise<Result<ReconcileStats>> {
  return callRpc(
    "adherence.reconcile",
    "reconcile_adherence_period",
    {
      date_from: input.dateFrom,
      date_to: input.dateTo,
      operation_id: input.operationId ?? null,
      context: input.context ?? null,
      reason: input.reason ?? null,
      preview: input.preview,
    },
    "Não foi possível reconciliar o período.",
    (raw) => {
      const r = obj(raw);
      return {
        preview: r.preview === true,
        runId: r.run_id ? String(r.run_id) : null,
        dateFrom: String(r.date_from ?? input.dateFrom),
        dateTo: String(r.date_to ?? input.dateTo),
        expected: num(r.expected),
        create: num(r.create),
        reactivate: num(r.reactivate),
        unchanged: num(r.unchanged),
        retire: num(r.retire),
        retireCandidates: num(r.retire_candidates ?? r.retire),
        protectedCount: num(r.protected),
        planningConflicts: num(r.planning_conflicts),
        executionsRematched: num(r.executions_rematched),
        executionsToRematch: num(r.executions_to_rematch),
      };
    },
  );
}

export async function resolveInconsistency(input: {
  id: string;
  status: "resolved" | "dismissed";
  note?: string | null;
}): Promise<Result<undefined>> {
  return callRpc(
    "adherence.reconcile",
    "resolve_adherence_inconsistency",
    { id: input.id, status: input.status, note: input.note ?? null },
    "Não foi possível tratar a inconsistência.",
    () => undefined,
  );
}

// ---------------------------------------------------------------------------
// Refinamento (Etapa 11): detalhe do dia, seleção por dias, decisões em lote
// ---------------------------------------------------------------------------

/** §31: o painel do dia do Heatmap, carregado ao selecionar a data. */
export async function loadDayDetail(
  date: string,
  context: ChecklistContext,
  filters: AdherenceFilters = {},
): Promise<Result<DayDetail>> {
  const resolved = await resolveOrganization("adherence.view");
  if (!resolved) return { ok: false, error: "Sua sessão expirou ou o acesso mudou. Recarregue a página." };
  try {
    return { ok: true, data: await getAdherenceDayDetail(resolved.organization.organizationId, date, context, filters) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Não foi possível carregar o dia." };
  }
}

export interface SelectedObligations {
  total: number;
  selected: number;
  truncated: boolean;
  ids: string[];
  byStatus: Record<string, number>;
  eligible: number;
}

/**
 * §40: as obrigações dos dias selecionados na matriz, com os mesmos filtros
 * da tela — o que uma alteração em massa alcançaria. Leitura, sem escrita.
 */
export async function selectObligationsForDays(input: {
  dates: string[];
  context: ChecklistContext;
  filters: AdherenceFilters;
  limit?: number;
}): Promise<Result<SelectedObligations>> {
  const resolved = await resolveOrganization("adherence.view");
  if (!resolved) return { ok: false, error: "Sua sessão expirou ou o acesso mudou. Recarregue a página." };
  if (input.dates.length === 0) return { ok: false, error: "Selecione ao menos um dia." };
  const supabase = await createClient();
  const payload: Record<string, string> = {};
  const f = input.filters;
  if (f.operationId) payload.operation_id = f.operationId;
  if (f.stateId) payload.state_id = f.stateId;
  if (f.cityId) payload.city_id = f.cityId;
  if (f.branchId) payload.organization_unit_id = f.branchId;
  if (f.leaderEmployeeId) payload.leader_employee_id = f.leaderEmployeeId;
  if (f.brId) payload.operation_br_id = f.brId;
  if (f.vehicleTypeId) payload.vehicle_type_id = f.vehicleTypeId;
  if (f.vehicleId) payload.vehicle_id = f.vehicleId;
  if (f.status) payload.status = f.status;
  if (f.q) payload.q = f.q.trim();
  if (f.justification) payload.justification = f.justification;
  const { data, error } = await supabase.rpc("adherence_select_obligations", {
    p_organization_id: resolved.organization.organizationId,
    p_dates: input.dates,
    p_context: input.context,
    p_filters: payload,
    p_limit: input.limit ?? 500,
  });
  if (error) return { ok: false, error: toMessage(error, "Não foi possível selecionar as obrigações.") };
  const r = obj(data);
  const byStatus: Record<string, number> = {};
  for (const [k, v] of Object.entries(obj(r.by_status))) byStatus[k] = num(v);
  return {
    ok: true,
    data: {
      total: num(r.total), selected: num(r.selected), truncated: r.truncated === true,
      ids: Array.isArray(r.ids) ? (r.ids as unknown[]).map(String) : [], byStatus, eligible: num(r.eligible),
    },
  };
}

export type BulkDecisionOutcome =
  | "applicable" | "applied" | "failed" | "not_found" | "not_pending" | "own_request" | "out_of_scope"
  | "reason_not_applicable" | "has_execution" | "evidence_missing";

export interface BulkDecisionReport {
  preview: boolean;
  decision: "approve" | "reject" | "reclassify";
  total: number;
  counts: Record<string, number>;
  items: { id: string; outcome: BulkDecisionOutcome; message: string | null }[];
}

/**
 * §57: aprovar, rejeitar ou reclassificar em lote. A prévia classifica cada
 * item pelas mesmas regras da decisão individual; a gravação chama a rotina
 * individual por item e devolve o resultado de cada um — nenhum conflito é
 * ignorado por ter vindo em massa.
 */
export async function decideRequestsBulk(input: {
  requestIds: string[];
  decision: "approve" | "reject" | "reclassify";
  note?: string | null;
  newReasonCode?: string | null;
  dryRun: boolean;
}): Promise<Result<BulkDecisionReport>> {
  return callRpc(
    "adherence.approve",
    "decide_adherence_requests_bulk",
    {
      request_ids: input.requestIds,
      decision: input.decision,
      note: input.note ?? null,
      new_reason_code: input.newReasonCode ?? null,
      dry_run: input.dryRun,
    },
    "Não foi possível decidir as solicitações.",
    (raw) => {
      const r = obj(raw);
      const counts: Record<string, number> = {};
      for (const [k, v] of Object.entries(obj(r.counts))) counts[k] = num(v);
      return {
        preview: r.preview === true,
        decision: (String(r.decision ?? "approve") as BulkDecisionReport["decision"]),
        total: num(r.total),
        counts,
        items: (Array.isArray(r.items) ? (r.items as unknown[]) : []).map((it) => {
          const x = obj(it);
          return { id: String(x.id ?? ""), outcome: String(x.outcome ?? "failed") as BulkDecisionOutcome, message: x.message == null ? null : String(x.message) };
        }),
      };
    },
  );
}
