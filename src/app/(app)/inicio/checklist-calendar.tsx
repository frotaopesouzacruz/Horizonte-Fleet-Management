"use client";

import * as React from "react";
import {
  AlertTriangle, CalendarCheck, CalendarDays, CheckCircle2, ChevronLeft, ChevronRight, Eye, LogIn, LogOut, MinusCircle,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { Badge } from "@/components/ui/badge";
import { Button, IconButton } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { Alert, AlertDescription } from "@/components/feedback/alert";
import { ExecutionDetailDrawer } from "@/app/(app)/aplicativos/check-list-frota/execution-detail-drawer";
import { statusMeta, formatPct } from "@/app/(app)/checklist/aderencia/status";
import { MONTH_NAMES, type Competence } from "@/lib/governance/competence";
import type { MySituationCell, MySituationCounts, MySituationDay } from "@/lib/adherence/my-situation";
import type { ChecklistContextKind, OperationalExecution } from "@/lib/portal/types";
import {
  buildCalendar, calendarTotals, type CalendarDay, type CalendarQuadrant, type QuadrantTone,
} from "@/lib/portal/calendar";

/** De onde vieram (ou por que não vieram) as obrigações do mês. */
export type ObligationsSource =
  | { state: "ok"; days: MySituationDay[]; summary: MySituationCounts | null }
  | { state: "not_driver" | "no_employee" | "no_permission" }
  | { state: "error"; error: string };

const WEEKDAYS = [
  { short: "D", long: "Domingo" },
  { short: "S", long: "Segunda-feira" },
  { short: "T", long: "Terça-feira" },
  { short: "Q", long: "Quarta-feira" },
  { short: "Q", long: "Quinta-feira" },
  { short: "S", long: "Sexta-feira" },
  { short: "S", long: "Sábado" },
] as const;

const CONTEXT_LABEL: Record<ChecklistContextKind, string> = { saida: "Saída", retorno: "Retorno" };
const CONTEXT_TITLE: Record<ChecklistContextKind, string> = { saida: "Checklist de saída", retorno: "Checklist de retorno" };

/** Cores do quadrante: só tokens semânticos, as mesmas das células da Aderência. */
const TONE_CLASS: Record<QuadrantTone, string> = {
  done: "border-success/40 bg-success-soft text-success-soft-fg",
  missed: "border-danger/40 bg-danger-soft text-danger-soft-fg",
  pending: "border-warning/40 bg-warning-soft text-warning-soft-fg",
  planned: "border-info/30 bg-info-soft text-info-soft-fg",
  excused: "border-border bg-neutral-soft text-neutral-soft-fg",
};

const LEGEND: { tone: QuadrantTone; label: string }[] = [
  { tone: "done", label: "Realizado" },
  { tone: "missed", label: "Não realizado" },
  { tone: "pending", label: "Pendente hoje / aguardando retorno" },
  { tone: "planned", label: "Previsto" },
  { tone: "excused", label: "Dispensado (manutenção, sem rota…)" },
];

function quadrantLabel(q: CalendarQuadrant): string {
  return q.tone === "excused" ? statusMeta(q.statusCode).label : q.label;
}

function timeBr(value: string | null): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" });
}

function dateBr(iso: string): string {
  const [y, m, d] = iso.split("-");
  return d ? `${d}/${m}/${y}` : iso;
}

/** "Dia 5. Saída: não realizado. Retorno: realizado (RJX4A21)." — o dia sem depender da cor. */
function dayAriaLabel(day: CalendarDay): string {
  const part = (ctx: ChecklistContextKind, q: CalendarQuadrant | null) =>
    q ? `${CONTEXT_LABEL[ctx]}: ${quadrantLabel(q).toLowerCase()}${q.tone === "done" && q.plate ? ` (${q.plate})` : ""}` : null;
  const parts = [part("saida", day.saida), part("retorno", day.retorno)].filter(Boolean);
  const head = `Dia ${day.day}${day.isToday ? " (hoje)" : ""}`;
  return parts.length ? `${head}. ${parts.join(". ")}.` : `${head}: sem checklist previsto.`;
}

function MiniQuadrant({ q, context }: { q: CalendarQuadrant | null; context: ChecklistContextKind }) {
  if (!q) return <span aria-hidden className="h-4 sm:h-[30px]" />;
  const cls = TONE_CLASS[q.tone];
  return (
    <>
      {/* Celular: a letra do contexto no quadradinho colorido (sem rolagem lateral). */}
      <span aria-hidden className={cn("flex h-4 items-center justify-center rounded-xs border text-[10px] font-semibold sm:hidden", cls)}>
        {context === "saida" ? "S" : "R"}
      </span>
      {/* A partir de 640px: contexto + placa (ou a situação). */}
      <span aria-hidden className={cn("hidden min-w-0 flex-col rounded-xs border px-1 py-0.5 leading-tight sm:flex", cls)}>
        <span className="truncate text-[10px] font-semibold uppercase tracking-wide">{CONTEXT_LABEL[context]}</span>
        <span className="truncate text-[11px] tabular-nums">
          {q.tone === "done" && q.plate ? q.plate : quadrantLabel(q)}
          {q.extra > 0 ? ` +${q.extra}` : ""}
        </span>
      </span>
    </>
  );
}

function ObligationLine({ row, cell }: { row: MySituationDay; cell: MySituationCell }) {
  const meta = statusMeta(cell.status);
  const tone = cell.done ? "success" : cell.excluded ? "neutral" : cell.status === "NAO_FEZ_CHECKLIST" && !cell.provisional ? "danger" : "warning";
  return (
    <li className="flex flex-col gap-1 rounded-md border border-border-subtle bg-surface-interactive p-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge status={tone} size="sm">
          {cell.provisional && cell.status === "NAO_FEZ_CHECKLIST" ? "Pendente hoje" : meta.label}
        </StatusBadge>
        <span className="text-body-sm font-semibold text-fg tabular-nums">
          {[row.fleetCode, row.licensePlate].filter(Boolean).join(" · ") || "Veículo"}
        </span>
      </div>
      <p className="text-caption text-fg-muted">
        Obrigação da BR {row.brCode ?? "—"}
        {row.operationName ? ` · ${row.operationName}` : ""}
        {row.cityName ? ` · ${row.cityName}` : ""}
        {cell.deadlineAt && !cell.done && !cell.excluded ? ` · prazo ${timeBr(cell.deadlineAt)}` : ""}
      </p>
    </li>
  );
}

function ExecutionLine({ execution, onOpen }: { execution: OperationalExecution; onOpen?: (id: string) => void }) {
  return (
    <li className="flex flex-col gap-1.5 rounded-md border border-border-subtle bg-surface-interactive p-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1 text-body-sm font-semibold text-success-soft-fg">
          <CheckCircle2 aria-hidden className="size-4" />
          Realizado
        </span>
        <span className="text-body-sm font-semibold text-fg tabular-nums">
          {execution.licensePlate ?? execution.fleetCode ?? "—"}
        </span>
        <span className="text-caption text-fg-muted tabular-nums">
          {timeBr(execution.startedAt)} – {timeBr(execution.submittedAt)}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {execution.nonConforming > 0 ? (
          <Badge variant="danger" size="sm">
            <AlertTriangle aria-hidden />
            {execution.nonConforming} {execution.nonConforming === 1 ? "apontamento" : "apontamentos"}
          </Badge>
        ) : (
          <Badge variant="success" size="sm">Sem apontamento</Badge>
        )}
        {execution.source === "import" ? <Badge variant="neutral" size="sm">Histórico importado</Badge> : null}
        {execution.operationName ? (
          <span className="text-caption text-fg-muted">
            {execution.operationName}
            {execution.brCode ? ` · ${execution.brCode}` : ""}
          </span>
        ) : null}
        {onOpen ? (
          <Button size="sm" variant="secondary" className="ml-auto" leadingIcon={<Eye />} onClick={() => onOpen(execution.id)}>
            Ver checklist
          </Button>
        ) : null}
      </div>
    </li>
  );
}

function ContextBlock({
  context, day, onOpen,
}: {
  context: ChecklistContextKind;
  day: CalendarDay;
  onOpen?: (id: string) => void;
}) {
  const rows = day.obligations
    .map((row) => ({ row, cell: row[context] }))
    .filter((x): x is { row: MySituationDay; cell: MySituationCell } => x.cell != null);
  const mine = day.executions.filter((e) => e.context === context);
  const Icon = context === "saida" ? LogOut : LogIn;

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border bg-surface-raised p-3" data-testid={`dia-${context}`}>
      <h4 className="flex items-center gap-2 text-body-sm font-semibold text-fg">
        <Icon aria-hidden className="size-4 text-fg-muted" />
        {CONTEXT_TITLE[context]}
      </h4>
      {rows.length === 0 && mine.length === 0 ? (
        <p className="flex items-center gap-2 text-body-sm text-fg-muted">
          <MinusCircle aria-hidden className="size-4" />
          {day.isFuture ? "Nada previsto." : "Sem obrigação e sem checklist enviado."}
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {rows.map(({ row, cell }, i) => (
            <ObligationLine key={`o-${row.brCode}-${row.journey}-${i}`} row={row} cell={cell} />
          ))}
          {mine.map((e) => (
            <ExecutionLine key={e.id} execution={e} onOpen={onOpen} />
          ))}
        </ul>
      )}
    </div>
  );
}

export interface ChecklistCalendarProps {
  competence: Competence;
  currentCompetence: Competence;
  /** Dia operacional vigente (servidor). */
  today: string;
  executions: OperationalExecution[];
  executionsTruncated?: boolean;
  obligations: ObligationsSource;
  onNavigate: (competence: Competence) => void;
  navigating?: boolean;
  /** Abre o checklist completo (`applications.checklist_fleet.view_own`). */
  canOpenExecution?: boolean;
  /** Injetável para a prévia; em produção é a action do aplicativo. */
  detailLoader?: React.ComponentProps<typeof ExecutionDetailDrawer>["loader"];
}

/**
 * Meu calendário de checklists — Saída e Retorno de cada dia do mês (HFC),
 * com a regra de obrigação do HFM (ver `@/lib/portal/calendar`). Clicar num
 * dia com obrigação ou checklist abre o detalhe logo abaixo da grade.
 */
export function ChecklistCalendar({
  competence,
  currentCompetence,
  today,
  executions,
  executionsTruncated = false,
  obligations,
  onNavigate,
  navigating = false,
  canOpenExecution = false,
  detailLoader,
}: ChecklistCalendarProps) {
  const calendar = React.useMemo(
    () =>
      buildCalendar({
        year: competence.year,
        month: competence.month,
        today,
        obligations: obligations.state === "ok" ? obligations.days : null,
        executions,
      }),
    [competence.year, competence.month, today, obligations, executions],
  );
  const totals = React.useMemo(() => calendarTotals(calendar), [calendar]);
  // A seleção pertence ao mês em que foi feita: trocar de mês a limpa (como no HFC).
  const monthKey = `${competence.year}-${competence.month}`;
  const [selection, setSelection] = React.useState<{ month: string; date: string } | null>(null);
  const selected = selection?.month === monthKey ? selection.date : null;
  const setSelected = (date: string | null) => setSelection(date ? { month: monthKey, date } : null);
  const [detailId, setDetailId] = React.useState<string | null>(null);

  const selectedDay = calendar.days.find((d) => d.date === selected) ?? null;
  const isCurrent = competence.year === currentCompetence.year && competence.month === currentCompetence.month;
  const shift = (delta: number) => {
    const index = competence.year * 12 + (competence.month - 1) + delta;
    onNavigate({ year: Math.floor(index / 12), month: (index % 12) + 1 });
  };
  const monthLabel = `${MONTH_NAMES[competence.month]} ${competence.year}`;
  const summary = obligations.state === "ok" ? obligations.summary : null;

  return (
    <div className="flex flex-col gap-3" data-testid="calendario" aria-busy={navigating || undefined}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          <IconButton label="Mês anterior" variant="secondary" onClick={() => shift(-1)} disabled={navigating}>
            <ChevronLeft aria-hidden />
          </IconButton>
          <p className="min-w-36 text-center text-body font-semibold text-fg" aria-live="polite" data-testid="calendario-mes">
            {monthLabel}
          </p>
          <IconButton label="Próximo mês" variant="secondary" onClick={() => shift(1)} disabled={navigating}>
            <ChevronRight aria-hidden />
          </IconButton>
        </div>
        {!isCurrent ? (
          <Button size="sm" variant="secondary" leadingIcon={<CalendarCheck />} onClick={() => onNavigate(currentCompetence)} disabled={navigating}>
            Mês atual
          </Button>
        ) : null}
      </div>

      {obligations.state === "not_driver" ? (
        <Alert variant="info">
          <AlertDescription>
            Neste mês você não é motorista titular de nenhuma BR na Fidelização, então não há dia obrigatório a cobrar:
            o calendário mostra os checklists que você enviou.
          </AlertDescription>
        </Alert>
      ) : obligations.state === "no_employee" ? (
        <Alert variant="warning">
          <AlertDescription>
            Sua conta não está vinculada a um cadastro de colaborador. Peça ao administrador do HFM para vincular o seu
            cadastro; até lá não há obrigações nem checklists seus para mostrar.
          </AlertDescription>
        </Alert>
      ) : obligations.state === "no_permission" ? (
        <Alert variant="info">
          <AlertDescription>
            Seu perfil não consulta a própria aderência: o calendário mostra só os checklists que você enviou.
          </AlertDescription>
        </Alert>
      ) : obligations.state === "error" ? (
        <Alert variant="warning" data-testid="calendario-erro-obrigacoes">
          <AlertDescription>
            As obrigações do mês não carregaram ({obligations.error}). Os dias abaixo mostram só os checklists que você
            enviou — nenhum dia aparece como não realizado enquanto as obrigações não vierem.
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="rounded-xl border border-border bg-surface-raised p-2 shadow-card sm:p-3">
        <div className="grid grid-cols-7 gap-1 sm:gap-1.5" role="presentation">
          {WEEKDAYS.map((w, i) => (
            <div key={i} className="pb-1 text-center text-caption font-semibold text-fg-muted">
              <span aria-hidden>{w.short}</span>
              <span className="sr-only">{w.long}</span>
            </div>
          ))}
          {Array.from({ length: calendar.leading }, (_, i) => (
            <div key={`vazio-${i}`} aria-hidden />
          ))}
          {calendar.days.map((day) => {
            const interactive = day.obligations.length > 0 || day.executions.length > 0;
            const isSelected = selected === day.date;
            return (
              <button
                key={day.date}
                type="button"
                data-testid={`dia-${day.date}`}
                data-today={day.isToday || undefined}
                disabled={!interactive}
                aria-pressed={interactive ? isSelected : undefined}
                aria-label={dayAriaLabel(day)}
                onClick={() => setSelected(isSelected ? null : day.date)}
                className={cn(
                  "flex min-h-[64px] min-w-0 flex-col gap-1 rounded-md border p-1 text-left outline-none hfm-transition hfm-focus-ring sm:min-h-[92px] sm:p-1.5",
                  interactive
                    ? "border-border bg-surface hover:border-border-emphasis hover:bg-surface-hover"
                    : "border-transparent bg-surface-secondary/40",
                  day.isToday && "ring-2 ring-primary ring-offset-1 ring-offset-surface-raised",
                  isSelected && "border-primary bg-primary-soft",
                )}
              >
                <span
                  className={cn(
                    "text-caption font-semibold tabular-nums",
                    day.isFuture && !interactive ? "text-fg-disabled" : "text-fg",
                  )}
                >
                  {day.day}
                </span>
                <MiniQuadrant q={day.saida} context="saida" />
                <MiniQuadrant q={day.retorno} context="retorno" />
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
        <ul className="flex flex-wrap gap-x-3 gap-y-1.5" aria-label="Legenda do calendário">
          {LEGEND.map((l) => (
            <li key={l.tone} className="inline-flex items-center gap-1.5 text-caption text-fg-secondary">
              <span aria-hidden className={cn("size-3 rounded-xs border", TONE_CLASS[l.tone])} />
              {l.label}
            </li>
          ))}
          <li className="inline-flex items-center gap-1.5 text-caption text-fg-secondary">
            <span aria-hidden className="size-3 rounded-xs border border-border bg-surface" />
            Sem checklist previsto
          </li>
        </ul>
        <p className="text-caption text-fg-muted tabular-nums" data-testid="calendario-totais">
          {totals.executions} {totals.executions === 1 ? "checklist enviado" : "checklists enviados"} no mês
          {summary && summary.denominator > 0
            ? ` · aderência ${formatPct(summary.adherencePct)} (${summary.numerator} de ${summary.denominator})`
            : ""}
          {totals.missed > 0 ? ` · ${totals.missed} não ${totals.missed === 1 ? "realizado" : "realizados"}` : ""}
        </p>
      </div>
      {executionsTruncated ? (
        <p className="text-caption text-fg-muted">Mostrando os 400 primeiros checklists enviados no mês.</p>
      ) : null}

      {selectedDay ? (
        <section
          aria-label={`Checklists de ${dateBr(selectedDay.date)}`}
          className="flex flex-col gap-2 rounded-xl border border-border bg-surface p-3"
          data-testid="dia-detalhe"
        >
          <h3 className="flex flex-wrap items-center gap-2 text-body font-semibold text-fg">
            <CalendarDays aria-hidden className="size-4 text-fg-muted" />
            Checklists de {dateBr(selectedDay.date)}
            {selectedDay.isToday ? <Badge variant="primary" size="sm">Hoje</Badge> : null}
          </h3>
          <div className="grid gap-2 md:grid-cols-2">
            <ContextBlock context="saida" day={selectedDay} onOpen={canOpenExecution ? setDetailId : undefined} />
            <ContextBlock context="retorno" day={selectedDay} onOpen={canOpenExecution ? setDetailId : undefined} />
          </div>
        </section>
      ) : (
        <p className="text-caption text-fg-muted">
          Toque num dia com checklist ou obrigação para ver placa, horário, apontamentos e prazo. Dias futuros só
          mostram o que está previsto.
        </p>
      )}

      {canOpenExecution ? (
        <ExecutionDetailDrawer
          executionId={detailId}
          onOpenChange={(open: boolean) => {
            if (!open) setDetailId(null);
          }}
          loader={detailLoader}
        />
      ) : null}
    </div>
  );
}
