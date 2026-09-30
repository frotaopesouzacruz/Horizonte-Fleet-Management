"use client";

import * as React from "react";
import { CalendarCheck, ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ChartTooltipCard, type ChartTooltipContent } from "@/components/charts";
import type { ChecklistContext, HeatmapDay } from "@/lib/adherence/queries";
import { formatCompetence, weekdayOf, WEEKDAY_INITIALS, type Competence } from "@/lib/governance/competence";
import { CONTEXT_LABEL, formatInt, formatPct, formatPctInt, formatPctShort } from "./status";
import { pctTone } from "./consolidated-panel";
import { DayDetailDrawer } from "./day-detail-drawer";
import type { AdherenceFilterState, Navigate } from "./adherence-view";

/**
 * Escala do heatmap (tokens `--heat-*`): três faixas de julgamento contra a
 * meta, mais "sem base" e "futuro". O texto da célula usa o par de contraste
 * da própria faixa (≥ 7:1), então o número nunca depende só da cor.
 */
const TONE_BG: Record<string, string> = {
  success: "bg-heat-success text-heat-success-fg border-heat-success-border",
  warning: "bg-heat-warning text-heat-warning-fg border-heat-warning-border",
  danger: "bg-heat-danger text-heat-danger-fg border-heat-danger-border",
  neutral: "bg-heat-empty text-fg-muted border-heat-empty-border",
};

function dayTooltip(day: HeatmapDay): ChartTooltipContent {
  const title = formatDateLong(day.date);
  if (day.isFuture) {
    return {
      title,
      subtitle: "Planejado — ainda não é descumprimento",
      rows: [{ label: "Obrigações previstas", value: formatInt(day.obligations) }],
    };
  }
  if (day.denominator === 0) {
    return { title, subtitle: "Sem base elegível", rows: [{ label: "Obrigações", value: formatInt(day.obligations) }] };
  }
  const target = day.targetPct ?? 90;
  const tone = pctTone(day.adherencePct, target);
  return {
    title,
    subtitle: day.isToday ? "Dia vigente · resultado provisório" : undefined,
    rows: [
      { label: "Aderência", value: formatPct(day.adherencePct), emphasis: true, tone: tone === "danger" ? "danger" : tone === "warning" ? "warning" : tone === "success" ? "success" : undefined },
      { label: "Meta", value: formatPct(target), color: "var(--chart-target)", marker: "dashed" },
      { label: "Realizados / devidas", value: `${formatInt(day.numerator)} / ${formatInt(day.denominator)}` },
      { label: "Não realizados", value: formatInt(day.notDone) },
      { label: "Expurgos", value: formatInt(day.excluded) },
      ...(day.pendingRequests > 0 ? [{ label: "Justificativas pendentes", value: formatInt(day.pendingRequests), tone: "warning" as const }] : []),
    ],
    footer: "Clique para ver o detalhe do dia.",
  };
}

const WEEKDAY_LONG = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];
function formatDateLong(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  const weekday = WEEKDAY_LONG[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return `${String(d).padStart(2, "0")}/${String(m).padStart(2, "0")}/${y} · ${weekday}`;
}

/** Nome acessível da célula — o mesmo resumo do tooltip, em texto corrido. */
function cellLabel(day: HeatmapDay): string {
  return `${day.date}: ${day.isFuture ? "planejado" : formatPct(day.adherencePct)} · ${day.numerator}/${day.denominator} · ${day.notDone} não fez · ${day.excluded} expurgos`;
}

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

          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-md bg-surface-secondary px-3 py-2">
            <span className="text-overline font-semibold uppercase text-fg-muted">Escala</span>
            <ul className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-caption text-fg-secondary" aria-label="Legenda">
              <li className="inline-flex items-center gap-1.5"><span className={cn("inline-block h-3 w-5 rounded-xs border", TONE_BG.success)} aria-hidden />Na meta</li>
              <li className="inline-flex items-center gap-1.5"><span className={cn("inline-block h-3 w-5 rounded-xs border", TONE_BG.warning)} aria-hidden />Até 10 pontos abaixo</li>
              <li className="inline-flex items-center gap-1.5"><span className={cn("inline-block h-3 w-5 rounded-xs border", TONE_BG.danger)} aria-hidden />Abaixo</li>
              <li className="inline-flex items-center gap-1.5"><span className={cn("inline-block h-3 w-5 rounded-xs border", TONE_BG.neutral)} aria-hidden />Sem base</li>
              <li className="inline-flex items-center gap-1.5"><span className={cn("inline-block h-3 w-5 rounded-xs border border-dashed", TONE_BG.neutral)} aria-hidden />Futuro (planejado)</li>
              <li className="inline-flex items-center gap-1.5"><span className="inline-block h-3 w-5 rounded-xs border border-border ring-2 ring-primary ring-offset-1 ring-offset-surface" aria-hidden />Dia vigente</li>
            </ul>
          </div>

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
   * Meses vizinhos: título discreto e célula compacta (dia e cor), com o
   * detalhe no título da célula e na gaveta. O mês em análise leva a célula
   * completa — é nele que se lê percentual, numerador, denominador e não
   * realizados.
   */
  muted?: boolean;
  onSelect: (date: string) => void;
}

/**
 * O que a célula escreve. No mês em análise: percentual com uma casa (e, no
 * celular, sem casa), "Futuro" para datas que ainda não chegaram, "Sem base"
 * sem denominador. Nos meses vizinhos a célula é um calendário de cor: só o
 * dia e a cor da legenda ficam visíveis; o percentual e o futuro são ditos ao
 * leitor de tela. O valor exato está sempre no título da célula e na gaveta.
 */
function CellLabel({ day, muted }: { day: HeatmapDay; muted: boolean }) {
  if (muted) {
    if (day.isFuture) return day.obligations > 0 ? <span className="sr-only">Futuro</span> : null;
    return <span className="sr-only">{formatPctInt(day.adherencePct)}</span>;
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
  const [hover, setHover] = React.useState<{ day: HeatmapDay; x: number; y: number; flip: boolean } | null>(null);
  const wrapRef = React.useRef<HTMLDivElement | null>(null);

  const show = (day: HeatmapDay, el: HTMLElement) => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const a = wrap.getBoundingClientRect();
    const b = el.getBoundingClientRect();
    const x = b.left - a.left + b.width / 2;
    setHover({ day, x, y: b.top - a.top, flip: x > a.width / 2 });
  };

  return (
    <section aria-label={`Aderência por dia · ${title}`} className="flex min-w-0 flex-col gap-2">
      <h4 className={cn("text-label font-semibold", muted ? "text-fg-muted" : "text-fg")}>{title}</h4>
      {days.length === 0 ? (
        <p className="rounded-md border border-dashed border-border px-3 py-6 text-center text-caption text-fg-muted">
          Sem dados carregados para {title}.
        </p>
      ) : (
        <div ref={wrapRef} className="relative" onMouseLeave={() => setHover(null)}>
          <div className="grid grid-cols-7 gap-0.5 sm:gap-1" role="grid" aria-label={`Dias de ${title}`}>
            {/* Linhas com `display: contents`: a grade CSS continua de 7 colunas e
                a árvore acessível ganha a estrutura grade › linha › célula. */}
            <div role="row" className="contents">
              {WEEKDAY_INITIALS.slice(1).map((initial, i) => (
                <div key={i} role="columnheader" className="pb-1 text-center text-overline font-medium uppercase text-fg-muted">
                  {initial}
                </div>
              ))}
            </div>
            {Array.from({ length: cells.length / 7 }, (_, w) => (
              <div key={`w${w}`} role="row" className="contents">
                {cells.slice(w * 7, w * 7 + 7).map((day, j) => {
                  const i = w * 7 + j;
                  return day ? (
                    <button
                      key={day.date}
                      type="button"
                      role="gridcell"
                      onClick={() => onSelect(day.date)}
                      onMouseEnter={(e) => show(day, e.currentTarget)}
                      onFocus={(e) => show(day, e.currentTarget)}
                      onBlur={() => setHover(null)}
                      aria-label={cellLabel(day)}
                      data-date={day.date}
                      className={cn(
                        "group relative flex min-w-0 flex-col items-start justify-between rounded-md border text-left hfm-focus-ring",
                        "transition-[transform,box-shadow] duration-(--duration-fast) hover:z-[1] hover:-translate-y-px hover:shadow-card-hover",
                        muted ? "min-h-[2.25rem] p-1" : "min-h-[3.75rem] p-1 sm:p-1.5",
                        day.isFuture || day.denominator === 0 ? TONE_BG.neutral : TONE_BG[pctTone(day.adherencePct, day.targetPct ?? 90)],
                        day.isFuture && "border-dashed",
                        day.isToday && "ring-2 ring-primary ring-offset-1 ring-offset-surface",
                      )}
                    >
                      <span className="flex w-full items-center justify-between gap-1">
                        <span className={cn("font-semibold tabular-nums", muted ? "text-overline" : "text-caption")}>{day.day}</span>
                        {day.pendingRequests > 0 ? (
                          <span className="rounded-full bg-warning px-1.5 text-overline font-semibold text-warning-fg" aria-hidden>
                            {day.pendingRequests}
                          </span>
                        ) : null}
                      </span>
                      <span className={cn("w-full truncate font-semibold tabular-nums", muted ? "text-overline" : "text-overline sm:text-caption 2xl:text-label")}>
                        <CellLabel day={day} muted={muted} />
                      </span>
                      {muted ? null : (
                        <span className="hidden w-full truncate text-overline tabular-nums opacity-80 2xl:block">
                          {day.isFuture ? `${formatInt(day.obligations)} previstas` : `${formatInt(day.numerator)}/${formatInt(day.denominator)} · ${formatInt(day.notDone)} NF`}
                        </span>
                      )}
                    </button>
                  ) : (
                    <div key={`empty-${i}`} role="gridcell" aria-hidden className={muted ? "min-h-[2.25rem]" : "min-h-[3.75rem]"} />
                  );
                })}
              </div>
            ))}
          </div>
          {hover ? (
            <div
              className="pointer-events-none absolute z-20"
              style={{
                left: hover.x,
                top: hover.y,
                transform: hover.flip ? "translate(calc(-100% - 8px), calc(-100% - 6px))" : "translate(8px, calc(-100% - 6px))",
              }}
            >
              <ChartTooltipCard content={dayTooltip(hover.day)} className="animate-fade-in" />
            </div>
          ) : null}
        </div>
      )}
    </section>
  );
}
