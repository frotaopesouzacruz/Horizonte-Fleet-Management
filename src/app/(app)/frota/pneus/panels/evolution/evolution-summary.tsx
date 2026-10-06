"use client";

import * as React from "react";
import { cn } from "@/lib/cn";
import { Table, TableBody, TableCell, TableContainer, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { TiresKpiHistory } from "@/lib/tires/types";
import type { TiresPanelContext } from "../../shared";
import { plural, Section, useTiresLink } from "../tires-ui";
import { DeltaValue, RelativeValue, TrendBadge } from "./evolution-ui";
import { compare, comparedPeriods, fmtKpi, periodLabel, periodSpoken, STABLE_PP, type Trend } from "./evolution-utils";

/**
 * Atual × anterior para TODOS os indicadores do catálogo, como o banco os
 * gravou nas duas capturas mais recentes (Geral — ou a soma das próprias
 * operações no acesso restrito). Clicar no indicador o leva ao gráfico.
 */
export function EvolutionSummary({ data, ctx }: { data: TiresKpiHistory; ctx: TiresPanelContext }) {
  const link = useTiresLink(ctx);
  const { current, previous } = comparedPeriods(data.runs, data.period);
  const rows = data.summary.map((s) => ({ ...s, cmp: compare(s.kind, s.higherIsBetter, s.current, s.previous) }));
  const groups = [
    { key: "pct", title: "Percentuais (variação em pontos percentuais)", items: rows.filter((r) => r.kind === "pct") },
    { key: "qty", title: "Quantidades (variação em unidades)", items: rows.filter((r) => r.kind === "qty") },
  ].filter((g) => g.items.length > 0);
  const count = (t: Trend) => rows.filter((r) => r.cmp.comparable && r.cmp.trend === t).length;
  const better = count("melhorando");
  const worse = count("piorando");
  const stable = count("estavel");
  const scope = data.scoped ? "soma das suas operações" : "Geral";
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
      title="Atual × anterior"
      description={
        <>
          Último período capturado comparado ao anterior, para todos os indicadores ({scope}). Estável: variação menor que{" "}
          {String(STABLE_PP).replace(".", ",")} p.p. nos percentuais ou nenhuma nas quantidades. Volumes (pneus em uso, total) não têm tendência.
        </>
      }
      actions={
        rows.some((r) => r.cmp.comparable) ? (
          <p className="text-caption text-fg-muted tabular-nums" data-testid="tires-evolution-summary-counts">
            {better} melhorando · {worse} piorando · {stable} {plural(stable, "estável", "estáveis")}
          </p>
        ) : null
      }
      testId="tires-evolution-summary"
    >
      <TableContainer>
        <Table>
          <caption className="sr-only">
            Indicadores de pneus: valor atual{current ? ` (${periodSpoken(current)})` : ""}, anterior{previous ? ` (${periodSpoken(previous)})` : ""},
            variação e tendência
          </caption>
          <TableHeader>
            <TableRow>
              <TableHead>Indicador</TableHead>
              <TableHead numeric>{head("Atual", current)}</TableHead>
              <TableHead numeric>{head("Anterior", previous)}</TableHead>
              <TableHead numeric>Variação</TableHead>
              <TableHead numeric>Variação %</TableHead>
              <TableHead>Tendência</TableHead>
            </TableRow>
          </TableHeader>
          {groups.map((g) => (
            <TableBody key={g.key}>
              <TableRow className="h-8 hover:bg-transparent">
                <th scope="rowgroup" colSpan={6} className="bg-surface-secondary px-3 text-left text-caption font-semibold text-fg-muted">
                  {g.title}
                </th>
              </TableRow>
              {g.items.map((r) => {
                const selected = r.indicator === data.indicator;
                const nav = link({ indicador: r.indicator });
                return (
                  <TableRow
                    key={r.indicator}
                    selected={selected}
                    className="h-10"
                    data-testid="tires-evolution-summary-item"
                    data-indicator={r.indicator}
                    data-trend={r.cmp.trend}
                  >
                    <TableCell className="min-w-[14rem] py-1.5">
                      <a
                        href={nav.href}
                        onClick={nav.onClick}
                        aria-current={selected ? "true" : undefined}
                        className={cn(
                          "rounded-xs font-medium underline-offset-2 hover:text-primary hover:underline hfm-focus-ring",
                          selected ? "text-fg" : "text-fg-secondary",
                        )}
                        data-testid="tires-evolution-summary-link"
                      >
                        {r.label}
                        <span className="sr-only">{selected ? " — em análise no gráfico" : " — ver a série"}</span>
                      </a>
                    </TableCell>
                    <TableCell numeric className="py-1.5 font-semibold text-fg">
                      {fmtKpi(r.kind, r.current)}
                    </TableCell>
                    <TableCell numeric className="py-1.5 text-fg-secondary">
                      {fmtKpi(r.kind, r.previous)}
                    </TableCell>
                    <TableCell numeric className="py-1.5">
                      <DeltaValue kind={r.kind} delta={r.cmp.delta} />
                    </TableCell>
                    <TableCell numeric className="py-1.5">
                      <RelativeValue relative={r.cmp.relative} />
                    </TableCell>
                    <TableCell className="whitespace-nowrap py-1.5">
                      <TrendBadge comparison={r.cmp} />
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          ))}
        </Table>
      </TableContainer>
    </Section>
  );
}
