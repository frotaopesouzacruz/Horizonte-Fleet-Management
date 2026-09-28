"use server";

import { revalidatePath } from "next/cache";
import { requireOrganization } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import type { Json } from "@/types/database.types";
import {
  getChecklistQuestions,
  getMaintenanceDetail,
  getPredictiveCycleHistory,
  getVehicleContext,
  getVehicleFindings,
  getVehicleMaintenanceHistory,
  searchVehicles,
  type ChecklistQuestionOption,
} from "./queries";
import {
  camelize,
  type ChecklistFinding,
  type KmResolution,
  type MaintenanceDetail,
  type OpenEquivalent,
  type PredictiveCycleHistory,
  type VehicleContext,
  type VehicleMaintenanceHistory,
  type VehicleOption,
} from "./types";

const MODULE_PATH = "/frota/manutencao";

export interface Result<T = undefined> {
  ok: boolean;
  error?: string;
  data?: T;
  /** Manutenção equivalente em aberto: a tela oferece complementar ou justificar. */
  duplicate?: boolean;
}

/**
 * Traduz o erro do banco para uma frase de operação.
 *
 * As rotinas da Manutenção levantam mensagens já escritas para quem opera
 * ("Justifique a reprogramação."). Essas passam intactas; só os códigos crus
 * do Postgres viram texto aqui.
 */
function toMessage(error: { code?: string; message?: string }, fallback: string): string {
  const message = error.message ?? "";
  if (message && /^[A-ZÀ-Ý]/.test(message.trim())) return message;
  switch (error.code) {
    case "42501":
      return "Você não possui permissão para esta ação.";
    case "23505":
      return "Já existe um registro equivalente.";
    case "40001":
      return "Outra gravação aconteceu ao mesmo tempo. Tente de novo.";
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

/**
 * Toda escrita é uma rotina do banco: permissão, escopo por operação/veículo,
 * transição de estado e trilha são decididos lá, na mesma transação. A action
 * confere a sessão, chama, traduz o erro e revalida a tela.
 */
async function call<T>(
  permission: string,
  fn: string,
  args: Record<string, Json | undefined>,
  fallback: string,
  map: (raw: unknown) => T = (raw) => camelize<T>(raw),
): Promise<Result<T>> {
  await requireOrganization(permission);
  const supabase = await createClient();
  // Os nomes das rotinas são fixos neste arquivo; o cliente tipado não
  // conhece as rotinas novas até os tipos serem regenerados.
  const { data, error } = await (supabase.rpc as unknown as (
    f: string,
    a: Record<string, Json>,
  ) => Promise<{ data: unknown; error: { code?: string; message?: string; hint?: string } | null }>)(fn, clean(args));
  if (error) {
    return {
      ok: false,
      error: toMessage(error, fallback),
      duplicate: error.code === "23505" && (error.hint ?? "").includes("maintenance_duplicate"),
    };
  }
  revalidatePath(MODULE_PATH);
  return { ok: true, data: map(data) };
}

async function orgId(permission: string): Promise<string> {
  const { organization } = await requireOrganization(permission);
  return organization.organizationId;
}

// ---------------------------------------------------------------------------
// Leituras sob demanda (gaveta, assistente, histórico)
// ---------------------------------------------------------------------------
export async function loadMaintenanceDetail(id: string): Promise<Result<MaintenanceDetail | null>> {
  await requireOrganization("maintenance.view");
  try {
    return { ok: true, data: await getMaintenanceDetail(id) };
  } catch {
    return { ok: false, error: "Não foi possível carregar a manutenção." };
  }
}

export async function loadVehicleContext(vehicleId: string, date?: string | null): Promise<Result<VehicleContext>> {
  await requireOrganization("maintenance.create");
  try {
    return { ok: true, data: await getVehicleContext(vehicleId, date) };
  } catch (e) {
    return { ok: false, error: e instanceof Error && /^[A-ZÀ-Ý]/.test(e.message.split(": ").pop() ?? "") ? e.message.split(": ").pop() : "Não foi possível carregar o veículo." };
  }
}

export async function loadVehicleFindings(vehicleId: string, days = 60): Promise<Result<ChecklistFinding[]>> {
  await requireOrganization("maintenance.view");
  try {
    return { ok: true, data: await getVehicleFindings(vehicleId, days) };
  } catch {
    return { ok: false, error: "Não foi possível carregar os apontamentos do Check List." };
  }
}

export async function searchMaintenanceVehicles(term: string): Promise<Result<VehicleOption[]>> {
  const organizationId = await orgId("maintenance.create");
  try {
    return { ok: true, data: await searchVehicles(organizationId, term) };
  } catch {
    return { ok: false, error: "Não foi possível buscar veículos." };
  }
}

export async function loadVehicleMaintenanceHistory(vehicleId: string): Promise<Result<VehicleMaintenanceHistory | null>> {
  await requireOrganization("maintenance.view_base");
  try {
    return { ok: true, data: await getVehicleMaintenanceHistory(vehicleId) };
  } catch {
    return { ok: false, error: "Não foi possível carregar o histórico de manutenção." };
  }
}

export async function loadPredictiveCycleHistory(cycleId: string): Promise<Result<PredictiveCycleHistory | null>> {
  await requireOrganization("maintenance.view");
  try {
    return { ok: true, data: await getPredictiveCycleHistory(cycleId) };
  } catch {
    return { ok: false, error: "Não foi possível carregar o histórico do item." };
  }
}

export async function loadChecklistQuestions(): Promise<Result<ChecklistQuestionOption[]>> {
  const organizationId = await orgId("maintenance.view");
  try {
    return { ok: true, data: await getChecklistQuestions(organizationId) };
  } catch {
    return { ok: false, error: "Não foi possível carregar as perguntas do Check List." };
  }
}

export async function findOpenEquivalents(vehicleId: string, serviceIds: string[]): Promise<Result<OpenEquivalent[]>> {
  return call("maintenance.create", "maintenance_find_open", { p_vehicle_id: vehicleId, p_service_ids: serviceIds },
    "Não foi possível verificar manutenções abertas.", (raw) => camelize<OpenEquivalent[]>(raw ?? []));
}

// ---------------------------------------------------------------------------
// Abertura e ciclo de vida
// ---------------------------------------------------------------------------
export interface CreateMaintenanceInput {
  vehicleId: string;
  maintenanceTypeCode: string;
  originId?: string | null;
  priority?: string;
  serviceIds: string[];
  description?: string | null;
  requestedOn?: string | null;
  status?: "to_schedule" | "scheduled" | "in_progress";
  scheduledDate?: string | null;
  scheduledTime?: string | null;
  expectedExitDate?: string | null;
  expectedExitTime?: string | null;
  supplierId?: string | null;
  serviceOrderNumber?: string | null;
  schedulingNotes?: string | null;
  entryDate?: string | null;
  entryTime?: string | null;
  entryKm?: number | null;
  entryKmJustification?: string | null;
  preventiveCycleId?: string | null;
  checklistAnswerIds?: string[];
  duplicateJustification?: string | null;
  notes?: string | null;
}

export async function createMaintenance(
  input: CreateMaintenanceInput,
): Promise<Result<{ id: string; code: string; status: string }>> {
  const organizationId = await orgId("maintenance.create");
  return call("maintenance.create", "maintenance_create", {
    p_organization_id: organizationId,
    p_payload: clean({
      vehicle_id: input.vehicleId,
      maintenance_type_code: input.maintenanceTypeCode,
      origin_id: input.originId ?? undefined,
      priority: input.priority ?? undefined,
      service_ids: input.serviceIds,
      description: input.description ?? undefined,
      requested_on: input.requestedOn ?? undefined,
      status: input.status ?? undefined,
      scheduled_date: input.scheduledDate ?? undefined,
      scheduled_time: input.scheduledTime ?? undefined,
      expected_exit_date: input.expectedExitDate ?? undefined,
      expected_exit_time: input.expectedExitTime ?? undefined,
      supplier_id: input.supplierId ?? undefined,
      service_order_number: input.serviceOrderNumber ?? undefined,
      scheduling_notes: input.schedulingNotes ?? undefined,
      entry_date: input.entryDate ?? undefined,
      entry_time: input.entryTime ?? undefined,
      entry_km: input.entryKm ?? undefined,
      entry_km_justification: input.entryKmJustification ?? undefined,
      preventive_cycle_id: input.preventiveCycleId ?? undefined,
      checklist_answer_ids: input.checklistAnswerIds?.length ? input.checklistAnswerIds : undefined,
      duplicate_justification: input.duplicateJustification ?? undefined,
      notes: input.notes ?? undefined,
    }),
  }, "Não foi possível abrir a manutenção.");
}

export async function addMaintenanceItems(id: string, serviceIds: string[], reason?: string): Promise<Result<unknown>> {
  return call("maintenance.create", "maintenance_add_items",
    { p_maintenance_id: id, p_service_ids: serviceIds, p_reason: reason ?? undefined },
    "Não foi possível adicionar os serviços.");
}

export async function removeMaintenanceItem(itemId: string, reason: string): Promise<Result<unknown>> {
  return call("maintenance.edit", "maintenance_remove_item", { p_item_id: itemId, p_reason: reason },
    "Não foi possível remover o serviço.");
}

export interface ScheduleInput {
  scheduledDate: string;
  scheduledTime?: string | null;
  expectedExitDate?: string | null;
  expectedExitTime?: string | null;
  supplierId?: string | null;
  serviceOrderNumber?: string | null;
  schedulingNotes?: string | null;
}
const schedulePayload = (s: ScheduleInput) =>
  clean({
    scheduled_date: s.scheduledDate,
    scheduled_time: s.scheduledTime || undefined,
    expected_exit_date: s.expectedExitDate || undefined,
    expected_exit_time: s.expectedExitTime || undefined,
    supplier_id: s.supplierId || undefined,
    service_order_number: s.serviceOrderNumber || undefined,
    scheduling_notes: s.schedulingNotes || undefined,
  });

export async function scheduleMaintenance(id: string, input: ScheduleInput): Promise<Result<unknown>> {
  return call("maintenance.schedule", "maintenance_schedule", { p_maintenance_id: id, p_payload: schedulePayload(input) },
    "Não foi possível agendar a manutenção.");
}

export async function rescheduleMaintenance(
  id: string,
  input: Partial<ScheduleInput>,
  reason: string,
): Promise<Result<unknown>> {
  return call("maintenance.reschedule", "maintenance_reschedule", {
    p_maintenance_id: id,
    p_payload: clean({
      scheduled_date: input.scheduledDate || undefined,
      scheduled_time: input.scheduledTime || undefined,
      expected_exit_date: input.expectedExitDate || undefined,
      expected_exit_time: input.expectedExitTime || undefined,
      supplier_id: input.supplierId || undefined,
    }),
    p_reason: reason,
  }, "Não foi possível reprogramar a manutenção.");
}

export async function unscheduleMaintenance(id: string, reason: string): Promise<Result<unknown>> {
  return call("maintenance.reschedule", "maintenance_unschedule", { p_maintenance_id: id, p_reason: reason },
    "Não foi possível desfazer o agendamento.");
}

export interface StartInput {
  entryDate: string;
  entryTime?: string | null;
  entryKm?: number | null;
  entryKmJustification?: string | null;
  supplierId?: string | null;
  serviceOrderNumber?: string | null;
  expectedExitDate?: string | null;
  expectedExitTime?: string | null;
}

export async function startMaintenance(id: string, input: StartInput): Promise<Result<KmResolution>> {
  return call("maintenance.start", "maintenance_start", {
    p_maintenance_id: id,
    p_payload: clean({
      entry_date: input.entryDate,
      entry_time: input.entryTime || undefined,
      entry_km: input.entryKm ?? undefined,
      entry_km_justification: input.entryKmJustification || undefined,
      supplier_id: input.supplierId || undefined,
      service_order_number: input.serviceOrderNumber || undefined,
      expected_exit_date: input.expectedExitDate || undefined,
      expected_exit_time: input.expectedExitTime || undefined,
    }),
  }, "Não foi possível registrar a entrada.");
}

export async function setEntryKm(id: string, km: number | null, justification: string | null): Promise<Result<KmResolution>> {
  return call("maintenance.start", "maintenance_set_entry_km",
    { p_maintenance_id: id, p_km: km, p_justification: justification },
    "Não foi possível registrar o KM de entrada.");
}

export async function reprocessMaintenanceKm(id: string): Promise<Result<KmResolution>> {
  return call("maintenance.reprocess", "maintenance_reprocess_km", { p_maintenance_id: id },
    "Não foi possível reprocessar o KM.");
}

export interface CompleteInput {
  exitDate: string;
  exitTime?: string | null;
  supplierId?: string | null;
  serviceOrderNumber?: string | null;
  completionNotes?: string | null;
  items: { itemId: string; status: "done" | "not_done"; result?: string | null; notes?: string | null }[];
}

export async function completeMaintenance(id: string, input: CompleteInput): Promise<Result<unknown>> {
  return call("maintenance.complete", "maintenance_complete", {
    p_maintenance_id: id,
    p_payload: clean({
      exit_date: input.exitDate,
      exit_time: input.exitTime || undefined,
      supplier_id: input.supplierId || undefined,
      service_order_number: input.serviceOrderNumber || undefined,
      completion_notes: input.completionNotes || undefined,
      items: input.items.map((i) =>
        clean({ item_id: i.itemId, status: i.status, result: i.result || undefined, notes: i.notes || undefined }),
      ),
    }),
  }, "Não foi possível concluir a manutenção.");
}

export async function cancelMaintenance(id: string, reason: string): Promise<Result<unknown>> {
  return call("maintenance.edit", "maintenance_cancel", { p_maintenance_id: id, p_reason: reason },
    "Não foi possível cancelar a manutenção.");
}

export async function markMaintenanceNotPerformed(id: string, reason: string): Promise<Result<unknown>> {
  return call("maintenance.edit", "maintenance_mark_not_performed", { p_maintenance_id: id, p_reason: reason },
    "Não foi possível registrar a não realização.");
}

export async function reopenMaintenance(id: string, reason: string): Promise<Result<unknown>> {
  return call("maintenance.reopen", "maintenance_reopen", { p_maintenance_id: id, p_reason: reason },
    "Não foi possível reabrir a manutenção.");
}

export interface DetailsInput {
  description?: string | null;
  notes?: string | null;
  originId?: string | null;
  priority?: string | null;
  schedulingNotes?: string | null;
  serviceOrderNumber?: string | null;
}

export async function updateMaintenanceDetails(id: string, input: DetailsInput, reason?: string): Promise<Result<unknown>> {
  return call("maintenance.edit", "maintenance_update_details", {
    p_maintenance_id: id,
    p_payload: clean({
      description: input.description ?? undefined,
      notes: input.notes ?? undefined,
      origin_id: input.originId ?? undefined,
      priority: input.priority ?? undefined,
      scheduling_notes: input.schedulingNotes ?? undefined,
      service_order_number: input.serviceOrderNumber ?? undefined,
    }),
    p_reason: reason ?? undefined,
  }, "Não foi possível salvar os dados da manutenção.");
}

export async function linkFindings(id: string, answerIds: string[], reason?: string): Promise<Result<unknown>> {
  return call("maintenance.create", "maintenance_link_findings",
    { p_maintenance_id: id, p_answer_ids: answerIds, p_reason: reason ?? undefined },
    "Não foi possível vincular os apontamentos.");
}

export async function unlinkFinding(linkId: string, reason: string): Promise<Result<unknown>> {
  return call("maintenance.edit", "maintenance_unlink_finding", { p_link_id: linkId, p_reason: reason },
    "Não foi possível desvincular o apontamento.");
}

// ---------------------------------------------------------------------------
// Preventiva e preditiva
// ---------------------------------------------------------------------------
export async function schedulePreventiveCycle(
  cycleId: string,
  input: { scheduledDate?: string | null; scheduledTime?: string | null; supplierId?: string | null; notes?: string | null } = {},
): Promise<Result<{ id: string; code: string; status: string; created: boolean }>> {
  return call("maintenance.manage_preventive", "maintenance_schedule_preventive", {
    p_cycle_id: cycleId,
    p_payload: clean({
      scheduled_date: input.scheduledDate || undefined,
      scheduled_time: input.scheduledTime || undefined,
      supplier_id: input.supplierId || undefined,
      notes: input.notes || undefined,
    }),
  }, "Não foi possível gerar a manutenção preventiva.");
}

export async function syncPreventiveCycles(vehicleId?: string | null): Promise<Result<unknown>> {
  const organizationId = await orgId("maintenance.view");
  // O banco aceita maintenance.manage_preventive ou maintenance.reprocess.
  return call("maintenance.view", "maintenance_sync_preventive",
    { p_organization_id: organizationId, p_vehicle_id: vehicleId ?? undefined },
    "Não foi possível sincronizar os ciclos preventivos.");
}

export async function syncPredictiveCycles(vehicleId?: string | null): Promise<Result<unknown>> {
  const organizationId = await orgId("maintenance.view");
  return call("maintenance.view", "maintenance_sync_predictive",
    { p_organization_id: organizationId, p_vehicle_id: vehicleId ?? undefined },
    "Não foi possível sincronizar os ciclos preditivos.");
}

export async function generatePredictiveMaintenance(
  cycleId: string,
  input: { scheduledDate?: string | null; description?: string | null; serviceIds?: string[] } = {},
): Promise<Result<{ id: string; code: string; status: string; created: boolean }>> {
  return call("maintenance.manage_predictive", "maintenance_generate_predictive", {
    p_cycle_id: cycleId,
    p_payload: clean({
      scheduled_date: input.scheduledDate || undefined,
      description: input.description || undefined,
      service_ids: input.serviceIds?.length ? input.serviceIds : undefined,
    }),
  }, "Não foi possível gerar a manutenção preditiva.");
}

export interface VerificationInput {
  result: "conforming" | "monitor" | "non_conforming" | "not_performed";
  verifiedOn: string;
  km?: number | null;
  responsibleName: string;
  checklist: { key: string; answer: string }[];
  notes?: string | null;
  monitorKm?: number | null;
  monitorDays?: number | null;
  openMaintenance?: boolean;
  serviceIds?: string[];
  scheduledDate?: string | null;
}

export async function registerPredictiveVerification(
  cycleId: string,
  input: VerificationInput,
): Promise<Result<{ decision: string; km: number | null; kmSource: string | null; maintenance: { id: string; code: string; created: boolean } | null }>> {
  return call("maintenance.manage_predictive", "maintenance_register_predictive_verification", {
    p_cycle_id: cycleId,
    p_payload: clean({
      result: input.result,
      verified_on: input.verifiedOn,
      km: input.km ?? undefined,
      responsible_name: input.responsibleName,
      checklist: input.checklist,
      notes: input.notes || undefined,
      monitor_km: input.monitorKm ?? undefined,
      monitor_days: input.monitorDays ?? undefined,
      open_maintenance: input.openMaintenance ?? undefined,
      service_ids: input.serviceIds?.length ? input.serviceIds : undefined,
      scheduled_date: input.scheduledDate || undefined,
    }),
  }, "Não foi possível registrar a verificação.");
}

export async function resetPredictiveCycle(cycleId: string, date: string, km: number | null, reason: string): Promise<Result<unknown>> {
  return call("maintenance.manage_predictive", "maintenance_predictive_reset",
    { p_cycle_id: cycleId, p_date: date, p_km: km, p_reason: reason },
    "Não foi possível reiniciar o ciclo.");
}

// ---------------------------------------------------------------------------
// Cadastros
// ---------------------------------------------------------------------------
export async function saveMaintenanceCluster(payload: Payload): Promise<Result<string>> {
  const organizationId = await orgId("maintenance.manage_clusters");
  return call("maintenance.manage_clusters", "maintenance_save_cluster",
    { p_organization_id: organizationId, p_payload: clean(payload) }, "Não foi possível salvar o cluster.", (r) => String(r));
}
export async function archiveMaintenanceCluster(id: string): Promise<Result<unknown>> {
  return call("maintenance.manage_clusters", "maintenance_archive_cluster", { p_cluster_id: id }, "Não foi possível inativar o cluster.");
}

export async function saveMaintenanceService(payload: Payload): Promise<Result<string>> {
  const organizationId = await orgId("maintenance.manage_services");
  return call("maintenance.manage_services", "maintenance_save_service",
    { p_organization_id: organizationId, p_payload: clean(payload) }, "Não foi possível salvar o serviço.", (r) => String(r));
}
export async function archiveMaintenanceService(id: string): Promise<Result<unknown>> {
  return call("maintenance.manage_services", "maintenance_archive_service", { p_service_id: id }, "Não foi possível inativar o serviço.");
}
export async function saveServiceChecklistLinks(
  serviceId: string,
  links: { appId: string; questionKey: string; fieldKey: string | null; autoResolve: boolean }[],
): Promise<Result<unknown>> {
  return call("maintenance.manage_services", "maintenance_save_service_links", {
    p_service_id: serviceId,
    p_links: links.map((l) => ({ app_id: l.appId, question_key: l.questionKey, field_key: l.fieldKey, auto_resolve: l.autoResolve })),
  }, "Não foi possível salvar o mapeamento com o Check List.");
}

export async function saveMaintenanceSupplier(payload: Payload): Promise<Result<string>> {
  const organizationId = await orgId("maintenance.manage_suppliers");
  return call("maintenance.manage_suppliers", "maintenance_save_supplier",
    { p_organization_id: organizationId, p_payload: clean(payload) }, "Não foi possível salvar o fornecedor.", (r) => String(r));
}
export async function archiveMaintenanceSupplier(id: string): Promise<Result<unknown>> {
  return call("maintenance.manage_suppliers", "maintenance_archive_supplier", { p_supplier_id: id }, "Não foi possível inativar o fornecedor.");
}

export async function saveMaintenanceOrigin(payload: Payload): Promise<Result<string>> {
  const organizationId = await orgId("maintenance.manage_parameters");
  return call("maintenance.manage_parameters", "maintenance_save_origin",
    { p_organization_id: organizationId, p_payload: clean(payload) }, "Não foi possível salvar a origem.", (r) => String(r));
}

export async function saveMaintenanceSettings(payload: Payload): Promise<Result<unknown>> {
  const organizationId = await orgId("maintenance.manage_parameters");
  return call("maintenance.manage_parameters", "maintenance_save_settings",
    { p_organization_id: organizationId, p_payload: clean(payload) }, "Não foi possível salvar as configurações.");
}

export async function savePreventiveRule(payload: Payload): Promise<Result<{ id: string; vehiclesSynced: number }>> {
  const organizationId = await orgId("maintenance.manage_parameters");
  return call("maintenance.manage_parameters", "maintenance_save_preventive_rule",
    { p_organization_id: organizationId, p_payload: clean(payload) }, "Não foi possível salvar o parâmetro preventivo.");
}
export async function archivePreventiveRule(id: string): Promise<Result<unknown>> {
  return call("maintenance.manage_parameters", "maintenance_archive_preventive_rule", { p_rule_id: id },
    "Não foi possível inativar o parâmetro preventivo.");
}

export async function savePredictivePlan(payload: Payload, reason?: string): Promise<Result<string>> {
  const organizationId = await orgId("maintenance.manage_predictive");
  return call("maintenance.manage_predictive", "maintenance_save_predictive_plan",
    { p_organization_id: organizationId, p_payload: clean(payload), p_reason: reason ?? undefined },
    "Não foi possível salvar o plano técnico.", (r) => String(r));
}
export async function savePredictiveItem(planId: string, payload: Payload, reason?: string): Promise<Result<{ id: string; versionChanged: boolean }>> {
  return call("maintenance.manage_predictive", "maintenance_save_predictive_item",
    { p_plan_id: planId, p_payload: clean(payload), p_reason: reason ?? undefined }, "Não foi possível salvar o item do plano.");
}
export async function setPredictivePlanStatus(planId: string, status: string, reason?: string): Promise<Result<unknown>> {
  return call("maintenance.manage_predictive", "maintenance_set_predictive_plan_status",
    { p_plan_id: planId, p_status: status, p_reason: reason ?? undefined }, "Não foi possível alterar a situação do plano.");
}
export async function duplicatePredictivePlan(planId: string, name: string): Promise<Result<string>> {
  return call("maintenance.manage_predictive", "maintenance_duplicate_predictive_plan",
    { p_plan_id: planId, p_name: name }, "Não foi possível duplicar o plano.", (r) => String(r));
}
export async function savePredictiveCoverage(
  itemId: string,
  services: { serviceId: string; coverage: "full" | "partial" }[],
): Promise<Result<unknown>> {
  return call("maintenance.manage_predictive", "maintenance_save_predictive_coverage", {
    p_item_id: itemId,
    p_services: services.map((s) => ({ service_id: s.serviceId, coverage: s.coverage })),
  }, "Não foi possível salvar a cobertura técnica.");
}
