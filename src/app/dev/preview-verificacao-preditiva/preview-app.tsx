"use client";

import * as React from "react";
import { PredictiveApp, type PredictiveAppLoaders } from "@/app/(app)/aplicativos/verificacao-preditiva/predictive-app";
import type {
  PredictiveAppContext,
  PredictiveAppRoadmap,
  PredictiveAppRoadmapItem,
  PredictiveAppSubmitResult,
  PredictiveAppVehicle,
  PredictiveMySubmission,
} from "@/lib/maintenance/predictive-app";
import type { PredictiveSubmissionDetail } from "@/lib/maintenance/types";

/**
 * O aplicativo inteiro com contexto fixo e carregadores injetados.
 *
 * A amostra traz um caso de cada regra que o executor precisa distinguir:
 * um roteiro com dois clusters e três itens de tipos de resposta diferentes
 * (número com critério, conformidade, sim/não, seleção, foto e texto); uma
 * frota com KM oficial recente (ABC1D23), uma com KM desatualizado (DEF4G56)
 * e uma sem leitura oficial (HIJ7K89), para a validação do KM; itens em
 * situações distintas (vencido sem referência formal, em dia monitorando, a
 * programar por histórico); e um histórico com não conformidade que abriu
 * corretiva, KM divergente justificado e um envio todo conforme.
 */
export const CONTEXT: PredictiveAppContext = {
  available: true,
  reason: null,
  today: "2026-10-14",
  app: { id: "app-preditiva", name: "Verificação Preditiva de Frota", slug: "verificacao-preditiva" },
  actor: { userId: "user-preview", employeeId: "emp-456", name: "Técnico de Teste", employeeCode: "000456" },
  rules: { maxDaysBack: 60, kmMaxAgeDays: 30, kmToleranceMin: 500, kmTolerancePct: 5, notesMinLength: 5, justificationMinLength: 5 },
  results: [
    { code: "conforming", label: "Conforme", decision: "Reinicia o ciclo a partir desta verificação" },
    { code: "monitor", label: "Monitoramento", decision: "Mantém a referência e reduz o alvo (KM e/ou dias)" },
    { code: "non_conforming", label: "Não conforme", decision: "Abre manutenção corretiva; o ciclo só reinicia na conclusão" },
    { code: "not_performed", label: "Não realizada", decision: "Registra o motivo e não altera o ciclo" },
  ],
};

const VEHICLE_BASE: Omit<PredictiveAppVehicle, "id" | "licensePlate" | "fleetCode"> = {
  vehicleTypeId: "t-van",
  vehicleTypeName: "Van",
  modelName: "Sprinter 415",
  makeName: "Mercedes-Benz",
  operationId: "op-lmmg",
  operationName: "Last Mille MG",
  cityName: "Belo Horizonte",
  stateUf: "MG",
  brCode: "BR-017",
  leaderName: "Carlos Lima",
  planName: "Plano Van Master",
  items: 3,
  worstStatus: "ok",
  critical: 0,
  due: 0,
  toSchedule: 0,
  upcoming: 0,
  ok: 3,
  initialInspection: 0,
  noKm: 0,
  awaitingCorrective: 0,
  monitoring: 0,
  kmStale: false,
  currentKm: null,
  currentKmDate: null,
  lastVerificationOn: null,
  lastSubmissionOn: null,
};

const VEHICLES: PredictiveAppVehicle[] = [
  {
    ...VEHICLE_BASE,
    id: "v-1",
    licensePlate: "ABC1D23",
    fleetCode: "FR-0142",
    worstStatus: "due",
    due: 1,
    toSchedule: 1,
    ok: 1,
    monitoring: 1,
    currentKm: 105000,
    currentKmDate: "2026-10-13",
    lastVerificationOn: "2026-10-12",
    lastSubmissionOn: "2026-10-12",
  },
  {
    ...VEHICLE_BASE,
    id: "v-2",
    licensePlate: "DEF4G56",
    fleetCode: "FR-0150",
    cityName: "Contagem",
    brCode: "BR-022",
    worstStatus: "critical",
    critical: 1,
    upcoming: 1,
    ok: 1,
    awaitingCorrective: 1,
    kmStale: true,
    currentKm: 142300,
    currentKmDate: "2026-08-30",
    lastVerificationOn: "2026-10-05",
    lastSubmissionOn: "2026-10-05",
  },
  {
    ...VEHICLE_BASE,
    id: "v-3",
    licensePlate: "HIJ7K89",
    fleetCode: "FR-0201",
    vehicleTypeId: "t-ope",
    vehicleTypeName: "Frota Leve OPE",
    modelName: "Strada",
    makeName: "Fiat",
    operationId: "op-merch",
    operationName: "Merchandising",
    cityName: "São Paulo",
    stateUf: "SP",
    brCode: null,
    leaderName: null,
    planName: "Plano Leve OPE",
    worstStatus: "no_km",
    ok: 0,
    noKm: 3,
    lastVerificationOn: "2026-09-28",
    lastSubmissionOn: "2026-09-28",
  },
];

type ItemSeed = Pick<PredictiveAppRoadmapItem, "cycleId" | "itemId" | "itemName" | "clusterId" | "clusterName" | "criticality" | "checklist"> & Partial<PredictiveAppRoadmapItem>;

function item(seed: ItemSeed): PredictiveAppRoadmapItem {
  return {
    intervalKm: null,
    intervalDays: null,
    technicalStatus: "ok",
    executionStatus: "not_programmed",
    conformity: "no_verification",
    referenceType: "maintenance",
    referenceDate: null,
    referenceKm: null,
    monitoringActive: false,
    monitoringKm: null,
    monitoringDays: null,
    nextKm: null,
    nextDate: null,
    kmRemaining: null,
    daysRemaining: null,
    pctConsumed: null,
    severity: 1,
    openMaintenanceId: null,
    openMaintenanceCode: null,
    openMaintenanceStatus: null,
    lastVerificationOn: null,
    lastResult: null,
    services: [],
    ...seed,
  };
}

/** Dois clusters, três itens, seis tipos de resposta. */
const ITEMS: PredictiveAppRoadmapItem[] = [
  item({
    cycleId: "c-1",
    itemId: "it-past",
    itemName: "Pastilhas e discos de freio",
    clusterId: "cl-fre",
    clusterName: "Freios",
    criticality: "high",
    intervalKm: 12000,
    intervalDays: 180,
    technicalStatus: "due",
    referenceType: "maintenance",
    referenceDate: "2026-03-20",
    referenceKm: 92000,
    nextKm: 104000,
    nextDate: "2026-09-16",
    kmRemaining: -1000,
    daysRemaining: -28,
    pctConsumed: 1.083,
    severity: 4,
    checklist: [
      { key: "espessura", description: "Espessura das pastilhas (mm)", required: true, responseType: "number", approvalCriteria: "≥ 3 mm", sequence: 1, active: true },
      { key: "discos", description: "Estado dos discos", required: false, responseType: "conformity", sequence: 2, active: true },
    ],
    services: [
      { id: "s-past", name: "Troca de pastilhas", coverage: "full" },
      { id: "s-disc", name: "Troca de discos", coverage: "partial" },
    ],
  }),
  item({
    cycleId: "c-2",
    itemId: "it-flu",
    itemName: "Fluido de freio",
    clusterId: "cl-fre",
    clusterName: "Freios",
    criticality: "medium",
    intervalDays: 365,
    technicalStatus: "ok",
    conformity: "monitor",
    referenceType: "verification",
    referenceDate: "2026-10-12",
    referenceKm: 104800,
    monitoringActive: true,
    monitoringKm: 2000,
    nextKm: 106800,
    nextDate: "2027-10-12",
    kmRemaining: 1800,
    daysRemaining: 363,
    pctConsumed: 0.1,
    severity: 1,
    lastVerificationOn: "2026-10-12",
    lastResult: "monitor",
    checklist: [
      { key: "nivel", description: "Nível do fluido entre MIN e MAX", required: true, responseType: "yes_no", sequence: 1, active: true },
      { key: "cor", description: "Cor do fluido", required: true, responseType: "choice", options: ["Clara", "Âmbar", "Escura"], approvalCriteria: "Clara ou âmbar", sequence: 2, active: true },
    ],
    services: [{ id: "s-flu", name: "Troca do fluido de freio", coverage: "full" }],
  }),
  item({
    cycleId: "c-3",
    itemId: "it-corr",
    itemName: "Correia dentada",
    clusterId: "cl-mot",
    clusterName: "Motor",
    criticality: "critical",
    intervalKm: 60000,
    intervalDays: 730,
    technicalStatus: "to_schedule",
    referenceType: "history",
    referenceDate: "2025-01-15",
    referenceKm: 52000,
    nextKm: 112000,
    nextDate: "2027-01-15",
    kmRemaining: 7000,
    daysRemaining: 458,
    pctConsumed: 0.883,
    severity: 3,
    checklist: [
      { key: "ruido", description: "Ruído ou vibração anormal", required: true, responseType: "conformity", sequence: 1, active: true },
      { key: "foto", description: "Foto da correia e do tensor", required: false, responseType: "photo", sequence: 2, active: true },
      { key: "obs", description: "Observações técnicas", required: false, responseType: "text", sequence: 3, active: true },
      { key: "antigo", description: "Passo desativado (não aparece)", required: true, responseType: "text", sequence: 4, active: false },
    ],
    services: [{ id: "s-corr", name: "Troca da correia dentada", coverage: "full" }],
  }),
];

const ROADMAP_BASE: Omit<PredictiveAppRoadmap, "vehicle" | "km"> = {
  today: "2026-10-14",
  date: "2026-10-14",
  context: { operationId: "op-lmmg", operationName: "Last Mille MG", cityName: "Belo Horizonte", stateUf: "MG", brCode: "BR-017", leaderName: "Carlos Lima", unitName: "Filial BH" },
  eligible: true,
  plan: { id: "pl-van", code: "PPT-0001", name: "Plano Van Master", version: 3, approvalStatus: "approved" },
  planAmbiguous: false,
  items: ITEMS,
  recentSubmissions: [{ id: "s-3", protocol: "VPF-2026-000123", verifiedOn: "2026-10-12", inspector: "Técnico de Teste", totalItems: 3, totalNonConforming: 1 }],
};

function roadmapFor(vehicle: PredictiveAppVehicle): PredictiveAppRoadmap {
  const official = vehicle.currentKm;
  const tolerance = official == null ? 500 : Math.max(500, Math.ceil(official * 0.05));
  const ageDays = vehicle.currentKmDate ? Math.round((Date.parse("2026-10-14") - Date.parse(vehicle.currentKmDate)) / 86_400_000) : null;
  return {
    ...ROADMAP_BASE,
    context: { ...ROADMAP_BASE.context, operationId: vehicle.operationId, operationName: vehicle.operationName, cityName: vehicle.cityName, stateUf: vehicle.stateUf, brCode: vehicle.brCode, leaderName: vehicle.leaderName },
    plan: vehicle.id === "v-3" ? { ...ROADMAP_BASE.plan!, id: "pl-ope", code: "PPT-0002", name: "Plano Leve OPE", version: 1 } : ROADMAP_BASE.plan,
    vehicle: {
      id: vehicle.id,
      licensePlate: vehicle.licensePlate,
      fleetCode: vehicle.fleetCode,
      vehicleTypeId: vehicle.vehicleTypeId,
      vehicleTypeName: vehicle.vehicleTypeName,
      modelName: vehicle.modelName,
      makeName: vehicle.makeName,
      modelYear: 2022,
      active: true,
    },
    km: {
      official,
      status: official == null ? null : "validated",
      source: official == null ? null : "official_reading",
      readingDate: vehicle.currentKmDate,
      ageDays,
      stale: vehicle.kmStale,
      tolerance,
      maxAgeDays: 30,
    },
    // Sem KM oficial a situação de cada item não se calcula pelo KM: o roteiro mostra "Sem KM".
    items: official == null ? ITEMS.map((i) => ({ ...i, technicalStatus: "no_km" as const, kmRemaining: null, pctConsumed: null, severity: 0 })) : ITEMS,
  };
}

const HISTORY: PredictiveMySubmission[] = [
  {
    id: "s-3",
    protocol: "VPF-2026-000123",
    vehicleId: "v-1",
    licensePlate: "ABC1D23",
    fleetCode: "FR-0142",
    verifiedOn: "2026-10-12",
    createdAt: "2026-10-12T14:20:00Z",
    operationName: "Last Mille MG",
    cityName: "Belo Horizonte",
    totalItems: 3,
    totalConforming: 1,
    totalMonitoring: 1,
    totalNonConforming: 1,
    totalNotPerformed: 0,
    maintenancesOpened: 1,
    kmDivergent: false,
  },
  {
    id: "s-2",
    protocol: "VPF-2026-000119",
    vehicleId: "v-2",
    licensePlate: "DEF4G56",
    fleetCode: "FR-0150",
    verifiedOn: "2026-10-05",
    createdAt: "2026-10-05T11:05:00Z",
    operationName: "Last Mille MG",
    cityName: "Contagem",
    totalItems: 2,
    totalConforming: 1,
    totalMonitoring: 1,
    totalNonConforming: 0,
    totalNotPerformed: 0,
    maintenancesOpened: 0,
    kmDivergent: true,
  },
  {
    id: "s-1",
    protocol: "VPF-2026-000111",
    vehicleId: "v-3",
    licensePlate: "HIJ7K89",
    fleetCode: "FR-0201",
    verifiedOn: "2026-09-28",
    createdAt: "2026-09-28T09:12:00Z",
    operationName: "Merchandising",
    cityName: "São Paulo",
    totalItems: 3,
    totalConforming: 3,
    totalMonitoring: 0,
    totalNonConforming: 0,
    totalNotPerformed: 0,
    maintenancesOpened: 0,
    kmDivergent: false,
  },
];

type DetailItem = PredictiveSubmissionDetail["items"][number];

function detailItem(seed: Pick<DetailItem, "verificationId" | "cycleId" | "result" | "decision"> & Partial<DetailItem>): DetailItem {
  const base = ITEMS.find((i) => i.cycleId === seed.cycleId) ?? ITEMS[0];
  return {
    itemId: base.itemId,
    itemName: base.itemName,
    clusterId: base.clusterId,
    clusterName: base.clusterName,
    criticality: base.criticality,
    km: null,
    kmSource: null,
    notes: null,
    monitorKm: null,
    monitorDays: null,
    checklist: [],
    maintenance: null,
    ...seed,
  };
}

const DETAILS: Record<string, PredictiveSubmissionDetail> = {
  "s-3": {
    id: "s-3",
    protocol: "VPF-2026-000123",
    vehicleId: "v-1",
    licensePlate: "ABC1D23",
    fleetCode: "FR-0142",
    vehicleTypeName: "Van",
    verifiedOn: "2026-10-12",
    verifiedAt: "2026-10-12T14:20:00Z",
    createdAt: "2026-10-12T14:20:00Z",
    operationName: "Last Mille MG",
    cityName: "Belo Horizonte",
    stateUf: "MG",
    brCode: "BR-017",
    leaderName: "Carlos Lima",
    inspector: { userId: "user-preview", employeeId: "emp-456", name: "Técnico de Teste", employeeCode: "000456" },
    km: { official: 104800, officialDate: "2026-10-12", informed: 104950, justification: null, divergent: false },
    generalObservation: "Verificação de rotina no pátio.",
    totals: { items: 3, conforming: 1, monitoring: 1, nonConforming: 1, notPerformed: 0, maintenancesOpened: 1 },
    items: [
      detailItem({
        verificationId: "ver-31",
        cycleId: "c-1",
        result: "non_conforming",
        decision: "open_maintenance",
        km: 104950,
        kmSource: "informed",
        notes: "Pastilhas com 2 mm e ruído metálico na frenagem.",
        checklist: [{ key: "espessura", answer: "2" }, { key: "discos", answer: "out" }],
        maintenance: { id: "m-738", code: "MAN-2026-000738", status: "scheduled", label: "Agendada" },
      }),
      detailItem({
        verificationId: "ver-32",
        cycleId: "c-2",
        result: "monitor",
        decision: "reduce_interval",
        km: 104950,
        kmSource: "informed",
        monitorKm: 2000,
        checklist: [{ key: "nivel", answer: "yes" }, { key: "cor", answer: "Âmbar" }],
      }),
      detailItem({
        verificationId: "ver-33",
        cycleId: "c-3",
        result: "conforming",
        decision: "restart_cycle",
        km: 104950,
        kmSource: "informed",
        checklist: [{ key: "ruido", answer: "ok" }],
      }),
    ],
  },
  "s-2": {
    id: "s-2",
    protocol: "VPF-2026-000119",
    vehicleId: "v-2",
    licensePlate: "DEF4G56",
    fleetCode: "FR-0150",
    vehicleTypeName: "Van",
    verifiedOn: "2026-10-05",
    verifiedAt: "2026-10-05T11:05:00Z",
    createdAt: "2026-10-05T11:05:00Z",
    operationName: "Last Mille MG",
    cityName: "Contagem",
    stateUf: "MG",
    brCode: "BR-022",
    leaderName: "Carlos Lima",
    inspector: { userId: "user-preview", employeeId: "emp-456", name: "Técnico de Teste", employeeCode: "000456" },
    km: { official: 142300, officialDate: "2026-08-30", informed: 151200, justification: "Hodômetro substituído em 01/10; leitura oficial atrasada.", divergent: true },
    generalObservation: null,
    totals: { items: 2, conforming: 1, monitoring: 1, nonConforming: 0, notPerformed: 0, maintenancesOpened: 0 },
    items: [
      detailItem({ verificationId: "ver-21", cycleId: "c-2", result: "monitor", decision: "reduce_interval", km: 151200, kmSource: "informed", monitorDays: 30, checklist: [{ key: "nivel", answer: "yes" }, { key: "cor", answer: "Escura" }] }),
      detailItem({ verificationId: "ver-22", cycleId: "c-3", result: "conforming", decision: "restart_cycle", km: 151200, kmSource: "informed", checklist: [{ key: "ruido", answer: "ok" }] }),
    ],
  },
  "s-1": {
    id: "s-1",
    protocol: "VPF-2026-000111",
    vehicleId: "v-3",
    licensePlate: "HIJ7K89",
    fleetCode: "FR-0201",
    vehicleTypeName: "Frota Leve OPE",
    verifiedOn: "2026-09-28",
    verifiedAt: "2026-09-28T09:12:00Z",
    createdAt: "2026-09-28T09:12:00Z",
    operationName: "Merchandising",
    cityName: "São Paulo",
    stateUf: "SP",
    brCode: null,
    leaderName: null,
    inspector: { userId: "user-preview", employeeId: "emp-456", name: "Técnico de Teste", employeeCode: "000456" },
    km: { official: null, officialDate: null, informed: 48200, justification: null, divergent: false },
    generalObservation: null,
    totals: { items: 3, conforming: 3, monitoring: 0, nonConforming: 0, notPerformed: 0, maintenancesOpened: 0 },
    items: ITEMS.map((i, index) =>
      detailItem({ verificationId: `ver-1${index}`, cycleId: i.cycleId, result: "conforming", decision: "restart_cycle", km: 48200, kmSource: "informed", checklist: [] }),
    ),
  },
};

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const normalize = (value: string) => value.toUpperCase().replace(/[^A-Z0-9]/g, "");

/** Os carregadores devolvem o que o servidor devolveria, sem sessão nem banco. */
export const LOADERS: PredictiveAppLoaders = {
  loadVehicles: async (search) => {
    await wait(80);
    const q = normalize(search ?? "");
    return { ok: true, data: q ? VEHICLES.filter((v) => normalize(v.licensePlate ?? "").includes(q) || normalize(v.fleetCode ?? "").includes(q)) : VEHICLES };
  },
  loadRoadmap: async (vehicleId) => {
    await wait(100);
    const vehicle = VEHICLES.find((v) => v.id === vehicleId);
    return vehicle ? { ok: true, data: roadmapFor(vehicle) } : { ok: false, error: "Veículo não encontrado na prévia." };
  },
  submit: async (input) => {
    await wait(150);
    const vehicle = VEHICLES.find((v) => v.id === input.vehicleId);
    const official = vehicle?.currentKm ?? null;
    const informed = input.kmInformed ?? null;
    const tolerance = official == null ? 500 : Math.max(500, Math.ceil(official * 0.05));
    const count = (result: string) => input.items.filter((i) => i.result === result).length;
    const opens = input.items.filter((i) => i.result === "non_conforming" && i.openMaintenance !== false);
    const data: PredictiveAppSubmitResult = {
      id: "sub-preview",
      protocol: "VPF-2026-000124",
      submittedAt: new Date().toISOString(),
      totalItems: input.items.length,
      totalConforming: count("conforming"),
      totalMonitoring: count("monitor"),
      totalNonConforming: count("non_conforming"),
      totalNotPerformed: count("not_performed"),
      maintenancesOpened: opens.length,
      maintenances: opens.map((_, index) => ({ id: `m-new-${index}`, code: `MAN-2026-00074${index}`, status: "to_schedule", created: true })),
      items: input.items.map((i, index) => ({
        cycleId: i.cycleId,
        verificationId: `ver-new-${index}`,
        result: i.result,
        decision: i.result === "conforming" ? "restart_cycle" : i.result === "monitor" ? "reduce_interval" : i.result === "non_conforming" ? (i.openMaintenance === false ? "await_corrective" : "open_maintenance") : "none",
      })),
      km: { used: informed ?? official, official, informed, divergent: informed != null && official != null && Math.abs(informed - official) > tolerance },
      duplicate: false,
    };
    return { ok: true, data };
  },
  loadOwnSubmission: async (id) => {
    await wait(60);
    const found = DETAILS[id];
    return found ? { ok: true, data: found } : { ok: false, error: "Envio não encontrado na prévia." };
  },
};

export function PreviewPredictiveApp({ canExecute = true }: { canExecute?: boolean }) {
  return <PredictiveApp context={canExecute ? CONTEXT : null} history={canExecute ? HISTORY : []} canExecute={canExecute} loaders={LOADERS} />;
}
