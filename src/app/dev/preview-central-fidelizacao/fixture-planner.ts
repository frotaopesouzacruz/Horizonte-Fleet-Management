import type { EligibleVehicle } from "@/lib/governance/actions";
import type {
  PlannerDriver, PlannerMatrix, PlannerRow, PlannerSegment,
} from "@/lib/governance/fidelization-central";

/**
 * Planner de Frotas — dados fixos da competência Setembro/2026, com "hoje" em
 * 23/09/2026.
 *
 * Oito BRs em duas operações, escolhidas para que cada estado que o grid
 * precisa distinguir apareça pelo menos uma vez:
 *
 *  - BR0024706: vínculo que vem de agosto e segue em aberto (borda aberta dos
 *    dois lados), com motorista;
 *  - BR0024715: substituição no meio do mês (VA125 até 14/09, FL145 desde 15/09);
 *  - BR0024733: nenhum veículo no mês;
 *  - BR0025110 / BR0025118: um par de inversão em 11/09;
 *  - BR0024901: liderança por exceção do próprio BR, com dias sem veículo no fim;
 *  - Belém: um vínculo antigo em aberto e outro que segue em outubro.
 *
 * Códigos de frota e placas são fictícios; os nomes são os mesmos já usados
 * nas outras prévias.
 */

export const PLANNER_COMPETENCE = { year: 2026, month: 9 } as const;
export const PLANNER_TODAY = "2026-09-23";

const MONTH_START = "2026-09-01";
const MONTH_END = "2026-09-30";
const DAYS = 30;

export const PLANNER_LEADERS = [
  { id: "emp-1", name: "Daniela Ferreira Lima" },
  { id: "emp-3", name: "Marcos Vinícius Andrade" },
  { id: "emp-2", name: "Walace Rodrigues Santos" },
];

export const PLANNER_VEHICLE_TYPES = [
  { id: "t-van", name: "Van" },
  { id: "t-34", name: "Caminhão 3/4" },
  { id: "t-vuc", name: "VUC" },
];

const TYPE_NAME: Record<string, string> = Object.fromEntries(PLANNER_VEHICLE_TYPES.map((t) => [t.id, t.name]));

/** O catálogo da frota que a busca de placa enxerga. */
export const PLANNER_VEHICLES: {
  vehicleId: string;
  fleetCode: string;
  licensePlate: string;
  makeName: string;
  modelName: string;
  vehicleTypeId: string;
}[] = [
  { vehicleId: "veh-va106", fleetCode: "VA106", licensePlate: "SGK4A11", makeName: "Renault", modelName: "Master", vehicleTypeId: "t-van" },
  { vehicleId: "veh-va116", fleetCode: "VA116", licensePlate: "SNT8E16", makeName: "Renault", modelName: "Master", vehicleTypeId: "t-van" },
  { vehicleId: "veh-va125", fleetCode: "VA125", licensePlate: "RTA4C09", makeName: "Fiat", modelName: "Ducato", vehicleTypeId: "t-van" },
  { vehicleId: "veh-va131", fleetCode: "VA131", licensePlate: "PXB2D34", makeName: "Fiat", modelName: "Ducato", vehicleTypeId: "t-van" },
  { vehicleId: "veh-va140", fleetCode: "VA140", licensePlate: "RMZ9C33", makeName: "Peugeot", modelName: "Boxer", vehicleTypeId: "t-van" },
  { vehicleId: "veh-fl145", fleetCode: "FL145", licensePlate: "QPE7B21", makeName: "Mercedes-Benz", modelName: "Sprinter", vehicleTypeId: "t-van" },
  { vehicleId: "veh-va151", fleetCode: "VA151", licensePlate: "SHQ3F72", makeName: "Renault", modelName: "Master", vehicleTypeId: "t-van" },
  { vehicleId: "veh-fl152", fleetCode: "FL152", licensePlate: "QTP6D48", makeName: "Iveco", modelName: "Daily", vehicleTypeId: "t-vuc" },
  { vehicleId: "veh-va155", fleetCode: "VA155", licensePlate: "SOQ1H78", makeName: "Fiat", modelName: "Ducato", vehicleTypeId: "t-van" },
  { vehicleId: "veh-va163", fleetCode: "VA163", licensePlate: "QDA5E90", makeName: "Volkswagen", modelName: "Delivery 9.170", vehicleTypeId: "t-34" },
  { vehicleId: "veh-va170", fleetCode: "VA170", licensePlate: "RWC3F12", makeName: "Volkswagen", modelName: "Delivery 9.170", vehicleTypeId: "t-34" },
];

const VEHICLE = Object.fromEntries(PLANNER_VEHICLES.map((v) => [v.vehicleId, v]));

function driver(
  employeeId: string,
  name: string,
  startDate: string,
  endDate: string | null = null,
  driverRole: PlannerDriver["driverRole"] = "primary",
): PlannerDriver {
  return { employeeId, name, employeeCode: null, driverRole, startDate, endDate };
}

/** Deriva os campos do mês (primeiro/último dia, bordas) das datas do vínculo. */
function segment(input: {
  assignmentId: string;
  vehicleId: string;
  status: PlannerSegment["status"];
  source?: string;
  startDate: string;
  endDate: string | null;
  drivers?: PlannerDriver[];
}): PlannerSegment {
  const v = VEHICLE[input.vehicleId];
  const startsHere = input.startDate >= MONTH_START;
  const endsHere = input.endDate !== null && input.endDate <= MONTH_END;
  return {
    assignmentId: input.assignmentId,
    vehicleId: input.vehicleId,
    fleetCode: v.fleetCode,
    licensePlate: v.licensePlate,
    vehicleTypeId: v.vehicleTypeId,
    vehicleTypeName: TYPE_NAME[v.vehicleTypeId] ?? null,
    status: input.status,
    source: input.source ?? "manual",
    startDate: input.startDate,
    endDate: input.endDate,
    firstDay: startsHere ? Number(input.startDate.slice(8, 10)) : 1,
    lastDay: endsHere ? Number((input.endDate as string).slice(8, 10)) : DAYS,
    startsHere,
    endsHere,
    drivers: input.drivers ?? [],
  };
}

const LAST_MILLE = { operationId: "op-lm", operationName: "Last Mille MG" };
const BELEM_OP = { operationId: "op-rb", operationName: "Redespacho - Belém" };
const CONTAGEM = { stateId: 31, stateUf: "MG", cityId: 3118601, cityName: "Contagem" };
const DIVINOPOLIS = { stateId: 31, stateUf: "MG", cityId: 3122306, cityName: "Divinópolis" };
const BELEM = { stateId: 15, stateUf: "PA", cityId: 1501402, cityName: "Belém" };
const DANIELA = { leaderEmployeeId: "emp-1", leaderName: "Daniela Ferreira Lima" };
const WALACE = { leaderEmployeeId: "emp-2", leaderName: "Walace Rodrigues Santos" };
const MARCOS = { leaderEmployeeId: "emp-3", leaderName: "Marcos Vinícius Andrade" };

function row(
  input: Omit<PlannerRow, "daysWithVehicle" | "daysWithoutVehicle" | "changes" | "brStatus"> & { brStatus?: string },
): PlannerRow {
  const covered = new Set<number>();
  for (const s of input.segments) for (let d = s.firstDay; d <= s.lastDay; d++) covered.add(d);
  return {
    ...input,
    brStatus: input.brStatus ?? "active",
    daysWithVehicle: covered.size,
    daysWithoutVehicle: DAYS - covered.size,
    changes: Math.max(0, input.segments.length - 1),
  };
}

const ROWS: PlannerRow[] = [
  // ---------------------------------------------- Last Mille MG · Daniela
  row({
    operationBrId: "br-24706",
    brCode: "BR0024706",
    brDescription: "Rota centro-sul",
    ...LAST_MILLE, ...CONTAGEM, ...DANIELA, leaderLevel: "city",
    segments: [
      segment({
        assignmentId: "as-24706-a", vehicleId: "veh-va116", status: "confirmed",
        startDate: "2026-08-14", endDate: null,
        drivers: [driver("emp-9", "Rafael Souza Campos", "2026-08-14")],
      }),
    ],
  }),
  row({
    operationBrId: "br-24715",
    brCode: "BR0024715",
    brDescription: "Rota industrial",
    ...LAST_MILLE, ...CONTAGEM, ...DANIELA, leaderLevel: "city",
    segments: [
      segment({
        assignmentId: "as-24715-a", vehicleId: "veh-va125", status: "executed", source: "import",
        startDate: "2026-07-01", endDate: "2026-09-14",
        drivers: [driver("emp-10", "Renata Alves Moreira", "2026-07-01", "2026-09-14")],
      }),
      segment({
        assignmentId: "as-24715-b", vehicleId: "veh-fl145", status: "planned", source: "substitution",
        startDate: "2026-09-15", endDate: null,
        drivers: [driver("emp-10", "Renata Alves Moreira", "2026-09-15")],
      }),
    ],
  }),
  row({
    operationBrId: "br-24733",
    brCode: "BR0024733",
    brDescription: "Rota Eldorado",
    ...LAST_MILLE, ...CONTAGEM, ...DANIELA, leaderLevel: "city",
    segments: [],
  }),
  row({
    operationBrId: "br-25110",
    brCode: "BR0025110",
    brDescription: "Centro de Divinópolis",
    ...LAST_MILLE, ...DIVINOPOLIS, ...DANIELA, leaderLevel: "operation",
    segments: [
      segment({
        assignmentId: "as-25110-a", vehicleId: "veh-va131", status: "executed",
        startDate: "2026-06-01", endDate: "2026-09-10",
      }),
      segment({
        assignmentId: "as-25110-b", vehicleId: "veh-va151", status: "confirmed", source: "inversion",
        startDate: "2026-09-11", endDate: null,
        drivers: [driver("emp-11", "Thiago Henrique Moreira Castro", "2026-09-11")],
      }),
    ],
  }),
  row({
    operationBrId: "br-25118",
    brCode: "BR0025118",
    brDescription: "Bairro Niterói",
    ...LAST_MILLE, ...DIVINOPOLIS, ...DANIELA, leaderLevel: "operation",
    segments: [
      segment({
        assignmentId: "as-25118-a", vehicleId: "veh-va151", status: "executed",
        startDate: "2026-05-04", endDate: "2026-09-10",
        drivers: [driver("emp-11", "Thiago Henrique Moreira Castro", "2026-05-04", "2026-09-10")],
      }),
      segment({
        assignmentId: "as-25118-b", vehicleId: "veh-va131", status: "confirmed", source: "inversion",
        startDate: "2026-09-11", endDate: null,
      }),
    ],
  }),
  // ------------------------------------ Last Mille MG · Walace (exceção)
  row({
    operationBrId: "br-24901",
    brCode: "BR0024901",
    brDescription: "Rota Ressaca",
    ...LAST_MILLE, ...CONTAGEM, ...WALACE, leaderLevel: "br",
    segments: [
      segment({
        assignmentId: "as-24901-a", vehicleId: "veh-va155", status: "planned",
        startDate: "2026-09-01", endDate: "2026-09-20",
        drivers: [driver("emp-12", "Carlos Eduardo Nogueira Silva", "2026-09-01", "2026-09-20")],
      }),
    ],
  }),
  // ------------------------------------ Redespacho - Belém · Marcos
  row({
    operationBrId: "br-bel-1",
    brCode: "Redespacho Belem/Pa_1",
    brDescription: null,
    ...BELEM_OP, ...BELEM, ...MARCOS, leaderLevel: "operation",
    segments: [
      segment({
        assignmentId: "as-bel-1-a", vehicleId: "veh-va163", status: "confirmed",
        startDate: "2026-06-01", endDate: null,
      }),
    ],
  }),
  row({
    operationBrId: "br-bel-2",
    brCode: "Redespacho Belem/Pa_2",
    brDescription: "Distrito de Icoaraci",
    ...BELEM_OP, ...BELEM, ...MARCOS, leaderLevel: "operation",
    segments: [
      segment({
        assignmentId: "as-bel-2-a", vehicleId: "veh-va170", status: "planned",
        startDate: "2026-09-01", endDate: "2026-10-15",
      }),
    ],
  }),
];

export const PLANNER_MATRIX: PlannerMatrix = {
  competence: "2026-09",
  anchorDate: PLANNER_TODAY,
  today: PLANNER_TODAY,
  daysInMonth: DAYS,
  total: ROWS.length,
  rows: ROWS,
};

/** Um veículo do catálogo no formato que a busca devolve (o conflito é calculado por quem chama). */
export function asEligible(v: (typeof PLANNER_VEHICLES)[number]): EligibleVehicle {
  return {
    vehicleId: v.vehicleId,
    fleetCode: v.fleetCode,
    licensePlate: v.licensePlate,
    makeName: v.makeName,
    modelName: v.modelName,
    vehicleType: TYPE_NAME[v.vehicleTypeId] ?? null,
    hasConflict: false,
    conflictBr: null,
  };
}
