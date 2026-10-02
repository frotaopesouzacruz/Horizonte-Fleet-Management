"use client";

import * as React from "react";
import { ChartCard, ColumnChart, SrTable, type ColumnDatum } from "@/components/charts";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  Table, TableBody, TableCell, TableContainer, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import type { KmDailyBand, KmDailyGroup, KmDailyMissing } from "@/lib/km/daily";
import { fmtInt, fmtKm1, fmtPct, kmStatusLabel, kmStatusTone } from "@/lib/km/types";
import type { KmPanelContext } from "../../shared";
import { shareOf, statusToneOf, VehicleRef } from "../overview/km-ui";

/** Quantos veículos em cada faixa de KM do dia (só quem tem KM validado). */
export function BandsCard({ bands, hasKm }: { bands: KmDailyBand[]; hasKm: boolean }) {
  const total = bands.reduce((acc, b) => acc + b.vehicles, 0);
  const items: ColumnDatum[] = bands.map((b) => ({
    key: b.band,
    label: b.label,
    value: b.vehicles,
    color: b.band === "b0" ? "var(--chart-neutral)" : "var(--chart-brand-primary)",
    tooltip: {
      title: b.label,
      rows: [
        { label: "Veículos", value: fmtInt(b.vehicles), emphasis: true },
        { label: "Participação", value: fmtPct(shareOf(b.vehicles, total)) },
      ],
      announce: `${b.label}: ${fmtInt(b.vehicles)} veículos.`,
    },
  }));
  return (
    <ChartCard
      title="Distribuição por faixa de KM"
      description="Veículos com KM validado no dia, por faixa. Sem leitura fica fora; Sem movimento tem faixa própria."
      empty={!hasKm || bands.length === 0 ? "Nenhum veículo com KM validado neste dia." : undefined}
      data-testid="km-diaria-bands"
    >
      <ColumnChart items={items} ariaLabel="Veículos por faixa de KM no dia" format={fmtInt} kind="count" height={170} />
      <SrTable
        caption="Veículos por faixa de KM no dia"
        columns={["Faixa", "Veículos"]}
        rows={bands.map((b) => ({ key: b.band, cells: [b.label, fmtInt(b.vehicles)] }))}
      />
    </ChartCard>
  );
}

/** KM, veículos e com leitura por um agrupamento (operação, local, BR, liderança, tipo). */
export function GroupCard({ title, groupLabel, rows, testId }: { title: string; groupLabel: string; rows: KmDailyGroup[]; testId: string }) {
  return (
    <ChartCard title={title} empty={rows.length === 0 ? "Sem frotas no recorte." : undefined} data-testid={testId}>
      <TableContainer maxHeight={300} stickyHeader>
        <Table>
          <caption className="sr-only">{title}</caption>
          <TableHeader>
            <TableRow>
              <TableHead>{groupLabel}</TableHead>
              <TableHead numeric>KM</TableHead>
              <TableHead numeric>Veículos</TableHead>
              <TableHead numeric>Com leitura</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((g) => (
              <TableRow key={g.label}>
                <TableHead scope="row" className="max-w-48 truncate font-normal text-fg" title={g.label}>
                  {g.label}
                </TableHead>
                <TableCell numeric className="whitespace-nowrap font-semibold">
                  {/* ninguém com leitura: não é 0 km */}
                  {g.withReading === 0 ? <span className="font-normal text-fg-muted">Sem leitura</span> : fmtKm1(g.km)}
                </TableCell>
                <TableCell numeric>{fmtInt(g.vehicles)}</TableCell>
                <TableCell numeric>
                  {fmtInt(g.withReading)}
                  <span className="ml-1 text-caption text-fg-muted">({fmtPct(shareOf(g.withReading, g.vehicles))})</span>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
    </ChartCard>
  );
}

/**
 * Frotas sem leitura no dia (mesmo número do KPI "Sem leitura"). As leituras
 * inconsistentes também não têm KM válido, mas são listadas em Inconsistências.
 */
export function WithoutReadingCard({ rows, ctx }: { rows: KmDailyMissing[]; ctx: KmPanelContext }) {
  const missing = rows.filter((r) => r.status !== "inconsistent");
  const inconsistent = rows.length - missing.length;
  return (
    <ChartCard
      title={`Sem leitura no dia (${fmtInt(missing.length)})`}
      description={
        <>
          Frotas sem informação confiável de hodômetro no dia — não é 0 km e não entram no ranking.
          {inconsistent > 0
            ? ` ${fmtInt(inconsistent)} ${inconsistent === 1 ? "leitura inconsistente (sem KM válido) está" : "leituras inconsistentes (sem KM válido) estão"} em Inconsistências.`
            : ""}
        </>
      }
      empty={missing.length === 0 ? "Todas as frotas do recorte têm leitura neste dia." : undefined}
      data-testid="km-diaria-without-reading"
    >
      <TableContainer maxHeight={360} stickyHeader>
        <Table>
          <caption className="sr-only">Frotas sem leitura no dia</caption>
          <TableHeader>
            <TableRow>
              <TableHead>Veículo</TableHead>
              <TableHead>Tipo · modelo</TableHead>
              <TableHead>Local</TableHead>
              <TableHead>BR</TableHead>
              <TableHead>Situação</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {missing.map((r) => (
              <TableRow key={r.vehicleId} data-testid="km-diaria-without-reading-row">
                <TableCell className="whitespace-nowrap">
                  <VehicleRef ctx={ctx} vehicleId={r.vehicleId} fleetCode={r.fleetCode} plate={r.plate} />
                </TableCell>
                <TableCell className="max-w-48 truncate text-fg-secondary">
                  {[r.type, r.model].filter(Boolean).join(" · ") || "—"}
                </TableCell>
                <TableCell className="max-w-40 truncate">{r.local ?? "—"}</TableCell>
                <TableCell className="whitespace-nowrap">{r.br ?? "—"}</TableCell>
                <TableCell className="whitespace-nowrap">
                  <StatusBadge size="sm" status={statusToneOf(kmStatusTone(r.status))}>
                    {kmStatusLabel(r.status)}
                  </StatusBadge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
    </ChartCard>
  );
}
