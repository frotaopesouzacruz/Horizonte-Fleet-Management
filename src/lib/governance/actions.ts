"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireOrganization, resolveOrganization } from "@/lib/auth/session";
import type { Json } from "@/types/database.types";

/**
 * Operational governance mutations.
 *
 * Every write goes to a routine that owns its rule, and none of them owns more
 * than one. Designating a leader does not move a vehicle; substituting a
 * vehicle does not change its operation; inverting two vehicles is one call
 * and not two substitutions. That separation is what lets each action carry
 * its own permission and its own audit trail.
 *
 * Nothing here writes to roles, memberships or employee_assignments. §12 and
 * §27 are not comments in this file — they are the reason no such call exists.
 */

const LEADERSHIP_PATH = "/governanca/liderancas";
const FIDELIZATION_PATH = "/governanca/fidelizacao";

/** A read triggered by a click does not redirect: it says what happened and leaves the screen standing. */
const SESSION_LOST =
  "Sua sessão expirou ou o acesso mudou. Recarregue a página e tente de novo.";

export interface Result<T = undefined> {
  ok: boolean;
  error?: string;
  warnings?: string[];
  data?: T;
}

/**
 * Database errors are written for engineers; the ones the routines raise are
 * written for the person using the product. Those pass through unchanged and
 * everything else becomes one honest sentence.
 */
function toMessage(error: { message?: string; code?: string } | null, fallback: string): string {
  const message = error?.message ?? "";
  if (!message) return fallback;

  // 23P01 is an exclusion violation — the occupancy rules. The constraint name
  // says which one, and each has a different thing to tell the person.
  if (error?.code === "23P01") {
    if (message.includes("leadership_primary_no_overlap")) {
      return "Já existe um responsável principal para este escopo neste período.";
    }
    if (message.includes("fidelization_br_occupancy")) {
      return "Esta BR já possui um veículo principal em parte deste período.";
    }
    if (message.includes("fidelization_vehicle_occupancy")) {
      return "Este veículo já está fidelizado em outra BR em parte deste período.";
    }
    if (message.includes("fidelization_drivers_primary_occupancy")) {
      return "Esta posição já possui um motorista principal em parte deste período.";
    }
    if (message.includes("fidelization_drivers_occupancy")) {
      return "Este motorista já está planejado como principal em outra posição neste período.";
    }
    return "O período informado conflita com um vínculo existente.";
  }
  if (error?.code === "40001") return message;
  if (error?.code === "23505") return message.startsWith("Já existe")
    ? message
    : "Já existe uma BR com este código nesta cidade e operação.";
  if (error?.code === "23503") {
    return "Um dos vínculos informados não existe ou não pertence a esta organização.";
  }
  if (error?.code === "42501" || message.includes("insufficient_privilege")) {
    return /^(Você|Este|Esta|Os|Um)/.test(message) ? message : "Você não possui permissão para esta ação.";
  }
  if (/^[A-ZÀ-Ú]/.test(message) && !message.includes("violates") && !message.includes("relation")) {
    return message;
  }
  return fallback;
}

/* ---------------------------------------------------------------- lideranças */

export interface SaveLeadershipInput {
  id?: string | null;
  employeeId: string;
  scopeLevel: "operation" | "city" | "br";
  operationId: string;
  operationCityId?: string | null;
  operationBrId?: string | null;
  responsibilityType: "principal" | "substitute" | "support";
  effectiveFrom: string;
  effectiveTo?: string | null;
  notes?: string | null;
  expectedUpdatedAt?: string | null;
}

export async function saveLeadership(input: SaveLeadershipInput): Promise<Result<{ id: string }>> {
  const { organization } = await requireOrganization("leadership.manage");
  const supabase = await createClient();

  const payload = {
    id: input.id ?? null,
    employee_id: input.employeeId,
    scope_level: input.scopeLevel,
    operation_id: input.operationId,
    operation_city_id: input.operationCityId ?? null,
    operation_br_id: input.operationBrId ?? null,
    responsibility_type: input.responsibilityType,
    effective_from: input.effectiveFrom,
    effective_to: input.effectiveTo ?? null,
    notes: input.notes ?? null,
    expected_updated_at: input.expectedUpdatedAt ?? null,
  };

  const { data, error } = await supabase.rpc("save_leadership_assignment", {
    p_organization_id: organization.organizationId,
    p_payload: payload as unknown as Json,
  } as never);

  if (error) return { ok: false, error: toMessage(error, "Não foi possível salvar o vínculo de liderança.") };

  const result = (data ?? {}) as { id?: string; warnings?: string[] };
  revalidatePath(LEADERSHIP_PATH);
  return {
    ok: true,
    data: { id: result.id ?? "" },
    // §19: the warnings are the point of the routine returning an object. They
    // are shown after the save, because none of them is a reason to refuse it.
    warnings: Array.isArray(result.warnings) ? result.warnings : [],
  };
}

export async function endLeadership(
  id: string,
  effectiveTo: string,
  reason: string | null,
): Promise<Result> {
  await requireOrganization("leadership.manage");
  const supabase = await createClient();

  const { error } = await supabase.rpc("end_leadership_assignment", {
    p_id: id,
    p_effective_to: effectiveTo,
    p_reason: reason ?? undefined,
  } as never);

  if (error) return { ok: false, error: toMessage(error, "Não foi possível encerrar a responsabilidade.") };
  revalidatePath(LEADERSHIP_PATH);
  return { ok: true };
}

export interface ReplicationPreview {
  dryRun: boolean;
  created: number;
  preserved: number;
  replaced: number;
}

/**
 * The preview and the execution are the same routine called twice.
 *
 * A separate "count what would happen" query is a second implementation of the
 * rule, and the day the two disagree the person confirms one thing and gets
 * another.
 */
export async function replicateLeadershipCompetence(input: {
  from: { year: number; month: number };
  to: { year: number; month: number };
  operationId?: string | null;
  overwrite?: boolean;
  dryRun: boolean;
}): Promise<Result<ReplicationPreview>> {
  const { organization } = await requireOrganization("leadership.replicate");
  const supabase = await createClient();

  const { data, error } = await supabase.rpc("replicate_leadership_competence", {
    p_organization_id: organization.organizationId,
    p_from_year: input.from.year,
    p_from_month: input.from.month,
    p_to_year: input.to.year,
    p_to_month: input.to.month,
    p_operation_id: input.operationId ?? undefined,
    p_overwrite: input.overwrite ?? false,
    p_dry_run: input.dryRun,
  } as never);

  if (error) return { ok: false, error: toMessage(error, "Não foi possível replicar a competência.") };

  const d = (data ?? {}) as Record<string, unknown>;
  if (!input.dryRun) revalidatePath(LEADERSHIP_PATH);

  return {
    ok: true,
    data: {
      dryRun: Boolean(d.dry_run),
      created: Number(d.created ?? 0),
      preserved: Number(d.preserved ?? 0),
      replaced: Number(d.replaced ?? 0),
    },
  };
}

/* ------------------------------------------------------------------- BRs */

export interface SaveBrInput {
  id?: string | null;
  operationCityId: string;
  code: string;
  description?: string | null;
  notes?: string | null;
  expectedUpdatedAt?: string | null;
}

export async function saveOperationBr(input: SaveBrInput): Promise<Result<{ id: string }>> {
  const { organization } = await requireOrganization("fidelization.manage_brs");
  const supabase = await createClient();

  const { data, error } = await supabase.rpc("save_operation_br", {
    p_organization_id: organization.organizationId,
    p_payload: {
      id: input.id ?? null,
      operation_city_id: input.operationCityId,
      code: input.code,
      description: input.description ?? null,
      notes: input.notes ?? null,
      expected_updated_at: input.expectedUpdatedAt ?? null,
    } as unknown as Json,
  } as never);

  if (error) return { ok: false, error: toMessage(error, "Não foi possível salvar a BR.") };

  revalidatePath(FIDELIZATION_PATH);
  return { ok: true, data: { id: data as string } };
}

export async function setOperationBrStatus(
  id: string,
  status: "active" | "inactive",
  reason: string | null,
): Promise<Result> {
  await requireOrganization("fidelization.manage_brs");
  const supabase = await createClient();

  const { error } = await supabase.rpc("set_operation_br_status", {
    p_operation_br_id: id,
    p_status: status,
    p_reason: reason ?? undefined,
  } as never);

  if (error) return { ok: false, error: toMessage(error, "Não foi possível alterar a situação da BR.") };
  revalidatePath(FIDELIZATION_PATH);
  return { ok: true };
}

export interface BrImpact {
  currentVehicles: number;
  totalVehicles: number;
  currentDrivers: number;
  currentLeaders: number;
}

/** Real counts, read from the tables. Nothing here is estimated. */
export async function loadBrImpact(id: string): Promise<Result<BrImpact>> {
  const ctx = await resolveOrganization("fidelization.view");
  if (!ctx) return { ok: false, error: SESSION_LOST };
  const supabase = await createClient();

  const { data, error } = await supabase.rpc("operation_br_impact", {
    p_operation_br_id: id,
  } as never);

  if (error) return { ok: false, error: toMessage(error, "Não foi possível calcular o impacto.") };

  const d = (data ?? {}) as Record<string, number>;
  return {
    ok: true,
    data: {
      currentVehicles: Number(d.current_vehicles ?? 0),
      totalVehicles: Number(d.total_vehicles ?? 0),
      currentDrivers: Number(d.current_drivers ?? 0),
      currentLeaders: Number(d.current_leaders ?? 0),
    },
  };
}

/* ---------------------------------------------------------- fidelização */

export interface EligibleVehicle {
  vehicleId: string;
  fleetCode: string | null;
  licensePlate: string | null;
  makeName: string | null;
  modelName: string | null;
  vehicleType: string | null;
  hasConflict: boolean;
  conflictBr: string | null;
}

/**
 * The search runs on the server (§48). Ninety-five vehicles today and growing;
 * shipping the whole fleet to the browser to filter is the difference between
 * a screen that opens and one that freezes on a supervisor's phone.
 */
export async function searchEligibleVehicles(input: {
  operationBrId: string;
  startDate: string;
  endDate?: string | null;
  search?: string | null;
  excludeAssignmentId?: string | null;
}): Promise<Result<EligibleVehicle[]>> {
  const ctx = await resolveOrganization("fidelization.view");
  if (!ctx) return { ok: false, error: SESSION_LOST };
  const supabase = await createClient();

  const { data, error } = await supabase.rpc("eligible_fidelization_vehicles", {
    p_operation_br_id: input.operationBrId,
    p_start_date: input.startDate,
    p_end_date: input.endDate ?? undefined,
    p_search: input.search ?? undefined,
    p_exclude_id: input.excludeAssignmentId ?? undefined,
    p_limit: 30,
  } as never);

  if (error) return { ok: false, error: toMessage(error, "Não foi possível buscar veículos elegíveis.") };

  return {
    ok: true,
    data: ((data ?? []) as Record<string, unknown>[]).map((row) => ({
      vehicleId: row.vehicle_id as string,
      fleetCode: (row.fleet_code as string) ?? null,
      licensePlate: (row.license_plate as string) ?? null,
      makeName: (row.make_name as string) ?? null,
      modelName: (row.model_name as string) ?? null,
      vehicleType: (row.vehicle_type as string) ?? null,
      hasConflict: Boolean(row.has_conflict),
      conflictBr: (row.conflict_br as string) ?? null,
    })),
  };
}

export interface ConflictRow {
  assignmentId: string;
  brCode: string;
  operationName: string;
  cityName: string;
  startDate: string;
  endDate: string | null;
}

/** §51: the conflict is named — vehicle, BR, operation, city, period — not merely refused. */
export async function loadVehicleConflicts(input: {
  vehicleId: string;
  startDate: string;
  endDate?: string | null;
  excludeAssignmentId?: string | null;
}): Promise<Result<ConflictRow[]>> {
  const ctx = await resolveOrganization("fidelization.view");
  if (!ctx) return { ok: false, error: SESSION_LOST };
  const supabase = await createClient();

  const { data, error } = await supabase.rpc("fidelization_conflicts", {
    p_organization_id: ctx.organization.organizationId,
    p_vehicle_id: input.vehicleId,
    p_start_date: input.startDate,
    p_end_date: input.endDate ?? undefined,
    p_exclude_id: input.excludeAssignmentId ?? undefined,
  } as never);

  if (error) return { ok: false, error: toMessage(error, "Não foi possível verificar conflitos.") };

  return {
    ok: true,
    data: ((data ?? []) as Record<string, unknown>[]).map((row) => ({
      assignmentId: row.assignment_id as string,
      brCode: (row.br_code as string) ?? "",
      operationName: (row.operation_name as string) ?? "",
      cityName: (row.city_name as string) ?? "",
      startDate: row.start_date as string,
      endDate: (row.end_date as string) ?? null,
    })),
  };
}

export interface SaveFidelizationInput {
  id?: string | null;
  operationBrId: string;
  vehicleId: string;
  vehicleRole?: "primary" | "support";
  startDate: string;
  endDate?: string | null;
  status?: "planned" | "confirmed" | "executed" | "cancelled";
  reason?: string | null;
}

export async function saveFidelization(input: SaveFidelizationInput): Promise<Result<{ id: string }>> {
  const { organization } = await requireOrganization("fidelization.plan");
  const supabase = await createClient();

  const { data, error } = await supabase.rpc("save_fidelization_assignment", {
    p_organization_id: organization.organizationId,
    p_payload: {
      id: input.id ?? null,
      operation_br_id: input.operationBrId,
      vehicle_id: input.vehicleId,
      vehicle_role: input.vehicleRole ?? "primary",
      start_date: input.startDate,
      end_date: input.endDate ?? null,
      status: input.status ?? "planned",
      reason: input.reason ?? null,
    } as unknown as Json,
  } as never);

  if (error) return { ok: false, error: toMessage(error, "Não foi possível salvar a fidelização.") };

  revalidatePath(FIDELIZATION_PATH);
  return { ok: true, data: { id: ((data ?? {}) as { id?: string }).id ?? "" } };
}

export async function endFidelization(
  id: string,
  endDate: string,
  reason: string,
): Promise<Result> {
  await requireOrganization("fidelization.change_vehicle");
  const supabase = await createClient();

  const { error } = await supabase.rpc("end_fidelization_assignment", {
    p_id: id,
    p_end_date: endDate,
    p_reason: reason,
  } as never);

  if (error) return { ok: false, error: toMessage(error, "Não foi possível encerrar a fidelização.") };
  revalidatePath(FIDELIZATION_PATH);
  return { ok: true };
}

export async function substituteFidelizationVehicle(input: {
  assignmentId: string;
  newVehicleId: string;
  effectiveFrom: string;
  reason: string;
}): Promise<Result<{ previousId: string; newId: string }>> {
  await requireOrganization("fidelization.change_vehicle");
  const supabase = await createClient();

  const { data, error } = await supabase.rpc("substitute_fidelization_vehicle", {
    p_assignment_id: input.assignmentId,
    p_new_vehicle_id: input.newVehicleId,
    p_effective_from: input.effectiveFrom,
    p_reason: input.reason,
  } as never);

  if (error) return { ok: false, error: toMessage(error, "Não foi possível substituir o veículo.") };

  const d = (data ?? {}) as { previous_id?: string; new_id?: string };
  revalidatePath(FIDELIZATION_PATH);
  return { ok: true, data: { previousId: d.previous_id ?? "", newId: d.new_id ?? "" } };
}

/** §50: one call, one transaction. Never two independent substitutions. */
export async function invertFidelizationVehicles(input: {
  assignmentA: string;
  assignmentB: string;
  effectiveFrom: string;
  reason: string;
}): Promise<Result<{ created: string[] }>> {
  await requireOrganization("fidelization.change_vehicle");
  const supabase = await createClient();

  const { data, error } = await supabase.rpc("invert_fidelization_vehicles", {
    p_assignment_a: input.assignmentA,
    p_assignment_b: input.assignmentB,
    p_effective_from: input.effectiveFrom,
    p_reason: input.reason,
  } as never);

  if (error) return { ok: false, error: toMessage(error, "Não foi possível inverter os veículos.") };

  const d = (data ?? {}) as { created?: string[] };
  revalidatePath(FIDELIZATION_PATH);
  return { ok: true, data: { created: d.created ?? [] } };
}

/* ------------------------------------------------------------- motoristas */

export async function saveFidelizationDriver(input: {
  id?: string | null;
  fidelizationAssignmentId: string;
  employeeId: string;
  driverRole?: "primary" | "secondary";
  startDate?: string | null;
  endDate?: string | null;
}): Promise<Result<{ id: string }>> {
  const { organization } = await requireOrganization("fidelization.change_driver");
  const supabase = await createClient();

  const { data, error } = await supabase.rpc("save_fidelization_driver", {
    p_organization_id: organization.organizationId,
    p_payload: {
      id: input.id ?? null,
      fidelization_assignment_id: input.fidelizationAssignmentId,
      employee_id: input.employeeId,
      driver_role: input.driverRole ?? "primary",
      start_date: input.startDate ?? null,
      end_date: input.endDate ?? null,
    } as unknown as Json,
  } as never);

  if (error) return { ok: false, error: toMessage(error, "Não foi possível salvar o motorista.") };

  revalidatePath(FIDELIZATION_PATH);
  return { ok: true, data: { id: data as string } };
}

export async function endFidelizationDriver(
  id: string,
  endDate: string,
  reason: string,
): Promise<Result> {
  await requireOrganization("fidelization.change_driver");
  const supabase = await createClient();

  const { error } = await supabase.rpc("end_fidelization_driver", {
    p_id: id,
    p_end_date: endDate,
    p_reason: reason,
  } as never);

  if (error) return { ok: false, error: toMessage(error, "Não foi possível encerrar o vínculo do motorista.") };
  revalidatePath(FIDELIZATION_PATH);
  return { ok: true };
}

/* ----------------------------------------------------------- seletores */

export interface EmployeeOption {
  id: string;
  name: string;
  code: string | null;
  operationName: string | null;
}

/**
 * §18: the picker reads the master employee registry and searches by name,
 * matrícula or current operation. It never accepts a typed name as an
 * identifier — the form sends back the id it got from here.
 */
export async function searchEmployees(term: string): Promise<Result<EmployeeOption[]>> {
  const ctx = await resolveOrganization("leadership.view");
  if (!ctx) return { ok: false, error: SESSION_LOST };
  const supabase = await createClient();

  const clean = term.trim().replace(/[,()%]/g, " ").trim();
  // The view keeps a normalised `search_name`; normalising the term the same
  // way is what makes "jose" find "José" without asking anyone to type accents.
  const normalised = clean
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

  let query = supabase
    .from("employee_directory")
    .select("id, full_name, employee_code, operation_name")
    .eq("organization_id", ctx.organization.organizationId)
    .is("deleted_at", null)
    .limit(20);

  if (clean) {
    query = query.or(
      `search_name.ilike.%${normalised}%,employee_code.ilike.%${clean}%,operation_name.ilike.%${clean}%`,
    );
  }

  const { data, error } = await query.order("full_name");
  if (error) return { ok: false, error: "Não foi possível buscar colaboradores." };

  return {
    ok: true,
    data: (data ?? []).map((row) => ({
      id: row.id as string,
      name: (row.full_name as string) ?? "—",
      code: (row.employee_code as string) ?? null,
      operationName: (row.operation_name as string) ?? null,
    })),
  };
}

export interface AssignmentDriver {
  id: string;
  employeeId: string;
  employeeName: string;
  employeeCode: string | null;
  driverRole: "primary" | "secondary";
  startDate: string;
  endDate: string | null;
  status: string;
}

/**
 * The drivers planned for one vínculo.
 *
 * Loaded when the drawer opens rather than with the calendar: the matrix shows
 * vehicles, and fetching every position's drivers to render a month nobody has
 * expanded yet is work thrown away.
 */
export async function loadFidelizationDrivers(
  assignmentId: string,
): Promise<Result<AssignmentDriver[]>> {
  const ctx = await resolveOrganization("fidelization.view");
  if (!ctx) return { ok: false, error: SESSION_LOST };
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("fidelization_drivers")
    .select("id, employee_id, driver_role, start_date, end_date, status, employees(full_name, employee_code)")
    .eq("fidelization_assignment_id", assignmentId)
    .order("driver_role")
    .order("start_date");

  if (error) return { ok: false, error: "Não foi possível carregar os motoristas." };

  return {
    ok: true,
    data: (data ?? []).map((row) => {
      const employee = row.employees as { full_name?: string; employee_code?: string } | null;
      return {
        id: row.id as string,
        employeeId: row.employee_id as string,
        employeeName: employee?.full_name ?? "—",
        employeeCode: employee?.employee_code ?? null,
        driverRole: row.driver_role === "secondary" ? "secondary" : "primary",
        startDate: row.start_date as string,
        endDate: (row.end_date as string) ?? null,
        status: (row.status as string) ?? "planned",
      };
    }),
  };
}
