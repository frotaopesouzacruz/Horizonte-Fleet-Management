import type { FidelizationReplicationPreview, FidelizationReplicationRow } from "@/lib/governance/actions";
import type { Competence } from "@/lib/governance/competence";
import {
  competenceKey,
  isHistoricalCompetence,
  shiftCompetence,
  type FidelizationCompetenceSummary,
  type FidelizationHistoryEvolution,
  type FidelizationHistoryRow,
  type FidelizationHistoryRows,
} from "@/lib/governance/fidelization-competence";
import { MATRIX } from "./fixture-central";

/**
 * Competência mensal contínua — dados fixos para as prévias (sem sessão).
 *
 * A história: Setembro/2026 veio da importação de 2026 (Encerrada); a rotina
 * automática criou Outubro/2026 em 01/10 00:07 a partir de 30/09 (Em
 * andamento); Novembro/2026 ainda não foi criada. 2024 (sem BR) e 2025 (com
 * BR) são o histórico consolidado, só consulta.
 */

const MONTHS = [
  "", "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];
const label = ({ year, month }: Competence) => `${MONTHS[month]}/${year}`;
const lastDayIso = ({ year, month }: Competence) => new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);

/** As contagens do mês da fixture, tiradas da própria matriz do Planner. */
const septemberCounts = (() => {
  const withVehicle = MATRIX.rows.filter((r) => r.segments.length > 0);
  const plates = new Set(withVehicle.flatMap((r) => r.segments.map((s) => s.vehicleId))).size;
  const locais = new Set(withVehicle.map((r) => `${r.operationId}:${r.cityId}`)).size;
  const operations = new Set(withVehicle.map((r) => r.operationId)).size;
  return { plates, brs: withVehicle.length, locais, operations, positions: plates };
})();

const lastDayPlates = MATRIX.rows.filter((r) => r.segments.some((s) => s.lastDay >= 30)).length;

export const CURRENT_COMPETENCE: Competence = { year: 2026, month: 10 };

function base(competence: Competence): FidelizationCompetenceSummary {
  const previous = shiftCompetence(competence, -1);
  return {
    competence: competenceKey(competence),
    year: competence.year,
    month: competence.month,
    label: label(competence),
    kind: isHistoricalCompetence(competence) ? "historical" : "operational",
    exists: false,
    situation: "not_created",
    situationLabel: "Não criada",
    origin: null,
    originLabel: null,
    sourceCompetence: null,
    sourceLabel: null,
    referenceDate: null,
    runs: 0,
    lastRun: null,
    createdAt: null,
    createdByName: null,
    counts: { plates: 0, brs: 0, locais: 0, operations: 0, positions: 0 },
    lastUpdatedAt: null,
    lastUpdatedByName: null,
    currentCompetence: competenceKey(CURRENT_COMPETENCE),
    previous: {
      competence: competenceKey(previous),
      label: label(previous),
      kind: isHistoricalCompetence(previous) ? "historical" : "operational",
      exists: !isHistoricalCompetence(previous),
      referenceDate: lastDayIso(previous),
      platesFound: 0,
    },
  };
}

/** O resumo de qualquer competência, coerente com a história acima. */
export function summaryFor(competence: Competence): FidelizationCompetenceSummary {
  const s = base(competence);
  const key = competenceKey(competence);

  if (isHistoricalCompetence(competence)) {
    const rows = historyRowsFor(competence);
    const has = rows.rows.length > 0;
    return {
      ...s,
      exists: has,
      situation: "historical",
      situationLabel: "Histórica (consulta)",
      origin: has ? "historical_import" : null,
      originLabel: has ? "Importação histórica" : null,
      counts: {
        plates: rows.totals.plates,
        brs: rows.totals.brs,
        locais: rows.totals.locais,
        operations: rows.totals.operations,
        positions: rows.rows.length,
      },
      lastUpdatedAt: has ? "2026-10-02T14:20:00Z" : null,
      lastUpdatedByName: has ? "Gabriel Albino" : null,
      previous: { ...s.previous, platesFound: 0 },
    };
  }

  if (key < "2026-10") {
    return {
      ...s,
      exists: true,
      situation: "closed",
      situationLabel: "Encerrada",
      origin: "historical_import",
      originLabel: "Importação histórica",
      counts: key === "2026-09" ? septemberCounts : { ...septemberCounts, plates: septemberCounts.plates - 1 },
      lastUpdatedAt: "2026-09-30T19:42:00Z",
      lastUpdatedByName: "Ana Ribeiro",
      previous: { ...s.previous, platesFound: lastDayPlates },
    };
  }

  if (key === "2026-10") {
    return {
      ...s,
      exists: true,
      situation: "in_progress",
      situationLabel: "Em andamento",
      origin: "auto_replication",
      originLabel: "Replicação automática",
      sourceCompetence: "2026-09",
      sourceLabel: "Setembro/2026",
      referenceDate: "2026-09-30",
      runs: 1,
      lastRun: { mode: "auto", at: "2026-10-01T03:07:00Z", vehicles: { new: lastDayPlates, kept: 0, conflicts: 0, skipped: 0 } },
      createdAt: "2026-10-01T03:07:00Z",
      createdByName: null,
      counts: { ...septemberCounts, plates: lastDayPlates, brs: lastDayPlates, positions: lastDayPlates },
      lastUpdatedAt: "2026-10-01T03:07:00Z",
      lastUpdatedByName: null,
      previous: { ...s.previous, platesFound: lastDayPlates },
    };
  }

  // Novembro em diante: ainda não criada; a posição de partida é o último dia do mês anterior.
  return { ...s, previous: { ...s.previous, platesFound: key === "2026-11" ? lastDayPlates : 0 } };
}

/* -------------------------------------------------- histórico consolidado */

const OPS = {
  lmmg: { id: "op-1", name: "Last Mille MG" },
  belem: { id: "op-2", name: "Redespacho - Belém" },
  bh: { id: "op-3", name: "Transferência BH" },
};
const CITIES = {
  contagem: { id: 3118601, name: "Contagem", uf: "MG" },
  betim: { id: 3106705, name: "Betim", uf: "MG" },
  bh: { id: 3106200, name: "Belo Horizonte", uf: "MG" },
  belem: { id: 1501402, name: "Belém", uf: "PA" },
  ananindeua: { id: 1500800, name: "Ananindeua", uf: "PA" },
};

type Op = (typeof OPS)[keyof typeof OPS];
type City = (typeof CITIES)[keyof typeof CITIES];

function position(
  competence: Competence,
  i: number,
  op: Op,
  city: City,
  plate: string,
  fleet: string,
  br: string | null,
  first = 1,
  last?: number,
): FidelizationHistoryRow {
  const end = last ?? Number(lastDayIso(competence).slice(8));
  const mm = String(competence.month).padStart(2, "0");
  return {
    id: `h-${competenceKey(competence)}-${i}`,
    operationId: op.id,
    operationName: op.name,
    stateUf: city.uf,
    cityId: city.id,
    cityName: city.name,
    brId: br && !br.startsWith("BR99") ? `br-${br}` : null,
    brCode: br,
    vehicleId: `veh-${plate}`,
    licensePlate: plate,
    fleetCode: fleet,
    firstDay: `${competence.year}-${mm}-${String(first).padStart(2, "0")}`,
    lastDay: `${competence.year}-${mm}-${String(end).padStart(2, "0")}`,
    days: end - first + 1,
  };
}

/** 2024: sem BR — Operação → Cidade → Placas. */
function rows2024(c: Competence): FidelizationHistoryRow[] {
  let i = 0;
  const p = (op: Op, city: City, plate: string, fleet: string, first?: number, last?: number) =>
    position(c, ++i, op, city, plate, fleet, null, first, last);
  return [
    p(OPS.lmmg, CITIES.contagem, "RTA1A11", "VA101"),
    p(OPS.lmmg, CITIES.contagem, "RTB2B22", "VA102"),
    p(OPS.lmmg, CITIES.contagem, "RTC3C33", "VA103", 1, 14),
    p(OPS.lmmg, CITIES.betim, "RTC3C33", "VA103", 15),
    p(OPS.lmmg, CITIES.betim, "RTD4D44", "VA104"),
    p(OPS.lmmg, CITIES.bh, "RTE5E55", "VA105"),
    p(OPS.belem, CITIES.belem, "QPA1A11", "TR201"),
    p(OPS.belem, CITIES.belem, "QPB2B22", "TR202"),
    p(OPS.belem, CITIES.ananindeua, "QPC3C33", "TR203"),
  ];
}

/** 2025: com BR — Operação → BR → Local/Cidade → Placas (uma BR que o cadastro não reconheceu). */
function rows2025(c: Competence): FidelizationHistoryRow[] {
  let i = 0;
  const p = (op: Op, city: City, plate: string, fleet: string, br: string | null, first?: number, last?: number) =>
    position(c, ++i, op, city, plate, fleet, br, first, last);
  return [
    p(OPS.lmmg, CITIES.contagem, "RTA1A11", "VA101", "BR0024701"),
    p(OPS.lmmg, CITIES.contagem, "RTB2B22", "VA102", "BR0024702", 1, 11),
    p(OPS.lmmg, CITIES.contagem, "RTF6F66", "VA106", "BR0024702", 12),
    p(OPS.lmmg, CITIES.contagem, "RTC3C33", "VA103", "BR0024706"),
    p(OPS.lmmg, CITIES.betim, "RTD4D44", "VA104", "BR0031002"),
    p(OPS.lmmg, CITIES.betim, "RTG7G77", "VA107", null),
    p(OPS.bh, CITIES.bh, "RTE5E55", "VA105", "BR0040110"),
    p(OPS.belem, CITIES.belem, "QPA1A11", "TR201", "BR0024901"),
    p(OPS.belem, CITIES.belem, "QPB2B22", "TR202", "BR9900001"),
    p(OPS.belem, CITIES.ananindeua, "QPC3C33", "TR203", "BR0025110"),
  ];
}

export function historyRowsFor(competence: Competence): FidelizationHistoryRows {
  const loaded = isHistoricalCompetence(competence) && !(competence.year === 2024 && competence.month < 3);
  const rows = !loaded ? [] : competence.year === 2024 ? rows2024(competence) : rows2025(competence);
  const brs = rows.filter((r) => r.brCode !== null);
  return {
    competence: competenceKey(competence),
    label: label(competence),
    kind: "historical",
    loaded,
    hasBr: brs.length > 0,
    total: rows.length,
    totals: {
      plates: new Set(rows.map((r) => r.vehicleId)).size,
      brs: new Set(brs.map((r) => `${r.operationId}:${r.cityId}:${r.brCode}`)).size,
      locais: new Set(rows.map((r) => `${r.operationId}:${r.cityId}`)).size,
      operations: new Set(rows.map((r) => r.operationId)).size,
      withoutBr: rows.length - brs.length,
    },
    rows,
    options: {
      operations: [...new Map(rows.map((r) => [r.operationId, { id: r.operationId, name: r.operationName }])).values()],
      cities: [
        ...new Map(
          rows.map((r) => [`${r.operationId}:${r.cityId}`, { id: r.cityId, name: r.cityName, uf: r.stateUf, operationId: r.operationId }]),
        ).values(),
      ],
      brs: [
        ...new Map(
          brs.map((r) => [`${r.operationId}:${r.cityId}:${r.brCode}`, { code: r.brCode!, id: r.brId, operationId: r.operationId, cityId: r.cityId }]),
        ).values(),
      ],
    },
  };
}

export function historyEvolutionFor(year: number): FidelizationHistoryEvolution {
  const plates2024 = [0, 0, 9, 9, 10, 10, 11, 11, 11, 12, 12, 12];
  const plates2025 = [12, 12, 11, 12, 10, 11, 11, 12, 12, 13, 13, 13];
  const plates = year === 2024 ? plates2024 : plates2025;
  return {
    year,
    months: plates.map((n, index) => {
      // Os meses que a prévia abre (03/2024 e 05/2025) batem com as linhas da fixture.
      const shown = (year === 2024 && index + 1 === 3) || (year === 2025 && index + 1 === 5);
      const rows = shown ? historyRowsFor({ year, month: index + 1 }) : null;
      return {
        competence: `${year}-${String(index + 1).padStart(2, "0")}`,
        month: index + 1,
        label: `${MONTHS[index + 1]}/${year}`,
        loaded: n > 0,
        plates: rows ? rows.totals.plates : n,
        brs: rows ? rows.totals.brs : year === 2024 ? 0 : Math.max(0, n - 1),
        locais: rows ? rows.totals.locais : n > 0 ? 5 : 0,
        positions: rows ? rows.rows.length : n > 0 ? n + (index % 3) : 0,
        changes: rows ? (year === 2024 ? 1 : 1) : n > 0 ? (index * 7) % 4 : 0,
      };
    }),
  };
}

/* -------------------------------------------------- replicação (prévia) */

function replicationRows(alreadyCreated: boolean): FidelizationReplicationRow[] {
  const rows = MATRIX.rows
    .filter((r) => r.segments.some((s) => s.lastDay >= 30))
    .map((r): FidelizationReplicationRow => {
      const s = r.segments.find((x) => x.lastDay >= 30)!;
      return {
        brId: r.operationBrId,
        brCode: r.brCode,
        vehicleId: s.vehicleId,
        fleetCode: s.fleetCode,
        licensePlate: s.licensePlate,
        status: alreadyCreated ? "kept" : "new",
        note: alreadyCreated ? "Já existe na competência de destino" : null,
        conflictKind: null,
        operationId: r.operationId,
        driverEmployeeId: null,
        driverName: null,
        driverStatus: null,
        driverNote: null,
      };
    });
  if (alreadyCreated && rows.length >= 4) {
    rows[0] = { ...rows[0], status: "new", note: null };
    rows[1] = { ...rows[1], status: "new", note: null };
    rows[2] = { ...rows[2], status: "conflict", conflictKind: "vehicle_elsewhere", note: "Veículo já planejado em outra BR no destino (BR BR0031009)" };
    rows[3] = { ...rows[3], status: "skipped_inactive_vehicle", note: "Veículo inativo ou arquivado" };
  }
  return rows;
}

/** Setembro → Outubro (já criada pela rotina automática) ou Outubro → Novembro (ainda não criada). */
export function replicationPreviewFor(from: Competence, to: Competence, dryRun: boolean): FidelizationReplicationPreview {
  const alreadyCreated = competenceKey(to) <= "2026-10";
  const rows = replicationRows(alreadyCreated);
  const count = (status: string) => rows.filter((r) => (status === "skipped" ? r.status.startsWith("skipped") : r.status === status)).length;
  return {
    dryRun,
    from: competenceKey(from),
    to: competenceKey(to),
    fromLabel: label(from),
    toLabel: label(to),
    referenceDate: lastDayIso(from),
    platesFound: rows.length,
    alreadyCreated,
    destination: alreadyCreated
      ? { origin: "auto_replication", originLabel: "Replicação automática", createdAt: "2026-10-01T03:07:00Z", createdByName: null, runs: 1 }
      : null,
    status: competenceKey(to) === competenceKey(CURRENT_COMPETENCE) ? "confirmed" : "planned",
    vehicles: { new: count("new"), kept: count("kept"), conflicts: count("conflict"), skipped: count("skipped") },
    drivers: { new: 0, kept: 0, conflicts: 0, skipped: 0 },
    rows,
  };
}
