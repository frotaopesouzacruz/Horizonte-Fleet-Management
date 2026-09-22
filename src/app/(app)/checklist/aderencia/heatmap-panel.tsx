"use client";

import * as React from "react";
import { cn } from "@/lib/cn";
import { Card, CardContent } from "@/components/ui/card";
import type { ChecklistContext, HeatmapDay } from "@/lib/adherence/queries";
import { formatCompetence, weekdayOf, WEEKDAY_INITIALS, type Competence } from "@/lib/governance/competence";
import { CONTEXT_LABEL, formatInt, formatPct } from "./status";
import { pctTone } from "./consolidated-panel";
import type { Navigate } from "./adherence-view";

const TONE_BG: Record<string, string> = {
  success: "bg-success-soft text-success-soft-fg border-success/30",
  warning: "bg-warning-soft text-warning-soft-fg border-warning/30",
  danger: "bg-danger-soft text-danger-soft-fg border-danger/30",
  neutral: "bg-surface-secondary text-fg-muted border-border",
};

export interface HeatmapPanelProps {
  days: HeatmapDay[];
  competence: Competence;
  context: ChecklistContext;
  navigate: Navigate;
}

/**
 * Heatmap (§46): um calendário com o percentual do dia, escrito — a cor
 * acompanha, mas nunca é a única informação. Datas futuras não têm
 * descumprimento: aparecem como planejamento. Clicar no dia abre a Jornada.
 */
export function HeatmapPanel({ days, competence, context, navigate }: HeatmapPanelProps) {
  const offset = weekdayOf(competence.year, competence.month, 1) - 1; // segunda = 0
  const cells: (HeatmapDay | null)[] = [...Array<null>(offset).fill(null), ...days];
  while (cells.length % 7 !== 0) cells.push(null);

  return (
    <Card>
      <CardContent className="flex flex-col gap-4 p-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h3 className="text-h4 font-semibold text-fg">{CONTEXT_LABEL[context]} · {formatCompetence(competence)}</h3>
            <p className="text-caption text-fg-muted">Percentual do dia, realizados sobre obrigações devidas. Selecione um dia para ver a jornada.</p>
          </div>
          <ul className="flex flex-wrap gap-3 text-caption text-fg-muted" aria-label="Legenda">
            <li><span className={cn("mr-1 inline-block size-2.5 rounded-xs border", TONE_BG.success)} aria-hidden />Na meta</li>
            <li><span className={cn("mr-1 inline-block size-2.5 rounded-xs border", TONE_BG.warning)} aria-hidden />Até 10 pontos abaixo</li>
            <li><span className={cn("mr-1 inline-block size-2.5 rounded-xs border", TONE_BG.danger)} aria-hidden />Abaixo</li>
            <li><span className={cn("mr-1 inline-block size-2.5 rounded-xs border", TONE_BG.neutral)} aria-hidden />Sem base / futuro</li>
          </ul>
        </div>

        <div className="grid grid-cols-7 gap-1.5" role="grid" aria-label="Aderência por dia">
          {WEEKDAY_INITIALS.slice(1).map((initial, i) => (
            <div key={i} role="columnheader" className="pb-1 text-center text-overline font-medium uppercase text-fg-muted">
              {initial}
            </div>
          ))}
          {cells.map((day, i) =>
            day ? (
              <button
                key={day.date}
                type="button"
                role="gridcell"
                onClick={() => navigate({ aba: "jornada", dia: day.date })}
                title={`${day.date}: ${formatPct(day.adherencePct)} · ${day.numerator}/${day.denominator} · ${day.notDone} não fez · ${day.excluded} expurgos`}
                className={cn(
                  "flex min-h-[4.25rem] flex-col items-start justify-between rounded-md border p-2 text-left transition-colors hfm-focus-ring",
                  day.isFuture || day.denominator === 0 ? TONE_BG.neutral : TONE_BG[pctTone(day.adherencePct, day.targetPct ?? 90)],
                  day.isFuture && "border-dashed",
                  day.isToday && "ring-2 ring-primary ring-offset-1 ring-offset-surface",
                )}
              >
                <span className="flex w-full items-center justify-between">
                  <span className="text-label font-semibold tabular-nums">{day.day}</span>
                  {day.pendingRequests > 0 ? (
                    <span className="rounded-full bg-warning px-1.5 text-[10px] font-semibold leading-4 text-warning-fg" title={`${day.pendingRequests} justificativa(s) pendente(s)`}>
                      {day.pendingRequests}
                    </span>
                  ) : null}
                </span>
                <span className="text-body-sm font-semibold tabular-nums">
                  {day.isFuture ? (day.obligations > 0 ? "Planejado" : "—") : formatPct(day.adherencePct)}
                </span>
                <span className="text-[11px] tabular-nums opacity-80">
                  {day.isFuture ? `${formatInt(day.obligations)} previstas` : `${formatInt(day.numerator)}/${formatInt(day.denominator)} · ${formatInt(day.notDone)} NF`}
                </span>
              </button>
            ) : (
              <div key={`empty-${i}`} role="gridcell" aria-hidden className="min-h-[4.25rem]" />
            ),
          )}
        </div>
      </CardContent>
    </Card>
  );
}
