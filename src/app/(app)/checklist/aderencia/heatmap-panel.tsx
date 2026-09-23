"use client";

import * as React from "react";
import { CalendarCheck, ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import type { ChecklistContext, HeatmapDay } from "@/lib/adherence/queries";
import { formatCompetence, weekdayOf, WEEKDAY_INITIALS, type Competence } from "@/lib/governance/competence";
import { CONTEXT_LABEL, formatInt, formatPct, formatPctInt, formatPctShort } from "./status";
import { pctTone } from "./consolidated-panel";
import { DayDetailDrawer } from "./day-detail-drawer";
import type { AdherenceFilterState, Navigate } from "./adherence-view";

const TONE_BG: Record<string, string> = {
  success: "bg-success-soft text-success-soft-fg border-success/30",
  warning: "bg-warning-soft text-warning-soft-fg border-warning/30",
  danger: "bg-danger-soft text-danger-soft-fg border-danger/30",
  neutral: "bg-surface-secondary text-fg-muted border-border",
};

export interface HeatmapPanelProps {
  days: HeatmapDay[];
  daysPrev: HeatmapDay[];
  daysNext: HeatmapDay[];
  competence: Competence;
  context: ChecklistContext;
  filters: AdherenceFilterState;
  navigate: Navigate;
  onSelectObligation: (id: string) => void;
  basePath: string;
}

function shiftMonth({ year, month }: Competence, delta: number): Competence {
  const index = year * 12 + (month - 1) + delta;
  return { year: Math.floor(index / 12), month: (index % 12) + 1 };
}

function competenceOfDate(date: string): Competence {
  return { year: Number(date.slice(0, 4)), month: Number(date.slice(5, 7)) };
}

function sameCompetence(a: Competence, b: Competence) {
  return a.year === b.year && a.month === b.month;
}

/**
 * Heatmap (§28–§31): três meses lado a lado — anterior, corrente e próximo —
 * com o percentual do dia escrito; a cor acompanha, mas nunca é a única
 * informação (§16). Datas futuras não têm descumprimento: aparecem como
 * planejamento. Clicar no dia abre o detalhe do dia; dali se vai ao Mês/Dia
 * ou à Jornada com o mesmo contexto (§31).
 */
export function HeatmapPanel({
  days, daysPrev, daysNext, competence, context, filters, navigate, onSelectObligation, basePath,
}: HeatmapPanelProps) {
  const [selectedDay, setSelectedDay] = React.useState<string | null>(null);
  const prev = shiftMonth(competence, -1);
  const next = shiftMonth(competence, 1);
  const todayDate = days.find((d) => d.isToday)?.date ?? daysPrev.find((d) => d.isToday)?.date ?? daysNext.find((d) => d.isToday)?.date ?? null;
  const currentCompetence = todayDate ? competenceOfDate(todayDate) : null;

  const goTo = (target: Competence) => navigate({ ano: String(target.year), mes: String(target.month), dia: null });

  return (
    <>
      <Card>
        <CardContent className="flex flex-col gap-4 p-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h3 className="text-h4 font-semibold text-fg">{CONTEXT_LABEL[context]} · {formatCompetence(competence)}</h3>
              <p className="text-caption text-fg-muted">
                Percentual do dia, realizados sobre obrigações devidas. Selecione um dia para ver o detalhe.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="outline" size="sm" leadingIcon={<ChevronLeft />} onClick={() => goTo(prev)}>
                Mês anterior
              </Button>
              <Button
                variant="outline" size="sm" leadingIcon={<CalendarCheck />}
                disabled={currentCompetence == null || sameCompetence(currentCompetence, competence)}
                onClick={() => { if (currentCompetence) goTo(currentCompetence); }}
              >
                Mês atual
              </Button>
              <Button variant="outline" size="sm" trailingIcon={<ChevronRight />} onClick={() => goTo(next)}>
                Próximo mês
              </Button>
            </div>
          </div>

          <ul className="flex flex-wrap gap-x-4 gap-y-1 text-caption text-fg-muted" aria-label="Legenda">
            <li><span className={cn("mr-1 inline-block size-2.5 rounded-xs border align-middle", TONE_BG.success)} aria-hidden />Na meta</li>
            <li><span className={cn("mr-1 inline-block size-2.5 rounded-xs border align-middle", TONE_BG.warning)} aria-hidden />Até 10 pontos abaixo</li>
            <li><span className={cn("mr-1 inline-block size-2.5 rounded-xs border align-middle", TONE_BG.danger)} aria-hidden />Abaixo</li>
            <li><span className={cn("mr-1 inline-block size-2.5 rounded-xs border align-middle", TONE_BG.neutral)} aria-hidden />Sem base</li>
            <li><span className={cn("mr-1 inline-block size-2.5 rounded-xs border border-dashed align-middle", TONE_BG.neutral)} aria-hidden />Futuro (planejado)</li>
            <li><span className="mr-1 inline-block size-2.5 rounded-xs border border-border ring-2 ring-primary ring-offset-1 ring-offset-surface align-middle" aria-hidden />Dia vigente</li>
          </ul>

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-[3fr_5fr_3fr]">
            <MonthGrid competence={prev} days={daysPrev} muted onSelect={setSelectedDay} />
            <MonthGrid competence={competence} days={days} onSelect={setSelectedDay} />
            <MonthGrid competence={next} days={daysNext} muted onSelect={setSelectedDay} />
          </div>
        </CardContent>
      </Card>

      <DayDetailDrawer
        date={selectedDay}
        context={context}
        filters={filters}
        basePath={basePath}
        onOpenChange={(open) => { if (!open) setSelectedDay(null); }}
        onSelectObligation={onSelectObligation}
      />
    </>
  );
}

interface MonthGridProps {
  competence: Competence;
  days: HeatmapDay[];
  /**
   * Meses vizinhos: título discreto e célula compacta (dia e percentual), com
   * o detalhe no título da célula e na gaveta. O mês em análise leva a célula
   * completa — é nele que se lê numerador, denominador e não realizados.
   */
  muted?: boolean;
  onSelect: (date: string) => void;
}

/**
 * O que a célula escreve. No mês em análise: percentual com uma casa (e, no
 * celular, sem casa), "Futuro" para datas que ainda não chegaram, "Sem base"
 * sem denominador. Nos meses vizinhos a célula é estreita: percentual
 * inteiro; o futuro fica na borda tracejada e na legenda, dito para o leitor
 * de tela. O valor exato está sempre no título da célula e na gaveta do dia.
 */
function CellLabel({ day, muted }: { day: HeatmapDay; muted: boolean }) {
  if (muted) {
    if (day.isFuture) return day.obligations > 0 ? <span className="sr-only">Futuro</span> : <>—</>;
    return <>{formatPctInt(day.adherencePct)}</>;
  }
  if (day.isFuture) return <>{day.obligations > 0 ? "Futuro" : "—"}</>;
  return (
    <>
      <span className="sm:hidden">{formatPctInt(day.adherencePct)}</span>
      <span className="hidden sm:inline">{formatPctShort(day.adherencePct)}</span>
    </>
  );
}

function MonthGrid({ competence, days, muted = false, onSelect }: MonthGridProps) {
  const offset = weekdayOf(competence.year, competence.month, 1) - 1; // segunda = 0
  const cells: (HeatmapDay | null)[] = [...Array<null>(offset).fill(null), ...days];
  while (cells.length % 7 !== 0) cells.push(null);
  const title = formatCompetence(competence);

  return (
    <section aria-label={`Aderência por dia · ${title}`} className="flex min-w-0 flex-col gap-2">
      <h4 className={cn("text-label font-semibold", muted ? "text-fg-muted" : "text-fg")}>{title}</h4>
      {days.length === 0 ? (
        <p className="rounded-md border border-dashed border-border px-3 py-6 text-center text-caption text-fg-muted">
          Sem dados carregados para {title}.
        </p>
      ) : (
        <div className="grid grid-cols-7 gap-0.5 sm:gap-1" role="grid" aria-label={`Dias de ${title}`}>
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
                onClick={() => onSelect(day.date)}
                title={`${day.date}: ${day.isFuture ? "planejado" : formatPct(day.adherencePct)} · ${day.numerator}/${day.denominator} · ${day.notDone} não fez · ${day.excluded} expurgos`}
                className={cn(
                  "flex min-w-0 flex-col items-start justify-between rounded-md border p-1 text-left transition-colors hfm-focus-ring sm:p-1.5",
                  muted ? "min-h-[2.75rem]" : "min-h-[3.5rem]",
                  day.isFuture || day.denominator === 0 ? TONE_BG.neutral : TONE_BG[pctTone(day.adherencePct, day.targetPct ?? 90)],
                  day.isFuture && "border-dashed",
                  day.isToday && "ring-2 ring-primary ring-offset-1 ring-offset-surface",
                )}
              >
                <span className="flex w-full items-center justify-between gap-1">
                  <span className={cn("font-semibold tabular-nums", muted ? "text-caption" : "text-label")}>{day.day}</span>
                  {day.pendingRequests > 0 ? (
                    <span className="rounded-full bg-warning px-1.5 text-[10px] font-semibold leading-4 text-warning-fg" title={`${day.pendingRequests} justificativa(s) pendente(s)`}>
                      {day.pendingRequests}
                    </span>
                  ) : null}
                </span>
                <span className={cn("w-full truncate font-semibold tabular-nums", muted ? "text-[10px]" : "text-[10px] sm:text-[12px]")}>
                  <CellLabel day={day} muted={muted} />
                </span>
                {muted ? null : (
                  <span className="hidden w-full truncate text-[10px] tabular-nums opacity-80 sm:block">
                    {day.isFuture ? `${formatInt(day.obligations)} previstas` : `${formatInt(day.numerator)}/${formatInt(day.denominator)} · ${formatInt(day.notDone)} NF`}
                  </span>
                )}
              </button>
            ) : (
              <div key={`empty-${i}`} role="gridcell" aria-hidden className={muted ? "min-h-[2.75rem]" : "min-h-[3.5rem]"} />
            ),
          )}
        </div>
      )}
    </section>
  );
}
