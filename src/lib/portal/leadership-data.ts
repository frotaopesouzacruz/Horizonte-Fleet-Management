import "server-only";

import { getAdherenceMonthly, getAdherenceSummary, type AdherenceSummary, type ChecklistContext } from "@/lib/adherence/queries";
import { getTiresOverview } from "@/lib/tires/queries";
import { getMtsrDashboard } from "@/lib/mtsr/queries";
import { getActionPlanDashboard } from "@/lib/action-plans/queries";
import { getVehicleSummary } from "@/lib/fleet/queries";
import { getMaintenanceDashboard, getPredictiveOverview } from "@/lib/maintenance/queries";
import { kmRpcRaw } from "@/lib/km/rpc";
import type { TireOverviewV2 } from "@/lib/tires/types";
import type { MtsrDashboard } from "@/lib/mtsr/types";
import type { ActionPlanDashboard } from "@/lib/action-plans/types";
import type { MaintenanceDashboard, PredictiveOverview } from "@/lib/maintenance/types";
import type { HomeCapabilities } from "@/lib/home/resolver";
import { dayBefore } from "@/lib/portal/clock";
import { settle } from "@/lib/portal/queries";
import type { Json } from "@/types/database.types";
import type {
  AdherenceBlock, AdherenceNumbers, AdherenceTrendPoint, FleetNumbers, KmNumbers, LeadershipBlocks, LeadershipSecondary,
  MaintenanceNumbers, MtsrNumbers, PlansNumbers, PredictiveNumbers, TiresNumbers,
} from "@/lib/portal/leadership";

/**
 * Os blocos da Home da Liderança, cada um pela rotina OFICIAL do seu
 * módulo, sob o cliente da própria pessoa (RLS e escopo do banco):
 *
 *   Nível 1–2 (primeira pintura)
 *   Aderência    `adherence_summary` (hoje, ontem e semana, saída e retorno)
 *   Pneus        `tires_overview`
 *   MTSR         `mtsr_dashboard`
 *   Planos       `action_plan_dashboard` (janela padrão do módulo: 90 dias)
 *   Frota        `vehicle_summary`
 *
 *   Nível 3–4 (depois, em Suspense)
 *   Manutenção   `maintenance_dashboard`
 *   Preditiva    `maintenance_predictive_overview`
 *   KM           `km_overview` (competência atual)
 *   Tendência    `adherence_monthly` (saída, ano corrente)
 *
 * O recorte é o do portal: "minha liderança" filtra pelo líder responsável
 * (`leader_employee_id` / `leader_ids`, o mesmo filtro "?lideranca=" dos
 * módulos); "operações liberadas" deixa só a RLS. Rotina sem filtro de
 * líder (frota, preditiva) recebe a operação, quando a liderança responde
 * por uma só. Bloco sem permissão não é consultado (null); bloco que falha
 * volta com o motivo — nunca zero no lugar do erro.
 */

function toAdherence(s: AdherenceSummary): AdherenceNumbers {
  return {
    obligations: s.obligations,
    done: s.done,
    notDone: s.notDone,
    pendingReturn: s.pendingReturn,
    planned: s.planned,
    excluded: s.excluded,
    numerator: s.numerator,
    denominator: s.denominator,
    pct: s.adherencePct,
    targetPct: s.targetPct,
  };
}

function toTires(o: TireOverviewV2): TiresNumbers {
  const k = o.kpis;
  return {
    empty: Boolean(o.empty) || !k,
    referenceDate: o.referenceDate ?? null,
    inUse: k?.emUso ?? 0,
    fleetsWithCritical: k?.fleetsWithCritical ?? 0,
    critical: k?.critical ?? 0,
    measurementOverdue: k?.measurementOverdue ?? 0,
    measurementDueSoon: k?.measurementDueSoon ?? 0,
    calibrationOverdue: k?.calibrationOverdue ?? 0,
    calibrationDueSoon: k?.calibrationDueSoon ?? 0,
  };
}

function toMtsr(d: MtsrDashboard): MtsrNumbers {
  const k = d.kpis;
  return {
    vehicles: k?.vehicles ?? 0,
    overdue: k?.vencido ?? 0,
    attention: k?.atencao ?? 0,
    nonConforming: k?.naoConforme ?? 0,
    pendingInspections: k?.pendingInspections ?? 0,
    openMaintenances: k?.openMaintenances ?? 0,
    conformityPct: k?.conformityPct ?? null,
  };
}

function toPlans(d: ActionPlanDashboard): PlansNumbers {
  const k = d.kpis;
  return {
    plansActive: k.plansActive,
    plansOverdue: k.plansOverdue,
    plansCritical: k.plansCritical,
    itemsOpen: k.itemsOpen,
    vehiclesPending: k.vehiclesPending,
  };
}

function toMaintenance(d: MaintenanceDashboard): MaintenanceNumbers {
  const k = d.kpis;
  return {
    today: d.period.today,
    open: k.open,
    toSchedule: k.toSchedule,
    scheduled: k.scheduled,
    inProgress: k.inProgress,
    scheduledToday: k.scheduledToday,
    exitOverdue: k.exitOverdue,
    unscheduledOverdue: k.unscheduledOverdue,
    immobilized: k.immobilizedVehicles,
    preventiveCritical: k.preventiveCritical,
    preventiveDue: k.preventiveDue,
    preventiveToSchedule: k.preventiveToSchedule,
    predictiveCritical: k.predictiveCritical,
  };
}

function toPredictive(o: PredictiveOverview): PredictiveNumbers {
  return {
    itemsMonitored: o.summary.itemsMonitored,
    critical: o.summary.critical,
    due: o.summary.due,
    toSchedule: o.summary.toSchedule,
    upcoming: o.summary.upcoming,
    coveragePct: o.coverage.coveragePct,
    uncoveredVehicles: o.coverage.uncoveredVehicles,
    criticalClusters: o.criticalClusters.filter((c) => c.critical > 0).map((c) => ({ cluster: c.cluster, critical: c.critical, toSchedule: c.toSchedule })),
  };
}

type RawKm = { period?: { reference_day?: string | null } | null; kpis?: Record<string, unknown> | null };

async function loadKm(organizationId: string, leaderId: string | null, today: string): Promise<KmNumbers> {
  const filters: Record<string, Json> = { competence: today.slice(0, 7) };
  if (leaderId) filters.leader_ids = [leaderId];
  const raw = await kmRpcRaw<RawKm>("km_overview", { p_organization_id: organizationId, p_filters: filters });
  const k = raw?.kpis ?? {};
  const num = (key: string) => (k[key] == null ? null : Number(k[key]));
  return {
    referenceDay: raw?.period?.reference_day ?? null,
    kmTotal: num("km_total"),
    vehiclesWithoutReadingRef: num("vehicles_without_reading_ref") ?? 0,
    vehiclesStale: num("vehicles_stale") ?? 0,
    coveragePeriodPct: num("coverage_period_pct"),
    lastUpdate: k.last_update == null ? null : String(k.last_update),
  };
}

export interface LeadershipLoadContext {
  today: string;
  weekFrom: string;
  /** Colaborador do líder quando o recorte é "minha liderança"; null nas operações liberadas. */
  leaderId: string | null;
  /** A única operação pela qual a liderança responde, quando é uma só (rotinas sem filtro de líder). */
  operationId?: string | null;
}

export async function loadLeadershipBlocks(
  organizationId: string,
  can: HomeCapabilities,
  { today, weekFrom, leaderId, operationId = null }: LeadershipLoadContext,
): Promise<LeadershipBlocks> {
  const adherence = (from: string, to: string, context: ChecklistContext) =>
    settle(
      getAdherenceSummary(organizationId, from, to, context, leaderId ? { leaderEmployeeId: leaderId } : {}).then(toAdherence),
      `adherence_summary ${context} ${from}..${to}`,
    );
  const leaderIds: Record<string, Json> = leaderId ? { leader_ids: [leaderId] } : {};
  const yesterday = dayBefore(today);

  const [todaySaida, todayRetorno, ySaida, yRetorno, weekSaida, weekRetorno, tires, mtsr, plans, fleet] = await Promise.all([
    can.adherence ? adherence(today, today, "saida") : null,
    can.adherence ? adherence(today, today, "retorno") : null,
    can.adherence ? adherence(yesterday, yesterday, "saida") : null,
    can.adherence ? adherence(yesterday, yesterday, "retorno") : null,
    can.adherence ? adherence(weekFrom, today, "saida") : null,
    can.adherence ? adherence(weekFrom, today, "retorno") : null,
    can.tires ? settle(getTiresOverview(organizationId, leaderIds).then(toTires), "tires_overview") : null,
    can.mtsr ? settle(getMtsrDashboard(organizationId, leaderIds).then(toMtsr), "mtsr_dashboard") : null,
    can.actionPlans
      ? settle(getActionPlanDashboard(organizationId, leaderId ? { leader: leaderId } : {}).then(toPlans), "action_plan_dashboard")
      : null,
    can.fleet
      ? settle(
          getVehicleSummary(organizationId, operationId ? { operation: operationId } : {}).then(
            (s): FleetNumbers => ({ total: s.total, active: s.active, inactive: s.inactive, unassigned: s.unassigned, operations: s.operationCount }),
          ),
          "vehicle_summary",
        )
      : null,
  ]);

  const block = (from: string, to: string, saida: AdherenceBlock["saida"] | null, retorno: AdherenceBlock["retorno"] | null) =>
    saida && retorno ? { from, to, saida, retorno } : null;

  return {
    today: block(today, today, todaySaida, todayRetorno),
    yesterday: block(yesterday, yesterday, ySaida, yRetorno),
    week: block(weekFrom, today, weekSaida, weekRetorno),
    tires,
    mtsr,
    plans,
    fleet,
  };
}

export async function loadLeadershipSecondary(
  organizationId: string,
  can: HomeCapabilities,
  { today, leaderId, operationId = null }: Pick<LeadershipLoadContext, "today" | "leaderId" | "operationId">,
): Promise<LeadershipSecondary> {
  const year = Number(today.slice(0, 4));
  const [maintenance, predictive, km, trend] = await Promise.all([
    can.maintenance
      ? settle(getMaintenanceDashboard(organizationId, leaderId ? { leader: leaderId } : {}).then(toMaintenance), "maintenance_dashboard")
      : null,
    can.maintenance
      ? settle(getPredictiveOverview(organizationId, operationId ? { operation: operationId } : {}).then(toPredictive), "maintenance_predictive_overview")
      : null,
    can.km ? settle(loadKm(organizationId, leaderId, today), "km_overview") : null,
    can.adherence
      ? settle(
          getAdherenceMonthly(organizationId, year, "saida", leaderId ? { leaderEmployeeId: leaderId } : {}).then(
            (m): AdherenceTrendPoint[] =>
              m.months.map((x) => ({ month: x.month, adherencePct: x.adherencePct, targetPct: x.targetPct, isCurrent: x.isCurrent, isFuture: x.isFuture })),
          ),
          "adherence_monthly",
        )
      : null,
  ]);
  return { maintenance, predictive, km, trend };
}
