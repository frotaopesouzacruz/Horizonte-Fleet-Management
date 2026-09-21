"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getSessionContext, requireOrganization } from "@/lib/auth/session";
import type { Json } from "@/types/database.types";

/**
 * Writes for the operations module.
 *
 * There is one write path — `save_operation` — and it takes the operation and
 * its whole coverage together. Saving them separately is how a screen ends up
 * with an operation that saved and a coverage that did not, and the coverage is
 * applied as a difference inside the function, so a rename does not rewrite
 * twenty-one rows.
 *
 * Nothing here validates that a city belongs to its state or that a state is
 * covered by the operation. It cannot be written wrongly: composite foreign keys
 * make an inconsistent row unrepresentable, and the function refuses an active
 * operation whose coverage is incomplete.
 */

const MODULE_PATH = "/organizacao/operacoes";

export interface Result<T = undefined> {
  ok: boolean;
  error?: string;
  data?: T;
}

function toMessage(error: { message?: string; code?: string } | null, fallback: string): string {
  const message = error?.message ?? "";
  // The function raises in Portuguese and on purpose; those pass through.
  if (/^[A-ZÀ-Ú]/.test(message) && !message.includes("violates") && !message.includes("relation")) {
    return message;
  }
  if (error?.code === "23505") return "Já existe uma operação com este nome.";
  if (error?.code === "42501") return "Você não possui permissão para esta ação.";
  return fallback;
}

export interface CoverageInput {
  stateId: number;
  cityIds: number[];
}

export interface SaveOperationInput {
  id?: string | null;
  name: string;
  description?: string | null;
  status: "active" | "inactive";
  /** Omit to leave the coverage untouched; pass it to replace it. */
  coverage?: CoverageInput[];
}

export async function saveOperation(input: SaveOperationInput): Promise<Result<{ id: string }>> {
  const { organization } = await requireOrganization(input.id ? "operations.view" : "operations.view");
  const supabase = await createClient();

  const payload: Record<string, unknown> = {
    id: input.id ?? null,
    name: input.name,
    description: input.description ?? null,
    status: input.status,
  };
  if (input.coverage) {
    payload.coverage = input.coverage.map((entry) => ({
      state_id: entry.stateId,
      cities: entry.cityIds,
    }));
  }

  const { data, error } = await supabase.rpc("save_operation", {
    p_organization_id: organization.organizationId,
    p_payload: payload as Json,
  });

  if (error) return { ok: false, error: toMessage(error, "Não foi possível salvar a operação.") };

  revalidatePath(MODULE_PATH);
  if (data) revalidatePath(`${MODULE_PATH}/${data}`);
  return { ok: true, data: { id: data as string } };
}

export async function setOperationStatus(
  operationId: string,
  status: "active" | "inactive",
): Promise<Result> {
  await requireOrganization("operations.view");
  const supabase = await createClient();

  const { error } = await supabase.rpc("set_operation_status", {
    p_operation_id: operationId,
    p_status: status,
  });

  if (error) return { ok: false, error: toMessage(error, "Não foi possível alterar a situação.") };

  revalidatePath(MODULE_PATH);
  revalidatePath(`${MODULE_PATH}/${operationId}`);
  return { ok: true };
}

/* -------------------------------------------------------------------------- */

export interface CityChoice {
  id: number;
  name: string;
  isCapital: boolean;
}

/**
 * Every municipality of one state, fetched once and cached by the picker.
 *
 * Minas Gerais has 853 and São Paulo 645, which is too many to ship for every
 * state up front and too few to justify paging: one request per state the user
 * actually opens, held for the life of the form, is the shape that makes search,
 * "select all" and "clear" instant without asking the server again.
 */
export async function listCitiesOfState(stateId: number): Promise<CityChoice[]> {
  // Deliberately not requireOrganization: that one redirects, and a redirect
  // returned to a click handler navigates the person away with the coverage
  // half-edited. A list that cannot be loaded comes back empty and the picker
  // says so. Reading municipalities is not privileged anyway — the IBGE table
  // is the same for everyone, and RLS still decides what the query returns.
  const session = await getSessionContext();
  if (!session?.activeOrganization) return [];

  const supabase = await createClient();

  const { data } = await supabase
    .from("cities")
    .select("id, name, is_capital")
    .eq("state_id", stateId)
    .order("name");

  return (data ?? []).map((row) => ({ id: row.id, name: row.name, isCapital: row.is_capital }));
}
