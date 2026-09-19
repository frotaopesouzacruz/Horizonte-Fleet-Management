"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireOrganization } from "@/lib/auth/session";

/**
 * Writes to an operation's geographic footprint.
 *
 * Every one of these needs `operations.manage` — the same permission as
 * renaming the operation, because deciding where an operation runs is the same
 * kind of decision. The check here is a courtesy that produces a good error
 * message; RLS is what actually refuses the write.
 *
 * Nothing in this file validates that a city belongs to its state or that the
 * state belongs to the operation. It cannot be written wrongly: the composite
 * foreign keys make an inconsistent row unrepresentable, so a bug here fails
 * loudly at the database rather than quietly storing nonsense.
 */

const MODULE_PATH = "/organizacao/operacoes";

export interface Result {
  ok: boolean;
  error?: string;
}

function toMessage(error: { message?: string; code?: string } | null, fallback: string): string {
  const message = error?.message ?? "";
  if (error?.code === "23505") return "Este item já está vinculado a esta operação.";
  if (error?.code === "23503") {
    return "Vínculo inválido: a cidade não pertence ao estado informado, ou o estado não está coberto por esta operação.";
  }
  if (error?.code === "42501" || message.includes("permission") || message.includes("policy")) {
    return "Você não possui permissão para alterar a abrangência desta operação.";
  }
  return fallback;
}

export async function addOperationState(operationId: string, stateId: number): Promise<Result> {
  const { organization } = await requireOrganization("operations.manage");
  const supabase = await createClient();

  const { error } = await supabase.from("operation_states").insert({
    organization_id: organization.organizationId,
    operation_id: operationId,
    state_id: stateId,
  });

  if (error) return { ok: false, error: toMessage(error, "Não foi possível adicionar o estado.") };
  revalidatePath(`${MODULE_PATH}/${operationId}`);
  revalidatePath(MODULE_PATH);
  return { ok: true };
}

/**
 * Removing a state takes its municipalities with it — that is the cascade on
 * operation_cities, and it is the behaviour the screen warns about before
 * calling this.
 */
export async function removeOperationState(operationId: string, stateId: number): Promise<Result> {
  const { organization } = await requireOrganization("operations.manage");
  const supabase = await createClient();

  const { error } = await supabase
    .from("operation_states")
    .delete()
    .eq("organization_id", organization.organizationId)
    .eq("operation_id", operationId)
    .eq("state_id", stateId);

  if (error) return { ok: false, error: toMessage(error, "Não foi possível remover o estado.") };
  revalidatePath(`${MODULE_PATH}/${operationId}`);
  revalidatePath(MODULE_PATH);
  return { ok: true };
}

export async function addOperationCity(
  operationId: string,
  stateId: number,
  cityId: number,
): Promise<Result> {
  const { organization } = await requireOrganization("operations.manage");
  const supabase = await createClient();

  const { error } = await supabase.from("operation_cities").insert({
    organization_id: organization.organizationId,
    operation_id: operationId,
    state_id: stateId,
    city_id: cityId,
  });

  if (error) return { ok: false, error: toMessage(error, "Não foi possível adicionar a cidade.") };
  revalidatePath(`${MODULE_PATH}/${operationId}`);
  revalidatePath(MODULE_PATH);
  return { ok: true };
}

export async function removeOperationCity(operationId: string, cityId: number): Promise<Result> {
  const { organization } = await requireOrganization("operations.manage");
  const supabase = await createClient();

  const { error } = await supabase
    .from("operation_cities")
    .delete()
    .eq("organization_id", organization.organizationId)
    .eq("operation_id", operationId)
    .eq("city_id", cityId);

  if (error) return { ok: false, error: toMessage(error, "Não foi possível remover a cidade.") };
  revalidatePath(`${MODULE_PATH}/${operationId}`);
  revalidatePath(MODULE_PATH);
  return { ok: true };
}

/* -------------------------------------------------------------------------- */

export interface CityOption {
  id: number;
  name: string;
  isCapital: boolean;
}

/**
 * Municipalities of one state, for the picker that adds a city to an operation.
 *
 * Read through a server action rather than shipped to the browser: Minas Gerais
 * alone has 853 municipalities, and the operation may cover several states. The
 * search is the accent-insensitive one, so "sao joao" finds "São João".
 */
export async function searchCitiesInState(stateId: number, query: string): Promise<CityOption[]> {
  await requireOrganization("operations.view");
  const supabase = await createClient();

  const trimmed = query.trim();
  const { data } = await supabase.rpc("search_cities", {
    p_state_id: stateId,
    p_query: trimmed.length > 0 ? trimmed : undefined,
    p_limit: 30,
    p_offset: 0,
  });

  return (data ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    isCapital: row.is_capital,
  }));
}
