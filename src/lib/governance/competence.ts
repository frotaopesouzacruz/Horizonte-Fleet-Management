/**
 * Competence — the year/month a plan belongs to.
 *
 * Pure helpers, no server imports: the competence picker is a client component
 * and the pages are server components, and both need exactly these functions.
 * Keeping them here is what stops a second, slightly different implementation
 * from appearing on the client side.
 */

export interface Competence {
  year: number;
  month: number;
}

/** Indexed 1–12, so nothing has to remember the offset. */
export const MONTH_NAMES = [
  "", "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
] as const;

export function formatCompetence({ year, month }: Competence): string {
  return `${MONTH_NAMES[month] ?? month}/${year}`;
}

/**
 * The competence a screen opens on when the URL says nothing.
 *
 * Deliberately the current month and not "the last one with data": a planner
 * opening the screen on the 1st needs the empty month in front of them, which
 * is precisely the month they came to fill in.
 */
export function currentCompetence(now = new Date()): Competence {
  return { year: now.getFullYear(), month: now.getMonth() + 1 };
}

export function parseCompetence(
  year: string | undefined,
  month: string | undefined,
  fallback = currentCompetence(),
): Competence {
  const y = Number(year);
  const m = Number(month);
  const validYear = Number.isInteger(y) && y >= 2000 && y <= 2100;
  const validMonth = Number.isInteger(m) && m >= 1 && m <= 12;
  return {
    year: validYear ? y : fallback.year,
    month: validMonth ? m : fallback.month,
  };
}

/** First and last day of the competence, as ISO dates. */
export function monthStart({ year, month }: Competence): string {
  return `${year}-${String(month).padStart(2, "0")}-01`;
}

export function monthEnd({ year, month }: Competence): string {
  // Day 0 of the next month is the last day of this one, and it is right in
  // February and in leap years without a table of month lengths.
  return new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
}

export function daysInCompetence({ year, month }: Competence): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** 1 = Monday … 7 = Sunday, matching Postgres' `isodow`. */
export function weekdayOf(year: number, month: number, day: number): number {
  const js = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return js === 0 ? 7 : js;
}

export const WEEKDAY_INITIALS = ["", "S", "T", "Q", "Q", "S", "S", "D"] as const;
