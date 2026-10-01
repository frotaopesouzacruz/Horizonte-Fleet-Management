"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowUpRight, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/ui/status-badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Alert, AlertDescription, AlertTitle } from "@/components/feedback/alert";
import { EmptyState } from "@/components/feedback/empty-state";
import { LoadingState } from "@/components/feedback/loading-state";
import { loadVehicleActionPlans } from "@/lib/action-plans/actions";
import {
  formatDate,
  formatDateTime,
  formatInt,
  isClosed,
  MAINTENANCE_STATUS_LABEL,
  planTitle,
} from "@/lib/action-plans/labels";
import { MODULE_PATH } from "@/lib/action-plans/url";
import type { ActionPlanRow, MaintenanceRef } from "@/lib/action-plans/types";
import { DeadlineBadge, PlanStatusBadge, PriorityBadge, RecurrenceBadge } from "./badges";

/**
 * Planos de ação de um veículo — a aba "Planos de ação" do Cadastro de Frotas.
 *
 * É uma CONSULTA à base do Plano de Ação (`action_plan_vehicle`, pelo id do
 * veículo, nunca pela placa): ativos, históricos (ciclos encerrados),
 * reincidências e as manutenções que os planos citam. Tratar o plano é no
 * módulo — cada plano abre lá, com a gaveta já aberta.
 */

type Section = "ativos" | "historicos" | "reincidencias";

const SECTION_LABEL: Record<Section, string> = {
  ativos: "Ativos",
  historicos: "Históricos",
  reincidencias: "Reincidências",
};

function planHref(vehicleId: string, planId: string): string {
  const params = new URLSearchParams({ aba: "planos", veiculo: vehicleId, plano: planId });
  return `${MODULE_PATH}?${params.toString()}`;
}

function maintenanceHref(vehicleId: string, maintenanceId: string): string {
  return `/frota/manutencao?aba=base&veiculo=${vehicleId}&m=${maintenanceId}`;
}

interface RelatedMaintenance extends MaintenanceRef {
  plans: { id: string; code: string }[];
}

export function VehicleActionPlans({ vehicleId }: { vehicleId: string }) {
  const [attempt, setAttempt] = React.useState(0);
  const [section, setSection] = React.useState<Section>("ativos");
  const [state, setState] = React.useState<{
    id: string;
    attempt: number;
    rows: ActionPlanRow[] | null;
    error: string | null;
  } | null>(null);

  // A resposta só vale para o veículo e a tentativa que a pediram; trocar de
  // veículo no meio da leitura descarta a resposta atrasada.
  React.useEffect(() => {
    let cancelled = false;
    void loadVehicleActionPlans(vehicleId).then((result) => {
      if (cancelled) return;
      setState({
        id: vehicleId,
        attempt,
        rows: result.ok ? (result.data ?? []) : null,
        error: result.ok ? null : (result.error ?? "Falha ao carregar."),
      });
    });
    return () => {
      cancelled = true;
    };
  }, [vehicleId, attempt]);

  const current = state && state.id === vehicleId && state.attempt === attempt ? state : null;
  const rows = React.useMemo(() => current?.rows ?? [], [current]);

  const groups = React.useMemo(() => {
    const active = rows.filter((r) => !isClosed(r.status));
    const closed = rows
      .filter((r) => isClosed(r.status))
      .sort((a, b) => (b.closedAt ?? b.lastOccurrenceAt).localeCompare(a.closedAt ?? a.lastOccurrenceAt));
    const recurrences = rows.filter((r) => r.isRecurrence);
    const maintenances = new Map<string, RelatedMaintenance>();
    for (const plan of rows) {
      for (const m of plan.maintenances) {
        const entry = maintenances.get(m.id) ?? { ...m, plans: [] };
        if (!entry.plans.some((p) => p.id === plan.id)) entry.plans.push({ id: plan.id, code: plan.code });
        entry.resolutive = entry.resolutive || m.resolutive;
        maintenances.set(m.id, entry);
      }
    }
    return {
      ativos: active,
      historicos: closed,
      reincidencias: recurrences,
      maintenances: [...maintenances.values()].sort((a, b) => b.code.localeCompare(a.code, "pt-BR")),
      openItems: active.reduce((acc, r) => acc + r.openItems, 0),
      overdue: active.filter((r) => r.deadline === "overdue").length,
    };
  }, [rows]);

  if (!current) return <LoadingState label="Carregando planos de ação…" />;
  if (current.error) {
    return (
      <Alert variant="danger">
        <AlertTitle>Não foi possível carregar os planos de ação</AlertTitle>
        <AlertDescription className="flex flex-wrap items-center gap-2">
          {current.error}
          <Button size="sm" variant="secondary" leadingIcon={<RotateCcw />} onClick={() => setAttempt((n) => n + 1)}>
            Tentar de novo
          </Button>
        </AlertDescription>
      </Alert>
    );
  }

  if (rows.length === 0) {
    return (
      <EmptyState
        title="Nenhum plano de ação para este veículo"
        description="Nenhuma inconformidade de manutenção do Check List virou plano para este veículo, ou os planos estão fora do seu escopo de acesso."
        action={
          <Button asChild size="sm" variant="secondary" trailingIcon={<ArrowUpRight />}>
            <Link href={`${MODULE_PATH}?aba=planos&veiculo=${vehicleId}`}>Abrir Planos de Ação</Link>
          </Button>
        }
      />
    );
  }

  const list = groups[section];

  return (
    <div className="flex flex-col gap-4" data-testid="vehicle-action-plans">
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Fact label="Planos ativos">{formatInt(groups.ativos.length)}</Fact>
        <Fact label="Apontamentos em aberto">{formatInt(groups.openItems)}</Fact>
        <Fact label="Vencidos">{formatInt(groups.overdue)}</Fact>
        <Fact label="Possíveis reincidências">{formatInt(groups.reincidencias.length)}</Fact>
      </dl>

      <Tabs appearance="segmented" value={section} onValueChange={(v) => setSection(v as Section)}>
        <div className="-mx-1 overflow-x-auto px-1 pb-1">
          <TabsList aria-label="Planos do veículo" className="w-max">
            {(Object.keys(SECTION_LABEL) as Section[]).map((s) => (
              <TabsTrigger key={s} value={s} count={groups[s].length}>
                {SECTION_LABEL[s]}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>
        <TabsContent value={section} className="flex flex-col gap-2">
          {list.length === 0 ? (
            <p className="rounded-md border border-dashed border-border px-3 py-6 text-center text-body-sm text-fg-muted">
              {section === "ativos"
                ? "Nenhum plano em aberto: todas as inconformidades deste veículo foram tratadas."
                : section === "historicos"
                  ? "Nenhum plano encerrado ainda."
                  : "Nenhuma reincidência registrada para este veículo."}
            </p>
          ) : (
            <ul className="flex flex-col gap-2" aria-label={`Planos ${SECTION_LABEL[section].toLowerCase()}`}>
              {list.map((plan) => (
                <li key={plan.id}>
                  <PlanCard plan={plan} vehicleId={vehicleId} showCycle={section !== "ativos"} />
                </li>
              ))}
            </ul>
          )}
        </TabsContent>
      </Tabs>

      <section aria-labelledby="vehicle-action-plans-maintenances" className="flex flex-col gap-2">
        <h3 id="vehicle-action-plans-maintenances" className="text-label font-semibold text-fg">
          Manutenções relacionadas
        </h3>
        {groups.maintenances.length === 0 ? (
          <p className="text-caption text-fg-muted">Nenhuma manutenção vinculada aos planos deste veículo.</p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {groups.maintenances.map((m) => (
              <li
                key={m.id}
                className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-sm border border-border bg-surface px-3 py-2 text-body-sm"
              >
                <Link
                  href={maintenanceHref(vehicleId, m.id)}
                  className="font-mono text-caption font-semibold text-link hover:underline hfm-focus-ring"
                >
                  {m.code}
                </Link>
                <StatusBadge status={m.status === "completed" ? "success" : m.status === "cancelled" || m.status === "not_performed" ? "neutral" : "progress"} size="sm">
                  {MAINTENANCE_STATUS_LABEL[m.status] ?? m.status}
                </StatusBadge>
                {m.resolutive ? (
                  <Badge variant="success" appearance="outline" size="sm">Resolutiva</Badge>
                ) : null}
                <span className="text-caption text-fg-muted">
                  {m.plans.length === 1 ? "Plano " : "Planos "}
                  {m.plans.map((p) => p.code).join(", ")}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <div>
        <Button asChild size="sm" variant="secondary" trailingIcon={<ArrowUpRight />}>
          <Link href={`${MODULE_PATH}?aba=planos&veiculo=${vehicleId}`}>Ver no módulo Planos de Ação</Link>
        </Button>
      </div>
    </div>
  );
}

function PlanCard({ plan, vehicleId, showCycle }: { plan: ActionPlanRow; vehicleId: string; showCycle: boolean }) {
  const closed = isClosed(plan.status);
  return (
    <div className="flex flex-col gap-2 rounded-md border border-border bg-surface p-3" data-testid="vehicle-action-plan">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex min-w-0 flex-col gap-0.5">
          <Link
            href={planHref(vehicleId, plan.id)}
            className="w-fit font-mono text-caption font-semibold text-link hover:underline hfm-focus-ring"
          >
            {plan.code}
          </Link>
          <span className="text-body-sm font-medium break-words text-fg">{planTitle(plan)}</span>
          {plan.clusterName ? <span className="text-caption text-fg-muted">{plan.clusterName}</span> : null}
        </div>
        <div className="flex flex-wrap items-center gap-1">
          <PlanStatusBadge status={plan.status} />
          {!closed ? <PriorityBadge priority={plan.priority} /> : null}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-1">
        <DeadlineBadge deadline={plan.deadline} days={plan.daysOverdue} />
        {plan.isRecurrence ? <RecurrenceBadge /> : null}
        {showCycle && plan.cycleNumber > 1 ? (
          <Badge variant="neutral" appearance="outline" size="sm">Ciclo {plan.cycleNumber}</Badge>
        ) : null}
        {plan.reopenedCount > 0 ? (
          <Badge variant="warning" appearance="outline" size="sm">
            Reaberto {plan.reopenedCount === 1 ? "1 vez" : `${plan.reopenedCount} vezes`}
          </Badge>
        ) : null}
      </div>
      <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-caption sm:grid-cols-4">
        <Mini label="Primeira ocorrência">{formatDate(plan.firstOperationalDate)}</Mini>
        <Mini label="Última ocorrência">{formatDate(plan.lastOperationalDate)}</Mini>
        <Mini label="Ocorrências">{formatInt(plan.occurrences)}</Mini>
        {closed ? (
          <Mini label="Encerrado em">{formatDateTime(plan.closedAt)}</Mini>
        ) : (
          <Mini label="Prazo">{formatDate(plan.dueOn)}</Mini>
        )}
      </dl>
      {plan.lastTreatment ? (
        <p className="text-caption text-fg-secondary">
          <span className="text-fg-muted">Última tratativa: </span>
          {plan.lastTreatment}
          {plan.lastTreatmentAt ? ` · ${formatDateTime(plan.lastTreatmentAt)}` : ""}
        </p>
      ) : null}
      {plan.previousPlanId ? (
        <Link
          href={planHref(vehicleId, plan.previousPlanId)}
          className="w-fit text-caption text-link hover:underline hfm-focus-ring"
        >
          Ver o ciclo anterior
        </Link>
      ) : null}
    </div>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-caption text-fg-muted">{label}</dt>
      <dd className="text-body-sm font-medium tabular-nums text-fg">{children}</dd>
    </div>
  );
}

function Mini({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col">
      <dt className="text-fg-muted">{label}</dt>
      <dd className="truncate text-fg tabular-nums">{children}</dd>
    </div>
  );
}
