"use server";

import { revalidatePath } from "next/cache";
import { resolveOrganization } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import type { Json } from "@/types/database.types";
import { camelize } from "./types";
import type { KmRotationSimulation } from "./rotation";

/**
 * Plano de rodízio — escritas e leituras sob demanda.
 *
 * Toda decisão é do banco: permissão de cada etapa, transição de status,
 * escopo dos veículos, números da simulação (recalculados no servidor — nunca
 * vêm do navegador) e a trilha de eventos. A action confere a sessão, chama a
 * rotina, traduz o erro e revalida a tela. Nada aqui movimenta frota: a
 * Fidelização só muda por `applyFidelization`, com confirmação explícita.
 */

const MODULE_PATH = "/frota/km";

export interface Result<T = undefined> {
  ok: boolean;
  error?: string;
  data?: T;
}

/** As rotinas levantam mensagens já escritas para quem opera; essas passam intactas. */
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

type Rpc = (
  fn: string,
  args: Record<string, Json>,
) => Promise<{ data: unknown; error: { code?: string; message?: string } | null }>;

const NO_SESSION = "Sua sessão expirou ou você não possui permissão para esta ação.";

/**
 * Chama a rotina com a sessão da pessoa. A permissão conferida aqui é só a
 * primeira porta (sem redirecionar: numa tela aberta, o motivo vira mensagem);
 * a rotina confere a permissão exata de cada etapa.
 */
async function call<T>(
  permission: string,
  fn: string,
  args: (organizationId: string) => Payload,
  fallback: string,
  opts: { write?: boolean } = { write: true },
): Promise<Result<T>> {
  const ctx = await resolveOrganization(permission);
  if (!ctx) return { ok: false, error: NO_SESSION };
  const supabase = await createClient();
  const { data, error } = await (supabase.rpc as unknown as Rpc)(fn, clean(args(ctx.organization.organizationId)));
  if (error) return { ok: false, error: toMessage(error, fallback) };
  if (opts.write !== false) revalidatePath(MODULE_PATH);
  return { ok: true, data: camelize<T>(data) };
}

/** Par informado pela tela: só os ids — os números são do servidor. */
export interface RotationPair {
  vehicle_a_id: string;
  vehicle_b_id: string;
}

const pairs = (items: RotationPair[]): Json =>
  items.map((p) => ({ vehicle_a_id: p.vehicle_a_id, vehicle_b_id: p.vehicle_b_id }));

// ---------------------------------------------------------------------------
// Leituras sob demanda
// ---------------------------------------------------------------------------

/** Simulação de um par (gaveta "Análise do rodízio"). Não grava nada. */
export async function simulateRotation(
  vehicleA: string,
  vehicleB: string,
  payload: Record<string, Json>,
): Promise<Result<KmRotationSimulation>> {
  return call<KmRotationSimulation>(
    "km.rotation.view",
    "km_simulate_rotation",
    (org) => ({ p_organization_id: org, p_vehicle_a_id: vehicleA, p_vehicle_b_id: vehicleB, p_payload: payload }),
    "Não foi possível simular o rodízio.",
    { write: false },
  );
}

export interface FidelizationPreviewSide {
  plate: string | null;
  assignmentId: string | null;
  br: string | null;
  operation: string | null;
  local: string | null;
  startDate: string | null;
  endDate: string | null;
  role: string | null;
}

export interface FidelizationPreview {
  date: string | null;
  vehicleA: FidelizationPreviewSide;
  vehicleB: FidelizationPreviewSide;
  canApply: boolean;
  requiresFidelizationPermission: boolean;
  errors: string[];
  result: string[] | null;
}

/** Prévia da aplicação na Fidelização: vínculos vigentes na data e o que acontece. */
export async function fidelizationPreview(itemId: string, date: string | null): Promise<Result<FidelizationPreview>> {
  return call<FidelizationPreview>(
    "km.rotation.apply_fidelization",
    "km_rotation_fidelization_preview",
    () => ({ p_item_id: itemId, p_effective_date: date || null }),
    "Não foi possível montar a prévia da Fidelização.",
    { write: false },
  );
}

// ---------------------------------------------------------------------------
// Plano
// ---------------------------------------------------------------------------

export interface CreatePlanPayload {
  name?: string | null;
  notes?: string | null;
  /** Filtros da tela no formato das rotinas (ids). */
  filters: Record<string, Json>;
  horizon_days: number;
  scope_mode: string;
  different_locations_only: boolean;
  items: RotationPair[];
}

export async function createPlan(
  payload: CreatePlanPayload,
): Promise<Result<{ planId: string; code: string; items: number }>> {
  return call(
    "km.rotation.create",
    "km_create_rotation_plan",
    (org) => ({
      p_organization_id: org,
      p_payload: clean({
        name: payload.name?.trim() || undefined,
        notes: payload.notes?.trim() || undefined,
        filters: payload.filters,
        horizon_days: payload.horizon_days,
        scope_mode: payload.scope_mode,
        different_locations_only: payload.different_locations_only,
        items: pairs(payload.items),
      }),
    }),
    "Não foi possível criar o plano de rodízio.",
  );
}

export async function addItems(planId: string, items: RotationPair[]): Promise<Result<{ planId: string; items: number }>> {
  return call(
    "km.rotation.create",
    "km_add_rotation_items",
    () => ({ p_plan_id: planId, p_items: pairs(items) }),
    "Não foi possível adicionar os rodízios ao plano.",
  );
}

export async function updatePlan(planId: string, payload: { name: string; notes: string | null }): Promise<Result> {
  return call(
    "km.rotation.create",
    "km_update_rotation_plan",
    () => ({ p_plan_id: planId, p_payload: { name: payload.name, notes: payload.notes ?? "" } }),
    "Não foi possível salvar o plano.",
  );
}

/** Aprovar todos os sugeridos ou cancelar os não executados (motivo obrigatório). */
export async function setPlanStatus(
  planId: string,
  status: "approved" | "cancelled",
  reason: string | null,
): Promise<Result<{ planId: string; items: number; planStatus: string }>> {
  return call(
    "km.rotation.approve",
    "km_set_rotation_plan_status",
    () => ({ p_plan_id: planId, p_status: status, p_reason: reason?.trim() || null }),
    status === "approved" ? "Não foi possível aprovar os rodízios." : "Não foi possível cancelar o plano.",
  );
}

export interface RevalidateResult {
  updated: number;
  noBenefit: number;
  withoutData: number;
  periodFrom: string;
  periodTo: string;
}

export async function revalidatePlan(planId: string): Promise<Result<RevalidateResult>> {
  // create OU approve: a rotina confere; aqui só a sessão com acesso ao rodízio.
  return call(
    "km.rotation.view",
    "km_revalidate_rotation_plan",
    () => ({ p_plan_id: planId }),
    "Não foi possível revalidar o plano.",
  );
}

// ---------------------------------------------------------------------------
// Item
// ---------------------------------------------------------------------------

export interface SetItemPayload {
  status?: "suggested" | "approved" | "scheduled" | "executed" | "cancelled";
  reason?: string | null;
  effective_date?: string | null;
  responsible_employee_id?: string | null;
  notes?: string | null;
  execution_date?: string | null;
}

/**
 * Campos operacionais (data prevista, responsável, observação) e/ou transição
 * de status. Só as chaves presentes são enviadas: a rotina distingue "não
 * mexer" de "limpar".
 */
export async function setItem(
  itemId: string,
  payload: SetItemPayload,
): Promise<Result<{ itemId: string; status: string; planStatus: string }>> {
  const body: Payload = {};
  if (payload.status !== undefined) body.status = payload.status;
  if (payload.reason !== undefined) body.reason = payload.reason ?? "";
  if (payload.effective_date !== undefined) body.effective_date = payload.effective_date ?? "";
  if (payload.responsible_employee_id !== undefined) body.responsible_employee_id = payload.responsible_employee_id ?? "";
  if (payload.notes !== undefined) body.notes = payload.notes ?? "";
  if (payload.execution_date !== undefined) body.execution_date = payload.execution_date ?? "";
  return call(
    "km.rotation.view",
    "km_set_rotation_item",
    () => ({ p_item_id: itemId, p_payload: clean(body) }),
    "Não foi possível atualizar o rodízio.",
  );
}

export async function applyFidelization(
  itemId: string,
  payload: { effective_date: string; reason?: string | null; confirm: true },
): Promise<Result<{ itemId: string; effectiveDate: string }>> {
  if (payload.confirm !== true) return { ok: false, error: "Confirme a aplicação do rodízio na Fidelização." };
  return call(
    "km.rotation.apply_fidelization",
    "km_apply_rotation_fidelization",
    () => ({
      p_item_id: itemId,
      p_payload: clean({ effective_date: payload.effective_date, reason: payload.reason?.trim() || undefined, confirm: true }),
    }),
    "Não foi possível aplicar o rodízio na Fidelização.",
  );
}
