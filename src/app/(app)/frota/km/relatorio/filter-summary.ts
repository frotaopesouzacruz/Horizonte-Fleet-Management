/**
 * Filtros vigentes em texto — o mesmo resumo na aba Relatórios, na versão
 * imprimível e nas planilhas. Os filtros viajam por id; aqui eles só ganham
 * nome para leitura (das mesmas opções que a tela oferece).
 */
import type { KmFilterOptions } from "@/lib/km/options";
import { competenceLabel, kmStatusLabel, type KmFilters } from "@/lib/km/types";

export interface KmFilterSummaryItem {
  key: keyof KmFilters;
  label: string;
  value: string;
}

const LABEL: Partial<Record<keyof KmFilters, string>> = {
  operation: "Operação",
  state: "UF",
  city: "Cidade",
  br: "BR",
  leader: "Liderança",
  unit: "Filial",
  vehicleType: "Tipo",
  subcategory: "Subcategoria",
  model: "Modelo",
  vehicle: "Veículo",
  status: "Situação",
  fleet: "Frota",
  q: "Busca",
};

const FLEET: Record<string, string> = { active: "Ativas", inactive: "Inativas", all: "Todas" };

const ids = (v: string | undefined) =>
  (v ?? "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);

type Names = Pick<
  KmFilterOptions,
  "operations" | "coverage" | "brs" | "leaders" | "units" | "vehicleTypes" | "subcategories" | "models" | "vehicles"
>;

/** Filtros ativos (fora o período), com nomes. Id sem nome visível aparece como "(não encontrado)". */
export function kmFilterSummary(f: KmFilters, o: Partial<Names> | null | undefined): KmFilterSummaryItem[] {
  const named = (list: { id: string; name: string }[] | undefined, values: string[]) =>
    values.map((id) => list?.find((x) => x.id === id)?.name ?? "(não encontrado)").join(", ");

  const out: KmFilterSummaryItem[] = [];
  const push = (key: keyof KmFilters, value: string) => {
    if (value) out.push({ key, label: LABEL[key] ?? key, value });
  };

  if (f.operation) push("operation", named(o?.operations, ids(f.operation)));
  if (f.state) {
    push(
      "state",
      ids(f.state)
        .map((id) => o?.coverage?.find((c) => String(c.stateId) === id)?.uf ?? "(não encontrado)")
        .join(", "),
    );
  }
  if (f.city) {
    push(
      "city",
      ids(f.city)
        .map((id) => o?.coverage?.find((c) => String(c.cityId) === id)?.cityName ?? "(não encontrado)")
        .join(", "),
    );
  }
  if (f.br) push("br", ids(f.br).map((id) => o?.brs?.find((b) => b.id === id)?.code ?? "(não encontrado)").join(", "));
  if (f.leader) push("leader", named(o?.leaders, ids(f.leader)));
  if (f.unit) push("unit", named(o?.units, ids(f.unit)));
  if (f.vehicleType) push("vehicleType", named(o?.vehicleTypes, ids(f.vehicleType)));
  if (f.subcategory) push("subcategory", named(o?.subcategories, ids(f.subcategory)));
  if (f.model) push("model", named(o?.models, ids(f.model)));
  if (f.vehicle) {
    push(
      "vehicle",
      ids(f.vehicle)
        .map((id) => {
          const v = o?.vehicles?.find((x) => x.id === id);
          return v ? [v.plate, v.fleetCode && v.fleetCode !== v.plate ? v.fleetCode : null].filter(Boolean).join(" · ") : "(não encontrado)";
        })
        .join(", "),
    );
  }
  if (f.status) push("status", ids(f.status).map((s) => kmStatusLabel(s)).join(", "));
  if (f.fleet) push("fleet", FLEET[f.fleet] ?? f.fleet);
  if (f.q?.trim()) push("q", `“${f.q.trim()}”`);
  return out;
}

const br = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

/** Período como a pessoa escolheu (sem consultar o banco). */
export function kmRequestedPeriodLabel(f: KmFilters): string {
  if (f.from && f.to) return `Período de ${br(f.from)} a ${br(f.to)}`;
  if (f.competence) return `Competência ${competenceLabel(f.competence)}`;
  return "Competência mais recente com leitura (padrão)";
}

/** Período efetivo devolvido pela rotina. */
export function kmResolvedPeriodLabel(period: { from: string; to: string } | null | undefined): string {
  if (!period?.from || !period.to) return "—";
  const first = period.from.endsWith("-01");
  const [y, m] = period.to.split("-").map(Number);
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const wholeMonth = first && period.from.slice(0, 7) === period.to.slice(0, 7) && Number(period.to.slice(8, 10)) === lastDay;
  return wholeMonth
    ? `Competência ${competenceLabel(period.from.slice(0, 7))} · ${br(period.from)} a ${br(period.to)}`
    : `Período de ${br(period.from)} a ${br(period.to)}`;
}

/** Sufixo do arquivo: "2026-09" para um mês inteiro, senão "2026-09-01_2026-09-15". */
export function kmPeriodSlug(period: { from: string; to: string } | null | undefined, f?: KmFilters): string {
  if (period?.from && period.to) {
    const [y, m] = period.to.split("-").map(Number);
    const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
    if (period.from.endsWith("-01") && period.from.slice(0, 7) === period.to.slice(0, 7) && Number(period.to.slice(8, 10)) === lastDay) {
      return period.from.slice(0, 7);
    }
    return `${period.from}_${period.to}`;
  }
  if (f?.from && f.to) return `${f.from}_${f.to}`;
  return f?.competence ?? new Date().toISOString().slice(0, 7);
}
