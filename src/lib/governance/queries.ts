import "server-only";

import { createClient } from "@/lib/supabase/server";
import { fetchAll } from "@/lib/supabase/fetch-all";
import { monthStart, monthEnd, type Competence } from "./competence";

/**
 * The operational governance service — Lideranças and Fidelização.
 *
 * Two modules, one structure. Everything here hangs off the official hierarchy
 * the product already had:
 *
 *   organização → operação → estado → cidade → BR → veículo / motorista
 *
 * and nothing here re-registers any of it. A leader is an `employee_id`, a
 * fidelized vehicle is a `vehicle_id`, a city is a row of `operation_cities`.
 * The views below resolve those ids to names for the screen; the screen never
 * sends a name back.
 *
 * Every read runs under the caller's own client, so RLS and the operation
 * scopes decide which rows come back. The `organization_id` predicates here
 * keep the queries cheap and unambiguous — they do not keep anyone out.
 */

/* --------------------------------------------------------------- competência */

export {
  MONTH_NAMES,
  formatCompetence,
  currentCompetence,
  parseCompetence,
  daysInCompetence,
  monthStart,
  monthEnd,
  type Competence,
} from "./competence";

/* ---------------------------------------------------------------- lideranças */

export type ScopeLevel = "operation" | "city" | "br";
export type ResponsibilityType = "principal" | "substitute" | "support";

export interface LeadershipRow {
  id: string;
  employeeId: string;
  employeeName: string;
  employeeCode: string | null;
  employeeStatus: string | null;
  scopeLevel: ScopeLevel;
  responsibilityType: ResponsibilityType;
  isPrimary: boolean;
  operationId: string;
  operationName: string;
  operationCityId: string | null;
  stateId: number | null;
  stateUf: string | null;
  cityId: number | null;
  cityName: string | null;
  operationBrId: string | null;
  brCode: string | null;
  effectiveFrom: string;
  effectiveTo: string | null;
  status: "active" | "ended" | "cancelled";
  isCurrent: boolean;
  notes: string | null;
  endReason: string | null;
  updatedAt: string | null;
}

export interface LeadershipFilters {
  operationId?: string;
  stateId?: string;
  cityId?: string;
  employeeId?: string;
  status?: string;
  scope?: string;
}

const asScope = (value: unknown): ScopeLevel =>
  value === "city" || value === "br" ? value : "operation";

const asResponsibility = (value: unknown): ResponsibilityType =>
  value === "substitute" || value === "support" ? value : "principal";

const asStatus = (value: unknown): LeadershipRow["status"] =>
  value === "ended" || value === "cancelled" ? value : "active";

/**
 * Leadership rows whose vigência intersects the competence.
 *
 * The month is a window onto the periods, never a column: a responsibility that
 * started in July and has no end shows up in September because it is still
 * true in September — which is the whole reason §17 refuses to file history by
 * month.
 */
export async function listLeadership(
  organizationId: string,
  competence: Competence,
  filters: LeadershipFilters = {},
): Promise<LeadershipRow[]> {
  const supabase = await createClient();
  const first = monthStart(competence);
  const last = monthEnd(competence);

  const build = () => {
    let query = supabase
      .from("leadership_directory")
      .select("*")
      .eq("organization_id", organizationId)
      .lte("effective_from", last)
      .or(`effective_to.is.null,effective_to.gte.${first}`);

    if (filters.operationId) query = query.eq("operation_id", filters.operationId);
    if (filters.stateId) query = query.eq("state_id", Number(filters.stateId));
    if (filters.cityId) query = query.eq("city_id", Number(filters.cityId));
    if (filters.employeeId) query = query.eq("employee_id", filters.employeeId);
    if (filters.scope) query = query.eq("scope_level", filters.scope);
    if (filters.status === "current") query = query.eq("is_current", true);
    else if (filters.status) query = query.eq("status", filters.status);
    return query;
  };

  // Todas as vigências da competência, página a página (a API devolve até 1.000 por vez).
  const data = await fetchAll((from, to) =>
    build()
      .order("operation_name")
      .order("city_name", { nullsFirst: true })
      .order("br_code", { nullsFirst: true })
      .order("effective_from", { ascending: false })
      .order("id")
      .range(from, to),
  );

  return data.map((row): LeadershipRow => ({
    id: row.id as string,
    employeeId: row.employee_id as string,
    employeeName: (row.employee_name as string) ?? "—",
    employeeCode: (row.employee_code as string) ?? null,
    employeeStatus: (row.employee_status as string) ?? null,
    scopeLevel: asScope(row.scope_level),
    responsibilityType: asResponsibility(row.responsibility_type),
    isPrimary: Boolean(row.is_primary),
    operationId: row.operation_id as string,
    operationName: (row.operation_name as string) ?? "—",
    operationCityId: (row.operation_city_id as string) ?? null,
    stateId: row.state_id === null || row.state_id === undefined ? null : Number(row.state_id),
    stateUf: (row.state_uf as string) ?? null,
    cityId: row.city_id === null || row.city_id === undefined ? null : Number(row.city_id),
    cityName: (row.city_name as string) ?? null,
    operationBrId: (row.operation_br_id as string) ?? null,
    brCode: (row.br_code as string) ?? null,
    effectiveFrom: row.effective_from as string,
    effectiveTo: (row.effective_to as string) ?? null,
    status: asStatus(row.status),
    isCurrent: Boolean(row.is_current),
    notes: (row.notes as string) ?? null,
    endReason: (row.end_reason as string) ?? null,
    updatedAt: (row.updated_at as string) ?? null,
  }));
}

export interface LeadershipIndicators {
  assignments: number;
  leaders: number;
  byOperationScope: number;
  byCityScope: number;
  byBrScope: number;
  substitutes: number;
  brsTotal: number;
  brsWithLeader: number;
  /** §12: locais (operação × cidade) de operações ativas e quantos têm liderança principal na competência. */
  placesTotal: number;
  placesWithLeader: number;
  placesWithoutLeader: number;
  /** % de locais com liderança; null quando não há local. */
  coveragePct: number | null;
  /** O que está sob responsabilidade de alguma liderança na data-âncora. */
  brsUnderLeadership: number;
  vehiclesLinked: number;
  driversLinked: number;
}

export async function getLeadershipIndicators(
  organizationId: string,
  competence: Competence,
  operationId?: string,
): Promise<LeadershipIndicators> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("leadership_indicators", {
    p_organization_id: organizationId,
    p_year: competence.year,
    p_month: competence.month,
    p_operation_id: operationId ?? undefined,
  } as never);

  if (error) throw new Error(error.message);
  const d = (data ?? {}) as Record<string, number>;
  return {
    assignments: Number(d.assignments ?? 0),
    leaders: Number(d.leaders ?? 0),
    byOperationScope: Number(d.by_operation_scope ?? 0),
    byCityScope: Number(d.by_city_scope ?? 0),
    byBrScope: Number(d.by_br_scope ?? 0),
    substitutes: Number(d.substitutes ?? 0),
    brsTotal: Number(d.brs_total ?? 0),
    brsWithLeader: Number(d.brs_with_leader ?? 0),
    placesTotal: Number(d.places_total ?? 0),
    placesWithLeader: Number(d.places_with_leader ?? 0),
    placesWithoutLeader: Number(d.places_without_leader ?? 0),
    coveragePct: d.coverage_pct === null || d.coverage_pct === undefined ? null : Number(d.coverage_pct),
    brsUnderLeadership: Number(d.brs_under_leadership ?? 0),
    vehiclesLinked: Number(d.vehicles_linked ?? 0),
    driversLinked: Number(d.drivers_linked ?? 0),
  };
}

/* ------------------------------------------------------------------ BRs */

export interface OperationBrRow {
  id: string;
  code: string;
  description: string | null;
  status: "active" | "inactive";
  operationId: string;
  operationName: string;
  operationCityId: string;
  stateId: number;
  stateUf: string;
  cityId: number;
  cityName: string;
  notes: string | null;
  currentVehicleId: string | null;
  currentFleetCode: string | null;
  currentLicensePlate: string | null;
  currentLeaderName: string | null;
  updatedAt: string | null;
}

export interface BrFilters {
  q?: string;
  operationId?: string;
  stateId?: string;
  cityId?: string;
  status?: string;
  occupancy?: string;
}

export async function listOperationBrs(
  organizationId: string,
  filters: BrFilters = {},
): Promise<OperationBrRow[]> {
  const supabase = await createClient();

  let query = supabase
    .from("operation_br_directory")
    .select("*")
    .eq("organization_id", organizationId);

  if (filters.operationId) query = query.eq("operation_id", filters.operationId);
  if (filters.stateId) query = query.eq("state_id", Number(filters.stateId));
  if (filters.cityId) query = query.eq("city_id", Number(filters.cityId));
  if (filters.status) query = query.eq("status", filters.status);
  if (filters.occupancy === "with") query = query.not("current_vehicle_id", "is", null);
  if (filters.occupancy === "without") query = query.is("current_vehicle_id", null);
  if (filters.q) {
    const term = filters.q.trim();
    // The code is what people search by, and they type it with and without the
    // leading zeros. `ilike` on both the code and the description covers the
    // two ways the same BR is asked for.
    query = query.or(`code.ilike.%${escapeFilter(term)}%,description.ilike.%${escapeFilter(term)}%`);
  }

  const { data, error } = await query
    .order("operation_name")
    .order("city_name")
    .order("code");

  if (error) throw new Error(error.message);

  return (data ?? []).map((row): OperationBrRow => ({
    id: row.id as string,
    code: row.code as string,
    description: (row.description as string) ?? null,
    status: row.status === "inactive" ? "inactive" : "active",
    operationId: row.operation_id as string,
    operationName: (row.operation_name as string) ?? "—",
    operationCityId: row.operation_city_id as string,
    stateId: Number(row.state_id),
    stateUf: (row.state_uf as string) ?? "",
    cityId: Number(row.city_id),
    cityName: (row.city_name as string) ?? "",
    notes: (row.notes as string) ?? null,
    currentVehicleId: (row.current_vehicle_id as string) ?? null,
    currentFleetCode: (row.current_fleet_code as string) ?? null,
    currentLicensePlate: (row.current_license_plate as string) ?? null,
    currentLeaderName: (row.current_leader_name as string) ?? null,
    updatedAt: (row.updated_at as string) ?? null,
  }));
}

/* ---------------------------------------------------------------- calendário */

export interface CalendarFilters {
  operationId?: string;
  stateId?: string;
  cityId?: string;
  brId?: string;
}

export interface FidelizationIndicators {
  totalBrs: number;
  activeBrs: number;
  brsWithVehicle: number;
  brsWithoutVehicle: number;
  fidelizedVehicles: number;
  substitutions: number;
  inversions: number;
  byOperation: { operationId: string; operationName: string; brs: number; withVehicle: number }[];
}

export async function getFidelizationIndicators(
  organizationId: string,
  competence: Competence,
  filters: CalendarFilters = {},
): Promise<FidelizationIndicators> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("fidelization_indicators", {
    p_organization_id: organizationId,
    p_year: competence.year,
    p_month: competence.month,
    p_operation_id: filters.operationId ?? undefined,
    p_state_id: filters.stateId ? Number(filters.stateId) : undefined,
    p_city_id: filters.cityId ? Number(filters.cityId) : undefined,
  } as never);

  if (error) throw new Error(error.message);
  const d = (data ?? {}) as Record<string, unknown>;

  return {
    totalBrs: Number(d.total_brs ?? 0),
    activeBrs: Number(d.active_brs ?? 0),
    brsWithVehicle: Number(d.brs_with_vehicle ?? 0),
    brsWithoutVehicle: Number(d.brs_without_vehicle ?? 0),
    fidelizedVehicles: Number(d.fidelized_vehicles ?? 0),
    substitutions: Number(d.substitutions ?? 0),
    inversions: Number(d.inversions ?? 0),
    byOperation: ((d.by_operation ?? []) as Record<string, unknown>[]).map((o) => ({
      operationId: o.operation_id as string,
      operationName: (o.operation_name as string) ?? "—",
      brs: Number(o.brs ?? 0),
      withVehicle: Number(o.with_vehicle ?? 0),
    })),
  };
}

/* ------------------------------------------------------------- mobilizações */

export interface FidelizationRow {
  id: string;
  operationBrId: string;
  brCode: string;
  operationId: string;
  operationName: string;
  stateUf: string;
  cityName: string;
  vehicleId: string;
  fleetCode: string | null;
  licensePlate: string | null;
  vehicleTypeName: string | null;
  vehicleMakeName: string | null;
  vehicleModelName: string | null;
  vehicleRole: string;
  startDate: string;
  endDate: string | null;
  status: string;
  source: string;
  reason: string | null;
  /** Why it ended — kept apart from `reason` so closing never rewrites why it began. */
  endReason: string | null;
  replacesAssignmentId: string | null;
  isCurrent: boolean;
  updatedAt: string | null;
}

export async function listFidelizationHistory(
  organizationId: string,
  competence: Competence,
  filters: CalendarFilters & { vehicleId?: string } = {},
): Promise<FidelizationRow[]> {
  const supabase = await createClient();
  const first = monthStart(competence);
  const last = monthEnd(competence);

  const build = () => {
    let query = supabase
      .from("fidelization_directory")
      .select("*")
      .eq("organization_id", organizationId)
      .lte("start_date", last)
      .or(`end_date.is.null,end_date.gte.${first}`);

    if (filters.operationId) query = query.eq("operation_id", filters.operationId);
    if (filters.cityId) query = query.eq("city_id", Number(filters.cityId));
    if (filters.brId) query = query.eq("operation_br_id", filters.brId);
    if (filters.vehicleId) query = query.eq("vehicle_id", filters.vehicleId);
    return query;
  };

  // Todos os vínculos da competência, página a página (a API devolve até 1.000 por vez).
  const data = await fetchAll((from, to) =>
    build().order("start_date", { ascending: false }).order("id").range(from, to),
  );

  return data.map((row): FidelizationRow => ({
    id: row.id as string,
    operationBrId: row.operation_br_id as string,
    brCode: (row.br_code as string) ?? "",
    operationId: row.operation_id as string,
    operationName: (row.operation_name as string) ?? "—",
    stateUf: (row.state_uf as string) ?? "",
    cityName: (row.city_name as string) ?? "",
    vehicleId: row.vehicle_id as string,
    fleetCode: (row.fleet_code as string) ?? null,
    licensePlate: (row.license_plate as string) ?? null,
    vehicleTypeName: (row.vehicle_type_name as string) ?? null,
    vehicleMakeName: (row.vehicle_make_name as string) ?? null,
    vehicleModelName: (row.vehicle_model_name as string) ?? null,
    vehicleRole: (row.vehicle_role as string) ?? "primary",
    startDate: row.start_date as string,
    endDate: (row.end_date as string) ?? null,
    status: (row.status as string) ?? "planned",
    source: (row.source as string) ?? "manual",
    reason: (row.reason as string) ?? null,
    endReason: (row.end_reason as string) ?? null,
    replacesAssignmentId: (row.replaces_assignment_id as string) ?? null,
    isCurrent: Boolean(row.is_current),
    updatedAt: (row.updated_at as string) ?? null,
  }));
}

/* ------------------------------------------------------------- hierarquia */

export interface HierarchyBr {
  br_id: string;
  code: string;
  status: string;
  vehicle: string | null;
  license_plate: string | null;
  leader: string | null;
  drivers: number;
}

export interface HierarchyCity {
  city_name: string;
  leader: string | null;
  brs: HierarchyBr[];
}

export interface HierarchyState {
  uf: string;
  cities: HierarchyCity[];
}

export interface HierarchyOperation {
  operation_id: string;
  operation_name: string;
  leader: string | null;
  cities: number;
  brs: number;
  vehicles: number;
  states: HierarchyState[] | null;
}

export async function getOperationalHierarchy(
  organizationId: string,
  operationId?: string,
): Promise<HierarchyOperation[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("operational_hierarchy", {
    p_organization_id: organizationId,
    p_operation_id: operationId ?? undefined,
  } as never);

  if (error) throw new Error(error.message);
  // The routine returns jsonb, which the generated types can only describe as
  // Json. The shape is fixed by operational_hierarchy itself, so the assertion
  // is the one place that states it.
  return (data ?? []) as unknown as HierarchyOperation[];
}

/* ----------------------------------------------------------------- opções */

export interface GovernanceOptions {
  operations: { id: string; name: string; status: string }[];
  coverage: { operationId: string; operationCityId: string; stateId: number; uf: string; cityId: number; cityName: string }[];
}

/**
 * Everything the filters and the forms need to offer, in one round trip.
 *
 * The coverage list is flat on purpose: the chained Operação → Estado → Cidade
 * filters are derived from it in the browser, which is instant, instead of a
 * request per level. It is the coverage of this organization's operations —
 * never the 27 UFs and never the 5.570 municipalities.
 */
export async function getGovernanceOptions(organizationId: string): Promise<GovernanceOptions> {
  const supabase = await createClient();

  // operation_cities has no key to `states` — the state arrives through the
  // city (and through operation_states, which has no UF). Embedding `states`
  // directly is a PostgREST 400, and the filters then show no state at all.
  const [operations, coverage] = await Promise.all([
    supabase
      .from("operations")
      .select("id, name, status")
      .eq("organization_id", organizationId)
      .is("deleted_at", null)
      .order("name"),
    supabase
      .from("operation_cities")
      .select("id, operation_id, state_id, city_id, cities!operation_cities_city_fk(name, states!cities_state_id_fkey(uf))")
      .eq("organization_id", organizationId),
  ]);
  if (operations.error) console.error("getGovernanceOptions: operations", operations.error.message);
  if (coverage.error) console.error("getGovernanceOptions: operation_cities", coverage.error.message);

  return {
    operations: (operations.data ?? []).map((o) => ({
      id: o.id as string,
      name: o.name as string,
      status: (o.status as string) ?? "active",
    })),
    coverage: (coverage.data ?? [])
      .map((c) => ({
        operationId: c.operation_id as string,
        operationCityId: c.id as string,
        stateId: Number(c.state_id),
        uf: (c.cities as { states?: { uf?: string } | null } | null)?.states?.uf ?? "",
        cityId: Number(c.city_id),
        cityName: (c.cities as { name?: string } | null)?.name ?? "",
      }))
      .sort((a, b) => a.uf.localeCompare(b.uf) || a.cityName.localeCompare(b.cityName)),
  };
}

/* ------------------------------------------------------------------ utils */

/** PostgREST `or()` takes a comma-separated list, so a comma in the term would split it. */
function escapeFilter(term: string): string {
  return term.replace(/[,()]/g, " ").trim();
}

/* ------------------------------------------------------- motoristas */

export interface DriverPlanRow {
  id: string;
  assignmentId: string;
  employeeId: string;
  employeeName: string;
  employeeCode: string | null;
  driverRole: "primary" | "secondary";
  startDate: string;
  endDate: string | null;
  status: string;
  brCode: string;
  operationBrId: string;
  cityName: string;
  stateUf: string;
  operationName: string;
  fleetCode: string | null;
  licensePlate: string | null;
}

/**
 * Drivers planned in the competence, resolved to person, position and vehicle.
 *
 * One query instead of one per row: the driver planning screen is a table of
 * people, and fetching each one's position separately is how a screen with
 * eighty rows becomes eighty round trips.
 */
export async function listDriverPlans(
  organizationId: string,
  competence: Competence,
  filters: CalendarFilters = {},
): Promise<DriverPlanRow[]> {
  const supabase = await createClient();
  const first = monthStart(competence);
  const last = monthEnd(competence);

  // operation_brs reaches its city through operation_cities (one composite
  // key) and has no key to operations or states at all; the operation name
  // comes from its own small query instead of an embed PostgREST rejects.
  const [{ data, error }, operations] = await Promise.all([
    supabase
      .from("fidelization_drivers")
      .select(
        `id, employee_id, driver_role, start_date, end_date, status,
         fidelization_assignment_id,
         employees!fidelization_drivers_employee_fkey(full_name, employee_code),
         fidelization_assignments!fidelization_drivers_assignment_fkey!inner(
           operation_br_id, vehicle_id,
           vehicles!fidelization_vehicle_fkey(fleet_code, license_plate),
           operation_brs!fidelization_br_fkey!inner(code, operation_id, city_id, state_id,
             operation_cities!operation_brs_coverage_fkey(
               cities!operation_cities_city_fk(name, states!cities_state_id_fkey(uf))))
         )`,
      )
      .eq("organization_id", organizationId)
      .lte("start_date", last)
      .or(`end_date.is.null,end_date.gte.${first}`)
      .order("start_date", { ascending: false }),
    supabase.from("operations").select("id, name").eq("organization_id", organizationId),
  ]);

  if (error) throw new Error(error.message);
  const operationName = new Map((operations.data ?? []).map((o) => [o.id as string, o.name as string]));

  type Nested = {
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

  // The nested predicates PostgREST cannot express as top-level filters are
  // applied here, on a result set already scoped by RLS and by the competence —
  // and before mapping, so nothing has to carry fields only the filter reads.
  const matches = (row: (typeof data extends null ? never : NonNullable<typeof data>)[number]) => {
    const br = (row.fidelization_assignments as unknown as Nested | null)?.operation_brs ?? null;
    if (filters.operationId && br?.operation_id !== filters.operationId) return false;
    if (filters.stateId && br?.state_id !== Number(filters.stateId)) return false;
    if (filters.cityId && br?.city_id !== Number(filters.cityId)) return false;
    if (
      filters.brId &&
      (row.fidelization_assignments as unknown as Nested | null)?.operation_br_id !== filters.brId
    ) {
      return false;
    }
    return true;
  };

  return (data ?? []).filter(matches).map((row): DriverPlanRow => {
    const employee = row.employees as { full_name?: string; employee_code?: string } | null;
    const assignment = row.fidelization_assignments as unknown as Nested | null;
    const br = assignment?.operation_brs ?? null;
    return {
      id: row.id as string,
      assignmentId: row.fidelization_assignment_id as string,
      employeeId: row.employee_id as string,
      employeeName: employee?.full_name ?? "—",
      employeeCode: employee?.employee_code ?? null,
      driverRole: row.driver_role === "secondary" ? "secondary" : "primary",
      startDate: row.start_date as string,
      endDate: (row.end_date as string) ?? null,
      status: (row.status as string) ?? "planned",
      brCode: br?.code ?? "",
      operationBrId: assignment?.operation_br_id ?? "",
      cityName: br?.operation_cities?.cities?.name ?? "",
      stateUf: br?.operation_cities?.cities?.states?.uf ?? "",
      operationName: operationName.get(br?.operation_id ?? "") ?? "",
      fleetCode: assignment?.vehicles?.fleet_code ?? null,
      licensePlate: assignment?.vehicles?.license_plate ?? null,
    };
  });
}
