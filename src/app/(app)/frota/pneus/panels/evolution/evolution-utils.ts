/**
 * Evolução dos indicadores: leitura do que o banco gravou em cada captura
 * (`tires_kpi_history`). Aqui só há apresentação — rótulo do período,
 * variação entre dois valores já gravados e a frase da agenda. Nenhum valor
 * é recalculado a partir da base: os números vêm prontos das capturas.
 */
import type { StatusTone } from "@/components/ui/status-badge";
import { fmtInt, fmtPct, formatStamp, type KpiPeriod, type KpiRun, type KpiSchedule } from "@/lib/tires/types";

export type KpiKind = "pct" | "qty";
export type Trend = "melhorando" | "piorando" | "estavel" | "neutro";

/** Abaixo disso (em pontos percentuais) a variação de um percentual é "estável". */
export const STABLE_PP = 0.5;

// ---------------------------------------------------------------------------
// Períodos
// ---------------------------------------------------------------------------
const MONTHS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const MONTHS_LONG = [
  "janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
];

/**
 * Rótulo do período: "2026-W41" → "S41/2026"; "2026-10" → "out/2026";
 * "2026-10-09" (agenda diária) → "09/10/2026". `short` tira o ano da semana
 * ("S41"), encurta o do mês ("out/26") e do dia ("09/10") — para eixos densos.
 */
export function periodLabel(key: string | null | undefined, short = false): string {
  if (!key) return "—";
  let m = key.match(/^(\d{4})-W(\d{1,2})$/);
  if (m) return short ? `S${m[2].padStart(2, "0")}` : `S${m[2].padStart(2, "0")}/${m[1]}`;
  m = key.match(/^(\d{4})-(\d{2})$/);
  if (m) {
    const mon = MONTHS[Number(m[2]) - 1] ?? m[2];
    return short ? `${mon}/${m[1].slice(2)}` : `${mon}/${m[1]}`;
  }
  m = key.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return short ? `${m[3]}/${m[2]}` : `${m[3]}/${m[2]}/${m[1]}`;
  return key;
}

/** O mesmo período por extenso, para leitor de tela e dica ("semana 41 de 2026"). */
export function periodSpoken(key: string | null | undefined): string {
  if (!key) return "sem período";
  let m = key.match(/^(\d{4})-W(\d{1,2})$/);
  if (m) return `semana ${Number(m[2])} de ${m[1]}`;
  m = key.match(/^(\d{4})-(\d{2})$/);
  if (m) return `${MONTHS_LONG[Number(m[2]) - 1] ?? m[2]} de ${m[1]}`;
  m = key.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return `dia ${m[3]}/${m[2]}/${m[1]}`;
  return key;
}

/**
 * Os dois períodos que o resumo compara (o banco usa as duas capturas
 * concluídas mais recentes; no mês, a última captura de cada mês).
 */
export function comparedPeriods(runs: KpiRun[], period: KpiPeriod): { current: string | null; previous: string | null } {
  const done = runs
    .filter((r) => r.status === "concluida")
    .sort((a, b) => b.competence.localeCompare(a.competence) || b.slotAt.localeCompare(a.slotAt));
  if (period === "semana") return { current: done[0]?.periodKey ?? null, previous: done[1]?.periodKey ?? null };
  const months: string[] = [];
  for (const r of done) {
    const k = r.competence.slice(0, 7);
    if (!months.includes(k)) months.push(k);
    if (months.length === 2) break;
  }
  return { current: months[0] ?? null, previous: months[1] ?? null };
}

// ---------------------------------------------------------------------------
// Variação e tendência
// ---------------------------------------------------------------------------
export interface Comparison {
  /** Atual − anterior (p.p. para percentual; unidades para quantidade). */
  delta: number | null;
  /** Variação relativa ao anterior, em %. null quando o anterior é zero. */
  relative: number | null;
  /** "neutro" também quando não há os dois valores (ver `comparable`). */
  trend: Trend;
  comparable: boolean;
}

const round2 = (v: number) => Math.round(v * 100) / 100;

/**
 * Tendência pelo sentido do indicador (`higherIsBetter`; null = volume, sem
 * julgamento): estável quando |Δ| < 0,5 p.p. (percentual) ou Δ = 0 (quantidade).
 */
export function compare(
  kind: KpiKind,
  higherIsBetter: boolean | null,
  current: number | null,
  previous: number | null,
  dbDelta?: number | null,
): Comparison {
  if (current == null || previous == null) return { delta: null, relative: null, trend: "neutro", comparable: false };
  const delta = round2(dbDelta ?? current - previous);
  const relative = previous === 0 ? null : round2((delta / Math.abs(previous)) * 100);
  if (higherIsBetter == null) return { delta, relative, trend: "neutro", comparable: true };
  const stable = kind === "pct" ? Math.abs(delta) < STABLE_PP : delta === 0;
  if (stable) return { delta, relative, trend: "estavel", comparable: true };
  const better = higherIsBetter ? delta > 0 : delta < 0;
  return { delta, relative, trend: better ? "melhorando" : "piorando", comparable: true };
}

// ---------------------------------------------------------------------------
// Formatação
// ---------------------------------------------------------------------------
const signed1 = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1, signDisplay: "exceptZero" });
const signed0 = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0, signDisplay: "exceptZero" });

export const fmtKpi = (kind: KpiKind, v: number | null | undefined) => (kind === "pct" ? fmtPct(v) : fmtInt(v));
/** "+1,2 p.p." / "-4" / "—". */
export const fmtDelta = (kind: KpiKind, d: number | null | undefined) =>
  d == null ? "—" : kind === "pct" ? `${signed1.format(d)} p.p.` : signed0.format(d);
export const fmtRelative = (r: number | null | undefined) => (r == null ? "—" : `${signed1.format(r)}%`);
/** Variação por extenso para leitor de tela. */
export function spokenDelta(kind: KpiKind, d: number | null | undefined): string {
  if (d == null) return "sem comparação";
  if (d === 0) return "sem variação";
  const abs = kind === "pct" ? `${signed1.format(Math.abs(d)).replace("+", "")} pontos percentuais` : fmtInt(Math.abs(d));
  return `${d > 0 ? "subiu" : "caiu"} ${abs}`;
}

// ---------------------------------------------------------------------------
// Agenda
// ---------------------------------------------------------------------------
export const DEFAULT_TZ = "America/Sao_Paulo";
export const WEEKDAY_SHORT = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];
export const WEEKDAY_LONG = ["domingo", "segunda-feira", "terça-feira", "quarta-feira", "quinta-feira", "sexta-feira", "sábado"];
export const FREQUENCY_LABEL: Record<KpiSchedule["frequency"], string> = { daily: "Diária", weekly: "Semanal", monthly: "Mensal" };

/** "22:00:00" → "22:00". */
export const hhmm = (t: string | null | undefined) => (t ? t.slice(0, 5) : "—");

/** "semanal, sexta 22:00 — America/Sao_Paulo". */
export function scheduleRule(s: Pick<KpiSchedule, "frequency" | "weekday" | "monthDay" | "runTime" | "timezone">): string {
  const time = hhmm(s.runTime);
  const when =
    s.frequency === "daily"
      ? `diária, ${time}`
      : s.frequency === "monthly"
        ? `mensal, dia ${s.monthDay} às ${time}`
        : `semanal, ${WEEKDAY_SHORT[s.weekday] ?? "—"} ${time}`;
  return `${when} — ${s.timezone || DEFAULT_TZ}`;
}

/** Agenda numa frase ("Próxima captura: sex., 09/10/2026, 22:00 (semanal, sexta 22:00 — America/Sao_Paulo)"). */
export function nextCaptureSentence(s: KpiSchedule | null | undefined): string {
  if (!s) return "Agenda dos indicadores ainda não configurada (Parâmetros › Agenda dos indicadores).";
  if (!s.isActive) return `Agenda pausada (${scheduleRule(s)}): nenhuma captura automática até ser reativada em Parâmetros › Agenda dos indicadores.`;
  return `Próxima captura: ${formatSlot(s.nextSlotAt, s.timezone)} (${scheduleRule(s)}).`;
}

/** Regra de leitura da série, igual em todo lugar. */
export const IMMUTABLE_RULE =
  "Cada captura é imutável: alterações posteriores da planilha não mudam a série; aparecem na próxima captura.";
export const MONTHLY_RULE = "Mês × mês usa a última captura semanal de cada mês.";

/** Data e hora no fuso da agenda ("sex., 09/10/2026, 22:00"). */
export function formatSlot(iso: string | null | undefined, timezone?: string | null, withWeekday = true): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  try {
    return new Intl.DateTimeFormat("pt-BR", {
      timeZone: timezone || DEFAULT_TZ,
      weekday: withWeekday ? "short" : undefined,
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(d);
  } catch {
    return formatStamp(iso);
  }
}

// ---------------------------------------------------------------------------
// Execuções
// ---------------------------------------------------------------------------
export const RUN_STATUS: Record<KpiRun["status"], { label: string; tone: StatusTone }> = {
  concluida: { label: "Concluída", tone: "success" },
  falhou: { label: "Falhou", tone: "danger" },
  ignorada: { label: "Ignorada", tone: "warning" },
  em_andamento: { label: "Em andamento", tone: "progress" },
};
export const RUN_KIND_LABEL: Record<KpiRun["periodKind"], string> = { dia: "Diária", semana: "Semanal", mes: "Mensal" };
