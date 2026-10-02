"use client";

import * as React from "react";
import { cn } from "@/lib/cn";
import { ChartCard } from "@/components/charts";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  Table, TableBody, TableCell, TableContainer, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import type { KmDailyRankRow } from "@/lib/km/daily";
import { fmt2, fmtInt, fmtKm1, kmStatusLabel, kmStatusTone } from "@/lib/km/types";
import type { KmPanelContext } from "../../shared";
import { statusToneOf, useViewParam, VehicleRef } from "../overview/km-ui";

const SIZES = [
  { key: "10", label: "Top 10", n: 10 },
  { key: "20", label: "Top 20", n: 20 },
  { key: "todos", label: "Todos", n: Infinity },
] as const;

/** Botões de escolha única, com a aparência das abas segmentadas. */
/** Célula de duas linhas: o dado principal e o contexto abaixo, sem colunas extras. */
function TwoLine({ main, sub }: { main: React.ReactNode; sub: React.ReactNode }) {
  return (
    <div className="flex min-w-0 max-w-56 flex-col">
      <span className="truncate whitespace-nowrap">{main}</span>
      <span className="truncate text-caption text-fg-muted">{sub}</span>
    </div>
  );
}

export function Segmented({
  label, value, options, onChange, testId,
}: {
  label: string;
  value: string;
  options: readonly { key: string; label: string }[];
  onChange: (key: string) => void;
  testId?: string;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className="inline-flex w-fit gap-0.5 rounded-sm border border-border bg-surface-secondary p-0.5"
      data-testid={testId}
    >
      {options.map((o) => {
        const on = o.key === value;
        return (
          <button
            key={o.key}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(o.key)}
            className={cn(
              "inline-flex h-7 items-center whitespace-nowrap rounded-xs px-3 text-body-sm font-medium hfm-transition hfm-focus-ring",
              on ? "bg-surface text-fg shadow-xs" : "text-fg-secondary hover:text-fg",
            )}
            data-testid={testId ? `${testId}-${o.key}` : undefined}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Ranking do dia: a lista já vem ordenada pela rotina (maior KM primeiro) e só
 * com KM validado. A tela apenas fatia Top 10 / Top 20 / Todos.
 */
export function RankingCard({ rows, ctx }: { rows: KmDailyRankRow[]; ctx: KmPanelContext }) {
  const [param, setParam] = useViewParam("dia_ranking");
  const size = SIZES.find((s) => s.key === param) ?? SIZES[0];
  const shown = rows.slice(0, size.n);

  return (
    <ChartCard
      title="Ranking de rodagem do dia"
      description={
        <>
          Só veículos com KM validado no dia, do maior para o menor. Sem leitura nunca entra no ranking como menor rodagem
          — está na lista “Sem leitura no dia”. Sem movimento é leitura válida com deslocamento na tolerância e fica no fim.
        </>
      }
      actions={
        <Segmented
          label="Quantidade de veículos no ranking"
          value={size.key}
          options={SIZES}
          onChange={(k) => setParam(k === "10" ? null : k)}
          testId="km-diaria-ranking-size"
        />
      }
      empty={rows.length === 0 ? "Nenhum veículo com KM validado neste dia." : undefined}
      footer={
        rows.length > 0 ? (
          <span className="text-caption text-fg-muted" aria-live="polite">
            Mostrando {fmtInt(shown.length)} de {fmtInt(rows.length)} veículos com KM validado.
          </span>
        ) : undefined
      }
      data-testid="km-diaria-ranking"
    >
      <TableContainer maxHeight={size.n > 20 ? 560 : undefined} stickyHeader={size.n > 20}>
        <Table>
          <caption className="sr-only">Ranking de rodagem do dia — {size.label}</caption>
          <TableHeader>
            <TableRow>
              <TableHead numeric className="w-10">#</TableHead>
              <TableHead>Veículo · tipo e modelo</TableHead>
              <TableHead>Operação · liderança</TableHead>
              <TableHead>Local · BR</TableHead>
              <TableHead numeric>Hod. inicial</TableHead>
              <TableHead numeric>Hod. final</TableHead>
              <TableHead numeric>KM</TableHead>
              <TableHead>Situação</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {shown.map((r, i) => (
              <TableRow key={r.vehicleId} data-testid="km-diaria-ranking-row">
                <TableCell numeric className="text-fg-muted">{i + 1}</TableCell>
                <TableCell>
                  <TwoLine
                    main={<VehicleRef ctx={ctx} vehicleId={r.vehicleId} fleetCode={r.fleetCode} plate={r.plate} />}
                    sub={[r.type, r.model].filter(Boolean).join(" · ") || "—"}
                  />
                </TableCell>
                <TableCell>
                  <TwoLine main={r.operation ?? "—"} sub={r.leader ? `Liderança: ${r.leader}` : "Sem liderança"} />
                </TableCell>
                <TableCell>
                  <TwoLine main={r.local ?? "—"} sub={r.br ? `BR ${r.br}` : "Sem BR"} />
                </TableCell>
                <TableCell numeric className="whitespace-nowrap">{fmt2(r.odometerStart)}</TableCell>
                <TableCell numeric className="whitespace-nowrap">{fmt2(r.odometerEnd)}</TableCell>
                <TableCell numeric className="whitespace-nowrap font-semibold">{fmtKm1(r.km)}</TableCell>
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
