"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { hasPermission, requireOrganization, resolveOrganization } from "@/lib/auth/session";
import type { Json } from "@/types/database.types";
import { normalizeDocument } from "./format";

/**
 * Branch mutations.
 *
 * `saveBranch` sends the branch and its operation links in one payload to one
 * routine, which applies them in one transaction (§56). The links are updated
 * by difference, never deleted and recreated (§57) — recreating them would
 * destroy every vigência and make each branch look as though it had been linked
 * to all of its operations on the day of the last edit.
 */

const MODULE_PATH = "/estrutura/filiais";

const SESSION_LOST =
  "Sua sessão expirou ou o acesso mudou. Recarregue a página e tente de novo.";

export interface Result<T = undefined> {
  ok: boolean;
  error?: string;
  data?: T;
}

function toMessage(error: { message?: string; code?: string } | null, fallback: string): string {
  const message = error?.message ?? "";
  if (!message) return fallback;

  if (error?.code === "23505") {
    if (message.includes("organization_units_code_key")) {
      return "Já existe uma filial com este código interno nesta organização.";
    }
    if (message.includes("organization_units_document_key")) {
      return "Já existe uma filial com este CNPJ nesta organização.";
    }
    return "Já existe um registro com estes dados.";
  }
  if (error?.code === "23514") {
    if (message.includes("document")) return "O CNPJ informado é inválido.";
    if (message.includes("postal_code")) return "O CEP deve ter 8 dígitos.";
    if (message.includes("code_check")) {
      return "O código interno aceita letras, números, ponto, hífen e sublinhado, começando por letra ou número.";
    }
    return "Um dos valores informados não é aceito.";
  }
  if (error?.code === "23P01") {
    return "O período informado conflita com um vínculo existente.";
  }
  if (error?.code === "40001") return message;
  if (error?.code === "23503") {
    return "Um dos vínculos informados não existe ou não pertence a esta organização.";
  }
  if (error?.code === "42501" || message.includes("insufficient_privilege")) {
    return /^(Você|Este|Esta|A |O )/.test(message) ? message : "Você não possui permissão para esta ação.";
  }
  if (/^[A-ZÀ-Ú]/.test(message) && !message.includes("violates") && !message.includes("relation")) {
    return message;
  }
  return fallback;
}

export interface SaveBranchInput {
  id?: string | null;
  code: string;
  name: string;
  legalName?: string | null;
  documentNumber?: string | null;
  status?: "active" | "inactive";
  notes?: string | null;

  postalCode?: string | null;
  street?: string | null;
  streetNumber?: string | null;
  complement?: string | null;
  district?: string | null;
  stateId?: number | null;
  cityId?: number | null;

  /** Omit to leave the links alone; an empty array means "unlink everything". */
  operations?: string[] | null;
  expectedUpdatedAt?: string | null;
}

export async function saveBranch(input: SaveBranchInput): Promise<Result<{ id: string }>> {
  const { organization } = await requireOrganization(
    input.id ? "branches.update" : "branches.create",
  );
  const supabase = await createClient();

  const payload: Record<string, unknown> = {
    id: input.id ?? null,
    code: input.code,
    name: input.name,
    legal_name: input.legalName ?? null,
    document_number: normalizeDocument(input.documentNumber),
    notes: input.notes ?? null,
    postal_code: normalizeDocument(input.postalCode),
    street: input.street ?? null,
    street_number: input.streetNumber ?? null,
    complement: input.complement ?? null,
    district: input.district ?? null,
    state_id: input.stateId ?? null,
    city_id: input.cityId ?? null,
    expected_updated_at: input.expectedUpdatedAt ?? null,
  };
  if (input.status) payload.status = input.status;
  // Present as an array or absent — never null. The routine tests the JSON type,
  // and a null would mean "do not touch the links", which is a different order
  // from "unlink everything".
  if (Array.isArray(input.operations)) payload.operations = input.operations;

  const { data, error } = await supabase.rpc("save_branch", {
    p_organization_id: organization.organizationId,
    p_payload: payload as unknown as Json,
  });

  if (error) return { ok: false, error: toMessage(error, "Não foi possível salvar a filial.") };

  revalidatePath(MODULE_PATH);
  return { ok: true, data: { id: data as string } };
}

export async function setBranchStatus(
  id: string,
  status: "active" | "inactive",
  reason: string | null,
): Promise<Result> {
  await requireOrganization("branches.deactivate");
  const supabase = await createClient();

  const { error } = await supabase.rpc("set_branch_status", {
    p_organization_unit_id: id,
    p_status: status,
    p_reason: reason ?? undefined,
  });

  if (error) return { ok: false, error: toMessage(error, "Não foi possível alterar a situação da filial.") };
  revalidatePath(MODULE_PATH);
  return { ok: true };
}

export interface BranchImpact {
  activeEmployees: number;
  totalEmployees: number;
  activeVehicles: number;
  totalVehicles: number;
  currentOperations: number;
  historicalOperations: number;
  costCenters: number;
  workLocations: number;
}

/** §51: real counts, read from the tables. Nothing here is estimated. */
export async function loadBranchImpact(id: string): Promise<Result<BranchImpact>> {
  const ctx = await resolveOrganization("branches.view");
  if (!ctx) return { ok: false, error: SESSION_LOST };
  const supabase = await createClient();

  const { data, error } = await supabase.rpc("branch_impact", { p_organization_unit_id: id });
  if (error) return { ok: false, error: toMessage(error, "Não foi possível calcular as dependências.") };

  const d = (data ?? {}) as Record<string, number>;
  return {
    ok: true,
    data: {
      activeEmployees: Number(d.active_employees ?? 0),
      totalEmployees: Number(d.total_employees ?? 0),
      activeVehicles: Number(d.active_vehicles ?? 0),
      totalVehicles: Number(d.total_vehicles ?? 0),
      currentOperations: Number(d.current_operations ?? 0),
      historicalOperations: Number(d.historical_operations ?? 0),
      costCenters: Number(d.cost_centers ?? 0),
      workLocations: Number(d.work_locations ?? 0),
    },
  };
}

/** §26: who depends on this branch × operation combination, before unlinking. */
export async function loadBranchOperationImpact(
  branchId: string,
  operationId: string,
): Promise<Result<{ employees: number; vehicles: number }>> {
  const ctx = await resolveOrganization("branches.view");
  if (!ctx) return { ok: false, error: SESSION_LOST };
  const supabase = await createClient();

  const { data, error } = await supabase.rpc("branch_operation_impact", {
    p_organization_unit_id: branchId,
    p_operation_id: operationId,
  });

  if (error) return { ok: false, error: toMessage(error, "Não foi possível calcular o impacto.") };
  const d = (data ?? {}) as Record<string, number>;
  return { ok: true, data: { employees: Number(d.employees ?? 0), vehicles: Number(d.vehicles ?? 0) } };
}

/* -------------------------------------------------------------- abas */

export interface BranchEmployeeRow {
  employeeId: string;
  fullName: string;
  employeeCode: string | null;
  jobPosition: string | null;
  operationName: string | null;
  cityName: string | null;
  leaderName: string | null;
  status: string;
}

export async function loadBranchEmployees(id: string): Promise<Result<BranchEmployeeRow[]>> {
  const ctx = await resolveOrganization("branches.view_employees");
  if (!ctx) return { ok: false, error: SESSION_LOST };
  const supabase = await createClient();

  const { data, error } = await supabase.rpc("branch_employees", {
    p_organization_unit_id: id,
    p_limit: 200,
  });

  if (error) return { ok: false, error: toMessage(error, "Não foi possível carregar os colaboradores.") };

  return {
    ok: true,
    data: ((data ?? []) as Record<string, unknown>[]).map((row) => ({
      employeeId: row.employee_id as string,
      fullName: (row.full_name as string) ?? "—",
      employeeCode: (row.employee_code as string) ?? null,
      jobPosition: (row.job_position as string) ?? null,
      operationName: (row.operation_name as string) ?? null,
      cityName: (row.city_name as string) ?? null,
      leaderName: (row.leader_name as string) ?? null,
      status: (row.status as string) ?? "active",
    })),
  };
}

export interface BranchVehicleRow {
  vehicleId: string;
  fleetCode: string | null;
  licensePlate: string | null;
  vehicleType: string | null;
  operationName: string | null;
  cityName: string | null;
  status: string;
}

export async function loadBranchVehicles(id: string): Promise<Result<BranchVehicleRow[]>> {
  const ctx = await resolveOrganization("branches.view_vehicles");
  if (!ctx) return { ok: false, error: SESSION_LOST };
  const supabase = await createClient();

  const { data, error } = await supabase.rpc("branch_vehicles", {
    p_organization_unit_id: id,
    p_limit: 200,
  });

  if (error) return { ok: false, error: toMessage(error, "Não foi possível carregar a frota.") };

  return {
    ok: true,
    data: ((data ?? []) as Record<string, unknown>[]).map((row) => ({
      vehicleId: row.vehicle_id as string,
      fleetCode: (row.fleet_code as string) ?? null,
      licensePlate: (row.license_plate as string) ?? null,
      vehicleType: (row.vehicle_type as string) ?? null,
      operationName: (row.operation_name as string) ?? null,
      cityName: (row.city_name as string) ?? null,
      status: (row.status as string) ?? "active",
    })),
  };
}

export interface BranchAuditRow {
  id: string;
  entityType: string;
  action: string;
  changedFields: string[];
  actorName: string | null;
  createdAt: string;
}

export async function loadBranchAudit(id: string): Promise<Result<BranchAuditRow[]>> {
  const ctx = await resolveOrganization("branches.view_audit");
  if (!ctx) return { ok: false, error: SESSION_LOST };
  const supabase = await createClient();

  const { data, error } = await supabase.rpc("branch_audit_trail", {
    p_organization_unit_id: id,
    p_limit: 100,
  });

  if (error) return { ok: false, error: toMessage(error, "Não foi possível carregar o histórico.") };

  return {
    ok: true,
    data: ((data ?? []) as Record<string, unknown>[]).map((row) => ({
      id: row.id as string,
      entityType: (row.entity_type as string) ?? "",
      action: (row.action as string) ?? "",
      changedFields: (row.changed_fields as string[]) ?? [],
      actorName: (row.actor_name as string) ?? null,
      createdAt: row.created_at as string,
    })),
  };
}

/* ------------------------------------------------------- centros de custo */

export interface BranchCostCenterRow {
  id: string;
  code: string | null;
  name: string;
  status: string;
  organizationUnitId: string | null;
  branchCode: string | null;
  branchName: string | null;
}

/**
 * §38: os centros de custo da organização, com a filial a que cada um está
 * associado. Lê `branch_cost_center_directory` (security_invoker) com o
 * cliente de quem pediu — sem `cost_centers.view`, a RLS não devolveria nada, e
 * uma lista vazia diria "não há centros" quando a verdade é "você não os vê".
 */
export async function loadBranchCostCenters(): Promise<Result<BranchCostCenterRow[]>> {
  const ctx = await resolveOrganization("branches.view");
  if (!ctx) return { ok: false, error: SESSION_LOST };
  if (!hasPermission(ctx.session, "cost_centers.view")) {
    return { ok: false, error: "Você não possui permissão para ver centros de custo." };
  }
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("branch_cost_center_directory")
    .select("id, code, name, status, organization_unit_id, branch_code, branch_name")
    .eq("organization_id", ctx.organization.organizationId)
    .order("name");

  if (error) return { ok: false, error: toMessage(error, "Não foi possível carregar os centros de custo.") };

  return {
    ok: true,
    data: (data ?? []).map((row) => ({
      id: row.id as string,
      code: (row.code as string) ?? null,
      name: (row.name as string) ?? "—",
      status: (row.status as string) ?? "active",
      organizationUnitId: (row.organization_unit_id as string) ?? null,
      branchCode: (row.branch_code as string) ?? null,
      branchName: (row.branch_name as string) ?? null,
    })),
  };
}

/**
 * Associa ou desassocia um centro de custo EXISTENTE. A rotina confere a
 * organização dos dois lados, exige `branches.update` e `cost_centers.manage`
 * e recusa roubar um centro que já responde por outra filial.
 */
export async function setBranchCostCenter(
  branchId: string,
  costCenterId: string,
  linked: boolean,
): Promise<Result> {
  const ctx = await resolveOrganization("branches.update");
  if (!ctx) return { ok: false, error: SESSION_LOST };
  if (!hasPermission(ctx.session, "cost_centers.manage")) {
    return { ok: false, error: "Você não possui permissão para associar centros de custo à filial." };
  }
  const supabase = await createClient();

  const { error } = await supabase.rpc("set_branch_cost_center", {
    p_organization_unit_id: branchId,
    p_cost_center_id: costCenterId,
    p_linked: linked,
  });

  if (error) {
    return {
      ok: false,
      error: toMessage(
        error,
        linked ? "Não foi possível associar o centro de custo." : "Não foi possível desassociar o centro de custo.",
      ),
    };
  }
  revalidatePath(MODULE_PATH);
  return { ok: true };
}

/* -------------------------------------------------- transferência de frota */

/**
 * §34: a real transfer of responsibility between branches, with the previous
 * branch, the new one, the start, the end of the previous link, the reason and
 * — through the audit trail — who did it.
 *
 * `effectiveFrom` may be today or a past date; the RPC refuses a future one.
 * Scheduling was on the table and is not honest yet: every read path resolves a
 * vehicle's branch from `vehicles.organization_unit_id`, and nothing promotes a
 * future assignment into it, so a scheduled transfer would simply never happen.
 */
export async function transferVehicleBranch(input: {
  vehicleId: string;
  organizationUnitId: string;
  effectiveFrom: string;
  reason: string;
}): Promise<Result<void>> {
  await requireOrganization("branches.update");
  const supabase = await createClient();

  const { error } = await supabase.rpc("transfer_vehicle_branch", {
    p_vehicle_id: input.vehicleId,
    p_organization_unit_id: input.organizationUnitId,
    p_effective_from: input.effectiveFrom,
    p_reason: input.reason,
  });

  if (error) return { ok: false, error: toMessage(error, "Não foi possível transferir o veículo.") };

  revalidatePath(MODULE_PATH);
  revalidatePath("/frota/cadastro");
  return { ok: true, data: undefined };
}
