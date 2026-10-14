"use server";

import { revalidatePath } from "next/cache";
import { getSessionContext, hasPermission } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import type { Json } from "@/types/database.types";
import {
  camelize,
  PREDICTIVE_APP_PATH,
  PREDICTIVE_APP_PERMISSION,
  type PredictiveAppContext,
  type PredictiveAppRoadmap,
  type PredictiveAppSubmitInput,
  type PredictiveAppSubmitResult,
  type PredictiveAppVehicle,
  type PredictiveMySubmission,
} from "./predictive-app";
import type { PredictiveSubmissionDetail } from "./types";

/**
 * App Verificação Preditiva de Frota — o lado do servidor.
 *
 * Permissão `applications.predictive.execute` (Perfis & Permissões). O envio é
 * idempotente pela chave gerada no aparelho; cada item vira uma verificação
 * formal (`maintenance_predictive_register`, origem "app") e o desfecho —
 * reiniciar, monitorar, abrir corretiva — é decidido e gravado pelo banco. O
 * KM informado nunca grava na base oficial de KM.
 */
export interface Result<T = undefined> {
  ok: boolean;
  error?: string;
  data?: T;
}

type Rpc = (fn: string, args: Record<string, Json>) => Promise<{ data: unknown; error: { code?: string; message?: string } | null }>;

function toMessage(error: { code?: string; message?: string }, fallback: string): string {
  const message = error.message ?? "";
  if (message && /^[A-ZÀ-Ý]/.test(message.trim())) return message;
  if (error.code === "42501") return "Você não possui permissão para executar a Verificação Preditiva.";
  if (error.code === "P0002") return "Registro não encontrado ou fora do seu acesso.";
  return fallback;
}

async function session() {
  const s = await getSessionContext();
  if (!s?.activeOrganization || !hasPermission(s, PREDICTIVE_APP_PERMISSION)) return null;
  return { session: s, organizationId: s.activeOrganization.organizationId, userId: s.userId };
}

async function call<T>(fn: string, args: Record<string, Json>, fallback: string, revalidate = false): Promise<Result<T>> {
  const ctx = await session();
  if (!ctx) return { ok: false, error: "Sem permissão para executar a Verificação Preditiva ou a sessão expirou." };
  const supabase = await createClient();
  const { data, error } = await (supabase.rpc as unknown as Rpc)(fn, { p_organization_id: ctx.organizationId, ...args });
  if (error) return { ok: false, error: toMessage(error, fallback) };
  if (revalidate) {
    revalidatePath(PREDICTIVE_APP_PATH);
    revalidatePath("/frota/manutencao");
  }
  return { ok: true, data: camelize<T>(data) };
}

export async function loadPredictiveAppContext(): Promise<Result<PredictiveAppContext>> {
  return call("maintenance_predictive_app_context", {}, "Não foi possível abrir a Verificação Preditiva.");
}

export async function loadPredictiveAppVehicles(search?: string | null): Promise<Result<PredictiveAppVehicle[]>> {
  const r = await call<{ vehicles: PredictiveAppVehicle[]; today: string; available: boolean }>(
    "maintenance_predictive_app_vehicles",
    { p_search: search ?? null },
    "Não foi possível listar as frotas.",
  );
  return r.ok ? { ok: true, data: r.data?.vehicles ?? [] } : { ok: false, error: r.error };
}

export async function loadPredictiveAppRoadmap(vehicleId: string): Promise<Result<PredictiveAppRoadmap>> {
  if (!/^[0-9a-f-]{36}$/i.test(vehicleId)) return { ok: false, error: "Veículo inválido." };
  return call("maintenance_predictive_app_roadmap", { p_vehicle_id: vehicleId }, "Não foi possível carregar o roteiro técnico.");
}

export async function submitPredictiveVerification(input: PredictiveAppSubmitInput): Promise<Result<PredictiveAppSubmitResult>> {
  if (!/^[0-9a-f-]{36}$/i.test(input.clientSubmissionId)) return { ok: false, error: "Identificador do envio inválido." };
  const payload: Record<string, Json> = {
    client_submission_id: input.clientSubmissionId,
    vehicle_id: input.vehicleId,
    verified_on: input.verifiedOn ?? null,
    km_informed: input.kmInformed ?? null,
    km_justification: input.kmJustification ?? null,
    general_observation: input.generalObservation ?? null,
    items: input.items.map((item) => ({
      cycle_id: item.cycleId,
      result: item.result,
      notes: item.notes ?? null,
      checklist: item.checklist.map((a) => ({ key: a.key, answer: a.answer })),
      monitor_km: item.monitorKm ?? null,
      monitor_days: item.monitorDays ?? null,
      open_maintenance: item.openMaintenance ?? true,
    })),
  };
  return call("maintenance_predictive_app_submit", { p_payload: payload }, "Não foi possível enviar a verificação.", true);
}

export async function loadMyPredictiveSubmissions(limit = 30): Promise<Result<PredictiveMySubmission[]>> {
  const r = await call<{ items: PredictiveMySubmission[]; today: string }>(
    "maintenance_predictive_my_submissions",
    { p_limit: limit },
    "Não foi possível listar os seus envios.",
  );
  return r.ok ? { ok: true, data: r.data?.items ?? [] } : { ok: false, error: r.error };
}

export async function loadOwnPredictiveSubmission(submissionId: string): Promise<Result<PredictiveSubmissionDetail>> {
  if (!/^[0-9a-f-]{36}$/i.test(submissionId)) return { ok: false, error: "Envio inválido." };
  return call("maintenance_predictive_submission_detail", { p_submission_id: submissionId }, "Não foi possível abrir o envio.");
}
