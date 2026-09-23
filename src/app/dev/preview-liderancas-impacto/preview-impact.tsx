"use client";

import { LeadershipView, type LeadershipViewProps } from "@/app/(app)/governanca/liderancas/leadership-view";
import type { LeaderScopeLoader } from "@/app/(app)/governanca/liderancas/leader-scope-drawer";
import type {
  LeadershipImpactLoader,
  LeadershipSaver,
} from "@/app/(app)/governanca/liderancas/leadership-form-drawer";
import type { BrEntry, CoverageEntry } from "@/components/governance/scope-picker";
import type { LeadershipIndicators, LeadershipRow } from "@/lib/governance/queries";
import type { LeadershipImpact } from "@/lib/governance/leadership-impact-types";
import type { SaveLeadershipInput } from "@/lib/governance/actions";

/**
 * Dados fixos da prévia "Lideranças · impacto". Os números da prévia de
 * impacto têm a forma dos reais (suíte 16b, I1): uma cidade de Contagem cujo
 * início recua para 01/01 alcança 38 BRs, 60 veículos e 1.156 obrigações.
 */
const FIXTURE_TODAY = "2026-09-23";

const OPERATIONS = [
  { id: "op-1", name: "Last Mille MG", status: "active" },
  { id: "op-2", name: "Redespacho - Belém", status: "active" },
];

const COVERAGE: CoverageEntry[] = [
  { operationId: "op-1", operationCityId: "oc-1", stateId: 31, uf: "MG", cityId: 3118601, cityName: "Contagem" },
  { operationId: "op-1", operationCityId: "oc-2", stateId: 31, uf: "MG", cityId: 3106200, cityName: "Belo Horizonte" },
  { operationId: "op-2", operationCityId: "oc-3", stateId: 15, uf: "PA", cityId: 1501402, cityName: "Belém" },
];

const BRS: BrEntry[] = [
  { id: "br-1", code: "BR0024706", operationId: "op-1", operationCityId: "oc-1", status: "active" },
  { id: "br-2", code: "BR0024901", operationId: "op-1", operationCityId: "oc-1", status: "active" },
];

const base = {
  employeeStatus: "active" as string | null,
  isPrimary: true,
  operationBrId: null as string | null,
  brCode: null as string | null,
  effectiveTo: null as string | null,
  status: "active" as LeadershipRow["status"],
  isCurrent: true,
  notes: null as string | null,
  endReason: null as string | null,
  updatedAt: "2026-09-01T12:00:00Z" as string | null,
  responsibilityType: "principal" as LeadershipRow["responsibilityType"],
  operationId: "op-1",
  operationName: "Last Mille MG",
  stateId: 31 as number | null,
  stateUf: "MG" as string | null,
};

const ROWS: LeadershipRow[] = [
  {
    ...base,
    id: "la-1",
    employeeId: "emp-1",
    employeeName: "Daniela Ferreira Lima",
    employeeCode: "10234",
    scopeLevel: "city",
    operationCityId: "oc-1",
    cityId: 3118601,
    cityName: "Contagem",
    effectiveFrom: "2026-07-01",
  },
  {
    ...base,
    id: "la-5",
    employeeId: "emp-5",
    employeeName: "Paulo Henrique Martins",
    employeeCode: "10555",
    scopeLevel: "city",
    operationCityId: "oc-2",
    cityId: 3106200,
    cityName: "Belo Horizonte",
    effectiveFrom: "2026-09-25",
    isCurrent: false,
  },
  {
    ...base,
    id: "la-4",
    employeeId: "emp-4",
    employeeName: "Renata Alves Moreira",
    employeeCode: "10077",
    scopeLevel: "city",
    operationId: "op-2",
    operationName: "Redespacho - Belém",
    operationCityId: "oc-3",
    stateId: 15,
    stateUf: "PA",
    cityId: 1501402,
    cityName: "Belém",
    effectiveFrom: "2026-08-01",
    effectiveTo: "2026-09-10",
    status: "ended",
    isCurrent: false,
    endReason: "Transferida para outra operação.",
  },
];

const INDICATORS: LeadershipIndicators = {
  assignments: 2,
  leaders: 2,
  byOperationScope: 0,
  byCityScope: 2,
  byBrScope: 0,
  substitutes: 0,
  brsTotal: 88,
  brsWithLeader: 62,
  placesTotal: 4,
  placesWithLeader: 2,
  placesWithoutLeader: 2,
  coveragePct: 50,
  brsUnderLeadership: 62,
  vehiclesLinked: 60,
  driversLinked: 0,
};

const IMPACT: LeadershipImpact = {
  retroactive: true,
  today: FIXTURE_TODAY,
  periods: [{ from: "2026-01-01", to: "2026-06-30" }],
  pastDays: 181,
  changedDays: 181,
  snapshotsPreserved: true,
  recentPendingObligations: 0,
  brs: {
    count: 38,
    sample: [
      {
        id: "br-1", code: "BR0024706", operationName: "Last Mille MG", cityName: "Contagem", stateUf: "MG",
        firstDay: "2026-01-01", lastDay: "2026-06-30", days: 181,
        leadersBefore: [], leadersAfter: ["Daniela Ferreira Lima"],
      },
      {
        id: "br-2", code: "BR0024901", operationName: "Last Mille MG", cityName: "Contagem", stateUf: "MG",
        firstDay: "2026-01-01", lastDay: "2026-06-30", days: 181,
        leadersBefore: ["Walace Rocha de Souza"], leadersAfter: ["Daniela Ferreira Lima"],
      },
    ],
  },
  vehicles: {
    count: 60,
    sample: [
      { id: "v-1", fleetCode: "VA139", licensePlate: "SNT8C66", brCode: "BR0024706", from: "2026-01-07", to: "2026-06-30" },
      { id: "v-2", fleetCode: "VA155", licensePlate: "SNT8G16", brCode: "BR0024901", from: "2026-01-01", to: "2026-06-30" },
    ],
  },
  drivers: { count: 0, sample: [] },
  checklists: {
    count: 2,
    sample: [
      {
        id: "ce-1", date: "2026-06-29", context: "saida", brCode: "BR0024706", licensePlate: "SNT8C66",
        fleetCode: "VA139", leaderName: "Walace Rocha de Souza",
      },
      {
        id: "ce-2", date: "2026-06-29", context: "retorno", brCode: "BR0024706", licensePlate: "SNT8C66",
        fleetCode: "VA139", leaderName: "Walace Rocha de Souza",
      },
    ],
  },
  obligations: {
    count: 1156,
    open: 1150,
    sample: [
      {
        id: "ob-1", date: "2026-06-29", context: "saida", brCode: "BR0024706", licensePlate: "SNT8C66",
        fleetCode: "VA139", leaderName: "Walace Rocha de Souza", open: false,
      },
      {
        id: "ob-2", date: "2026-06-30", context: "saida", brCode: "BR0024901", licensePlate: "SNT8G16",
        fleetCode: "VA155", leaderName: "Walace Rocha de Souza", open: true,
      },
    ],
  },
};

const NOT_RETROACTIVE: LeadershipImpact = {
  ...IMPACT,
  retroactive: false,
  periods: [],
  pastDays: 0,
  changedDays: 0,
  brs: { count: 0, sample: [] },
  vehicles: { count: 0, sample: [] },
  drivers: { count: 0, sample: [] },
  checklists: { count: 0, sample: [] },
  obligations: { count: 0, open: 0, sample: [] },
};

const HISTORICAL_DENIED =
  "Alterar a liderança de datas que já passaram (a partir de 01/08/2026) é uma correção histórica e exige a permissão \"Corrigir dados históricos da liderança\".";

declare global {
  interface Window {
    __leadershipSaves?: SaveLeadershipInput[];
  }
}

const scopeLoader: LeaderScopeLoader = async (employeeId, competence) => ({
  ok: true,
  data: {
    employeeId,
    competence: `${competence.year}-${String(competence.month).padStart(2, "0")}`,
    anchorDate: FIXTURE_TODAY,
    operations: [],
    cities: [],
    brsTotal: 0,
    brs: [],
    vehiclesTotal: 0,
    driversTotal: 0,
  },
});

/** Retroativa quando o início ou o fim cai antes de "hoje" (23/09/2026). */
const isRetroactive = (input: SaveLeadershipInput) =>
  input.effectiveFrom < FIXTURE_TODAY || Boolean(input.effectiveTo && input.effectiveTo < FIXTURE_TODAY);

export function PreviewLeadershipImpact({
  canExport,
  canManageHistorical,
  filters,
}: {
  canExport: boolean;
  canManageHistorical: boolean;
  filters: LeadershipViewProps["filters"];
}) {
  const impactLoader: LeadershipImpactLoader = async (input) => {
    if (!isRetroactive(input)) return { ok: true, data: NOT_RETROACTIVE };
    if (!canManageHistorical) return { ok: false, error: HISTORICAL_DENIED };
    return { ok: true, data: IMPACT };
  };

  const saver: LeadershipSaver = async (input) => {
    window.__leadershipSaves = [...(window.__leadershipSaves ?? []), input];
    if (isRetroactive(input) && !input.changeReason) {
      return { ok: false, error: "Informe o motivo da correção histórica." };
    }
    return { ok: true, data: { id: input.id ?? "novo" }, warnings: [] };
  };

  const rows = ROWS.filter(
    (r) =>
      (!filters.employeeId || r.employeeId === filters.employeeId) &&
      (!filters.status ||
        (filters.status === "current" ? r.isCurrent : r.status === filters.status)),
  );

  return (
    <LeadershipView
      rows={rows}
      indicators={INDICATORS}
      competence={{ year: 2026, month: 9 }}
      operations={OPERATIONS}
      coverage={COVERAGE}
      brs={BRS}
      filters={filters}
      leaders={ROWS.map((r) => ({ id: r.employeeId, name: r.employeeName, code: r.employeeCode }))}
      canManage
      canAssign
      canReplicate
      canExport={canExport}
      canManageHistorical={canManageHistorical}
      scopeLoader={scopeLoader}
      impactLoader={impactLoader}
      saver={saver}
    />
  );
}
