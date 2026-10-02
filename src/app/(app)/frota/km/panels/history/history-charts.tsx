"use client";

import * as React from "react";
import { ChartCard, ChartLegend, ColumnChart, SrTable, TrendChart, type ColumnDatum, type TrendPoint } from "@/components/charts";
import { fmtInt, fmtKm, fmtKm1, kmStatusLabel } from "@/lib/km/types";
import type { KmHistoryDay } from "@/lib/km/history";
import { dayMonth, fullDate, monthFull, monthShort, weekdayOf } from "./format";

/**
 * Gráficos do Histórico por frota. Dia sem leitura não tem ponto nem barra
 * (nunca 0 km); dia futuro fica hachurado, sem resultado.
 */

/** Cor da coluna pela situação do dia (o tooltip e a tabela dizem a situação). */
function columnColor(status: string): string {
  if (status === "high_mileage" || status === "km_divergence" || status === "pending_review") return "var(--chart-warning)";
  if (status === "no_movement") return "var(--chart-neutral)";
  return "var(--chart-brand-primary)";
}

/**
 * Rótulos do eixo só a cada N pontos, com N múltiplo de 6: o gráfico pula 1, 2
 * ou 3 rótulos conforme a largura, e um múltiplo de 6 aparece em qualquer caso.
 */
function tickEvery(count: number): number {
  return 6 * Math.max(1, Math.ceil(count / 72));
}

export function OdometerChart({ daily, plate }: { daily: KmHistoryDay[]; plate: string }) {
  const points = React.useMemo<TrendPoint[]>(() => {
    const step = tickEvery(daily.length);
    let lastWithValue = -1;
    daily.forEach((d, i) => {
      if (d.status !== "future" && d.status !== "no_reading" && d.odometerEnd != null) lastWithValue = i;
    });
    return daily.map((d, i) => {
      const future = d.status === "future";
      const value = future || d.status === "no_reading" ? null : d.odometerEnd;
      return {
        key: d.day,
        label: i % step === 0 ? dayMonth(d.day) : "",
        value,
        future,
        current: i === lastWithValue,
        tooltip: {
          title: `${weekdayOf(d.day)}, ${fullDate(d.day)}`,
          rows: future
            ? [{ label: "Situação", value: "Futuro — sem resultado" }]
            : [
                { label: "Hodômetro final", value: value == null ? "Sem leitura" : fmtKm(value), emphasis: true, color: "var(--chart-brand-primary)", marker: "line" as const },
                { label: "KM do dia", value: d.km == null ? "—" : fmtKm1(d.km) },
                { label: "Situação", value: kmStatusLabel(d.status) },
              ],
        },
      };
    });
  }, [daily]);

  const withValue = points.filter((p) => p.value != null).length;

  return (
    <ChartCard
      title="Hodômetro por dia"
      description={`Hodômetro final de cada dia com leitura — ${plate}`}
      empty={withValue === 0 ? "Nenhum dia com leitura de hodômetro no período." : undefined}
      legend={
        <ChartLegend
          items={[
            { key: "odo", label: "Hodômetro final", color: "var(--chart-brand-primary)", shape: "line" },
            { key: "gap", label: "Sem leitura: sem ponto (não é 0 km)", color: "var(--chart-neutral)", shape: "dot" },
          ]}
        />
      }
      data-testid="km-historico-chart-odometer"
    >
      <TrendChart
        points={points}
        kind="number"
        zeroBaseline={false}
        ariaLabel={`Hodômetro por dia do veículo ${plate}`}
        format={(v) => fmtKm(v)}
        axisFormat={(v) => fmtInt(v)}
        height={200}
      />
      <SrTable
        caption={`Hodômetro por dia — ${plate}`}
        columns={["Dia", "Hodômetro final", "Situação"]}
        rows={daily
          .filter((d) => d.status !== "future")
          .map((d) => ({
            key: d.day,
            cells: [fullDate(d.day), d.status === "no_reading" ? "Sem leitura" : fmtKm(d.odometerEnd), kmStatusLabel(d.status)],
          }))}
      />
    </ChartCard>
  );
}

export function KmPerDayChart({
  daily,
  month,
  months,
  onMonthChange,
}: {
  daily: KmHistoryDay[];
  month: string | null;
  months: string[];
  onMonthChange: (month: string) => void;
}) {
  const days = React.useMemo(() => (month ? daily.filter((d) => d.day.startsWith(month)) : daily), [daily, month]);

  const items = React.useMemo<ColumnDatum[]>(
    () =>
      days.map((d) => {
        const future = d.status === "future";
        const value = future || d.status === "no_reading" ? null : d.km;
        return {
          key: d.day,
          label: String(Number(d.day.slice(8, 10))),
          value,
          future,
          color: columnColor(d.status),
          tooltip: {
            title: `${weekdayOf(d.day)}, ${fullDate(d.day)}`,
            rows: future
              ? [{ label: "Situação", value: "Futuro — sem resultado" }]
              : d.status === "no_reading"
                ? [{ label: "Situação", value: "Sem leitura (não é 0 km)" }]
                : [
                    {
                      label: "KM validado",
                      value: d.km == null ? "Não conta nos totais" : fmtKm1(d.km),
                      emphasis: true,
                      color: columnColor(d.status),
                      marker: "square" as const,
                    },
                    { label: "KM informado", value: d.kmInformed == null ? "—" : fmtKm1(d.kmInformed) },
                    { label: "Situação", value: kmStatusLabel(d.status) },
                  ],
          },
        };
      }),
    [days],
  );

  const hasValue = items.some((i) => i.value != null);

  return (
    <ChartCard
      title="KM por dia"
      description={month ? `KM validado de cada dia — ${monthFull(month)}` : "KM validado de cada dia"}
      actions={
        months.length > 1 ? (
          <div role="radiogroup" aria-label="Mês exibido" className="flex flex-wrap gap-1" data-testid="km-historico-month">
            {months.map((m) => {
              const checked = m === month;
              return (
                <button
                  key={m}
                  type="button"
                  role="radio"
                  aria-checked={checked}
                  onClick={() => onMonthChange(m)}
                  onKeyDown={(e) => {
                    const idx = months.indexOf(m);
                    let next = idx;
                    if (e.key === "ArrowRight" || e.key === "ArrowDown") next = Math.min(months.length - 1, idx + 1);
                    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") next = Math.max(0, idx - 1);
                    else if (e.key === "Home") next = 0;
                    else if (e.key === "End") next = months.length - 1;
                    else return;
                    e.preventDefault();
                    onMonthChange(months[next]);
                    (e.currentTarget.parentElement?.children[next] as HTMLElement | undefined)?.focus();
                  }}
                  tabIndex={checked ? 0 : -1}
                  className={
                    checked
                      ? "h-7 rounded-xs border border-primary bg-primary-soft px-2 text-caption font-semibold text-primary-soft-fg hfm-focus-ring"
                      : "h-7 rounded-xs border border-border bg-surface px-2 text-caption text-fg-secondary hover:bg-surface-secondary hfm-focus-ring"
                  }
                >
                  {monthShort(m)}
                </button>
              );
            })}
          </div>
        ) : null
      }
      legend={
        <ChartLegend
          items={[
            { key: "ok", label: "Validado", color: "var(--chart-brand-primary)" },
            { key: "nm", label: "Sem movimento", color: "var(--chart-neutral)" },
            { key: "warn", label: "Alta rodagem, divergência ou pendente", color: "var(--chart-warning)" },
            { key: "none", label: "Sem leitura: sem barra", color: "var(--chart-future)", shape: "dot" },
          ]}
        />
      }
      empty={!hasValue ? "Nenhum dia com KM validado neste mês." : undefined}
      data-testid="km-historico-chart-km"
    >
      <ColumnChart
        items={items}
        kind="number"
        emptyLabel="Sem leitura"
        ariaLabel={month ? `KM validado por dia em ${monthFull(month)}` : "KM validado por dia"}
        format={(v) => fmtKm1(v)}
        axisFormat={(v) => fmtInt(v)}
        showValues={false}
        height={180}
      />
      <SrTable
        caption={month ? `KM por dia — ${monthFull(month)}` : "KM por dia"}
        columns={["Dia", "KM validado", "Situação"]}
        rows={days
          .filter((d) => d.status !== "future")
          .map((d) => ({
            key: d.day,
            cells: [fullDate(d.day), d.status === "no_reading" ? "Sem leitura" : fmtKm1(d.km), kmStatusLabel(d.status)],
          }))}
      />
    </ChartCard>
  );
}
