/**
 * O recorte de período da exportação da base dos Planners — funções puras,
 * sem servidor, para que a rota e os testes usem exatamente a mesma conta.
 */
export const today = () => new Date().toISOString().slice(0, 10);

/** O pedaço do período [start, end] dentro do intervalo pedido (datas ISO). */
export function clipPeriod(
  start: string,
  end: string | null,
  filters: { dateFrom?: string; dateTo?: string },
): { from: string; to: string; days: number } | null {
  const from = filters.dateFrom && filters.dateFrom > start ? filters.dateFrom : start;
  const openEnd = end ?? filters.dateTo ?? today();
  const to = filters.dateTo && filters.dateTo < openEnd ? filters.dateTo : openEnd;
  if (to < from) return null;
  const days = Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;
  return { from, to, days };
}

/** Os dias de [from, to], em ISO. */
export function eachDay(from: string, to: string): string[] {
  const out: string[] = [];
  for (let t = Date.parse(`${from}T00:00:00Z`), end = Date.parse(`${to}T00:00:00Z`); t <= end; t += 86_400_000) {
    out.push(new Date(t).toISOString().slice(0, 10));
  }
  return out;
}
