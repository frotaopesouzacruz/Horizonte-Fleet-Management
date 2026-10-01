/**
 * Fidelização — competência mensal contínua (Frota × BR × Local).
 *
 * Tipos e tradutores puros, sem import de servidor: a página (servidor), a
 * Central (cliente) e as prévias de desenvolvimento usam exatamente estes. As
 * regras vivem no banco (migration 20261002106000_fidelization_competences);
 * aqui só se traduzem nomes de coluna e se repete, palavra por palavra, o rótulo
 * de origem de `private.fidelization_origin_label`.
 */

import type { Competence } from "./competence";

/* ------------------------------------------------------------------ apoio */

/** Janeiro/2026: antes disso a competência é histórica (2024/2025, só consulta). */
export const OPERATIONAL_START: Competence = { year: 2026, month: 1 };

const indexOf = ({ year, month }: Competence) => year * 12 + (month - 1);

/** A competência `delta` meses depois (ou antes, com delta negativo). */
export function shiftCompetence(competence: Competence, delta: number): Competence {
  const index = indexOf(competence) + delta;
  return { year: Math.floor(index / 12), month: (index % 12) + 1 };
}

export function compareCompetence(a: Competence, b: Competence): number {
  return indexOf(a) - indexOf(b);
}

export function isHistoricalCompetence(competence: Competence): boolean {
  return compareCompetence(competence, OPERATIONAL_START) < 0;
}

/** "2026-10" */
export function competenceKey({ year, month }: Competence): string {
  return `${year}-${String(month).padStart(2, "0")}`;
}

/** "2026-10" → { 2026, 10 }; qualquer outra coisa → null. */
export function parseCompetenceKey(value: string | null | undefined): Competence | null {
  const match = /^(\d{4})-(\d{2})$/.exec(value ?? "");
  if (!match) return null;
  const month = Number(match[2]);
  return month >= 1 && month <= 12 ? { year: Number(match[1]), month } : null;
}

/** Último dia da competência, "dd/mm/aaaa" — a data de referência da replicação. */
export function lastDayLabel({ year, month }: Competence): string {
  const day = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${String(day).padStart(2, "0")}/${String(month).padStart(2, "0")}/${year}`;
}

/**
 * A origem de um vínculo, por extenso (requisito: Importação histórica,
 * Replicação automática, Replicação manual, Alteração manual). Replicação
 * automática e manual dividem `source = 'replication'`; quem gravou decide —
 * a rotina do sistema não tem usuário. Mesmo critério de
 * `private.fidelization_origin_label` no banco.
 */
export function fidelizationOriginLabel(source: string, createdBy: string | null | undefined): string {
  if (source === "import") return "Importação histórica";
  if (source === "replication") return createdBy ? "Replicação manual" : "Replicação automática";
  return "Alteração manual";
}

/* ------------------------------------------------------------- resumo */

export type CompetenceKind = "historical" | "operational";
export type CompetenceSituation = "historical" | "not_created" | "closed" | "in_progress" | "planned";
export type CompetenceOrigin = "historical_import" | "auto_replication" | "manual_replication" | "manual";

export interface CompetenceCounts {
  plates: number;
  brs: number;
  locais: number;
  operations: number;
  positions: number;
}

export interface CompetenceRunCounts {
  new: number;
  kept: number;
  conflicts: number;
  skipped: number;
}

export interface CompetenceLastRun {
  mode: string | null;
  at: string | null;
  vehicles: CompetenceRunCounts | null;
}

export interface FidelizationCompetenceSummary {
  /** "2026-10" */
  competence: string;
  year: number;
  month: number;
  /** "Outubro/2026" */
  label: string;
  kind: CompetenceKind;
  /** O cabeçalho da competência existe (foi criada pela rotina, pela tela ou pela importação). */
  exists: boolean;
  situation: CompetenceSituation;
  situationLabel: string;
  origin: CompetenceOrigin | null;
  originLabel: string | null;
  sourceCompetence: string | null;
  sourceLabel: string | null;
  /** Último dia da competência de origem ("2026-09-30"). */
  referenceDate: string | null;
  runs: number;
  lastRun: CompetenceLastRun | null;
  createdAt: string | null;
  createdByName: string | null;
  counts: CompetenceCounts;
  lastUpdatedAt: string | null;
  lastUpdatedByName: string | null;
  /** O mês corrente no fuso da operação ("2026-10"). */
  currentCompetence: string;
  previous: {
    competence: string;
    label: string;
    kind: CompetenceKind;
    exists: boolean;
    referenceDate: string | null;
    platesFound: number;
  };
}

const str = (v: unknown): string | null => (v === null || v === undefined || v === "" ? null : String(v));
const num = (v: unknown): number => Number(v ?? 0) || 0;
const obj = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

function runCounts(v: unknown): CompetenceRunCounts | null {
  if (!v || typeof v !== "object") return null;
  const c = obj(v);
  return { new: num(c.new), kept: num(c.kept), conflicts: num(c.conflicts), skipped: num(c.skipped) };
}

export function mapCompetenceSummary(raw: unknown): FidelizationCompetenceSummary {
  const d = obj(raw);
  const counts = obj(d.counts);
  const previous = obj(d.previous);
  const lastRun = d.last_run && typeof d.last_run === "object" ? obj(d.last_run) : null;
  return {
    competence: String(d.competence ?? ""),
    year: num(d.year),
    month: num(d.month),
    label: String(d.label ?? ""),
    kind: d.kind === "historical" ? "historical" : "operational",
    exists: Boolean(d.exists),
    situation: (str(d.situation) ?? "not_created") as CompetenceSituation,
    situationLabel: String(d.situation_label ?? ""),
    origin: (str(d.origin) as CompetenceOrigin | null) ?? null,
    originLabel: str(d.origin_label),
    sourceCompetence: str(d.source_competence),
    sourceLabel: str(d.source_label),
    referenceDate: str(d.reference_date),
    runs: num(d.runs),
    lastRun: lastRun
      ? { mode: str(lastRun.mode), at: str(lastRun.at), vehicles: runCounts(lastRun.vehicles) }
      : null,
    createdAt: str(d.created_at),
    createdByName: str(d.created_by_name),
    counts: {
      plates: num(counts.plates),
      brs: num(counts.brs),
      locais: num(counts.locais),
      operations: num(counts.operations),
      positions: num(counts.positions),
    },
    lastUpdatedAt: str(d.last_updated_at),
    lastUpdatedByName: str(d.last_updated_by_name),
    currentCompetence: String(d.current_competence ?? ""),
    previous: {
      competence: String(previous.competence ?? ""),
      label: String(previous.label ?? ""),
      kind: previous.kind === "historical" ? "historical" : "operational",
      exists: Boolean(previous.exists),
      referenceDate: str(previous.reference_date),
      platesFound: num(previous.plates_found),
    },
  };
}

/* -------------------------------------------------- histórico consolidado */

export interface FidelizationHistoryRow {
  id: string;
  operationId: string;
  operationName: string;
  stateUf: string;
  cityId: number;
  cityName: string;
  /** BR do cadastro, quando o código do arquivo foi reconhecido. */
  brId: string | null;
  /** Código da BR como veio do arquivo; `null` quando não há BR (2024) — a tela escreve "—". */
  brCode: string | null;
  vehicleId: string;
  licensePlate: string | null;
  fleetCode: string | null;
  firstDay: string;
  lastDay: string;
  days: number;
}

export interface FidelizationHistoryRows {
  competence: string;
  label: string;
  kind: CompetenceKind;
  /** A competência histórica foi carregada (tem cabeçalho). */
  loaded: boolean;
  /** Alguma posição do mês tem BR — 2025 agrupa por BR; 2024 não tem BR. */
  hasBr: boolean;
  total: number;
  totals: { plates: number; brs: number; locais: number; operations: number; withoutBr: number };
  rows: FidelizationHistoryRow[];
  options: {
    operations: { id: string; name: string }[];
    cities: { id: number; name: string; uf: string; operationId: string }[];
    brs: { code: string; id: string | null; operationId: string; cityId: number }[];
  };
}

const arr = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? (v as Record<string, unknown>[]) : []);

export function mapHistoryRows(raw: unknown): FidelizationHistoryRows {
  const d = obj(raw);
  const totals = obj(d.totals);
  const options = obj(d.options);
  return {
    competence: String(d.competence ?? ""),
    label: String(d.label ?? ""),
    kind: d.kind === "operational" ? "operational" : "historical",
    loaded: Boolean(d.loaded),
    hasBr: Boolean(d.has_br),
    total: num(d.total),
    totals: {
      plates: num(totals.plates),
      brs: num(totals.brs),
      locais: num(totals.locais),
      operations: num(totals.operations),
      withoutBr: num(totals.without_br),
    },
    rows: arr(d.rows).map((r) => ({
      id: String(r.id),
      operationId: String(r.operation_id),
      operationName: String(r.operation_name ?? ""),
      stateUf: String(r.state_uf ?? "").trim(),
      cityId: num(r.city_id),
      cityName: String(r.city_name ?? ""),
      brId: str(r.br_id),
      brCode: str(r.br_code),
      vehicleId: String(r.vehicle_id),
      licensePlate: str(r.license_plate),
      fleetCode: str(r.fleet_code),
      firstDay: String(r.first_day ?? ""),
      lastDay: String(r.last_day ?? ""),
      days: num(r.days),
    })),
    options: {
      operations: arr(options.operations).map((o) => ({ id: String(o.id), name: String(o.name ?? "") })),
      cities: arr(options.cities).map((c) => ({
        id: num(c.id),
        name: String(c.name ?? ""),
        uf: String(c.uf ?? "").trim(),
        operationId: String(c.operation_id ?? ""),
      })),
      brs: arr(options.brs).map((b) => ({
        code: String(b.code ?? ""),
        id: str(b.id),
        operationId: String(b.operation_id ?? ""),
        cityId: num(b.city_id),
      })),
    },
  };
}

export interface FidelizationHistoryMonth {
  competence: string;
  month: number;
  label: string;
  loaded: boolean;
  plates: number;
  brs: number;
  locais: number;
  positions: number;
  /** Placas com mais de uma posição no mês ou com posição diferente da do mês anterior. */
  changes: number;
}

export interface FidelizationHistoryEvolution {
  year: number;
  months: FidelizationHistoryMonth[];
}

export function mapHistoryEvolution(raw: unknown): FidelizationHistoryEvolution {
  const d = obj(raw);
  return {
    year: num(d.year),
    months: arr(d.months).map((m) => ({
      competence: String(m.competence ?? ""),
      month: num(m.month),
      label: String(m.label ?? ""),
      loaded: Boolean(m.loaded),
      plates: num(m.plates),
      brs: num(m.brs),
      locais: num(m.locais),
      positions: num(m.positions),
      changes: num(m.changes),
    })),
  };
}

/* ---------------------------------------------------------------- formatos */

/** "2026-09-30" → "30/09/2026" (data pura, sem fuso). */
export function formatDateBr(value: string | null | undefined): string {
  if (!value) return "—";
  const [y, m, d] = value.slice(0, 10).split("-");
  return d ? `${d}/${m}/${y}` : value;
}

/** Instante → "01/10/2026 00:07", sempre no horário de São Paulo (servidor e navegador iguais). */
export function formatDateTimeBr(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date
    .toLocaleString("pt-BR", {
      timeZone: "America/Sao_Paulo",
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    })
    .replace(",", "");
}
