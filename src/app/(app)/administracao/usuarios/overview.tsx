"use client";

import * as React from "react";
import { Building2, Network, UserCheck, Users as UsersIcon, UserX } from "lucide-react";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { KpiCard, kpiCardVariants } from "@/components/ui/kpi-card";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Alert, AlertDescription, AlertTitle } from "@/components/feedback/alert";
import type { EmployeeSummary } from "@/lib/admin/queries";

/**
 * The indicator row of Administração → Usuários.
 *
 * It lives in its own file because the route streams it: the table is rendered
 * and usable while these five numbers are still being aggregated, and a failure
 * here costs the reader the cards, not the page.
 */

const numberFormat = new Intl.NumberFormat("pt-BR");

/**
 * The five cards, laid out.
 *
 * One row from 1280px up, where 220px per card is still enough for the longest
 * label without shrinking a single font. Below that, three and two — with the
 * label height reserved for two lines everywhere, so the five numbers stay on
 * one baseline whichever row they land in.
 */
const GRID = "grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5";

/**
 * Five cards, one baseline.
 *
 * The labels are not all one line — "Colaboradores por operação" wraps where
 * "Ativos" does not — and a centred card would then put its number at a
 * different height from its neighbours. Reserving two lines for every label and
 * stacking from the top lines the five numbers up, which is what makes the row
 * read as one instrument instead of five.
 */
function kpiLabel(text: string) {
  return <span className="block min-h-11 leading-snug">{text}</span>;
}

/**
 * "94% do total" under a number, or nothing when there is no total to be a
 * share of. A percentage of zero people is not 0% — it is not a fact.
 */
function shareOf(value: number, total: number): string | undefined {
  if (total <= 0) return undefined;
  return `${Math.round((value / total) * 100)}% do total`;
}

export interface OverviewCardsProps {
  summary: EmployeeSummary;
  /** The operation currently filtered, if any. Makes the second card contextual. */
  operationId?: string;
}

export function OverviewCards({ summary, operationId }: OverviewCardsProps) {
  const selected = operationId
    ? summary.byOperation.find((entry) => entry.operationId === operationId)
    : undefined;

  /**
   * Afastados and desligados are neither "ativo" nor "inativo". Printing them
   * under the Inativos card is what lets the five numbers reconcile with the
   * total without inventing a rule that folds them into one of the two.
   */
  const otherSituations =
    [
      summary.onLeave > 0 ? `${numberFormat.format(summary.onLeave)} afastado(s)` : null,
      summary.terminated > 0 ? `${numberFormat.format(summary.terminated)} desligado(s)` : null,
    ]
      .filter(Boolean)
      .join(" · ") || undefined;

  return (
<div className={GRID}>
      <KpiCard
        className="min-h-28 justify-start"
        label={kpiLabel("Total de colaboradores")}
        value={summary.total}
        period={
          summary.withAccess > 0
            ? `${numberFormat.format(summary.withAccess)} com acesso ao HFM`
            : "Nenhum com acesso ao HFM"
        }
        icon={<UsersIcon aria-hidden />}
      />

      <OperationHeadcountCard summary={summary} selected={selected} />

      <KpiCard
        className="min-h-28 justify-start"
        status="success"
        label={kpiLabel("Ativos")}
        value={summary.active}
        period={shareOf(summary.active, summary.total)}
        icon={<UserCheck aria-hidden />}
      />

      {/* "Inativo" é exatamente employment_status = 'inactive'. Afastados
          e desligados não são inativos: aparecem ao lado para que a soma
          feche com o total sem que se invente uma regra. */}
      <KpiCard
        className="min-h-28 justify-start"
        label={kpiLabel("Inativos")}
        value={summary.inactive}
        period={otherSituations ?? shareOf(summary.inactive, summary.total)}
        icon={<UserX aria-hidden />}
      />

      <KpiCard
        className="min-h-28 justify-start"
        label={kpiLabel("Vinculados à liderança")}
        value={summary.withLeader}
        period={
          summary.withoutLeader > 0
            ? `${numberFormat.format(summary.withoutLeader)} sem vínculo`
            : "Todos com líder definido"
        }
        icon={<Network aria-hidden />}
      />
    </div>
  );
}

/** Same shape, no numbers yet. Five skeletons, not one blocked page. */
export function OverviewSkeleton() {
  return (
    <div className={GRID}>
      {Array.from({ length: 5 }, (_, index) => (
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

/** The indicators failed; the table below did not. Say so, and offer a retry. */
export function OverviewError({ onRetry }: { onRetry?: () => void }) {
  return (
    <Alert variant="warning">
      <AlertTitle>Não foi possível carregar os indicadores</AlertTitle>
      <AlertDescription className="flex flex-wrap items-center gap-3">
        <span>A lista de colaboradores abaixo continua disponível.</span>
        {onRetry ? (
          <Button size="sm" variant="secondary" onClick={onRetry}>
            Tentar novamente
          </Button>
        ) : null}
      </AlertDescription>
    </Alert>
  );
}

/* -------------------------------------------------------------------------- */
/* Headcount by operation                                                     */
/* -------------------------------------------------------------------------- */

const TOP_OPERATIONS = 3;

/**
 * The second indicator, and the only one that is not a single number.
 *
 * "4 operações" would have been the easy card and the useless one: the question
 * here is how many *people* are in each operation, not how many operations
 * exist. So with an operation filtered the card answers about that operation,
 * and without one it shows the largest three by headcount with the rest behind
 * a link.
 *
 * It borrows `kpiCardVariants` rather than re-styling a box, so it sits in the
 * row as one of the five and not as a visitor.
 */
function OperationHeadcountCard({
  summary,
  selected,
}: {
  summary: EmployeeSummary;
  selected?: EmployeeSummary["byOperation"][number];
}) {
  // With an operation filtered the card answers about that operation, by name,
  // in people — which is the question somebody filtering by operation has.
  if (selected) {
    return (
      <KpiCard
        className="min-h-28 justify-start"
        label={kpiLabel(selected.operationName)}
        value={selected.count}
        unit={selected.count === 1 ? "colaborador" : "colaboradores"}
        period={selected.operationCode ?? undefined}
        icon={<Building2 aria-hidden />}
      />
    );
  }

  const ranked = summary.byOperation;
  const top = ranked.slice(0, TOP_OPERATIONS);
  const remaining = ranked.length - top.length;

  return (
    <section className={cn(kpiCardVariants(), "min-h-28 justify-start gap-2")}>
      <header className="flex items-start justify-between gap-2">
        <h3 className="min-w-0 text-body-sm font-medium text-fg-secondary">Colaboradores por operação</h3>
        <span className="shrink-0 text-fg-muted [&_svg]:size-[18px] [&_svg]:shrink-0" aria-hidden>
          <Building2 />
        </span>
      </header>

      {top.length === 0 ? (
        <p className="text-caption text-fg-muted">Nenhuma operação com colaboradores.</p>
      ) : (
        <ul className="flex flex-col gap-0.5">
          {top.map((entry) => (
            <li
              key={entry.operationId ?? "sem-operacao"}
              className="flex items-baseline justify-between gap-2 text-caption"
            >
              <span
                className={cn("truncate", entry.operationId ? "text-fg-secondary" : "text-fg-muted")}
                title={entry.operationName}
              >
                {entry.operationName}
              </span>
              <span className="shrink-0 font-semibold text-fg tabular-nums">
                {numberFormat.format(entry.count)}
              </span>
            </li>
          ))}
        </ul>
      )}

      <OperationDistribution
        summary={summary}
        label={remaining > 0 ? `+ ${numberFormat.format(remaining)} operaç${remaining === 1 ? "ão" : "ões"}` : "Ver distribuição"}
      />
    </section>
  );
}

/**
 * The whole distribution, ranked, with a proportional bar per operation.
 *
 * A bar per row rather than a donut: the question people actually ask here is
 * "which operation is biggest, and by how much", and a ranked bar answers it by
 * length, which the eye compares reliably. "Sem operação" is always shown,
 * last, even at zero — a blank where that number should be is how it stays
 * invisible for months.
 */
function OperationDistribution({ summary, label }: { summary: EmployeeSummary; label: string }) {
  const largest = summary.byOperation.reduce((max, entry) => Math.max(max, entry.count), 0);
  const rows = summary.byOperation.some((entry) => entry.operationId === null)
    ? summary.byOperation
    : [
        ...summary.byOperation,
        { operationId: null, operationName: "Sem operação", operationCode: null, count: 0 },
      ];

  return (
    <Popover>
      <PopoverTrigger asChild>
        {/* `text-link` rather than `text-primary`: the brand blue is tuned for a
            button's fill, and as small text on the card's surface it does not
            clear contrast in the dark theme. */}
        <Button variant="link" size="sm" className="self-start text-caption">
          {label}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-84">
        <div className="flex flex-col gap-3">
          <div>
            <p className="text-h4 font-semibold text-fg">Colaboradores por operação</p>
            <p className="text-caption text-fg-muted">
              {numberFormat.format(summary.total)} colaborador(es) com os filtros atuais.
            </p>
          </div>

          <ul className="flex max-h-80 flex-col gap-2.5 overflow-y-auto">
            {rows.map((entry) => {
              const share = summary.total > 0 ? Math.round((entry.count / summary.total) * 100) : 0;
              return (
                <li key={entry.operationId ?? "sem-operacao"} className="flex flex-col gap-1">
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
