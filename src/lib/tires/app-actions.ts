"use server";

import { revalidatePath } from "next/cache";
import { getSessionContext, hasPermission } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import type { Json } from "@/types/database.types";
import {
  camelize,
  TIRES_APP_PATH,
  TIRES_BASE_PATH,
  type TireAppContext,
  type TireAppPositions,
  type TireAppSubmitResult,
  type TireAppVehicles,
  type TireMyInspectionDetail,
  type TireMyInspections,
} from "./types";

/**
 * App Vistoria de Pneus — o lado do servidor.
 *
 * Permissão `applications.tires.execute` (o `tires.inspection.submit` do
 * requisito), concedida pelos perfis oficiais. LEITURA CEGA: nenhuma rotina
 * daqui devolve Nº Fogo, sulco ou PSI esperados — só as posições do veículo.
 * A comparação com a fotografia oficial é feita no banco, no envio, e a
 * vistoria NÃO altera a fotografia (ela segue para revisão e conciliação com
 * o próximo Rodopar). O envio é idempotente pela chave gerada no aparelho.
 */
export interface Result<T = undefined> {
  ok: boolean;
  error?: string;
  data?: T;
}

const PERMISSION = "applications.tires.execute";
type Rpc = (fn: string, args: Record<string, Json>) => Promise<{ data: unknown; error: { code?: string; message?: string } | null }>;

function toMessage(error: { code?: string; message?: string }, fallback: string): string {
  const message = error.message ?? "";
  if (message && /^[A-ZÀ-Ýº]/.test(message.trim())) return message;
  if (error.code === "42501") return "Você não possui permissão para executar a Vistoria de Pneus.";
  return fallback;
}

async function call<T>(fn: string, args: Record<string, Json>, fallback: string): Promise<Result<T>> {
  const s = await getSessionContext();
  if (!s?.activeOrganization || !hasPermission(s, PERMISSION)) {
    return { ok: false, error: "Sem permissão para executar a Vistoria de Pneus ou a sessão expirou." };
  }
  const supabase = await createClient();
  const { data, error } = await (supabase.rpc as unknown as Rpc)(fn, { p_organization_id: s.activeOrganization.organizationId, ...args });
  if (error) return { ok: false, error: toMessage(error, fallback) };
  return { ok: true, data: camelize<T>(data) };
}

export async function loadTireAppContext(): Promise<Result<TireAppContext>> {
  return call("tire_inspection_context", {}, "Não foi possível abrir a Vistoria de Pneus.");
}

export async function loadTireAppVehicles(search?: string | null, limit = 30): Promise<Result<TireAppVehicles>> {
  return call("tire_inspection_vehicles", { p_search: search?.trim() || null, p_limit: limit }, "Não foi possível listar as frotas.");
}

export async function loadTireAppPositions(vehicleId: string): Promise<Result<TireAppPositions>> {
  return call("tire_inspection_positions", { p_vehicle_id: vehicleId }, "Não foi possível montar o diagrama do veículo.");
}

export interface TireAppSubmitInput {
  clientSubmissionId: string;
  vehicleId: string;
  parentInspectionId?: string | null;
  startedAt?: string | null;
  inspectedAt?: string | null;
  generalObservation?: string | null;
  items: {
    positionCode: string;
    fireNumberRead?: string | null;
    tread1?: string | null;
    tread2?: string | null;
    tread3?: string | null;
    tread4?: string | null;
    psiRead?: string | null;
    observation?: string | null;
  }[];
}

export async function submitTireInspection(input: TireAppSubmitInput): Promise<Result<TireAppSubmitResult>> {
  const payload: Record<string, Json> = {
    client_submission_id: input.clientSubmissionId,
    vehicle_id: input.vehicleId,
    parent_inspection_id: input.parentInspectionId ?? null,
    started_at: input.startedAt ?? null,
    inspected_at: input.inspectedAt ?? null,
    general_observation: input.generalObservation?.trim() || null,
    // valores como digitados (texto): o banco interpreta vírgula/ponto e
    // confere os limites técnicos vigentes; o Nº Fogo nunca vira número
    items: input.items.map((it) => ({
      position_code: it.positionCode,
      fire_number_read: it.fireNumberRead?.trim() || null,
      tread_1: it.tread1?.trim() || null,
      tread_2: it.tread2?.trim() || null,
      tread_3: it.tread3?.trim() || null,
      tread_4: it.tread4?.trim() || null,
      psi_read: it.psiRead?.trim() || null,
      observation: it.observation?.trim() || null,
    })),
  };
  const r = await call<TireAppSubmitResult>("tire_inspection_submit", { p_payload: payload }, "Não foi possível enviar a vistoria.");
  if (r.ok) {
    revalidatePath(TIRES_APP_PATH);
    revalidatePath(TIRES_BASE_PATH);
  }
  return r;
}

export async function loadMyTireInspections(limit = 30, offset = 0): Promise<Result<TireMyInspections>> {
  return call("tire_my_inspections", { p_limit: limit, p_offset: offset }, "Não foi possível listar as suas vistorias.");
}

export async function loadMyTireInspectionDetail(inspectionId: string): Promise<Result<TireMyInspectionDetail>> {
  return call("tire_my_inspection_detail", { p_inspection_id: inspectionId }, "Não foi possível abrir a vistoria.");
}
