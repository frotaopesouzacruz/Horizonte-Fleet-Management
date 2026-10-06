import "server-only";

import { createClient } from "@/lib/supabase/server";
import type { Json } from "@/types/database.types";
import { tiresPreviewActive, tiresRpc } from "./rpc";
import { camelize as camelizeRow } from "@/lib/maintenance/types";
import type {
  ImportPreviewSection,
  ScheduleWindow,
  TireFilterOptions,
  TireImportHistory,
  TireImportPreview,
  TireInspectionDetail,
  TireOverviewV2,
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
  AuditGroupBy,
  KpiDimension,
  KpiIndicator,
  KpiPeriod,
  KpiSchedule,
  TireIndicatorKey,
  TireSyncSource,
  TiresAuditCenter,
  TiresBaseGroups,
  TiresDefinitions,
  TiresGroupBy,
  TiresIndicator,
  TiresKpiHistory,
  TiresPriorities,
  TiresSyncOverview,
} from "./types";

/**
 * Leituras da Gestão de Pneus. Tudo passa por rotinas do banco sobre a mesma
 * avaliação dos dados (`private.tire_rows`), sob a RLS da pessoa: o
 * escopo por organização, operação e veículo vale igual para a visão geral,
 * a base, as aderências, a ficha e a exportação.
 */
type Filters = Record<string, Json>;

export const getTiresFilterOptions = (organizationId: string, referenceDate?: string | null) =>
  tiresRpc<TireFilterOptions>("tires_filter_options", { p_organization_id: organizationId, p_reference_date: referenceDate ?? null });

export const getTiresOverview = (organizationId: string, filters: Filters) =>
  tiresRpc<TireOverviewV2>("tires_overview", { p_organization_id: organizationId, p_filters: filters });

export const getTiresPriorities = (
  organizationId: string,
  filters: Filters,
  groupBy: TiresGroupBy = "operation",
  groupId: string | null = null,
  limit = 25,
  offset = 0,
) =>
  tiresRpc<TiresPriorities>("tires_priorities", {
    p_organization_id: organizationId,
    p_filters: filters,
    p_group_by: groupBy,
    p_group_id: groupId,
    p_limit: limit,
    p_offset: offset,
  });

export const getTiresIndicator = (
  organizationId: string,
  indicator: TireIndicatorKey,
  filters: Filters,
  status: string | null = null,
  limit = 50,
  offset = 0,
) =>
  tiresRpc<TiresIndicator>("tires_indicator", {
    p_organization_id: organizationId,
    p_indicator: indicator,
    p_filters: filters,
    p_status: status,
    p_limit: limit,
    p_offset: offset,
  });

export const getTiresBaseGroups = (organizationId: string, filters: Filters, groupBy: TiresGroupBy) =>
  tiresRpc<TiresBaseGroups>("tires_base_groups", { p_organization_id: organizationId, p_filters: filters, p_group_by: groupBy });

export const getTiresKpiHistory = (
  organizationId: string,
  period: KpiPeriod = "semana",
  indicator: KpiIndicator = "overall_conformity",
  dimension: KpiDimension = "geral",
  dimensionId: string | null = null,
  limit = 26,
) =>
  tiresRpc<TiresKpiHistory>("tires_kpi_history", {
    p_organization_id: organizationId,
    p_period: period,
    p_indicator: indicator,
    p_dimension: dimension,
    p_dimension_id: dimensionId,
    p_limit: limit,
  });

export const getTiresAuditCenter = (
  organizationId: string,
  filters: Filters,
  opts: { category?: string | null; rule?: string | null; severity?: string | null; status?: string; groupBy?: AuditGroupBy; limit?: number; offset?: number } = {},
) =>
  tiresRpc<TiresAuditCenter>("tires_audit_center", {
    p_organization_id: organizationId,
    p_filters: filters,
    p_category: opts.category ?? null,
    p_rule: opts.rule ?? null,
    p_severity: opts.severity ?? null,
    p_status: opts.status ?? "aberta",
    p_group_by: opts.groupBy ?? "rule",
    p_limit: opts.limit ?? 50,
    p_offset: opts.offset ?? 0,
  });

export const getTiresSyncOverview = (organizationId: string, limit = 20, offset = 0) =>
  tiresRpc<TiresSyncOverview>("tire_sync_overview", { p_organization_id: organizationId, p_limit: limit, p_offset: offset });

export const getTiresDefinitions = (organizationId: string) =>
  tiresRpc<TiresDefinitions>("tires_definitions", { p_organization_id: organizationId });

/** Local da fonte oficial (sem segredo) para Parâmetros; null sem permissão de leitura. */
export async function getTireSyncSource(organizationId: string): Promise<TireSyncSource | null> {
  if (tiresPreviewActive()) return (await getTiresSyncOverview(organizationId)).source;
  const supabase = await createClient();
  const query = (supabase.from as unknown as (t: string) => {
    select: (c: string) => { eq: (k: string, v: unknown) => { maybeSingle: () => Promise<{ data: Record<string, unknown> | null; error: { message: string } | null }> } };
  })("tire_sync_sources");
  const { data, error } = await query.select("*").eq("organization_id", organizationId).maybeSingle();
  if (error) throw new Error(`tire_sync_sources: ${error.message}`);
  return data ? camelizeRow<TireSyncSource>(data) : null;
}

/** Agenda da captura de indicadores (Parâmetros). */
export async function getTireKpiSchedule(organizationId: string): Promise<KpiSchedule | null> {
  if (tiresPreviewActive()) return (await getTiresKpiHistory(organizationId)).schedule;
  const supabase = await createClient();
  const query = (supabase.from as unknown as (t: string) => {
    select: (c: string) => { eq: (k: string, v: unknown) => { maybeSingle: () => Promise<{ data: Record<string, unknown> | null; error: { message: string } | null }> } };
  })("tire_kpi_schedules");
  const { data, error } = await query.select("*").eq("organization_id", organizationId).maybeSingle();
  if (error) throw new Error(`tire_kpi_schedules: ${error.message}`);
  return data ? { ...camelizeRow<KpiSchedule>(data), nextSlotAt: null } : null;
}

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
