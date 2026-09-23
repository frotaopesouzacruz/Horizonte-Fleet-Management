import type {
  AdherenceInsights, AdherenceMonthly, AdherenceOptions, AdherenceSummary, HeatmapDay, ImportHistoryRow, JourneyRow, MatrixPage, MatrixRow, RequestsPage, ReturnTracking,
} from "@/lib/adherence/queries";

/**
 * Dados fixos para a prévia (mesmo portão do design system).
 *
 * Moldado como a base real, de propósito: setembro/2026, hoje dia 22, uma
 * frota pequena que passa por todos os estados que a tela precisa distinguir
 * — feito, não fez (vencido e provisório), retorno pendente, planejado,
 * expurgo aprovado, justificativa pendente e "sem dados". Os totais seguem o
 * exemplo da §68: 8 feitos em 9 obrigações devidas = 88,89%.
 */
export const TODAY = "2026-09-22";
export const COMPETENCE = { year: 2026, month: 9 };

const VEHICLES = [
  { vehicleId: "v1", fleetCode: "VA116", licensePlate: "SNT8E16", operationName: "Last Mille MG", cityName: "Divinópolis", stateUf: "MG", brCode: "BR0024107", leaderName: "Walace Rocha De Souza", vehicleTypeName: "Van" },
  { vehicleId: "v2", fleetCode: "VA131", licensePlate: "SNT8G21", operationName: "Last Mille MG", cityName: "Contagem", stateUf: "MG", brCode: "BR0024901", leaderName: "Walace Rocha De Souza", vehicleTypeName: "Van" },
  { vehicleId: "v3", fleetCode: "VA151", licensePlate: "SNT1A63", operationName: "Last Mille MG", cityName: "Mariana", stateUf: "MG", brCode: "BR0024706", leaderName: "Walace Rocha De Souza", vehicleTypeName: "Van" },
  { vehicleId: "v4", fleetCode: "VA163", licensePlate: "SNT1A73", operationName: "Redespacho - Belém/Pa", cityName: "Belém", stateUf: "PA", brCode: "Redespacho Belem/Pa_1", leaderName: "Leandro Carvalho Silva", vehicleTypeName: "Van" },
  { vehicleId: "v5", fleetCode: "FL145", licensePlate: "UHJ4I15", operationName: "Merchandising", cityName: "Uberlândia", stateUf: "MG", brCode: "BR0241754", leaderName: "Flaviano Lucio Dos Santos", vehicleTypeName: "Frota Leve OPE" },
  { vehicleId: "v6", fleetCode: "VA170", licensePlate: "SNT8J46", operationName: "Redespacho - Belém/Pa", cityName: "Belém", stateUf: "PA", brCode: "Redespacho Belem/Pa_2", leaderName: "Leandro Carvalho Silva", vehicleTypeName: "Van" },
];

function cell(id: string, status: string, extra: Partial<MatrixRow["days"][string]> = {}) {
  const done = status === "FEZ_CHECKLIST";
  const excluded = ["SEM_ROTA", "MANUTENCAO", "FROTA_RESERVA", "EM_VIAGEM", "FROTA_NAO_ATIVA"].includes(status);
  return { id, status, done, excluded, due: done || status === "NAO_FEZ_CHECKLIST", provisional: false, pendingRequest: false, condition: null, ...extra };
}

function buildRows(): MatrixRow[] {
  return VEHICLES.map((v, vi) => {
    const days: MatrixRow["days"] = {};
    for (let d = 1; d <= 30; d++) {
      const id = `${v.vehicleId}-${d}`;
      if (d > 22) { days[String(d)] = cell(id, "PLANEJADO"); continue; }
      if (d === 22) {
        days[String(d)] = vi < 2 ? cell(id, "NAO_FEZ_CHECKLIST", { provisional: true }) : cell(id, "FEZ_CHECKLIST");
        continue;
      }
      if (vi === 3 && d === 20) { days[String(d)] = cell(id, "SEM_ROTA"); continue; }
      if (vi === 4 && d === 21) { days[String(d)] = cell(id, "NAO_FEZ_CHECKLIST", { pendingRequest: true, condition: "MANUTENCAO" }); continue; }
      if (vi === 5 && d < 15) { continue; } // sem dados: veículo entrou na fidelização no dia 15
      if ((d + vi) % 9 === 0) { days[String(d)] = cell(id, "NAO_FEZ_CHECKLIST"); continue; }
      days[String(d)] = cell(id, "FEZ_CHECKLIST");
    }
    return { ...v, days };
  });
}

export const MATRIX: MatrixPage = { total: VEHICLES.length, page: 1, pageSize: 50, rows: buildRows() };

export const SUMMARY: AdherenceSummary = {
  obligations: 156, done: 8, notDone: 1, pendingReturn: 0, planned: 48, excluded: 1, pendingRequests: 1, provisional: 2,
  numerator: 8, denominator: 9, adherencePct: 88.89, targetPct: 90, gapPct: -1.11, groupBy: "operation",
  groups: [
    { key: "op1", label: "Last Mille MG", obligations: 90, done: 5, notDone: 1, excluded: 0, pendingRequests: 0, numerator: 5, denominator: 6, adherencePct: 83.33 },
    { key: "op2", label: "Merchandising", obligations: 16, done: 1, notDone: 0, excluded: 0, pendingRequests: 1, numerator: 1, denominator: 1, adherencePct: 100 },
    { key: "op3", label: "Redespacho - Belém/Pa", obligations: 50, done: 2, notDone: 0, excluded: 1, pendingRequests: 0, numerator: 2, denominator: 2, adherencePct: 100 },
  ],
};

export const HEATMAP: HeatmapDay[] = Array.from({ length: 30 }, (_, i) => {
  const day = i + 1;
  const date = `2026-09-${String(day).padStart(2, "0")}`;
  const isFuture = day > 22;
  const isToday = day === 22;
  const denominator = isFuture ? 0 : day === 22 ? 6 : 5 + (day % 2);
  const numerator = isFuture ? 0 : day === 22 ? 4 : Math.max(0, denominator - (day % 4 === 0 ? 2 : day % 3 === 0 ? 1 : 0));
  return {
    date, day, isToday, isFuture, obligations: isFuture ? 6 : denominator, done: numerator,
    notDone: denominator - numerator, pendingReturn: 0, excluded: day === 20 ? 1 : 0,
    pendingRequests: day === 21 ? 1 : 0, numerator, denominator,
    adherencePct: denominator > 0 ? Math.round((numerator / denominator) * 10000) / 100 : null,
    targetPct: 90,
  };
});

export const JOURNEY: JourneyRow[] = VEHICLES.map((v, i) => ({
  vehicleId: v.vehicleId, fleetCode: v.fleetCode, licensePlate: v.licensePlate, operationName: v.operationName,
  cityName: v.cityName, brCode: v.brCode, leaderName: v.leaderName,
  departureStatus: i < 2 ? "NAO_FEZ_CHECKLIST" : "FEZ_CHECKLIST", departureId: `${v.vehicleId}-22`,
  returnStatus: i < 2 ? "RETORNO_PENDENTE" : i === 2 ? "FEZ_CHECKLIST" : "RETORNO_PENDENTE", returnId: `${v.vehicleId}-22r`,
  journey: i < 2 ? "nao_realizada" : i === 2 ? "completa" : "em_rota",
}));

export const REQUESTS: RequestsPage = {
  stats: {
    total: 4, pending: 2, approved: 1, rejected: 1, avgWaitHours: 14.5,
    byOperation: [
      { key: "op1", label: "Last Mille MG", total: 2, pending: 1 },
      { key: "op2", label: "Merchandising", total: 1, pending: 1 },
      { key: "op3", label: "Redespacho - Belém/Pa", total: 1, pending: 0 },
    ],
    byLeader: [
      { key: "l1", label: "Flaviano Lucio Dos Santos", total: 1, pending: 1 },
      { key: "l2", label: "Leandro Carvalho Silva", total: 1, pending: 0 },
      { key: "l3", label: "Walace Rocha De Souza", total: 2, pending: 1 },
    ],
  },
  total: 4, page: 1, pageSize: 100,
  rows: [
    { id: "r1", obligationId: "v5-21", status: "pending", source: "leadership", isOverride: false, context: "saida", operationalDate: "2026-09-21", vehicleId: "v5", fleetCode: "FL145", licensePlate: "UHJ4I15", operationName: "Merchandising", cityName: "Uberlândia", brCode: "BR0241754", leaderName: "Flaviano Lucio Dos Santos", reasonCode: "MANUTENCAO", reasonName: "Manutenção", reasonEffect: "exclude", justification: "Veículo na oficina para troca de embreagem, OS 4471.", evidenceReference: "OS 4471", requestedAt: "2026-09-21T11:20:00Z", requestedByName: "Flaviano Lucio Dos Santos", decidedAt: null, decisionNote: null, decidedByName: null, obligationStatus: "NAO_FEZ_CHECKLIST", waitHours: 22.4 },
    { id: "r2", obligationId: "v4-20", status: "approved", source: "leadership", isOverride: false, context: "saida", operationalDate: "2026-09-20", vehicleId: "v4", fleetCode: "VA163", licensePlate: "SNT1A73", operationName: "Redespacho - Belém/Pa", cityName: "Belém", brCode: "Redespacho Belem/Pa_1", leaderName: "Leandro Carvalho Silva", reasonCode: "SEM_ROTA", reasonName: "Sem rota", reasonEffect: "exclude", justification: "Sem rota programada no sábado.", evidenceReference: null, requestedAt: "2026-09-20T13:00:00Z", requestedByName: "Leandro Carvalho Silva", decidedAt: "2026-09-21T09:10:00Z", decisionNote: "Confirmado com a programação.", decidedByName: "Gabriel Albino", obligationStatus: "SEM_ROTA", waitHours: 20.2 },
    { id: "r3", obligationId: "v1-18", status: "rejected", source: "leadership", isOverride: false, context: "saida", operationalDate: "2026-09-18", vehicleId: "v1", fleetCode: "VA116", licensePlate: "SNT8E16", operationName: "Last Mille MG", cityName: "Divinópolis", brCode: "BR0024107", leaderName: "Walace Rocha De Souza", reasonCode: "RESERVA", reasonName: "Frota reserva", reasonEffect: "exclude", justification: "Ficou de reserva.", evidenceReference: null, requestedAt: "2026-09-18T15:00:00Z", requestedByName: "Walace Rocha De Souza", decidedAt: "2026-09-19T08:00:00Z", decisionNote: "Havia rota programada para o veículo.", decidedByName: "Gabriel Albino", obligationStatus: "NAO_FEZ_CHECKLIST", waitHours: 17 },
    // Segunda pendente, no retorno: a decisão em lote (§57) precisa de ao menos duas linhas selecionáveis e de contextos mistos para filtrar o novo motivo.
    { id: "r4", obligationId: "v2-19", status: "pending", source: "leadership", isOverride: false, context: "retorno", operationalDate: "2026-09-19", vehicleId: "v2", fleetCode: "VA131", licensePlate: "SNT8G21", operationName: "Last Mille MG", cityName: "Contagem", brCode: "BR0024901", leaderName: "Walace Rocha De Souza", reasonCode: "EM_VIAGEM", reasonName: "Em viagem", reasonEffect: "exclude", justification: "Pernoite em Betim, retorno só no dia seguinte.", evidenceReference: null, requestedAt: "2026-09-20T07:45:00Z", requestedByName: "Walace Rocha De Souza", decidedAt: null, decisionNote: null, decidedByName: null, obligationStatus: "NAO_FEZ_CHECKLIST", waitHours: 49.8 },
  ],
};

export const OPTIONS: AdherenceOptions = {
  statuses: [
    { code: "FEZ_CHECKLIST", label: "Fez checklist", tone: "success", description: null },
    { code: "NAO_FEZ_CHECKLIST", label: "Não fez checklist", tone: "danger", description: null },
    { code: "RETORNO_PENDENTE", label: "Retorno pendente", tone: "pending", description: null },
    { code: "PLANEJADO", label: "Planejado", tone: "neutral", description: null },
    { code: "SEM_ROTA", label: "Sem rota", tone: "info", description: null },
    { code: "MANUTENCAO", label: "Manutenção", tone: "warning", description: null },
    { code: "FROTA_RESERVA", label: "Frota reserva", tone: "neutral", description: null },
    { code: "EM_VIAGEM", label: "Em viagem", tone: "info", description: null },
    { code: "FROTA_NAO_ATIVA", label: "Frota não ativa", tone: "neutral", description: null },
    { code: "SEM_DADOS", label: "Sem dados", tone: "neutral", description: null },
  ],
  reasons: [
    { id: "m1", code: "SEM_ROTA", name: "Sem rota", description: "O veículo não tinha rota programada na data.", effect: "exclude", statusCode: "SEM_ROTA", requiresEvidence: false, requiresApproval: true, appliesToDeparture: true, appliesToReturn: true, inheritsToReturn: true, isActive: true },
    { id: "m2", code: "MANUTENCAO", name: "Manutenção", description: "Informar OS ou chamado.", effect: "exclude", statusCode: "MANUTENCAO", requiresEvidence: true, requiresApproval: true, appliesToDeparture: true, appliesToReturn: true, inheritsToReturn: true, isActive: true },
    { id: "m3", code: "RESERVA", name: "Frota reserva", description: null, effect: "exclude", statusCode: "FROTA_RESERVA", requiresEvidence: false, requiresApproval: true, appliesToDeparture: true, appliesToReturn: true, inheritsToReturn: true, isActive: true },
    { id: "m4", code: "EM_VIAGEM", name: "Em viagem", description: null, effect: "exclude", statusCode: "EM_VIAGEM", requiresEvidence: false, requiresApproval: true, appliesToDeparture: true, appliesToReturn: true, inheritsToReturn: true, isActive: true },
    { id: "m5", code: "FROTA_NAO_ATIVA", name: "Frota não ativa", description: null, effect: "exclude", statusCode: "FROTA_NAO_ATIVA", requiresEvidence: false, requiresApproval: true, appliesToDeparture: true, appliesToReturn: true, inheritsToReturn: true, isActive: true },
    { id: "m6", code: "EXECUCAO_COMPROVADA", name: "Execução comprovada por outra fonte", description: "Exige evidência e aprovação.", effect: "count_done", statusCode: "FEZ_CHECKLIST", requiresEvidence: true, requiresApproval: true, appliesToDeparture: true, appliesToReturn: true, inheritsToReturn: false, isActive: true },
    { id: "m7", code: "OUTROS", name: "Outros", description: "Justificativa registrada sem expurgo.", effect: "none", statusCode: null, requiresEvidence: true, requiresApproval: true, appliesToDeparture: true, appliesToReturn: true, inheritsToReturn: false, isActive: true },
  ],
  rules: [
    { id: "g1", name: "Veículos inativos: sem obrigação de checklist", description: null, priority: 5, operationId: null, operationName: null, vehicleTypeId: null, vehicleTypeName: null, vehicleStatus: "inactive", requiresChecklist: false, appliesToDeparture: true, appliesToReturn: true, weekdays: [1, 2, 3, 4, 5, 6, 7], validFrom: "2026-01-01", validTo: null, version: 1, isActive: true },
    { id: "g2", name: "Frota Leve ADM: sem obrigação de checklist", description: null, priority: 10, operationId: null, operationName: null, vehicleTypeId: "t-car", vehicleTypeName: "Frota Leve ADM", vehicleStatus: null, requiresChecklist: false, appliesToDeparture: true, appliesToReturn: true, weekdays: [1, 2, 3, 4, 5, 6, 7], validFrom: "2026-01-01", validTo: null, version: 1, isActive: true },
    { id: "g3", name: "Frota prevista: saída e retorno diários", description: "Regra padrão.", priority: 100, operationId: null, operationName: null, vehicleTypeId: null, vehicleTypeName: null, vehicleStatus: null, requiresChecklist: true, appliesToDeparture: true, appliesToReturn: true, weekdays: [1, 2, 3, 4, 5, 6, 7], validFrom: "2026-01-01", validTo: null, version: 1, isActive: true },
  ],
  targets: [{ id: "t1", operationId: null, operationName: null, context: null, targetPct: 90, validFrom: "2026-09-01", validTo: null, notes: null }],
  settings: { timezone: "America/Sao_Paulo", departureExpectedTime: "06:00:00", returnExpectedTime: "18:00:00", returnDeadlineTime: "02:00:00", returnDeadlineNextDay: true, generationHorizonDays: 7 },
  runs: [
    { id: "run1", kind: "daily", dateFrom: "2026-09-21", dateTo: "2026-09-29", reason: null, isPreview: false, status: "completed", stats: { current: { create: 0, reactivate: 0, retire: 0, unchanged: 328 }, outbox: { processed: 3, errors: 0 } }, errorMessage: null, startedAt: "2026-09-22T11:30:00Z", finishedAt: "2026-09-22T11:30:02Z", requestedByName: null },
    { id: "run2", kind: "on_demand", dateFrom: "2026-09-01", dateTo: "2026-09-29", reason: "Materialização inicial da competência.", isPreview: false, status: "completed", stats: { create: 4756, reactivate: 0, retire: 0, unchanged: 0, outbox: { processed: 0, errors: 0 } }, errorMessage: null, startedAt: "2026-09-22T11:00:00Z", finishedAt: "2026-09-22T11:00:09Z", requestedByName: "Gabriel Albino" },
  ],
  inconsistencies: [
    { id: "i1", kind: "execution_without_obligation", vehicleId: "v9", fleetCode: "VA106", operationalDate: "2026-09-22", context: "saida", details: {}, createdAt: "2026-09-22T09:12:00Z" },
  ],
  today: TODAY,
};

export const OPERATIONS = [
  { id: "op1", name: "Last Mille MG", status: "active" },
  { id: "op2", name: "Merchandising", status: "active" },
  { id: "op3", name: "Redespacho - Belém/Pa", status: "active" },
];

export const COVERAGE = [
  { operationId: "op1", operationCityId: "op1-3122306", stateId: 31, uf: "MG", cityId: 3122306, cityName: "Divinópolis" },
  { operationId: "op1", operationCityId: "op1-3118601", stateId: 31, uf: "MG", cityId: 3118601, cityName: "Contagem" },
  { operationId: "op1", operationCityId: "op1-3140001", stateId: 31, uf: "MG", cityId: 3140001, cityName: "Mariana" },
  { operationId: "op2", operationCityId: "op2-3170206", stateId: 31, uf: "MG", cityId: 3170206, cityName: "Uberlândia" },
  { operationId: "op3", operationCityId: "op3-1501402", stateId: 15, uf: "PA", cityId: 1501402, cityName: "Belém" },
];

export const LEADERS = [
  { id: "l1", name: "Flaviano Lucio Dos Santos" },
  { id: "l2", name: "Leandro Carvalho Silva" },
  { id: "l3", name: "Walace Rocha De Souza" },
];

/**
 * Mês anterior (agosto, 31 dias, todos vencidos) e próximo (outubro, 31 dias,
 * todos futuros) para a visualização de três meses do Heatmap (§28).
 */
function heatmapMonth(year: number, month: number, length: number, kind: "past" | "future"): HeatmapDay[] {
  return Array.from({ length }, (_, i) => {
    const day = i + 1;
    const date = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    const isFuture = kind === "future";
    const denominator = isFuture ? 0 : 5 + (day % 2);
    const numerator = isFuture ? 0 : Math.max(0, denominator - (day % 5 === 0 ? 2 : day % 3 === 0 ? 1 : 0));
    return {
      date, day, isToday: false, isFuture, obligations: isFuture ? 6 : denominator, done: numerator,
      notDone: denominator - numerator, pendingReturn: 0, excluded: 0, pendingRequests: 0, numerator, denominator,
      adherencePct: denominator > 0 ? Math.round((numerator / denominator) * 10000) / 100 : null,
      targetPct: 90,
    };
  });
}

export const HEATMAP_PREV: HeatmapDay[] = heatmapMonth(2026, 8, 31, "past");
export const HEATMAP_NEXT: HeatmapDay[] = heatmapMonth(2026, 10, 31, "future");

/**
 * Dashboard mensal de 2026 (§25): setembro é o mês corrente com o exemplo da
 * §68 (8 de 9 = 88,89%); fevereiro não tem base; outubro em diante é futuro
 * e nunca mostra resultado.
 */
function monthRow(month: number, numerator: number, denominator: number, extra: Partial<AdherenceMonthly["months"][number]> = {}): AdherenceMonthly["months"][number] {
  const isFuture = month > 9;
  const pct = denominator > 0 ? Math.round((numerator / denominator) * 10000) / 100 : null;
  return {
    month, isFuture, isCurrent: month === 9,
    obligations: isFuture ? 180 : denominator + 4, done: numerator, notDone: denominator - numerator,
    excluded: isFuture ? 0 : 3, pendingRequests: 0, numerator, denominator,
    adherencePct: isFuture ? null : pct, targetPct: 90,
    gapPct: isFuture || pct == null ? null : Math.round((pct - 90) * 100) / 100,
    ...extra,
  };
}

export const MONTHLY: AdherenceMonthly = {
  year: 2026,
  context: "saida",
  months: [
    monthRow(1, 152, 170),
    monthRow(2, 0, 0, { obligations: 0, excluded: 0 }),
    monthRow(3, 160, 175),
    monthRow(4, 158, 168),
    monthRow(5, 150, 172),
    monthRow(6, 159, 170),
    monthRow(7, 163, 176),
    monthRow(8, 142, 164),
    monthRow(9, 8, 9, { obligations: 156, excluded: 1, pendingRequests: 1 }),
    monthRow(10, 0, 0),
    monthRow(11, 0, 0),
    monthRow(12, 0, 0),
  ],
  total: { numerator: 1092, denominator: 1204, excluded: 22, adherencePct: 90.7 },
};

/** Insights de setembro (§27), coerentes com SUMMARY: 88,89%, meta 90%, +2,30 pontos sobre agosto. */
export const INSIGHTS: AdherenceInsights = {
  competence: "Setembro/2026",
  context: "saida",
  today: TODAY,
  isFutureMonth: false,
  current: { adherencePct: 88.89, numerator: 8, denominator: 9, targetPct: 90, gapPct: -1.11, notDone: 1, excluded: 1, pendingRequests: 1 },
  previous: { competence: "Agosto/2026", adherencePct: 86.59, numerator: 142, denominator: 164 },
  variationPts: 2.3,
  today_: { obligations: 6, done: 3, notDone: 3, provisional: 3, pendingRequests: 0 },
  daysWithBase: 22,
  daysBelowTarget: 9,
  operationsBelowTarget: [
    { key: "op1", label: "Last Mille MG", obligations: 90, done: 5, notDone: 1, excluded: 0, pendingRequests: 0, numerator: 5, denominator: 6, adherencePct: 83.33 },
    { key: "op2", label: "Merchandising", obligations: 16, done: 6, notDone: 1, excluded: 0, pendingRequests: 1, numerator: 6, denominator: 7, adherencePct: 85.71 },
  ],
  citiesBelowTarget: [
    { key: "3122306", label: "Divinópolis", obligations: 30, done: 4, notDone: 1, excluded: 0, pendingRequests: 0, numerator: 4, denominator: 5, adherencePct: 80 },
  ],
  operationsWithPending: [
    { key: "op2", label: "Merchandising", obligations: 16, done: 1, notDone: 0, excluded: 0, pendingRequests: 1, numerator: 1, denominator: 1, adherencePct: 100 },
  ],
  bestOperation: { key: "op3", label: "Redespacho - Belém/Pa", obligations: 50, done: 2, notDone: 0, excluded: 1, pendingRequests: 0, numerator: 2, denominator: 2, adherencePct: 100 },
  worstOperation: { key: "op1", label: "Last Mille MG", obligations: 90, done: 5, notDone: 1, excluded: 0, pendingRequests: 0, numerator: 5, denominator: 6, adherencePct: 83.33 },
};

/**
 * Acompanhamento do Retorno (§46–§51): 10 previstos, 6 realizados, 2 aguardando
 * retorno (saída feita, no prazo), 2 vencidos. A fila traz as quatro situações
 * que a tela distingue — aguardando, sem saída, vencido após sair, vencido.
 * Aderência = 6 / (10 − 0 expurgados − 2 no prazo) = 75%.
 */
export const RETURN_TRACKING: ReturnTracking = {
  dateFrom: "2026-09-01", dateTo: "2026-09-30", today: TODAY,
  stats: {
    expected: 10, done: 6, pendingInDeadline: 2, awaitingReturn: 2, overdue: 2, excluded: 0, planned: 48,
    pendingRequests: 1, departureDoneReturnMissing: 3, numerator: 6, denominator: 8, adherencePct: 75, targetPct: 90,
  },
  byLeader: [
    { key: "l3", label: "Walace Rocha De Souza", expected: 6, done: 4, pending: 1, overdue: 1, excluded: 0, adherencePct: 80 },
    { key: "l2", label: "Leandro Carvalho Silva", expected: 4, done: 2, pending: 1, overdue: 1, excluded: 0, adherencePct: 66.67 },
  ],
  rows: [
    { id: "v1-22r", vehicleId: "v1", fleetCode: "VA116", licensePlate: "SNT8E16", operationalDate: "2026-09-22", operationName: "Last Mille MG", cityName: "Divinópolis", brCode: "BR0024107", leaderName: "Walace Rocha De Souza", expectedAt: "2026-09-22T21:00:00Z", deadlineAt: "2026-09-23T05:00:00Z", status: "RETORNO_PENDENTE", departureStatus: "FEZ_CHECKLIST", departureDone: true, pendingRequest: false, provisional: true, situation: "awaiting_return" },
    { id: "v4-22r", vehicleId: "v4", fleetCode: "VA163", licensePlate: "SNT1A73", operationalDate: "2026-09-22", operationName: "Redespacho - Belém/Pa", cityName: "Belém", brCode: "Redespacho Belem/Pa_1", leaderName: "Leandro Carvalho Silva", expectedAt: "2026-09-22T21:00:00Z", deadlineAt: "2026-09-23T05:00:00Z", status: "RETORNO_PENDENTE", departureStatus: "NAO_FEZ_CHECKLIST", departureDone: false, pendingRequest: false, provisional: true, situation: "not_departed" },
    { id: "v2-19r", vehicleId: "v2", fleetCode: "VA131", licensePlate: "SNT8G21", operationalDate: "2026-09-19", operationName: "Last Mille MG", cityName: "Contagem", brCode: "BR0024901", leaderName: "Walace Rocha De Souza", expectedAt: "2026-09-19T21:00:00Z", deadlineAt: "2026-09-20T05:00:00Z", status: "NAO_FEZ_CHECKLIST", departureStatus: "FEZ_CHECKLIST", departureDone: true, pendingRequest: true, provisional: false, situation: "overdue_after_departure" },
    { id: "v6-18r", vehicleId: "v6", fleetCode: "VA170", licensePlate: "SNT8J46", operationalDate: "2026-09-18", operationName: "Redespacho - Belém/Pa", cityName: "Belém", brCode: "Redespacho Belem/Pa_2", leaderName: "Leandro Carvalho Silva", expectedAt: "2026-09-18T21:00:00Z", deadlineAt: "2026-09-19T05:00:00Z", status: "NAO_FEZ_CHECKLIST", departureStatus: "NAO_FEZ_CHECKLIST", departureDone: false, pendingRequest: false, provisional: false, situation: "overdue" },
  ],
  rowsTotal: 4,
};

/** Histórico de importações (§67): um lote limpo e um com duas linhas rejeitadas. */
export const IMPORT_HISTORY: ImportHistoryRow[] = [
  {
    id: "imp2", fileName: "aderencia_setembro_v2.xlsx", status: "completed", totalRows: 120, validRows: 116, warningRows: 2, errorRows: 2,
    createdRows: 110, skippedRows: 6, summary: { dateFrom: "2026-09-01", dateTo: "2026-09-21" }, errorMessage: null,
    createdAt: "2026-09-22T12:40:00Z", processedAt: "2026-09-22T12:40:04Z", createdByName: "Gabriel Albino",
    errors: [
      { row: 37, message: "Veículo VA999 não encontrado na frota." },
      { row: 88, message: "Status \"FEZ\" desconhecido; use o código do catálogo." },
    ],
  },
  {
    id: "imp1", fileName: "aderencia_setembro_v1.xlsx", status: "completed", totalRows: 96, validRows: 96, warningRows: 0, errorRows: 0,
    createdRows: 96, skippedRows: 0, summary: { dateFrom: "2026-09-01", dateTo: "2026-09-15" }, errorMessage: null,
    createdAt: "2026-09-16T09:05:00Z", processedAt: "2026-09-16T09:05:03Z", createdByName: "Gabriel Albino", errors: [],
  },
];
