import "server-only";

import type { MtsrFilterOptions } from "@/lib/mtsr/queries";
import {
  conformityLabel,
  criticalityLabel,
  deadlineLabel,
  type MtsrFilters,
} from "@/lib/mtsr/types";
import { stampText } from "@/app/(app)/frota/km/relatorio/export-log";

/**
 * Peças comuns às exportações do MTSR: leitura de TODAS as páginas de uma
 * rotina paginada (sem teto de linhas), a linha de filtros com nomes legíveis
 * e as linhas de contexto que abrem cada aba. As regras continuam no banco;
 * aqui só se percorre e se rotula.
 */

/**
 * Percorre uma rotina paginada até o total informado por ela. A primeira
 * página volta inteira (resumo, opções, data) e as linhas vêm concatenadas.
 * Uma página vazia encerra o laço mesmo que o total diga o contrário — a frota
 * pode ter mudado entre as chamadas.
 */
export async function readAllPages<P extends { rows: unknown[]; total: number }>(
  fetchPage: (limit: number, offset: number) => Promise<P>,
  limit: number,
): Promise<{ first: P; rows: P["rows"] }> {
  const first = await fetchPage(limit, 0);
  const rows = [...first.rows] as P["rows"];
  let offset = rows.length;
  while (offset < first.total) {
    const page = await fetchPage(limit, offset);
    if (!page.rows.length) break;
    rows.push(...page.rows);
    offset += page.rows.length;
  }
  return { first, rows };
}

const ids = (v: string | undefined): string[] =>
  (v ?? "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);

const FLEET_LABEL: Record<string, string> = { all: "Todas", inactive: "Inativas", default: "Ativas" };
const COMPONENT_STATUS_FILTER: Record<string, string> = { ok: "OK", nok: "NOK", sem_informacao: "Sem informação" };

type Names = Partial<Pick<MtsrFilterOptions, "operations" | "coverage" | "brs" | "leaders" | "units" | "vehicleTypes" | "vehicles">>;

/**
 * Filtros ativos da matriz, com nomes (das mesmas opções que a tela oferece).
 * Os filtros viajam por id; um id sem nome visível aparece como "(não encontrado)".
 */
export function mtsrFilterSummary(
  f: MtsrFilters,
  o: Names | null | undefined,
  components: { id: string; name: string }[] = [],
): string[] {
  const named = (list: { id: string; name: string }[] | undefined, values: string[]) =>
    values.map((id) => list?.find((x) => x.id === id)?.name ?? "(não encontrado)").join(", ");
  const out: string[] = [];
  const push = (label: string, value: string) => {
    if (value) out.push(`${label}: ${value}`);
  };

  if (f.operation) push("Operação", named(o?.operations, ids(f.operation)));
  if (f.state) {
    push("UF", ids(f.state).map((id) => o?.coverage?.find((c) => String(c.stateId) === id)?.uf ?? "(não encontrado)").join(", "));
  }
  if (f.city) {
    push("Cidade", ids(f.city).map((id) => o?.coverage?.find((c) => String(c.cityId) === id)?.cityName ?? "(não encontrado)").join(", "));
  }
  if (f.br) push("BR", ids(f.br).map((id) => o?.brs?.find((b) => b.id === id)?.code ?? "(não encontrado)").join(", "));
  if (f.leader) push("Liderança", named(o?.leaders, ids(f.leader)));
  if (f.unit) push("Filial", named(o?.units, ids(f.unit)));
  if (f.vehicleType) push("Tipo", named(o?.vehicleTypes, ids(f.vehicleType)));
  if (f.vehicle) {
    push("Veículo", ids(f.vehicle).map((id) => o?.vehicles?.find((v) => v.id === id)?.plate ?? "(não encontrado)").join(", "));
  }
  if (f.deadline) push("Prazo", ids(f.deadline).map(deadlineLabel).join(", "));
  if (f.conformity) push("Conformidade", ids(f.conformity).map(conformityLabel).join(", "));
  if (f.criticality) push("Criticidade", ids(f.criticality).map(criticalityLabel).join(", "));
  if (f.component) {
    const name = components.find((c) => c.id === f.component)?.name ?? "(não encontrado)";
    const statuses = ids(f.componentStatus).map((s) => COMPONENT_STATUS_FILTER[s] ?? s);
    push("Componente", statuses.length ? `${name} (${statuses.join(", ")})` : name);
  }
  if (f.awaiting === "1" || f.awaiting === "true") push("Revalidação", "Só aguardando revalidação");
  if (f.fleet && f.fleet !== "default") push("Frota", FLEET_LABEL[f.fleet] ?? f.fleet);
  if (f.q?.trim()) push("Busca", f.q.trim());
  return out;
}

/** "Filtros: A · B" ou a frase de ausência. */
export const filterLine = (parts: string[], none: string) => (parts.length ? `Filtros: ${parts.join(" · ")}` : `Filtros: ${none}`);

/** "Gerado em dd/mm/aaaa hh:mm por Nome · Organização". */
export const generatedLine = (displayName: string, organizationName: string) =>
  `Gerado em ${stampText(new Date())} por ${displayName} · ${organizationName}`;

/** "Retrato de dd/mm/aaaa" a partir de uma data ISO. */
export const snapshotLine = (isoDate: string) => `Retrato de ${isoDate.slice(8, 10)}/${isoDate.slice(5, 7)}/${isoDate.slice(0, 4)}`;

/** AAAAMMDD para o nome do arquivo; sem data informada, a data de hoje em São Paulo. */
export function fileSlug(isoDate?: string | null): string {
  if (isoDate && /^\d{4}-\d{2}-\d{2}/.test(isoDate)) return isoDate.slice(0, 10).replace(/-/g, "");
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}${get("month")}${get("day")}`;
}

/** Data ISO de hoje em São Paulo (para rotinas que não devolvem `today`). */
export function todayIso(): string {
  const s = fileSlug(null);
  return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
}
