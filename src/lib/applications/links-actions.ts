"use server";

import { revalidatePath } from "next/cache";
import { resolveOrganization } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import {
  getApplicationLinkHistory, getApplicationLinks,
  type ApplicationLinks, type LinkFilters, type LinkHistoryEntry,
} from "./links-queries";

export interface Result<T = undefined> {
  ok: boolean;
  error?: string;
  data?: T;
}

const SESSION_LOST =
  "Sua sessão expirou ou o acesso mudou. Recarregue a página e tente de novo.";

function toMessage(error: { code?: string; message?: string }, fallback: string): string {
  const message = error.message ?? "";
  if (message && /^[A-ZÀ-Ý]/.test(message.trim())) return message;
  if (error.code === "42501") return "Você não possui permissão para esta ação.";
  return fallback;
}

/** As telas que leem os vínculos — todas revalidam juntas (§26). */
function revalidateLinkScreens(operationId?: string | null) {
  revalidatePath("/organizacao/operacoes");
  if (operationId) revalidatePath(`/organizacao/operacoes/${operationId}`);
  revalidatePath("/frota/tipos-equipamento");
  revalidatePath("/aplicativos/check-list-frota");
  revalidatePath("/aplicativos/check-list-frota/configuracao");
}

export interface OperationLinkInput {
  appId: string;
  operationId: string;
  isEnabled: boolean;
  effectiveFrom?: string | null;
  effectiveTo?: string | null;
}

export interface LinkResult {
  appId: string;
  appName: string;
  targetId: string;
  targetName: string;
  isEnabled: boolean;
  inForce: boolean;
}

/**
 * Habilita ou desabilita um aplicativo para uma operação (§8–§14).
 *
 * A permissão é conferida no servidor pela rotina do banco; a checagem aqui é
 * só para devolver uma mensagem clara antes da viagem ao banco.
 */
export async function setOperationLink(input: OperationLinkInput): Promise<Result<LinkResult>> {
  const context = await resolveOrganization("applications.manage_operation_links");
  if (!context) return { ok: false, error: SESSION_LOST };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("set_application_operation_link", {
    p_organization_id: context.organization.organizationId,
    p_payload: {
      app_id: input.appId,
      operation_id: input.operationId,
      is_enabled: input.isEnabled,
      effective_from: input.effectiveFrom ?? null,
      effective_to: input.effectiveTo ?? null,
    },
  });
  if (error) return { ok: false, error: toMessage(error, "Não foi possível alterar o vínculo.") };

  const raw = (data ?? {}) as Record<string, unknown>;
  revalidateLinkScreens(input.operationId);
  return {
    ok: true,
    data: {
      appId: String(raw.app_id),
      appName: String(raw.app_name ?? ""),
      targetId: String(raw.operation_id),
      targetName: String(raw.operation_name ?? ""),
      isEnabled: raw.is_enabled === true,
      inForce: raw.in_force === true,
    },
  };
}

export interface VehicleTypeLinkInput {
  appId: string;
  vehicleTypeId: string;
  isEnabled: boolean;
  effectiveFrom?: string | null;
  effectiveTo?: string | null;
}

/** Habilita ou desabilita um aplicativo para um tipo de equipamento (§15–§20). */
export async function setVehicleTypeLink(input: VehicleTypeLinkInput): Promise<Result<LinkResult>> {
  const context = await resolveOrganization("applications.manage_equipment_links");
  if (!context) return { ok: false, error: SESSION_LOST };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("set_application_vehicle_type_link", {
    p_organization_id: context.organization.organizationId,
    p_payload: {
      app_id: input.appId,
      vehicle_type_id: input.vehicleTypeId,
      is_enabled: input.isEnabled,
      effective_from: input.effectiveFrom ?? null,
      effective_to: input.effectiveTo ?? null,
    },
  });
  if (error) return { ok: false, error: toMessage(error, "Não foi possível alterar o vínculo.") };

  const raw = (data ?? {}) as Record<string, unknown>;
  revalidateLinkScreens();
  return {
    ok: true,
    data: {
      appId: String(raw.app_id),
      appName: String(raw.app_name ?? ""),
      targetId: String(raw.vehicle_type_id),
      targetName: String(raw.vehicle_type_name ?? ""),
      isEnabled: raw.is_enabled === true,
      inForce: raw.in_force === true,
    },
  };
}

/** Histórico de alterações dos vínculos (§9, §50). */
export async function loadLinkHistory(
  filters: LinkFilters & { limit?: number },
): Promise<Result<LinkHistoryEntry[]>> {
  const context = await resolveOrganization("applications.view");
  if (!context) return { ok: false, error: SESSION_LOST };
  try {
    return { ok: true, data: await getApplicationLinkHistory(context.organization.organizationId, filters) };
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    return {
      ok: false,
      error: /^[A-ZÀ-Ý]/.test(message.trim()) ? message : "Não foi possível carregar o histórico.",
    };
  }
}

/** Estado atual dos vínculos, para telas que carregam no cliente (drawers). */
export async function loadApplicationLinks(filters: LinkFilters): Promise<Result<ApplicationLinks>> {
  const context = await resolveOrganization("applications.view");
  if (!context) return { ok: false, error: SESSION_LOST };
  try {
    return { ok: true, data: await getApplicationLinks(context.organization.organizationId, filters) };
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    return {
      ok: false,
      error: /^[A-ZÀ-Ý]/.test(message.trim()) ? message : "Não foi possível carregar os vínculos.",
    };
  }
}
