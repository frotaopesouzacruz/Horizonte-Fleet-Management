import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { getMaintenanceFilterOptions, type MaintenanceFilterOptions } from "@/lib/maintenance/queries";
import type { Json } from "@/types/database.types";
import { mtsrFixtureStore, mtsrRpc } from "./rpc";
import {
  camelize,
  type MtsrCatalog,
  type MtsrDashboard,
  type MtsrEventsList,
  type MtsrFleetStatus,
  type MtsrHealth,
  type MtsrIngestionEventRow,
  type MtsrInspectionDetail,
  type MtsrInspectionsReceived,
  type MtsrMaintenanceLinkRow,
  type MtsrSortKey,
  type MtsrVehicleSheet,
  type MtsrVehicleSummary,
} from "./types";

/**
 * Leituras da Gestão de MTSR. Tudo passa por rotinas do banco sobre a mesma
 * função de filtro (`private.mtsr_fleet_filtered`), sob a RLS da pessoa: o
 * escopo por organização, operação e veículo vale igual para a matriz, os
 * cartões, a ficha e a exportação.
 */

export interface MtsrVehicleOption {
  id: string;
  plate: string;
  fleetCode: string | null;
  status: string;
  vehicleTypeId: string | null;
}

export type MtsrFilterOptions = MaintenanceFilterOptions & { vehicles: MtsrVehicleOption[] };

export async function getMtsrFilterOptions(organizationId: string): Promise<MtsrFilterOptions> {
  const supabase = await createClient();
  const [base, vehicles] = await Promise.all([
    getMaintenanceFilterOptions(organizationId),
    supabase
      .from("vehicles")
      .select("id, license_plate, fleet_code, status, vehicle_type_id")
      .eq("organization_id", organizationId)
      .is("deleted_at", null)
      .order("license_plate"),
  ]);
  return {
    ...base,
    vehicles: (vehicles.data ?? []).map((v) => ({
      id: v.id,
      plate: v.license_plate ?? v.fleet_code ?? "—",
      fleetCode: v.fleet_code,
      status: v.status,
      vehicleTypeId: v.vehicle_type_id,
    })),
  };
}

export const getMtsrCatalog = (organizationId: string) =>
  mtsrRpc<MtsrCatalog>("mtsr_catalog", { p_organization_id: organizationId });

export const getMtsrDashboard = (organizationId: string, filters: Record<string, Json>) =>
  mtsrRpc<MtsrDashboard>("mtsr_dashboard", { p_organization_id: organizationId, p_filters: filters });

export const getMtsrFleetStatus = (
  organizationId: string,
  filters: Record<string, Json>,
  sort: MtsrSortKey = "criticality",
  dir: "asc" | "desc" = "desc",
  limit = 50,
  offset = 0,
) =>
  mtsrRpc<MtsrFleetStatus>("mtsr_fleet_status", {
    p_organization_id: organizationId,
    p_filters: filters,
    p_sort: sort,
    p_dir: dir,
    p_limit: limit,
    p_offset: offset,
  });

export const getMtsrVehicleSheet = (organizationId: string, vehicleId: string) =>
  mtsrRpc<MtsrVehicleSheet>("mtsr_vehicle_sheet", { p_organization_id: organizationId, p_vehicle_id: vehicleId });

export const getMtsrVehicleSummary = (vehicleId: string) =>
  mtsrRpc<MtsrVehicleSummary>("mtsr_vehicle_summary", { p_vehicle_id: vehicleId });

export const getMtsrInspectionsReceived = (organizationId: string, filters: Record<string, Json>, limit = 50, offset = 0) =>
  mtsrRpc<MtsrInspectionsReceived>("mtsr_inspections_received", {
    p_organization_id: organizationId,
    p_filters: filters,
    p_limit: limit,
    p_offset: offset,
  });

export const getMtsrInspectionDetail = (organizationId: string, inspectionId: string) =>
  mtsrRpc<MtsrInspectionDetail>("mtsr_inspection_detail", { p_organization_id: organizationId, p_inspection_id: inspectionId });

export const getMtsrEvents = (organizationId: string, filters: Record<string, Json>, limit = 50, offset = 0) =>
  mtsrRpc<MtsrEventsList>("mtsr_events_list", { p_organization_id: organizationId, p_filters: filters, p_limit: limit, p_offset: offset });

export const getMtsrHealth = (organizationId: string) => mtsrRpc<MtsrHealth>("mtsr_health", { p_organization_id: organizationId });

// ---------------------------------------------------------------------------
// Vínculos com a Manutenção corporativa (leitura direta sob RLS)
// ---------------------------------------------------------------------------
export interface MtsrMaintenanceLinksFilters {
  statuses?: string[];
  revalidation?: string[];
  componentId?: string | null;
  vehicleIds?: string[];
  search?: string | null;
}

export interface MtsrMaintenanceLinksPage {
  total: number;
  rows: MtsrMaintenanceLinkRow[];
  limit: number;
  offset: number;
  summary: { active: number; awaiting: number; done: number; open: number };
}

type Any = Record<string, unknown>;
/** O cliente tipado não conhece as tabelas novas até os tipos serem regenerados. */
const untyped = (client: unknown) => client as SupabaseClient;

export async function getMtsrMaintenanceLinks(
  organizationId: string,
  filters: MtsrMaintenanceLinksFilters,
  limit = 50,
  offset = 0,
): Promise<MtsrMaintenanceLinksPage> {
  // Prévia de desenvolvimento: a leitura direta é respondida pelo resolver dos fixtures.
  const fixture = mtsrFixtureStore.getStore();
  if (fixture) return camelize<MtsrMaintenanceLinksPage>(fixture("mtsr_maintenance_links", { filters, limit, offset }));
  const supabase = await createClient();
  const db = untyped(supabase);

  let q = db.from("mtsr_maintenance_links")
    .select(
      "id, maintenance_id, vehicle_id, component_id, link_type, status, revalidation_status, maintenance_concluded_at, revalidated_at, linked_at, reason, inspection_id, mtsr_components(name), vehicles(license_plate, fleet_code)",
      { count: "exact" },
    )
    .eq("organization_id", organizationId)
    .order("linked_at", { ascending: false })
    .range(offset, offset + limit - 1);
  if (filters.statuses?.length) q = q.in("status", filters.statuses);
  else q = q.eq("status", "active");
  if (filters.revalidation?.length) q = q.in("revalidation_status", filters.revalidation);
  if (filters.componentId) q = q.eq("component_id", filters.componentId);
  if (filters.vehicleIds?.length) q = q.in("vehicle_id", filters.vehicleIds);

  const { data, error, count } = await q;
  if (error) throw new Error(`mtsr_maintenance_links: ${error.message}`);
  const links = (data ?? []) as unknown as Any[];
  const ids = [...new Set(links.map((l) => String(l.maintenance_id)))];
  const maint = ids.length
    ? await supabase.from("maintenances").select("id, code, status, requested_on, scheduled_date, exit_date, priority").in("id", ids)
    : { data: [] as Any[], error: null };
  if (maint.error) throw new Error(`maintenances: ${maint.error.message}`);
  const byId = new Map((maint.data as Any[]).map((m) => [String(m.id), m]));

  let rows: MtsrMaintenanceLinkRow[] = links.map((l) => {
    const m = byId.get(String(l.maintenance_id));
    const comp = l.mtsr_components as Any | null;
    const veh = l.vehicles as Any | null;
    return {
      id: String(l.id),
      maintenanceId: String(l.maintenance_id),
      vehicleId: String(l.vehicle_id),
      componentId: String(l.component_id),
      componentName: String(comp?.name ?? "—"),
      linkType: String(l.link_type),
      status: String(l.status),
      revalidationStatus: l.revalidation_status as MtsrMaintenanceLinkRow["revalidationStatus"],
      maintenanceConcludedAt: (l.maintenance_concluded_at as string | null) ?? null,
      revalidatedAt: (l.revalidated_at as string | null) ?? null,
      linkedAt: String(l.linked_at),
      reason: (l.reason as string | null) ?? null,
      inspectionId: (l.inspection_id as string | null) ?? null,
      maintenance: m
        ? {
            code: String(m.code),
            status: String(m.status),
            requestedOn: (m.requested_on as string | null) ?? null,
            scheduledDate: (m.scheduled_date as string | null) ?? null,
            exitDate: (m.exit_date as string | null) ?? null,
            priority: (m.priority as string | null) ?? null,
          }
        : null,
      vehicle: veh ? { licensePlate: String(veh.license_plate ?? "—"), fleetCode: (veh.fleet_code as string | null) ?? null } : null,
    };
  });
  const search = filters.search?.trim().toUpperCase();
  if (search) {
    rows = rows.filter(
      (r) =>
        (r.vehicle?.licensePlate ?? "").toUpperCase().includes(search) ||
        (r.vehicle?.fleetCode ?? "").toUpperCase().includes(search) ||
        (r.maintenance?.code ?? "").toUpperCase().includes(search),
    );
  }

  const summaryQ = await db.from("mtsr_maintenance_links")
    .select("revalidation_status, maintenance_status_snapshot")
    .eq("organization_id", organizationId)
    .eq("status", "active");
  const all = (summaryQ.data ?? []) as unknown as Any[];
  const summary = {
    active: all.length,
    awaiting: all.filter((x) => x.revalidation_status === "awaiting").length,
    done: all.filter((x) => x.revalidation_status === "done").length,
    open: all.filter((x) => ["to_schedule", "scheduled", "in_progress"].includes(String(x.maintenance_status_snapshot))).length,
  };
  return { total: count ?? rows.length, rows, limit, offset, summary };
}

// ---------------------------------------------------------------------------
// Eventos de ingestão (leitura direta sob RLS)
// ---------------------------------------------------------------------------
export interface MtsrIngestionEventsPage {
  total: number;
  rows: (MtsrIngestionEventRow & { licensePlate: string | null; componentName: string | null; sourceCode: string | null })[];
  limit: number;
  offset: number;
}

export async function getMtsrIngestionEvents(
  organizationId: string,
  filters: { statuses?: string[]; sourceId?: string | null; vehicleIds?: string[] },
  limit = 50,
  offset = 0,
): Promise<MtsrIngestionEventsPage> {
  const fixture = mtsrFixtureStore.getStore();
  if (fixture) return camelize<MtsrIngestionEventsPage>(fixture("mtsr_ingestion_events", { filters, limit, offset }));
  const db = untyped(await createClient());
  let q = db.from("mtsr_ingestion_events")
    .select(
      "id, source_id, source_type, source_system, source_record_id, license_plate_raw, vehicle_id, component_code_raw, component_id, status_raw, normalized, status, outcome_reason, received_at, actor_name, import_batch_id, mtsr_ingestion_sources(code), mtsr_components(name), vehicles(license_plate)",
      { count: "exact" },
    )
    .eq("organization_id", organizationId)
    .order("received_at", { ascending: false })
    .range(offset, offset + limit - 1);
  if (filters.statuses?.length) q = q.in("status", filters.statuses);
  if (filters.sourceId) q = q.eq("source_id", filters.sourceId);
  if (filters.vehicleIds?.length) q = q.in("vehicle_id", filters.vehicleIds);
  const { data, error, count } = await q;
  if (error) throw new Error(`mtsr_ingestion_events: ${error.message}`);
  const rows = ((data ?? []) as unknown as Any[]).map((e) => {
    const base = camelize<MtsrIngestionEventRow>({ ...e, mtsr_ingestion_sources: undefined, mtsr_components: undefined, vehicles: undefined });
    return {
      ...base,
      licensePlate: ((e.vehicles as Any | null)?.license_plate as string | null) ?? null,
      componentName: ((e.mtsr_components as Any | null)?.name as string | null) ?? null,
      sourceCode: ((e.mtsr_ingestion_sources as Any | null)?.code as string | null) ?? null,
    };
  });
  return { total: count ?? rows.length, rows, limit, offset };
}

export interface MtsrImportBatch {
  id: string;
  type: string;
  fileName: string | null;
  status: string;
  totalRows: number | null;
  validRows: number | null;
  warningRows: number | null;
  errorRows: number | null;
  updatedRows: number | null;
  skippedRows: number | null;
  summary: Record<string, unknown> | null;
  errorMessage: string | null;
  createdAt: string;
  processedAt: string | null;
  createdByName: string | null;
  errors: { row: number; level: string; message: string }[];
}

export const getMtsrImportHistory = (organizationId: string, limit = 20) =>
  mtsrRpc<MtsrImportBatch[]>("mtsr_import_history", { p_organization_id: organizationId, p_limit: limit });
