"use client";

import * as React from "react";
import { cn } from "@/lib/cn";
import { ChartCard } from "@/components/charts";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  Table, TableBody, TableCell, TableContainer, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import type { KmOverviewData } from "@/lib/km/overview";
import { byCode, fmtInt, fmtPct, formatDate, KM_FRESHNESS, type KmFreshnessBucket } from "@/lib/km/types";
import type { KmPanelContext } from "../../shared";
import { addDays, shareOf, statusToneOf, useViewParam, VehicleRef } from "./km-ui";

/** Cor da faixa (classe do design system); o rótulo e a contagem vão sempre junto. */
const BUCKET_FILL: Record<KmFreshnessBucket, string> = {
  updated: "bg-success",
  d1: "bg-info",
  d2_3: "bg-warning/60",
  d4_7: "bg-warning",
  d7_plus: "bg-danger",
  never: "bg-neutral/50",
};

const ALL = "todas";
const BUCKET_LABEL = Object.fromEntries(KM_FRESHNESS.map((b) => [b.key, b.label])) as Record<KmFreshnessBucket, string>;

/**
 * Atualização da frota (§26): dias desde a última leitura, contados até ontem.
 * Clicar numa faixa lista as frotas ativas dela que estão sem leitura no dia
 * de referência (`missing_vehicles`, já com faixa e dias sem leitura).
 */
export function FreshnessCard({ data, ctx }: { data: KmOverviewData; ctx: KmPanelContext }) {
  const [selected, setSelected] = useViewParam("atualizacao");
  const listId = React.useId();
  const counts = KM_FRESHNESS.map((b) => ({ ...b, count: byCode(data.freshness, b.key) ?? 0 }));
  const total = counts.reduce((acc, b) => acc + b.count, 0);
  const missing = data.missingVehicles;
  const yesterday = addDays(data.period.today, -1);
  const active = selected === ALL || KM_FRESHNESS.some((b) => b.key === selected) ? selected : null;
  const rows = active === ALL ? missing : active ? missing.filter((m) => m.bucket === active) : [];
  const toggle = (key: string) => setSelected(active === key ? null : key);
  const refDay = data.period.referenceDay;

  return (
    <ChartCard
      title="Atualização da frota"
      description={
        <>
          Dias desde a última leitura, contados até ontem ({formatDate(yesterday)}). Clique numa faixa para ver as frotas
          ativas dela que estão sem leitura no dia de referência{refDay ? ` (${formatDate(refDay)})` : ""}.
        </>
      }
      data-testid="km-visao-geral-freshness"
      className="h-full"
      actions={
        missing.length > 0 ? (
          <button
            type="button"
            onClick={() => toggle(ALL)}
            aria-pressed={active === ALL}
            aria-controls={listId}
            className={cn(
              "rounded-sm px-2 py-1 text-body-sm font-medium text-link underline-offset-4 hover:underline hfm-focus-ring",
              active === ALL && "bg-selected-overlay",
            )}
            data-testid="km-visao-geral-freshness-all"
          >
            Todas sem leitura no dia ({fmtInt(missing.length)})
          </button>
        ) : null
      }
      empty={total === 0 ? "Nenhuma frota no recorte dos filtros." : undefined}
    >
      <div className="flex flex-col gap-4">
        {/* barra proporcional: atalho visual; os botões da lista abaixo são o controle acessível */}
        <div className="flex h-3 w-full overflow-hidden rounded-full bg-surface-sunken" aria-hidden>
          {counts.map((b) =>
            b.count > 0 ? (
              <button
                key={b.key}
                type="button"
                tabIndex={-1}
                onClick={() => toggle(b.key)}
                className={cn(
                  "h-full cursor-pointer border-r border-surface-raised last:border-r-0 hfm-transition hover:opacity-80",
                  BUCKET_FILL[b.key],
                  active && active !== ALL && active !== b.key && "opacity-40",
                )}
                style={{ width: `${(b.count / total) * 100}%` }}
                title={`${b.label}: ${fmtInt(b.count)}`}
              />
            ) : null,
          )}
        </div>

        <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2" aria-label="Faixas de atualização">
          {counts.map((b) => {
            const pressed = active === b.key;
            return (
              <li key={b.key}>
                <button
                  type="button"
                  onClick={() => toggle(b.key)}
                  aria-pressed={pressed}
                  aria-controls={listId}
                  disabled={b.count === 0}
                  className={cn(
                    "flex w-full items-center gap-2.5 rounded-md border px-3 py-2 text-left hfm-transition hfm-focus-ring",
                    "disabled:cursor-default disabled:opacity-60",
                    pressed ? "border-primary bg-selected-overlay" : "border-border-subtle hover:bg-hover-overlay",
                  )}
                  data-testid={`km-visao-geral-freshness-${b.key}`}
                >
                  <span aria-hidden className={cn("size-3 shrink-0 rounded-[3px]", BUCKET_FILL[b.key])} />
                  <span className="min-w-0 flex-1 truncate text-body-sm text-fg-secondary">{b.label}</span>
                  <span className="shrink-0 text-body-sm font-semibold tabular-nums text-fg">{fmtInt(b.count)}</span>
                  <span className="w-14 shrink-0 text-right text-caption tabular-nums text-fg-muted">
                    {fmtPct(shareOf(b.count, total))}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>

        <div id={listId} aria-live="polite">
          {active ? (
            rows.length > 0 ? (
              <TableContainer maxHeight={320} stickyHeader data-testid="km-visao-geral-freshness-list">
                <Table>
                  <caption className="sr-only">
                    Frotas ativas sem leitura no dia de referência
                    {active === ALL ? "" : ` — faixa ${BUCKET_LABEL[active as KmFreshnessBucket]}`}
                  </caption>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Veículo</TableHead>
                      <TableHead>Última leitura</TableHead>
                      <TableHead numeric>Dias sem leitura</TableHead>
                      <TableHead>Faixa</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((m) => {
                      const meta = KM_FRESHNESS.find((b) => b.key === m.bucket);
                      return (
                        <TableRow key={m.vehicleId}>
                          <TableCell className="whitespace-nowrap">
                            <VehicleRef ctx={ctx} vehicleId={m.vehicleId} fleetCode={m.fleetCode} plate={m.plate} />
                          </TableCell>
                          <TableCell className="whitespace-nowrap tabular-nums">
                            {m.lastReadingDate ? formatDate(m.lastReadingDate) : "Nunca"}
                          </TableCell>
                          <TableCell numeric>{m.missingDays == null ? "—" : fmtInt(m.missingDays)}</TableCell>
                          <TableCell className="whitespace-nowrap">
                            <StatusBadge size="sm" status={statusToneOf(meta?.tone)}>
                              {meta?.label ?? m.bucket}
                            </StatusBadge>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </TableContainer>
            ) : (
              <p className="rounded-md border border-dashed border-border px-3 py-4 text-center text-body-sm text-fg-muted">
                {active === "updated"
                  ? `${fmtInt(byCode(data.freshness, "updated") ?? 0)} frotas têm leitura de ontem (${formatDate(yesterday)}) ou mais recente. A lista mostra só frotas ativas sem leitura no dia de referência.`
                  : "Nenhuma frota ativa desta faixa está sem leitura no dia de referência."}
              </p>
            )
          ) : null}
        </div>
      </div>
    </ChartCard>
  );
}
