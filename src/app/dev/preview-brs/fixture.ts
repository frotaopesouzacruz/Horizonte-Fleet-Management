import type { CoverageEntry } from "@/components/governance/scope-picker";
import type { BrDirectoryPage, BrDirectoryRow } from "@/lib/governance/brs";
import type { BrPlannerIndicators } from "@/lib/governance/br-planner";

/**
 * Dados fixos do módulo BRs, no formato exato que `getBrDirectory` e
 * `getBrPlannerIndicators` devolvem.
 *
 * Três posições, escolhidas pelos estados que a tela precisa distinguir: uma
 * completa (veículo, motorista e liderança vinda da cidade), uma vaga cuja
 * liderança é exceção do próprio BR, e uma inativa. Nada aqui é estimado — os
 * números fecham entre linhas e indicadores como fechariam no banco.
 */

export const OPERATIONS = [
  { id: "op-1", name: "Last Mille MG", status: "active" },
  { id: "op-2", name: "Redespacho - Belém", status: "active" },
];

export const COVERAGE: CoverageEntry[] = [
  { operationId: "op-1", operationCityId: "oc-1", stateId: 31, uf: "MG", cityId: 3118601, cityName: "Contagem" },
  { operationId: "op-2", operationCityId: "oc-2", stateId: 15, uf: "PA", cityId: 1501402, cityName: "Belém" },
];

export const LEADERS = [
  { id: "emp-1", name: "Daniela Ferreira Lima" },
  { id: "emp-2", name: "Walace Rodrigues Santos" },
];

const ANCHOR = "2026-09-21";

export const ROWS: BrDirectoryRow[] = [
  {
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
    assignmentStart: "2026-09-10",
    assignmentEnd: null,
    driverEmployeeId: "emp-9",
    driverName: "Rafael Souza Campos",
    anchorDate: ANCHOR,
    lastMovementAt: "2026-09-10T11:32:00.000Z",
    swappedInPeriod: true,
  },
  {
    id: "br-2",
    code: "BR0024901",
    description: null,
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
    vehicleId: null,
    fleetCode: null,
    licensePlate: null,
    assignmentId: null,
    assignmentStart: null,
    assignmentEnd: null,
    driverEmployeeId: null,
    driverName: null,
    anchorDate: ANCHOR,
    lastMovementAt: "2026-08-31T18:05:00.000Z",
    swappedInPeriod: false,
  },
  {
    id: "br-3",
    code: "Redespacho Belem/Pa_1",
    description: null,
    status: "inactive",
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
    assignmentEnd: null,
    driverEmployeeId: null,
    driverName: null,
    anchorDate: ANCHOR,
    lastMovementAt: null,
    swappedInPeriod: false,
  },
];

export const PAGE: BrDirectoryPage = {
  total: ROWS.length,
  limit: 50,
  offset: 0,
  competence: "2026-09",
  periodStart: "2026-09-01",
  periodEnd: "2026-09-30",
  rows: ROWS,
};

export const INDICATORS: BrPlannerIndicators = {
  competence: "2026-09",
  anchorDate: ANCHOR,
  total: 3,
  active: 2,
  inactive: 1,
  withVehicle: 1,
  withoutVehicle: 2,
  withVehicleInPeriod: 1,
  withDriver: 1,
  withoutDriver: 2,
  withLeader: 2,
  // Só BRs ativas contam como pendência: a inativa sem liderança não entra.
  withoutLeader: 0,
  withVehicleSwapInPeriod: 1,
  byOperation: [
    { operationId: "op-1", operationName: "Last Mille MG", total: 2 },
    { operationId: "op-2", operationName: "Redespacho - Belém", total: 1 },
  ],
  byCity: [
    { cityId: 1501402, cityName: "Belém", stateUf: "PA", total: 1 },
    { cityId: 3118601, cityName: "Contagem", stateUf: "MG", total: 2 },
  ],
  byLeader: [
    { employeeId: "emp-1", leaderName: "Daniela Ferreira Lima", total: 1 },
    { employeeId: "emp-2", leaderName: "Walace Rodrigues Santos", total: 1 },
  ],
};
