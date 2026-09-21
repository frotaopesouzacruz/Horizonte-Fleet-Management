"use client";

import * as React from "react";
import { BrPlanner } from "@/app/(app)/governanca/fidelizacao/br-planner";
import type { CoverageEntry } from "@/components/governance/scope-picker";
import type { BrPlannerIndicators, BrPlannerRow } from "@/lib/governance/br-planner";

/**
 * O planner recebe callbacks (navegar, abrir planejamento), e callback não
 * atravessa a fronteira servidor → cliente. Por isso os dados fixos e os
 * manipuladores inertes vivem aqui, e a rota fica sendo só a casca que exporta
 * o metadata e fecha o portão de produção.
 */
const OPERATIONS = [
  { id: "op-1", name: "Last Mille MG", status: "active" },
  { id: "op-2", name: "Redespacho - Belém", status: "active" },
];

const COVERAGE: CoverageEntry[] = [
  { operationId: "op-1", operationCityId: "oc-1", stateId: 31, uf: "MG", cityId: 3118601, cityName: "Contagem" },
  { operationId: "op-2", operationCityId: "oc-2", stateId: 15, uf: "PA", cityId: 1501402, cityName: "Belém" },
];

const LEADERS = [
  { id: "emp-1", name: "Daniela Ferreira Lima" },
  { id: "emp-2", name: "Walace Rodrigues Santos" },
];

const base = {
  description: null as string | null,
  anchorDate: "2026-09-21",
  assignmentEnd: null as string | null,
};

const ROWS: BrPlannerRow[] = [
  {
    ...base,
    id: "br-1",
    code: "BR0024706",
    description: "Rota centro-sul",
    status: "active",
    operationId: "op-1",
    operationName: "Last Mille MG",
    stateId: 31,
    stateUf: "MG",
    cityId: 3118601,
    cityName: "Contagem",
    operationCityId: "oc-1",
    leaderEmployeeId: "emp-1",
    leaderName: "Daniela Ferreira Lima",
    leaderScope: "city",
    vehicleId: "veh-1",
    fleetCode: "FR-0142",
    licensePlate: "SNO1J56",
    assignmentId: "as-1",
    assignmentStart: "2026-08-14",
    driverEmployeeId: "emp-9",
    driverName: "Rafael Souza Campos",
  },
  {
    ...base,
    id: "br-2",
    code: "BR0024901",
    status: "active",
    operationId: "op-1",
    operationName: "Last Mille MG",
    stateId: 31,
    stateUf: "MG",
    cityId: 3118601,
    cityName: "Contagem",
    operationCityId: "oc-1",
    leaderEmployeeId: "emp-2",
    leaderName: "Walace Rodrigues Santos",
    leaderScope: "br",
    vehicleId: "veh-2",
    fleetCode: "FR-0143",
    licensePlate: "RTA4C09",
    assignmentId: "as-2",
    assignmentStart: "2026-01-01",
    driverEmployeeId: null,
    driverName: null,
  },
  {
    ...base,
    id: "br-3",
    code: "Redespacho Belem/Pa_1",
    status: "active",
    operationId: "op-2",
    operationName: "Redespacho - Belém",
    stateId: 15,
    stateUf: "PA",
    cityId: 1501402,
    cityName: "Belém",
    operationCityId: "oc-2",
    leaderEmployeeId: null,
    leaderName: null,
    leaderScope: null,
    vehicleId: null,
    fleetCode: null,
    licensePlate: null,
    assignmentId: null,
    assignmentStart: null,
    driverEmployeeId: null,
    driverName: null,
  },
];

const INDICATORS: BrPlannerIndicators = {
  competence: "2026-09",
  anchorDate: "2026-09-21",
  total: 3,
  active: 3,
  inactive: 0,
  withVehicle: 2,
  withoutVehicle: 1,
  withVehicleInPeriod: 2,
  withDriver: 1,
  withoutDriver: 2,
  byOperation: [
    { operationId: "op-1", operationName: "Last Mille MG", total: 2 },
    { operationId: "op-2", operationName: "Redespacho - Belém", total: 1 },
  ],
  byCity: [
    { cityId: 1501402, cityName: "Belém", stateUf: "PA", total: 1 },
    { cityId: 3118601, cityName: "Contagem", stateUf: "MG", total: 2 },
  ],
};

export function PreviewPlanner() {
  return (
    <BrPlanner
      rows={ROWS}
      indicators={INDICATORS}
      competence={{ year: 2026, month: 9 }}
      operations={OPERATIONS}
      coverage={COVERAGE}
      leaders={LEADERS}
      filters={{}}
      onNavigate={() => {}}
      canManageBrs
      onOpenPlanning={() => {}}
    />
  );
}
