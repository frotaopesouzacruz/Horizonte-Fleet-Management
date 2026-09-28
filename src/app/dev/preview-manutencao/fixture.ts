import type {
  HierarchyRow,
  MaintenanceCatalog,
  MaintenanceDashboard,
  MaintenancePage,
  MaintenanceParameters,
  MaintenanceRow,
  PredictiveOverview,
  PreventiveMatrix,
  ScheduleKpis,
} from "@/lib/maintenance/types";
import { DEFAULT_SETTINGS } from "@/lib/maintenance/types";
import type { MaintenanceFilterOptions, MaintenanceImportHistoryRow } from "@/lib/maintenance/queries";

/**
 * Dados fixos para a prévia da Manutenção (mesmo portão do design system).
 *
 * Moldados como a base real: setembro/2026, hoje dia 28, uma frota pequena
 * que passa por todos os estados que a tela precisa distinguir — há agendar,
 * agendada hoje, entrada atrasada, em execução com saída vencida, concluída
 * com TMM exato e por data, reaberta, cancelada, KM validado, estimado,
 * manual e divergente; preventiva crítica, vencida, a programar e realizada;
 * preditiva crítica, em monitoramento e aguardando corretiva.
 */
export const TODAY = "2026-09-28";

const OPS = {
  mg: { id: "op-mg", name: "Last Mille MG" },
  pa: { id: "op-pa", name: "Redespacho - Belém/Pa" },
};

export const CATALOG: MaintenanceCatalog = {
  types: [
    { code: "preventive", name: "Preventiva", description: "Revisão programada por marco de KM (ciclos MP)." },
    { code: "corrective", name: "Corretiva", description: "Correção de falha ou defeito." },
    { code: "predictive", name: "Preditiva", description: "Inspeção técnica por plano (KM e dias)." },
  ],
  origins: [
    { id: "or-op", code: "operation", name: "Operação", description: "Abertura manual autorizada pelo time operacional.", isActive: true, isSystem: true, manualSelectable: true, organizationId: null },
    { id: "or-ck", code: "checklist", name: "Check List", description: "Apontamento inconforme do Check List de Frota.", isActive: true, isSystem: true, manualSelectable: true, organizationId: null },
    { id: "or-dr", code: "driver_report", name: "Relato do motorista", description: null, isActive: true, isSystem: true, manualSelectable: true, organizationId: null },
    { id: "or-sr", code: "roadside_assistance", name: "Socorro em rota", description: null, isActive: true, isSystem: true, manualSelectable: true, organizationId: null },
    { id: "or-ps", code: "preventive_schedule", name: "Programação preventiva", description: null, isActive: true, isSystem: true, manualSelectable: false, organizationId: null },
    { id: "or-pd", code: "predictive", name: "Motor preditivo", description: null, isActive: true, isSystem: true, manualSelectable: false, organizationId: null },
    { id: "or-im", code: "import", name: "Importação", description: null, isActive: true, isSystem: true, manualSelectable: false, organizationId: null },
  ],
  clusters: [
    { id: "cl-mot", code: "MOTOR", name: "Motor", description: null, defaultCriticality: "high", status: "active", sortOrder: 10, services: 3 },
    { id: "cl-fre", code: "FREIOS", name: "Freios", description: null, defaultCriticality: "critical", status: "active", sortOrder: 20, services: 2 },
    { id: "cl-ele", code: "ELETRICA", name: "Elétrica", description: null, defaultCriticality: "medium", status: "active", sortOrder: 30, services: 1 },
    { id: "cl-pne", code: "PNEUS", name: "Pneus e suspensão", description: null, defaultCriticality: "medium", status: "active", sortOrder: 40, services: 1 },
  ],
  services: [
    { id: "sv-rev", clusterId: "cl-mot", clusterName: "Motor", name: "Revisão preventiva", description: null, criticality: "medium", status: "active", isPredictive: false, expectedHours: 8, maintenanceTypeCodes: ["preventive"], vehicleTypeIds: [], checklistLinks: [] },
    { id: "sv-oleo", clusterId: "cl-mot", clusterName: "Motor", name: "Troca de óleo e filtros", description: null, criticality: "medium", status: "active", isPredictive: false, expectedHours: 3, maintenanceTypeCodes: [], vehicleTypeIds: [], checklistLinks: [] },
    { id: "sv-corr", clusterId: "cl-mot", clusterName: "Motor", name: "Inspeção de correia", description: null, criticality: "high", status: "active", isPredictive: true, expectedHours: 2, maintenanceTypeCodes: ["predictive", "corrective"], vehicleTypeIds: [], checklistLinks: [] },
    { id: "sv-pas", clusterId: "cl-fre", clusterName: "Freios", name: "Troca de pastilhas", description: null, criticality: "critical", status: "active", isPredictive: false, expectedHours: 3, maintenanceTypeCodes: [], vehicleTypeIds: [], checklistLinks: [{ appId: "app-ck", questionKey: "freios_ok", fieldKey: null, autoResolve: true }] },
    { id: "sv-dis", clusterId: "cl-fre", clusterName: "Freios", name: "Retífica de discos", description: null, criticality: "high", status: "active", isPredictive: false, expectedHours: 5, maintenanceTypeCodes: [], vehicleTypeIds: [], checklistLinks: [] },
    { id: "sv-far", clusterId: "cl-ele", clusterName: "Elétrica", name: "Farol e lanternas", description: null, criticality: "medium", status: "active", isPredictive: false, expectedHours: 1, maintenanceTypeCodes: [], vehicleTypeIds: [], checklistLinks: [{ appId: "app-ck", questionKey: "iluminacao_ok", fieldKey: null, autoResolve: true }] },
    { id: "sv-ali", clusterId: "cl-pne", clusterName: "Pneus e suspensão", name: "Alinhamento e balanceamento", description: null, criticality: "low", status: "active", isPredictive: false, expectedHours: 2, maintenanceTypeCodes: [], vehicleTypeIds: [], checklistLinks: [] },
  ],
  suppliers: [
    { id: "sp-cen", name: "Oficina Central Diesel Ltda", tradeName: "Oficina Central", documentNumber: "11222333000181", address: "Av. Industrial, 1200", stateId: 31, stateUf: "MG", cityId: 3106200, cityName: "Belo Horizonte", clusterIds: ["cl-mot", "cl-fre"], serviceIds: [], servedCityIds: [], status: "active", notes: null },
    { id: "sp-nor", name: "Norte Freios e Peças", tradeName: null, documentNumber: "22333444000190", address: null, stateId: 15, stateUf: "PA", cityId: 1501402, cityName: "Belém", clusterIds: ["cl-fre"], serviceIds: [], servedCityIds: [], status: "active", notes: null },
  ],
  settings: DEFAULT_SETTINGS,
};

export const OPTIONS: MaintenanceFilterOptions = {
  operations: [OPS.mg, OPS.pa],
  coverage: [
    { operationId: OPS.mg.id, stateId: 31, uf: "MG", cityId: 3122306, cityName: "Divinópolis" },
    { operationId: OPS.mg.id, stateId: 31, uf: "MG", cityId: 3118601, cityName: "Contagem" },
    { operationId: OPS.pa.id, stateId: 15, uf: "PA", cityId: 1501402, cityName: "Belém" },
  ],
  brs: [
    { id: "br-1", code: "BR0024107", operationId: OPS.mg.id, cityId: 3122306 },
    { id: "br-2", code: "BR0024901", operationId: OPS.mg.id, cityId: 3118601 },
    { id: "br-3", code: "Redespacho Belem/Pa_1", operationId: OPS.pa.id, cityId: 1501402 },
  ],
  leaders: [
    { id: "ld-1", name: "Leandro Carvalho Silva" },
    { id: "ld-2", name: "Walace Rocha De Souza" },
  ],
  vehicleTypes: [
    { id: "vt-van", name: "Van" },
    { id: "vt-car", name: "Frota Leve ADM" },
  ],
  subcategories: [{ id: "sc-cargo", name: "Van carga", vehicleTypeId: "vt-van" }],
  makes: [{ id: "mk-rn", name: "Renault" }],
  models: [{ id: "md-master", name: "Master", makeId: "mk-rn" }],
  units: [{ id: "un-87", name: "87 · Horizonte MG" }],
  apps: [{ id: "app-ck", name: "Check List de Frota" }],
};

type RowSeed = Partial<MaintenanceRow> & Pick<MaintenanceRow, "id" | "code" | "type" | "status">;

const VEH = {
  va116: { vehicleId: "v1", fleetCode: "VA116", licensePlate: "SNT8E16", operationId: OPS.mg.id, operationName: OPS.mg.name, stateUf: "MG", cityId: 3122306, cityName: "Divinópolis", brId: "br-1", brCode: "BR0024107", leaderId: "ld-2", leaderName: "Walace Rocha De Souza" },
  va131: { vehicleId: "v2", fleetCode: "VA131", licensePlate: "SNT8G21", operationId: OPS.mg.id, operationName: OPS.mg.name, stateUf: "MG", cityId: 3118601, cityName: "Contagem", brId: "br-2", brCode: "BR0024901", leaderId: "ld-2", leaderName: "Walace Rocha De Souza" },
  va163: { vehicleId: "v4", fleetCode: "VA163", licensePlate: "SNT1A73", operationId: OPS.pa.id, operationName: OPS.pa.name, stateUf: "PA", cityId: 1501402, cityName: "Belém", brId: "br-3", brCode: "Redespacho Belem/Pa_1", leaderId: "ld-1", leaderName: "Leandro Carvalho Silva" },
  va170: { vehicleId: "v6", fleetCode: "VA170", licensePlate: "SNT8J46", operationId: OPS.pa.id, operationName: OPS.pa.name, stateUf: "PA", cityId: 1501402, cityName: "Belém", brId: null, brCode: null, leaderId: "ld-1", leaderName: "Leandro Carvalho Silva" },
};

function row(seed: RowSeed): MaintenanceRow {
  return {
    typeName: null, priority: "medium", originId: "or-op", originName: "Operação",
    vehicleId: "v1", licensePlate: null, fleetCode: null, operationId: null, operationName: null, stateUf: null,
    cityId: null, cityName: null, brId: null, brCode: null, leaderId: null, leaderName: null, unitName: "87 · Horizonte MG",
    supplierId: null, supplierName: null, serviceOrderNumber: null, description: null,
    requestedOn: null, scheduledDate: null, scheduledTime: null, expectedExitDate: null, expectedExitTime: null,
    entryDate: null, entryTime: null, exitDate: null, exitTime: null, durationHours: null, durationPrecision: null,
    entryKm: null, entryKmStatus: null, entryKmSource: null, currentKm: 51230, ageDays: null,
    lateEntry: false, exitOverdue: false, reopenCount: 0, preventiveCycleId: null, predictiveCycleId: null, items: [],
    createdAt: "2026-09-01T12:00:00.000Z", updatedAt: "2026-09-27T12:00:00.000Z",
    ...seed,
  };
}
const item = (id: string, serviceId: string, status: MaintenanceRow["items"][number]["status"] = "pending", result: MaintenanceRow["items"][number]["result"] = null) => {
  const s = CATALOG.services.find((x) => x.id === serviceId)!;
  return { id, serviceId, service: s.name, clusterId: s.clusterId, cluster: s.clusterName, criticality: s.criticality, status, result };
};

export const ROWS: MaintenanceRow[] = [
  row({ id: "m1", code: "MAN-2026-000118", type: "corrective", status: "to_schedule", priority: "high", ...VEH.va116, originId: "or-ck", originName: "Check List", requestedOn: "2026-09-20", ageDays: 8, description: "Pastilha no limite; ruído ao frear.", items: [item("i1", "sv-pas"), item("i2", "sv-dis")] }),
  row({ id: "m2", code: "MAN-2026-000121", type: "preventive", status: "scheduled", ...VEH.va131, originId: "or-ps", originName: "Programação preventiva", requestedOn: "2026-09-22", scheduledDate: "2026-09-28", scheduledTime: "08:00:00", expectedExitDate: "2026-09-29", supplierId: "sp-cen", supplierName: "Oficina Central Diesel Ltda", ageDays: 6, preventiveCycleId: "pc-2-3", items: [item("i3", "sv-rev")] }),
  row({ id: "m3", code: "MAN-2026-000109", type: "corrective", status: "scheduled", ...VEH.va163, originId: "or-dr", originName: "Relato do motorista", requestedOn: "2026-09-15", scheduledDate: "2026-09-24", scheduledTime: "09:30:00", supplierId: "sp-nor", supplierName: "Norte Freios e Peças", lateEntry: true, ageDays: 13, items: [item("i4", "sv-far")] }),
  row({ id: "m4", code: "MAN-2026-000097", type: "corrective", status: "in_progress", priority: "critical", ...VEH.va170, originId: "or-sr", originName: "Socorro em rota", requestedOn: "2026-09-18", scheduledDate: "2026-09-19", entryDate: "2026-09-19", entryTime: "10:15:00", expectedExitDate: "2026-09-25", supplierId: "sp-nor", supplierName: "Norte Freios e Peças", serviceOrderNumber: "OS-44821", entryKm: 88310, entryKmStatus: "divergent", entryKmSource: "manual", exitOverdue: true, ageDays: 9, items: [item("i5", "sv-oleo"), item("i6", "sv-corr")] }),
  row({ id: "m5", code: "MAN-2026-000088", type: "corrective", status: "completed", ...VEH.va116, requestedOn: "2026-09-05", scheduledDate: "2026-09-10", scheduledTime: "08:00:00", entryDate: "2026-09-10", entryTime: "08:15:00", exitDate: "2026-09-12", exitTime: "17:15:00", durationHours: 57, durationPrecision: "exact", supplierId: "sp-cen", supplierName: "Oficina Central Diesel Ltda", entryKm: 50474, entryKmStatus: "estimated", entryKmSource: "interpolated", reopenCount: 1, items: [item("i7", "sv-oleo", "done", "resolved"), item("i8", "sv-pas", "done", "partially_resolved")] }),
  row({ id: "m6", code: "MAN-2026-000074", type: "predictive", status: "completed", ...VEH.va131, originId: "or-pd", originName: "Motor preditivo", requestedOn: "2026-08-28", entryDate: "2026-09-01", exitDate: "2026-09-02", durationHours: 24, durationPrecision: "date", entryKm: 61020, entryKmStatus: "validated", entryKmSource: "official_reading", predictiveCycleId: "pd-1", items: [item("i9", "sv-corr", "done", "resolved")] }),
  row({ id: "m7", code: "MAN-2026-000069", type: "corrective", status: "cancelled", ...VEH.va163, requestedOn: "2026-08-25", items: [item("i10", "sv-ali", "cancelled")] }),
];

const pageOf = (rows: MaintenanceRow[]): MaintenancePage => ({ total: rows.length, rows, limit: 50, offset: 0, today: TODAY });
export const BASE_PAGE = pageOf(ROWS);
export const SCHEDULE_PAGE = pageOf(ROWS.filter((r) => ["to_schedule", "scheduled", "in_progress"].includes(r.status)));

export const SCHEDULE_KPIS: ScheduleKpis = {
  today: TODAY, toSchedule: 1, scheduled: 2, inProgress: 1, scheduledToday: 1, lateEntry: 1, exitOverdue: 1,
  unscheduledOverdue: 1, overSla: 1, completedToday: 0, defaultSlaHours: 72, scheduleOverdueDays: 5,
};

export const HIERARCHY: HierarchyRow[] = [
  { ...VEH.va116, total: 2, open: 1, inProgress: 0, lastReference: "2026-09-20" },
  { ...VEH.va131, total: 2, open: 1, inProgress: 0, lastReference: "2026-09-28" },
  { ...VEH.va163, total: 2, open: 1, inProgress: 0, lastReference: "2026-09-24" },
  { ...VEH.va170, total: 1, open: 1, inProgress: 1, lastReference: "2026-09-19" },
].map((v) => ({
  operationId: v.operationId, operationName: v.operationName, stateUf: v.stateUf, cityId: v.cityId, cityName: v.cityName,
  brId: v.brId, brCode: v.brCode, vehicleId: v.vehicleId, licensePlate: v.licensePlate, fleetCode: v.fleetCode,
  total: v.total, open: v.open, inProgress: v.inProgress, lastReference: v.lastReference,
}));

export const DASHBOARD: MaintenanceDashboard = {
  period: { from: "2026-04-01", to: TODAY, days: 181, today: TODAY, previousFrom: "2025-10-02", previousTo: "2026-03-31" },
  kpis: {
    volume: 46, completed: 38, cancelled: 2, notPerformed: 1, corrective: 27, preventive: 14, predictive: 5,
    tmmHours: 41.6, tmmDays: 1.73, tmmCorrectiveDays: 2.1, tmmCorrectiveP90Days: 4.4, downtimeHours: 1580.8, slaWithin: 29,
    recurrences: 4, open: 4, toSchedule: 1, scheduled: 2, inProgress: 1, scheduledToday: 1, lateEntry: 1, exitOverdue: 1,
    unscheduledOverdue: 1, backlog7d: 3, activeVehicles: 58, immobilizedVehicles: 1, ongoingDowntimeHours: 218.5,
    recurrentVehicles: 3, preventiveCritical: 2, preventiveDue: 3, preventiveToSchedule: 5, preventiveEarly: 2,
    preventiveOnTime: 9, preventiveLate: 3, predictiveCritical: 2,
  },
  previous: {
    volume: 39, completed: 33, cancelled: 1, notPerformed: 0, corrective: 25, preventive: 11, predictive: 3,
    tmmHours: 49.2, tmmDays: 2.05, tmmCorrectiveDays: 2.6, tmmCorrectiveP90Days: 5.1, downtimeHours: 1623.6, slaWithin: 21, recurrences: 6,
  },
  monthly: [
    { month: "2026-04", total: 7, corrective: 4, preventive: 2, predictive: 1 },
    { month: "2026-05", total: 9, corrective: 6, preventive: 3, predictive: 0 },
    { month: "2026-06", total: 6, corrective: 3, preventive: 2, predictive: 1 },
    { month: "2026-07", total: 8, corrective: 5, preventive: 2, predictive: 1 },
    { month: "2026-08", total: 7, corrective: 4, preventive: 2, predictive: 1 },
    { month: "2026-09", total: 9, corrective: 5, preventive: 3, predictive: 1 },
  ],
  mix: [{ type: "corrective", count: 27 }, { type: "preventive", count: 14 }, { type: "predictive", count: 5 }],
  statuses: [
    { status: "completed", count: 38 }, { status: "scheduled", count: 2 }, { status: "cancelled", count: 2 },
    { status: "to_schedule", count: 1 }, { status: "in_progress", count: 1 }, { status: "not_performed", count: 1 },
  ],
  aging: [
    { bucket: "0–2 dias", upper: 2, count: 0 }, { bucket: "3–5 dias", upper: 5, count: 1 },
    { bucket: "6–10 dias", upper: 10, count: 2 }, { bucket: "11–20 dias", upper: 20, count: 1 }, { bucket: "> 20 dias", upper: null, count: 0 },
  ],
  agingBuckets: [2, 5, 10, 20],
  clusters: [
    { cluster: "Motor", count: 21, completed: 18, tmmDays: 1.9, tmmMedianDays: 1.5 },
    { cluster: "Freios", count: 14, completed: 12, tmmDays: 1.4, tmmMedianDays: 1.1 },
    { cluster: "Elétrica", count: 7, completed: 6, tmmDays: 0.6, tmmMedianDays: 0.5 },
    { cluster: "Pneus e suspensão", count: 4, completed: 2, tmmDays: 0.4, tmmMedianDays: 0.4 },
  ],
  services: [
    { service: "Troca de pastilhas", cluster: "Freios", count: 11, tmmDays: 1.1 },
    { service: "Revisão preventiva", cluster: "Motor", count: 10, tmmDays: 1.0 },
    { service: "Troca de óleo e filtros", cluster: "Motor", count: 8, tmmDays: 0.5 },
    { service: "Farol e lanternas", cluster: "Elétrica", count: 6, tmmDays: 0.3 },
  ],
  suppliers: [
    { supplier: "Oficina Central Diesel Ltda", count: 24, completed: 21, open: 1, tmmDays: 1.6 },
    { supplier: "Norte Freios e Peças", count: 15, completed: 12, open: 2, tmmDays: 2.2 },
  ],
  recurrence: [
    { vehicleId: "v1", licensePlate: "SNT8E16", cluster: "Freios", recurrences: 2, sameService: 1, avgIntervalDays: 11.5, last: "2026-09-20" },
    { vehicleId: "v6", licensePlate: "SNT8J46", cluster: "Motor", recurrences: 1, sameService: 0, avgIntervalDays: 19, last: "2026-09-18" },
  ],
  recurrenceWindowDays: 30,
};

const mp = (vehicle: string, n: number, status: PreventiveMatrix["rows"][number]["cycles"][number]["status"], milestone: number, extra: Partial<PreventiveMatrix["rows"][number]["cycles"][number]> = {}) => ({
  id: `pc-${vehicle}-${n}`, number: n, status, milestoneKm: milestone, kmRemaining: null, kmExceeded: null, completedOn: null,
  completedKm: null, completedMaintenanceId: null, adherence: null, adherenceKm: null, adherencePct: null, openMaintenance: null, ...extra,
});

export const PREVENTIVE: PreventiveMatrix = {
  today: TODAY,
  situation: "active",
  summary: { vehicles: 4, noRule: 1, noKm: 0, notReached: 6, toSchedule: 1, due: 1, critical: 1, completed: 4, programmed: 1 },
  rows: [
    {
      vehicleId: "v1", licensePlate: "SNT8E16", fleetCode: "VA116", typeName: "Van", subcategoryName: "Van carga", modelName: "Master",
      operationId: OPS.mg.id, operationName: OPS.mg.name, cityName: "Divinópolis", brCode: "BR0024107", vehicleStatus: "active",
      currentKm: 51230, currentKmDate: "2026-09-27", hasRule: true, diagnostics: [],
      cycles: [
        mp("1", 1, "completed", 10000, { completedOn: "2026-02-10", completedKm: 9870, adherence: "on_time", adherenceKm: -130, adherencePct: -1.3 }),
        mp("1", 2, "completed", 20000, { completedOn: "2026-04-22", completedKm: 21400, adherence: "late", adherenceKm: 1400, adherencePct: 14 }),
        mp("1", 3, "completed", 30000, { completedOn: "2026-06-11", completedKm: 29100, adherence: "early", adherenceKm: -900, adherencePct: -9 }),
        mp("1", 4, "completed", 40000, { completedOn: "2026-07-30", completedKm: 40210, adherence: "on_time", adherenceKm: 210, adherencePct: 2.1 }),
        mp("1", 5, "critical", 50000, { kmExceeded: 1230 }),
        mp("1", 6, "not_reached", 60000, { kmRemaining: 8770 }),
      ],
    },
    {
      vehicleId: "v2", licensePlate: "SNT8G21", fleetCode: "VA131", typeName: "Van", subcategoryName: "Van carga", modelName: "Master",
      operationId: OPS.mg.id, operationName: OPS.mg.name, cityName: "Contagem", brCode: "BR0024901", vehicleStatus: "active",
      currentKm: 29640, currentKmDate: "2026-09-26", hasRule: true, diagnostics: [],
      cycles: [
        mp("2", 1, "due", 10000, { kmExceeded: 19640 }),
        mp("2", 2, "due", 20000, { kmExceeded: 9640 }),
        mp("2", 3, "to_schedule", 30000, { kmRemaining: 360, openMaintenance: { id: "m2", code: "MAN-2026-000121", status: "scheduled" } }),
        mp("2", 4, "not_reached", 40000, { kmRemaining: 10360 }),
        mp("2", 5, "not_reached", 50000, { kmRemaining: 20360 }),
        mp("2", 6, "not_reached", 60000, { kmRemaining: 30360 }),
      ],
    },
    {
      vehicleId: "v5", licensePlate: "UHJ4I15", fleetCode: "FL145", typeName: "Frota Leve ADM", subcategoryName: null, modelName: null,
      operationId: OPS.mg.id, operationName: OPS.mg.name, cityName: "Divinópolis", brCode: null, vehicleStatus: "active",
      currentKm: 12050, currentKmDate: "2026-09-20", hasRule: false, diagnostics: ["Sem parâmetro preventivo para este tipo/modelo."], cycles: [],
    },
  ],
};

const cell = (cycleId: string, status: PredictiveOverview["rows"][number]["cells"][string]["status"], extra: Partial<PredictiveOverview["rows"][number]["cells"][string]> = {}) => ({
  cycleId, status, execution: "not_programmed" as const, conformity: "no_verification" as const, monitoring: false,
  nextKm: null, nextDate: null, kmRemaining: null, daysRemaining: null, referenceKm: null, referenceDate: null, referenceType: "none",
  lastVerificationOn: null, openMaintenanceId: null, openMaintenanceCode: null, ...extra,
});

export const PREDICTIVE: PredictiveOverview = {
  today: TODAY,
  summary: {
    itemsMonitored: 8, critical: 1, due: 1, toSchedule: 1, upcoming: 1, ok: 2, initialInspection: 1, noKm: 1, monitoring: 1,
    scheduled: 0, inProgress: 1, awaitingCorrective: 1, forecastKm: 2, forecastDays: 1, forecastKmWindow: 5000, forecastDaysWindow: 30,
  },
  coverage: { activeVehicles: 58, coveredVehicles: 4, uncoveredVehicles: 54, coveragePct: 6.9 },
  criticalClusters: [{ cluster: "Motor", critical: 2, toSchedule: 0 }],
  columns: [
    { itemId: "it-corr", item: "Correia dentada", clusterId: "cl-mot", cluster: "Motor" },
    { itemId: "it-fre", item: "Sistema de freios", clusterId: "cl-fre", cluster: "Freios" },
  ],
  rows: [
    {
      vehicleId: "v1", licensePlate: "SNT8E16", fleetCode: "VA116", typeName: "Van", modelName: "Master", operationName: OPS.mg.name,
      cityName: "Divinópolis", planName: "Plano Van Master", currentKm: 51230, currentKmDate: "2026-09-27", worst: 6,
      cells: {
        "it-corr": cell("pd-11", "critical", { nextKm: 50474, kmRemaining: -756, nextDate: "2027-09-12", daysRemaining: 349, referenceKm: 30474, referenceDate: "2025-09-12", referenceType: "maintenance" }),
        "it-fre": cell("pd-12", "ok", { nextKm: 60000, kmRemaining: 8770, conformity: "conforming", referenceType: "verification", referenceDate: "2026-08-10", referenceKm: 48000, lastVerificationOn: "2026-08-10" }),
      },
    },
    {
      vehicleId: "v6", licensePlate: "SNT8J46", fleetCode: "VA170", typeName: "Van", modelName: "Master", operationName: OPS.pa.name,
      cityName: "Belém", planName: "Plano Van Master", currentKm: 88420, currentKmDate: "2026-09-25", worst: 5,
      cells: {
        "it-corr": cell("pd-21", "due", { execution: "in_progress", conformity: "non_conforming", nextKm: 88000, kmRemaining: -420, openMaintenanceId: "m4", openMaintenanceCode: "MAN-2026-000097", referenceType: "verification", referenceDate: "2026-09-18", referenceKm: 87990, lastVerificationOn: "2026-09-18" }),
        "it-fre": cell("pd-22", "upcoming", { conformity: "monitor", monitoring: true, nextKm: 91000, kmRemaining: 2580, referenceType: "verification", referenceDate: "2026-09-01", referenceKm: 86000, lastVerificationOn: "2026-09-01" }),
      },
    },
  ],
  alerts: [],
};
PREDICTIVE.alerts = PREDICTIVE.rows.flatMap((r) =>
  PREDICTIVE.columns
    .map((c) => ({ c, v: r.cells[c.itemId] }))
    .filter(({ v }) => v && ["critical", "due", "to_schedule", "upcoming"].includes(v.status))
    .map(({ c, v }) => ({
      ...v, vehicleId: r.vehicleId, licensePlate: r.licensePlate, fleetCode: r.fleetCode, operationName: r.operationName,
      planName: r.planName ?? "", cluster: c.cluster, item: c.item, criticality: "high" as const, currentKm: r.currentKm,
    })),
);

export const PARAMETERS: MaintenanceParameters = {
  preventiveRules: [
    {
      id: "pr-van", vehicleTypeId: "vt-van", vehicleTypeName: "Van", vehicleSubcategoryId: null, vehicleSubcategoryName: null,
      vehicleModelId: null, vehicleModelName: null, serviceId: "sv-rev", serviceName: "Revisão preventiva", intervalKm: 10000,
      initialKm: 0, cycleCount: 20, alertBeforePct: 5, toleranceAfterPct: 5, criticality: "medium", status: "active", notes: null,
      vehicles: 41, updatedAt: "2026-09-01T12:00:00.000Z",
    },
  ],
  predictivePlans: [
    {
      id: "pl-van", code: "PPT-001", name: "Plano Van Master", description: "Inspeções técnicas da Master 2.3.", vehicleTypeId: "vt-van",
      vehicleTypeName: "Van", vehicleSubcategoryId: null, vehicleSubcategoryName: null, vehicleMakeId: "mk-rn", vehicleMakeName: "Renault",
      vehicleModelId: "md-master", vehicleModelName: "Master", yearFrom: 2019, yearTo: 2024, source: "oem", referenceDocument: "Manual de manutenção Master 2023",
      oemReference: "RN-MST-23", version: 2, approvalStatus: "approved", approvedAt: "2026-08-15T12:00:00.000Z", approvedByName: "Gestor de Frota",
      isActive: true, notes: null, vehicles: 4, updatedAt: "2026-08-15T12:00:00.000Z",
      items: [
        {
          id: "it-corr", clusterId: "cl-mot", clusterName: "Motor", serviceId: "sv-corr", serviceName: "Inspeção de correia", name: "Correia dentada",
          technicalDescription: "Verificar tensão, trincas e desgaste lateral.", intervalKm: 20000, intervalDays: 365, intervalEngineHours: null,
          alertPct: 20, schedulePct: 10, tolerancePct: 10, criticality: "high", sortOrder: 10, isActive: true,
          checklist: [{ key: "tensao", description: "Tensão dentro da faixa do fabricante", required: true }, { key: "trincas", description: "Sem trincas ou desfiamento", required: true }],
          coverage: [{ serviceId: "sv-corr", serviceName: "Inspeção de correia", coverage: "full" }],
        },
      ],
      versions: [
        { version: 2, approvalStatus: "approved", reason: "Intervalo da correia reduzido para 20.000 km", createdAt: "2026-08-15T12:00:00.000Z", createdByName: "Gestor de Frota" },
        { version: 1, approvalStatus: "approved", reason: "Primeira versão", createdAt: "2026-05-02T12:00:00.000Z", createdByName: "Gestor de Frota" },
      ],
    },
  ],
};

export const IMPORT_HISTORY: MaintenanceImportHistoryRow[] = [
  {
    id: "b1", kind: "records", fileName: "base_manutencao_2026.xlsx", status: "completed", totalRows: 2429, createdRows: 2310, updatedRows: 42,
    skippedRows: 77, errorRows: 31, createdAt: "2026-09-26T13:40:00.000Z", processedAt: "2026-09-26T13:44:00.000Z", createdByName: "Gestor de Frota", summary: {},
  },
  {
    id: "b2", kind: "services", fileName: "servicos.csv", status: "completed", totalRows: 149, createdRows: 149, updatedRows: 0,
    skippedRows: 0, errorRows: 0, createdAt: "2026-09-26T13:20:00.000Z", processedAt: "2026-09-26T13:21:00.000Z", createdByName: "Gestor de Frota", summary: {},
  },
];
