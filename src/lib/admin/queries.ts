import "server-only";

import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/types/database.types";

export type DirectoryRow = Database["public"]["Views"]["employee_directory"]["Row"];

export const PAGE_SIZES = [25, 50, 100] as const;
export const DEFAULT_PAGE_SIZE = 25;

/** Columns the list may be ordered by. Anything else is ignored, not trusted. */
const SORTABLE = {
  full_name: "search_name",
  employee_code: "employee_code",
  employment_status: "employment_status",
  admission_date: "admission_date",
  job_position_name: "job_position_name",
  operation_name: "operation_name",
  work_location_name: "work_location_name",
  access_status: "access_status",
} as const;

export type SortKey = keyof typeof SORTABLE;

export interface DirectoryFilters {
  q?: string;
  status?: string;
  area?: string;
  operation?: string;
  profile?: string;
  location?: string;
  unit?: string;
  manager?: string;
  access?: string;
  archived?: boolean;
  sort?: SortKey;
  dir?: "asc" | "desc";
  page?: number;
  pageSize?: number;
}

/**
 * Same comparison form as private.normalize_label in the database, so a search
 * for "jose" finds "José" and the index is actually used.
 */
export function normalizeLabel(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** PostgREST treats these as syntax inside an or() filter. */
function escapeFilterValue(value: string): string {
  return value.replace(/[(),*]/g, " ").trim();
}

export interface DirectoryPage {
  rows: DirectoryRow[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
}

/**
 * The employee list, paginated and filtered by the database.
 *
 * Nothing is filtered in the browser: at tens of thousands of people the page
 * would be the bottleneck, and a client-side filter is not a security boundary
 * anyway — RLS already restricts the rows to the caller's tenant and operations.
 */
export async function listEmployees(
  organizationId: string,
  filters: DirectoryFilters = {},
): Promise<DirectoryPage> {
  const supabase = await createClient();

  const page = Math.max(1, filters.page ?? 1);
  const pageSize = (PAGE_SIZES as readonly number[]).includes(filters.pageSize ?? 0)
    ? (filters.pageSize as number)
    : DEFAULT_PAGE_SIZE;

  let query = supabase
    .from("employee_directory")
    .select("*", { count: "exact" })
    .eq("organization_id", organizationId);

  query = filters.archived ? query.not("deleted_at", "is", null) : query.is("deleted_at", null);

  if (filters.q) {
    const term = escapeFilterValue(filters.q);
    if (term) {
      const normalized = normalizeLabel(term);
      query = query.or(
        [
          `search_name.ilike.%${normalized}%`,
          `employee_code.ilike.%${term}%`,
          `corporate_email.ilike.%${term.toLowerCase()}%`,
        ].join(","),
      );
    }
  }

  if (filters.status) query = query.eq("employment_status", filters.status);
  if (filters.area) query = query.eq("employment_area_id", filters.area);
  if (filters.operation) query = query.eq("operation_id", filters.operation);
  if (filters.profile) query = query.eq("business_profile_id", filters.profile);
  if (filters.location) query = query.eq("work_location_id", filters.location);
  if (filters.unit) query = query.eq("organization_unit_id", filters.unit);
  if (filters.manager) query = query.eq("manager_employee_id", filters.manager);
  if (filters.access) {
    query = filters.access === "none"
      ? query.in("access_status", ["none", "removed"])
      : query.eq("access_status", filters.access);
  }

  const sortColumn = SORTABLE[filters.sort ?? "full_name"] ?? SORTABLE.full_name;
  const ascending = filters.dir !== "desc";

  const from = (page - 1) * pageSize;
  const { data, error, count } = await query
    .order(sortColumn, { ascending, nullsFirst: false })
    .order("employee_code", { ascending: true })
    .range(from, from + pageSize - 1);

  if (error) throw new Error(error.message);

  const total = count ?? 0;
  return {
    rows: data ?? [],
    total,
    page,
    pageSize,
    pageCount: Math.max(1, Math.ceil(total / pageSize)),
  };
}

/** Every row matching the filters, for an export. Paged to keep memory bounded. */
export async function listEmployeesForExport(
  organizationId: string,
  filters: DirectoryFilters = {},
  limit = 20000,
): Promise<DirectoryRow[]> {
  const rows: DirectoryRow[] = [];
  const pageSize = 1000;

  for (let page = 1; rows.length < limit; page++) {
    const result = await listEmployees(organizationId, { ...filters, page, pageSize });
    rows.push(...result.rows);
    if (rows.length >= result.total || result.rows.length === 0) break;
  }

  return rows.slice(0, limit);
}

export interface EmployeeDetail {
  directory: DirectoryRow;
  masked: { cpf_masked: string | null; birth_year: number | null; has_cpf: boolean; has_birth_date: boolean } | null;
  sensitive: { cpf: string | null; birth_date: string | null } | null;
  license: Database["public"]["Tables"]["driver_licenses"]["Row"] | null;
  assignments: (Database["public"]["Tables"]["employee_assignments"]["Row"] & {
    job_positions: { name: string } | null;
    operations: { name: string } | null;
  })[];
  scopeOperationIds: string[];
  roleIds: string[];
  permissions: string[];
}

/**
 * One employee with everything the detail drawer shows.
 *
 * The restricted block is fetched separately and is allowed to come back empty:
 * that is RLS answering "not for you", not an error.
 */
export async function getEmployeeDetail(
  organizationId: string,
  employeeId: string,
): Promise<EmployeeDetail | null> {
  const supabase = await createClient();

  const { data: directory } = await supabase
    .from("employee_directory")
    .select("*")
    .eq("organization_id", organizationId)
    .eq("id", employeeId)
    .maybeSingle();

  if (!directory) return null;

  const [masked, sensitive, license, assignments, scopes, roles, permissions] = await Promise.all([
    supabase.rpc("employee_masked_identifiers", { p_employee_id: employeeId }).maybeSingle(),
    supabase.from("employee_private_data").select("cpf, birth_date").eq("employee_id", employeeId).maybeSingle(),
    supabase
      .from("driver_licenses")
      .select("*")
      .eq("employee_id", employeeId)
      .is("deleted_at", null)
      .maybeSingle(),
    supabase
      .from("employee_assignments")
      .select("*, job_positions(name), operations(name)")
      .eq("employee_id", employeeId)
      .order("effective_from", { ascending: false })
      .limit(20),
    directory.membership_id
      ? supabase.from("membership_operation_scopes").select("operation_id").eq("membership_id", directory.membership_id)
      : Promise.resolve({ data: [] as { operation_id: string }[] }),
    directory.membership_id
      ? supabase.from("membership_roles").select("role_id").eq("membership_id", directory.membership_id)
      : Promise.resolve({ data: [] as { role_id: string }[] }),
    supabase.rpc("current_user_permissions", { p_organization_id: organizationId }),
  ]);

  return {
    directory,
    masked: masked.data ?? null,
    sensitive: sensitive.data ?? null,
    license: license.data ?? null,
    assignments: assignments.data ?? [],
    scopeOperationIds: (scopes.data ?? []).map((s) => s.operation_id),
    roleIds: (roles.data ?? []).map((r) => r.role_id),
    permissions: (permissions.data as string[] | null) ?? [],
  };
}

export interface Option {
  id: string;
  label: string;
  hint?: string | null;
}

export interface DirectoryOptions {
  operations: Option[];
  areas: Option[];
  positions: Option[];
  locations: Option[];
  units: Option[];
  profiles: Option[];
  managers: Option[];
  roles: (Option & { description: string | null })[];
}

/** Everything the filter bar and the forms need to offer as a choice. */
export async function getDirectoryOptions(organizationId: string): Promise<DirectoryOptions> {
  const supabase = await createClient();
  const alive = { organization_id: organizationId };

  const [operations, areas, positions, locations, units, profiles, managers, roles] = await Promise.all([
    supabase.from("operations").select("id, name, code").match(alive).is("deleted_at", null).order("name"),
    supabase.from("employment_areas").select("id, name").match(alive).is("deleted_at", null).order("name"),
    supabase.from("job_positions").select("id, name, code").match(alive).is("deleted_at", null).order("name"),
    supabase.from("work_locations").select("id, name").match(alive).is("deleted_at", null).order("name"),
    supabase.from("organization_units").select("id, name, code").match(alive).is("deleted_at", null).order("name"),
    supabase.from("business_profiles").select("id, name").match(alive).is("deleted_at", null).order("name"),
    // only people who actually lead someone, so the filter stays short
    supabase
      .from("employee_directory")
      .select("manager_employee_id, manager_name")
      .eq("organization_id", organizationId)
      .not("manager_employee_id", "is", null)
      .limit(5000),
    supabase
      .from("roles")
      .select("id, code, name, description, organization_id")
      .or(`organization_id.is.null,organization_id.eq.${organizationId}`)
      .is("deleted_at", null)
      .order("name"),
  ]);

  const managerMap = new Map<string, string>();
  for (const row of managers.data ?? []) {
    if (row.manager_employee_id && row.manager_name) managerMap.set(row.manager_employee_id, row.manager_name);
  }

  return {
    operations: (operations.data ?? []).map((o) => ({ id: o.id, label: o.name, hint: o.code })),
    areas: (areas.data ?? []).map((a) => ({ id: a.id, label: a.name })),
    positions: (positions.data ?? []).map((p) => ({ id: p.id, label: p.name, hint: p.code })),
    locations: (locations.data ?? []).map((l) => ({ id: l.id, label: l.name })),
    units: (units.data ?? []).map((u) => ({ id: u.id, label: u.name, hint: u.code })),
    profiles: (profiles.data ?? []).map((p) => ({ id: p.id, label: p.name })),
    managers: [...managerMap.entries()]
      .map(([id, label]) => ({ id, label }))
      .sort((a, b) => a.label.localeCompare(b.label, "pt-BR")),
    roles: (roles.data ?? []).map((r) => ({ id: r.id, label: r.name, description: r.description })),
  };
}

export interface DirectoryStats {
  total: number;
  withAccess: number;
  withoutAccess: number;
  suspended: number;
  pending: number;
}

export async function getDirectoryStats(organizationId: string): Promise<DirectoryStats> {
  const supabase = await createClient();
  const { data } = await supabase
    .rpc("employee_directory_stats", { p_organization_id: organizationId })
    .maybeSingle();

  return {
    total: Number(data?.total_employees ?? 0),
    withAccess: Number(data?.with_access ?? 0),
    withoutAccess: Number(data?.without_access ?? 0),
    suspended: Number(data?.suspended_access ?? 0),
    pending: Number(data?.pending_invites ?? 0),
  };
}

/** Audit trail of one employee, for the history tab. */
export async function getEmployeeHistory(organizationId: string, employeeId: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("audit_logs")
    .select("id, action, entity_type, entity_id, changed_fields, created_at, user_id")
    .eq("organization_id", organizationId)
    .eq("entity_id", employeeId)
    .order("created_at", { ascending: false })
    .limit(50);

  return data ?? [];
}
