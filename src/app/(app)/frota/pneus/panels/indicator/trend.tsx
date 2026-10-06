"use client";

import * as React from "react";
import { LineChart } from "lucide-react";
import { SrTable, TrendChart, type TrendPoint } from "@/components/charts";
import { TrendIndicator, type KpiGoodWhen } from "@/components/ui/kpi-card";
import { fmtInt, fmtPct, formatDate, type KpiSchedule, type TireIndicatorKey, type TiresKpiHistory } from "@/lib/tires/types";
import type { TiresPanelContext } from "../../shared";
import { Section, useTiresLink } from "../tires-ui";
import { INDICATOR_KPI_OF, fmtPp, shortDate } from "./model";

const WEEKDAY = ["domingo", "segunda-feira", "terça-feira", "quarta-feira", "quinta-feira", "sexta-feira", "sábado"];

/** "sexta-feira, 22h" a partir do agendamento das capturas (padrão do produto quando não há agendamento lido). */
function scheduleText(s: KpiSchedule | null | undefined): string {
  if (!s) return "sexta-feira, 22h";
  const [hh, mm] = (s.runTime ?? "").split(":");
  const time = hh ? `${Number(hh)}h${mm && mm !== "00" ? mm : ""}` : "";
  const when =
    s.frequency === "daily" ? "diariamente" : s.frequency === "monthly" ? `dia ${s.monthDay} de cada mês` : WEEKDAY[s.weekday] ?? "sexta-feira";
  return [when, time].filter(Boolean).join(", ");
}

const valueOf = (h: TiresKpiHistory, p: TiresKpiHistory["series"][number]) => (h.kind === "pct" ? p.percentage : p.quantity);
const fmtValue = (h: TiresKpiHistory, v: number | null | undefined) => (h.kind === "pct" ? fmtPct(v) : fmtInt(v));

/**
 * Evolução semanal do indicador (série Geral das capturas automáticas). Com
 * menos de duas capturas não há linha: a tela diz quando a série começa e
 * leva à aba de Evolução.
 */
export function TrendSection({ indicator, history, ctx }: { indicator: TireIndicatorKey; history: TiresKpiHistory | null; ctx: TiresPanelContext }) {
  const link = useTiresLink(ctx);
  const kpi = history?.indicator ?? INDICATOR_KPI_OF[indicator];
  const series = (history?.series ?? []).filter((p) => (history ? valueOf(history, p) != null : false));
  const toEvolution = link({ aba: "evolucao", indicador: kpi, sub: null, pendencia: null, agrupar: null });
  const evolutionLink = (
    <a
      href={toEvolution.href}
      onClick={toEvolution.onClick}
      className="rounded-xs text-body-sm font-medium text-link underline-offset-2 hover:text-link-hover hover:underline hfm-focus-ring"
      data-testid="tires-indicator-trend-link"
    >
      Abrir na Evolução dos indicadores
    </a>
  );
  const scope = history?.scoped ? "das operações do seu alcance" : "geral da organização";

  return (
    <Section
      title="Evolução semanal"
      testId="tires-indicator-trend"
      description={`Série ${scope}, uma captura por semana. Não acompanha os filtros da tela.`}
      actions={evolutionLink}
    >
      {history && series.length >= 2 ? (
        <TrendBody history={history} series={series} />
      ) : (
        <div className="flex items-start gap-3 rounded-lg border border-dashed border-border bg-surface-raised px-4 py-4" data-testid="tires-indicator-trend-empty">
          <LineChart aria-hidden className="mt-0.5 size-5 shrink-0 text-fg-muted" />
          <div className="flex flex-col gap-1 text-body-sm text-fg-secondary">
            <p>A série semanal começa na primeira captura ({scheduleText(history?.schedule)}).</p>
            {history && series.length === 1 ? (
              <p className="text-fg-muted">
                Uma captura até agora: {fmtValue(history, valueOf(history, series[0]))} em {formatDate(series[0].competence)}. A linha aparece a
                partir da segunda.
              </p>
            ) : null}
          </div>
        </div>
      )}
    </Section>
  );
}

function TrendBody({ history, series }: { history: TiresKpiHistory; series: TiresKpiHistory["series"] }) {
  const pct = history.kind === "pct";
  const last = series[series.length - 1];
  const prev = series[series.length - 2];
  const cur = valueOf(history, last);
  const before = valueOf(history, prev);
  const delta = cur != null && before != null ? Math.round((cur - before) * 10) / 10 : null;
  const goodWhen: KpiGoodWhen = history.higherIsBetter == null ? "neutral" : history.higherIsBetter ? "up" : "down";
  const points: TrendPoint[] = series.map((p, i) => ({
    key: p.runId,
    label: shortDate(p.competence),
    value: valueOf(history, p),
    current: i === series.length - 1,
    tooltip: {
      title: `Semana ${p.periodKey}`,
      subtitle: `Captura de ${formatDate(p.competence)}${p.sourceReferenceDate ? ` · dados de ${formatDate(p.sourceReferenceDate)}` : ""}`,
      rows: [
        { label: history.label, value: fmtValue(history, valueOf(history, p)), color: "var(--chart-brand-primary)", marker: "line", emphasis: true },
        ...(pct && p.denominator != null ? [{ label: "Conformes / base", value: `${fmtInt(p.numerator)} de ${fmtInt(p.denominator)}` }] : []),
      ],
    },
  }));

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface-raised p-4 shadow-card">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-body-sm" data-testid="tires-indicator-trend-delta">
        <span className="text-fg-secondary">
          Atual <span className="font-semibold text-fg tabular-nums">{fmtValue(history, cur)}</span>
          <span className="text-fg-muted"> ({shortDate(last.competence)})</span>
        </span>
        <span className="text-fg-secondary">
          Anterior <span className="font-semibold text-fg tabular-nums">{fmtValue(history, before)}</span>
          <span className="text-fg-muted"> ({shortDate(prev.competence)})</span>
        </span>
        {delta != null ? (
          <span className="inline-flex items-center gap-1.5 text-fg-secondary">
            Variação
            <TrendIndicator
              size="sm"
              trend={{
                value: pct ? fmtPp(delta) : `${delta > 0 ? "+" : delta < 0 ? "−" : ""}${fmtInt(Math.abs(delta))}`,
                direction: delta > 0 ? "up" : delta < 0 ? "down" : "flat",
                goodWhen,
              }}
            />
          </span>
        ) : null}
      </div>
      <TrendChart
        points={points}
        ariaLabel={`${history.label}: evolução semanal, ${series.length} capturas`}
        kind={pct ? "percent" : "number"}
        format={(v) => (pct ? fmtPct(v) : fmtInt(v))}
        axisFormat={(v) => (pct ? `${fmtInt(v)}%` : fmtInt(v))}
        height={150}
      />
      <SrTable
        caption={`${history.label} por semana`}
        columns={["Semana", "Captura", history.label]}
        rows={series.map((p) => ({ key: p.runId, cells: [p.periodKey, formatDate(p.competence), fmtValue(history, valueOf(history, p))] }))}
      />
    </div>
  );
}
