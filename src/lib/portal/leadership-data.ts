import "server-only";

import { getAdherenceSummary, type AdherenceSummary, type ChecklistContext } from "@/lib/adherence/queries";
import { getTiresOverview } from "@/lib/tires/queries";
import { getMtsrDashboard } from "@/lib/mtsr/queries";
import { getActionPlanDashboard } from "@/lib/action-plans/queries";
import type { TireOverviewV2 } from "@/lib/tires/types";
import type { MtsrDashboard } from "@/lib/mtsr/types";
import type { ActionPlanDashboard } from "@/lib/action-plans/types";
import { settle } from "@/lib/portal/queries";
import type { Json } from "@/types/database.types";
import type {
  AdherenceBlock, AdherenceNumbers, LeadershipBlocks, MtsrNumbers, PlansNumbers, TiresNumbers,
} from "@/lib/portal/leadership";

/**
 * Os blocos do Portal da Liderança, cada um pela rotina OFICIAL do seu
 * módulo, sob o cliente da própria pessoa (RLS e escopo do banco):
 *
 *   Aderência  `adherence_summary`   (hoje e semana, saída e retorno)
 *   Pneus      `tires_overview`
 *   MTSR       `mtsr_dashboard`
 *   Planos     `action_plan_dashboard` (janela padrão do módulo: 90 dias)
 *
 * O recorte é o do portal: "minha liderança" filtra pelo líder responsável
 * (`leader_employee_id` / `leader_ids`, o mesmo filtro "?lideranca=" dos
 * módulos); "operações liberadas" deixa só a RLS. Bloco sem permissão não é
 * consultado (null); bloco que falha volta com o motivo.
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

export async function loadLeadershipBlocks(
  organizationId: string,
  can: (permission: string) => boolean,
  { today, weekFrom, leaderId }: { today: string; weekFrom: string; leaderId: string | null },
): Promise<LeadershipBlocks> {
  const canAdherence = can("adherence.view");
  const adherence = (from: string, to: string, context: ChecklistContext) =>
    settle(
      getAdherenceSummary(organizationId, from, to, context, leaderId ? { leaderEmployeeId: leaderId } : {}).then(toAdherence),
      `adherence_summary ${context} ${from}..${to}`,
    );
  const leaderIds: Record<string, Json> = leaderId ? { leader_ids: [leaderId] } : {};

  const [todaySaida, todayRetorno, weekSaida, weekRetorno, tires, mtsr, plans] = await Promise.all([
    canAdherence ? adherence(today, today, "saida") : null,
    canAdherence ? adherence(today, today, "retorno") : null,
    canAdherence ? adherence(weekFrom, today, "saida") : null,
    canAdherence ? adherence(weekFrom, today, "retorno") : null,
    can("tires.view") && can("tires.dashboard.view")
      ? settle(getTiresOverview(organizationId, leaderIds).then(toTires), "tires_overview")
      : null,
    can("mtsr.view") && can("mtsr.dashboard.view")
      ? settle(getMtsrDashboard(organizationId, leaderIds).then(toMtsr), "mtsr_dashboard")
      : null,
    can("action_plans.view") && can("action_plans.view_dashboard")
      ? settle(getActionPlanDashboard(organizationId, leaderId ? { leader: leaderId } : {}).then(toPlans), "action_plan_dashboard")
      : null,
  ]);

  const block = (from: string, saida: AdherenceBlock["saida"] | null, retorno: AdherenceBlock["retorno"] | null) =>
    saida && retorno ? { from, to: today, saida, retorno } : null;

  return {
    today: block(today, todaySaida, todayRetorno),
    week: block(weekFrom, weekSaida, weekRetorno),
    tires,
    mtsr,
    plans,
  };
}
