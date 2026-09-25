/**
 * Todas as linhas de uma consulta, sem teto.
 *
 * O PostgREST devolve no máximo 1.000 linhas por requisição (`max_rows`): uma
 * consulta sem paginação corta em silêncio o que passar disso. Exportações e
 * listas completas passam por aqui, página a página, até a página que vem
 * incompleta. A consulta de cada página precisa de uma ordem total (termine a
 * ordenação numa coluna única), senão linhas podem se repetir ou sumir entre
 * páginas.
 */
export const PAGE_ROWS = 1000;

type PageResult<T> = PromiseLike<{ data: T[] | null; error: { message: string } | null }>;

export async function fetchAll<T>(page: (from: number, to: number) => PageResult<T>): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE_ROWS) {
    const { data, error } = await page(from, from + PAGE_ROWS - 1);
    if (error) throw new Error(error.message);
    const chunk = data ?? [];
    rows.push(...chunk);
    if (chunk.length < PAGE_ROWS) return rows;
  }
}
