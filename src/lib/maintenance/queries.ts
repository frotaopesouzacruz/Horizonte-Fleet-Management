import "server-only";

import { createClient } from "@/lib/supabase/server";
import { normalizeLabel } from "@/lib/fleet/queries";
import { getGovernanceOptions } from "@/lib/governance/queries";
import type { Json } from "@/types/database.types";
import {
  camelize,
  DEFAULT_SETTINGS,
  type ChecklistFinding,
  type HierarchyNode,
  type MaintenanceCatalog,
  type MaintenanceDashboard,
  type MaintenanceDetail,
  type MaintenanceFilters,
  type MaintenancePage,
  type MaintenanceParameters,
  type MaintenanceSettings,
  type MaintenanceSortKey,
  type PredictiveCycleHistory,
  type PredictiveOverview,
  type PreventiveMatrix,
  type ScheduleKpis,
  type VehicleContext,
  type VehicleMaintenanceHistory,
  type VehicleOption,
} from "./types";

/**
 * Leituras da Manutenção (Etapa 16).
 *
 * Tudo passa por rotinas do banco. As listas e os indicadores são calculados
 * lá, sobre a mesma função de filtro (`private.maintenance_filtered`), sob a
 * RLS da pessoa: o escopo por organização, operação e veículo vale igual para
 * a tabela, os cartões e a exportação. O navegador nunca recalcula TMM, KM,
 * banda preventiva ou status preditivo — só apresenta.
 */

const list = (value: string | undefined): string[] =>
  (value ?? "")
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
const ints = (value: string | undefined): number[] =>
  list(value)
    .map(Number)
    .filter((n) => Number.isInteger(n));

/** Filtros da tela → chaves de `private.maintenance_filtered`. Vários valores: separados por vírgula. */
export function filtersPayload(f: MaintenanceFilters): Record<string, Json> {
  const out: Record<string, Json> = {};
  const put = (key: string, values: (string | number)[]) => {
    if (values.length) out[key] = values;
  };
  if (f.q?.trim()) out.search = f.q.trim();
  put("statuses", list(f.status));
  put("types", list(f.type));
  put("origin_ids", list(f.origin));
  put("priorities", list(f.priority));
  put("vehicle_ids", list(f.vehicle));
  put("vehicle_type_ids", list(f.vehicleType));
  put("operation_ids", list(f.operation));
  put("state_ids", ints(f.state));
  put("city_ids", ints(f.city));
  put("br_ids", list(f.br));
  put("leader_ids", list(f.leader));
  put("unit_ids", list(f.unit));
  put("supplier_ids", list(f.supplier));
  put("cluster_ids", list(f.cluster));
  put("service_ids", list(f.service));
  put("km_statuses", list(f.km));
  if (f.from) out.date_from = f.from;
  if (f.to) out.date_to = f.to;
  if (f.fleet && f.fleet !== "active") out.fleet_status = f.fleet;
  if (f.openOnly) out.open_only = true;
  if (f.queue) out.queue = f.queue;
  return out;
}

function fail(scope: string, error: { message: string }): never {
  throw new Error(`${scope}: ${error.message}`);
}

// ---------------------------------------------------------------------------
// Catálogo e parâmetros
// ---------------------------------------------------------------------------
export async function getMaintenanceCatalog(organizationId: string): Promise<MaintenanceCatalog> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("maintenance_catalog", { p_organization_id: organizationId });
  if (error) fail("maintenance_catalog", error);
  const raw = camelize<Omit<MaintenanceCatalog, "settings"> & { settings: Partial<MaintenanceSettings> | null }>(data);
  return {
    types: raw.types ?? [],
    origins: raw.origins ?? [],
    clusters: raw.clusters ?? [],
    services: raw.services ?? [],
    suppliers: raw.suppliers ?? [],
    // Sem linha de configuração, valem os padrões do banco.
    settings: { ...DEFAULT_SETTINGS, ...(raw.settings ?? {}) },
  };
}

export async function getMaintenanceParameters(organizationId: string): Promise<MaintenanceParameters> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("maintenance_parameters", { p_organization_id: organizationId });
  if (error) fail("maintenance_parameters", error);
  const raw = camelize<Partial<MaintenanceParameters>>(data);
  return { preventiveRules: raw.preventiveRules ?? [], predictivePlans: raw.predictivePlans ?? [] };
}

export interface FilterOption {
  id: string;
  name: string;
}
export interface MaintenanceFilterOptions {
  operations: FilterOption[];
  coverage: { operationId: string; stateId: number; uf: string; cityId: number; cityName: string }[];
  brs: { id: string; code: string; operationId: string; cityId: number | null }[];
  leaders: FilterOption[];
  vehicleTypes: FilterOption[];
  subcategories: (FilterOption & { vehicleTypeId: string })[];
  makes: FilterOption[];
  models: (FilterOption & { makeId: string })[];
  units: FilterOption[];
  apps: FilterOption[];
}

/**
 * Tudo o que os filtros e formulários oferecem, das fontes oficiais: operações
 * e sua cobertura geográfica, BRs, lideranças vigentes, tipos, subcategorias,
 * marcas, modelos e filiais. Nenhuma lista paralela.
 */
export async function getMaintenanceFilterOptions(organizationId: string): Promise<MaintenanceFilterOptions> {
  const supabase = await createClient();
  const alive = { organization_id: organizationId };
  // Operações e cobertura geográfica vêm da mesma leitura dos demais módulos
  // (operation_cities não tem chave para `states`; a UF chega pela cidade).
  const [governance, brs, leaders, types, subcategories, makes, models, units, apps] = await Promise.all([
    getGovernanceOptions(organizationId),
    supabase
      .from("operation_brs")
      .select("id, code, operation_id, city_id")
      .match(alive)
      .is("deleted_at", null)
      .order("code"),
    supabase
      .from("leadership_assignments")
      .select("employee_id, employees(full_name)")
      .match(alive)
      .eq("status", "active")
      .eq("responsibility_type", "principal"),
    supabase.rpc("list_equipment_types", { p_organization_id: organizationId, p_filters: {} }),
    supabase
      .from("vehicle_subcategories")
      .select("id, name, vehicle_type_id")
      .or(`organization_id.is.null,organization_id.eq.${organizationId}`)
      .eq("is_active", true)
      .is("deleted_at", null)
      .order("name"),
    supabase.from("vehicle_makes").select("id, name").match(alive).eq("is_active", true).order("name"),
    supabase.from("vehicle_models").select("id, name, vehicle_make_id").match(alive).eq("is_active", true).order("name"),
    supabase.from("organization_units").select("id, name, code").match(alive).is("deleted_at", null).order("name"),
    supabase
      .from("operational_apps")
      .select("id, name")
      .or(`organization_id.is.null,organization_id.eq.${organizationId}`)
      .is("deleted_at", null)
      .order("name"),
  ]);

  const seenLeaders = new Map<string, string>();
  for (const row of leaders.data ?? []) {
    const employee = row.employees as { full_name?: string } | null;
    if (row.employee_id && !seenLeaders.has(row.employee_id)) seenLeaders.set(row.employee_id, employee?.full_name ?? "—");
  }

  return {
    operations: governance.operations.map((o) => ({ id: o.id, name: o.name })),
    coverage: governance.coverage.map((c) => ({
      operationId: c.operationId,
      stateId: c.stateId,
      uf: c.uf,
      cityId: c.cityId,
      cityName: c.cityName,
    })),
    brs: (brs.data ?? []).map((b) => ({
      id: b.id,
      code: b.code,
      operationId: b.operation_id,
      cityId: b.city_id == null ? null : Number(b.city_id),
    })),
    leaders: [...seenLeaders.entries()]
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name, "pt-BR")),
    vehicleTypes: ((types.data ?? []) as { id: string; name: string; effective_status?: string }[])
      .filter((t) => t.effective_status !== "inactive")
      .map((t) => ({ id: t.id, name: t.name })),
    subcategories: (subcategories.data ?? []).map((s) => ({ id: s.id, name: s.name, vehicleTypeId: s.vehicle_type_id })),
    makes: (makes.data ?? []).map((m) => ({ id: m.id, name: m.name })),
    models: (models.data ?? []).map((m) => ({ id: m.id, name: m.name, makeId: m.vehicle_make_id })),
    units: (units.data ?? []).map((u) => ({ id: u.id, name: u.code ? `${u.code} · ${u.name}` : u.name })),
    apps: (apps.data ?? []).map((a) => ({ id: a.id, name: a.name })),
  };
}

// ---------------------------------------------------------------------------
// Base e programação
// ---------------------------------------------------------------------------
export const DEFAULT_PAGE_SIZE = 50;

export async function listMaintenances(
  organizationId: string,
  filters: MaintenanceFilters,
  options: { sort?: MaintenanceSortKey; dir?: "asc" | "desc"; page?: number; pageSize?: number } = {},
): Promise<MaintenancePage> {
  const pageSize = Math.min(Math.max(options.pageSize ?? DEFAULT_PAGE_SIZE, 10), 1000);
  const page = Math.max(options.page ?? 1, 1);
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("maintenance_list", {
    p_organization_id: organizationId,
    p_filters: filtersPayload(filters),
    p_sort: options.sort ?? "reference",
    p_dir: options.dir ?? "desc",
    p_limit: pageSize,
    p_offset: (page - 1) * pageSize,
  });
  if (error) fail("maintenance_list", error);
  const raw = camelize<Partial<MaintenancePage>>(data);
  return { total: raw.total ?? 0, rows: raw.rows ?? [], limit: raw.limit ?? pageSize, offset: raw.offset ?? 0, today: raw.today ?? "" };
}

export async function getScheduleKpis(organizationId: string, filters: MaintenanceFilters): Promise<ScheduleKpis> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("maintenance_schedule_kpis", {
    p_organization_id: organizationId,
    p_filters: filtersPayload(filters),
  });
  if (error) fail("maintenance_schedule_kpis", error);
  return camelize<ScheduleKpis>(data);
}

/** Nós da hierarquia pelos níveis escolhidos; o servidor agrupa e conta, a tela só monta a árvore. */
export async function getMaintenanceHierarchy(
  organizationId: string,
  filters: MaintenanceFilters,
  levels: HierarchyLevel[],
): Promise<HierarchyNode[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("maintenance_hierarchy", {
    p_organization_id: organizationId,
    p_filters: { ...filtersPayload(filters), levels },
  });
  if (error) fail("maintenance_hierarchy", error);
  return camelize<HierarchyNode[]>(data ?? []);
}

export async function getMaintenanceDetail(maintenanceId: string): Promise<MaintenanceDetail | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("maintenance_detail", { p_maintenance_id: maintenanceId });
  if (error) {
    if (error.code === "P0002" || error.code === "42501") return null;
    fail("maintenance_detail", error);
  }
  return data ? camelize<MaintenanceDetail>(data) : null;
}

export async function getVehicleMaintenanceHistory(vehicleId: string): Promise<VehicleMaintenanceHistory | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("vehicle_maintenance_history", { p_vehicle_id: vehicleId });
  if (error) {
    if (error.code === "P0002" || error.code === "42501") return null;
    fail("vehicle_maintenance_history", error);
  }
  return data ? camelize<VehicleMaintenanceHistory>(data) : null;
}

// ---------------------------------------------------------------------------
// Visão geral, preventiva, preditiva
// ---------------------------------------------------------------------------
export async function getMaintenanceDashboard(organizationId: string, filters: MaintenanceFilters): Promise<MaintenanceDashboard> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("maintenance_dashboard", {
    p_organization_id: organizationId,
    p_filters: filtersPayload(filters),
  });
  if (error) fail("maintenance_dashboard", error);
  return camelize<MaintenanceDashboard>(data);
}

export interface PreventiveFilters {
  situation?: "active" | "inactive";
  q?: string;
  vehicleType?: string;
  model?: string;
  operation?: string;
  city?: string;
  br?: string;
  status?: string;
}

export async function getPreventiveMatrix(organizationId: string, f: PreventiveFilters): Promise<PreventiveMatrix> {
  const payload: Record<string, Json> = { situation: f.situation ?? "active" };
  if (f.q?.trim()) payload.search = f.q.trim();
  if (f.vehicleType) payload.vehicle_type_ids = list(f.vehicleType);
  if (f.model) payload.model_ids = list(f.model);
  if (f.operation) payload.operation_ids = list(f.operation);
  if (f.city) payload.city_ids = ints(f.city);
  if (f.br) payload.br_ids = list(f.br);
  if (f.status) payload.statuses = list(f.status);
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("maintenance_preventive_matrix", {
    p_organization_id: organizationId,
    p_filters: payload,
  });
  if (error) fail("maintenance_preventive_matrix", error);
  return camelize<PreventiveMatrix>(data);
}

export interface PredictiveFilters {
  q?: string;
  operation?: string;
  cluster?: string;
  status?: string;
  execution?: string;
  vehicle?: string;
}

export async function getPredictiveOverview(organizationId: string, f: PredictiveFilters): Promise<PredictiveOverview> {
  const payload: Record<string, Json> = {};
  if (f.q?.trim()) payload.search = f.q.trim();
  if (f.operation) payload.operation_ids = list(f.operation);
  if (f.cluster) payload.cluster_ids = list(f.cluster);
  if (f.status) payload.statuses = list(f.status);
  if (f.execution) payload.execution = list(f.execution);
  if (f.vehicle) payload.vehicle_ids = list(f.vehicle);
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("maintenance_predictive_overview", {
    p_organization_id: organizationId,
    p_filters: payload,
  });
  if (error) fail("maintenance_predictive_overview", error);
  return camelize<PredictiveOverview>(data);
}

export async function getPredictiveCycleHistory(cycleId: string): Promise<PredictiveCycleHistory | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("maintenance_predictive_cycle_history", { p_cycle_id: cycleId });
  if (error) {
    if (error.code === "P0002" || error.code === "42501") return null;
    fail("maintenance_predictive_cycle_history", error);
  }
  return data ? camelize<PredictiveCycleHistory>(data) : null;
}

// ---------------------------------------------------------------------------
// Abertura
// ---------------------------------------------------------------------------
export async function getVehicleContext(vehicleId: string, date?: string | null): Promise<VehicleContext> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("maintenance_vehicle_context", {
    p_vehicle_id: vehicleId,
    p_date: date ?? undefined,
  });
  if (error) fail("maintenance_vehicle_context", error);
  return camelize<VehicleContext>(data);
}

export async function getVehicleFindings(vehicleId: string, days = 60): Promise<ChecklistFinding[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("maintenance_vehicle_findings", { p_vehicle_id: vehicleId, p_days: days });
  if (error) fail("maintenance_vehicle_findings", error);
  return camelize<ChecklistFinding[]>(data ?? []);
}

/** Busca de veículo para o assistente: placa, frota, modelo — pela RLS da frota. */
export async function searchVehicles(organizationId: string, term: string, limit = 20): Promise<VehicleOption[]> {
  const clean = term.replace(/[(),*]/g, " ").trim();
  if (clean.length < 2) return [];
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("vehicle_directory")
    .select("id, license_plate, fleet_code, vehicle_type_name, status")
    .eq("organization_id", organizationId)
    .is("deleted_at", null)
    .or([`search_text.ilike.%${normalizeLabel(clean)}%`, `license_plate.ilike.%${clean.toUpperCase().replace(/[^A-Z0-9]/g, "")}%`].join(","))
    .order("fleet_code")
    .limit(Math.min(Math.max(limit, 1), 50));
  if (error) fail("vehicle_directory", error);
  return (data ?? []).map((v) => ({
    id: v.id as string,
    licensePlate: v.license_plate,
    fleetCode: v.fleet_code,
    typeName: v.vehicle_type_name,
    status: v.status as string,
  }));
}

// ---------------------------------------------------------------------------
// Importações
// ---------------------------------------------------------------------------
export interface MaintenanceImportHistoryRow {
  id: string;
  kind: string | null;
  fileName: string | null;
  status: string;
  totalRows: number;
  createdRows: number;
  updatedRows: number;
  skippedRows: number;
  errorRows: number;
  createdAt: string;
  processedAt: string | null;
  createdByName: string | null;
  summary: Record<string, unknown>;
}

export async function getMaintenanceImportHistory(organizationId: string, limit = 30): Promise<MaintenanceImportHistoryRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("maintenance_import_history", { p_organization_id: organizationId, p_limit: limit });
  if (error) fail("maintenance_import_history", error);
  return camelize<MaintenanceImportHistoryRow[]>(data ?? []);
}

export interface ChecklistQuestionOption {
  appId: string;
  appName: string;
  questionKey: string;
  questionText: string;
  clusterName: string | null;
  versionLabel: string | null;
  fields: { fieldKey: string; label: string }[];
}

/** Perguntas do Check List (chave estável por aplicativo) para o mapeamento Serviços × Check List. */
export async function getChecklistQuestions(organizationId: string): Promise<ChecklistQuestionOption[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("maintenance_checklist_questions", { p_organization_id: organizationId });
  if (error) fail("maintenance_checklist_questions", error);
  return camelize<ChecklistQuestionOption[]>(data ?? []);
}
