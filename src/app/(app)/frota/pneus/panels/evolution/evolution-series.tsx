"use client";

import * as React from "react";
import { ChevronLeft } from "lucide-react";
import { ChartCard, TrendChart, type ChartTooltipRow, type TrendPoint } from "@/components/charts";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableContainer, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { fmtInt, formatDate, KPI_DIMENSION_LABEL, type KpiSeriesPoint, type TiresKpiHistory } from "@/lib/tires/types";
import type { TiresPanelContext } from "../../shared";
import { plural, useTiresLink } from "../tires-ui";
import { DeltaValue } from "./evolution-ui";
import {
  compare, DEFAULT_TZ, fmtDelta, fmtKpi, formatSlot, MONTHLY_RULE, periodLabel, periodSpoken, type KpiKind,
} from "./evolution-utils";

/**
 * Série do indicador escolhido no recorte (Geral ou um item da dimensão):
 * gráfico de linha com um ponto por captura e a mesma série em tabela — o
 * período, quando foi capturada, de que dados (data de referência da base
 * oficial) e o numerador/denominador gravados.
 */
const valueOf = (kind: KpiKind, p: KpiSeriesPoint) => (kind === "pct" ? p.percentage : p.quantity);

/** "292 / 409" (percentual) — quantidade não tem denominador. */
const ratio = (p: KpiSeriesPoint) => (p.numerator == null && p.denominator == null ? "—" : `${fmtInt(p.numerator)} / ${fmtInt(p.denominator)}`);

export function recorteLabel(data: TiresKpiHistory): string {
  if (data.dimension === "geral") return data.scoped ? "Geral (soma das suas operações)" : "Geral";
  const member = data.members.find((m) => m.id === data.dimensionId)?.label ?? "item selecionado";
  return `${KPI_DIMENSION_LABEL[data.dimension]}: ${member}`;
}

export function EvolutionSeries({ data, ctx }: { data: TiresKpiHistory; ctx: TiresPanelContext }) {
  const link = useTiresLink(ctx);
  const kind = data.kind;
  const tz = data.schedule?.timezone || DEFAULT_TZ;
  const series = data.series;
  const n = series.length;
  const dense = n > 12;
  const recorte = recorteLabel(data);
  const back = data.dimension !== "geral" ? link({ membro: null }) : null;

  const points: TrendPoint[] = series.map((p, i) => {
    const v = valueOf(kind, p);
    const prev = i > 0 ? valueOf(kind, series[i - 1]) : null;
    const delta = v != null && prev != null ? v - prev : null;
    const rows: ChartTooltipRow[] = [{ label: data.label, value: fmtKpi(kind, v), emphasis: true }];
    if (kind === "pct") rows.push({ label: "Numerador / denominador", value: ratio(p) });
    if (i > 0) rows.push({ label: "Variação", value: fmtDelta(kind, delta) });
    rows.push({ label: "Dados de", value: formatDate(p.sourceReferenceDate) });
    return {
      key: p.runId,
      label: periodLabel(p.periodKey, dense),
      value: v,
      current: i === n - 1,
      tooltip: {
        title: periodLabel(p.periodKey),
        subtitle: `Captura de ${formatSlot(p.slotAt, tz)}`,
        rows,
        announce: `${periodSpoken(p.periodKey)}: ${data.label} ${fmtKpi(kind, v)}.`,
      },
    };
  });

  const last = series[n - 1];
  const before = n > 1 ? series[n - 2] : undefined;
  const lastCmp = last && before ? compare(kind, data.higherIsBetter, valueOf(kind, last), valueOf(kind, before)) : null;
  const trendWord =
    lastCmp?.comparable && lastCmp.trend !== "neutro" ? ` — ${lastCmp.trend === "estavel" ? "estável" : lastCmp.trend}` : "";
  const insight =
    last && before && lastCmp?.comparable
      ? `${periodLabel(last.periodKey)}: ${fmtKpi(kind, valueOf(kind, last))}, ${fmtDelta(kind, lastCmp.delta)} em relação a ${periodLabel(before.periodKey)}${trendWord}.`
      : undefined;

  const description = (
    <>
      {data.period === "mes" ? `Mês a mês. ${MONTHLY_RULE}` : "Semana a semana."} {n > 0 ? `${fmtInt(n)} ${plural(n, "captura", "capturas")}` : null}
      {n > 1 ? `, de ${periodLabel(series[0].periodKey)} a ${periodLabel(last?.periodKey)}.` : n === 1 ? "." : null}
    </>
  );

  return (
    <ChartCard
      title={`${data.label} · ${recorte}`}
      description={description}
      headingLevel={2}
      actions={
        back ? (
          <Button asChild variant="ghost" size="sm">
            <a href={back.href} onClick={back.onClick} data-testid="tires-evolution-back">
              <ChevronLeft aria-hidden />
              Ranking de {KPI_DIMENSION_LABEL[data.dimension]}
            </a>
          </Button>
        ) : undefined
      }
      insight={insight}
      empty={
        n === 0
          ? data.dimension === "geral"
            ? "Ainda não há captura deste indicador. A série começa na próxima captura agendada."
            : "Este item não tem captura deste indicador nos períodos gravados."
          : undefined
      }
      data-testid="tires-evolution-chart"
    >
      <TrendChart
        points={points}
        ariaLabel={`${data.label} — ${recorte}, ${data.period === "mes" ? "mês a mês" : "semana a semana"}`}
        kind={kind === "pct" ? "percent" : "number"}
        format={(v) => fmtKpi(kind, v)}
        axisFormat={kind === "pct" ? (v) => `${fmtInt(v)}%` : (v) => fmtInt(v)}
        height={220}
      />
      <TableContainer className="mt-4 shadow-none" maxHeight={360} stickyHeader data-testid="tires-evolution-table">
        <Table>
          <caption className="sr-only">
            {data.label} — {recorte}: valor de cada captura, mais recente primeiro
          </caption>
          <TableHeader>
            <TableRow>
              <TableHead>Período</TableHead>
              <TableHead>Captura</TableHead>
              <TableHead>Dados de origem</TableHead>
              {kind === "pct" ? <TableHead numeric>Numerador / denominador</TableHead> : null}
              <TableHead numeric>Valor</TableHead>
              <TableHead numeric>Variação</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {series
              .map((p, i) => ({ p, i }))
              .reverse()
              .map(({ p, i }) => {
                const v = valueOf(kind, p);
                const prev = i > 0 ? valueOf(kind, series[i - 1]) : null;
                return (
                  <TableRow key={p.runId} className="h-9" data-testid="tires-evolution-table-row" data-period={p.periodKey}>
                    <TableCell className="whitespace-nowrap py-1.5 font-medium text-fg">
                      <span title={periodSpoken(p.periodKey)}>{periodLabel(p.periodKey)}</span>
                    </TableCell>
                    <TableCell className="whitespace-nowrap py-1.5 tabular-nums text-fg-secondary">{formatSlot(p.slotAt, tz, false)}</TableCell>
                    <TableCell className="whitespace-nowrap py-1.5 tabular-nums text-fg-secondary">
                      {p.sourceReferenceDate ? `dados de ${formatDate(p.sourceReferenceDate)}` : "—"}
                    </TableCell>
                    {kind === "pct" ? (
                      <TableCell numeric className="whitespace-nowrap py-1.5 text-fg-secondary">
                        {ratio(p)}
                      </TableCell>
                    ) : null}
                    <TableCell numeric className="whitespace-nowrap py-1.5 font-semibold text-fg">
                      {fmtKpi(kind, v)}
                    </TableCell>
                    <TableCell numeric className="py-1.5">
                      <DeltaValue kind={kind} delta={v != null && prev != null ? Math.round((v - prev) * 100) / 100 : null} />
                    </TableCell>
                  </TableRow>
                );
              })}
          </TableBody>
        </Table>
      </TableContainer>
    </ChartCard>
  );
}
