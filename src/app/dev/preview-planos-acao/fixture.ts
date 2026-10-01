import {
  DEFAULT_SETTINGS,
  type ActionParameter,
  type ActionPlanCatalog,
  type ActionPlanDashboard,
  type ActionPlanDetail,
  type ActionPlanFilters,
  type ActionPlanPage,
  type ActionPlanRow,
  type Confidence,
  type Coverage,
  type ExecutionTrace,
  type GroupNode,
  type GroupRow,
  type Grouping,
  type HealthData,
  type HistoryPage,
  type HistoryRow,
  type MaintenanceCandidate,
  type MappingData,
  type MappingRow,
  type MyViewData,
  type PlanEvent,
  type PlanItem,
  type Priority,
  type QualityData,
  type ReconciliationPage,
  type ReconciliationRow,
} from "@/lib/action-plans/types";
import { isClosed } from "@/lib/action-plans/labels";
import type { PreviewFixtures } from "@/app/(app)/checklist/planos-acao/shared";

/**
 * Dados fixos para a prévia dos Planos de Ação (mesmo portão do design system).
 *
 * Uma frota de teste pequena — placas TST…, nomes de exemplo — que passa por
 * todos os estados que a tela precisa distinguir: novo vencido, crítico com
 * manutenção agendada, em análise, em execução, pendente de nova tratativa
 * (manutenção cancelada), reincidência aguardando manutenção, resolvido sem
 * manutenção e resolvido pela manutenção. A conciliação tem candidatas de
 * cada confiança; o mapeamento tem uma pergunta de avaria com o detalhe de
 * descrição; as gavetas abrem pelos `FIXTURES` sem servidor.
 */
export const TODAY = "2026-10-01";
const APP_ID = "app-ck-teste";

// ---------------------------------------------------------------------------
// Catálogo
// ---------------------------------------------------------------------------
const OPS = {
  mg: { id: "op-alfa", name: "Operação Alfa (MG)" },
  pa: { id: "op-beta", name: "Operação Beta (PA)" },
};

export const COVERAGE: Coverage = {
  actionKeys: 8,
  mapped: 6,
  unmapped: 1,
  conflicting: 0,
  inactive: 1,
  autoResolve: 4,
  pct: 75,
};

export const CATALOG: ActionPlanCatalog = {
  appId: APP_ID,
  operations: [OPS.mg, OPS.pa],
  states: [
    { id: 31, uf: "MG" },
    { id: 15, uf: "PA" },
  ],
  cities: [
    { id: 3106200, name: "Belo Horizonte", stateId: 31 },
    { id: 3118601, name: "Contagem", stateId: 31 },
    { id: 1501402, name: "Belém", stateId: 15 },
  ],
  units: [
    { id: "un-bh", name: "Filial Teste BH" },
    { id: "un-bel", name: "Filial Teste Belém" },
  ],
  brs: [
    { id: "br-001", code: "BR-TST-001", operationId: OPS.mg.id },
    { id: "br-002", code: "BR-TST-002", operationId: OPS.mg.id },
    { id: "br-003", code: "BR-TST-003", operationId: OPS.mg.id },
    { id: "br-101", code: "BR-TST-101", operationId: OPS.pa.id },
    { id: "br-102", code: "BR-TST-102", operationId: OPS.pa.id },
  ],
  leaders: [
    { id: "ld-ana", name: "Ana Exemplo" },
    { id: "ld-bruno", name: "Bruno Teste" },
  ],
  vehicleTypes: [
    { id: "vt-van", name: "Van" },
    { id: "vt-vuc", name: "VUC" },
  ],
  clusters: [
    { key: "iluminacao", name: "Iluminação" },
    { key: "freios", name: "Freios" },
    { key: "pneus", name: "Pneus" },
    { key: "carroceria", name: "Carroceria e vidros" },
    { key: "motor", name: "Motor" },
  ],
  actionKeys: [
    { key: "q:farois_ok:farois_falha", title: "Faróis com falha", questionKey: "farois_ok", clusterKey: "iluminacao" },
    { key: "q:freio_estacionamento_ok", title: "Freio de estacionamento com folga", questionKey: "freio_estacionamento_ok", clusterKey: "freios" },
    { key: "q:lanternas_ok", title: "Lanterna traseira queimada", questionKey: "lanternas_ok", clusterKey: "iluminacao" },
    { key: "q:limpador_ok", title: "Limpador de para-brisa com falha", questionKey: "limpador_ok", clusterKey: "carroceria" },
    { key: "q:pneus_ok:pneu_posicao", title: "Pneus com desgaste", questionKey: "pneus_ok", clusterKey: "pneus" },
    { key: "q:retrovisores_ok", title: "Retrovisor danificado", questionKey: "retrovisores_ok", clusterKey: "carroceria" },
    { key: "q:vazamento_oleo", title: "Vazamento de óleo", questionKey: "vazamento_oleo", clusterKey: "motor" },
  ],
  responsibles: [
    { id: "usr-carla", name: "Carla Exemplo" },
    { id: "usr-diego", name: "Diego Teste" },
  ],
  settings: DEFAULT_SETTINGS,
};

// ---------------------------------------------------------------------------
// Veículos e planos
// ---------------------------------------------------------------------------
type VehicleContext = Pick<
  ActionPlanRow,
  | "vehicleId" | "licensePlate" | "fleetCode" | "operationId" | "operationName" | "stateId" | "stateUf" | "cityId" | "cityName"
  | "brId" | "brCode" | "unitId" | "unitName" | "leaderId" | "leaderName" | "vehicleTypeId" | "vehicleTypeName"
>;

const MG_BH = {
  operationId: OPS.mg.id, operationName: OPS.mg.name, stateId: 31, stateUf: "MG", cityId: 3106200, cityName: "Belo Horizonte",
  unitId: "un-bh", unitName: "Filial Teste BH", leaderId: "ld-ana", leaderName: "Ana Exemplo",
};
const PA_BEL = {
  operationId: OPS.pa.id, operationName: OPS.pa.name, stateId: 15, stateUf: "PA", cityId: 1501402, cityName: "Belém",
  unitId: "un-bel", unitName: "Filial Teste Belém", leaderId: "ld-bruno", leaderName: "Bruno Teste",
};

const VEHICLES: Record<string, VehicleContext> = {
  v1: { ...MG_BH, vehicleId: "veh-0001", licensePlate: "TST1A23", fleetCode: "1024", brId: "br-001", brCode: "BR-TST-001", vehicleTypeId: "vt-van", vehicleTypeName: "Van" },
  v2: { ...MG_BH, cityId: 3118601, cityName: "Contagem", vehicleId: "veh-0002", licensePlate: "TST2B34", fleetCode: "1031", brId: "br-002", brCode: "BR-TST-002", vehicleTypeId: "vt-vuc", vehicleTypeName: "VUC" },
  v3: { ...PA_BEL, vehicleId: "veh-0003", licensePlate: "TST3C45", fleetCode: "2040", brId: "br-101", brCode: "BR-TST-101", vehicleTypeId: "vt-van", vehicleTypeName: "Van" },
  v4: { ...PA_BEL, vehicleId: "veh-0004", licensePlate: "TST4D56", fleetCode: "2051", brId: "br-102", brCode: "BR-TST-102", vehicleTypeId: "vt-vuc", vehicleTypeName: "VUC" },
  v5: { ...MG_BH, vehicleId: "veh-0005", licensePlate: "TST5E67", fleetCode: "1045", brId: "br-003", brCode: "BR-TST-003", vehicleTypeId: "vt-van", vehicleTypeName: "Van" },
};

type PlanSeed = Pick<
  ActionPlanRow,
  "id" | "code" | "title" | "questionKey" | "actionKey" | "clusterKey" | "clusterName" | "status" | "priority" | "deadline"
  | "firstOperationalDate" | "lastOperationalDate"
> & Partial<ActionPlanRow> & { vehicle: keyof typeof VEHICLES };

const daysBetween = (a: string, b: string) =>
  Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

function plan({ vehicle, ...seed }: PlanSeed): ActionPlanRow {
  const closed = isClosed(seed.status);
  return {
    detailLabel: null,
    planKey: seed.actionKey,
    criticality: "medium",
    analysisState: "new",
    prioritySource: "parameter",
    dueOn: null,
    dueSource: "sla",
    daysOverdue: null,
    ageDays: closed ? null : daysBetween(seed.firstOperationalDate, TODAY),
    responsibleUserId: null,
    responsibleName: null,
    firstOccurrenceAt: `${seed.firstOperationalDate}T07:12:00-03:00`,
    lastOccurrenceAt: `${seed.lastOperationalDate}T07:40:00-03:00`,
    occurrences: 1,
    openItems: closed ? 0 : 1,
    resolvedItems: closed ? 1 : 0,
    maintenances: [],
    isRecurrence: false,
    cycleNumber: 1,
    previousPlanId: null,
    reopenedCount: 0,
    lastTreatment: null,
    lastTreatmentAt: null,
    closedAt: null,
    autoClosed: false,
    requiresMaintenance: true,
    tmrDays: null,
    ...VEHICLES[vehicle],
    ...seed,
  };
}

export const PLANS: ActionPlanRow[] = [
  plan({
    id: "pl-101", code: "PA-2026-000101", vehicle: "v1",
    title: "Faróis com falha", detailLabel: "Farol esquerdo", questionKey: "farois_ok", actionKey: "q:farois_ok:farois_falha",
    planKey: "q:farois_ok:farois_falha=farol_esquerdo", clusterKey: "iluminacao", clusterName: "Iluminação", criticality: "high",
    status: "new", priority: "high", deadline: "overdue", dueOn: "2026-09-29", daysOverdue: 2,
    firstOperationalDate: "2026-09-26", lastOperationalDate: "2026-09-30", occurrences: 3, openItems: 3,
  }),
  plan({
    id: "pl-102", code: "PA-2026-000102", vehicle: "v2",
    title: "Freio de estacionamento com folga", questionKey: "freio_estacionamento_ok", actionKey: "q:freio_estacionamento_ok",
    clusterKey: "freios", clusterName: "Freios", criticality: "critical",
    status: "maintenance_scheduled", analysisState: "awaiting_maintenance", priority: "critical", deadline: "today", dueOn: TODAY,
    firstOperationalDate: "2026-09-30", lastOperationalDate: "2026-09-30", responsibleUserId: "usr-carla", responsibleName: "Carla Exemplo",
    maintenances: [{ id: "m-201", code: "MAN-2026-000201", status: "scheduled", origin: "opened_from_plan", resolutive: true }],
    lastTreatment: "Manutenção MAN-2026-000201 aberta", lastTreatmentAt: "2026-09-30T10:05:00-03:00",
  }),
  plan({
    id: "pl-103", code: "PA-2026-000103", vehicle: "v3",
    title: "Pneus com desgaste", detailLabel: "Dianteiro direito", questionKey: "pneus_ok", actionKey: "q:pneus_ok:pneu_posicao",
    planKey: "q:pneus_ok:pneu_posicao=dianteiro_direito", clusterKey: "pneus", clusterName: "Pneus",
    status: "in_analysis", analysisState: "in_analysis", priority: "medium", deadline: "soon", dueOn: "2026-10-03",
    firstOperationalDate: "2026-09-26", lastOperationalDate: "2026-09-29", occurrences: 2, openItems: 2,
    responsibleUserId: "usr-diego", responsibleName: "Diego Teste", lastTreatment: "Em análise", lastTreatmentAt: "2026-09-29T15:20:00-03:00",
  }),
  plan({
    id: "pl-104", code: "PA-2026-000104", vehicle: "v1",
    title: "Retrovisor danificado", questionKey: "retrovisores_ok", actionKey: "q:retrovisores_ok",
    clusterKey: "carroceria", clusterName: "Carroceria e vidros",
    status: "maintenance_in_progress", analysisState: "awaiting_maintenance", priority: "medium", deadline: "on_time", dueOn: "2026-10-05",
    firstOperationalDate: "2026-09-28", lastOperationalDate: "2026-09-28", responsibleUserId: "usr-carla", responsibleName: "Carla Exemplo",
    maintenances: [{ id: "m-202", code: "MAN-2026-000202", status: "in_progress", origin: "linked_manual", resolutive: true }],
    lastTreatment: "Manutenção MAN-2026-000202 vinculada", lastTreatmentAt: "2026-09-29T08:00:00-03:00",
  }),
  plan({
    id: "pl-105", code: "PA-2026-000105", vehicle: "v4",
    title: "Vazamento de óleo", questionKey: "vazamento_oleo", actionKey: "q:vazamento_oleo",
    clusterKey: "motor", clusterName: "Motor", criticality: "high",
    status: "pending_new_action", analysisState: "awaiting_maintenance", priority: "high", deadline: "overdue", dueOn: "2026-09-26", daysOverdue: 5,
    firstOperationalDate: "2026-09-23", lastOperationalDate: "2026-09-27", occurrences: 2, openItems: 2,
    maintenances: [{ id: "m-203", code: "MAN-2026-000203", status: "cancelled", origin: "auto_reconciliation", resolutive: false }],
    lastTreatment: "Manutenção MAN-2026-000203 cancelada", lastTreatmentAt: "2026-09-28T17:45:00-03:00",
  }),
  plan({
    id: "pl-106", code: "PA-2026-000106", vehicle: "v2",
    title: "Faróis com falha", detailLabel: "Farol direito", questionKey: "farois_ok", actionKey: "q:farois_ok:farois_falha",
    planKey: "q:farois_ok:farois_falha=farol_direito", clusterKey: "iluminacao", clusterName: "Iluminação", criticality: "high",
    status: "awaiting_maintenance", analysisState: "awaiting_maintenance", priority: "low", deadline: "on_time", dueOn: "2026-10-08",
    firstOperationalDate: "2026-08-27", lastOperationalDate: "2026-09-24", occurrences: 4, openItems: 4,
    isRecurrence: true, cycleNumber: 2, previousPlanId: "pl-090",
    lastTreatment: "Aguardando manutenção", lastTreatmentAt: "2026-09-25T09:30:00-03:00",
  }),
  plan({
    id: "pl-107", code: "PA-2026-000107", vehicle: "v5",
    title: "Limpador de para-brisa com falha", questionKey: "limpador_ok", actionKey: "q:limpador_ok",
    clusterKey: "carroceria", clusterName: "Carroceria e vidros",
    status: "resolved_without_maintenance", priority: "low", deadline: "treated_on_time", dueOn: "2026-10-05",
    firstOperationalDate: "2026-09-20", lastOperationalDate: "2026-09-20", closedAt: "2026-09-22T11:10:00-03:00", tmrDays: 2,
    lastTreatment: "Resolvido sem manutenção", lastTreatmentAt: "2026-09-22T11:10:00-03:00",
  }),
  plan({
    id: "pl-108", code: "PA-2026-000108", vehicle: "v3",
    title: "Lanterna traseira queimada", questionKey: "lanternas_ok", actionKey: "q:lanternas_ok",
    clusterKey: "iluminacao", clusterName: "Iluminação",
    status: "resolved", priority: "medium", deadline: "treated_late", dueOn: "2026-09-14",
    firstOperationalDate: "2026-09-07", lastOperationalDate: "2026-09-09", occurrences: 2, closedAt: "2026-09-18T16:00:00-03:00",
    tmrDays: 11, autoClosed: true,
    maintenances: [{ id: "m-204", code: "MAN-2026-000204", status: "completed", origin: "maintenance_module", resolutive: true }],
    lastTreatment: "Resolvido pela manutenção MAN-2026-000204", lastTreatmentAt: "2026-09-18T16:00:00-03:00",
  }),
];

const PRIORITY_RANK: Record<Priority, number> = { critical: 0, high: 1, medium: 2, low: 3 };
const listOf = (value: string | undefined) => (value ?? "").split(",").map((v) => v.trim()).filter(Boolean);

/** O filtro da prévia: só o suficiente para os atalhos e o drill-down mudarem a lista. */
export function filterPlans(f: ActionPlanFilters): ActionPlanRow[] {
  const q = f.q?.trim().toLowerCase();
  return PLANS.filter((p) => {
    if (f.statusGroup === "open" && isClosed(p.status)) return false;
    if (f.statusGroup === "closed" && !isClosed(p.status)) return false;
    if (f.status && !listOf(f.status).includes(p.status)) return false;
    if (f.priority && !listOf(f.priority).includes(p.priority)) return false;
    if (f.deadline === "upcoming" ? !["today", "soon"].includes(p.deadline) : f.deadline && p.deadline !== f.deadline) return false;
    if (f.recurrence && !p.isRecurrence) return false;
    if (f.operation && !listOf(f.operation).includes(p.operationId ?? "")) return false;
    if (f.vehicle && !listOf(f.vehicle).includes(p.vehicleId)) return false;
    if (f.cluster && !listOf(f.cluster).includes(p.clusterKey ?? "")) return false;
    if (f.withMaintenance === "yes" && p.maintenances.length === 0) return false;
    if (f.withMaintenance === "no" && p.maintenances.length > 0) return false;
    if (q && ![p.code, p.licensePlate, p.fleetCode, p.title].some((v) => (v ?? "").toLowerCase().includes(q))) return false;
    return true;
  }).sort((a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || a.code.localeCompare(b.code));
}

export function pageFor(f: ActionPlanFilters, page: number, pageSize: number): ActionPlanPage {
  const rows = filterPlans(f);
  const offset = (Math.max(1, page) - 1) * pageSize;
  return { total: rows.length, rows: rows.slice(offset, offset + pageSize), limit: pageSize, offset, today: TODAY };
}

function pathFor(p: ActionPlanRow, grouping: Grouping): GroupNode[] {
  const vehicle: GroupNode = { key: p.vehicleId, label: p.licensePlate ?? "—", sub: p.fleetCode };
  switch (grouping) {
    case "operation":
      return [
        { key: p.operationId, label: p.operationName ?? "Sem operação" },
        { key: p.stateId, label: p.stateUf ?? "—" },
        { key: p.cityId, label: p.cityName ?? "Sem cidade" },
        { key: p.brId, label: p.brCode ?? "Sem BR" },
        vehicle,
      ];
    case "cluster":
      return [
        { key: p.clusterKey, label: p.clusterName ?? "Sem cluster" },
        { key: p.planKey, label: p.detailLabel ? `${p.title} — ${p.detailLabel}` : p.title },
        { key: p.operationId, label: p.operationName ?? "Sem operação" },
        vehicle,
      ];
    case "vehicle":
      return [vehicle];
    case "priority":
      return [{ key: p.priority, label: p.priority }];
    default:
      return [{ key: p.responsibleUserId, label: p.responsibleName ?? "Sem responsável" }];
  }
}

/** Árvore da prévia: as mesmas contas da rotina `action_plan_groups`, sobre os planos fixos. */
export function groupsFor(f: ActionPlanFilters, grouping: Grouping): GroupRow[] {
  const leaves = new Map<string, GroupRow>();
  for (const p of filterPlans(f)) {
    const path = pathFor(p, grouping);
    const key = JSON.stringify(path.map((n) => n.key));
    const row = leaves.get(key) ?? {
      path, plans: 0, open: 0, closed: 0, overdue: 0, onTime: 0, critical: 0, openItems: 0, occurrences: 0, recurrences: 0,
    };
    const closed = isClosed(p.status);
    row.plans += 1;
    row.open += closed ? 0 : 1;
    row.closed += closed ? 1 : 0;
    row.overdue += p.deadline === "overdue" ? 1 : 0;
    row.onTime += ["on_time", "soon", "today"].includes(p.deadline) ? 1 : 0;
    row.critical += p.priority === "critical" && !closed ? 1 : 0;
    row.openItems += p.openItems;
    row.occurrences += p.occurrences;
    row.recurrences += p.isRecurrence ? 1 : 0;
    leaves.set(key, row);
  }
  return [...leaves.values()].sort((a, b) => b.overdue - a.overdue || b.open - a.open);
}

// ---------------------------------------------------------------------------
// Visão geral
// ---------------------------------------------------------------------------
const WEEKS = [
  "2026-06-29", "2026-07-06", "2026-07-13", "2026-07-20", "2026-07-27", "2026-08-03", "2026-08-10",
  "2026-08-17", "2026-08-24", "2026-08-31", "2026-09-07", "2026-09-14", "2026-09-21", "2026-09-28",
];
const NEW_ITEMS = [9, 12, 10, 14, 11, 13, 15, 12, 10, 14, 13, 16, 12, 6];
const TREATED = [5, 9, 11, 12, 10, 12, 13, 14, 9, 12, 12, 13, 11, 4];

export const DASHBOARD: ActionPlanDashboard = {
  period: { from: "2026-07-01", to: TODAY, bucket: "week", today: TODAY },
  kpis: {
    findingsReceived: 186,
    findingsDamage: 14,
    findingsNotEligible: 9,
    items: 163,
    itemsOpen: 41,
    itemsTreated: 118,
    itemsRwm: 22,
    itemsImproper: 9,
    itemsCancelled: 4,
    itemsInMaintenance: 17,
    plansTotal: 97,
    plansActive: 28,
    plansOverdue: 7,
    plansCritical: 3,
    plansWithMaintenance: 52,
    plansWithoutMaintenance: 45,
    plansRwm: 15,
    plansImproper: 6,
    plansResolved: 46,
    vehiclesPending: 19,
    recurrences: 5,
    treatmentAdherence: 72.4,
    tmrAvgDays: 6.3,
    tmrMedianDays: 4.5,
    tmrP90Days: 14.2,
    onTimePct: 81.5,
  },
  funnel: [
    { key: "received", value: 186 },
    { key: "classified", value: 163 },
    { key: "in_plan", value: 159 },
    { key: "treatment_defined", value: 131 },
    { key: "maintenance_or_other", value: 122 },
    { key: "resolved", value: 118 },
  ],
  deadline: { overdue: 7, today: 2, soon: 4, on_time: 13, no_due: 2, treated_on_time: 52, treated_late: 15, cancelled: 2 },
  aging: [
    { key: "0-7", value: 11 },
    { key: "8-30", value: 10 },
    { key: "31-60", value: 5 },
    { key: "61-90", value: 2 },
    { key: "90+", value: 0 },
  ],
  byPriority: [
    { key: "critical", open: 3, total: 9 },
    { key: "high", open: 8, total: 27 },
    { key: "medium", open: 12, total: 41 },
    { key: "low", open: 5, total: 20 },
  ],
  byStatus: [
    { key: "new", value: 6 },
    { key: "in_analysis", value: 5 },
    { key: "awaiting_maintenance", value: 6 },
    { key: "maintenance_open", value: 2 },
    { key: "maintenance_scheduled", value: 4 },
    { key: "maintenance_in_progress", value: 3 },
    { key: "pending_new_action", value: 2 },
    { key: "resolved", value: 46 },
    { key: "resolved_without_maintenance", value: 15 },
    { key: "improper", value: 6 },
    { key: "cancelled", value: 2 },
  ],
  byOperation: [
    { key: OPS.mg.id, label: OPS.mg.name, open: 17, overdue: 4, total: 58 },
    { key: OPS.pa.id, label: OPS.pa.name, open: 11, overdue: 3, total: 39 },
  ],
  byCity: [
    { key: 3106200, label: "Belo Horizonte (MG)", open: 10, total: 33 },
    { key: 3118601, label: "Contagem (MG)", open: 7, total: 25 },
    { key: 1501402, label: "Belém (PA)", open: 11, total: 39 },
  ],
  byLeader: [
    { key: "ld-ana", label: "Ana Exemplo", open: 17, total: 58 },
    { key: "ld-bruno", label: "Bruno Teste", open: 11, total: 39 },
  ],
  byCluster: [
    { key: "iluminacao", label: "Iluminação", open: 9, total: 31, items: 52 },
    { key: "freios", label: "Freios", open: 5, total: 18, items: 27 },
    { key: "pneus", label: "Pneus", open: 6, total: 20, items: 33 },
    { key: "carroceria", label: "Carroceria e vidros", open: 5, total: 17, items: 29 },
    { key: "motor", label: "Motor", open: 3, total: 11, items: 22 },
  ],
  topItems: [
    { key: "q:farois_ok:farois_falha", label: "Faróis com falha", items: 38, plans: 21, open: 6 },
    { key: "q:pneus_ok:pneu_posicao", label: "Pneus com desgaste", items: 33, plans: 20, open: 6 },
    { key: "q:freio_estacionamento_ok", label: "Freio de estacionamento com folga", items: 27, plans: 18, open: 5 },
    { key: "q:retrovisores_ok", label: "Retrovisor danificado", items: 17, plans: 10, open: 3 },
    { key: "q:lanternas_ok", label: "Lanterna traseira queimada", items: 14, plans: 10, open: 3 },
    { key: "q:vazamento_oleo", label: "Vazamento de óleo", items: 12, plans: 8, open: 2 },
    { key: "q:limpador_ok", label: "Limpador de para-brisa com falha", items: 12, plans: 7, open: 2 },
  ],
  topRecurrentVehicles: [
    { key: "veh-0002", label: "TST2B34", sub: "1031", recurrences: 2, occurrences: 9, open: 2 },
    { key: "veh-0001", label: "TST1A23", sub: "1024", recurrences: 1, occurrences: 7, open: 2 },
    { key: "veh-0004", label: "TST4D56", sub: "2051", recurrences: 1, occurrences: 5, open: 1 },
  ],
  resolutionOrigin: [
    { key: "maintenance_auto", value: 61 },
    { key: "maintenance_validated", value: 22 },
    { key: "resolved_without_maintenance", value: 22 },
    { key: "improper", value: 9 },
    { key: "cancelled", value: 4 },
  ],
  tmrByPriority: [
    { key: "critical", avg: 1.8, median: 1.5, n: 8 },
    { key: "high", avg: 4.2, median: 3, n: 21 },
    { key: "medium", avg: 7.1, median: 6, n: 33 },
    { key: "low", avg: 10.4, median: 9, n: 18 },
  ],
  tmrByCluster: [
    { key: "motor", label: "Motor", avg: 9.2, n: 8 },
    { key: "pneus", label: "Pneus", avg: 7.4, n: 16 },
    { key: "carroceria", label: "Carroceria e vidros", avg: 6.8, n: 13 },
    { key: "iluminacao", label: "Iluminação", avg: 4.9, n: 25 },
    { key: "freios", label: "Freios", avg: 3.1, n: 18 },
  ],
  trend: WEEKS.map((bucket, i) => ({
    bucket,
    newItems: NEW_ITEMS[i],
    treatedItems: TREATED[i],
    newPlans: Math.round(NEW_ITEMS[i] * 0.6),
    closedPlans: Math.round(TREATED[i] * 0.55),
    backlog: 12 + NEW_ITEMS.slice(0, i + 1).reduce((a, b) => a + b, 0) - TREATED.slice(0, i + 1).reduce((a, b) => a + b, 0),
  })),
  coverage: COVERAGE,
};

// ---------------------------------------------------------------------------
// Conciliação × Manutenções
// ---------------------------------------------------------------------------
const candidate = (c: Partial<MaintenanceCandidate> & Pick<MaintenanceCandidate, "maintenanceId" | "code" | "confidence" | "rule">): MaintenanceCandidate => ({
  status: "to_schedule",
  type: "corrective",
  requestedOn: "2026-09-29",
  scheduledDate: null,
  entryDate: null,
  exitDate: null,
  services: null,
  serviceMatch: false,
  autoResolveMatch: false,
  clusterMatch: false,
  contested: false,
  ...c,
});

export const CANDIDATES: Record<string, MaintenanceCandidate[]> = {
  "pl-101": [
    candidate({
      maintenanceId: "m-301", code: "MAN-2026-000301", confidence: "high", rule: "service_mapping_specific",
      status: "scheduled", scheduledDate: "2026-10-02", services: "Farol e lanternas", serviceMatch: true, autoResolveMatch: true, clusterMatch: true,
    }),
  ],
  "pl-103": [
    candidate({
      maintenanceId: "m-302", code: "MAN-2026-000302", confidence: "medium", rule: "same_cluster",
      services: "Alinhamento e balanceamento", clusterMatch: true,
    }),
  ],
  "pl-105": [
    candidate({
      maintenanceId: "m-303", code: "MAN-2026-000303", confidence: "manual_review", rule: "service_mapping_multiple_candidates",
      services: "Correção de vazamento", serviceMatch: true, clusterMatch: true, contested: true,
    }),
    candidate({
      maintenanceId: "m-304", code: "MAN-2026-000304", confidence: "medium", rule: "same_vehicle_period",
      status: "in_progress", entryDate: "2026-09-30", services: "Revisão preventiva",
    }),
  ],
};

function reconciliationRow(p: ActionPlanRow): ReconciliationRow {
  const candidates = CANDIDATES[p.id] ?? [];
  const order: Confidence[] = ["high", "medium", "manual_review"];
  const bestConfidence = order.find((c) => candidates.some((x) => x.confidence === c)) ?? "none";
  return { ...p, bestConfidence, candidates };
}

export function reconciliationFor(f: ActionPlanFilters, confidence: string | null): ReconciliationPage {
  // Só planos em aberto sem manutenção ativa entram na fila de conciliação.
  const all = filterPlans({ ...f, statusGroup: "open" })
    .filter((p) => !p.maintenances.some((m) => !["cancelled", "not_performed"].includes(m.status)))
    .map(reconciliationRow);
  const counts: Partial<Record<Confidence, number>> = {};
  for (const r of all) counts[r.bestConfidence] = (counts[r.bestConfidence] ?? 0) + 1;
  const rows = confidence ? all.filter((r) => r.bestConfidence === confidence) : all;
  return { total: rows.length, counts, rows, coverage: COVERAGE };
}

// ---------------------------------------------------------------------------
// Parâmetros & mapeamento (inclui a pergunta de avaria)
// ---------------------------------------------------------------------------
const parameter = (
  p: Partial<ActionParameter> & Pick<ActionParameter, "id" | "questionKey" | "actionKey">,
): ActionParameter => ({
  appId: APP_ID,
  fieldKey: null,
  actionDomain: "maintenance",
  questionRole: "trigger",
  generatesPlan: true,
  planGrouping: "option",
  actionTitle: null,
  defaultPriority: null,
  slaDays: null,
  requiresMaintenance: true,
  requiresManualAnalysis: false,
  driverVisible: true,
  status: "active",
  notes: null,
  updatedAt: "2026-09-15T10:00:00-03:00",
  ...p,
});

type MappingSeed = Pick<MappingRow, "questionKey" | "question" | "clusterKey" | "clusterName"> & Partial<MappingRow>;
const mapping = (m: MappingSeed): MappingRow => ({
  appId: APP_ID,
  fieldKey: null,
  actionKey: `q:${m.questionKey}${m.fieldKey ? `:${m.fieldKey}` : ""}`,
  fieldLabel: null,
  fieldType: null,
  options: null,
  criticality: "medium",
  versionLabel: "v3.2",
  parameter: null,
  services: [],
  openPlans: 0,
  ...m,
});

const service = (serviceId: string, name: string, cluster: string, autoResolve = true, isActive = true) => ({
  serviceId, name, autoResolve, isActive, serviceStatus: isActive ? "active" : "inactive", archived: false, cluster,
});

export const MAPPING: MappingData = {
  rows: [
    mapping({ questionKey: "farois_ok", question: "Os faróis estão funcionando?", clusterKey: "iluminacao", clusterName: "Iluminação", criticality: "high",
      parameter: parameter({ id: "par-1", questionKey: "farois_ok", actionKey: "q:farois_ok", actionTitle: "Faróis com falha", defaultPriority: "high" }),
      openPlans: 2 }),
    mapping({ questionKey: "farois_ok", fieldKey: "farois_falha", question: "Os faróis estão funcionando?", fieldLabel: "Quais faróis estão com falha?",
      fieldType: "multi_select", clusterKey: "iluminacao", clusterName: "Iluminação", criticality: "high",
      options: [
        { value: "farol_esquerdo", label: "Farol esquerdo" },
        { value: "farol_direito", label: "Farol direito" },
        { value: "farol_milha", label: "Farol de milha" },
      ],
      parameter: parameter({ id: "par-2", questionKey: "farois_ok", fieldKey: "farois_falha", actionKey: "q:farois_ok:farois_falha", questionRole: "detail" }),
      services: [service("sv-far", "Farol e lanternas", "Elétrica")], openPlans: 2 }),
    mapping({ questionKey: "lanternas_ok", question: "As lanternas traseiras estão funcionando?", clusterKey: "iluminacao", clusterName: "Iluminação",
      parameter: parameter({ id: "par-3", questionKey: "lanternas_ok", actionKey: "q:lanternas_ok", actionTitle: "Lanterna traseira queimada" }),
      services: [service("sv-far", "Farol e lanternas", "Elétrica")] }),
    mapping({ questionKey: "freio_estacionamento_ok", question: "O freio de estacionamento está firme?", clusterKey: "freios", clusterName: "Freios",
      criticality: "critical",
      parameter: parameter({ id: "par-4", questionKey: "freio_estacionamento_ok", actionKey: "q:freio_estacionamento_ok",
        actionTitle: "Freio de estacionamento com folga", defaultPriority: "critical", slaDays: 1 }),
      services: [service("sv-fre", "Regulagem do freio de estacionamento", "Freios")], openPlans: 1 }),
    mapping({ questionKey: "pneus_ok", question: "Os pneus estão em bom estado?", clusterKey: "pneus", clusterName: "Pneus",
      parameter: parameter({ id: "par-5", questionKey: "pneus_ok", actionKey: "q:pneus_ok", actionTitle: "Pneus com desgaste" }) }),
    mapping({ questionKey: "pneus_ok", fieldKey: "pneu_posicao", question: "Os pneus estão em bom estado?", fieldLabel: "Qual pneu?", fieldType: "single_select",
      clusterKey: "pneus", clusterName: "Pneus",
      options: [
        { value: "dianteiro_direito", label: "Dianteiro direito" },
        { value: "dianteiro_esquerdo", label: "Dianteiro esquerdo" },
        { value: "traseiro_direito", label: "Traseiro direito" },
        { value: "traseiro_esquerdo", label: "Traseiro esquerdo" },
      ],
      parameter: parameter({ id: "par-6", questionKey: "pneus_ok", fieldKey: "pneu_posicao", actionKey: "q:pneus_ok:pneu_posicao", questionRole: "detail" }),
      services: [service("sv-pne", "Troca de pneu", "Pneus e suspensão"), service("sv-ali", "Alinhamento e balanceamento", "Pneus e suspensão", false)],
      openPlans: 1 }),
    mapping({ questionKey: "retrovisores_ok", question: "Os retrovisores estão íntegros?", clusterKey: "carroceria", clusterName: "Carroceria e vidros",
      parameter: null, openPlans: 1 }),
    mapping({ questionKey: "limpador_ok", question: "O limpador de para-brisa funciona?", clusterKey: "carroceria", clusterName: "Carroceria e vidros",
      criticality: "low",
      parameter: parameter({ id: "par-7", questionKey: "limpador_ok", actionKey: "q:limpador_ok", actionTitle: "Limpador de para-brisa com falha", defaultPriority: "low" }),
      services: [service("sv-pal", "Troca de palheta (antigo)", "Carroceria", true, false)] }),
    mapping({ questionKey: "vazamento_oleo", question: "Há vazamento de óleo?", clusterKey: "motor", clusterName: "Motor", criticality: "high",
      parameter: parameter({ id: "par-8", questionKey: "vazamento_oleo", actionKey: "q:vazamento_oleo", actionTitle: "Vazamento de óleo",
        requiresManualAnalysis: true }),
      services: [service("sv-vaz", "Correção de vazamento", "Motor", false)], openPlans: 1 }),
    // Avaria: vai para o fluxo de Sinistros/Avarias, nunca vira plano de manutenção.
    mapping({ questionKey: "possui_avaria", question: "Possui alguma avaria?", clusterKey: "carroceria", clusterName: "Carroceria e vidros",
      criticality: "high",
      parameter: parameter({ id: "par-9", questionKey: "possui_avaria", actionKey: "q:possui_avaria", actionDomain: "damage",
        generatesPlan: false, requiresMaintenance: false, driverVisible: false, notes: "Encaminhada ao fluxo de Sinistros/Avarias." }) }),
    mapping({ questionKey: "possui_avaria", fieldKey: "descricao_avaria", question: "Possui alguma avaria?", fieldLabel: "Descreva a avaria",
      fieldType: "text", clusterKey: "carroceria", clusterName: "Carroceria e vidros", criticality: "high",
      parameter: parameter({ id: "par-10", questionKey: "possui_avaria", fieldKey: "descricao_avaria", actionKey: "q:possui_avaria:descricao_avaria",
        actionDomain: "damage", questionRole: "description", generatesPlan: false, requiresMaintenance: false, driverVisible: false }) }),
  ],
  coverage: COVERAGE,
  settings: DEFAULT_SETTINGS,
};

// ---------------------------------------------------------------------------
// Qualidade & auditoria
// ---------------------------------------------------------------------------
export const QUALITY: QualityData = {
  checks: [
    { key: "finding_without_item", count: 2, class: "safe", sample: [
      { executionId: "ex-503", answerId: "ans-931", questionKey: "farois_ok", date: "2026-09-29", plate: "TST4D56" },
      { executionId: "ex-504", answerId: "ans-940", questionKey: "pneus_ok", date: "2026-09-28", plate: "TST5E67" },
    ] },
    { key: "plan_without_items", count: 0, class: "review", sample: [] },
    { key: "closed_with_pending", count: 0, class: "review", sample: [] },
    { key: "open_without_pending", count: 1, class: "safe", sample: [{ planId: "pl-104", code: "PA-2026-000104", status: "maintenance_in_progress" }] },
    { key: "stale_counters", count: 1, class: "safe", sample: [{ planId: "pl-104", code: "PA-2026-000104" }] },
    { key: "action_key_without_service", count: 1, class: "review", sample: [{ actionKey: "q:retrovisores_ok", openPlans: 1 }] },
    { key: "mapping_inactive_service", count: 1, class: "review", sample: [{ actionKey: "q:limpador_ok", service: "Troca de palheta (antigo)" }] },
    { key: "trigger_without_detail", count: 0, class: "review", sample: [] },
    { key: "old_open_without_maintenance", count: 1, class: "review", sample: [{ planId: "pl-106", code: "PA-2026-000106", days: 35 }] },
    { key: "link_cancelled_maintenance", count: 1, class: "review", sample: [{ planId: "pl-105", code: "PA-2026-000105", maintenanceCode: "MAN-2026-000203" }] },
    { key: "link_other_vehicle", count: 1, class: "blocked", sample: [{ planId: "pl-108", code: "PA-2026-000108", maintenanceCode: "MAN-2026-000190" }] },
    { key: "plan_without_context", count: 0, class: "blocked", sample: [] },
    { key: "correction_conflict", count: 1, class: "review", sample: [{ planId: "pl-103", itemId: "it-1032" }] },
    { key: "ingestion_failed", count: 1, class: "safe", sample: [{ executionId: "ex-506", error: "Pergunta sem parâmetro publicado na versão do checklist.", attempts: 3 }] },
    { key: "multiple_candidates", count: 1, class: "review", sample: [{ planId: "pl-105", code: "PA-2026-000105", candidates: 2 }] },
  ],
  events: [
    { id: "ev-12", planId: "pl-102", code: "PA-2026-000102", type: "maintenance_opened", reason: "Manutenção MAN-2026-000201 aberta pelo plano.", source: "user", actor: "Carla Exemplo", at: "2026-09-30T10:05:00-03:00" },
    { id: "ev-11", planId: "pl-102", code: "PA-2026-000102", type: "created", reason: null, source: "checklist", actor: null, at: "2026-09-30T07:41:00-03:00" },
    { id: "ev-10", planId: "pl-101", code: "PA-2026-000101", type: "occurrence_added", reason: "Nova ocorrência no checklist de saída.", source: "checklist", actor: null, at: "2026-09-30T07:12:00-03:00" },
    { id: "ev-09", planId: "pl-103", code: "PA-2026-000103", type: "correction_conflict", reason: "O checklist foi corrigido depois da tratativa.", source: "correction", actor: "Sistema", at: "2026-09-29T18:02:00-03:00" },
    { id: "ev-08", planId: "pl-103", code: "PA-2026-000103", type: "analysis_changed", reason: "Verificar desgaste com a oficina parceira.", source: "user", actor: "Diego Teste", at: "2026-09-29T15:20:00-03:00" },
    { id: "ev-07", planId: "pl-104", code: "PA-2026-000104", type: "maintenance_linked", reason: "Mesmo serviço, mesma semana.", source: "user", actor: "Carla Exemplo", at: "2026-09-29T08:00:00-03:00" },
    { id: "ev-06", planId: "pl-105", code: "PA-2026-000105", type: "status_changed", reason: "Manutenção cancelada: nova tratativa necessária.", source: "maintenance", actor: null, at: "2026-09-28T17:45:00-03:00" },
    { id: "ev-05", planId: "pl-106", code: "PA-2026-000106", type: "recurrence_detected", reason: "Mesmo problema em até 30 dias após o encerramento.", source: "system", actor: null, at: "2026-08-27T07:30:00-03:00" },
    { id: "ev-04", planId: "pl-107", code: "PA-2026-000107", type: "items_resolved_without_maintenance", reason: "Palheta recolocada pela operação.", source: "user", actor: "Diego Teste", at: "2026-09-22T11:10:00-03:00" },
    { id: "ev-03", planId: "pl-108", code: "PA-2026-000108", type: "auto_closed", reason: "Manutenção MAN-2026-000204 concluída com o serviço mapeado.", source: "maintenance_auto", actor: null, at: "2026-09-18T16:00:00-03:00" },
    { id: "ev-02", planId: "pl-108", code: "PA-2026-000108", type: "due_changed", reason: "Peça em falta no fornecedor.", source: "user", actor: "Bruno Teste", at: "2026-09-12T09:00:00-03:00" },
    { id: "ev-01", planId: "pl-107", code: "PA-2026-000107", type: "created", reason: null, source: "import", actor: "Carla Exemplo", at: "2026-09-20T08:00:00-03:00" },
  ],
};

/** Saúde no período pedido (7, 30 ou 90 dias), com a série diária determinística. */
export function healthFor(days: number): HealthData {
  const from = new Date(`${TODAY}T00:00:00Z`);
  from.setUTCDate(from.getUTCDate() - days + 1);
  const fromIso = from.toISOString().slice(0, 10);
  const byDay: HealthData["byDay"] = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(from);
    d.setUTCDate(d.getUTCDate() + i);
    const weekday = d.getUTCDay();
    if (weekday === 0) continue; // domingo sem envio: a série real também pula
    const executions = 38 + ((i * 7) % 11) - (weekday === 6 ? 14 : 0);
    byDay.push({ date: d.toISOString().slice(0, 10), executions, items: Math.max(0, Math.round(executions / 7) + ((i * 3) % 4) - 2) });
  }
  const executions = byDay.reduce((a, d) => a + d.executions, 0);
  const items = byDay.reduce((a, d) => a + d.items, 0);
  const withFindings = Math.round(executions * 0.14);
  return {
    days,
    from: fromIso,
    executionsSubmitted: executions,
    executionsWithFindings: withFindings,
    processed: withFindings - 3,
    failed: 1,
    pending: 2,
    findings: Math.round(items * 1.25),
    maintenanceFindings: items,
    damageFindings: Math.max(1, Math.round(items * 0.12)),
    notEligible: Math.max(1, Math.round(items * 0.08)),
    itemsCreated: items,
    plansCreated: Math.round(items * 0.62),
    plansUpdated: Math.round(items * 0.21),
    reprocessed: 4,
    damageEventsPending: 1,
    lastProcessedAt: "2026-10-01T07:58:00-03:00",
    recentFailures: [
      { executionId: "ex-506", error: "Pergunta sem parâmetro publicado na versão do checklist.", attempts: 3, at: "2026-09-30T19:20:00-03:00" },
    ],
    byDay,
  };
}

// ---------------------------------------------------------------------------
// Minha visão
// ---------------------------------------------------------------------------
export const MY_VIEW: MyViewData = {
  today: TODAY,
  scope: { plansOpen: 28, itemsOpen: 41, overdue: 7, dueSoon: 6, critical: 3, inMaintenance: 9, pendingNewAction: 2, withoutTreatment: 8 },
  mine: { plansOpen: 4, overdue: 1 },
  attention: filterPlans({ statusGroup: "open" }).sort((a, b) => {
    const rank = (p: ActionPlanRow) => (p.deadline === "overdue" ? 0 : p.deadline === "today" ? 1 : p.deadline === "soon" ? 2 : 3);
    return rank(a) - rank(b) || PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
  }),
  byOperation: [
    { key: OPS.mg.id, label: OPS.mg.name, open: 17, overdue: 4 },
    { key: OPS.pa.id, label: OPS.pa.name, open: 11, overdue: 3 },
  ],
};

// ---------------------------------------------------------------------------
// Histórico de checklists e rastro
// ---------------------------------------------------------------------------
const EMPLOYEES = {
  joao: { employeeName: "João Exemplo", employeeCode: "T0101" },
  maria: { employeeName: "Maria Teste", employeeCode: "T0102" },
  pedro: { employeeName: "Pedro Demo", employeeCode: "T0201" },
};

const history = (
  id: string, vehicle: keyof typeof VEHICLES, employee: keyof typeof EMPLOYEES, h: Partial<HistoryRow> & Pick<HistoryRow, "operationalDate">,
): HistoryRow => {
  const v = VEHICLES[vehicle];
  return {
    id,
    checklistType: "saida",
    submittedAt: `${h.operationalDate}T07:12:00-03:00`,
    licensePlate: v.licensePlate,
    fleetCode: v.fleetCode,
    vehicleId: v.vehicleId,
    ...EMPLOYEES[employee],
    operationName: v.operationName,
    brCode: v.brCode,
    nonConforming: 1,
    critical: 0,
    items: 1,
    itemsOpen: 1,
    damage: 0,
    ingestionStatus: "processed",
    ...h,
  };
};

const HISTORY_ROWS: HistoryRow[] = [
  history("ex-502", "v2", "maria", { operationalDate: "2026-09-30", nonConforming: 2, critical: 1, items: 1, itemsOpen: 1, damage: 1 }),
  history("ex-501", "v1", "joao", { operationalDate: "2026-09-30", nonConforming: 3, critical: 1, items: 1, itemsOpen: 1, damage: 1 }),
  history("ex-506", "v5", "joao", { operationalDate: "2026-09-30", checklistType: "retorno", submittedAt: "2026-09-30T18:40:00-03:00",
    nonConforming: 1, items: 0, itemsOpen: 0, damage: null, ingestionStatus: "failed" }),
  history("ex-503", "v4", "pedro", { operationalDate: "2026-09-29", nonConforming: 1, items: 0, itemsOpen: 0, ingestionStatus: "pending" }),
  history("ex-505", "v3", "pedro", { operationalDate: "2026-09-29", checklistType: "retorno", submittedAt: "2026-09-29T19:05:00-03:00",
    nonConforming: 2, items: 2, itemsOpen: 2 }),
  history("ex-504", "v5", "joao", { operationalDate: "2026-09-28", nonConforming: 1, items: 0, itemsOpen: 0 }),
  history("ex-500", "v3", "pedro", { operationalDate: "2026-09-09", nonConforming: 1, items: 1, itemsOpen: 0 }),
];

export function historyFor(page: number, pageSize: number): HistoryPage {
  const offset = (Math.max(1, page) - 1) * pageSize;
  return { total: HISTORY_ROWS.length, rows: HISTORY_ROWS.slice(offset, offset + pageSize), limit: pageSize, offset };
}

const TRACES: Record<string, ExecutionTrace> = {
  "ex-501": {
    execution: {
      id: "ex-501", operationalDate: "2026-09-30", checklistType: "saida", licensePlate: "TST1A23",
      submittedAt: "2026-09-30T07:12:00-03:00", employeeName: "João Exemplo", nonConforming: 3,
    },
    ingestion: { status: "processed", source: "trigger", attempts: 1, lastError: null, processedAt: "2026-09-30T07:12:04-03:00" },
    findings: [
      {
        answerId: "ans-901", questionKey: "farois_ok", question: "Os faróis estão funcionando?", answer: "no",
        conditionalValue: { farois_falha: ["farol_esquerdo"] }, note: "Farol esquerdo apagado desde ontem.", route: "maintenance",
        items: [{
          itemId: "it-1013", optionLabel: "Farol esquerdo", status: "pending", planId: "pl-101", planCode: "PA-2026-000101",
          planStatus: "new", title: "Faróis com falha", maintenances: [], resolution: null,
        }],
      },
      {
        answerId: "ans-902", questionKey: "possui_avaria", question: "Possui alguma avaria?", answer: "yes",
        conditionalValue: { descricao_avaria: "Risco na porta lateral direita." }, note: null, route: "damage", items: [],
      },
      {
        answerId: "ans-903", questionKey: "documentos_ok", question: "Os documentos do veículo estão no porta-luvas?", answer: "no",
        conditionalValue: null, note: null, route: "not_eligible", items: [],
      },
    ],
  },
  "ex-502": {
    execution: {
      id: "ex-502", operationalDate: "2026-09-30", checklistType: "saida", licensePlate: "TST2B34",
      submittedAt: "2026-09-30T07:40:00-03:00", employeeName: "Maria Teste", nonConforming: 2,
    },
    ingestion: { status: "processed", source: "trigger", attempts: 1, lastError: null, processedAt: "2026-09-30T07:40:03-03:00" },
    findings: [
      {
        answerId: "ans-911", questionKey: "freio_estacionamento_ok", question: "O freio de estacionamento está firme?", answer: "no",
        conditionalValue: null, note: "Precisa puxar a alavanca até o fim.", route: "maintenance",
        items: [{
          itemId: "it-1021", optionLabel: null, status: "in_maintenance", planId: "pl-102", planCode: "PA-2026-000102",
          planStatus: "maintenance_scheduled", title: "Freio de estacionamento com folga",
          maintenances: [{ id: "m-201", code: "MAN-2026-000201", status: "scheduled", resolutionStatus: "pending" }], resolution: null,
        }],
      },
      {
        answerId: "ans-912", questionKey: "possui_avaria", question: "Possui alguma avaria?", answer: "yes",
        conditionalValue: { descricao_avaria: "Para-choque traseiro amassado." }, note: null, route: "damage", items: [],
      },
    ],
  },
  "ex-506": {
    execution: {
      id: "ex-506", operationalDate: "2026-09-30", checklistType: "retorno", licensePlate: "TST5E67",
      submittedAt: "2026-09-30T18:40:00-03:00", employeeName: "João Exemplo", nonConforming: 1,
    },
    ingestion: {
      status: "failed", source: "cron", attempts: 3, lastError: "Pergunta sem parâmetro publicado na versão do checklist.", processedAt: null,
    },
    findings: [
      {
        answerId: "ans-961", questionKey: "retrovisores_ok", question: "Os retrovisores estão íntegros?", answer: "no",
        conditionalValue: null, note: "Retrovisor direito trincado.", route: "maintenance", items: [],
      },
    ],
  },
};

// ---------------------------------------------------------------------------
// Gavetas do plano (detalhe completo)
// ---------------------------------------------------------------------------
type ItemSeed = Pick<PlanItem, "id" | "executionId" | "answerId" | "operationalDate" | "status"> & Partial<PlanItem>;

function itemsOf(p: ActionPlanRow, seeds: ItemSeed[]): PlanItem[] {
  return seeds.map((s) => ({
    questionKey: p.questionKey,
    question: MAPPING.rows.find((r) => r.questionKey === p.questionKey)?.question ?? p.title,
    answer: "no",
    fieldKey: null,
    optionValue: null,
    optionLabel: p.detailLabel,
    conditionalValue: null,
    detailText: null,
    note: null,
    checklistType: "saida",
    occurredAt: `${s.operationalDate}T07:12:00-03:00`,
    employeeId: "emp-joao",
    ...EMPLOYEES.joao,
    userName: null,
    licensePlate: p.licensePlate,
    operationName: p.operationName,
    brCode: p.brCode,
    leaderName: p.leaderName,
    statusSource: "system",
    resolvedAt: null,
    resolvedByName: null,
    resolvedMaintenanceId: null,
    resolvedMaintenanceCode: null,
    maintenances: [],
    lastResolution: null,
    ...s,
  }));
}

const event = (id: string, type: string, at: string, e: Partial<PlanEvent> = {}): PlanEvent => ({
  id, type, from: null, to: null, reason: null, payload: {}, source: "system", actor: null, at, ...e,
});

function detail(p: ActionPlanRow, extra: Partial<ActionPlanDetail> & Pick<ActionPlanDetail, "items" | "events" | "executions">): ActionPlanDetail {
  return {
    ...p,
    appId: APP_ID,
    fieldKey: null,
    optionValue: null,
    firstExecutionId: extra.executions[extra.executions.length - 1]?.id ?? null,
    canReopen: false,
    openPlanSameProblem: null,
    previousPlan: null,
    nextPlans: [],
    services: [],
    resolutions: [],
    maintenanceLinks: [],
    ...extra,
  };
}

const planById = (id: string) => PLANS.find((p) => p.id === id) as ActionPlanRow;

const DETAILS: Record<string, ActionPlanDetail> = {
  "pl-101": detail(planById("pl-101"), {
    fieldKey: "farois_falha",
    optionValue: "farol_esquerdo",
    services: [{ serviceId: "sv-far", name: "Farol e lanternas", clusterId: "cl-ele", cluster: "Elétrica", autoResolve: true, fieldKey: "farois_falha" }],
    items: itemsOf(planById("pl-101"), [
      { id: "it-1011", executionId: "ex-401", answerId: "ans-801", operationalDate: "2026-09-26", status: "pending", fieldKey: "farois_falha",
        optionValue: "farol_esquerdo", conditionalValue: { farois_falha: ["farol_esquerdo"] }, note: "Farol piscando." },
      { id: "it-1012", executionId: "ex-451", answerId: "ans-851", operationalDate: "2026-09-29", status: "pending", fieldKey: "farois_falha",
        optionValue: "farol_esquerdo", conditionalValue: { farois_falha: ["farol_esquerdo"] }, checklistType: "retorno",
        employeeId: "emp-maria", ...EMPLOYEES.maria },
      { id: "it-1013", executionId: "ex-501", answerId: "ans-901", operationalDate: "2026-09-30", status: "pending", fieldKey: "farois_falha",
        optionValue: "farol_esquerdo", conditionalValue: { farois_falha: ["farol_esquerdo"] }, note: "Farol esquerdo apagado desde ontem." },
    ]),
    events: [
      event("pe-1013", "occurrence_added", "2026-09-30T07:12:04-03:00", { source: "checklist", reason: "Nova ocorrência no checklist de saída." }),
      event("pe-1012", "occurrence_added", "2026-09-29T18:31:00-03:00", { source: "checklist" }),
      event("pe-1011", "created", "2026-09-26T07:12:04-03:00", { source: "checklist", to: "new" }),
    ],
    executions: [
      { id: "ex-501", operationalDate: "2026-09-30", checklistType: "saida", submittedAt: "2026-09-30T07:12:00-03:00", ...EMPLOYEES.joao, nonConforming: 3, licensePlate: "TST1A23" },
      { id: "ex-451", operationalDate: "2026-09-29", checklistType: "retorno", submittedAt: "2026-09-29T18:31:00-03:00", ...EMPLOYEES.maria, nonConforming: 1, licensePlate: "TST1A23" },
      { id: "ex-401", operationalDate: "2026-09-26", checklistType: "saida", submittedAt: "2026-09-26T07:12:00-03:00", ...EMPLOYEES.joao, nonConforming: 1, licensePlate: "TST1A23" },
    ],
  }),
  "pl-102": detail(planById("pl-102"), {
    services: [{ serviceId: "sv-fre", name: "Regulagem do freio de estacionamento", clusterId: "cl-fre", cluster: "Freios", autoResolve: true, fieldKey: null }],
    items: itemsOf(planById("pl-102"), [
      { id: "it-1021", executionId: "ex-502", answerId: "ans-911", operationalDate: "2026-09-30", status: "in_maintenance", statusSource: "maintenance",
        employeeId: "emp-maria", ...EMPLOYEES.maria, note: "Precisa puxar a alavanca até o fim.",
        maintenances: [{ id: "m-201", code: "MAN-2026-000201", status: "scheduled", resolutionStatus: "pending" }] },
    ]),
    maintenanceLinks: [{
      id: "lk-201", maintenanceId: "m-201", code: "MAN-2026-000201", status: "scheduled", type: "corrective", originName: "Check List",
      requestedOn: "2026-09-30", scheduledDate: TODAY, entryDate: null, exitDate: null, serviceOrderNumber: "OS-TST-7781",
      supplierName: "Oficina Exemplo Ltda", services: "Regulagem do freio de estacionamento", linkStatus: "active", origin: "opened_from_plan",
      confidence: null, rule: "opened_from_plan", resolutive: true, reason: null, linkedBy: "Carla Exemplo", linkedAt: "2026-09-30T10:05:00-03:00",
      unlinkedBy: null, unlinkedAt: null, answers: 1, answersResolved: 0,
    }],
    events: [
      event("pe-1023", "maintenance_opened", "2026-09-30T10:05:00-03:00", { source: "user", actor: "Carla Exemplo", from: "new", to: "maintenance_scheduled",
        reason: "Manutenção MAN-2026-000201 aberta pelo plano." }),
      event("pe-1022", "assigned", "2026-09-30T08:15:00-03:00", { source: "user", actor: "Carla Exemplo", to: "Carla Exemplo" }),
      event("pe-1021", "created", "2026-09-30T07:40:03-03:00", { source: "checklist", to: "new" }),
    ],
    executions: [
      { id: "ex-502", operationalDate: "2026-09-30", checklistType: "saida", submittedAt: "2026-09-30T07:40:00-03:00", ...EMPLOYEES.maria, nonConforming: 2, licensePlate: "TST2B34" },
    ],
  }),
  "pl-106": detail(planById("pl-106"), {
    fieldKey: "farois_falha",
    optionValue: "farol_direito",
    previousPlan: { id: "pl-090", code: "PA-2026-000090", status: "resolved", closedAt: "2026-08-12T15:00:00-03:00" },
    services: [{ serviceId: "sv-far", name: "Farol e lanternas", clusterId: "cl-ele", cluster: "Elétrica", autoResolve: true, fieldKey: "farois_falha" }],
    items: itemsOf(planById("pl-106"), [
      { id: "it-1061", executionId: "ex-301", answerId: "ans-701", operationalDate: "2026-08-27", status: "pending", optionValue: "farol_direito" },
      { id: "it-1062", executionId: "ex-331", answerId: "ans-731", operationalDate: "2026-09-04", status: "pending", optionValue: "farol_direito" },
      { id: "it-1063", executionId: "ex-371", answerId: "ans-771", operationalDate: "2026-09-15", status: "pending", optionValue: "farol_direito" },
      { id: "it-1064", executionId: "ex-421", answerId: "ans-821", operationalDate: "2026-09-24", status: "pending", optionValue: "farol_direito" },
    ]),
    events: [
      event("pe-1063", "analysis_changed", "2026-09-25T09:30:00-03:00", { source: "user", actor: "Ana Exemplo", to: "awaiting_maintenance",
        reason: "Aguardando peça para a troca do farol." }),
      event("pe-1062", "recurrence_detected", "2026-08-27T07:30:00-03:00", { reason: "Mesmo problema em até 30 dias após o encerramento do PA-2026-000090." }),
      event("pe-1061", "created", "2026-08-27T07:30:00-03:00", { source: "checklist", to: "new" }),
    ],
    executions: [
      { id: "ex-421", operationalDate: "2026-09-24", checklistType: "saida", submittedAt: "2026-09-24T07:05:00-03:00", ...EMPLOYEES.maria, nonConforming: 1, licensePlate: "TST2B34" },
      { id: "ex-301", operationalDate: "2026-08-27", checklistType: "saida", submittedAt: "2026-08-27T07:20:00-03:00", ...EMPLOYEES.maria, nonConforming: 1, licensePlate: "TST2B34" },
    ],
  }),
};

export const FIXTURES: PreviewFixtures = { details: DETAILS, candidates: CANDIDATES, traces: TRACES };
