"use client";

import * as React from "react";
import { ChartCard } from "@/components/charts";
import {
  Table, TableBody, TableCell, TableContainer, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import type { KmOverviewVehicle } from "@/lib/km/overview";
import { fmtInt, fmtKm, fmtKm1 } from "@/lib/km/types";
import type { KmPanelContext } from "../../shared";
import { VehicleRef } from "./km-ui";

/** Top/Bottom 10 do período: a ordem é a da rotina; a tela só lista. */
export function VehicleRankCard({
  ctx, title, description, rows, empty, testId,
}: {
  ctx: KmPanelContext;
  title: string;
  description: React.ReactNode;
  rows: KmOverviewVehicle[];
  empty: string;
  testId: string;
}) {
  return (
    <ChartCard title={title} description={description} empty={rows.length === 0 ? empty : undefined} data-testid={testId}>
      <TableContainer>
        <Table>
          <caption className="sr-only">{title}</caption>
          <TableHeader>
            <TableRow>
              <TableHead numeric className="w-10">#</TableHead>
              <TableHead>Veículo</TableHead>
              <TableHead>Tipo · modelo</TableHead>
              <TableHead numeric>KM no período</TableHead>
              <TableHead numeric>Média/dia</TableHead>
              <TableHead numeric>Dias c/ leitura</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((v, i) => (
              <TableRow key={v.vehicleId} data-testid={`${testId}-row`}>
                <TableCell numeric className="text-fg-muted">{i + 1}</TableCell>
                <TableCell className="whitespace-nowrap">
                  <VehicleRef ctx={ctx} vehicleId={v.vehicleId} fleetCode={v.fleetCode} plate={v.plate} />
                </TableCell>
                <TableCell className="max-w-56 truncate text-fg-secondary" title={[v.type, v.model].filter(Boolean).join(" · ")}>
                  {[v.type, v.model].filter(Boolean).join(" · ") || "—"}
                </TableCell>
                <TableCell numeric className="whitespace-nowrap font-semibold">{fmtKm(v.km)}</TableCell>
                <TableCell numeric className="whitespace-nowrap">{fmtKm1(v.avgDaily)}</TableCell>
                <TableCell numeric>{fmtInt(v.readingDays)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
    </ChartCard>
  );
}
