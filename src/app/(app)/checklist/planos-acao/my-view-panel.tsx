"use client";

import * as React from "react";
import {
  AlarmClock, CalendarClock, ChevronRight, CircleCheck, CircleDashed, Hourglass, Inbox, LayoutDashboard, MapPin, RotateCcw,
  ShieldAlert, Siren, TriangleAlert, Truck, UserCheck, Wrench,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { SectionHeader } from "@/components/layout/section-header";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/feedback/empty-state";
import { ErrorState } from "@/components/feedback/error-state";
import { ChartCard, ChartLegend, HBarChart, SrTable, chartFormat } from "@/components/charts";
import { DeadlineBadge, PlanStatusBadge, PriorityBadge, RecurrenceBadge } from "@/components/action-plans/badges";
import { DEADLINE_TONE, formatDate, formatInt, planTitle, type Tone } from "@/lib/action-plans/labels";
import { FILTER_PARAM, type ActionPlanRow, type MyViewData } from "@/lib/action-plans/types";
import { DrillKpi, LIST_RESET, TONE_COLOR, useDrillLink, type Patch } from "./overview-panel";
import type { ActionPlanPerms, PanelActions } from "./shared";

/**
 * Planos de Ação → Minha visão (§64).
 *
 * Para liderança e gestão operacional: o que está em aberto HOJE nas operações
 * do escopo da pessoa (sem recorte de período nem os filtros da tela), o que
 * está sob a responsabilidade dela, os planos que pedem atenção agora e onde a
 * fila se concentra. Os números vêm prontos de `action_plan_my_view`; cada
 * indicador abre a lista de planos com o filtro que o explica.
 */

export interface MyViewPanelProps {
  myView: MyViewData | null;
  perms: ActionPlanPerms;
  actions: PanelActions;
}

/** A Minha visão não usa os filtros da tela: o drill-down limpa todos antes de aplicar o seu. */
const CLEAR_FILTERS: Patch = Object.fromEntries(Object.values(FILTER_PARAM).map((param) => [param, null]));

const IN_MAINTENANCE = "maintenance_open,maintenance_scheduled,maintenance_in_progress";

/** Linha de acento à esquerda do cartão: o tom do prazo, sem pintar o texto. */
const DEADLINE_ACCENT: Partial<Record<Tone, string>> = {
  danger: "before:bg-danger",
  warning: "before:bg-warning",
  success: "before:bg-success",
};

function AttentionCard({ plan, onOpen }: { plan: ActionPlanRow; onOpen: (id: string) => void }) {
  const accent = DEADLINE_ACCENT[DEADLINE_TONE[plan.deadline] ?? "neutral"];
  const plate = plan.licensePlate || "Sem placa";
  return (
    <button
      type="button"
      onClick={() => onOpen(plan.id)}
      data-testid="my-view-attention-plan"
      data-plan-id={plan.id}
      className={cn(
        "relative flex h-full w-full min-w-0 flex-col gap-2.5 overflow-hidden rounded-lg border border-border bg-surface-raised p-3.5 pl-4 text-left shadow-card",
        "hfm-transition hover:border-border-strong hover:bg-hover-overlay hfm-focus-ring",
        accent && cn("before:absolute before:inset-y-0 before:left-0 before:w-0.5", accent),
      )}
    >
      <span className="flex min-w-0 items-start justify-between gap-2">
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="text-caption font-medium tabular-nums text-fg-muted">{plan.code}</span>
          <span className="line-clamp-2 text-body-sm font-semibold text-fg">{planTitle(plan)}</span>
        </span>
        <ChevronRight className="mt-0.5 size-4 shrink-0 text-fg-muted" aria-hidden />
      </span>
      <span className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-caption text-fg-secondary">
        <span className="inline-flex items-center gap-1">
          <Truck className="size-3.5 shrink-0" aria-hidden />
          <span className="font-medium text-fg">{plate}</span>
          {plan.fleetCode ? <span className="text-fg-muted">· {plan.fleetCode}</span> : null}
        </span>
        <span className="inline-flex min-w-0 items-center gap-1">
          <MapPin className="size-3.5 shrink-0" aria-hidden />
          <span className="truncate">{plan.operationName ?? "Sem operação"}</span>
        </span>
      </span>
      <span className="flex flex-wrap items-center gap-1.5">
        <PriorityBadge priority={plan.priority} />
        <DeadlineBadge deadline={plan.deadline} days={plan.daysOverdue} />
        <PlanStatusBadge status={plan.status} />
        {plan.isRecurrence ? <RecurrenceBadge /> : null}
      </span>
      <span className="mt-auto flex flex-wrap gap-x-3 gap-y-0.5 text-caption text-fg-muted">
        <span className="tabular-nums">Prazo {formatDate(plan.dueOn)}</span>
        <span className="tabular-nums">
          {formatInt(plan.openItems)} {plan.openItems === 1 ? "apontamento pendente" : "apontamentos pendentes"}
        </span>
        <span className="min-w-0 truncate">{plan.responsibleName ? `Responsável: ${plan.responsibleName}` : "Sem responsável"}</span>
      </span>
    </button>
  );
}

export function MyViewPanel({ myView, perms, actions }: MyViewPanelProps) {
  const link = useDrillLink(actions);

  if (!myView) {
    return (
      <div data-testid="action-plans-my-view">
        <ErrorState
          variant="panel"
          title="Não foi possível carregar a sua visão"
          description="A leitura do seu escopo falhou. Tente de novo em instantes."
          onRetry={actions.refresh}
          retryLabel="Tentar de novo"
          retrying={actions.pending}
          data-testid="my-view-error"
        />
      </div>
    );
  }

  const s = myView.scope;
  const mine = myView.mine;
  const attention = myView.attention ?? [];
  const byOperation = myView.byOperation ?? [];
  const plansPatch = (patch: Patch): Patch => ({ ...LIST_RESET, ...CLEAR_FILTERS, aba: "planos", ...patch });
  const plans = (patch: Patch) => link(plansPatch(patch));
  const dashboardButton = perms.viewDashboard ? (
    <Button
      variant="secondary"
      leadingIcon={<LayoutDashboard />}
      onClick={() => actions.navigate({ ...LIST_RESET, aba: "visao-geral" })}
      data-testid="my-view-open-overview"
    >
      Abrir a visão geral
    </Button>
  ) : undefined;

  if (s.plansOpen === 0) {
    return (
      <div className="flex min-w-0 flex-col gap-4" data-testid="action-plans-my-view">
        <EmptyState
          variant="panel"
          icon={<CircleCheck />}
          title="Nenhuma pendência no seu escopo"
          description="Não há planos de manutenção em aberto nas operações que você acompanha. As novas inconformidades do Check List aparecem aqui assim que forem recebidas."
          action={dashboardButton}
          data-testid="my-view-empty"
        />
      </div>
    );
  }

  const overdueOps = byOperation.filter((o) => o.overdue > 0).length;

  return (
    <div className="flex min-w-0 flex-col gap-8" data-testid="action-plans-my-view">
      <p className="text-body-sm text-fg-muted" data-testid="my-view-today">
        Hoje <span className="font-medium tabular-nums text-fg-secondary">{formatDate(myView.today)}</span> · planos em aberto nas
        operações do seu escopo, sem recorte de período nem os filtros da lista.
      </p>

      {/* ------------------------------------------------------- Seu escopo */}
      <section aria-label="Seu escopo" className="flex min-w-0 flex-col gap-3">
        <SectionHeader
          title="Seu escopo"
          description="O que está em aberto agora; cada indicador abre a lista filtrada."
          icon={<Inbox />}
          actions={dashboardButton}
        />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <DrillKpi
            testId="my-kpi-plans-open"
            label="Planos abertos"
            value={formatInt(s.plansOpen)}
            status="info"
            icon={<Inbox />}
            period={`${formatInt(byOperation.length)} ${byOperation.length === 1 ? "operação" : "operações"}`}
            link={plans({ grupo: "open" })}
            destination="ver os planos em aberto"
          />
          <DrillKpi
            testId="my-kpi-items-open"
            label="Apontamentos pendentes"
            value={formatInt(s.itemsOpen)}
            status={s.itemsOpen > 0 ? "warning" : "neutral"}
            icon={<Hourglass />}
            period="nos planos em aberto"
            link={plans({ grupo: "open" })}
            destination="ver os planos com apontamentos pendentes"
          />
          <DrillKpi
            testId="my-kpi-overdue"
            label="Vencidos"
            value={formatInt(s.overdue)}
            status={s.overdue > 0 ? "danger" : "neutral"}
            icon={<TriangleAlert />}
            period={overdueOps > 0 ? `em ${formatInt(overdueOps)} ${overdueOps === 1 ? "operação" : "operações"}` : "nenhum plano vencido"}
            link={plans({ prazo: "overdue", grupo: null })}
            destination="ver os planos vencidos"
          />
          <DrillKpi
            testId="my-kpi-due-soon"
            label="Vencem em breve"
            value={formatInt(s.dueSoon)}
            status={s.dueSoon > 0 ? "warning" : "neutral"}
            icon={<AlarmClock />}
            period="hoje ou nos próximos dias"
            link={plans({ prazo: "upcoming", grupo: null })}
            destination="ver os planos que vencem em breve"
          />
          <DrillKpi
            testId="my-kpi-critical"
            label="Críticos"
            value={formatInt(s.critical)}
            status={s.critical > 0 ? "danger" : "neutral"}
            icon={<ShieldAlert />}
            period="prioridade crítica"
            link={plans({ prioridade: "critical", grupo: "open" })}
            destination="ver os planos críticos em aberto"
          />
          <DrillKpi
            testId="my-kpi-in-maintenance"
            label="Em manutenção"
            value={formatInt(s.inMaintenance)}
            status="accent"
            icon={<Wrench />}
            period="aberta, agendada ou em execução"
            link={plans({ situacao: IN_MAINTENANCE, grupo: null })}
            destination="ver os planos em manutenção"
          />
          <DrillKpi
            testId="my-kpi-pending-new-action"
            label="Pendentes de nova tratativa"
            value={formatInt(s.pendingNewAction)}
            status={s.pendingNewAction > 0 ? "danger" : "neutral"}
            icon={<RotateCcw />}
            period="a manutenção terminou sem resolver"
            link={plans({ situacao: "pending_new_action", grupo: null })}
            destination="ver os planos pendentes de nova tratativa"
          />
          <DrillKpi
            testId="my-kpi-without-treatment"
            label="Sem tratativa"
            value={formatInt(s.withoutTreatment)}
            status={s.withoutTreatment > 0 ? "warning" : "neutral"}
            icon={<CircleDashed />}
            period="novos ou em análise"
            link={plans({ situacao: "new,in_analysis", grupo: null })}
            destination="ver os planos ainda sem tratativa"
          />
        </div>
      </section>

      {/* ------------------------------------------------------- Sob minha responsabilidade */}
      <section aria-label="Sob minha responsabilidade" className="flex min-w-0 flex-col gap-3">
        <SectionHeader
          title="Sob minha responsabilidade"
          description="Planos em aberto em que você é o responsável atual."
          icon={<UserCheck />}
        />
        {/* Um par: as duas colunas preenchem a linha (sem metade vazia). */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <DrillKpi
            testId="my-kpi-mine-open"
            label="Meus planos abertos"
            value={formatInt(mine.plansOpen)}
            status="primary"
            icon={<UserCheck />}
            period={mine.plansOpen === 0 ? "nenhum plano atribuído a você" : `de ${formatInt(s.plansOpen)} no seu escopo`}
            link={plans({ meus: "1", grupo: "open" })}
            destination="ver os meus planos em aberto"
          />
          <DrillKpi
            testId="my-kpi-mine-overdue"
            label="Meus vencidos"
            value={formatInt(mine.overdue)}
            status={mine.overdue > 0 ? "danger" : "neutral"}
            icon={<CalendarClock />}
            period={mine.overdue > 0 ? "prazo vencido, sob sua responsabilidade" : "nenhum vencido sob sua responsabilidade"}
            link={plans({ meus: "1", prazo: "overdue", grupo: null })}
            destination="ver os meus planos vencidos"
          />
        </div>
      </section>

      {/* ------------------------------------------------------- Atenção agora */}
      <section aria-label="Atenção agora" className="flex min-w-0 flex-col gap-3" data-testid="my-view-attention">
        <SectionHeader
          title="Atenção agora"
          description="Vencidos primeiro, depois os que vencem hoje e em breve, por prioridade. Clique para abrir o plano."
          icon={<Siren />}
          actions={
            s.overdue > 0 ? (
              <a
                {...plans({ prazo: "overdue", grupo: null })}
                className="rounded-xs text-caption font-medium text-link hfm-transition hover:text-link-hover hover:underline hfm-focus-ring"
                data-testid="my-view-attention-all"
              >
                Ver todos os vencidos
              </a>
            ) : undefined
          }
        />
        {attention.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border bg-surface-raised px-4 py-6 text-center text-body-sm text-fg-muted">
            Nenhum plano pede atenção imediata no seu escopo.
          </p>
        ) : (
          <ul className="grid grid-cols-1 gap-3 lg:grid-cols-2 2xl:grid-cols-3" aria-label="Planos que pedem atenção agora">
            {attention.map((plan) => (
              <li key={plan.id} className="min-w-0">
                <AttentionCard plan={plan} onOpen={actions.openPlan} />
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ------------------------------------------------------- Por operação */}
      <section aria-label="Por operação" className="flex min-w-0 flex-col gap-3">
        <SectionHeader
          title="Por operação"
          description="Onde estão os planos em aberto do seu escopo."
          icon={<MapPin />}
        />
        <ChartCard
          title="Planos em aberto por operação"
          description="Vencidos ao lado de cada barra"
          legend={
            <ChartLegend
              items={[
                { key: "ok", label: "Sem vencidos", color: TONE_COLOR.info },
                { key: "overdue", label: "Com vencidos", color: TONE_COLOR.danger },
              ]}
            />
          }
          insight={
            overdueOps > 0
              ? `${formatInt(overdueOps)} de ${formatInt(byOperation.length)} ${byOperation.length === 1 ? "operação tem" : "operações têm"} planos vencidos.`
              : "Nenhuma operação com planos vencidos."
          }
          empty={byOperation.length === 0 ? "Sem planos em aberto." : undefined}
          data-testid="my-view-by-operation"
        >
          <HBarChart
            ariaLabel="Planos em aberto por operação, no seu escopo"
            kind="count"
            format={chartFormat.int}
            items={byOperation.map((o) => {
              const color = o.overdue > 0 ? TONE_COLOR.danger : TONE_COLOR.info;
              return {
                key: o.key ?? `none-${o.label}`,
                label: o.label,
                value: o.open,
                color,
                detail: o.overdue > 0 ? `· ${formatInt(o.overdue)} venc.` : undefined,
                tooltip: {
                  title: o.label,
                  subtitle: "Operação",
                  rows: [
                    { label: "Em aberto", value: formatInt(o.open), color, marker: "square" as const, emphasis: true },
                    { label: "Vencidos", value: formatInt(o.overdue), tone: o.overdue > 0 ? ("danger" as const) : ("muted" as const) },
                  ],
                  footer: o.key ? "Clique para ver os planos da operação." : undefined,
                  announce: `${o.label}: ${formatInt(o.open)} em aberto, ${formatInt(o.overdue)} vencidos`,
                },
              };
            })}
            onSelect={(_, index) => {
              const key = byOperation[index]?.key;
              if (key) actions.navigate(plansPatch({ operacao: key, grupo: "open" }));
            }}
          />
          <SrTable
            caption="Planos em aberto por operação, no seu escopo"
            columns={["Operação", "Em aberto", "Vencidos"]}
            rows={byOperation.map((o) => ({ key: o.key ?? `none-${o.label}`, cells: [o.label, formatInt(o.open), formatInt(o.overdue)] }))}
          />
        </ChartCard>
      </section>
    </div>
  );
}
