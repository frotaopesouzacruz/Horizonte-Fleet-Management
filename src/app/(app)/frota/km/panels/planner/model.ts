import type { KmPlannerCell, KmPlannerData, KmPlannerDay, KmPlannerRow } from "@/lib/km/planner";
import { fmt1, KM_STATUS, kmStatusLabel, formatDate, weekdayShort, type KmReadingStatus } from "@/lib/km/types";

/**
 * Planner mês/dia — apresentação. Nada aqui calcula KM, status ou cobertura:
 * só classifica o que a rotina devolveu para pintar, ordenar, agrupar e
 * descrever (tooltip).
 */

export type PlannerMode = "compacto" | "detalhado";
export type PlannerSort = "local" | "placa" | "km_desc" | "km_asc" | "leituras_asc";
export type PlannerExtraColumn = "operacao" | "lideranca";

/** Parâmetros de URL próprios da aba. */
export const PLANNER_PARAM = { mode: "modo", columns: "colunas", sort: "ordem", pin: "fixar" } as const;

export const PLANNER_SORT_LABEL: Record<PlannerSort, string> = {
  local: "Local e BR (padrão)",
  placa: "Placa (A–Z)",
  km_desc: "Maior KM no mês",
  km_asc: "Menor KM no mês",
  leituras_asc: "Menos dias com leitura",
};

export const PLANNER_EXTRA_LABEL: Record<PlannerExtraColumn, string> = {
  operacao: "Tipo de operação",
  lideranca: "Liderança",
};

export function parsePlannerMode(v: string | undefined): PlannerMode {
  return v === "detalhado" ? "detalhado" : "compacto";
}
export function parsePlannerSort(v: string | undefined): PlannerSort {
  return v && Object.prototype.hasOwnProperty.call(PLANNER_SORT_LABEL, v) ? (v as PlannerSort) : "local";
}
export function parsePlannerColumns(v: string | undefined): PlannerExtraColumn[] {
  const set = new Set((v ?? "").split(",").map((s) => s.trim()));
  return (["operacao", "lideranca"] as const).filter((c) => set.has(c));
}

// ---------------------------------------------------------------------------
// Situação do veículo (cadastro)
// ---------------------------------------------------------------------------
const VEHICLE_STATUS: Record<string, string> = {
  active: "Ativo",
  inactive: "Inativo",
  maintenance: "Em manutenção",
  sold: "Vendido",
  decommissioned: "Desmobilizado",
};
export const vehicleStatusLabel = (s: string | null | undefined) => (s ? (VEHICLE_STATUS[s] ?? s) : "—");

// ---------------------------------------------------------------------------
// Células e mapa de calor
// ---------------------------------------------------------------------------
export type HeatKey =
  | "no_movement"
  | "b1"
  | "b2"
  | "b3"
  | "b4"
  | "b5"
  | "no_reading"
  | "inconsistent"
  | "future"
  | "out_of_filter";

/** Hachura do futuro (token de gráfico, sem cor fixa). */
const HATCH = "bg-[image:repeating-linear-gradient(135deg,var(--chart-future)_0_1px,transparent_1px_6px)]";

/** Classes de fundo/texto de cada faixa. As mesmas na legenda e na grade. */
export const HEAT_CLASS: Record<HeatKey, string> = {
  no_movement: "bg-neutral-soft text-fg-muted",
  // Rampa de intensidade oficial (--heat-1…6); o texto mantém ≥ 4,5:1 nos dois temas.
  b1: "bg-heat-1 text-fg",
  b2: "bg-heat-2 text-fg",
  b3: "bg-heat-3 text-fg",
  b4: "bg-heat-4 text-fg",
  b5: "bg-heat-6 font-semibold text-heat-strong-fg",
  no_reading: "text-fg-subtle",
  inconsistent: "bg-heat-danger font-medium text-heat-danger-fg",
  future: HATCH,
  out_of_filter: "italic text-fg-muted",
};

export const HEAT_LEGEND: { key: HeatKey; label: string; sample: string }[] = [
  { key: "no_movement", label: "Sem movimento", sample: "0,0" },
  { key: "b1", label: "Até 50 km", sample: "32,4" },
  { key: "b2", label: "50–100 km", sample: "78,1" },
  { key: "b3", label: "100–200 km", sample: "154,0" },
  { key: "b4", label: "200–400 km", sample: "286,5" },
  { key: "b5", label: "400 km ou mais", sample: "512,9" },
  { key: "no_reading", label: "Sem leitura (não é 0 km)", sample: "—" },
  { key: "inconsistent", label: "Inconsistente (fora dos totais)", sample: "inc." },
  { key: "out_of_filter", label: "Fora do filtro no dia", sample: "12,0" },
  { key: "future", label: "Dia futuro", sample: "" },
];

/** Marcadores visíveis das situações que contam KM mas pedem atenção (cor nunca sozinha). */
export const STATUS_MARK: Partial<Record<KmReadingStatus, string>> = {
  high_mileage: "▲",
  km_divergence: "≠",
  pending_review: "?",
};

export interface CellView {
  heat: HeatKey;
  /** Texto do KM (compacto e coluna KM do detalhado). */
  text: string;
  mark: string | null;
  start: string;
  end: string;
}

function band(km: number): HeatKey {
  if (km < 50) return "b1";
  if (km < 100) return "b2";
  if (km < 200) return "b3";
  if (km < 400) return "b4";
  return "b5";
}

const odo = (v: number | null) => (v == null ? "—" : fmt1(v));
const EMPTY_CELL: KmPlannerCell = ["no_reading", null, null, null];

/** Classificação de uma célula para exibição (sem recalcular nada). */
export function cellView(cell: KmPlannerCell | undefined): CellView {
  const [status, start, end, km] = cell ?? EMPTY_CELL;
  if (status === "future") return { heat: "future", text: "", mark: null, start: "", end: "" };
  if (status === "out_of_filter") {
    return {
      heat: "out_of_filter",
      text: km == null ? "" : fmt1(km),
      mark: null,
      start: start == null ? "" : fmt1(start),
      end: end == null ? "" : fmt1(end),
    };
  }
  if (status === "no_reading") return { heat: "no_reading", text: "—", mark: null, start: odo(start), end: odo(end) };
  if (!countsCell(cell) || km == null) return { heat: "inconsistent", text: "inc.", mark: null, start: odo(start), end: odo(end) };
  return {
    heat: status === "no_movement" ? "no_movement" : band(km),
    text: fmt1(km),
    mark: STATUS_MARK[status as KmReadingStatus] ?? null,
    start: odo(start),
    end: odo(end),
  };
}

/** Tooltip da célula: situação (catálogo), hodômetros e KM. Montado sob demanda (passar o cursor). */
export function cellTitle(cell: KmPlannerCell | undefined, day: KmPlannerDay, plate: string): string {
  const [status, start, end, km] = cell ?? EMPTY_CELL;
  const head = `${plate} · ${formatDate(day.date)} (${weekdayShort(day.dow)})`;
  if (status === "future") return `${head}\nDia futuro — sem resultado`;
  if (status === "out_of_filter") {
    return `${head}\nFora do filtro neste dia (outro contexto ou situação) — não entra nos totais${
      km == null ? "" : `\nKM: ${fmt1(km)}`
    }`;
  }
  const lines = [head, `Situação: ${kmStatusLabel(status)}`, `Hodômetro inicial: ${odo(start)}`, `Hodômetro final: ${odo(end)}`];
  if (status === "no_reading") lines.push("KM: sem leitura (não é 0 km)");
  else if (!countsCell(cell) || km == null) lines.push("KM: não entra nos totais");
  else lines.push(`KM: ${fmt1(km)}`);
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Dias
// ---------------------------------------------------------------------------
export interface DayMeta {
  day: KmPlannerDay;
  dd: string;
  weekday: string;
  weekend: boolean;
  future: boolean;
  /** Nenhuma leitura no dia (e não é futuro): total do dia é "—", nunca 0. */
  noReading: boolean;
  label: string;
}

export function dayMetas(data: KmPlannerData): DayMeta[] {
  const today = data.period.today;
  return data.days.map((day, i) => {
    const future = Boolean(today) && day.date > today;
    const readings = data.dayReadings[i];
    return {
      day,
      dd: day.date.slice(8, 10),
      weekday: weekdayShort(day.dow),
      weekend: day.dow >= 6,
      future,
      noReading: !future && (readings ?? 0) === 0,
      label: `${formatDate(day.date)}, ${weekdayShort(day.dow)}`,
    };
  });
}

/**
 * Valor agregado de um dia vindo da rotina: futuro em branco; sem nenhuma
 * leitura que conte (no dia, ou no conjunto quando `present` é informado) "—".
 */
export function dayValue(meta: DayMeta, value: number | null | undefined, present = true): string {
  if (meta.future) return "";
  if (meta.noReading || !present) return "—";
  return fmt1(value ?? null);
}

/** A célula tem KM que conta nos totais (situação do catálogo + KM informado pela rotina). */
export const countsCell = (cell: KmPlannerCell | undefined): boolean =>
  Boolean(cell && KM_STATUS[cell[0] as KmReadingStatus]?.counts && cell[3] != null);

/**
 * Em quais dias um conjunto de frotas tem alguma leitura que conta. Serve só
 * para não exibir como 0 km (valor que a rotina completa com zero) o dia em
 * que não houve leitura nenhuma no conjunto.
 */
export function presence(rows: KmPlannerRow[], days: number): boolean[] {
  const out = Array.from({ length: days }, () => false);
  for (const r of rows) {
    for (let i = 0; i < days; i++) if (!out[i] && countsCell(r.cells[i])) out[i] = true;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Linhas: busca, ordenação, agrupamento
// ---------------------------------------------------------------------------
const norm = (s: string | null | undefined) => (s ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");

export function matchesSearch(row: KmPlannerRow, q: string): boolean {
  const n = norm(q);
  if (!n) return true;
  return norm(row.plate).includes(n) || norm(row.fleetCode).includes(n);
}

const collator = new Intl.Collator("pt-BR", { sensitivity: "base", numeric: true });

export function sortRows(rows: KmPlannerRow[], sort: PlannerSort): KmPlannerRow[] {
  if (sort === "local") return rows; // a rotina já devolve por Local → BR → placa
  const out = [...rows];
  const byPlate = (a: KmPlannerRow, b: KmPlannerRow) => collator.compare(a.plate ?? "", b.plate ?? "");
  // Sem leitura que conte nunca é "menor rodagem": vai para o fim nas duas ordens de KM.
  const kmCmp = (dir: 1 | -1) => (a: KmPlannerRow, b: KmPlannerRow) => {
    if (a.totalKm == null && b.totalKm == null) return byPlate(a, b);
    if (a.totalKm == null) return 1;
    if (b.totalKm == null) return -1;
    return dir * (a.totalKm - b.totalKm) || byPlate(a, b);
  };
  if (sort === "placa") out.sort(byPlate);
  else if (sort === "km_desc") out.sort(kmCmp(-1));
  else if (sort === "km_asc") out.sort(kmCmp(1));
  else out.sort((a, b) => a.readingDays - b.readingDays || byPlate(a, b));
  return out;
}

export interface RowGroup {
  key: string;
  label: string;
  rows: KmPlannerRow[];
}

/** Agrupa por Local mantendo a ordem da rotina (Local → BR → placa). */
export function groupByLocal(rows: KmPlannerRow[]): RowGroup[] {
  const groups: RowGroup[] = [];
  const index = new Map<string, RowGroup>();
  for (const row of rows) {
    const key = row.local ?? "";
    let g = index.get(key);
    if (!g) {
      g = { key: key || "__none__", label: row.local ?? "Sem local", rows: [] };
      index.set(key, g);
      groups.push(g);
    }
    g.rows.push(row);
  }
  return groups;
}
