import type {
  FidelizationImportBatch, MovementRow, MovementsPage, MovementType, PlannerMatrix, PlannerSegment,
} from "@/lib/governance/fidelization-central";
import type { FidelizationStability } from "@/lib/governance/brs";
import type { DriverPlanRow } from "@/lib/governance/queries";

/**
 * Dados fixos das quatro áreas da Central de Fidelização (competência 09/2026),
 * no formato exato que os mapeadores de `fidelization-central.ts` devolvem.
 *
 * O mês conta uma história só, para que as áreas se confirmem entre si:
 * - BR0024706 trocou FR-0142 por FR-0150 no dia 11 (substituição) e ganhou um
 *   motorista secundário na mesma operação — principal + secundário, em turnos;
 * - BR0024901 inverteu placas com BR0025110 no dia 18 (as duas linhas da
 *   inversão compartilham a chave de correlação);
 * - BR0031002 substituiu o motorista no dia 16 e tem um secundário a iniciar;
 * - BR0031009 tem veículo e nenhum motorista — o "Sem motorista" do planner.
 * Os eventos de agosto e julho vieram da reconstrução (anteriores à Etapa 15).
 */

export const COMPETENCE = { year: 2026, month: 9 } as const;
export const COMPETENCE_LABEL = "Setembro/2026";

/* ------------------------------------------------------------ geografia */

const CONTAGEM = {
  operationId: "op-1",
  operationName: "Last Mille MG",
  stateId: 31,
  stateUf: "MG",
  cityId: 3118601,
  cityName: "Contagem",
};

const BELEM = {
  operationId: "op-2",
  operationName: "Redespacho - Belém",
  stateId: 15,
  stateUf: "PA",
  cityId: 1501402,
  cityName: "Belém",
};

/* -------------------------------------------------- planner de motoristas */

function segment(partial: Partial<PlannerSegment> & Pick<PlannerSegment, "assignmentId" | "vehicleId">): PlannerSegment {
  return {
    fleetCode: null,
    licensePlate: null,
    vehicleTypeId: "t-van",
    vehicleTypeName: "Van",
    status: "confirmed",
    source: "manual",
    startDate: "2026-09-01",
    endDate: null,
    firstDay: 1,
    lastDay: 30,
    startsHere: false,
    endsHere: false,
    drivers: [],
    ...partial,
  };
}

export const MATRIX: PlannerMatrix = {
  competence: "2026-09",
  anchorDate: "2026-09-21",
  today: "2026-09-21",
  daysInMonth: 30,
  total: 4,
  rows: [
    {
      operationBrId: "br-1",
      brCode: "BR0024706",
      brDescription: "Rota centro-sul",
      brStatus: "active",
      ...CONTAGEM,
      leaderEmployeeId: "emp-1",
      leaderName: "Daniela Ferreira Lima",
      leaderLevel: "city",
      daysWithVehicle: 30,
      daysWithoutVehicle: 0,
      changes: 1,
      segments: [
        segment({
          assignmentId: "as-1a", vehicleId: "veh-142", fleetCode: "FR-0142", licensePlate: "SNO1J56",
          startDate: "2026-08-14", endDate: "2026-09-10", firstDay: 1, lastDay: 10, endsHere: true,
        }),
        segment({
          assignmentId: "as-1b", vehicleId: "veh-150", fleetCode: "FR-0150", licensePlate: "SNT1A63",
          source: "substitution", startDate: "2026-09-11", firstDay: 11, lastDay: 30, startsHere: true,
        }),
      ],
    },
    {
      operationBrId: "br-2",
      brCode: "BR0024901",
      brDescription: null,
      brStatus: "active",
      ...CONTAGEM,
      leaderEmployeeId: "emp-2",
      leaderName: "Walace Rodrigues Santos",
      leaderLevel: "br",
      daysWithVehicle: 30,
      daysWithoutVehicle: 0,
      changes: 1,
      segments: [
        segment({
          assignmentId: "as-2a", vehicleId: "veh-143", fleetCode: "FR-0143", licensePlate: "RTA4C09",
          startDate: "2026-01-01", endDate: "2026-09-17", firstDay: 1, lastDay: 17, endsHere: true,
        }),
        segment({
          assignmentId: "as-2b", vehicleId: "veh-201", fleetCode: "FR-0201", licensePlate: "SBT5H09",
          source: "inversion", startDate: "2026-09-18", firstDay: 18, lastDay: 30, startsHere: true,
        }),
      ],
    },
    {
      operationBrId: "br-3",
      brCode: "BR0031002",
      brDescription: null,
      brStatus: "active",
      ...BELEM,
      leaderEmployeeId: "emp-3",
      leaderName: "Marcos Vinícius Andrade",
      leaderLevel: "city",
      daysWithVehicle: 30,
      daysWithoutVehicle: 0,
      changes: 0,
      segments: [
        segment({
          assignmentId: "as-3", vehicleId: "veh-125", fleetCode: "VA125", licensePlate: "RTC3C33",
          startDate: "2026-06-01",
        }),
      ],
    },
    {
      operationBrId: "br-4",
      brCode: "BR0031009",
      brDescription: null,
      brStatus: "active",
      ...BELEM,
      leaderEmployeeId: "emp-3",
      leaderName: "Marcos Vinícius Andrade",
      leaderLevel: "city",
      daysWithVehicle: 26,
      daysWithoutVehicle: 4,
      changes: 0,
      segments: [
        segment({
          assignmentId: "as-4", vehicleId: "veh-131", fleetCode: "VA131", licensePlate: "RTD4D44",
          startDate: "2026-09-05", firstDay: 5, lastDay: 30, startsHere: true,
        }),
      ],
    },
  ],
};

const POSITION = {
  "br-1": { brCode: "BR0024706", ...CONTAGEM },
  "br-2": { brCode: "BR0024901", ...CONTAGEM },
  "br-3": { brCode: "BR0031002", ...BELEM },
  "br-4": { brCode: "BR0031009", ...BELEM },
} as const;

function driver(
  br: keyof typeof POSITION,
  partial: Omit<DriverPlanRow, "brCode" | "operationBrId" | "cityName" | "stateUf" | "operationName">,
): DriverPlanRow {
  const p = POSITION[br];
  return {
    ...partial,
    brCode: p.brCode,
    operationBrId: br,
    cityName: p.cityName,
    stateUf: p.stateUf,
    operationName: p.operationName,
  };
}

export const DRIVER_PLANS: DriverPlanRow[] = [
  driver("br-1", {
    id: "dr-1", assignmentId: "as-1b", employeeId: "emp-21", employeeName: "Rafael Souza Campos", employeeCode: "1021",
    driverRole: "primary", startDate: "2026-09-11", endDate: null, status: "confirmed",
    fleetCode: "FR-0150", licensePlate: "SNT1A63",
  }),
  driver("br-1", {
    id: "dr-2", assignmentId: "as-1b", employeeId: "emp-44", employeeName: "Leandro Carvalho Silva", employeeCode: "1044",
    driverRole: "secondary", startDate: "2026-09-11", endDate: null, status: "planned",
    fleetCode: "FR-0150", licensePlate: "SNT1A63",
  }),
  driver("br-1", {
    id: "dr-3", assignmentId: "as-1a", employeeId: "emp-21", employeeName: "Rafael Souza Campos", employeeCode: "1021",
    driverRole: "primary", startDate: "2026-08-14", endDate: "2026-09-10", status: "executed",
    fleetCode: "FR-0142", licensePlate: "SNO1J56",
  }),
  driver("br-2", {
    id: "dr-4", assignmentId: "as-2b", employeeId: "emp-07", employeeName: "Flaviano Lucio Dos Santos", employeeCode: "1107",
    driverRole: "primary", startDate: "2026-09-18", endDate: null, status: "confirmed",
    fleetCode: "FR-0201", licensePlate: "SBT5H09",
  }),
  driver("br-2", {
    id: "dr-5", assignmentId: "as-2a", employeeId: "emp-07", employeeName: "Flaviano Lucio Dos Santos", employeeCode: "1107",
    driverRole: "primary", startDate: "2026-01-05", endDate: "2026-09-17", status: "executed",
    fleetCode: "FR-0143", licensePlate: "RTA4C09",
  }),
  driver("br-2", {
    id: "dr-6", assignmentId: "as-2a", employeeId: "emp-19", employeeName: "Marina dos Santos Figueiredo", employeeCode: "1219",
    driverRole: "secondary", startDate: "2026-09-08", endDate: "2026-09-30", status: "cancelled",
    fleetCode: "FR-0143", licensePlate: "RTA4C09",
  }),
  driver("br-3", {
    id: "dr-7", assignmentId: "as-3", employeeId: "emp-88", employeeName: "Thiago Henrique Moreira Castro", employeeCode: "1188",
    driverRole: "primary", startDate: "2026-09-16", endDate: null, status: "confirmed",
    fleetCode: "VA125", licensePlate: "RTC3C33",
  }),
  driver("br-3", {
    id: "dr-8", assignmentId: "as-3", employeeId: "emp-50", employeeName: "Walace Rocha De Souza", employeeCode: "1150",
    driverRole: "primary", startDate: "2026-06-01", endDate: "2026-09-15", status: "executed",
    fleetCode: "VA125", licensePlate: "RTC3C33",
  }),
  driver("br-3", {
    id: "dr-9", assignmentId: "as-3", employeeId: "emp-03", employeeName: "Carlos Eduardo Nogueira Silva", employeeCode: "1203",
    driverRole: "secondary", startDate: "2026-09-28", endDate: null, status: "planned",
    fleetCode: "VA125", licensePlate: "RTC3C33",
  }),
];

/* ---------------------------------------------- histórico de movimentações */

const EMPTY_MOVEMENT = {
  previousVehicleId: null,
  previousVehicleLabel: null,
  previousPlate: null,
  newVehicleId: null,
  newVehicleLabel: null,
  newPlate: null,
  previousDriverName: null,
  previousDriverCode: null,
  newDriverName: null,
  newDriverCode: null,
  driverRole: null,
  periodStart: null,
  periodEnd: null,
  reason: null,
  source: "manual",
  origin: "user",
  isInferred: false,
  notes: null,
  actorName: null,
} satisfies Partial<MovementRow>;

type MovementInput = Partial<MovementRow> &
  Pick<MovementRow, "id" | "movementType" | "subject" | "effectiveDate" | "correlationKey" | "recordedAt">;

function movement(
  position: { brCode: string; operationBrId: string; leaderName: string | null } & typeof CONTAGEM,
  input: MovementInput,
): MovementRow {
  return {
    ...EMPTY_MOVEMENT,
    operationBrId: position.operationBrId,
    brCode: position.brCode,
    operationId: position.operationId,
    operationName: position.operationName,
    stateUf: position.stateUf,
    cityId: position.cityId,
    cityName: position.cityName,
    leaderEmployeeId: position.leaderName ? `leader:${position.leaderName}` : null,
    leaderName: position.leaderName,
    ...input,
  };
}

const AT = {
  br1: { brCode: "BR0024706", operationBrId: "br-1", leaderName: "Daniela Ferreira Lima", ...CONTAGEM },
  br2: { brCode: "BR0024901", operationBrId: "br-2", leaderName: "Walace Rodrigues Santos", ...CONTAGEM },
  br5: { brCode: "BR0025110", operationBrId: "br-5", leaderName: "Daniela Ferreira Lima", ...CONTAGEM },
  br6: { brCode: "BR0025300", operationBrId: "br-6", leaderName: null, ...CONTAGEM },
  br3: { brCode: "BR0031002", operationBrId: "br-3", leaderName: "Marcos Vinícius Andrade", ...BELEM },
  br4: { brCode: "BR0031009", operationBrId: "br-4", leaderName: "Marcos Vinícius Andrade", ...BELEM },
};

const GABRIEL = "Gabriel Moutinho Albino";
const ANA = "Ana Paula de Almeida Rodrigues";

/** Da mais recente para a mais antiga, como `fidelization_movements_list` ordena. */
export const MOVEMENT_ROWS: MovementRow[] = [
  movement(AT.br2, {
    id: "mv-01", movementType: "vehicle_inversion", subject: "vehicle", effectiveDate: "2026-09-18",
    previousVehicleId: "veh-143", previousVehicleLabel: "FR-0143", previousPlate: "RTA4C09",
    newVehicleId: "veh-201", newVehicleLabel: "FR-0201", newPlate: "SBT5H09",
    reason: "Troca de placas entre rotas para a manutenção programada", source: "inversion",
    actorName: GABRIEL, correlationKey: "tx:81234", recordedAt: "2026-09-17T19:42:10Z",
  }),
  movement(AT.br5, {
    id: "mv-02", movementType: "vehicle_inversion", subject: "vehicle", effectiveDate: "2026-09-18",
    previousVehicleId: "veh-201", previousVehicleLabel: "FR-0201", previousPlate: "SBT5H09",
    newVehicleId: "veh-143", newVehicleLabel: "FR-0143", newPlate: "RTA4C09",
    reason: "Troca de placas entre rotas para a manutenção programada", source: "inversion",
    actorName: GABRIEL, correlationKey: "tx:81234", recordedAt: "2026-09-17T19:42:10Z",
  }),
  movement(AT.br3, {
    id: "mv-03", movementType: "driver_substitution", subject: "driver", effectiveDate: "2026-09-16",
    previousDriverName: "Walace Rocha De Souza", previousDriverCode: "1150",
    newDriverName: "Thiago Henrique Moreira Castro", newDriverCode: "1188", driverRole: "primary",
    reason: "Férias do motorista titular", actorName: ANA, correlationKey: "tx:81190",
    recordedAt: "2026-09-15T12:03:44Z",
  }),
  movement(AT.br1, {
    id: "mv-04", movementType: "vehicle_substitution", subject: "vehicle", effectiveDate: "2026-09-11",
    previousVehicleId: "veh-142", previousVehicleLabel: "FR-0142", previousPlate: "SNO1J56",
    newVehicleId: "veh-150", newVehicleLabel: "FR-0150", newPlate: "SNT1A63",
    reason: "Veículo em manutenção corretiva", source: "substitution",
    actorName: GABRIEL, correlationKey: "tx:81002", recordedAt: "2026-09-10T17:15:00Z",
  }),
  movement(AT.br1, {
    id: "mv-05", movementType: "driver_allocation", subject: "driver", effectiveDate: "2026-09-11",
    newDriverName: "Leandro Carvalho Silva", newDriverCode: "1044", driverRole: "secondary",
    reason: "Segundo turno da rota", actorName: GABRIEL, correlationKey: "tx:81002",
    recordedAt: "2026-09-10T17:15:00Z",
  }),
  movement(AT.br6, {
    id: "mv-06", movementType: "vehicle_substitution", subject: "vehicle", effectiveDate: "2026-09-08",
    previousVehicleId: "veh-310", previousVehicleLabel: "FR-0310", previousPlate: "RQK2F18",
    newVehicleId: "veh-155", newVehicleLabel: "VA155", newPlate: "PWQ7J34",
    isInferred: true, actorName: GABRIEL, correlationKey: "tx:80901", recordedAt: "2026-09-08T08:30:00Z",
  }),
  movement(AT.br4, {
    id: "mv-07", movementType: "administrative_correction", subject: "vehicle", effectiveDate: "2026-09-05",
    previousVehicleId: "veh-116", previousVehicleLabel: "VA116", previousPlate: "RTE5E55",
    newVehicleId: "veh-131", newVehicleLabel: "VA131", newPlate: "RTD4D44",
    reason: "Placa lançada errada na importação",
    notes: "Corrigido após conferência com o CRLV. O vínculo anterior continua no histórico.",
    actorName: ANA, correlationKey: "tx:80877", recordedAt: "2026-09-06T10:12:31Z",
  }),
  movement(AT.br6, {
    id: "mv-08", movementType: "vehicle_removal", subject: "vehicle", effectiveDate: "2026-09-03",
    previousVehicleId: "veh-310", previousVehicleLabel: "FR-0310", previousPlate: "RQK2F18",
    reason: "Veículo sinistrado", actorName: GABRIEL, correlationKey: "tx:80810",
    recordedAt: "2026-09-03T15:47:00Z",
  }),
  movement(AT.br4, {
    id: "mv-09", movementType: "cancellation", subject: "vehicle", effectiveDate: "2026-09-02",
    previousVehicleId: "veh-116", previousVehicleLabel: "VA116", previousPlate: "RTE5E55",
    reason: "Planejamento duplicado na planilha", source: "import", origin: "import",
    actorName: ANA, correlationKey: "tx:80790", recordedAt: "2026-09-02T11:20:00Z",
  }),
  movement(AT.br4, {
    id: "mv-10", movementType: "vehicle_allocation", subject: "vehicle", effectiveDate: "2026-09-01",
    newVehicleId: "veh-116", newVehicleLabel: "VA116", newPlate: "RTE5E55",
    reason: "Replicação da competência 08/2026", source: "replication", origin: "replication",
    actorName: GABRIEL, correlationKey: "tx:80700", recordedAt: "2026-08-29T18:00:00Z",
  }),
  movement(AT.br6, {
    id: "mv-11", movementType: "vehicle_return", subject: "vehicle", effectiveDate: "2026-08-28",
    newVehicleId: "veh-310", newVehicleLabel: "FR-0310", newPlate: "RQK2F18",
    reason: "Retorno da oficina", actorName: GABRIEL, correlationKey: "tx:80655",
    recordedAt: "2026-08-27T16:05:00Z",
  }),
  movement(AT.br3, {
    id: "mv-12", movementType: "driver_end", subject: "driver", effectiveDate: "2026-08-20",
    previousDriverName: "Carlos Eduardo Nogueira Silva", previousDriverCode: "1203", driverRole: "secondary",
    reason: "Fim do turno noturno", origin: "system", correlationKey: "tx:80500",
    recordedAt: "2026-08-21T03:00:00Z",
  }),
  movement(AT.br1, {
    id: "mv-13", movementType: "first_allocation", subject: "vehicle", effectiveDate: "2026-08-14",
    newVehicleId: "veh-142", newVehicleLabel: "FR-0142", newPlate: "SNO1J56",
    origin: "reconstructed", correlationKey: "r:2026-08-13T13:00:00Z", recordedAt: "2026-08-13T13:00:00Z",
  }),
  movement(AT.br1, {
    id: "mv-14", movementType: "driver_allocation", subject: "driver", effectiveDate: "2026-08-14",
    newDriverName: "Rafael Souza Campos", newDriverCode: "1021", driverRole: "primary",
    origin: "reconstructed", actorName: GABRIEL, correlationKey: "r:2026-08-13T13:04:00Z",
    recordedAt: "2026-08-13T13:04:00Z",
  }),
  movement(AT.br2, {
    id: "mv-15", movementType: "vehicle_substitution", subject: "vehicle", effectiveDate: "2026-07-10",
    previousVehicleId: "veh-106", previousVehicleLabel: "VA106", previousPlate: "HIJ7K89",
    newVehicleId: "veh-143", newVehicleLabel: "FR-0143", newPlate: "RTA4C09",
    origin: "reconstructed", isInferred: true, correlationKey: "r:2026-07-09T20:00:00Z",
    recordedAt: "2026-07-09T20:00:00Z",
  }),
  movement(AT.br6, {
    id: "mv-16", movementType: "vehicle_end", subject: "vehicle", effectiveDate: "2026-07-01",
    previousVehicleId: "veh-309", previousVehicleLabel: "FR-0309", previousPlate: "MZX1B62",
    reason: "Fim do contrato de locação", origin: "reconstructed", correlationKey: "r:2026-06-30T21:00:00Z",
    recordedAt: "2026-06-30T21:00:00Z",
  }),
];

export interface MovementFixtureFilters {
  dateFrom?: string;
  dateTo?: string;
  movementType?: string;
  subject?: string;
  vehicle?: string;
  driver?: string;
}

/**
 * O mesmo recorte que `fidelization_movements_list` faz no banco — contagens e
 * reconstruídos sobre o conjunto filtrado, a página depois —, para a prévia se
 * comportar como a tela real ao clicar num tipo ou paginar.
 */
export function movementsPageFor(filters: MovementFixtureFilters, page = 1, pageSize = 50): MovementsPage {
  const has = (haystack: (string | null)[], needle: string) =>
    haystack.filter(Boolean).join(" ").toLowerCase().includes(needle.trim().toLowerCase());
  const base = MOVEMENT_ROWS.filter(
    (m) =>
      (!filters.dateFrom || m.effectiveDate >= filters.dateFrom) &&
      (!filters.dateTo || m.effectiveDate <= filters.dateTo) &&
      (!filters.movementType || m.movementType === filters.movementType) &&
      (!filters.subject || m.subject === filters.subject) &&
      (!filters.vehicle ||
        has([m.previousVehicleLabel, m.previousPlate, m.newVehicleLabel, m.newPlate], filters.vehicle)) &&
      (!filters.driver ||
        has([m.previousDriverName, m.previousDriverCode, m.newDriverName, m.newDriverCode], filters.driver)),
  );
  const counts: Partial<Record<MovementType, number>> = {};
  for (const m of base) counts[m.movementType] = (counts[m.movementType] ?? 0) + 1;
  const safePage = Math.max(1, page);
  return {
    total: base.length,
    page: safePage,
    pageSize,
    counts,
    reconstructed: base.filter((m) => m.origin === "reconstructed").length,
    rows: base.slice((safePage - 1) * pageSize, safePage * pageSize),
  };
}

/* ------------------------------------------------ histórico de importações */

export const IMPORT_HISTORY: FidelizationImportBatch[] = [
  {
    id: "imp-3",
    type: "fidelization",
    fileName: "alocacoes-setembro-2026.xlsx",
    status: "completed",
    totalRows: 48,
    validRows: 43,
    warningRows: 2,
    errorRows: 3,
    createdRows: 38,
    updatedRows: 0,
    skippedRows: 10,
    errorMessage: null,
    createdAt: "2026-09-01T11:20:00Z",
    processedAt: "2026-09-01T11:22:41Z",
    createdByName: "Gabriel Moutinho Albino",
    errors: [
      { row: 12, message: "BR não encontrada: BR0099999. A importação não cria BRs." },
      { row: 27, message: "Veículo não encontrado: FROTA-999. A importação não cria veículos." },
      { row: 31, message: "A data final (05/09/2026) é anterior à inicial (10/09/2026)." },
    ],
  },
  {
    id: "imp-2",
    type: "operation_brs",
    fileName: "brs-redespacho-belem.csv",
    status: "completed",
    totalRows: 12,
    validRows: 12,
    warningRows: 1,
    errorRows: 0,
    createdRows: 3,
    updatedRows: 2,
    skippedRows: 7,
    errorMessage: null,
    createdAt: "2026-08-28T14:05:00Z",
    processedAt: "2026-08-28T14:05:32Z",
    createdByName: "Ana Paula de Almeida Rodrigues",
    errors: [],
  },
  {
    id: "imp-1",
    type: "fidelization",
    fileName: "planejamento-agosto.csv",
    status: "failed",
    totalRows: 0,
    validRows: 0,
    warningRows: 0,
    errorRows: 0,
    createdRows: 0,
    updatedRows: 0,
    skippedRows: 0,
    errorMessage: "O arquivo não tem a coluna obrigatória “Código BR”.",
    createdAt: "2026-08-01T09:12:00Z",
    processedAt: null,
    createdByName: "Gabriel Moutinho Albino",
    errors: [],
  },
];

/* -------------------------------------------------- dashboard de estabilidade */

export const STABILITY: FidelizationStability = {
  competence: "2026-09",
  anchorDate: "2026-09-21",
  periodStart: "2026-09-01",
  periodEnd: "2026-09-30",
  brsTotal: 88,
  brsWithVehicle: 86,
  brsWithVehicleNow: 85,
  brsWithoutVehicleNow: 3,
  brsWithDriver: 61,
  brsWithoutDriver: 27,
  brsWithLeader: 84,
  vehicleSubstitutions: 2,
  vehicleInversions: 1,
  mobilizations: 3,
  brsWithVehicleChange: 4,
  inferredVehicleChanges: 1,
  driverChanges: 1,
  brsWithDriverChange: 1,
  fleetStabilityPct: 95.3,
  driverStabilityPct: 98.4,
  leadershipCoveragePct: 95.5,
  byOperation: [
    { key: "op-1", label: "Last Mille MG", sublabel: null, brs: 62, withVehicle: 61, mobilizations: 3, brsWithChange: 4, stabilityPct: 93.4 },
    { key: "op-2", label: "Redespacho - Belém", sublabel: null, brs: 26, withVehicle: 25, mobilizations: 0, brsWithChange: 0, stabilityPct: 100 },
  ],
  byCity: [
    { key: "op-1:3118601", label: "Contagem/MG", sublabel: "Last Mille MG", brs: 62, withVehicle: 61, mobilizations: 3, brsWithChange: 4, stabilityPct: 93.4 },
    { key: "op-2:1501402", label: "Belém/PA", sublabel: "Redespacho - Belém", brs: 26, withVehicle: 25, mobilizations: 0, brsWithChange: 0, stabilityPct: 100 },
  ],
  byLeader: [
    { key: "emp-1", label: "Daniela Ferreira Lima", sublabel: null, brs: 40, withVehicle: 40, mobilizations: 2, brsWithChange: 3, stabilityPct: 92.5 },
    { key: "emp-2", label: "Walace Rodrigues Santos", sublabel: null, brs: 18, withVehicle: 17, mobilizations: 1, brsWithChange: 1, stabilityPct: 94.1 },
    { key: "emp-3", label: "Marcos Vinícius Andrade", sublabel: null, brs: 26, withVehicle: 25, mobilizations: 0, brsWithChange: 0, stabilityPct: 100 },
    { key: "none", label: "Sem liderança", sublabel: null, brs: 4, withVehicle: 4, mobilizations: 0, brsWithChange: 0, stabilityPct: 100 },
  ],
  brsRegistered: 91,
  vehiclesFidelized: 92,
  driversFidelized: 64,
  byState: [
    { key: "MG", label: "MG", sublabel: null, brs: 62, withVehicle: 61, mobilizations: 3, brsWithChange: 4, stabilityPct: 93.4 },
    { key: "PA", label: "PA", sublabel: null, brs: 26, withVehicle: 25, mobilizations: 0, brsWithChange: 0, stabilityPct: 100 },
  ],
  byVehicleType: [
    { key: "t-van", label: "Van", sublabel: null, brs: 74, withVehicle: 74, mobilizations: 3, brsWithChange: 4, stabilityPct: 94.6 },
    { key: "t-truck", label: "Caminhão 3/4", sublabel: null, brs: 12, withVehicle: 12, mobilizations: 0, brsWithChange: 0, stabilityPct: 100 },
    { key: "none", label: "Sem veículo", sublabel: null, brs: 2, withVehicle: 0, mobilizations: 0, brsWithChange: 0, stabilityPct: null },
  ],
};
