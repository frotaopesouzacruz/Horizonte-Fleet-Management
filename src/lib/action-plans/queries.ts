import "server-only";

import { createClient } from "@/lib/supabase/server";
import type { Json } from "@/types/database.types";
import {
  camelize,
  DEFAULT_SETTINGS,
  type ActionPlanCatalog,
  type ActionPlanDashboard,
  type ActionPlanDetail,
  type ActionPlanFilters,
  type ActionPlanPage,
  type ActionPlanRow,
  type ActionPlanSortKey,
  type ExecutionTrace,
  type GroupRow,
  type Grouping,
  type HealthData,
  type HistoryPage,
  type MaintenanceCandidate,
  type MappingData,
  type MyReportRow,
  type MyViewData,
  type QualityData,
  type ReconciliationPage,
} from "./types";

/**
 * Leituras do Plano de Ação de Manutenção.
 *
 * Tudo é calculado no banco, sobre o mesmo filtro (`private.action_plan_filtered`)
 * e o mesmo escopo (operação do contexto gravado no plano): lista, árvores,
 * indicadores e exportação concordam entre si. O navegador só apresenta.
 */

export const DEFAULT_PAGE_SIZE = 50;

const list = (value: string | undefined): string[] =>
  (value ?? "")
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
const ints = (value: string | undefined): number[] =>
  list(value)
    .map(Number)
    .filter((n) => Number.isInteger(n));

/** Filtros da tela → chaves de `private.action_plan_filtered`. */
export function filtersPayload(f: ActionPlanFilters): Record<string, Json> {
  const out: Record<string, Json> = {};
  const put = (key: string, values: (string | number)[]) => {
    if (values.length) out[key] = values;
  };
  if (f.q?.trim()) out.search = f.q.trim();
  if (f.from) out.date_from = f.from;
  if (f.to) out.date_to = f.to;
  put("statuses", list(f.status));
  if (f.statusGroup === "open" || f.statusGroup === "closed") out.status_group = f.statusGroup;
  put("priorities", list(f.priority));
  put("operation_ids", list(f.operation));
  put("state_ids", ints(f.state));
  put("city_ids", ints(f.city));
  put("unit_ids", list(f.unit));
  put("br_ids", list(f.br));
  put("leader_ids", list(f.leader));
  put("vehicle_ids", list(f.vehicle));
  put("vehicle_type_ids", list(f.vehicleType));
  put("cluster_keys", list(f.cluster));
  put("question_keys", list(f.question));
  put("action_keys", list(f.actionKey));
  put("responsible_ids", list(f.responsible));
  if (f.unassigned) out.unassigned = true;
  if (f.withMaintenance) out.with_maintenance = f.withMaintenance === "yes";
  if (f.deadline) out.deadline = f.deadline;
  if (f.recurrence) out.recurrence = true;
  if (f.fleet && f.fleet !== "active") out.fleet_status = f.fleet;
  else out.fleet_status = f.fleet === "active" ? "active" : "all";
  if (f.mine) out.mine = true;
  return out;
}

type Rpc = (fn: string, args: Record<string, Json>) => Promise<{ data: unknown; error: { message: string } | null }>;

/** As rotinas novas ainda não estão nos tipos gerados; os nomes são fixos aqui. */
async function rpc<T>(fn: string, args: Record<string, Json>): Promise<T> {
  const supabase = await createClient();
  const { data, error } = await (supabase.rpc as unknown as Rpc)(fn, args);
  if (error) throw new Error(`${fn}: ${error.message}`);
  return camelize<T>(data);
}

export async function getActionPlanCatalog(organizationId: string): Promise<ActionPlanCatalog> {
  const raw = await rpc<ActionPlanCatalog & { settings: Partial<ActionPlanCatalog["settings"]> | null }>(
    "action_plan_catalog",
    { p_organization_id: organizationId },
  );
  return {
    appId: raw.appId ?? null,
    operations: raw.operations ?? [],
    states: raw.states ?? [],
    cities: raw.cities ?? [],
    units: raw.units ?? [],
    brs: raw.brs ?? [],
    leaders: raw.leaders ?? [],
    vehicleTypes: raw.vehicleTypes ?? [],
    clusters: raw.clusters ?? [],
    actionKeys: raw.actionKeys ?? [],
    responsibles: raw.responsibles ?? [],
    settings: { ...DEFAULT_SETTINGS, ...(raw.settings ?? {}) },
  };
}

export async function listActionPlans(
  organizationId: string,
  filters: ActionPlanFilters,
  sort: ActionPlanSortKey = "priority",
  dir: "asc" | "desc" = "desc",
  page = 1,
  pageSize = DEFAULT_PAGE_SIZE,
): Promise<ActionPlanPage> {
  const raw = await rpc<ActionPlanPage>("action_plan_list", {
    p_organization_id: organizationId,
    p_filters: filtersPayload(filters),
    p_sort: sort,
    p_dir: dir,
    p_limit: pageSize,
    p_offset: (Math.max(1, page) - 1) * pageSize,
  });
  return { ...raw, rows: raw.rows ?? [] };
}

export async function getActionPlanGroups(organizationId: string, filters: ActionPlanFilters, grouping: Grouping): Promise<GroupRow[]> {
  const raw = await rpc<{ rows: GroupRow[] }>("action_plan_groups", {
    p_organization_id: organizationId,
    p_filters: filtersPayload(filters),
    p_grouping: grouping,
  });
  return raw.rows ?? [];
}

export async function getActionPlanDashboard(organizationId: string, filters: ActionPlanFilters): Promise<ActionPlanDashboard> {
  return rpc<ActionPlanDashboard>("action_plan_dashboard", {
    p_organization_id: organizationId,
    p_filters: filtersPayload(filters),
  });
}

export async function getActionPlanDetail(planId: string): Promise<ActionPlanDetail> {
  return rpc<ActionPlanDetail>("action_plan_detail", { p_plan_id: planId });
}

export async function getMaintenanceCandidates(planId: string): Promise<MaintenanceCandidate[]> {
  return (await rpc<MaintenanceCandidate[] | null>("action_plan_maintenance_candidates", { p_plan_id: planId })) ?? [];
}

export async function getReconciliation(
  organizationId: string,
  filters: ActionPlanFilters,
  confidence: string | null,
  page = 1,
  pageSize = DEFAULT_PAGE_SIZE,
): Promise<ReconciliationPage> {
  const raw = await rpc<ReconciliationPage>("action_plan_reconciliation", {
    p_organization_id: organizationId,
    p_filters: filtersPayload(filters),
    p_confidence: confidence,
    p_limit: pageSize,
    p_offset: (Math.max(1, page) - 1) * pageSize,
  });
  return { ...raw, rows: raw.rows ?? [], counts: raw.counts ?? {} };
}

export async function getMapping(organizationId: string): Promise<MappingData> {
  const raw = await rpc<MappingData & { settings: Partial<MappingData["settings"]> | null }>("action_plan_mapping", {
    p_organization_id: organizationId,
  });
  return { rows: raw.rows ?? [], coverage: raw.coverage, settings: { ...DEFAULT_SETTINGS, ...(raw.settings ?? {}) } };
}

export async function getQuality(organizationId: string): Promise<QualityData> {
  const raw = await rpc<QualityData>("action_plan_quality", { p_organization_id: organizationId });
  return { checks: raw.checks ?? [], events: raw.events ?? [] };
}

export async function getHealth(organizationId: string, days = 30): Promise<HealthData> {
  return rpc<HealthData>("action_plan_health", { p_organization_id: organizationId, p_days: days });
}

export async function getMyView(organizationId: string): Promise<MyViewData> {
  return rpc<MyViewData>("action_plan_my_view", { p_organization_id: organizationId });
}

export async function getMyReports(organizationId: string, days = 90): Promise<{ employeeId: string | null; rows: MyReportRow[] }> {
  const raw = await rpc<{ employeeId: string | null; rows: MyReportRow[] | null }>("action_plan_my_reports", {
    p_organization_id: organizationId,
    p_days: days,
  });
  return { employeeId: raw.employeeId, rows: raw.rows ?? [] };
}

export async function getVehicleActionPlans(vehicleId: string): Promise<ActionPlanRow[]> {
  const raw = await rpc<{ rows: ActionPlanRow[] | null }>("action_plan_vehicle", { p_vehicle_id: vehicleId });
  return raw.rows ?? [];
}

export interface HistoryFilters {
  from?: string;
  to?: string;
  q?: string;
  vehicle?: string;
  operation?: string;
  employee?: string;
}

export async function getChecklistHistory(
  organizationId: string,
  f: HistoryFilters,
  page = 1,
  pageSize = DEFAULT_PAGE_SIZE,
): Promise<HistoryPage> {
  const filters: Record<string, Json> = {};
  if (f.from) filters.date_from = f.from;
  if (f.to) filters.date_to = f.to;
  if (f.q?.trim()) filters.search = f.q.trim();
  if (list(f.vehicle).length) filters.vehicle_ids = list(f.vehicle);
  if (list(f.operation).length) filters.operation_ids = list(f.operation);
  if (list(f.employee).length) filters.employee_ids = list(f.employee);
  const raw = await rpc<HistoryPage>("action_plan_checklist_history", {
    p_organization_id: organizationId,
    p_filters: filters,
    p_limit: pageSize,
    p_offset: (Math.max(1, page) - 1) * pageSize,
  });
  return { ...raw, rows: raw.rows ?? [] };
}

export async function getExecutionTrace(executionId: string): Promise<ExecutionTrace> {
  return rpc<ExecutionTrace>("action_plan_execution_trace", { p_execution_id: executionId });
}

export interface ExportItemRow {
  planCode: string;
  planStatus: string;
  priority: string;
  title: string;
  detailLabel: string | null;
  clusterName: string | null;
  actionKey: string;
  licensePlate: string | null;
  fleetCode: string | null;
  operationalDate: string;
  checklistType: string | null;
  question: string;
  answer: string;
  optionLabel: string | null;
  detailText: string | null;
  note: string | null;
  employeeName: string | null;
  employeeCode: string | null;
  operationName: string | null;
  cityName: string | null;
  brCode: string | null;
  leaderName: string | null;
  itemStatus: string;
  resolvedAt: string | null;
  resolution: string | null;
  resolutionReason: string | null;
  maintenances: string | null;
}

/** Apontamentos dos planos filtrados, em páginas (a exportação percorre todas). */
export async function exportActionPlanItems(
  organizationId: string,
  filters: ActionPlanFilters,
  limit = 2000,
  offset = 0,
): Promise<{ total: number; rows: ExportItemRow[] }> {
  const raw = await rpc<{ total: number; rows: ExportItemRow[] | null }>("action_plan_export_items", {
    p_organization_id: organizationId,
    p_filters: filtersPayload(filters),
    p_limit: limit,
    p_offset: offset,
  });
  return { total: raw.total, rows: raw.rows ?? [] };
}
