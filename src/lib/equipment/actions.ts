"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireOrganization } from "@/lib/auth/session";
import type { Json } from "@/types/database.types";

/**
 * Equipment type mutations.
 *
 * Everything the form can change travels in one payload to one routine, and
 * the database applies it in one transaction (§36). A key absent from the
 * payload means "leave this alone" — which is also what keeps each section
 * behind its own permission: only the sections actually present are checked,
 * so editing a name never demands the eligibility permission.
 */

const MODULE_PATH = "/frota/tipos-equipamento";

export interface Result<T = undefined> {
  ok: boolean;
  error?: string;
  warning?: string;
  data?: T;
}

function toMessage(error: { message?: string; code?: string } | null, fallback: string): string {
  const message = error?.message ?? "";
  if (!message) return fallback;

  // 40001 is the optimistic lock: somebody else saved while this form was open.
  if (error?.code === "40001") return message;
  if (error?.code === "23505") return message.startsWith("Já existe") ? message : "Já existe um registro com estes dados.";
  if (error?.code === "42501" || message.includes("insufficient_privilege")) {
    return message.startsWith("Você") || message.startsWith("Este") || message.startsWith("Esta")
      ? message
      : "Você não possui permissão para esta ação.";
  }
  if (/^[A-ZÀ-Ú]/.test(message) && !message.includes("violates") && !message.includes("relation")) {
    return message;
  }
  return fallback;
}

export interface SubcategoryInput {
  id?: string | null;
  name: string;
  description?: string | null;
  isActive: boolean;
}

export interface ModuleRuleInput {
  moduleCode: string;
  capability: "visibility" | "operation" | "indicator";
  isEligible: boolean;
  reason?: string | null;
}

export interface SaveEquipmentTypeInput {
  id?: string | null;
  /** The `updated_at` the form was opened with. Guards against a lost update. */
  expectedUpdatedAt?: string | null;
  name?: string;
  description?: string | null;
  settings?: {
    operationRestrictionEnabled: boolean;
    requiresSubcategory: boolean;
    notes?: string | null;
  };
  subcategories?: SubcategoryInput[];
  operations?: string[];
  apps?: string[];
  moduleRules?: ModuleRuleInput[];
  reason?: string | null;
}

export async function saveEquipmentType(
  input: SaveEquipmentTypeInput,
): Promise<Result<{ id: string }>> {
  const { organization } = await requireOrganization(
    input.id ? "equipment_types.update" : "equipment_types.create",
  );
  const supabase = await createClient();

  const payload: Record<string, unknown> = {};
  if (input.id) payload.id = input.id;
  if (input.expectedUpdatedAt) payload.expected_updated_at = input.expectedUpdatedAt;
  if (input.name !== undefined) payload.name = input.name;
  if (input.description !== undefined) payload.description = input.description;
  if (input.reason) payload.reason = input.reason;

  if (input.settings) {
    payload.settings = {
      operation_restriction_enabled: input.settings.operationRestrictionEnabled,
      requires_subcategory: input.settings.requiresSubcategory,
      notes: input.settings.notes ?? null,
    };
  }
  if (input.subcategories) {
    payload.subcategories = input.subcategories.map((sub) => ({
      id: sub.id ?? null,
      name: sub.name,
      description: sub.description ?? null,
      is_active: sub.isActive,
    }));
  }
  if (input.operations) payload.operations = input.operations;
  if (input.apps) payload.apps = input.apps;
  if (input.moduleRules) {
    payload.module_rules = input.moduleRules.map((rule) => ({
      module_code: rule.moduleCode,
      capability: rule.capability,
      is_eligible: rule.isEligible,
      reason: rule.reason ?? null,
    }));
  }

  const { data, error } = await supabase.rpc("save_equipment_type", {
    p_organization_id: organization.organizationId,
    p_payload: payload as unknown as Json,
  });

  if (error) return { ok: false, error: toMessage(error, "Não foi possível salvar o tipo.") };

  revalidatePath(MODULE_PATH);
  revalidatePath("/frota/cadastro");
  return { ok: true, data: { id: data as string } };
}

export async function setEquipmentTypeStatus(
  typeId: string,
  isActive: boolean,
  reason: string | null,
): Promise<Result> {
  const { organization } = await requireOrganization("equipment_types.deactivate");
  const supabase = await createClient();

  const { error } = await supabase.rpc("set_equipment_type_status", {
    p_organization_id: organization.organizationId,
    p_vehicle_type_id: typeId,
    p_is_active: isActive,
    p_reason: reason ?? undefined,
  });

  if (error) return { ok: false, error: toMessage(error, "Não foi possível alterar a situação.") };

  revalidatePath(MODULE_PATH);
  revalidatePath("/frota/cadastro");
  return { ok: true };
}

export async function setSubcategoryStatus(
  subcategoryId: string,
  isActive: boolean,
  reason: string | null,
): Promise<Result> {
  const { organization } = await requireOrganization("equipment_types.manage_subcategories");
  const supabase = await createClient();

  const { error } = await supabase.rpc("set_equipment_subcategory_status", {
    p_organization_id: organization.organizationId,
    p_subcategory_id: subcategoryId,
    p_is_active: isActive,
    p_reason: reason ?? undefined,
  });

  if (error) return { ok: false, error: toMessage(error, "Não foi possível alterar a subcategoria.") };

  revalidatePath(MODULE_PATH);
  revalidatePath("/frota/cadastro");
  return { ok: true };
}
