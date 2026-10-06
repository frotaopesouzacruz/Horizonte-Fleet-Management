import "server-only";

import { createClient } from "@/lib/supabase/server";
import type { Json } from "@/types/database.types";
import { tiresPreviewActive, tiresRpc } from "./rpc";
import type {
  ImportPreviewSection,
  ScheduleWindow,
  TireFilterOptions,
  TireImportHistory,
  TireImportPreview,
  TireInspectionDetail,
  TireOverview,
  TirePositionInfo,
  TireRepairSuggestion,
  TireSheet,
  TireVehicleSummary,
  TiresAdherence,
  TiresAuditList,
  TiresBase,
  TiresBaseView,
  TiresCatalog,
  TiresEventsList,
  TiresInspectionsReceived,
  TiresMaintenanceServices,
  TiresQuality,
  TiresRepairsList,
  TiresSchedule,
} from "./types";

/**
 * Leituras da Gestão de Pneus. Tudo passa por rotinas do banco sobre a mesma
 * avaliação da fotografia (`private.tire_rows`), sob a RLS da pessoa: o
 * escopo por organização, operação e veículo vale igual para a visão geral,
 * a base, as aderências, a ficha e a exportação.
 */
type Filters = Record<string, Json>;

export const getTiresFilterOptions = (organizationId: string, referenceDate?: string | null) =>
  tiresRpc<TireFilterOptions>("tires_filter_options", { p_organization_id: organizationId, p_reference_date: referenceDate ?? null });

export const getTiresOverview = (organizationId: string, filters: Filters) =>
  tiresRpc<TireOverview>("tires_overview", { p_organization_id: organizationId, p_filters: filters });

export const getTiresBase = (
  organizationId: string,
  filters: Filters,
  view: TiresBaseView = "frota",
  sort: string | null = null,
  dir: "asc" | "desc" = "asc",
  limit = 50,
  offset = 0,
) =>
  tiresRpc<TiresBase>("tires_base", {
    p_organization_id: organizationId,
    p_filters: filters,
    p_view: view,
    p_sort: sort,
    p_dir: dir,
    p_limit: limit,
    p_offset: offset,
  });

export const getTireSheet = (organizationId: string, tireId: string) =>
  tiresRpc<TireSheet>("tire_sheet", { p_organization_id: organizationId, p_tire_id: tireId });

export const getTiresAdherence = (
  organizationId: string,
  kind: "measurement" | "calibration",
  filters: Filters,
  pendingFilter = "all",
  limit = 50,
  offset = 0,
) =>
  tiresRpc<TiresAdherence>("tires_adherence", {
    p_organization_id: organizationId,
    p_kind: kind,
    p_filters: filters,
    p_pending_filter: pendingFilter,
    p_limit: limit,
    p_offset: offset,
  });

export const getTiresSchedule = (organizationId: string, filters: Filters, window: ScheduleWindow = "todos", limit = 50, offset = 0) =>
  tiresRpc<TiresSchedule>("tires_schedule", {
    p_organization_id: organizationId,
    p_filters: filters,
    p_window: window,
    p_limit: limit,
    p_offset: offset,
  });

export const getTiresQuality = (organizationId: string, filters: Filters, issue: string | null = null, limit = 50, offset = 0) =>
  tiresRpc<TiresQuality>("tires_quality", {
    p_organization_id: organizationId,
    p_filters: filters,
    p_issue: issue,
    p_limit: limit,
    p_offset: offset,
  });

export const getTiresEvents = (organizationId: string, filters: Filters, limit = 50, offset = 0) =>
  tiresRpc<TiresEventsList>("tires_events_list", { p_organization_id: organizationId, p_filters: filters, p_limit: limit, p_offset: offset });

export const getTiresVehicleSummary = (vehicleId: string) =>
  tiresRpc<TireVehicleSummary>("tires_vehicle_summary", { p_vehicle_id: vehicleId });

export const getTiresCatalog = (organizationId: string) => tiresRpc<TiresCatalog>("tires_catalog", { p_organization_id: organizationId });

/**
 * Dicionário de posições ativas (grupo/índice do eixo, lado, rodado, ordem):
 * é dele que o diagrama de eixos é montado — nunca de um desenho fixo. Leitura
 * direta sob a RLS de `tire_positions` (tires.view); na prévia, vem do catálogo.
 */
export async function getTirePositions(organizationId: string): Promise<TirePositionInfo[]> {
  if (tiresPreviewActive()) {
    return (await getTiresCatalog(organizationId)).positions.filter((p) => p.isActive);
  }
  const supabase = await createClient();
  type Row = { code: string; label: string; axle_group: string; axle_index: number; side: string; slot: string; sort_order: number };
  const query = (supabase.from as unknown as (t: string) => {
    select: (c: string) => { eq: (k: string, v: unknown) => { eq: (k: string, v: unknown) => { order: (c: string) => Promise<{ data: Row[] | null; error: { message: string } | null }> } } };
  })("tire_positions");
  const { data, error } = await query
    .select("code, label, axle_group, axle_index, side, slot, sort_order")
    .eq("organization_id", organizationId)
    .eq("is_active", true)
    .order("sort_order");
  if (error) throw new Error(`tire_positions: ${error.message}`);
  return (data ?? []).map((r) => ({
    code: r.code,
    label: r.label,
    axleGroup: r.axle_group as TirePositionInfo["axleGroup"],
    axleIndex: r.axle_index,
    side: r.side as TirePositionInfo["side"],
    slot: r.slot as TirePositionInfo["slot"],
    sortOrder: r.sort_order,
  }));
}

export const getTireImportHistory = (organizationId: string, limit = 20, offset = 0) =>
  tiresRpc<TireImportHistory>("tire_import_history", { p_organization_id: organizationId, p_limit: limit, p_offset: offset });

export const getTireImportPreview = (
  organizationId: string,
  batchId: string,
  section: ImportPreviewSection = "issues",
  filter: string | null = null,
  limit = 50,
  offset = 0,
) =>
  tiresRpc<TireImportPreview>("tire_import_preview", {
    p_organization_id: organizationId,
    p_batch_id: batchId,
    p_section: section,
    p_filter: filter,
    p_limit: limit,
    p_offset: offset,
  });

export const getTireInspectionsReceived = (organizationId: string, filters: Filters, limit = 50, offset = 0) =>
  tiresRpc<TiresInspectionsReceived>("tire_inspections_received", {
    p_organization_id: organizationId,
    p_filters: filters,
    p_limit: limit,
    p_offset: offset,
  });

export const getTireInspectionDetail = (organizationId: string, inspectionId: string) =>
  tiresRpc<TireInspectionDetail>("tire_inspection_detail", { p_organization_id: organizationId, p_inspection_id: inspectionId });

export const getTireRepairs = (organizationId: string, filters: Filters, limit = 50, offset = 0) =>
  tiresRpc<TiresRepairsList>("tire_repairs_list", { p_organization_id: organizationId, p_filters: filters, p_limit: limit, p_offset: offset });

export const getTireRepairSuggestion = (organizationId: string, fireNumber: string, date: string) =>
  tiresRpc<TireRepairSuggestion>("tire_repair_resolve", { p_organization_id: organizationId, p_fire_number: fireNumber, p_date: date });

export const getTireMaintenanceServices = (organizationId: string, filters: Filters, limit = 50, offset = 0) =>
  tiresRpc<TiresMaintenanceServices>("tire_maintenance_services", {
    p_organization_id: organizationId,
    p_filters: filters,
    p_limit: limit,
    p_offset: offset,
  });

export const getTiresAudit = (organizationId: string, filters: Filters, limit = 50, offset = 0) =>
  tiresRpc<TiresAuditList>("tires_audit_list", { p_organization_id: organizationId, p_filters: filters, p_limit: limit, p_offset: offset });
