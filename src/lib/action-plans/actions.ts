"use server";

import { revalidatePath } from "next/cache";
import { requireOrganization } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import type { Json } from "@/types/database.types";
import {
  getActionPlanDetail,
  getChecklistHistory,
  getExecutionTrace,
  getMaintenanceCandidates,
  getVehicleActionPlans,
  listActionPlans,
  type HistoryFilters,
} from "./queries";
import {
  camelize,
  type ActionPlanDetail,
  type ActionPlanFilters,
  type ActionPlanPage,
  type ActionPlanRow,
  type ActionPlanSettings,
  type ActionPlanSortKey,
  type AnalysisState,
  type ExecutionTrace,
  type FollowupResult,
  type HistoryPage,
  type MaintenanceCandidate,
  type Priority,
  type ResolutionKind,
} from "./types";
import { MODULE_PATH } from "./url";

export interface Result<T = undefined> {
  ok: boolean;
  error?: string;
  data?: T;
  /** Manutenção equivalente em aberto: a tela oferece vincular ou justificar. */
  duplicate?: boolean;
}

/**
 * As rotinas levantam mensagens já escritas para quem opera; essas passam
 * intactas. Só os códigos crus do Postgres viram texto aqui.
 */
function toMessage(error: { code?: string; message?: string }, fallback: string): string {
  const message = error.message ?? "";
  if (message && /^[A-ZÀ-Ý]/.test(message.trim())) return message;
  switch (error.code) {
    case "42501":
      return "Você não possui permissão para esta ação.";
    case "23505":
      return "Já existe um registro equivalente.";
    case "P0002":
      return "Registro não encontrado ou fora do seu acesso.";
    default:
      return fallback;
  }
}

type Payload = Record<string, Json | undefined>;
const clean = (payload: Payload): Record<string, Json> => {
  const out: Record<string, Json> = {};
  for (const [k, v] of Object.entries(payload)) if (v !== undefined) out[k] = v;
  return out;
};

type Rpc = (
  fn: string,
  args: Record<string, Json>,
) => Promise<{ data: unknown; error: { code?: string; message?: string; hint?: string } | null }>;

/**
 * Toda escrita é uma rotina do banco: permissão, escopo e trilha são decididos
 * lá, na mesma transação. A action confere a sessão, chama, traduz o erro e
 * revalida a tela. A permissão conferida aqui é só a primeira porta.
 */
async function call<T>(permission: string, fn: string, args: Payload, fallback: string): Promise<Result<T>> {
  await requireOrganization(permission);
  const supabase = await createClient();
  const { data, error } = await (supabase.rpc as unknown as Rpc)(fn, clean(args));
  if (error) {
    return {
      ok: false,
      error: toMessage(error, fallback),
      duplicate: error.code === "23505" && (error.hint ?? "").includes("maintenance_duplicate"),
    };
  }
  revalidatePath(MODULE_PATH);
  return { ok: true, data: camelize<T>(data) };
}

async function orgId(permission: string): Promise<string> {
  const { organization } = await requireOrganization(permission);
  return organization.organizationId;
}

async function read<T>(permission: string, run: () => Promise<T>, fallback: string): Promise<Result<T>> {
  await requireOrganization(permission);
  try {
    return { ok: true, data: await run() };
  } catch (e) {
    const tail = e instanceof Error ? e.message.split(": ").pop() ?? "" : "";
    return { ok: false, error: /^[A-ZÀ-Ý]/.test(tail) ? tail : fallback };
  }
}

// ---------------------------------------------------------------------------
// Leituras sob demanda (gaveta, candidatas, veículo, histórico)
// ---------------------------------------------------------------------------
export async function loadActionPlanDetail(planId: string): Promise<Result<ActionPlanDetail>> {
  return read("action_plans.view", () => getActionPlanDetail(planId), "Não foi possível carregar o plano.");
}

export async function loadMaintenanceCandidates(planId: string): Promise<Result<MaintenanceCandidate[]>> {
  return read("action_plans.view", () => getMaintenanceCandidates(planId), "Não foi possível buscar as manutenções candidatas.");
}

export async function loadVehicleActionPlans(vehicleId: string): Promise<Result<ActionPlanRow[]>> {
  return read("action_plans.view", () => getVehicleActionPlans(vehicleId), "Não foi possível carregar os planos do veículo.");
}

export async function loadActionPlanPage(
  filters: ActionPlanFilters,
  sort: ActionPlanSortKey,
  dir: "asc" | "desc",
  page: number,
  pageSize: number,
): Promise<Result<ActionPlanPage>> {
  const organizationId = await orgId("action_plans.view");
  return read("action_plans.view", () => listActionPlans(organizationId, filters, sort, dir, page, pageSize),
    "Não foi possível carregar os planos.");
}

export async function loadChecklistHistory(filters: HistoryFilters, page: number, pageSize: number): Promise<Result<HistoryPage>> {
  const organizationId = await orgId("action_plans.view");
  return read("action_plans.view", () => getChecklistHistory(organizationId, filters, page, pageSize),
    "Não foi possível carregar o histórico.");
}

export async function loadExecutionTrace(executionId: string): Promise<Result<ExecutionTrace>> {
  return read("action_plans.view", () => getExecutionTrace(executionId), "Não foi possível carregar o checklist.");
}

// ---------------------------------------------------------------------------
// Tratativas
// ---------------------------------------------------------------------------
export async function setPlanAnalysis(planId: string, state: AnalysisState, note?: string): Promise<Result<{ status: string }>> {
  return call("action_plans.manage", "action_plan_set_analysis", { p_plan_id: planId, p_state: state, p_note: note ?? undefined },
    "Não foi possível atualizar a tratativa.");
}

export async function addPlanNote(planId: string, note: string): Promise<Result> {
  return call("action_plans.manage", "action_plan_add_note", { p_plan_id: planId, p_note: note }, "Não foi possível registrar a observação.");
}

export async function setPlanDue(planId: string, dueOn: string, reason: string): Promise<Result> {
  return call("action_plans.manage", "action_plan_set_due", { p_plan_id: planId, p_due_on: dueOn, p_reason: reason },
    "Não foi possível alterar o prazo.");
}

export async function assignPlan(planId: string, userId: string | null, reason?: string): Promise<Result> {
  return call("action_plans.assign", "action_plan_assign", { p_plan_id: planId, p_user_id: userId, p_reason: reason ?? undefined },
    "Não foi possível alterar o responsável.");
}

export async function changePlanPriority(planId: string, priority: Priority, reason: string, recalculateDue = true): Promise<Result> {
  return call("action_plans.change_priority", "action_plan_change_priority",
    { p_plan_id: planId, p_priority: priority, p_reason: reason, p_recalculate_due: recalculateDue },
    "Não foi possível alterar a prioridade.");
}

export interface ResolveInput {
  resolution: ResolutionKind;
  itemIds?: string[];
  reasonCode?: string | null;
  reason: string;
  observation?: string | null;
  maintenanceId?: string | null;
  resolvedOn?: string | null;
}

const RESOLUTION_PERMISSION: Record<ResolutionKind, string> = {
  resolved_without_maintenance: "action_plans.resolve_without_maintenance",
  improper: "action_plans.mark_improper",
  cancelled: "action_plans.cancel",
  validated_by_maintenance: "action_plans.manage",
};

export async function resolvePlanItems(planId: string, input: ResolveInput): Promise<Result<{ items: number; status: string }>> {
  return call(RESOLUTION_PERMISSION[input.resolution], "action_plan_resolve_items", {
    p_plan_id: planId,
    p_payload: clean({
      resolution: input.resolution,
      item_ids: input.itemIds?.length ? input.itemIds : undefined,
      reason_code: input.reasonCode ?? undefined,
      reason: input.reason,
      observation: input.observation ?? undefined,
      maintenance_id: input.maintenanceId ?? undefined,
      resolved_on: input.resolvedOn ?? undefined,
    }),
  }, "Não foi possível registrar a tratativa.");
}

export async function reopenPlan(planId: string, reason: string): Promise<Result<{ status: string }>> {
  return call("action_plans.reopen", "action_plan_reopen", { p_plan_id: planId, p_reason: reason }, "Não foi possível reabrir o plano.");
}

export interface LinkInput {
  itemIds?: string[];
  resolutive?: boolean;
  reason?: string | null;
  origin?: "linked_manual" | "reconciliation_manual";
  confidence?: string | null;
  rule?: string | null;
}

export async function linkPlanMaintenance(planId: string, maintenanceId: string, input: LinkInput = {}): Promise<Result<{ status: string }>> {
  const origin = input.origin ?? "linked_manual";
  return call(origin === "reconciliation_manual" ? "action_plans.reconcile" : "action_plans.link_maintenance",
    "action_plan_link_maintenance", {
      p_plan_id: planId,
      p_maintenance_id: maintenanceId,
      p_payload: clean({
        item_ids: input.itemIds?.length ? input.itemIds : undefined,
        resolutive: input.resolutive ?? undefined,
        reason: input.reason ?? undefined,
        origin,
        confidence: input.confidence ?? undefined,
        rule: input.rule ?? undefined,
      }),
    }, "Não foi possível vincular a manutenção.");
}

export async function unlinkPlanMaintenance(planId: string, maintenanceId: string, reason: string): Promise<Result> {
  return call("action_plans.link_maintenance", "action_plan_unlink_maintenance",
    { p_plan_id: planId, p_maintenance_id: maintenanceId, p_reason: reason }, "Não foi possível desvincular a manutenção.");
}

export async function discardCandidate(planId: string, maintenanceId: string, reason: string): Promise<Result> {
  return call("action_plans.reconcile", "action_plan_discard_candidate",
    { p_plan_id: planId, p_maintenance_id: maintenanceId, p_reason: reason }, "Não foi possível descartar a candidata.");
}

export async function runReconciliation(): Promise<Result<{ checked: number; linked: number }>> {
  const organizationId = await orgId("action_plans.reconcile");
  return call("action_plans.reconcile", "action_plan_run_reconciliation", { p_organization_id: organizationId },
    "Não foi possível executar a conciliação.");
}

export async function reprocessActionPlans(input: { dateFrom?: string; dateTo?: string; executionIds?: string[] }): Promise<
  Result<{ executions: number; errors: number; itemsCreated: number; plansCreated: number; plansRefreshed: number }>
> {
  const organizationId = await orgId("action_plans.reprocess");
  return call("action_plans.reprocess", "action_plan_reprocess", {
    p_organization_id: organizationId,
    p_payload: clean({
      date_from: input.dateFrom ?? undefined,
      date_to: input.dateTo ?? undefined,
      execution_ids: input.executionIds?.length ? input.executionIds : undefined,
    }),
  }, "Não foi possível reprocessar.");
}

export async function runQualityFix(): Promise<Result<{ plansRefreshed: number; executionsReprocessed: number }>> {
  const organizationId = await orgId("action_plans.reprocess");
  return call("action_plans.reprocess", "action_plan_quality_fix", { p_organization_id: organizationId },
    "Não foi possível aplicar a correção automática.");
}

// ---------------------------------------------------------------------------
// Parâmetros e mapeamento
// ---------------------------------------------------------------------------
export interface ParameterInput {
  appId: string;
  questionKey: string;
  fieldKey?: string | null;
  actionDomain?: "maintenance" | "damage";
  questionRole?: string;
  generatesPlan?: boolean;
  planGrouping?: "option" | "question";
  actionTitle?: string | null;
  defaultPriority?: Priority | null;
  slaDays?: number | null;
  requiresMaintenance?: boolean;
  requiresManualAnalysis?: boolean;
  driverVisible?: boolean;
  status?: "active" | "inactive";
  notes?: string | null;
}

export async function saveParameter(input: ParameterInput): Promise<Result<{ id: string; reprocessHint: boolean }>> {
  const organizationId = await orgId("action_plans.manage_parameters");
  return call("action_plans.manage_parameters", "action_plan_save_parameter", {
    p_organization_id: organizationId,
    p_payload: {
      app_id: input.appId,
      question_key: input.questionKey,
      field_key: input.fieldKey ?? null,
      ...clean({
        action_domain: input.actionDomain,
        question_role: input.questionRole,
        generates_plan: input.generatesPlan,
        plan_grouping: input.planGrouping,
        requires_maintenance: input.requiresMaintenance,
        requires_manual_analysis: input.requiresManualAnalysis,
        driver_visible: input.driverVisible,
        status: input.status,
      }),
      ...("actionTitle" in input ? { action_title: input.actionTitle ?? null } : {}),
      ...("defaultPriority" in input ? { default_priority: input.defaultPriority ?? null } : {}),
      ...("slaDays" in input ? { sla_days: input.slaDays ?? null } : {}),
      ...("notes" in input ? { notes: input.notes ?? null } : {}),
    },
  }, "Não foi possível salvar o parâmetro.");
}

export async function saveQuestionServices(input: {
  appId: string;
  questionKey: string;
  fieldKey?: string | null;
  services: { serviceId: string; autoResolve: boolean }[];
}): Promise<Result<{ services: number }>> {
  const organizationId = await orgId("action_plans.manage_mappings");
  return call("action_plans.manage_mappings", "action_plan_save_question_services", {
    p_organization_id: organizationId,
    p_payload: {
      app_id: input.appId,
      question_key: input.questionKey,
      field_key: input.fieldKey ?? null,
      services: input.services.map((s) => ({ service_id: s.serviceId, auto_resolve: s.autoResolve })),
    },
  }, "Não foi possível salvar o mapeamento.");
}

export async function saveActionPlanSettings(input: Partial<ActionPlanSettings>): Promise<Result> {
  const organizationId = await orgId("action_plans.manage_parameters");
  return call("action_plans.manage_parameters", "action_plan_save_settings", {
    p_organization_id: organizationId,
    p_payload: clean({
      sla_days_critical: input.slaDaysCritical,
      sla_days_high: input.slaDaysHigh,
      sla_days_medium: input.slaDaysMedium,
      sla_days_low: input.slaDaysLow,
      due_soon_days: input.dueSoonDays,
      recurrence_window_days: input.recurrenceWindowDays,
      reconciliation_window_days: input.reconciliationWindowDays,
      auto_reconcile: input.autoReconcile,
    }),
  }, "Não foi possível salvar as configurações.");
}

// ---------------------------------------------------------------------------
// Importação de follow-up (prévia e aplicação)
// ---------------------------------------------------------------------------
export interface FollowupInputRow {
  row: number;
  planCode?: string | null;
  plate?: string | null;
  item?: string | null;
  action: string;
  reasonCode?: string | null;
  reason?: string | null;
  resolvedOn?: string | null;
}

export async function importFollowup(rows: FollowupInputRow[], apply: boolean): Promise<Result<FollowupResult>> {
  const organizationId = await orgId("action_plans.import");
  return call("action_plans.import", "action_plan_followup_import", {
    p_organization_id: organizationId,
    p_rows: rows.map((r) => clean({
      row: r.row,
      plan_code: r.planCode ?? undefined,
      plate: r.plate ?? undefined,
      item: r.item ?? undefined,
      action: r.action,
      reason_code: r.reasonCode ?? undefined,
      reason: r.reason ?? undefined,
      resolved_on: r.resolvedOn ?? undefined,
    })),
    p_apply: apply,
  }, "Não foi possível processar o follow-up.");
}

// ---------------------------------------------------------------------------
// O outro lado do vínculo: planos de ação de uma manutenção (gaveta oficial)
// ---------------------------------------------------------------------------
export interface MaintenancePlanRef {
  planId: string;
  code: string;
  title: string;
  detailLabel: string | null;
  status: import("./types").PlanStatus;
  priority: import("./types").Priority;
  origin: string;
  resolutive: boolean;
  openItems: number;
  occurrences: number;
  canView: boolean;
}

export async function loadMaintenanceActionPlans(maintenanceId: string): Promise<Result<MaintenancePlanRef[]>> {
  await requireOrganization("maintenance.view");
  const supabase = await createClient();
  const { data, error } = await (supabase.rpc as unknown as Rpc)("action_plan_for_maintenance", { p_maintenance_id: maintenanceId });
  if (error) return { ok: false, error: toMessage(error, "Não foi possível carregar os planos de ação.") };
  return { ok: true, data: camelize<MaintenancePlanRef[]>(data) ?? [] };
}
