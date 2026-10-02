"use client";

import * as React from "react";
import { ChartCard, HBarChart, SrTable, type HBarDatum } from "@/components/charts";
import type { KmOverviewData } from "@/lib/km/overview";
import { byCode, camelCode, fmtInt, fmtKm, fmtPct, KM_STATUS, type KmReadingStatus } from "@/lib/km/types";
import { chartColorOf, shareOf } from "./km-ui";

/** KM por operação e por tipo — barras horizontais, na ordem da rotina (maior KM primeiro). */
export function KmShareCard({
  title, description, rows, testId, empty,
}: {
  title: string;
  description: React.ReactNode;
  rows: { key: string; label: string; km: number | null; vehicles: number }[];
  testId: string;
  /** Mensagem no lugar das barras (ex.: período sem KM validado — não desenhar 0 km). */
  empty?: string;
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
    <ChartCard
      title={title}
      description={description}
      empty={empty ?? (rows.length === 0 ? "Sem dados no recorte." : undefined)}
      data-testid={testId}
    >
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
  const known = new Set<string>([...STATUS_ORDER, ...STATUS_ORDER.map(camelCode)]);
  const extra = Object.keys(counts).filter((k) => !known.has(k));
  const total = Object.values(counts).reduce((acc, n) => acc + (n ?? 0), 0);
  const rows = [...STATUS_ORDER, ...extra].map((code) => {
    const meta = KM_STATUS[code as KmReadingStatus];
    return { code, label: meta?.label ?? code, tone: meta?.tone ?? "neutral", n: byCode(counts, code) ?? 0, description: meta?.description };
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
