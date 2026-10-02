"use client";

import * as React from "react";
import { CircleCheck, Info, OctagonAlert, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/cn";
import { ChartCard, HBarChart, SrTable, type HBarDatum } from "@/components/charts";
import type { KmInsight, KmOverviewData } from "@/lib/km/overview";
import { fmtInt, fmtKm, fmtPct, KM_STATUS, type KmReadingStatus } from "@/lib/km/types";
import { chartColorOf, shareOf } from "./km-ui";

/** KM por operação e por tipo — barras horizontais, na ordem da rotina (maior KM primeiro). */
export function KmShareCard({
  title, description, rows, testId,
}: {
  title: string;
  description: React.ReactNode;
  rows: { key: string; label: string; km: number | null; vehicles: number }[];
  testId: string;
}) {
  const total = rows.reduce((acc, r) => acc + (r.km ?? 0), 0);
  const items: HBarDatum[] = rows.map((r, i) => ({
    key: r.key,
    label: r.label,
    value: r.km,
    color: i === 0 ? "var(--chart-brand-primary)" : "var(--chart-brand-secondary)",
    detail: `· ${fmtInt(r.vehicles)} veíc.`,
    tooltip: {
      title: r.label,
      rows: [
        { label: "KM validado", value: fmtKm(r.km), emphasis: true },
        { label: "Participação", value: fmtPct(shareOf(r.km, total)) },
        { label: "Veículos", value: fmtInt(r.vehicles) },
      ],
      announce: `${r.label}: ${fmtKm(r.km)}, ${fmtInt(r.vehicles)} veículos.`,
    },
  }));
  return (
    <ChartCard title={title} description={description} empty={rows.length === 0 ? "Sem dados no recorte." : undefined} data-testid={testId}>
      <HBarChart items={items} ariaLabel={title} format={fmtKm} />
      <SrTable
        caption={title}
        columns={["Grupo", "KM validado", "Veículos"]}
        rows={rows.map((r) => ({ key: r.key, cells: [r.label, fmtKm(r.km), fmtInt(r.vehicles)] }))}
      />
    </ChartCard>
  );
}

/** Ordem do catálogo; "Sem leitura" e "Sem movimento" são situações distintas. */
const STATUS_ORDER: KmReadingStatus[] = [
  "validated", "no_movement", "high_mileage", "km_divergence", "pending_review", "inconsistent", "no_reading",
];

/** Veículo × dia por situação da leitura no período (dias futuros fora). */
export function StatusCard({ data }: { data: KmOverviewData }) {
  const counts = data.byStatus;
  const known = new Set<string>(STATUS_ORDER);
  const extra = Object.keys(counts).filter((k) => !known.has(k));
  const total = Object.values(counts).reduce((acc, n) => acc + (n ?? 0), 0);
  const rows = [...STATUS_ORDER, ...extra].map((code) => {
    const meta = KM_STATUS[code as KmReadingStatus];
    return { code, label: meta?.label ?? code, tone: meta?.tone ?? "neutral", n: counts[code] ?? 0, description: meta?.description };
  });
  const items: HBarDatum[] = rows.map((r) => ({
    key: r.code,
    label: r.label,
    value: r.n,
    color: r.code === "no_reading" ? "var(--chart-future)" : chartColorOf(r.tone),
    detail: `· ${fmtPct(shareOf(r.n, total))}`,
    tooltip: {
      title: r.label,
      subtitle: r.description,
      rows: [
        { label: "Veículo × dia", value: fmtInt(r.n), emphasis: true },
        { label: "Participação", value: fmtPct(shareOf(r.n, total)) },
      ],
      announce: `${r.label}: ${fmtInt(r.n)} veículo-dia.`,
    },
  }));
  return (
    <ChartCard
      title="Por situação da leitura"
      description={
        <>
          Cada frota em cada dia do período até hoje (veículo × dia). Sem leitura é ausência de dado — não é 0 km; Sem
          movimento é leitura válida com deslocamento dentro da tolerância.
        </>
      }
      empty={total === 0 ? "Sem dias passados no período." : undefined}
      data-testid="km-visao-geral-by-status"
    >
      <HBarChart items={items} ariaLabel="Veículo × dia por situação da leitura" format={fmtInt} />
      <SrTable
        caption="Veículo × dia por situação da leitura"
        columns={["Situação", "Veículo × dia", "Participação"]}
        rows={rows.map((r) => ({ key: r.code, cells: [r.label, fmtInt(r.n), fmtPct(shareOf(r.n, total))] }))}
      />
    </ChartCard>
  );
}

const INSIGHT_ICON = { success: CircleCheck, warning: TriangleAlert, danger: OctagonAlert, info: Info, neutral: Info } as const;
const INSIGHT_TONE = {
  success: "text-success",
  warning: "text-warning",
  danger: "text-danger",
  info: "text-info",
  neutral: "text-fg-muted",
} as const;
const INSIGHT_SR = { success: "Ok", warning: "Atenção", danger: "Crítico", info: "Informativo", neutral: "Informativo" } as const;

/** Leituras determinísticas da rotina (só fatos calculados). */
export function InsightsCard({ insights }: { insights: KmInsight[] }) {
  return (
    <ChartCard
      title="Leituras do período"
      description="Fatos calculados pela rotina sobre os mesmos números desta tela."
      empty={insights.length === 0 ? "Nada a destacar no recorte." : undefined}
      data-testid="km-visao-geral-insights"
    >
      <ul className="flex flex-col gap-2">
        {insights.map((ins, i) => {
          const tone = (ins.tone in INSIGHT_ICON ? ins.tone : "neutral") as keyof typeof INSIGHT_ICON;
          const Icon = INSIGHT_ICON[tone];
          return (
            <li
              key={i}
              className="flex items-start gap-2.5 rounded-md border border-border-subtle bg-surface px-3 py-2 text-body-sm text-fg-secondary"
              data-testid="km-visao-geral-insight"
              data-tone={tone}
            >
              <Icon className={cn("mt-0.5 size-4 shrink-0", INSIGHT_TONE[tone])} aria-hidden />
              <span className="sr-only">{INSIGHT_SR[tone]}: </span>
              <span className="min-w-0">{ins.text}</span>
            </li>
          );
        })}
      </ul>
    </ChartCard>
  );
}
