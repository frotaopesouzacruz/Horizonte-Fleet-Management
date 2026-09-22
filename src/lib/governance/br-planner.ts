import "server-only";

import { createClient } from "@/lib/supabase/server";
import type { Competence } from "./competence";

/**
 * Planner de Locais e BRs (Etapa 13).
 *
 * O BR é a posição operacional permanente; a placa e o motorista são recursos
 * que passam por ela. Nada aqui inventa entidade: a fonte do BR é
 * `operation_brs` (Etapa 08), a do vínculo é `fidelization_assignments`, e a da
 * liderança é `leadership_assignments` — resolvida no banco pela precedência da
 * §43 (exceção do BR, depois cidade, depois operação).
 *
 * Toda linha vem resolvida do servidor em uma consulta só. Abrir 88 BRs e
 * perguntar veículo, motorista e liderança por linha seriam 264 idas ao banco
 * por tela, que é exatamente o N+1 que a §67 proíbe.
 */

export interface BrPlannerRow {
  id: string;
  code: string;
  description: string | null;
  status: "active" | "inactive";
  operationId: string;
  operationName: string;
  stateId: number;
  stateUf: string;
  cityId: number;
  cityName: string;
  operationCityId: string;
  /** Liderança vigente na data-âncora da competência. */
  leaderEmployeeId: string | null;
  leaderName: string | null;
  /** De onde veio a liderança: exceção do próprio BR, da cidade ou da operação. */
  leaderScope: "br" | "city" | "operation" | null;
  vehicleId: string | null;
  fleetCode: string | null;
  licensePlate: string | null;
  assignmentId: string | null;
  assignmentStart: string | null;
  assignmentEnd: string | null;
  driverEmployeeId: string | null;
  driverName: string | null;
  /** A data que representa a competência — hoje, fim do mês ou início dele. */
  anchorDate: string;
}

export interface BrPlannerFilters {
  q?: string;
  operationId?: string;
  stateId?: string;
  cityId?: string;
  status?: string;
  leaderEmployeeId?: string;
  /** 'with' | 'without' */
  vehicle?: string;
  /** 'with' | 'without' */
  driver?: string;
  /** 'with' | 'without' — BR com substituição/inversão de veículo iniciada na competência (§22). */
  swapped?: string;
}

export const brPlannerPayload = (filters: BrPlannerFilters): Record<string, string> => {
  const out: Record<string, string> = {};
  if (filters.q) out.q = filters.q.trim();
  if (filters.operationId) out.operation_id = filters.operationId;
  if (filters.stateId) out.state_id = filters.stateId;
  if (filters.cityId) out.city_id = filters.cityId;
  if (filters.status) out.status = filters.status;
  if (filters.leaderEmployeeId) out.leader_employee_id = filters.leaderEmployeeId;
  if (filters.vehicle) out.vehicle = filters.vehicle;
  if (filters.driver) out.driver = filters.driver;
  if (filters.swapped) out.swapped = filters.swapped;
  return out;
};

/** Uma linha do planner, lida do formato do banco. Compartilhada com o diretório do módulo BRs. */
export function mapBrPlannerRow(row: unknown): BrPlannerRow {
  const r = row as Record<string, unknown>;
  const scope = r.leader_scope as string | null;
  return {
    id: String(r.id),
    code: String(r.code),
    description: (r.description as string) ?? null,
    status: r.status === "inactive" ? "inactive" : "active",
    operationId: String(r.operation_id),
    operationName: (r.operation_name as string) ?? "—",
    stateId: Number(r.state_id),
    stateUf: ((r.state_uf as string) ?? "").trim(),
    cityId: Number(r.city_id),
    cityName: (r.city_name as string) ?? "",
    operationCityId: String(r.operation_city_id),
    leaderEmployeeId: (r.leader_employee_id as string) ?? null,
    leaderName: (r.leader_name as string) ?? null,
    leaderScope:
      scope === "br" || scope === "city" || scope === "operation" ? scope : null,
    vehicleId: (r.vehicle_id as string) ?? null,
    fleetCode: (r.fleet_code as string) ?? null,
    licensePlate: (r.license_plate as string) ?? null,
    assignmentId: (r.assignment_id as string) ?? null,
    assignmentStart: (r.assignment_start as string) ?? null,
    assignmentEnd: (r.assignment_end as string) ?? null,
    driverEmployeeId: (r.driver_employee_id as string) ?? null,
    driverName: (r.driver_name as string) ?? null,
    anchorDate: String(r.anchor_date),
  };
}

export async function listBrPlannerRows(
  organizationId: string,
  competence: Competence,
  filters: BrPlannerFilters = {},
): Promise<BrPlannerRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("br_planner_rows", {
    p_organization_id: organizationId,
    p_year: competence.year,
    p_month: competence.month,
    p_filters: brPlannerPayload(filters),
  });

  if (error) throw new Error(error.message);

  return (data ?? []).map(mapBrPlannerRow);
}

export interface BrPlannerIndicators {
  competence: string;
  anchorDate: string;
  /** Cadastrais: existem, independentemente da competência. */
  total: number;
  active: number;
  inactive: number;
  /** Da competência: o que está ocupado. */
  withVehicle: number;
  withoutVehicle: number;
  withVehicleInPeriod: number;
  withDriver: number;
  withoutDriver: number;
  /** Liderança resolvida na data-âncora (exceção do BR → cidade → operação). */
  withLeader: number;
  /** Só BRs ativas: uma inativa sem liderança não é pendência. */
  withoutLeader: number;
  /** BRs com substituição ou inversão de veículo iniciada no mês — cada BR conta uma vez. */
  withVehicleSwapInPeriod: number;
  byOperation: { operationId: string; operationName: string; total: number }[];
  byCity: { cityId: number; cityName: string; stateUf: string; total: number }[];
  byLeader: { employeeId: string; leaderName: string; total: number }[];
}

export async function getBrPlannerIndicators(
  organizationId: string,
  competence: Competence,
  filters: BrPlannerFilters = {},
): Promise<BrPlannerIndicators> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("br_planner_indicators", {
    p_organization_id: organizationId,
    p_year: competence.year,
    p_month: competence.month,
    p_filters: brPlannerPayload(filters),
  });
  if (error) throw new Error(error.message);

  const raw = (data ?? {}) as Record<string, unknown>;
  const num = (key: string) => Number(raw[key] ?? 0);
  const list = (key: string) => (Array.isArray(raw[key]) ? (raw[key] as unknown[]) : []);

  return {
    competence: String(raw.competence ?? ""),
    anchorDate: String(raw.anchor_date ?? ""),
    total: num("total"),
    active: num("active"),
    inactive: num("inactive"),
    withVehicle: num("with_vehicle"),
    withoutVehicle: num("without_vehicle"),
    withVehicleInPeriod: num("with_vehicle_in_period"),
    withDriver: num("with_driver"),
    withoutDriver: num("without_driver"),
    withLeader: num("with_leader"),
    withoutLeader: num("without_leader"),
    withVehicleSwapInPeriod: num("with_vehicle_swap_in_period"),
    byOperation: list("by_operation").map((entry) => {
      const e = entry as Record<string, unknown>;
      return {
        operationId: String(e.operation_id),
        operationName: String(e.operation_name ?? "—"),
        total: Number(e.total ?? 0),
      };
    }),
    byCity: list("by_city").map((entry) => {
      const e = entry as Record<string, unknown>;
      return {
        cityId: Number(e.city_id),
        cityName: String(e.city_name ?? ""),
        stateUf: String(e.state_uf ?? "").trim(),
        total: Number(e.total ?? 0),
      };
    }),
    byLeader: list("by_leader").map((entry) => {
      const e = entry as Record<string, unknown>;
      return {
        employeeId: String(e.employee_id),
        leaderName: String(e.leader_name ?? "—"),
        total: Number(e.total ?? 0),
      };
    }),
  };
}

export interface BrVehicleHistoryRow {
  assignmentId: string;
  vehicleId: string;
  fleetCode: string | null;
  licensePlate: string | null;
  vehicleRole: "primary" | "support";
  startDate: string;
  endDate: string | null;
  status: "planned" | "confirmed" | "executed" | "cancelled";
  source: "manual" | "import" | "substitution" | "inversion" | "replication";
  reason: string | null;
  endReason: string | null;
  replacesAssignmentId: string | null;
  createdAt: string;
}

/**
 * §34: todo veículo que já passou por esta posição, com vigência e motivo. É o
 * que responde "qual placa estava neste BR em tal data" sem reclassificar nada.
 */
export async function getBrVehicleHistory(
  operationBrId: string,
): Promise<BrVehicleHistoryRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("br_vehicle_history", {
    p_operation_br_id: operationBrId,
  });
  if (error) throw new Error(error.message);

  return (data ?? []).map((row): BrVehicleHistoryRow => {
    const r = row as Record<string, unknown>;
    return {
      assignmentId: String(r.assignment_id),
      vehicleId: String(r.vehicle_id),
      fleetCode: (r.fleet_code as string) ?? null,
      licensePlate: (r.license_plate as string) ?? null,
      vehicleRole: r.vehicle_role === "support" ? "support" : "primary",
      startDate: String(r.start_date),
      endDate: (r.end_date as string) ?? null,
      status: r.status as BrVehicleHistoryRow["status"],
      source: r.source as BrVehicleHistoryRow["source"],
      reason: (r.reason as string) ?? null,
      endReason: (r.end_reason as string) ?? null,
      replacesAssignmentId: (r.replaces_assignment_id as string) ?? null,
      createdAt: String(r.created_at),
    };
  });
}

/**
 * As lideranças que o filtro do planner oferece (§25).
 *
 * Vem da fonte, não das linhas exibidas: derivar do resultado filtrado faria a
 * lista encolher para a própria escolha — escolhido um líder, não haveria como
 * trocar para outro sem limpar o filtro antes.
 */
export async function listLeadershipOptions(
  organizationId: string,
): Promise<{ id: string; name: string }[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("leadership_assignments")
    .select("employee_id, employees(full_name)")
    .eq("organization_id", organizationId)
    .eq("status", "active")
    .eq("responsibility_type", "principal");

  if (error) throw new Error(error.message);

  const seen = new Map<string, string>();
  for (const row of data ?? []) {
    const employee = row.employees as { full_name?: string } | null;
    const id = row.employee_id as string;
    if (id && !seen.has(id)) seen.set(id, employee?.full_name ?? "—");
  }

  return [...seen.entries()]
    .map(([id, name]) => ({ id, name }))
    .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
}
