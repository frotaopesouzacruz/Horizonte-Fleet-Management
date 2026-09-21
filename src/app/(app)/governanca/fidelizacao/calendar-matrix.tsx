"use client";

import * as React from "react";
import { ArrowLeftRight, CircleSlash } from "lucide-react";
import { cn } from "@/lib/cn";
import { Badge } from "@/components/ui/badge";
import { daysInCompetence, weekdayOf, WEEKDAY_INITIALS, type Competence } from "@/lib/governance/competence";
import type { CalendarCell, CalendarRow } from "@/lib/governance/queries";

/** One uninterrupted stretch of the same vínculo on consecutive days. */
interface Run {
  assignmentId: string;
  vehicleId: string | null;
  label: string;
  plate: string | null;
  status: CalendarCell["status"];
  source: string | null;
  startDay: number;
  length: number;
  /** The run opens a new vínculo rather than continuing one from the previous month. */
  opensHere: boolean;
}

const STATUS_STYLE: Record<string, { bar: string; text: string; label: string }> = {
  planned:   { bar: "bg-info-soft border-info", text: "text-info-soft-fg", label: "Planejado" },
  confirmed: { bar: "bg-primary-soft border-primary", text: "text-primary-soft-fg", label: "Confirmado" },
  executed:  { bar: "bg-success-soft border-success", text: "text-success-soft-fg", label: "Executado" },
  cancelled: { bar: "bg-surface-secondary border-border", text: "text-fg-muted", label: "Cancelado" },
};

/**
 * Builds the runs of a row.
 *
 * A run breaks whenever the vínculo changes — including from a vínculo to
 * nothing and back to the same vehicle. §44 is explicit that two periods
 * separated by days without a vehicle must not be drawn joined: they are two
 * decisions, and drawing them as one hides the gap that someone has to explain.
 */
function buildRuns(row: CalendarRow, days: number): Run[] {
  const runs: Run[] = [];
  let current: Run | null = null;

  for (let day = 1; day <= days; day++) {
    const cell = row.days[String(day)];
    const id = cell?.assignmentId ?? null;

    if (!id) {
      current = null;
      continue;
    }

    if (current && current.assignmentId === id) {
      current.length += 1;
      continue;
    }

    current = {
      assignmentId: id,
      vehicleId: cell.vehicleId,
      label: cell.fleetCode ?? cell.licensePlate ?? "Sem identificação",
      plate: cell.licensePlate,
      status: cell.status,
      source: cell.source,
      startDay: day,
      length: 1,
      opensHere: Boolean(cell.startsHere),
    };
    runs.push(current);
  }

  return runs;
}

export interface CalendarMatrixProps {
  rows: CalendarRow[];
  competence: Competence;
  onSelect?: (input: { row: CalendarRow; assignmentId: string | null; day: number }) => void;
}

/**
 * The monthly matrix: BRs down the side, days across the top (§42, §43).
 *
 * The first column and the day header are both sticky, so a planner scrolling
 * to the 28th still knows which BR the row is. Each vínculo is drawn as one
 * block spanning its days rather than as N separate cells — which is what
 * leaves room for the fleet code at a readable size instead of shrinking the
 * type until 31 columns fit.
 *
 * Nothing here is conveyed by colour alone: the fleet code is written in the
 * block, the state is in the tooltip, and a substitution carries an icon.
 */
export function CalendarMatrix({ rows, competence, onSelect }: CalendarMatrixProps) {
  const days = daysInCompetence(competence);
  const dayList = React.useMemo(() => Array.from({ length: days }, (_, i) => i + 1), [days]);

  return (
    <div
      className="relative overflow-x-auto"
      style={{ ["--cell-w" as string]: "2.75rem", ["--label-w" as string]: "17rem" }}
    >
      <div className="min-w-max">
        {/* --------------------------------------------------------- header */}
        <div className="sticky top-0 z-30 flex border-b border-border bg-surface-elevated">
          <div
            className="sticky left-0 z-40 flex items-center border-r border-border bg-surface-elevated px-3 py-2"
            style={{ width: "var(--label-w)", minWidth: "var(--label-w)" }}
          >
            <span className="text-caption font-medium uppercase tracking-wide text-fg-muted">
              Posição operacional
            </span>
          </div>
          <div
            className="grid"
            style={{ gridTemplateColumns: `repeat(${days}, var(--cell-w))` }}
          >
            {dayList.map((day) => {
              const dow = weekdayOf(competence.year, competence.month, day);
              const weekend = dow === 6 || dow === 7;
              return (
                <div
                  key={day}
                  className={cn(
                    "flex flex-col items-center justify-center border-l border-border/60 py-1.5",
                    weekend && "bg-surface-secondary",
                  )}
                >
                  <span className="text-caption font-medium text-fg">{day}</span>
                  <span className="text-caption leading-none text-fg-muted">
                    {WEEKDAY_INITIALS[dow]}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {/* ---------------------------------------------------------- rows */}
        {rows.map((row) => {
          const runs = buildRuns(row, days);
          return (
            <div key={row.operationBrId} className="flex border-b border-border/60 last:border-b-0">
              <div
                className="sticky left-0 z-20 flex flex-col justify-center gap-0.5 border-r border-border bg-surface px-3 py-2"
                style={{ width: "var(--label-w)", minWidth: "var(--label-w)" }}
              >
                <span className="flex items-center gap-1.5">
                  <span className="truncate text-body-sm font-medium text-fg">BR {row.brCode}</span>
                  {row.brStatus !== "active" ? (
                    <Badge variant="neutral" appearance="soft" size="sm">Inativa</Badge>
                  ) : null}
                </span>
                <span className="truncate text-caption text-fg-muted">
                  {row.cityName}/{row.stateUf} · {row.operationName}
                </span>
                {row.leaderName ? (
                  <span className="truncate text-caption text-fg-muted">Resp.: {row.leaderName}</span>
                ) : null}
              </div>

              <div
                className="relative"
                style={{ width: `calc(${days} * var(--cell-w))`, minHeight: "3.25rem" }}
              >
                {/* Background: one cell per day, so weekends and empty days read
                    as days even where nothing is planned. */}
                <div
                  className="absolute inset-0 grid"
                  style={{ gridTemplateColumns: `repeat(${days}, var(--cell-w))` }}
                  aria-hidden
                >
                  {dayList.map((day) => {
                    const dow = weekdayOf(competence.year, competence.month, day);
                    const weekend = dow === 6 || dow === 7;
                    return (
                      <div
                        key={day}
                        className={cn("border-l border-border/40", weekend && "bg-surface-secondary/60")}
                      />
                    );
                  })}
                </div>

                {/* Foreground: one block per vínculo. */}
                {runs.map((run) => {
                  const style = STATUS_STYLE[run.status] ?? STATUS_STYLE.planned;
                  const substitution = run.source === "substitution" || run.source === "inversion";
                  return (
                    <button
                      key={`${run.assignmentId}-${run.startDay}`}
                      type="button"
                      onClick={() =>
                        onSelect?.({ row, assignmentId: run.assignmentId, day: run.startDay })
                      }
                      title={[
                        `BR ${row.brCode}`,
                        run.label,
                        run.plate ? `Placa ${run.plate}` : null,
                        style.label,
                        `Dias ${run.startDay} a ${run.startDay + run.length - 1}`,
                        substitution
                          ? run.source === "inversion"
                            ? "Entrou por inversão"
                            : "Entrou por substituição"
                          : null,
                        run.opensHere ? null : "Continua de período anterior",
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                      className={cn(
                        "absolute top-1.5 bottom-1.5 flex items-center gap-1 overflow-hidden border px-2 text-left hfm-focus-ring",
                        "rounded-sm transition-colors hover:brightness-95",
                        style.bar,
                        // A run that continues from the previous month is drawn
                        // open on the left, so nobody reads day 1 as its start.
                        run.opensHere ? "rounded-l-sm" : "rounded-l-none border-l-0",
                      )}
                      style={{
                        left: `calc(${run.startDay - 1} * var(--cell-w) + 2px)`,
                        width: `calc(${run.length} * var(--cell-w) - 4px)`,
                      }}
                    >
                      {substitution ? (
                        <ArrowLeftRight aria-hidden className={cn("size-3 shrink-0", style.text)} />
                      ) : null}
                      <span className={cn("truncate text-caption font-medium", style.text)}>
                        {run.label}
                      </span>
                    </button>
                  );
                })}

                {runs.length === 0 ? (
                  <span className="pointer-events-none absolute inset-y-0 left-2 flex items-center gap-1.5 text-caption text-fg-muted">
                    <CircleSlash aria-hidden className="size-3.5" />
                    Sem veículo planejado
                  </span>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Legend — the states, written out, because colour is never the only carrier. */
export function CalendarLegend() {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-3 py-2 text-caption text-fg-secondary">
      {Object.entries(STATUS_STYLE).map(([key, style]) => (
        <span key={key} className="flex items-center gap-1.5">
          <span className={cn("size-3 rounded-xs border", style.bar)} aria-hidden />
          {style.label}
        </span>
      ))}
      <span className="flex items-center gap-1.5">
        <ArrowLeftRight aria-hidden className="size-3.5" />
        Entrou por substituição ou inversão
      </span>
      <span className="flex items-center gap-1.5">
        <CircleSlash aria-hidden className="size-3.5" />
        Sem veículo planejado
      </span>
      <span className="flex items-center gap-1.5">
        <span className="size-3 rounded-xs bg-surface-secondary border border-border" aria-hidden />
        Fim de semana
      </span>
    </div>
  );
}
