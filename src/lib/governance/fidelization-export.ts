import "server-only";

import { createClient } from "@/lib/supabase/server";
import { fetchAll } from "@/lib/supabase/fetch-all";
import { listBrPlannerRows } from "./br-planner";
import type { Competence } from "./competence";
import { today } from "./fidelization-export-period";

export { clipPeriod, eachDay } from "./fidelization-export-period";

/**
 * Base completa dos Planners para exportação (Central de Fidelização).
 *
 * Duas bases — veículos (Planner de frotas) e motoristas (Planner de
 * motoristas) — com os mesmos filtros: período, placa/frota, BR, operação e
 * local (UF e cidade). As leituras são as mesmas consultas `security invoker`
 * da página: o arquivo só traz o que quem exporta já enxerga. Sem teto de
 * linhas: tudo é lido página a página.
 *
 * Um vínculo entra quando o seu período toca o intervalo pedido; "no período"
 * é o pedaço do vínculo dentro do intervalo. Sem intervalo, entra a base
 * inteira e o "no período" vai do início ao fim do vínculo (ou até hoje).
 */

export interface PlannerExportFilters {
  dateFrom?: string;
  dateTo?: string;
  /** Placa ou código de frota, em qualquer caixa e com ou sem hífen. */
  plate?: string;
  /** Código da BR (exato, sem diferenciar caixa). */
  brCode?: string;
  operationId?: string;
  stateId?: string;
  cityId?: string;
}

export interface FleetBaseRow {
  operationName: string;
  stateUf: string;
  cityName: string;
  brId: string;
  brCode: string;
  leaderName: string | null;
  fleetCode: string | null;
  licensePlate: string | null;
  vehicleTypeName: string | null;
  vehicleModel: string;
  vehicleRole: "primary" | "support";
  startDate: string;
  endDate: string | null;
  status: string;
  source: string;
  /** Quem gravou; nulo = rotina do sistema (replicação automática). */
  createdBy: string | null;
  isSubstitution: boolean;
  reason: string | null;
  endReason: string | null;
}

export interface DriverBaseRow {
  operationName: string;
  stateUf: string;
  cityName: string;
  brId: string;
  brCode: string;
  leaderName: string | null;
  employeeCode: string | null;
  employeeName: string;
  driverRole: "primary" | "secondary";
  fleetCode: string | null;
  licensePlate: string | null;
  startDate: string;
  endDate: string | null;
  status: string;
  reason: string | null;
  endReason: string | null;
}

const onlyAlnum = (value: string | null | undefined) => (value ?? "").replace(/[^0-9a-z]/gi, "").toUpperCase();

function matchesPlate(filter: string | undefined, plate: string | null, fleet: string | null): boolean {
  const wanted = onlyAlnum(filter);
  if (!wanted) return true;
  return onlyAlnum(plate).includes(wanted) || onlyAlnum(fleet).includes(wanted);
}

/** A competência da data (para resolver a liderança vigente no fim do período). */
function competenceOf(date: string | undefined): Competence {
  const [y, m] = (date ?? today()).split("-").map(Number);
  return { year: y, month: m };
}

async function leaderByBr(organizationId: string, filters: PlannerExportFilters): Promise<Map<string, string | null>> {
  const rows = await listBrPlannerRows(organizationId, competenceOf(filters.dateTo), {
    operationId: filters.operationId,
    stateId: filters.stateId,
    cityId: filters.cityId,
  });
  return new Map(rows.map((r) => [r.id, r.leaderName]));
}

export async function listFleetBase(organizationId: string, filters: PlannerExportFilters): Promise<FleetBaseRow[]> {
  const supabase = await createClient();
  const build = () => {
    let query = supabase.from("fidelization_directory").select("*").eq("organization_id", organizationId);
    if (filters.dateTo) query = query.lte("start_date", filters.dateTo);
    if (filters.dateFrom) query = query.or(`end_date.is.null,end_date.gte.${filters.dateFrom}`);
    if (filters.operationId) query = query.eq("operation_id", filters.operationId);
    if (filters.stateId) query = query.eq("state_id", Number(filters.stateId));
    if (filters.cityId) query = query.eq("city_id", Number(filters.cityId));
    if (filters.brCode) query = query.ilike("br_code", filters.brCode.trim());
    return query;
  };
  const [data, leaders] = await Promise.all([
    fetchAll((from, to) =>
      build().order("operation_name").order("br_code").order("start_date").order("id").range(from, to),
    ),
    leaderByBr(organizationId, filters),
  ]);

  return data
    .filter((row) => matchesPlate(filters.plate, row.license_plate as string | null, row.fleet_code as string | null))
    .map((row): FleetBaseRow => ({
      operationName: (row.operation_name as string) ?? "",
      stateUf: (row.state_uf as string) ?? "",
      cityName: (row.city_name as string) ?? "",
      brId: row.operation_br_id as string,
      brCode: (row.br_code as string) ?? "",
      leaderName: leaders.get(row.operation_br_id as string) ?? null,
      fleetCode: (row.fleet_code as string) ?? null,
      licensePlate: (row.license_plate as string) ?? null,
      vehicleTypeName: (row.vehicle_type_name as string) ?? null,
      vehicleModel: [row.vehicle_make_name, row.vehicle_model_name].filter(Boolean).join(" "),
      vehicleRole: row.vehicle_role === "support" ? "support" : "primary",
      startDate: row.start_date as string,
      endDate: (row.end_date as string) ?? null,
      status: (row.status as string) ?? "",
      source: (row.source as string) ?? "",
      createdBy: (row.created_by as string) ?? null,
      isSubstitution: Boolean(row.replaces_assignment_id),
      reason: (row.reason as string) ?? null,
      endReason: (row.end_reason as string) ?? null,
    }));
}

type DriverNested = {
  operation_br_id: string;
  vehicles: { fleet_code?: string; license_plate?: string } | null;
  operation_brs: {
    code?: string;
    operation_id?: string;
    city_id?: number;
    state_id?: number;
    operation_cities?: { cities?: { name?: string; states?: { uf?: string } | null } | null } | null;
  } | null;
};

export async function listDriverBase(organizationId: string, filters: PlannerExportFilters): Promise<DriverBaseRow[]> {
  const supabase = await createClient();
  const build = () => {
    let query = supabase
      .from("fidelization_drivers")
      .select(
        `id, employee_id, driver_role, start_date, end_date, status, reason, end_reason,
         employees!fidelization_drivers_employee_fkey(full_name, employee_code),
         fidelization_assignments!fidelization_drivers_assignment_fkey!inner(
           operation_br_id,
           vehicles!fidelization_vehicle_fkey(fleet_code, license_plate),
           operation_brs!fidelization_br_fkey!inner(code, operation_id, city_id, state_id,
             operation_cities!operation_brs_coverage_fkey(
               cities!operation_cities_city_fk(name, states!cities_state_id_fkey(uf))))
         )`,
      )
      .eq("organization_id", organizationId);
    if (filters.dateTo) query = query.lte("start_date", filters.dateTo);
    if (filters.dateFrom) query = query.or(`end_date.is.null,end_date.gte.${filters.dateFrom}`);
    return query;
  };
  const [data, operations, leaders] = await Promise.all([
    fetchAll((from, to) => build().order("start_date").order("id").range(from, to)),
    supabase.from("operations").select("id, name").eq("organization_id", organizationId),
    leaderByBr(organizationId, filters),
  ]);
  const operationName = new Map((operations.data ?? []).map((o) => [o.id as string, o.name as string]));
  const brCode = filters.brCode?.trim().toUpperCase();

  const rows: DriverBaseRow[] = [];
  for (const row of data) {
    const assignment = row.fidelization_assignments as unknown as DriverNested | null;
    const br = assignment?.operation_brs ?? null;
    // Os filtros que o PostgREST não expressa sobre o embed são aplicados aqui,
    // sobre um resultado já recortado pela RLS e pelo período.
    if (filters.operationId && br?.operation_id !== filters.operationId) continue;
    if (filters.stateId && br?.state_id !== Number(filters.stateId)) continue;
    if (filters.cityId && br?.city_id !== Number(filters.cityId)) continue;
    if (brCode && (br?.code ?? "").toUpperCase() !== brCode) continue;
    if (!matchesPlate(filters.plate, assignment?.vehicles?.license_plate ?? null, assignment?.vehicles?.fleet_code ?? null)) continue;
    const employee = row.employees as { full_name?: string; employee_code?: string } | null;
    rows.push({
      operationName: operationName.get(br?.operation_id ?? "") ?? "",
      stateUf: br?.operation_cities?.cities?.states?.uf ?? "",
      cityName: br?.operation_cities?.cities?.name ?? "",
      brId: assignment?.operation_br_id ?? "",
      brCode: br?.code ?? "",
      leaderName: leaders.get(assignment?.operation_br_id ?? "") ?? null,
      employeeCode: employee?.employee_code ?? null,
      employeeName: employee?.full_name ?? "—",
      driverRole: row.driver_role === "secondary" ? "secondary" : "primary",
      fleetCode: assignment?.vehicles?.fleet_code ?? null,
      licensePlate: assignment?.vehicles?.license_plate ?? null,
      startDate: row.start_date as string,
      endDate: (row.end_date as string) ?? null,
      status: (row.status as string) ?? "",
      reason: (row.reason as string) ?? null,
      endReason: (row.end_reason as string) ?? null,
    });
  }
  return rows.sort(
    (a, b) =>
      a.operationName.localeCompare(b.operationName, "pt-BR") ||
      a.brCode.localeCompare(b.brCode) ||
      a.startDate.localeCompare(b.startDate),
  );
}
