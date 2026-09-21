"use client";

import * as React from "react";
import { Building2, CircleSlash, KeyRound, Truck, Wallet, XCircle, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { KpiCard } from "@/components/ui/kpi-card";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Alert, AlertDescription, AlertTitle } from "@/components/feedback/alert";
import type { VehicleSummary } from "@/lib/fleet/queries";

/**
 * The indicator row of Gestão de frota → Cadastro de frotas.
 *
 * Its own file because the route streams it: the table is rendered and usable
 * while these six numbers are still being aggregated, and a failure here costs
 * the reader the cards, not the page.
 */

const numberFormat = new Intl.NumberFormat("pt-BR");
const currencyFormat = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
  maximumFractionDigits: 0,
});

/**
 * Six cards on one row from 1280px up. Below that, three and three, then two.
 * Every label reserves two lines so the six numbers share one baseline
 * whichever row they land in — that is what makes the row read as one
 * instrument rather than six boxes.
 */
const GRID = "grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6";

function kpiLabel(text: string) {
  return <span className="block min-h-11 leading-snug">{text}</span>;
}

/** "62% do total", or nothing. A percentage of zero vehicles is not 0%. */
function shareOf(value: number, total: number): string | undefined {
  if (total <= 0) return undefined;
  return `${Math.round((value / total) * 100)}% do total`;
}

export interface FleetOverviewProps {
  summary: VehicleSummary;
  /** The operation currently filtered, if any. */
  operationId?: string;
}

export function OverviewCards({ summary, operationId }: FleetOverviewProps) {
  const selected = operationId
    ? summary.byOperation.find((entry) => entry.operationId === operationId)
    : undefined;

  /**
   * The asset figure is the sum of the values that are known, and it says how
   * many those are. A vehicle whose value nobody has filled in is not a vehicle
   * worth nothing (§15, §43) — printing one total without that qualifier is how
   * an incomplete register turns into a fictional balance sheet.
   */
  const assetLine =
    summary.assetValueKnown > 0
      ? `${currencyFormat.format(summary.assetValueTotal)} em ${numberFormat.format(summary.assetValueKnown)} veículo(s)`
      : "Valor do ativo não informado";

  return (
    <div className={GRID}>
      <KpiCard
        className="min-h-28 justify-start"
        label={kpiLabel(selected ? `Veículos · ${selected.operationName}` : "Total de veículos")}
        value={selected ? selected.count : summary.total}
        period={assetLine}
        icon={<Truck aria-hidden />}
      />

      <KpiCard
        className="min-h-28 justify-start"
        status="success"
        label={kpiLabel("Ativos")}
        value={summary.active}
        period={shareOf(summary.active, summary.total)}
        icon={<CheckCircle2 aria-hidden />}
      />

      {/* Situação cadastral, não situação operacional: um veículo ativo no
          cadastro pode estar em manutenção, e essa é outra informação, de
          outro módulo (§16). */}
      <KpiCard
        className="min-h-28 justify-start"
        label={kpiLabel("Inativos")}
        value={summary.inactive}
        period={shareOf(summary.inactive, summary.total)}
        icon={<XCircle aria-hidden />}
      />

      <KpiCard
        className="min-h-28 justify-start"
        label={kpiLabel("Próprios")}
        value={summary.owned}
        period={shareOf(summary.owned, summary.total)}
        icon={<Wallet aria-hidden />}
      />

      <KpiCard
        className="min-h-28 justify-start"
        label={kpiLabel("Alugados")}
        value={summary.rented}
        period={shareOf(summary.rented, summary.total)}
        icon={<KeyRound aria-hidden />}
      />

      {/* "Sem alocação" é diferente de "inativo" (§24). E um veículo cuja
          transferência já está programada não está sem alocação: está a
          caminho de uma, e aparece na segunda linha em vez de sumir. */}
      <KpiCard
        className="min-h-28 justify-start"
        status={summary.unassigned > 0 ? "warning" : "neutral"}
        label={kpiLabel("Sem alocação")}
        value={summary.unassigned}
        period={
          summary.scheduledOnly > 0
            ? `${numberFormat.format(summary.scheduledOnly)} com transferência programada`
            : shareOf(summary.unassigned, summary.total)
        }
        icon={<CircleSlash aria-hidden />}
      />
    </div>
  );
}

/** Same shape, no numbers yet. Six skeletons, not one blocked page. */
export function OverviewSkeleton() {
  return (
    <div className={GRID}>
      {Array.from({ length: 6 }, (_, index) => (
        <KpiCard
          key={index}
          className="min-h-28 justify-start"
          loading
          loadingLabel="Carregando indicadores…"
          label=""
          value=""
        />
      ))}
    </div>
  );
}

/** The indicators failed; the table below did not. */
export function OverviewError() {
  return (
    <Alert variant="warning">
      <AlertTitle>Não foi possível carregar os indicadores</AlertTitle>
      <AlertDescription>A lista de veículos abaixo continua disponível.</AlertDescription>
    </Alert>
  );
}

/* -------------------------------------------------------------------------- */
/* Distribution by operation                                                  */
/* -------------------------------------------------------------------------- */

/**
 * The whole distribution, ranked, with a proportional bar per operation.
 *
 * A bar per row rather than a donut: the question people ask here is "which
 * operation holds most of the fleet, and by how much", and a ranked bar answers
 * it by length. "Sem alocação" is always present, last, even at zero — a blank
 * where that number should be is how it stays invisible for months.
 */
export function OperationDistribution({ summary }: { summary: VehicleSummary }) {
  const largest = summary.byOperation.reduce((max, entry) => Math.max(max, entry.count), 0);
  const rows = summary.byOperation.some((entry) => entry.operationId === null)
    ? summary.byOperation
    : [...summary.byOperation, { operationId: null, operationName: "Sem alocação", count: 0 }];

  return (
    <Popover>
      <PopoverTrigger asChild>
        {/* `text-link`, not the brand blue: as small text on the page surface
            the button fill colour does not clear contrast in dark mode. */}
        <Button variant="link" size="sm" className="text-caption">
          <Building2 aria-hidden /> Distribuição por operação
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-84">
        <div className="flex flex-col gap-3">
          <div>
            <p className="text-h4 font-semibold text-fg">Veículos por operação</p>
            <p className="text-caption text-fg-muted">
              {numberFormat.format(summary.total)} veículo(s) com os filtros atuais.
            </p>
          </div>

          <ul className="flex max-h-80 flex-col gap-2.5 overflow-y-auto">
            {rows.map((entry) => {
              const share = summary.total > 0 ? Math.round((entry.count / summary.total) * 100) : 0;
              return (
                <li key={entry.operationId ?? "sem-alocacao"} className="flex flex-col gap-1">
                  <div className="flex items-baseline justify-between gap-3">
                    <span
                      className={cn("truncate text-body-sm", entry.operationId ? "text-fg" : "text-fg-muted")}
                      title={entry.operationName}
                    >
                      {entry.operationName}
                    </span>
                    <span className="shrink-0 text-body-sm tabular-nums text-fg-secondary">
                      <span className="font-semibold text-fg">{numberFormat.format(entry.count)}</span>
                      {" · "}
                      {share}%
                    </span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-surface-secondary" aria-hidden>
                    <div
                      className={cn("h-full rounded-full", entry.operationId ? "bg-primary" : "bg-border-strong")}
                      style={{ width: `${largest > 0 ? (entry.count / largest) * 100 : 0}%` }}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      </PopoverContent>
    </Popover>
  );
}
