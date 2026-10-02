import "server-only";

import { createClient } from "@/lib/supabase/server";
import type { Json } from "@/types/database.types";
import type { KmLoadContext } from "./context";
import { kmRpc, kmRpcRaw } from "./rpc";
import { camelize } from "./types";
import { firstParam } from "./url";

/**
 * Gestão de KM → Plano de rodízio.
 *
 * O rodízio só SUGERE: as sugestões (`km_rotation_candidates`), a simulação de
 * um par e a avaliação pós-rodízio vêm prontas do banco. Nada é movimentado
 * sem aprovação, e a Fidelização só muda pela ação explícita "Aplicar na
 * Fidelização" (prévia + confirmação). A tela só apresenta.
 *
 * Estado da aba na URL: `sub` (sugestoes | planos), `horizonte` (30|60|90),
 * `escopo`, `locais` ("0" desliga "somente locais diferentes") e `plano`
 * (plano aberto).
 */

export type KmRotationSub = "sugestoes" | "planos";
export type KmRotationScopeMode = "same_cohort_same_operation" | "same_cohort_global";
export type KmRotationHorizon = 30 | 60 | 90;
export type KmRotationPriority = "high" | "medium" | "low" | "none";
export type KmRotationStatus = "suggested" | "approved" | "scheduled" | "executed" | "cancelled";

/** Retrato de um veículo no período analisado (devolvido pela rotina). */
export interface KmRotationVehicle {
  vehicleId: string;
  plate: string;
  fleetCode?: string | null;
  status?: string | null;
  type?: string | null;
  subcategory?: string | null;
  model?: string | null;
  vehicleTypeId?: string | null;
  subcategoryId?: string | null;
  modelId?: string | null;
  operationId?: string | null;
  operation?: string | null;
  cityId?: number | null;
  local?: string | null;
  operationBrId?: string | null;
  br?: string | null;
  odometer?: number | null;
  kmPeriod?: number | null;
  dailyAvg?: number | null;
  kmMonth?: number | null;
  percentile?: number | null;
  coveragePct?: number | null;
  quadrant?: string | null;
  preventive?: { cycleNumber?: number | null; milestoneKm?: number | null; kmRemaining?: number | null } | null;
  maintenanceOpen?: "in_progress" | "scheduled" | string | null;
}

export interface KmRotationCohort {
  key: string;
  label: string;
  size?: number | null;
  dailyMedian?: number | null;
  kmMonthMedian?: number | null;
  odometerMedian?: number | null;
}

export interface KmRotationScenario {
  horizonDays: number;
  without: { gap: number | null; odometerA: number | null; odometerB: number | null };
  with: { gap: number | null; odometerA: number | null; odometerB: number | null };
  reductionKm: number | null;
  reductionPct: number | null;
}

/** Uma sugestão de troca (A ⇄ B) — também o formato da simulação de um par. */
export interface KmRotationCandidate {
  key: string;
  vehicleAId: string;
  vehicleBId: string;
  cohortKey: string;
  cohortLabel: string;
  cohort: KmRotationCohort | null;
  vehicleA: KmRotationVehicle;
  vehicleB: KmRotationVehicle;
  gapCurrent: number | null;
  gapWithout: number | null;
  gapWith: number | null;
  reductionKm: number | null;
  reductionPct: number | null;
  intensityReductionAPct: number | null;
  priority: KmRotationPriority;
  conditioned: boolean;
  conditionReasons: string[];
  scenarios: KmRotationScenario[];
  justification: string | null;
}

export interface KmRotationGroup {
  key: string;
  label: string;
  vehicles: number;
  suggestions: number;
  kmMonthAvg: number | null;
  kmMonthMax: number | null;
  kmMonthMin: number | null;
  odometerAvg: number | null;
  odometerRange: number | null;
}

export interface KmRotationSummary {
  candidates: number;
  high: number;
  medium: number;
  low: number;
  conditioned: number;
  reductionKmTotal: number | null;
  avgGapCurrent: number | null;
  avgReductionPct: number | null;
  vehiclesAnalyzed: number;
  cohorts: number;
}

export interface KmRotationCandidates {
  period: { from: string; to: string };
  horizonDays: number;
  scopeMode: KmRotationScopeMode;
  differentLocationsOnly: boolean;
  dataAsOf: string | null;
  generatedAt: string;
  summary: KmRotationSummary;
  groups: KmRotationGroup[];
  items: KmRotationCandidate[];
}

/** `km_simulate_rotation`: o par avaliado, ou `error` quando não há dados. */
export type KmRotationSimulation = Partial<Omit<KmRotationCandidate, "key">> & {
  error?: string;
  sameCohort?: boolean;
  horizonDays?: number;
  period?: { from: string; to: string };
};

export interface KmRotationPlanRow {
  id: string;
  code: string;
  name: string;
  notes: string | null;
  status: KmRotationStatus;
  items: number;
  executed: number;
  periodFrom: string;
  periodTo: string;
  horizonDays: number;
  scopeMode: KmRotationScopeMode;
  differentLocationsOnly: boolean;
  dataAsOf: string | null;
  analyzedAt: string | null;
  revalidatedAt: string | null;
  createdAt: string;
  createdByName: string | null;
  avgReductionPct: number | null;
  reductionKm: number | null;
  staleDays: number | null;
}

export interface KmRotationEvaluation {
  result: "converging" | "not_converging" | "insufficient_data" | string;
  executionDate: string | null;
  daysSince: number | null;
  gapAtExecution: number | null;
  gapNow: number | null;
  gapChange: number | null;
  aDailyBefore: number | null;
  bDailyBefore: number | null;
  aDailyAfter: number | null;
  bDailyAfter: number | null;
  aDaysAfter: number | null;
  bDaysAfter: number | null;
}

export interface KmRotationItemSnapshot {
  vehicleA?: KmRotationVehicle;
  vehicleB?: KmRotationVehicle;
  cohort?: KmRotationCohort;
  scenarios?: KmRotationScenario[];
  conditioned?: boolean;
  conditionReasons?: string[];
  intensityReductionAPct?: number | null;
  previous?: { priority?: KmRotationPriority | null; reductionPct?: number | null } | null;
  revalidationNote?: string | null;
}

export interface KmRotationItem {
  id: string;
  planId: string;
  itemNumber: number;
  status: KmRotationStatus;
  priority: KmRotationPriority;
  vehicleAId: string;
  vehicleBId: string;
  cohortKey: string | null;
  cohortLabel: string | null;
  snapshot: KmRotationItemSnapshot | null;
  gapCurrentKm: number | null;
  gapFutureWithoutKm: number | null;
  gapFutureWithKm: number | null;
  reductionKm: number | null;
  reductionPct: number | null;
  justification: string | null;
  notes: string | null;
  effectiveDate: string | null;
  responsibleEmployeeId: string | null;
  responsibleName: string | null;
  executionDate: string | null;
  executedAt: string | null;
  executionOdometerA: number | null;
  executionOdometerB: number | null;
  cancelledReason: string | null;
  revalidatedAt: string | null;
  fidelizationAppliedAt: string | null;
  fidelizationPayload: { effectiveDate?: string | null; reason?: string | null } | null;
  inScope: boolean;
  evaluation: KmRotationEvaluation | null;
  createdAt: string;
  updatedAt: string;
}

export interface KmRotationEvent {
  id: string;
  itemId: string | null;
  eventType: string;
  fromStatus: string | null;
  toStatus: string | null;
  reason: string | null;
  payload: Record<string, unknown> | null;
  actorName: string | null;
  occurredAt: string;
}

export interface KmRotationPlan {
  id: string;
  code: string;
  name: string;
  notes: string | null;
  status: KmRotationStatus;
  periodFrom: string;
  periodTo: string;
  horizonDays: number;
  scopeMode: KmRotationScopeMode;
  differentLocationsOnly: boolean;
  dataAsOf: string | null;
  analyzedAt: string | null;
  revalidatedAt: string | null;
  approvedAt: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  createdAt: string;
  createdByName: string | null;
  stale: boolean;
  staleDays: number | null;
  staleLimitDays: number | null;
}

export interface KmRotationPlanDetail {
  plan: KmRotationPlan;
  items: KmRotationItem[];
  events: KmRotationEvent[];
  permissions: {
    create: boolean;
    approve: boolean;
    schedule: boolean;
    execute: boolean;
    applyFidelization: boolean;
  };
  /** Filtros gravados no plano, no formato da rotina (para simular de novo com dados atuais). */
  filtersRaw: Record<string, Json>;
}

export interface KmRotationEmployee {
  id: string;
  name: string;
}

export interface KmRotationParams {
  sub: KmRotationSub;
  horizon: KmRotationHorizon;
  scope: KmRotationScopeMode;
  differentLocations: boolean;
  planId: string | null;
}

export interface KmRotationData {
  params: KmRotationParams;
  /** Período analisado pelas sugestões (para a barra de filtros) e o "hoje" da organização. */
  period: { from?: string; to?: string; today: string };
  /** Filtros da tela no formato das rotinas (ids) — os mesmos das sugestões. */
  filtersPayload: Record<string, Json>;
  candidates: KmRotationCandidates | null;
  candidatesError: string | null;
  plans: KmRotationPlanRow[];
  plan: KmRotationPlanDetail | null;
  planError: string | null;
  employees: KmRotationEmployee[];
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseRotationParams(params: KmLoadContext["params"]): KmRotationParams {
  const h = Number(firstParam(params, "horizonte"));
  const scope = firstParam(params, "escopo");
  const plan = firstParam(params, "plano");
  const planId = plan && UUID.test(plan) ? plan : null;
  return {
    // Com um plano aberto, a sub-aba é a de planos.
    sub: planId || firstParam(params, "sub") === "planos" ? "planos" : "sugestoes",
    horizon: h === 30 || h === 60 ? h : 90,
    scope: scope === "same_cohort_global" ? "same_cohort_global" : "same_cohort_same_operation",
    differentLocations: firstParam(params, "locais") !== "0",
    planId,
  };
}

const message = (e: unknown) => {
  const text = e instanceof Error ? e.message : String(e);
  return text.replace(/^km_[a-z_]+: /, "");
};

const todayInSaoPaulo = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(
    new Date(),
  );

async function loadEmployees(organizationId: string): Promise<KmRotationEmployee[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("employees")
    .select("id, full_name")
    .eq("organization_id", organizationId)
    .eq("employment_status", "active")
    .is("deleted_at", null)
    .order("full_name");
  return (data ?? []).map((e) => ({ id: e.id, name: e.full_name }));
}

export async function loadRotationPlanDetail(planId: string): Promise<KmRotationPlanDetail> {
  const raw = await kmRpcRaw<{ plan?: { filters?: Record<string, Json> } } & Record<string, unknown>>(
    "km_rotation_plan_detail",
    { p_plan_id: planId },
  );
  const detail = camelize<Omit<KmRotationPlanDetail, "filtersRaw">>(raw);
  return { ...detail, filtersRaw: raw?.plan?.filters ?? {} };
}

export async function loadRotation(ctx: KmLoadContext): Promise<KmRotationData> {
  const params = parseRotationParams(ctx.params);
  const org = ctx.organizationId;

  const candidatesTask =
    params.sub === "sugestoes"
      ? kmRpc<KmRotationCandidates>("km_rotation_candidates", {
          p_organization_id: org,
          p_payload: {
            ...ctx.payload,
            horizon_days: params.horizon,
            scope_mode: params.scope,
            different_locations_only: params.differentLocations,
          },
        })
      : Promise.resolve(null);
  const planTask = params.planId ? loadRotationPlanDetail(params.planId) : Promise.resolve(null);
  const employeesTask = params.planId ? loadEmployees(org) : Promise.resolve([]);

  const [candidates, plans, plan, employees] = await Promise.allSettled([
    candidatesTask,
    kmRpc<KmRotationPlanRow[]>("km_rotation_plans_list", { p_organization_id: org }),
    planTask,
    employeesTask,
  ]);

  // Sem a lista de planos não há aba: a falha sobe para o painel.
  if (plans.status === "rejected") throw plans.reason;

  const cand = candidates.status === "fulfilled" ? candidates.value : null;
  return {
    params,
    period: { from: cand?.period.from, to: cand?.period.to, today: todayInSaoPaulo() },
    filtersPayload: ctx.payload,
    candidates: cand,
    candidatesError: candidates.status === "rejected" ? message(candidates.reason) : null,
    plans: plans.value ?? [],
    plan: plan.status === "fulfilled" ? plan.value : null,
    planError: plan.status === "rejected" ? message(plan.reason) : null,
    employees: employees.status === "fulfilled" ? employees.value : [],
  };
}
