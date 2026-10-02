"use client";

import * as React from "react";
import { ChartCard } from "@/components/charts/chart-card";
import { HBarChart } from "@/components/charts/bar-charts";
import { SrTable } from "@/components/charts/sr-table";
import {
  Table, TableBody, TableCaption, TableCell, TableContainer, TableFooter, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/cn";
import type { KmAnalysisData, KmAnalysisOperationRow } from "@/lib/km/analysis";
import { fmt1, fmtInt, fmtKm, fmtKm1, fmtPct } from "@/lib/km/types";
import { signedPct, SortHead, useSorted } from "./shared";

/**
 * Análise gerencial → Por operação. KM, veículos, média/mediana/P90 por
 * veículo, KM/dia, cobertura, desvio contra a média geral e participação —
 * todos devolvidos pela rotina. A tela só ordena.
 */
type Key = "operation" | "km" | "vehicles" | "avg" | "median" | "p90" | "perDay" | "coverage" | "deviation" | "share";

const ACCESSORS: Record<Key, (r: KmAnalysisOperationRow) => number | string | null> = {
  operation: (r) => r.operation,
  km: (r) => r.km,
  vehicles: (r) => r.vehicles,
  avg: (r) => r.avgPerVehicle,
  median: (r) => r.medianPerVehicle,
  p90: (r) => r.p90PerVehicle,
  perDay: (r) => r.kmPerDay,
  coverage: (r) => r.coveragePct,
  deviation: (r) => r.deviationVsOverallPct,
  share: (r) => r.sharePct,
};

export function OperationView({ data }: { data: KmAnalysisData }) {
  const rows = React.useMemo(() => data.byOperation ?? [], [data.byOperation]);
  const { sorted, sort, setSort } = useSorted(rows, ACCESSORS, { key: "km", dir: "desc" });
  const totals = data.totals;

  const byKm = React.useMemo(() => [...rows].sort((a, b) => (b.km ?? 0) - (a.km ?? 0)), [rows]);
  const chartItems = React.useMemo(
    () =>
      byKm.map((r) => ({
        key: r.operationId ?? `sem:${r.operation}`,
        label: r.operation,
        value: r.km,
        detail: r.sharePct != null ? `· ${fmtPct(r.sharePct)}` : undefined,
        tooltip: {
          title: r.operation,
          rows: [
            { label: "KM no período", value: fmtKm1(r.km), emphasis: true },
            { label: "Participação", value: fmtPct(r.sharePct) },
            { label: "Veículos", value: fmtInt(r.vehicles) },
            { label: "Média por veículo", value: fmtKm1(r.avgPerVehicle) },
            { label: "KM/dia", value: fmtKm1(r.kmPerDay) },
            { label: "Cobertura", value: fmtPct(r.coveragePct) },
          ],
          announce: `${r.operation}: ${fmtKm1(r.km)}, ${fmtPct(r.sharePct)} do total.`,
        },
      })),
    [byKm],
  );

  if (rows.length === 0) {
    return (
      <p className="rounded-md border border-dashed border-border px-4 py-8 text-center text-body-sm text-fg-muted">
        Sem KM por operação no período e filtros escolhidos.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-4" data-testid="km-analise-operacao">
      <ChartCard
        title="KM por operação"
        description="KM validado no período, por operação vigente na data da leitura."
        headingLevel={3}
      >
        <HBarChart
          items={chartItems}
          ariaLabel="KM rodado por operação no período"
          format={(v) => fmtKm(v)}
          labelWidth={200}
        />
        <SrTable
          caption="KM por operação"
          columns={["Operação", "KM", "Participação", "Veículos"]}
          rows={byKm.map((r) => ({
            key: r.operationId ?? `sem:${r.operation}`,
            cells: [r.operation, fmtKm1(r.km), fmtPct(r.sharePct), fmtInt(r.vehicles)],
          }))}
        />
      </ChartCard>

      <TableContainer>
        <Table className="min-w-[1080px]" data-testid="km-analise-operacao-tabela">
          <TableCaption>
            Desvio vs média geral: média por veículo da operação comparada à média por veículo de todas as operações.
          </TableCaption>
          <TableHeader>
            <TableRow>
              <SortHead sortKey="operation" sort={sort} onSort={setSort} className="w-56">Operação</SortHead>
              <SortHead sortKey="km" sort={sort} onSort={setSort} numeric>KM</SortHead>
              <SortHead sortKey="vehicles" sort={sort} onSort={setSort} numeric>Veículos</SortHead>
              <SortHead sortKey="avg" sort={sort} onSort={setSort} numeric>Média/veículo</SortHead>
              <SortHead sortKey="median" sort={sort} onSort={setSort} numeric>Mediana/veículo</SortHead>
              <SortHead sortKey="p90" sort={sort} onSort={setSort} numeric>P90/veículo</SortHead>
              <SortHead sortKey="perDay" sort={sort} onSort={setSort} numeric>KM/dia</SortHead>
              <SortHead sortKey="coverage" sort={sort} onSort={setSort} numeric>Cobertura</SortHead>
              <SortHead sortKey="deviation" sort={sort} onSort={setSort} numeric>Desvio vs média</SortHead>
              <SortHead sortKey="share" sort={sort} onSort={setSort} numeric>Participação</SortHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sorted.map((r) => (
              <TableRow key={r.operationId ?? `sem:${r.operation}`}>
                <TableCell className="font-medium" truncate title={r.operation}>
                  {r.operation}
                </TableCell>
                <TableCell numeric>{fmtKm1(r.km)}</TableCell>
                <TableCell numeric>{fmtInt(r.vehicles)}</TableCell>
                <TableCell numeric>{fmtKm1(r.avgPerVehicle)}</TableCell>
                <TableCell numeric>{fmtKm1(r.medianPerVehicle)}</TableCell>
                <TableCell numeric>{fmtKm1(r.p90PerVehicle)}</TableCell>
                <TableCell numeric>{fmtKm1(r.kmPerDay)}</TableCell>
                <TableCell numeric>{fmtPct(r.coveragePct)}</TableCell>
                <TableCell
                  numeric
                  className={cn(
                    r.deviationVsOverallPct != null && r.deviationVsOverallPct > 0 && "text-warning-soft-fg",
                    r.deviationVsOverallPct != null && r.deviationVsOverallPct < 0 && "text-info-soft-fg",
                  )}
                >
                  {signedPct(r.deviationVsOverallPct)}
                </TableCell>
                <TableCell numeric>{fmtPct(r.sharePct)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
          {totals ? (
            <TableFooter>
              <TableRow>
                <TableHead scope="row" className="text-left">Total do período</TableHead>
                <TableCell numeric className="font-semibold text-fg">{fmtKm1(totals.km)}</TableCell>
                <TableCell numeric className="font-semibold text-fg">{fmtInt(totals.vehicles)}</TableCell>
                <TableCell colSpan={7} className="text-fg-muted">
                  {totals.days != null ? `${fmtInt(totals.days)} dia(s) com KM válido no período.` : null}
                </TableCell>
              </TableRow>
            </TableFooter>
          ) : null}
        </Table>
      </TableContainer>
      <p className="text-caption text-fg-muted">
        KM/dia = KM da operação ÷ dias com KM válido no período ({fmt1(totals?.days ?? null)} dias). Sem leitura não entra
        como zero.
      </p>
    </div>
  );
}
