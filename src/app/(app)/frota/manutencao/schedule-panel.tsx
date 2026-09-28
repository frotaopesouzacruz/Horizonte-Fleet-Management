"use client";

import * as React from "react";
import {
  CalendarCheck,
  CalendarClock,
  CalendarDays,
  CalendarX,
  CircleCheck,
  ClipboardList,
  Hourglass,
  Info,
  Plus,
  Timer,
  Wrench,
  X,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { KpiCard, type KpiStatus } from "@/components/ui/kpi-card";
import { ErrorState } from "@/components/feedback/error-state";
import {
  formatDate,
  formatInt,
  STATUS_LABEL,
  type MaintenanceCatalog,
  type MaintenanceFilters,
  type MaintenanceStatus,
  type ScheduleKpis,
  type ScheduleQueue,
} from "@/lib/maintenance/types";
import { MaintenanceTable, SORT_LABEL, type MaintenanceColumnKey } from "./maintenance-table";
import type { MaintenancePerms, MaintenanceViewData, PanelActions } from "./shared";

/**
 * Programação & execução — o funil do dia a dia.
 *
 * Nove indicadores do banco (mesmas definições das filas da lista: o cartão e
 * a lista que ele abre contam a mesma coisa) e a fila paginada. A situação
 * muda na gaveta de detalhe, nunca aqui.
 */

export interface SchedulePanelProps {
  schedule: NonNullable<MaintenanceViewData["schedule"]>;
  filters: MaintenanceFilters;
  catalog: MaintenanceCatalog;
  perms: MaintenancePerms;
  actions: PanelActions;
}

type CardFilter = { kind: "status"; status: MaintenanceStatus } | { kind: "queue"; queue: ScheduleQueue };

interface CardDef {
  id: string;
  label: string;
  filter: CardFilter;
  icon: React.ReactNode;
  value: (k: ScheduleKpis) => number;
  period: (k: ScheduleKpis) => string;
  /** Tom da borda; alertas só se colorem quando há ocorrência. */
  tone: (n: number) => KpiStatus;
}

const alert = (tone: KpiStatus) => (n: number): KpiStatus => (n > 0 ? tone : "neutral");

const CARDS: CardDef[] = [
  {
    id: "to_schedule",
    label: "Há agendar",
    filter: { kind: "status", status: "to_schedule" },
    icon: <ClipboardList />,
    value: (k) => k.toSchedule,
    period: () => "aguardando data de agendamento",
    tone: () => "neutral",
  },
  {
    id: "scheduled",
    label: "Agendadas",
    filter: { kind: "status", status: "scheduled" },
    icon: <CalendarCheck />,
    value: (k) => k.scheduled,
    period: () => "com data marcada na oficina",
    tone: () => "info",
  },
  {
    id: "in_progress",
    label: "Em execução",
    filter: { kind: "status", status: "in_progress" },
    icon: <Wrench />,
    value: (k) => k.inProgress,
    period: () => "com entrada registrada",
    tone: () => "accent",
  },
  {
    id: "scheduled_today",
    label: "Agendadas hoje",
    filter: { kind: "queue", queue: "scheduled_today" },
    icon: <CalendarDays />,
    value: (k) => k.scheduledToday,
    period: (k) => `entrada prevista em ${formatDate(k.today)}`,
    tone: alert("primary"),
  },
  {
    id: "exit_overdue",
    label: "Previsão de saída vencida",
    filter: { kind: "queue", queue: "exit_overdue" },
    icon: <CalendarX />,
    value: (k) => k.exitOverdue,
    period: () => "em execução, previsão já passou",
    tone: alert("danger"),
  },
  {
    id: "unscheduled_overdue",
    label: "Vencidas sem agendamento",
    filter: { kind: "queue", queue: "unscheduled_overdue" },
    icon: <Hourglass />,
    value: (k) => k.unscheduledOverdue,
    period: (k) => `há mais de ${formatInt(k.scheduleOverdueDays)} dias`,
    tone: alert("warning"),
  },
  {
    id: "late_entry",
    label: "Atrasadas para entrada",
    filter: { kind: "queue", queue: "late_entry" },
    icon: <CalendarClock />,
    value: (k) => k.lateEntry,
    period: () => "agendamento passou sem entrada",
    tone: alert("warning"),
  },
  {
    id: "over_sla",
    label: "Acima do SLA",
    filter: { kind: "queue", queue: "over_sla" },
    icon: <Timer />,
    value: (k) => k.overSla,
    period: (k) => `em execução · padrão ${formatInt(k.defaultSlaHours)} h`,
    tone: alert("danger"),
  },
  {
    id: "completed_today",
    label: "Concluídas hoje",
    filter: { kind: "queue", queue: "completed_today" },
    icon: <CircleCheck />,
    value: (k) => k.completedToday,
    period: () => "saída registrada hoje",
    tone: alert("success"),
  },
];

const QUEUE_LABEL: Record<ScheduleQueue, string> = {
  scheduled_today: "Agendadas hoje",
  late_entry: "Atrasadas para entrada",
  exit_overdue: "Previsão de saída vencida",
  unscheduled_overdue: "Vencidas sem agendamento",
  over_sla: "Acima do SLA",
  completed_today: "Concluídas hoje",
};

/** Um KPI clicável: o cartão é o desenho, o botão por cima é o controle. */
function QueueCard({
  def,
  kpis,
  active,
  disabled,
  onToggle,
}: {
  def: CardDef;
  kpis: ScheduleKpis;
  active: boolean;
  disabled: boolean;
  onToggle: () => void;
}) {
  const value = def.value(kpis);
  const period = def.period(kpis);
  return (
    <div className="relative min-w-0">
      <KpiCard
        aria-hidden
        size="compact"
        label={def.label}
        value={formatInt(value)}
        icon={def.icon}
        status={def.tone(value)}
        period={
          active ? (
            <>
              <span className="font-semibold text-primary-soft-fg">Filtrando a lista</span> · {period}
            </>
          ) : (
            period
          )
        }
        className={cn("h-full", active && "border-primary ring-2 ring-primary")}
      />
      <button
        type="button"
        aria-pressed={active}
        disabled={disabled}
        onClick={onToggle}
        data-testid={`maintenance-kpi-${def.id}`}
        aria-label={`${def.label}: ${formatInt(value)} (${period}). ${active ? "Remover o filtro da lista" : "Filtrar a lista"}`}
        className="absolute inset-0 rounded-md hfm-transition hfm-focus-ring hover:bg-hover-overlay disabled:cursor-wait"
      />
    </div>
  );
}

export function SchedulePanel(props: SchedulePanelProps) {
  const { schedule, filters, perms, actions } = props;
  const { kpis, page, list } = schedule;
  const { navigate, pending } = actions;

  const activeQueue = filters.queue ?? null;
  const activeStatus = !activeQueue && filters.status ? (filters.status as MaintenanceStatus) : null;
  const hasFilter = Boolean(activeQueue || filters.status);

  const isActive = (f: CardFilter) =>
    f.kind === "queue" ? activeQueue === f.queue : activeStatus === f.status;

  const clearQueue = () => navigate({ fila: null, situacao: null, pagina: null });

  const toggle = (f: CardFilter) => {
    if (isActive(f)) return clearQueue();
    if (f.kind === "queue") navigate({ fila: f.queue, pagina: null, situacao: null });
    else navigate({ situacao: f.status, fila: null, pagina: null });
  };

  const scope = activeQueue
    ? `Fila: ${QUEUE_LABEL[activeQueue]}`
    : filters.status
      ? `Situação: ${STATUS_LABEL[filters.status as MaintenanceStatus] ?? filters.status}`
      : "Em aberto: há agendar, agendadas e em execução";
  const order = `ordenada por ${SORT_LABEL[list.sort]} (${list.dir === "asc" ? "crescente" : "decrescente"})`;

  // TMM só interessa a quem já saiu; na fila aberta, a idade diz mais.
  const hidden: MaintenanceColumnKey[] =
    activeQueue === "completed_today" || filters.status === "completed"
      ? ["age", "entryKm"]
      : ["duration", "entryKm"];

  const newButton = perms.create ? (
    <Button size="sm" leadingIcon={<Plus />} onClick={() => actions.openWizard()} data-testid="maintenance-schedule-new">
      Nova manutenção
    </Button>
  ) : null;

  return (
    <div className="flex flex-col gap-5" data-testid="maintenance-schedule">
      <section aria-labelledby="maintenance-schedule-kpis" className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">
            <h2 id="maintenance-schedule-kpis" className="text-h4 font-semibold text-fg">
              Indicadores da programação
            </h2>
            <p className="text-caption text-fg-muted">
              {kpis ? `Situação em ${formatDate(kpis.today)} · ` : ""}selecione um indicador para filtrar a fila abaixo.
            </p>
          </div>
          {hasFilter ? (
            <Button
              variant="secondary"
              size="sm"
              leadingIcon={<X />}
              onClick={clearQueue}
              disabled={pending}
              data-testid="maintenance-queue-clear"
            >
              Limpar fila
            </Button>
          ) : null}
        </div>

        {kpis ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 2xl:grid-cols-9">
            {CARDS.map((def) => (
              <QueueCard
                key={def.id}
                def={def}
                kpis={kpis}
                active={isActive(def.filter)}
                disabled={pending}
                onToggle={() => toggle(def.filter)}
              />
            ))}
          </div>
        ) : (
          <ErrorState
            variant="inline"
            title="Não foi possível carregar os indicadores."
            description="A fila abaixo continua disponível."
            onRetry={actions.refresh}
            retryLabel="Tentar de novo"
            retrying={pending}
            className="rounded-md border border-border bg-surface p-3"
          />
        )}
      </section>

      <section aria-labelledby="maintenance-schedule-list" className="flex flex-col gap-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h2 id="maintenance-schedule-list" className="text-h4 font-semibold text-fg">
                Fila de manutenções
              </h2>
              {page ? (
                <Badge variant="neutral" size="sm" className="tabular-nums" aria-label={`${formatInt(page.total)} manutenções`}>
                  {formatInt(page.total)}
                </Badge>
              ) : null}
            </div>
            <p className="text-caption text-fg-muted" aria-live="polite">
              {scope} · {order}
            </p>
          </div>
          {newButton}
        </div>

        <MaintenanceTable
          page={page}
          list={list}
          actions={actions}
          label="Fila de manutenções"
          hiddenColumns={hidden}
          highlightColumns={["scheduled", "exit"]}
          emptyTitle={hasFilter ? "Nenhuma manutenção nesta fila" : "Nenhuma manutenção em aberto"}
          emptyDescription={
            hasFilter
              ? `Não há manutenções em “${activeQueue ? QUEUE_LABEL[activeQueue] : STATUS_LABEL[filters.status as MaintenanceStatus] ?? filters.status}” para os filtros escolhidos.`
              : "Não há manutenções há agendar, agendadas ou em execução para os filtros escolhidos."
          }
          emptyAction={
            hasFilter ? (
              <Button variant="secondary" size="sm" leadingIcon={<X />} onClick={clearQueue} disabled={pending}>
                Limpar fila
              </Button>
            ) : (
              newButton
            )
          }
        />

        <p className="flex items-start gap-1.5 text-caption text-fg-muted">
          <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          <span>
            O TMM conta da entrada real à saída real na oficina, nunca da data da solicitação; “≈” indica TMM calculado
            só pelas datas. Para mudar a situação, abra a manutenção: Agendar → Iniciar → Concluir.
          </span>
        </p>
      </section>
    </div>
  );
}
