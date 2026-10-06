"use client";

import * as React from "react";
import { Table, TableBody, TableCell, TableContainer, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { KPI_DIMENSION_LABEL, type TiresKpiHistory } from "@/lib/tires/types";
import type { TiresPanelContext } from "../../shared";
import { plural, Section, useTiresLink } from "../tires-ui";
import { DeltaValue, RelativeValue, TREND_GROUP_LABEL, TrendBadge } from "./evolution-ui";
import { compare, comparedPeriods, fmtKpi, periodLabel, periodSpoken, type Trend } from "./evolution-utils";

/**
 * Ranking dos itens da dimensão (operação, local, liderança…) para o
 * indicador escolhido: última captura × anterior, separados em Pioraram,
 * Melhoraram e Estáveis. Clicar num item abre a série dele (`membro=`).
 */
export function EvolutionRanking({ data, ctx }: { data: TiresKpiHistory; ctx: TiresPanelContext }) {
  const link = useTiresLink(ctx);
  const dim = KPI_DIMENSION_LABEL[data.dimension];
  const { current, previous } = comparedPeriods(data.runs, data.period);
  const rows = data.members.map((m) => ({ ...m, cmp: compare(data.kind, data.higherIsBetter, m.current, m.previous, m.delta) }));
  const neutral = data.higherIsBetter == null;
  const order: Trend[] = neutral ? ["neutro"] : ["piorando", "melhorando", "estavel", "neutro"];
  const groups = order
    .map((t) => ({
      trend: t,
      title: neutral ? "Variação (indicador de volume, sem julgamento)" : t === "neutro" ? "Sem comparação" : TREND_GROUP_LABEL[t],
      items: rows
        .filter((r) => r.cmp.trend === t)
        .sort((a, b) =>
          t === "estavel" || (t === "neutro" && !neutral)
            ? a.label.localeCompare(b.label, "pt-BR")
            : Math.abs(b.cmp.delta ?? 0) - Math.abs(a.cmp.delta ?? 0) || a.label.localeCompare(b.label, "pt-BR"),
        ),
    }))
    .filter((g) => g.items.length > 0);
  const n = (t: Trend) => rows.filter((r) => r.cmp.trend === t).length;
  const head = (label: string, key: string | null) => (
    <>
      {label}
      {key ? (
        <span className="block text-caption font-normal text-fg-muted" title={periodSpoken(key)}>
          {periodLabel(key)}
        </span>
      ) : null}
    </>
  );

  return (
    <Section
      title={`Ranking por ${dim}`}
      description={`${data.label}: última captura × anterior em cada item. Clique em um item para ver a série dele.`}
      actions={
        rows.length && !neutral ? (
          <p className="text-caption text-fg-muted tabular-nums" data-testid="tires-evolution-ranking-counts">
            {n("piorando")} {plural(n("piorando"), "piorou", "pioraram")} · {n("melhorando")} {plural(n("melhorando"), "melhorou", "melhoraram")} ·{" "}
            {n("estavel")} {plural(n("estavel"), "estável", "estáveis")}
          </p>
        ) : null
      }
      testId="tires-evolution-ranking"
    >
      {rows.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-body-sm text-fg-muted" data-testid="tires-evolution-ranking-empty">
          Nenhum item de {dim.toLowerCase()} com captura deste indicador ainda.
        </p>
      ) : (
        <TableContainer>
          <Table>
            <caption className="sr-only">
              {data.label} por {dim.toLowerCase()}: atual, anterior, variação e tendência
            </caption>
            <TableHeader>
              <TableRow>
                <TableHead>{dim}</TableHead>
                <TableHead numeric>{head("Atual", current)}</TableHead>
                <TableHead numeric>{head("Anterior", previous)}</TableHead>
                <TableHead numeric>Variação</TableHead>
                <TableHead numeric>Variação %</TableHead>
                <TableHead>Tendência</TableHead>
              </TableRow>
            </TableHeader>
            {groups.map((g) => (
              <TableBody key={g.trend}>
                <TableRow className="h-8 hover:bg-transparent">
                  <th scope="rowgroup" colSpan={6} className="bg-surface-secondary px-3 text-left text-caption font-semibold text-fg-muted">
                    {g.title} <span className="font-normal tabular-nums">({g.items.length})</span>
                  </th>
                </TableRow>
                {g.items.map((m) => {
                  const nav = link({ membro: m.id });
                  return (
                    <TableRow key={m.id} className="h-10" data-testid="tires-evolution-ranking-row" data-member={m.id} data-trend={m.cmp.trend}>
                      <TableCell className="min-w-[14rem] py-1.5">
                        <a
                          href={nav.href}
                          onClick={nav.onClick}
                          className="rounded-xs font-medium text-fg underline-offset-2 hover:text-primary hover:underline hfm-focus-ring"
                          data-testid="tires-evolution-ranking-member"
                        >
                          {m.label}
                          <span className="sr-only"> — ver a série</span>
                        </a>
                      </TableCell>
                      <TableCell numeric className="py-1.5 font-semibold text-fg">
                        {fmtKpi(data.kind, m.current)}
                      </TableCell>
                      <TableCell numeric className="py-1.5 text-fg-secondary">
                        {fmtKpi(data.kind, m.previous)}
                      </TableCell>
                      <TableCell numeric className="py-1.5">
                        <DeltaValue kind={data.kind} delta={m.cmp.delta} />
                      </TableCell>
                      <TableCell numeric className="py-1.5">
                        <RelativeValue relative={m.cmp.relative} />
                      </TableCell>
                      <TableCell className="whitespace-nowrap py-1.5">
                        <TrendBadge comparison={m.cmp} />
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            ))}
          </Table>
        </TableContainer>
      )}
    </Section>
  );
}
