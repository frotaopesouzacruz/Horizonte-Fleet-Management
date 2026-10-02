"use client";

import * as React from "react";
import { ChartCard, ChartLegend, ColumnChart, SrTable, chartFormat, type ColumnDatum } from "@/components/charts";
import type { KmOverviewData } from "@/lib/km/overview";
import { fmtInt, fmtKm, formatDate } from "@/lib/km/types";
import type { KmPanelContext } from "../../shared";
import { weekdayOf } from "./km-ui";

/**
 * KM validado por dia do período. Dia sem nenhuma leitura não é 0 km: fica
 * sem barra, hachurado, com "Sem leitura" no tooltip; dia futuro também fica
 * hachurado (sem resultado). Um dia com leitura e 0 km é rodagem zero de
 * verdade e aparece como zero. Clicar num dia abre a Visão diária.
 */
export function KmByDayChart({ data, ctx }: { data: KmOverviewData; ctx: KmPanelContext }) {
  const { daily, period } = data;
  const canOpen = ctx.perms.daily;

  const rows = daily.map((d) => {
    const future = d.day > period.today;
    const noReading = !future && d.withReading === 0;
    return { ...d, future, noReading };
  });
  const noReadingDays = rows.filter((r) => r.noReading).length;
  const futureDays = rows.filter((r) => r.future).length;

  const items: ColumnDatum[] = rows.map((r) => {
    const title = `${weekdayOf(r.day)}, ${formatDate(r.day)}`;
    const footer = r.future
      ? "Dia futuro — ainda sem resultado."
      : r.noReading
        ? "Nenhuma frota com leitura no dia. Não é 0 km."
        : canOpen
          ? "Clique ou tecle Enter para abrir a Visão diária."
          : undefined;
    return {
      key: r.day,
      label: String(Number(r.day.slice(8, 10))),
      value: r.future || r.noReading ? null : r.km,
      // sem resultado (futuro) e sem leitura: hachura, nunca uma barra de 0 km
      future: r.future || r.noReading,
      current: r.day === period.referenceDay,
      tooltip: {
        title,
        subtitle: r.future ? "Sem resultado" : r.noReading ? "Sem leitura" : r.day === period.referenceDay ? "Dia de referência" : undefined,
        rows: r.future
          ? []
          : [
              {
                label: "KM validado",
                value: r.noReading ? "Sem leitura" : r.km == null ? "—" : fmtKm(r.km),
                color: "var(--chart-brand-primary)",
                marker: "square" as const,
                emphasis: true,
              },
              { label: "Com leitura", value: fmtInt(r.withReading) },
              { label: "Em movimento", value: fmtInt(r.moving) },
              { label: "Sem leitura", value: fmtInt(r.withoutReading), tone: r.withoutReading > 0 ? ("warning" as const) : undefined },
            ],
        footer,
        announce: r.future
          ? `${title}: dia futuro, sem resultado.`
          : r.noReading
            ? `${title}: sem leitura.`
            : `${title}: ${fmtKm(r.km)}; ${fmtInt(r.withReading)} com leitura, ${fmtInt(r.moving)} em movimento, ${fmtInt(r.withoutReading)} sem leitura.`,
      },
    };
  });

  const legend = [
    { key: "km", label: "KM validado no dia", color: "var(--chart-brand-primary)" },
    ...(noReadingDays + futureDays > 0
      ? [{ key: "none", label: "Hachurado: sem leitura ou dia futuro (não é 0 km)", color: "var(--chart-future)" }]
      : []),
  ];

  return (
    <ChartCard
      title="KM por dia"
      description={
        <>
          KM validado de cada dia de {formatDate(period.from)} a {formatDate(period.to)}. O dia de referência aparece em
          destaque.{canOpen ? " Clique num dia para abrir a Visão diária." : ""}
        </>
      }
      legend={<ChartLegend items={legend} />}
      empty={rows.length === 0 ? "Sem dias no período." : undefined}
      insight={
        noReadingDays > 0
          ? `${fmtInt(noReadingDays)} ${noReadingDays === 1 ? "dia passado ficou" : "dias passados ficaram"} sem nenhuma leitura no período — aparecem sem barra, não como 0 km.`
          : undefined
      }
      data-testid="km-visao-geral-daily-chart"
    >
      <ColumnChart
        items={items}
        ariaLabel={`KM validado por dia, ${formatDate(period.from)} a ${formatDate(period.to)}`}
        format={fmtKm}
        axisFormat={chartFormat.compact}
        kind="number"
        height={200}
        showValues={false}
        onSelect={
          canOpen
            ? (item) => {
                const r = rows.find((x) => x.day === item.key);
                if (r && !r.future) ctx.navigate({ aba: "diaria", dia: r.day });
              }
            : undefined
        }
      />
      <SrTable
        caption="KM por dia"
        columns={["Dia", "KM validado", "Com leitura", "Em movimento", "Sem leitura"]}
        rows={rows.map((r) => ({
          key: r.day,
          cells: [
            formatDate(r.day),
            r.future ? "Dia futuro" : r.noReading ? "Sem leitura" : fmtKm(r.km),
            r.future ? "—" : fmtInt(r.withReading),
            r.future ? "—" : fmtInt(r.moving),
            r.future ? "—" : fmtInt(r.withoutReading),
          ],
        }))}
      />
    </ChartCard>
  );
}
