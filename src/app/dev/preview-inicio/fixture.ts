import type { MySituationCell, MySituationCounts, MySituationDay } from "@/lib/adherence/my-situation";
import type { Competence } from "@/lib/governance/competence";
import type { LeadershipHome, Loaded, OperationalExecution, OperationalHome } from "@/lib/portal/types";
import type { LeadershipBlocks } from "@/lib/portal/leadership";
import type { ObligationsSource } from "@/app/(app)/inicio/checklist-calendar";

/**
 * Dados fixos do Início (pós-login) para a prévia sem sessão.
 *
 * Outubro/2026, hoje terça-feira, dia 13. O motorista é titular da BR
 * BR-RJ-012 nos dias úteis; fins de semana não têm obrigação. No mês: uma
 * saída não feita (dia 5), um retorno não feito (dia 8), o dia 9 dispensado
 * por manutenção, hoje com a saída feita e o retorno ainda no prazo, os dias
 * seguintes previstos — e um checklist num domingo (dia 11), em outra placa,
 * sem obrigação nenhuma.
 */

export const TODAY = "2026-10-13";
export const COMPETENCE: Competence = { year: 2026, month: 10 };

export const OPERATIONAL_SCENARIOS = ["completo", "sem-fidelizacao", "novo", "erro-obrigacoes", "erro"] as const;
export type OperationalScenario = (typeof OPERATIONAL_SCENARIOS)[number];

export const LEADERSHIP_SCENARIOS = ["completo", "sem-escopo", "sem-colaborador", "erros"] as const;
export type LeadershipScenario = (typeof LEADERSHIP_SCENARIOS)[number];

/** As permissões oficiais de cada perfil (as da produção), para o menu da prévia. */
export const OPERATIONAL_PERMISSIONS = [
  "action_plans.view_own", "adherence.view_own", "applications.checklist_fleet.execute",
  "applications.checklist_fleet.view_own", "applications.mtsr.execute", "applications.tires.execute",
  "applications.view", "cost_centers.view", "drivers.view", "operations.view", "organization.view", "units.view",
  "vehicles.view",
];

export const LEADERSHIP_PERMISSIONS = [
  "action_plans.export", "action_plans.view", "action_plans.view_dashboard", "adherence.export", "adherence.request",
  "adherence.view", "applications.checklist_fleet.execute", "applications.checklist_fleet.view_details",
  "applications.checklist_fleet.view_own", "applications.mtsr.execute", "applications.tires.execute",
  "applications.view", "audit.view", "branches.view", "branches.view_employees", "cost_centers.view", "drivers.view",
  "equipment_types.view", "fidelization.change_driver", "fidelization.change_vehicle", "fidelization.export",
  "fidelization.plan", "fidelization.view", "km.export", "km.rotation.view", "km.view", "km.view_analysis",
  "km.view_daily", "km.view_dashboard", "km.view_history", "km.view_planner", "leadership.assign", "leadership.export",
  "leadership.manage", "leadership.replicate", "leadership.view", "maintenance.create", "maintenance.view",
  "maintenance.view_base", "maintenance.view_dashboard", "mtsr.conformity.view", "mtsr.dashboard.view", "mtsr.export",
  "mtsr.inspection.review", "mtsr.view", "operations.view", "organization.view", "tires.base.view",
  "tires.calibration.view", "tires.dashboard.view", "tires.history.view", "tires.measurement.view",
  "tires.schedule.view", "tires.services.view", "tires.view", "units.view", "users.audit_view", "users.export",
  "users.view", "vehicles.view",
];

const pad = (n: number) => String(n).padStart(2, "0");
const iso = (c: Competence, d: number) => `${c.year}-${pad(c.month)}-${pad(d)}`;
const lastDay = (c: Competence) => new Date(Date.UTC(c.year, c.month, 0)).getUTCDate();
const weekday = (date: string) => new Date(`${date}T12:00:00Z`).getUTCDay();

function cell(status: string, date: string, ctx: "saida" | "retorno"): MySituationCell {
  const done = status === "FEZ_CHECKLIST";
  const excluded = ["MANUTENCAO", "SEM_ROTA", "EM_VIAGEM", "FROTA_RESERVA", "FROTA_NAO_ATIVA"].includes(status);
  return {
    status,
    due: done || status === "NAO_FEZ_CHECKLIST",
    done,
    excluded,
    provisional: status === "NAO_FEZ_CHECKLIST" && date === TODAY,
    pendingRequest: false,
    condition: null,
    performedByMe: done,
    expectedAt: `${date}T${ctx === "saida" ? "09" : "21"}:00:00Z`,
    deadlineAt: `${date}T${ctx === "saida" ? "12" : "23"}:59:00Z`,
  };
}

function statusFor(date: string, d: number, ctx: "saida" | "retorno", c: Competence): string {
  if (c.year !== COMPETENCE.year || c.month !== COMPETENCE.month) {
    return date < TODAY ? "FEZ_CHECKLIST" : "PLANEJADO";
  }
  if (d === 9) return "MANUTENCAO";
  if (date < TODAY) {
    if (ctx === "saida" && d === 5) return "NAO_FEZ_CHECKLIST";
    if (ctx === "retorno" && d === 8) return "NAO_FEZ_CHECKLIST";
    return "FEZ_CHECKLIST";
  }
  if (date === TODAY) return ctx === "saida" ? "FEZ_CHECKLIST" : "RETORNO_PENDENTE";
  return "PLANEJADO";
}

export function obligationDays(c: Competence, plannedOnly = false): MySituationDay[] {
  const days: MySituationDay[] = [];
  for (let d = 1; d <= lastDay(c); d += 1) {
    const date = iso(c, d);
    const wd = weekday(date);
    if (wd === 0 || wd === 6) continue;
    const s = plannedOnly ? (date < TODAY ? null : "PLANEJADO") : statusFor(date, d, "saida", c);
    const r = plannedOnly ? (date < TODAY ? null : "PLANEJADO") : statusFor(date, d, "retorno", c);
    if (!s || !r) continue;
    days.push({
      date,
      journey: 1,
      brCode: "BR-RJ-012",
      operationName: "Distribuição Rio",
      cityName: "Rio de Janeiro",
      fleetCode: "F-1203",
      licensePlate: "RJX4A21",
      byFidelization: true,
      byExecution: s === "FEZ_CHECKLIST" || r === "FEZ_CHECKLIST",
      saida: cell(s, date, "saida"),
      retorno: cell(r, date, "retorno"),
    });
  }
  return days;
}

function execution(date: string, ctx: "saida" | "retorno", plate = "RJX4A21", nonConforming = 0): OperationalExecution {
  return {
    id: `ex-${date}-${ctx}`,
    date,
    context: ctx,
    licensePlate: plate,
    fleetCode: plate === "RJX4A21" ? "F-1203" : "F-0877",
    operationName: "Distribuição Rio",
    brCode: plate === "RJX4A21" ? "BR-RJ-012" : null,
    startedAt: `${date}T${ctx === "saida" ? "09:06" : "21:31"}:00Z`,
    submittedAt: `${date}T${ctx === "saida" ? "09:12" : "21:38"}:00Z`,
    durationSeconds: ctx === "saida" ? 372 : 418,
    nonConforming,
    criticalNonConforming: nonConforming > 1 ? 1 : 0,
    source: "app",
  };
}

export function monthExecutions(c: Competence, days: MySituationDay[]): OperationalExecution[] {
  const list: OperationalExecution[] = [];
  for (const day of days) {
    if (day.saida?.done) list.push(execution(day.date, "saida", "RJX4A21", day.date.endsWith("-02") ? 2 : 0));
    if (day.retorno?.done) list.push(execution(day.date, "retorno"));
  }
  if (c.year === COMPETENCE.year && c.month === COMPETENCE.month) list.push(execution(iso(c, 11), "saida", "KXT9B07", 1));
  return list.sort((a, b) => (a.date + a.context).localeCompare(b.date + b.context));
}

function summaryOf(days: MySituationDay[]): MySituationCounts {
  const cells = days.flatMap((d) => [d.saida, d.retorno]).filter((x): x is MySituationCell => x != null);
  const due = cells.filter((x) => x.due);
  const done = due.filter((x) => x.done);
  return {
    obligations: cells.length,
    done: cells.filter((x) => x.done).length,
    notDone: cells.filter((x) => x.status === "NAO_FEZ_CHECKLIST").length,
    pendingReturn: cells.filter((x) => x.status === "RETORNO_PENDENTE").length,
    planned: cells.filter((x) => x.status === "PLANEJADO").length,
    excluded: cells.filter((x) => x.excluded).length,
    pendingRequests: 0,
    provisional: cells.filter((x) => x.provisional).length,
    numerator: done.length,
    denominator: due.length,
    adherencePct: due.length ? Math.round((done.length * 10000) / due.length) / 100 : null,
    targetPct: 95,
  };
}

export function operationalFixture(
  scenario: OperationalScenario,
  c: Competence,
): { home: Loaded<OperationalHome>; obligations: ObligationsSource } {
  if (scenario === "erro") {
    return {
      home: { ok: false, error: "A consulta demorou mais que o permitido. Tente novamente em instantes." },
      obligations: { state: "error", error: "A consulta demorou mais que o permitido." },
    };
  }
  const isNew = scenario === "novo";
  const days = obligationDays(c, isNew);
  const executions = isNew ? [] : monthExecutions(c, days);
  const before = isNew ? 0 : 37;
  const last = executions.length ? executions[executions.length - 1] : null;
  const home: OperationalHome = {
    today: TODAY,
    year: c.year,
    month: c.month,
    dateFrom: iso(c, 1),
    dateTo: iso(c, lastDay(c)),
    employee: {
      id: "emp-140349",
      name: "Carlos Eduardo Nogueira Silva",
      code: "140349",
      jobPosition: "Motorista",
      operationName: "Distribuição Rio",
      unitName: "Filial Rio de Janeiro",
    },
    checklists: {
      total: before + executions.length,
      monthTotal: executions.length,
      last30Days: executions.length + (isNew ? 0 : 4),
      lastSubmittedAt: last?.submittedAt ?? null,
      lastDate: isNew ? null : TODAY,
    },
    executions,
    executionsTruncated: false,
    reports: isNew
      ? { windowDays: 90, total: 0, open: 0, resolved: 0, closedOther: 0 }
      : { windowDays: 90, total: 9, open: 3, resolved: 5, closedOther: 1 },
  };
  const obligations: ObligationsSource =
    scenario === "sem-fidelizacao"
      ? { state: "not_driver" }
      : scenario === "erro-obrigacoes"
        ? { state: "error", error: "A consulta demorou mais que o permitido." }
        : { state: "ok", days, summary: summaryOf(days) };
  return { home: { ok: true, data: scenario === "sem-fidelizacao" ? { ...home } : home }, obligations };
}

// ---------------------------------------------------------------------------
// Liderança
// ---------------------------------------------------------------------------

const TEAM = [
  { id: "t1", name: "Ana Paula de Almeida Rodrigues", code: "140112", jobPosition: "Motorista", today: 1, week: 2, lastDate: TODAY },
  { id: "t2", name: "Bruno Henrique Teixeira Lopes", code: "140237", jobPosition: "Motorista", today: 2, week: 4, lastDate: TODAY },
  { id: "t3", name: "Diego Martins Carvalho", code: "140301", jobPosition: "Motorista", today: 0, week: 0, lastDate: "2026-10-08" },
  { id: "t4", name: "Fernanda Souza Lima", code: "140356", jobPosition: "Ajudante", today: 1, week: 1, lastDate: TODAY },
  { id: "t5", name: "João Vitor Rodrigues de Oliveira", code: "140402", jobPosition: "Motorista", today: 0, week: 0, lastDate: null },
  { id: "t6", name: "Marcos Antônio Pereira", code: "140418", jobPosition: "Motorista", today: 0, week: 1, lastDate: "2026-10-12" },
].sort((a, b) => a.week - b.week || a.name.localeCompare(b.name, "pt-BR"));

export function leadershipFixture(scenario: LeadershipScenario): {
  home: Loaded<LeadershipHome>;
  blocks: LeadershipBlocks;
  leaderId: string | null;
} {
  const noScope = scenario === "sem-escopo";
  const noEmployee = scenario === "sem-colaborador";
  const home: LeadershipHome = {
    today: TODAY,
    weekFrom: "2026-10-12",
    employee: noEmployee
      ? null
      : { id: "emp-120788", name: "Juliana Ferreira Costa", code: "120788", jobPosition: "Líder de Operações", operationName: "Distribuição Rio", unitName: "Filial Rio de Janeiro" },
    scope: {
      allOperations: false,
      operations: noScope
        ? []
        : [
            { id: "op1", name: "Distribuição Rio", status: "active" },
            { id: "op2", name: "Transferência Sul Fluminense", status: "active" },
          ],
      responsibilities:
        noScope || noEmployee
          ? []
          : [
              { scopeLevel: "city", responsibilityType: "principal", operationId: "op1", operationName: "Distribuição Rio", cityName: "Rio de Janeiro", uf: "RJ", brCode: null, effectiveFrom: "2026-01-01", effectiveTo: null },
              { scopeLevel: "city", responsibilityType: "principal", operationId: "op1", operationName: "Distribuição Rio", cityName: "Niterói", uf: "RJ", brCode: null, effectiveFrom: "2026-03-01", effectiveTo: null },
              { scopeLevel: "br", responsibilityType: "support", operationId: "op2", operationName: "Transferência Sul Fluminense", cityName: "Volta Redonda", uf: "RJ", brCode: "BR-RJ-031", effectiveFrom: "2026-09-01", effectiveTo: null },
            ],
    },
    team: noEmployee
      ? null
      : noScope
        ? { members: 0, withChecklistToday: 0, withoutChecklistToday: 0, withoutChecklistWeek: 0, withoutWeekNames: [], list: [], truncated: false }
        : {
            members: TEAM.length,
            withChecklistToday: TEAM.filter((m) => m.today > 0).length,
            withoutChecklistToday: TEAM.filter((m) => m.today === 0).length,
            withoutChecklistWeek: TEAM.filter((m) => m.week === 0).length,
            withoutWeekNames: TEAM.filter((m) => m.week === 0).map((m) => m.name).sort((a, b) => a.localeCompare(b, "pt-BR")),
            list: TEAM,
            truncated: false,
          },
  };

  const adh = (o: number, done: number, notDone: number, pendingReturn: number, excluded: number, target: number | null = 95) => {
    const denominator = done + notDone;
    return {
      ok: true as const,
      data: {
        obligations: o, done, notDone, pendingReturn, planned: 0, excluded,
        numerator: done, denominator,
        pct: denominator ? Math.round((done * 10000) / denominator) / 100 : null,
        targetPct: target,
      },
    };
  };
  const zero = adh(0, 0, 0, 0, 0);

  const blocks: LeadershipBlocks = noScope
    ? {
        today: { from: TODAY, to: TODAY, saida: zero, retorno: zero },
        week: { from: "2026-10-12", to: TODAY, saida: zero, retorno: zero },
        tires: { ok: true, data: { empty: true, referenceDate: null, inUse: 0, fleetsWithCritical: 0, critical: 0, measurementOverdue: 0, measurementDueSoon: 0, calibrationOverdue: 0, calibrationDueSoon: 0 } },
        mtsr: { ok: true, data: { vehicles: 0, overdue: 0, attention: 0, nonConforming: 0, pendingInspections: 0, openMaintenances: 0, conformityPct: null } },
        plans: { ok: true, data: { plansActive: 0, plansOverdue: 0, plansCritical: 0, itemsOpen: 0, vehiclesPending: 0 } },
      }
    : {
        today: { from: TODAY, to: TODAY, saida: adh(18, 13, 3, 0, 2), retorno: adh(18, 6, 1, 9, 2) },
        week: { from: "2026-10-12", to: TODAY, saida: adh(36, 30, 4, 0, 2), retorno: adh(36, 24, 3, 9, 0) },
        tires:
          scenario === "erros"
            ? { ok: false, error: "A consulta demorou mais que o permitido." }
            : { ok: true, data: { empty: false, referenceDate: "2026-10-10", inUse: 412, fleetsWithCritical: 3, critical: 5, measurementOverdue: 14, measurementDueSoon: 22, calibrationOverdue: 9, calibrationDueSoon: 17 } },
        mtsr:
          scenario === "erros"
            ? { ok: false, error: "Sem permissão para acessar a Gestão de MTSR." }
            : { ok: true, data: { vehicles: 38, overdue: 2, attention: 4, nonConforming: 3, pendingInspections: 5, openMaintenances: 2, conformityPct: 92.1 } },
        plans: { ok: true, data: { plansActive: 11, plansOverdue: 2, plansCritical: 1, itemsOpen: 17, vehiclesPending: 8 } },
      };

  const leaderId = home.employee && home.scope.responsibilities.length > 0 ? home.employee.id : null;
  return { home: { ok: true, data: home }, blocks, leaderId };
}
