import "server-only";

import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/types/database.types";

/**
 * The fleet registry service.
 *
 * `vehicle_directory` is the one read model: vehicle, classification, the
 * allocation that covers today, the transfer already scheduled and the
 * homologated odometer reading. It is a `security_invoker` view, so what comes
 * back is already restricted to the caller's tenant and operation scope — the
 * filters below shape a result set that RLS has already decided.
 *
 * Nothing here filters in the browser. At a few thousand vehicles the page
 * would be the bottleneck, and a client-side filter was never a boundary.
 */

export type VehicleRow = Database["public"]["Views"]["vehicle_directory"]["Row"];

/**
 * The request-scoped client. Passed in rather than created inside the query
 * builder: a PostgREST builder is itself a thenable, so an `await` on a
 * function that returns one would execute the query instead of composing it.
 */
type FleetClient = Awaited<ReturnType<typeof createClient>>;

export const PAGE_SIZES = [25, 50, 100] as const;
export const DEFAULT_PAGE_SIZE = 25;

/** Columns the list may be ordered by. Anything else is ignored, not trusted. */
const SORTABLE = {
  fleet_code: "fleet_code",
  license_plate: "license_plate",
  vehicle_type_name: "vehicle_type_name",
  vehicle_make_name: "vehicle_make_name",
  ownership_type: "ownership_type",
  operation_name: "operation_name",
  city_name: "city_name",
  status: "status",
  current_odometer_km: "current_odometer_km",
} as const;

export type VehicleSortKey = keyof typeof SORTABLE;

export interface VehicleFilters {
  q?: string;
  status?: string;
  ownership?: string;
  type?: string;
  subcategory?: string;
  operation?: string;
  state?: string;
  city?: string;
  unit?: string;
  archived?: boolean;
  sort?: VehicleSortKey;
  dir?: "asc" | "desc";
  page?: number;
  pageSize?: number;
}

/** Same comparison form as private.normalize_label, so the index is used. */
export function normalizeLabel(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** PostgREST treats these as syntax inside an or() filter. */
function escapeFilterValue(value: string): string {
  return value.replace(/[(),*]/g, " ").trim();
}

export interface VehiclePage {
  rows: VehicleRow[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
}

/**
 * One builder for both the paginated list and the export, so a filter can
 * never mean two different things depending on which of them you called.
 */
function buildVehicleQuery(
  supabase: FleetClient,
  organizationId: string,
  filters: VehicleFilters,
  withCount: boolean,
) {
  let query = supabase
    .from("vehicle_directory")
    .select("*", withCount ? { count: "exact" } : undefined)
    .eq("organization_id", organizationId);

  query = filters.archived ? query.not("deleted_at", "is", null) : query.is("deleted_at", null);

  if (filters.q) {
    const term = escapeFilterValue(filters.q);
    if (term) {
      const normalized = normalizeLabel(term);
      // `search_text` already carries fleet code, plate, make, model and type
      // in normalized form, so one ilike covers §45's four search targets.
      query = query.or(
        [`search_text.ilike.%${normalized}%`, `license_plate.ilike.%${term.toUpperCase()}%`].join(","),
      );
    }
  }

  if (filters.status) query = query.eq("status", filters.status);
  if (filters.ownership) query = query.eq("ownership_type", filters.ownership);
  if (filters.type) query = query.eq("vehicle_type_id", filters.type);
  if (filters.subcategory) query = query.eq("vehicle_subcategory_id", filters.subcategory);
  if (filters.operation) query = query.eq("operation_id", filters.operation);
  if (filters.state) query = query.eq("state_id", Number(filters.state));
  if (filters.city) query = query.eq("city_id", Number(filters.city));
  if (filters.unit) query = query.eq("organization_unit_id", filters.unit);

  return query;
}

export async function listVehicles(
  organizationId: string,
  filters: VehicleFilters = {},
): Promise<VehiclePage> {
  const page = Math.max(1, filters.page ?? 1);
  const pageSize = (PAGE_SIZES as readonly number[]).includes(filters.pageSize ?? 0)
    ? (filters.pageSize as number)
    : DEFAULT_PAGE_SIZE;

  const supabase = await createClient();
  const query = buildVehicleQuery(supabase, organizationId, filters, true);

  const sortColumn = SORTABLE[filters.sort ?? "fleet_code"] ?? SORTABLE.fleet_code;
  const ascending = filters.dir !== "desc";
  const from = (page - 1) * pageSize;

  const { data, error, count } = await query
    .order(sortColumn, { ascending, nullsFirst: false })
    .order("fleet_code", { ascending: true })
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

/** The same filtered set, unpaginated, for export. Capped, never unbounded. */
export async function listVehiclesForExport(
  organizationId: string,
  filters: VehicleFilters = {},
  limit = 20000,
): Promise<VehicleRow[]> {
  const supabase = await createClient();
  const query = buildVehicleQuery(supabase, organizationId, filters, false);
  const { data } = await query.order("fleet_code").limit(limit);
  return data ?? [];
}

/* ------------------------------------------------------------------ detail */

export interface AssignmentHistoryRow {
  id: string;
  operationName: string;
  cityName: string;
  stateUf: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  reason: string | null;
  isCurrent: boolean;
  isScheduled: boolean;
}

export interface OdometerReadingRow {
  id: string;
  readingDate: string;
  odometerKm: number;
  source: string;
  notes: string | null;
  supersededBy: string | null;
}

export interface StatusHistoryRow {
  id: string;
  previousStatus: string | null;
  newStatus: string;
  reason: string | null;
  changedAt: string;
}

export interface VehicleDetail {
  vehicle: VehicleRow;
  assignments: AssignmentHistoryRow[];
  readings: OdometerReadingRow[];
  statusHistory: StatusHistoryRow[];
}

export async function getVehicleDetail(
  organizationId: string,
  vehicleId: string,
): Promise<VehicleDetail | null> {
  const supabase = await createClient();

  const { data: vehicle } = await supabase
    .from("vehicle_directory")
    .select("*")
    .eq("organization_id", organizationId)
    .eq("id", vehicleId)
    .maybeSingle();

  if (!vehicle) return null;

  const [assignments, readings, statusHistory] = await Promise.all([
    supabase
      .from("vehicle_assignment_history")
      .select("id, operation_name, city_name, state_uf, effective_from, effective_to, reason, is_current, is_scheduled")
      .eq("vehicle_id", vehicleId)
      .order("effective_from", { ascending: false }),
    supabase
      .from("vehicle_odometer_readings")
      .select("id, reading_date, odometer_km, source, notes, superseded_by")
      .eq("vehicle_id", vehicleId)
      .order("reading_date", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(100),
    supabase
      .from("vehicle_status_history")
      .select("id, previous_status, new_status, reason, changed_at")
      .eq("vehicle_id", vehicleId)
      .order("changed_at", { ascending: false })
      .limit(100),
  ]);

  return {
    vehicle,
    assignments: (assignments.data ?? []).map((row) => ({
      id: row.id ?? "",
      operationName: row.operation_name ?? "—",
      cityName: row.city_name ?? "—",
      stateUf: row.state_uf ?? "",
      effectiveFrom: row.effective_from ?? "",
      effectiveTo: row.effective_to,
      reason: row.reason,
      isCurrent: Boolean(row.is_current),
      isScheduled: Boolean(row.is_scheduled),
    })),
    readings: (readings.data ?? []).map((row) => ({
      id: row.id,
      readingDate: row.reading_date,
      odometerKm: row.odometer_km,
      source: row.source,
      notes: row.notes,
      supersededBy: row.superseded_by,
    })),
    statusHistory: (statusHistory.data ?? []).map((row) => ({
      id: row.id,
      previousStatus: row.previous_status,
      newStatus: row.new_status,
      reason: row.reason,
      changedAt: row.changed_at,
    })),
  };
}

/* ---------------------------------------------------------------- catalogue */

export interface Option {
  id: string;
  label: string;
}

export interface SubcategoryOption extends Option {
  vehicleTypeId: string;
}

export interface ModelOption extends Option {
  vehicleMakeId: string;
}

export interface FleetOptions {
  types: Option[];
  subcategories: SubcategoryOption[];
  makes: Option[];
  models: ModelOption[];
  operations: Option[];
  units: Option[];
  costCenters: Option[];
}

export async function getFleetOptions(organizationId: string): Promise<FleetOptions> {
  const supabase = await createClient();
  const alive = { organization_id: organizationId };

  const [types, subcategories, makes, models, operations, units, costCenters] = await Promise.all([
    supabase.from("vehicle_types").select("id, name").eq("is_active", true).order("sort_order"),
    // Subcategories are global (organization_id null) plus whatever the tenant
    // added. Both are offered; the type filter is applied in the form.
    supabase
      .from("vehicle_subcategories")
      .select("id, name, vehicle_type_id, organization_id")
      .or(`organization_id.is.null,organization_id.eq.${organizationId}`)
      .eq("is_active", true)
      .order("name"),
    supabase.from("vehicle_makes").select("id, name").match(alive).eq("is_active", true).order("name"),
    supabase
      .from("vehicle_models")
      .select("id, name, vehicle_make_id")
      .match(alive)
      .eq("is_active", true)
      .order("name"),
    supabase.from("operations").select("id, name").match(alive).is("deleted_at", null).order("name"),
    supabase.from("organization_units").select("id, name").match(alive).is("deleted_at", null).order("name"),
    supabase.from("cost_centers").select("id, name").match(alive).is("deleted_at", null).order("name"),
  ]);

  return {
    types: (types.data ?? []).map((row) => ({ id: row.id, label: row.name })),
    subcategories: (subcategories.data ?? []).map((row) => ({
      id: row.id,
      label: row.name,
      vehicleTypeId: row.vehicle_type_id,
    })),
    makes: (makes.data ?? []).map((row) => ({ id: row.id, label: row.name })),
    models: (models.data ?? []).map((row) => ({
      id: row.id,
      label: row.name,
      vehicleMakeId: row.vehicle_make_id,
    })),
    operations: (operations.data ?? []).map((row) => ({ id: row.id, label: row.name })),
    units: (units.data ?? []).map((row) => ({ id: row.id, label: row.name })),
    costCenters: (costCenters.data ?? []).map((row) => ({ id: row.id, label: row.name })),
  };
}

/* --------------------------------------------------------------- indicators */

export interface OperationVehicleCount {
  operationId: string | null;
  operationName: string;
  count: number;
}

export interface VehicleSummary {
  total: number;
  active: number;
  inactive: number;
  owned: number;
  rented: number;
  unassigned: number;
  scheduledOnly: number;
  operationCount: number;
  assetValueTotal: number;
  assetValueKnown: number;
  assetValueUnknown: number;
  byOperation: OperationVehicleCount[];
}

/**
 * One aggregate, one scan, server-side — §48. The filters passed are the
 * structural ones; the free-text search is deliberately not among them, so the
 * cards describe the slice rather than flickering on every keystroke.
 */
export async function getVehicleSummary(
  organizationId: string,
  filters: VehicleFilters = {},
): Promise<VehicleSummary> {
  const supabase = await createClient();

  const payload: Record<string, string | boolean> = {};
  if (filters.status) payload.status = filters.status;
  if (filters.ownership) payload.ownership = filters.ownership;
  if (filters.type) payload.type = filters.type;
  if (filters.subcategory) payload.subcategory = filters.subcategory;
  if (filters.operation) payload.operation = filters.operation;
  if (filters.state) payload.state = filters.state;
  if (filters.city) payload.city = filters.city;
  if (filters.unit) payload.unit = filters.unit;
  if (filters.archived) payload.archived = true;

  const { data, error } = await supabase.rpc("vehicle_summary", {
    p_organization_id: organizationId,
    p_filters: payload,
  });

  if (error) throw new Error(error.message);

  const raw = (data ?? {}) as Record<string, unknown>;
  const num = (key: string) => Number(raw[key] ?? 0);

  return {
    total: num("total"),
    active: num("active"),
    inactive: num("inactive"),
    owned: num("owned"),
    rented: num("rented"),
    unassigned: num("unassigned"),
    scheduledOnly: num("scheduled_only"),
    operationCount: num("operation_count"),
    assetValueTotal: num("asset_value_total"),
    assetValueKnown: num("asset_value_known"),
    assetValueUnknown: num("asset_value_unknown"),
    byOperation: (Array.isArray(raw.by_operation) ? raw.by_operation : []).map((entry) => {
      const item = entry as Record<string, unknown>;
      return {
        operationId: (item.operation_id as string | null) ?? null,
        operationName: (item.operation_name as string) ?? "Sem alocação",
        count: Number(item.vehicle_count ?? 0),
      };
    }),
  };
}
