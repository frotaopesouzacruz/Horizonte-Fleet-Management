"use server";

import { revalidatePath } from "next/cache";
import { requireOrganization, resolveOrganization } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import type { ChecklistForm, ChecklistType, ExecutionSummary } from "./queries";
import { getChecklistForm, listMyExecutions } from "./queries";

const MODULE_PATH = "/aplicativos/check-list-frota";

export interface Result<T = undefined> {
  ok: boolean;
  error?: string;
  data?: T;
}

const SESSION_LOST =
  "Sua sessão expirou ou o acesso mudou. Recarregue a página e tente de novo.";

/**
 * Traduz o erro do banco para uma frase de operação.
 *
 * As rotinas desta etapa levantam mensagens já escritas para quem está em pé ao
 * lado do veículo ("Há perguntas obrigatórias sem resposta: …"). Essas passam
 * intactas; só os códigos crus do Postgres viram texto aqui.
 */
function toMessage(error: { code?: string; message?: string }, fallback: string): string {
  const message = error.message ?? "";
  if (message && /^[A-ZÀ-Ý]/.test(message.trim())) return message;
  switch (error.code) {
    case "42501":
      return "Você não possui permissão para esta ação.";
    case "23505":
      return "Este checklist já foi registrado.";
    case "23503":
      return "Há um vínculo obrigatório ausente para este checklist.";
    case "40001":
      return "Outra gravação aconteceu ao mesmo tempo. Tente de novo.";
    default:
      return fallback;
  }
}

export interface ChecklistAnswerInput {
  questionId: string;
  answer: "yes" | "no";
  conditionalValue?: Record<string, string | string[]> | null;
  note?: string | null;
}

export interface SubmitChecklistInput {
  idempotencyKey: string;
  /** §48: a versão em que o formulário foi aberto acompanha o envio. */
  versionId?: string | null;
  vehicleId: string;
  operationId: string;
  checklistType: ChecklistType;
  operationalDate: string;
  startedAt: string;
  answers: ChecklistAnswerInput[];
}

export interface SubmitChecklistResult {
  executionId: string;
  duplicate: boolean;
  applicable: number;
  conforming: number;
  nonConforming: number;
  criticalNonConforming: number;
  durationSeconds: number | null;
  hasObligationContext: boolean;
}

/**
 * Envia o checklist (§51, §52).
 *
 * A chave de idempotência é gerada no cliente ANTES do envio e reenviada em
 * qualquer nova tentativa: é o que transforma duplo toque, retry e queda de
 * rede na devolução do primeiro resultado em vez de um segundo checklist.
 */
export async function submitChecklist(
  input: SubmitChecklistInput,
): Promise<Result<SubmitChecklistResult>> {
  const { organization } = await requireOrganization("applications.checklist_fleet.execute");
  const supabase = await createClient();

  const { data, error } = await supabase.rpc("submit_checklist_execution", {
    p_organization_id: organization.organizationId,
    p_payload: {
      idempotency_key: input.idempotencyKey,
      version_id: input.versionId ?? null,
      vehicle_id: input.vehicleId,
      operation_id: input.operationId,
      checklist_type: input.checklistType,
      operational_date: input.operationalDate,
      started_at: input.startedAt,
      answers: input.answers.map((a) => ({
        question_id: a.questionId,
        answer: a.answer,
        conditional_value: a.conditionalValue ?? null,
        note: a.note ?? null,
      })),
    },
  });

  if (error) {
    return { ok: false, error: toMessage(error, "Não foi possível enviar o checklist.") };
  }

  const raw = (data ?? {}) as Record<string, unknown>;
  revalidatePath(MODULE_PATH);

  return {
    ok: true,
    data: {
      executionId: String(raw.execution_id),
      duplicate: raw.duplicate === true,
      applicable: Number(raw.applicable ?? 0),
      conforming: Number(raw.conforming ?? 0),
      nonConforming: Number(raw.non_conforming ?? 0),
      criticalNonConforming: Number(raw.critical_non_conforming ?? 0),
      durationSeconds: raw.duration_seconds === undefined ? null : Number(raw.duration_seconds),
      hasObligationContext: raw.has_obligation_context === true,
    },
  };
}

export interface EquipmentOption {
  id: string;
  code: string;
  name: string;
  /** Veículos elegíveis deste tipo na operação, no escopo de quem pergunta. */
  vehicles: number;
}

/**
 * §31: os tipos de equipamento disponíveis na operação escolhida — habilitados
 * para o aplicativo E com veículo elegível. A lista nasce no servidor; a tela
 * não conhece a regra, só o resultado.
 */
export async function loadEquipmentOptions(
  operationId: string,
  operationalDate: string,
): Promise<Result<EquipmentOption[]>> {
  const context = await resolveOrganization("applications.checklist_fleet.execute");
  if (!context) return { ok: false, error: SESSION_LOST };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("checklist_equipment_options", {
    p_organization_id: context.organization.organizationId,
    p_operation_id: operationId,
    p_date: operationalDate || undefined,
  });

  if (error) {
    return { ok: false, error: toMessage(error, "Não foi possível carregar os tipos de equipamento.") };
  }

  return {
    ok: true,
    data: (Array.isArray(data) ? data : []).map((row) => {
      const t = row as Record<string, unknown>;
      return {
        id: String(t.id),
        code: String(t.code ?? ""),
        name: String(t.name ?? "—"),
        vehicles: Number(t.vehicles ?? 0),
      };
    }),
  };
}

export interface VehicleOption {
  id: string;
  licensePlate: string | null;
  fleetCode: string | null;
  vehicleTypeId: string;
  vehicleTypeName: string;
  brCode: string | null;
  /** Previsto pela fidelização para este dia (§33). */
  expected: boolean;
}

/**
 * §33: as placas da operação E do tipo escolhidos, elegíveis para o aplicativo.
 *
 * Disparado por clique/digitação, então usa `resolveOrganization`: um redirect
 * no meio de um checklist em andamento apagaria o que já foi respondido.
 */
export async function loadVehicleOptions(
  operationId: string,
  vehicleTypeId: string,
  search: string,
  operationalDate: string,
): Promise<Result<VehicleOption[]>> {
  const context = await resolveOrganization("applications.checklist_fleet.execute");
  if (!context) return { ok: false, error: SESSION_LOST };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("checklist_vehicle_options", {
    p_organization_id: context.organization.organizationId,
    p_operation_id: operationId,
    p_vehicle_type_id: vehicleTypeId,
    p_search: search || undefined,
    p_date: operationalDate || undefined,
  });

  if (error) {
    return { ok: false, error: toMessage(error, "Não foi possível carregar os veículos.") };
  }

  return {
    ok: true,
    data: (Array.isArray(data) ? data : []).map((row) => {
      const v = row as Record<string, unknown>;
      return {
        id: String(v.id),
        licensePlate: (v.license_plate as string) ?? null,
        fleetCode: (v.fleet_code as string) ?? null,
        vehicleTypeId: String(v.vehicle_type_id ?? vehicleTypeId),
        vehicleTypeName: String(v.vehicle_type_name ?? "—"),
        brCode: (v.br_code as string) ?? null,
        expected: v.expected === true,
      };
    }),
  };
}

/** Carrega o formulário aplicável ao veículo escolhido (§35). */
export async function loadChecklistForm(
  vehicleId: string,
  operationId: string,
): Promise<Result<ChecklistForm>> {
  const context = await resolveOrganization("applications.checklist_fleet.execute");
  if (!context) return { ok: false, error: SESSION_LOST };

  try {
    const form = await getChecklistForm(
      context.organization.organizationId,
      vehicleId,
      operationId,
    );
    return { ok: true, data: form };
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    return {
      ok: false,
      error: /^[A-ZÀ-Ý]/.test(message.trim())
        ? message
        : "Não foi possível carregar o formulário deste veículo.",
    };
  }
}

/** §59: atualiza a lista do histórico sem recarregar a página inteira. */
export async function refreshMyExecutions(): Promise<Result<ExecutionSummary[]>> {
  const context = await resolveOrganization("applications.checklist_fleet.view_own");
  if (!context) return { ok: false, error: SESSION_LOST };

  try {
    return { ok: true, data: await listMyExecutions(context.organization.organizationId) };
  } catch {
    return { ok: false, error: "Não foi possível carregar o histórico." };
  }
}
