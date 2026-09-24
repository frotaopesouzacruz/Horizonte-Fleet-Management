"use client";

import * as React from "react";
import { LeadershipView } from "@/app/(app)/governanca/liderancas/leadership-view";
import type { LeaderScopeLoader } from "@/app/(app)/governanca/liderancas/leader-scope-drawer";
import type { BrEntry, CoverageEntry } from "@/components/governance/scope-picker";
import type { LeadershipIndicators, LeadershipRow } from "@/lib/governance/queries";
import type { LeadershipScopeSummary } from "@/lib/governance/brs";
import type { CityLeadershipSaver } from "@/lib/governance/leadership-planner-types";
import { applyCityLeadership, plannerFixture } from "./fixture-planner";

/**
 * A tela recebe uma função (o carregador do escopo), e função não atravessa a
 * fronteira servidor → cliente. Por isso os dados fixos e o carregador inerte
 * vivem aqui, e a rota fica sendo só a casca que exporta o metadata e fecha o
 * portão de produção.
 */
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
  { id: "br-3", code: "BR0024052", operationId: "op-1", operationCityId: "oc-1", status: "active" },
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
};

const ROWS: LeadershipRow[] = [
  {
    ...base,
    id: "la-1",
    employeeId: "emp-1",
    employeeName: "Daniela Ferreira Lima",
    employeeCode: "10234",
    scopeLevel: "city",
    responsibilityType: "principal",
    operationId: "op-1",
    operationName: "Last Mille MG",
    operationCityId: "oc-1",
    stateId: 31,
    stateUf: "MG",
    cityId: 3118601,
    cityName: "Contagem",
    effectiveFrom: "2026-07-01",
  },
  {
    ...base,
    id: "la-2",
    employeeId: "emp-2",
    employeeName: "Walace Rodrigues Santos",
    employeeCode: "10418",
    scopeLevel: "br",
    responsibilityType: "principal",
    operationId: "op-1",
    operationName: "Last Mille MG",
    operationCityId: "oc-1",
    stateId: 31,
    stateUf: "MG",
    cityId: 3118601,
    cityName: "Contagem",
    operationBrId: "br-2",
    brCode: "BR0024901",
    effectiveFrom: "2026-09-01",
  },
  {
    ...base,
    id: "la-3",
    employeeId: "emp-3",
    employeeName: "Marcos Vinícius Andrade",
    employeeCode: null,
    scopeLevel: "operation",
    responsibilityType: "substitute",
    isPrimary: false,
    operationId: "op-2",
    operationName: "Redespacho - Belém",
    operationCityId: null,
    stateId: null,
    stateUf: null,
    cityId: null,
    cityName: null,
    effectiveFrom: "2026-09-01",
    effectiveTo: "2026-09-30",
  },
  {
    ...base,
    id: "la-4",
    employeeId: "emp-4",
    employeeName: "Renata Alves Moreira",
    employeeCode: "10077",
    scopeLevel: "city",
    responsibilityType: "principal",
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

/** §12: quatro locais, três com liderança principal — cobertura de 75%. */
const INDICATORS: LeadershipIndicators = {
  assignments: 3,
  leaders: 3,
  byOperationScope: 1,
  byCityScope: 1,
  byBrScope: 1,
  substitutes: 1,
  brsTotal: 88,
  brsWithLeader: 62,
  placesTotal: 4,
  placesWithLeader: 3,
  placesWithoutLeader: 1,
  coveragePct: 75,
  brsUnderLeadership: 62,
  vehiclesLinked: 60,
  driversLinked: 12,
};

/**
 * O que cada liderança responde, já resolvido pela precedência da §43: Daniela
 * responde pela cidade, mas a BR0024901 tem exceção própria (Walace) e por isso
 * não aparece na lista dela.
 */
const SCOPES: Record<string, LeadershipScopeSummary> = {
  "emp-1": {
    employeeId: "emp-1",
    competence: "2026-09",
    anchorDate: "2026-09-21",
    operations: [{ operationId: "op-1", operationName: "Last Mille MG" }],
    cities: [{ operationCityId: "oc-1", cityName: "Contagem", stateUf: "MG", operationName: "Last Mille MG" }],
    brsTotal: 2,
    brs: [
      { id: "br-1", code: "BR0024706", operationName: "Last Mille MG", cityName: "Contagem", stateUf: "MG", scopeLevel: "city", fleetCode: "FR-0142", licensePlate: "SNO1J56", driverName: "Rafael Souza Campos" },
      { id: "br-3", code: "BR0024052", operationName: "Last Mille MG", cityName: "Contagem", stateUf: "MG", scopeLevel: "city", fleetCode: null, licensePlate: null, driverName: null },
    ],
    vehiclesTotal: 1,
    driversTotal: 1,
  },
  "emp-2": {
    employeeId: "emp-2",
    competence: "2026-09",
    anchorDate: "2026-09-21",
    operations: [{ operationId: "op-1", operationName: "Last Mille MG" }],
    cities: [],
    brsTotal: 1,
    brs: [
      { id: "br-2", code: "BR0024901", operationName: "Last Mille MG", cityName: "Contagem", stateUf: "MG", scopeLevel: "br", fleetCode: "FR-0143", licensePlate: "RTA4C09", driverName: null },
    ],
    vehiclesTotal: 1,
    driversTotal: 0,
  },
};

const scopeLoader: LeaderScopeLoader = async (employeeId, competence) => {
  const found = SCOPES[employeeId];
  if (found) return { ok: true, data: found };
  return {
    ok: true,
    data: {
      employeeId,
      competence: `${competence.year}-${String(competence.month).padStart(2, "0")}`,
      anchorDate: "2026-09-21",
      operations: [],
      cities: [],
      brsTotal: 0,
      brs: [],
      vehiclesTotal: 0,
      driversTotal: 0,
    },
  };
};

export function PreviewLeadership({
  tense = "current",
  canManageHistorical = true,
}: {
  tense?: "current" | "past";
  canManageHistorical?: boolean;
}) {
  // A matriz vive em memória: escolher uma pessoa muda o que a tela mostra,
  // como o `router.refresh()` faria com o banco.
  const [planner, setPlanner] = React.useState(() => plannerFixture(tense));
  const plannerRef = React.useRef(planner);
  const citySaver: CityLeadershipSaver = async (input) => {
    const next = applyCityLeadership(plannerRef.current, input);
    plannerRef.current = next.planner;
    setPlanner(next.planner);
    return next.result;
  };

  return (
    <LeadershipView
      rows={ROWS}
      indicators={INDICATORS}
      planner={planner}
      citySaver={citySaver}
      canManageHistorical={canManageHistorical}
      competence={tense === "past" ? { year: 2026, month: 8 } : { year: 2026, month: 9 }}
      operations={OPERATIONS}
      coverage={COVERAGE}
      brs={BRS}
      filters={{}}
      canManage
      canAssign
      canReplicate
      scopeLoader={scopeLoader}
    />
  );
}
