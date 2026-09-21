"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireOrganization } from "@/lib/auth/session";
import { parseDecimal } from "./columns";
import {
  listStatesByOperation,
  listCitiesByOperationAndState,
  type StateOption,
  type CityOption,
} from "@/lib/organization/operations";

/**
 * Fleet mutations.
 *
 * Each one calls the routine that owns its rule, and none of them owns more
 * than one. Saving a vehicle does not move it between cities; moving it does
 * not correct its odometer; correcting the odometer does not archive anything.
 * That separation is not cosmetic — it is what lets each action carry its own
 * permission and its own audit trail, and what stops a registration form from
 * quietly ending an allocation nobody meant to end.
 */

// A "use server" module may only export async functions, so this stays local.
const MODULE_PATH = "/frota/cadastro";

export interface Result<T = undefined> {
  ok: boolean;
  error?: string;
  warning?: string;
  data?: T;
}

/**
 * Database errors are written for engineers; the ones we raise ourselves are
 * written for the person using the product. Those pass through unchanged and
 * everything else becomes one honest sentence.
 */
function toMessage(error: { message?: string; code?: string } | null, fallback: string): string {
  const message = error?.message ?? "";
  if (!message) return fallback;

  if (error?.code === "23505") {
    if (message.includes("license_plate")) return "Já existe um veículo com esta placa nesta organização.";
    if (message.includes("fleet_code")) return "Já existe um veículo com este código de frota.";
    if (message.includes("vin")) return "Já existe um veículo com este chassi.";
    if (message.includes("renavam")) return "Já existe um veículo com este RENAVAM.";
    return "Já existe um registro com estes dados.";
  }
  if (error?.code === "23503") {
    if (message.includes("coverage")) {
      return "A cidade escolhida não faz parte da cobertura desta operação.";
    }
    if (message.includes("subcategor")) {
      return "A subcategoria escolhida não pertence ao tipo de equipamento selecionado.";
    }
    return "Um dos vínculos informados não existe ou não pertence a esta organização.";
  }
  if (error?.code === "42501" || message.includes("insufficient_privilege")) {
    return "Você não possui permissão para esta ação.";
  }
  if (/^[A-ZÀ-Ú]/.test(message) && !message.includes("violates") && !message.includes("relation")) {
    return message;
  }
  return fallback;
}

function optional(formData: FormData, key: string): string | null {
  const value = formData.get(key);
  if (value === null) return null;
  const text = String(value).trim();
  return text === "" ? null : text;
}

/* ----------------------------------------------------------- registration */

export async function saveVehicle(formData: FormData): Promise<Result<{ id: string }>> {
  const id = optional(formData, "id");
  const { organization } = await requireOrganization(id ? "vehicles.update" : "vehicles.create");
  const supabase = await createClient();

  const payload: Record<string, unknown> = {
    id,
    fleet_code: optional(formData, "fleet_code"),
    license_plate: optional(formData, "license_plate"),
    vin: optional(formData, "vin"),
    renavam: optional(formData, "renavam"),
    vehicle_type_id: optional(formData, "vehicle_type_id"),
    vehicle_subcategory_id: optional(formData, "vehicle_subcategory_id"),
    vehicle_model_id: optional(formData, "vehicle_model_id"),
    manufacture_year: optional(formData, "manufacture_year"),
    model_year: optional(formData, "model_year"),
    ownership_type: optional(formData, "ownership_type") ?? "owned",
    status: optional(formData, "status") ?? "active",
    asset_value: parseDecimal(optional(formData, "asset_value")).value,
    antt_code: optional(formData, "antt_code"),
    has_tachograph: formData.get("has_tachograph") === "on" || formData.get("has_tachograph") === "true",
    tachograph_number: optional(formData, "tachograph_number"),
    notes: optional(formData, "notes"),
    organization_unit_id: optional(formData, "organization_unit_id"),
    cost_center_id: optional(formData, "cost_center_id"),
  };

  // Allocation and the first odometer reading are only accepted while the
  // vehicle is being created. On an edit the routine ignores them, and the
  // form does not offer them either — each has its own action below.
  if (!id) {
    payload.operation_id = optional(formData, "operation_id");
    payload.state_id = optional(formData, "state_id");
    payload.city_id = optional(formData, "city_id");
    payload.assigned_from = optional(formData, "assigned_from");
    payload.assignment_reason = optional(formData, "assignment_reason");
    payload.initial_odometer_km = optional(formData, "initial_odometer_km");
    payload.initial_odometer_date = optional(formData, "initial_odometer_date");
  }

  const { data, error } = await supabase.rpc("save_vehicle", {
    p_organization_id: organization.organizationId,
    p_payload: payload as never,
  });

  if (error) return { ok: false, error: toMessage(error, "Não foi possível salvar o veículo.") };

  revalidatePath(MODULE_PATH);
  return { ok: true, data: { id: data as string } };
}

/* ------------------------------------------------------------- allocation */

export async function setVehicleAssignment(input: {
  vehicleId: string;
  operationId: string;
  stateId: number;
  cityId: number;
  effectiveFrom: string;
  reason?: string | null;
}): Promise<Result> {
  await requireOrganization("vehicles.manage_assignment");
  const supabase = await createClient();

  const { error } = await supabase.rpc("set_vehicle_assignment", {
    p_vehicle_id: input.vehicleId,
    p_operation_id: input.operationId,
    p_state_id: input.stateId,
    p_city_id: input.cityId,
    p_effective_from: input.effectiveFrom,
    p_reason: input.reason ?? undefined,
  });

  if (error) return { ok: false, error: toMessage(error, "Não foi possível alocar o veículo.") };

  revalidatePath(MODULE_PATH);
  return { ok: true };
}

export async function endVehicleAssignment(
  vehicleId: string,
  effectiveTo: string,
  reason: string | null,
): Promise<Result> {
  await requireOrganization("vehicles.manage_assignment");
  const supabase = await createClient();

  const { error } = await supabase.rpc("end_vehicle_assignment", {
    p_vehicle_id: vehicleId,
    p_effective_to: effectiveTo,
    p_reason: reason ?? undefined,
  });

  if (error) return { ok: false, error: toMessage(error, "Não foi possível encerrar a alocação.") };

  revalidatePath(MODULE_PATH);
  return { ok: true };
}

/* -------------------------------------------------------------- odometer */

export async function correctOdometer(input: {
  vehicleId: string;
  odometerKm: number;
  readingDate: string;
  reason: string;
}): Promise<Result> {
  await requireOrganization("vehicles.correct_odometer");
  const supabase = await createClient();

  const { error } = await supabase.rpc("correct_vehicle_odometer", {
    p_vehicle_id: input.vehicleId,
    p_odometer_km: input.odometerKm,
    p_reading_date: input.readingDate,
    p_reason: input.reason,
  });

  if (error) return { ok: false, error: toMessage(error, "Não foi possível registrar a correção.") };

  revalidatePath(MODULE_PATH);
  return { ok: true };
}

/* ------------------------------------------------------- status lifecycle */

export async function setVehicleStatus(
  vehicleId: string,
  status: "active" | "inactive",
  reason: string | null,
): Promise<Result> {
  await requireOrganization("vehicles.update");
  const supabase = await createClient();

  const { error } = await supabase.rpc("set_vehicle_registration_status", {
    p_vehicle_id: vehicleId,
    p_status: status,
    p_reason: reason ?? undefined,
  });

  if (error) return { ok: false, error: toMessage(error, "Não foi possível alterar a situação do veículo.") };

  revalidatePath(MODULE_PATH);
  return { ok: true };
}

export async function archiveVehicle(vehicleId: string, reason: string | null): Promise<Result> {
  await requireOrganization("vehicles.archive");
  const supabase = await createClient();

  const { error } = await supabase.rpc("archive_vehicle", {
    p_vehicle_id: vehicleId,
    p_reason: reason ?? undefined,
  });

  if (error) return { ok: false, error: toMessage(error, "Não foi possível arquivar o veículo.") };

  revalidatePath(MODULE_PATH);
  return { ok: true };
}

export async function restoreVehicle(vehicleId: string): Promise<Result> {
  await requireOrganization("vehicles.archive");
  const supabase = await createClient();

  const { error } = await supabase.rpc("restore_vehicle", { p_vehicle_id: vehicleId });

  if (error) return { ok: false, error: toMessage(error, "Não foi possível restaurar o veículo.") };

  revalidatePath(MODULE_PATH);
  return { ok: true };
}

/* --------------------------------------------------- cascading geography */

/**
 * The Etapa 04 contract, reused verbatim: an operation offers only the states
 * it covers, and a state offers only the municipalities that operation covers
 * there. Never the 27 UFs, never the 853 municipalities of Minas Gerais.
 *
 * The server validates the combination regardless (§23). These two exist so
 * the form cannot offer an invalid one in the first place.
 */
export async function loadOperationStates(operationId: string): Promise<Result<StateOption[]>> {
  const { organization } = await requireOrganization("vehicles.view");
  try {
    const states = await listStatesByOperation(organization.organizationId, operationId);
    return { ok: true, data: states };
  } catch {
    return { ok: false, error: "Não foi possível carregar os estados da operação." };
  }
}

export async function loadOperationCities(
  operationId: string,
  stateId: number,
): Promise<Result<CityOption[]>> {
  const { organization } = await requireOrganization("vehicles.view");
  try {
    const cities = await listCitiesByOperationAndState(organization.organizationId, operationId, stateId);
    return { ok: true, data: cities };
  } catch {
    return { ok: false, error: "Não foi possível carregar as cidades da operação." };
  }
}
