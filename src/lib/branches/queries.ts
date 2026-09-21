import "server-only";

import { createClient } from "@/lib/supabase/server";
import { normalizeDocument } from "./format";

/**
 * The branch service — §66's `listBranches` / `getBranch` / `getBranchOperations`
 * / `getBranchEmployees` / `getBranchVehicles` / `getBranchSummary`, in one place.
 *
 * A filial is a unit of `organization_units`, the table the foundation already
 * created and that employees, vehicles, drivers, cost centres and work locations
 * already point at. There is no second registry and there must not be one.
 *
 * Three things this module keeps apart, because the old system did not:
 *
 *   organização  quem é dona dos dados
 *   filial       a unidade que responde — o que este módulo cadastra
 *   operação     o que a empresa faz, e onde a cobertura geográfica mora
 *
 * The state and city here are the branch's PHYSICAL ADDRESS. They say nothing
 * about which municipalities its operations cover.
 */

export interface BranchRow {
  id: string;
  unitType: string;
  code: string | null;
  name: string;
  legalName: string | null;
  documentNumber: string | null;
  status: "active" | "inactive";
  statusReason: string | null;
  notes: string | null;

  postalCode: string | null;
  street: string | null;
  streetNumber: string | null;
  complement: string | null;
  district: string | null;
  stateId: number | null;
  stateUf: string | null;
  cityId: number | null;
  cityName: string | null;

  operationCount: number;
  employeeCount: number;
  vehicleCount: number;
  costCenterCount: number;

  updatedAt: string | null;
}

export interface BranchFilters {
  q?: string;
  status?: string;
  operationId?: string;
  stateId?: string;
  cityId?: string;
  withVehicles?: string;
  withEmployees?: string;
}

const asStatus = (v: unknown): BranchRow["status"] => (v === "inactive" ? "inactive" : "active");

function mapBranch(row: Record<string, unknown>): BranchRow {
  return {
    id: row.id as string,
    unitType: (row.unit_type as string) ?? "branch",
    code: (row.code as string) ?? null,
    name: (row.name as string) ?? "—",
    legalName: (row.legal_name as string) ?? null,
    documentNumber: (row.document_number as string) ?? null,
    status: asStatus(row.status),
    statusReason: (row.status_reason as string) ?? null,
    notes: (row.notes as string) ?? null,
    postalCode: (row.postal_code as string) ?? null,
    street: (row.street as string) ?? null,
    streetNumber: (row.street_number as string) ?? null,
    complement: (row.complement as string) ?? null,
    district: (row.district as string) ?? null,
    stateId: row.state_id === null || row.state_id === undefined ? null : Number(row.state_id),
    stateUf: (row.state_uf as string) ?? null,
    cityId: row.city_id === null || row.city_id === undefined ? null : Number(row.city_id),
    cityName: (row.city_name as string) ?? null,
    operationCount: Number(row.operation_count ?? 0),
    employeeCount: Number(row.employee_count ?? 0),
    vehicleCount: Number(row.vehicle_count ?? 0),
    costCenterCount: Number(row.cost_center_count ?? 0),
    updatedAt: (row.updated_at as string) ?? null,
  };
}

/**
 * §42: search by internal code, name, legal name or normalised CNPJ.
 *
 * The CNPJ branch of the search normalises the term first, so "12.345.678/0001-95",
 * "12345678000195" and "12345678" all find the same branch — the column stores
 * digits and the person types whatever they copied.
 */
export async function listBranches(
  organizationId: string,
  filters: BranchFilters = {},
): Promise<BranchRow[]> {
  const supabase = await createClient();

  let query = supabase
    .from("branch_directory")
    .select("*")
    .eq("organization_id", organizationId)
    .is("deleted_at", null);

  if (filters.status) query = query.eq("status", filters.status);
  if (filters.stateId) query = query.eq("state_id", Number(filters.stateId));
  if (filters.cityId) query = query.eq("city_id", Number(filters.cityId));
  if (filters.withVehicles === "yes") query = query.gt("vehicle_count", 0);
  if (filters.withVehicles === "no") query = query.eq("vehicle_count", 0);
  if (filters.withEmployees === "yes") query = query.gt("employee_count", 0);
  if (filters.withEmployees === "no") query = query.eq("employee_count", 0);

  if (filters.q) {
    const term = filters.q.trim().replace(/[,()]/g, " ").trim();
    const digits = normalizeDocument(term);
    const clauses = [
      `code.ilike.%${term}%`,
      `name.ilike.%${term}%`,
      `legal_name.ilike.%${term}%`,
    ];
    if (digits) clauses.push(`document_number.ilike.%${digits}%`);
    query = query.or(clauses.join(","));
  }

  const { data, error } = await query.order("name");
  if (error) throw new Error(error.message);

  let rows = (data ?? []).map((row) => mapBranch(row as Record<string, unknown>));

  // The operation filter lives one table away, so it is applied against the
  // link rows rather than duplicated into the directory view.
  if (filters.operationId) {
    const { data: links } = await supabase
      .from("branch_operation_directory")
      .select("organization_unit_id")
      .eq("organization_id", organizationId)
      .eq("operation_id", filters.operationId)
      .eq("is_current", true);
    const allowed = new Set((links ?? []).map((l) => l.organization_unit_id as string));
    rows = rows.filter((r) => allowed.has(r.id));
  }

  return rows;
}

export async function getBranch(
  organizationId: string,
  branchId: string,
): Promise<BranchRow | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("branch_directory")
    .select("*")
    .eq("organization_id", organizationId)
    .eq("id", branchId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return data ? mapBranch(data as Record<string, unknown>) : null;
}

/* ------------------------------------------------------------- operações */

export interface BranchOperationRow {
  id: string;
  organizationUnitId: string;
  operationId: string;
  operationCode: string | null;
  operationName: string;
  operationStatus: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  isCurrent: boolean;
  vehicleCount: number;
  notes: string | null;
}

/** Current links and the historical ones — §27 keeps both readable. */
export async function getBranchOperations(
  organizationId: string,
  branchId?: string,
): Promise<BranchOperationRow[]> {
  const supabase = await createClient();
  let query = supabase
    .from("branch_operation_directory")
    .select("*")
    .eq("organization_id", organizationId);

  if (branchId) query = query.eq("organization_unit_id", branchId);

  const { data, error } = await query
    .order("is_current", { ascending: false })
    .order("operation_name");

  if (error) throw new Error(error.message);

  return (data ?? []).map((row) => ({
    id: row.id as string,
    organizationUnitId: row.organization_unit_id as string,
    operationId: row.operation_id as string,
    operationCode: (row.operation_code as string) ?? null,
    operationName: (row.operation_name as string) ?? "—",
    operationStatus: (row.operation_status as string) ?? "active",
    effectiveFrom: row.effective_from as string,
    effectiveTo: (row.effective_to as string) ?? null,
    isCurrent: Boolean(row.is_current),
    vehicleCount: Number(row.vehicle_count ?? 0),
    notes: (row.notes as string) ?? null,
  }));
}

/* ------------------------------------------------------------ indicadores */

export interface BranchSummary {
  totalBranches: number;
  activeBranches: number;
  inactiveBranches: number;
  linkedOperations: number;
  linkedEmployees: number;
  linkedVehicles: number;
}

export async function getBranchSummary(organizationId: string): Promise<BranchSummary> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("branch_summary", {
    p_organization_id: organizationId,
  });

  if (error) throw new Error(error.message);
  const d = (data ?? {}) as Record<string, number>;
  return {
    totalBranches: Number(d.total_branches ?? 0),
    activeBranches: Number(d.active_branches ?? 0),
    inactiveBranches: Number(d.inactive_branches ?? 0),
    linkedOperations: Number(d.linked_operations ?? 0),
    linkedEmployees: Number(d.linked_employees ?? 0),
    linkedVehicles: Number(d.linked_vehicles ?? 0),
  };
}

/* ------------------------------------------------------------- opções */

export interface BranchOptions {
  operations: { id: string; code: string | null; name: string; status: string }[];
  /** States and cities of the branches that exist, for the location filters. */
  locations: { stateId: number; uf: string; cityId: number; cityName: string }[];
}

export async function getBranchOptions(organizationId: string): Promise<BranchOptions> {
  const supabase = await createClient();

  const [operations, locations] = await Promise.all([
    supabase
      .from("operations")
      .select("id, code, name, status")
      .eq("organization_id", organizationId)
      .is("deleted_at", null)
      .order("name"),
    supabase
      .from("branch_directory")
      .select("state_id, state_uf, city_id, city_name")
      .eq("organization_id", organizationId)
      .is("deleted_at", null)
      .not("city_id", "is", null),
  ]);

  const seen = new Map<number, { stateId: number; uf: string; cityId: number; cityName: string }>();
  for (const l of locations.data ?? []) {
    const cityId = Number(l.city_id);
    if (!seen.has(cityId)) {
      seen.set(cityId, {
        stateId: Number(l.state_id),
        uf: (l.state_uf as string) ?? "",
        cityId,
        cityName: (l.city_name as string) ?? "",
      });
    }
  }

  return {
    operations: (operations.data ?? []).map((o) => ({
      id: o.id as string,
      code: (o.code as string) ?? null,
      name: o.name as string,
      status: (o.status as string) ?? "active",
    })),
    locations: [...seen.values()].sort(
      (a, b) => a.uf.localeCompare(b.uf) || a.cityName.localeCompare(b.cityName),
    ),
  };
}
