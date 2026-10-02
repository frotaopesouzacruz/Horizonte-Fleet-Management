"use client";

import * as React from "react";
import {
  ArrowLeft,
  CheckCheck,
  ClipboardCopy,
  Download,
  History,
  Pencil,
  RefreshCw,
  SearchX,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/feedback/alert";
import { EmptyState } from "@/components/feedback/empty-state";
import { ErrorState } from "@/components/feedback/error-state";
import { useToast } from "@/components/feedback/toast";
import type { KmRotationData, KmRotationItem, KmRotationPlanDetail } from "@/lib/km/rotation";
import { revalidatePlan, simulateRotation, type RevalidateResult } from "@/lib/km/rotation-actions";
import { fmtInt, fmtKm, fmtPct, formatDate } from "@/lib/km/types";
import type { KmPanelContext } from "../../shared";
import { AnalysisDrawer } from "./analysis-drawer";
import {
  ActionDialog,
  EditPlanDialog,
  FidelizationDialog,
  ItemActionDialog,
  PlanStatusDialog,
  type ItemAction,
} from "./dialogs";
import {
  activeItems,
  analysisFromItem,
  copyText,
  eventText,
  formatStamp,
  groupItems,
  localsText,
  OBJECTIVE,
  period,
  planReportText,
  plural,
  scopeText,
  type RotationAnalysis,
} from "./format";
import { PlanItemCard, type ItemPerms } from "./plan-item";
import { Fact, Facts, RotationStatusBadge, Section } from "./ui";

/**
 * Detalhe de um plano (`plano` na URL): cabeçalho com as ações do plano,
 * informações, rodízios por grupo técnico com as ações de cada etapa e a
 * linha do tempo. Cada botão aparece só com a permissão e a transição válida;
 * o banco confere de novo. Não há exclusão: cancelar (com motivo) é o caminho.
 */
export function PlanDetailView({ data, ctx }: { data: KmRotationData; ctx: KmPanelContext }) {
  const back = (
    <Button variant="ghost" size="sm" leadingIcon={<ArrowLeft aria-hidden />} onClick={() => ctx.navigate({ plano: null })} data-testid="km-rodizio-plan-back">
      Voltar aos planos
    </Button>
  );
  if (data.planError) {
    return (
      <div className="flex flex-col gap-3">
        <div>{back}</div>
        <ErrorState title="Não foi possível abrir o plano." description={data.planError} onRetry={ctx.refresh} retrying={ctx.pending} />
      </div>
    );
  }
  if (!data.plan) {
    return (
      <div className="flex flex-col gap-3">
        <div>{back}</div>
        <EmptyState variant="panel" icon={<SearchX aria-hidden />} title="Plano não encontrado" description="O plano não existe ou está fora do seu acesso." />
      </div>
    );
  }
  return <PlanDetail key={data.plan.plan.id} detail={data.plan} data={data} ctx={ctx} back={back} />;
}

type PlanDialog = { kind: "edit" } | { kind: "approve" } | { kind: "cancel" } | { kind: "revalidate" } | null;
type ItemDialog = { kind: "action"; item: KmRotationItem; action: ItemAction } | { kind: "fidelization"; item: KmRotationItem } | null;

function PlanDetail({
  detail,
  data,
  ctx,
  back,
}: {
  detail: KmRotationPlanDetail;
  data: KmRotationData;
  ctx: KmPanelContext;
  back: React.ReactNode;
}) {
  const { toast } = useToast();
  const { plan, items, events } = detail;
  const row = data.plans.find((p) => p.id === plan.id);
  const today = data.period.today;
  const dp = detail.permissions ?? { create: true, approve: true, schedule: true, execute: true, applyFidelization: true };
  const perms = {
    create: ctx.perms.rotationCreate && dp.create !== false,
    approve: ctx.perms.rotationApprove && dp.approve !== false,
    schedule: ctx.perms.rotationSchedule && dp.schedule !== false,
    execute: ctx.perms.rotationExecute && dp.execute !== false,
    applyFidelization: ctx.perms.rotationApplyFidelization && dp.applyFidelization !== false,
  };
  const itemPerms: ItemPerms = {
    approve: perms.approve,
    schedule: perms.schedule,
    execute: perms.execute,
    edit: perms.schedule || perms.create,
    applyFidelization: perms.applyFidelization,
  };

  const [planDialog, setPlanDialog] = React.useState<PlanDialog>(null);
  const [itemDialog, setItemDialog] = React.useState<ItemDialog>(null);
  const [analysis, setAnalysis] = React.useState<{ view: RotationAnalysis; item: KmRotationItem } | null>(null);
  const [revalidation, setRevalidation] = React.useState<RevalidateResult | null>(null);
  const [showAllEvents, setShowAllEvents] = React.useState(false);

  const active = activeItems(items);
  const groups = groupItems(items);
  const suggested = items.filter((i) => i.status === "suggested").length;
  const open = items.filter((i) => ["suggested", "approved", "scheduled"].includes(i.status)).length;
  const executed = items.filter((i) => i.status === "executed").length;
  const cancelled = items.filter((i) => i.status === "cancelled").length;
  const employees = React.useMemo(() => new Map(data.employees.map((e) => [e.id, e.name])), [data.employees]);

  const done = (message: string) => {
    toast({ variant: "success", title: message });
    ctx.refresh();
  };

  async function copyReport() {
    const ok = await copyText(planReportText(detail, row?.avgReductionPct));
    toast(
      ok
        ? { variant: "success", title: "Relatório copiado", description: "Cole no e-mail ou no Teams." }
        : { variant: "danger", title: "Não foi possível copiar", description: "O navegador bloqueou a área de transferência." },
    );
  }

  const shownEvents = showAllEvents ? events : events.slice(0, 12);

  return (
    <div className="flex flex-col gap-4" data-testid="km-rodizio-plan-detail">
      <div>{back}</div>

      <header className="flex flex-col gap-3 rounded-lg border border-border bg-surface-raised p-4 shadow-card">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="min-w-0 break-words text-h3 font-semibold text-fg" data-testid="km-rodizio-plan-name">
                {plan.name}
              </h2>
              <RotationStatusBadge status={plan.status} />
            </div>
            <p className="text-body-sm text-fg-muted">
              {plan.code} · {OBJECTIVE}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2" data-testid="km-rodizio-plan-actions">
            {perms.create ? (
              <Button size="sm" variant="outline" leadingIcon={<Pencil aria-hidden />} onClick={() => setPlanDialog({ kind: "edit" })} data-testid="km-rodizio-plan-edit-open">
                Editar
              </Button>
            ) : null}
            <Button size="sm" variant="outline" leadingIcon={<ClipboardCopy aria-hidden />} onClick={copyReport} data-testid="km-rodizio-plan-copy">
              Copiar relatório
            </Button>
            {ctx.perms.export ? (
              <Button size="sm" variant="outline" asChild>
                <a href={`${ctx.basePath}/export/rodizio?plano=${encodeURIComponent(plan.id)}`} download data-testid="km-rodizio-plan-export">
                  <Download aria-hidden />
                  Exportar
                </a>
              </Button>
            ) : null}
            {(perms.create || perms.approve) && open > 0 ? (
              <Button size="sm" variant="outline" leadingIcon={<RefreshCw aria-hidden />} onClick={() => setPlanDialog({ kind: "revalidate" })} data-testid="km-rodizio-plan-revalidate">
                Revalidar plano
              </Button>
            ) : null}
            {perms.approve && suggested > 0 ? (
              <Button size="sm" leadingIcon={<CheckCheck aria-hidden />} onClick={() => setPlanDialog({ kind: "approve" })} data-testid="km-rodizio-plan-approve-open">
                Aprovar sugeridos ({fmtInt(suggested)})
              </Button>
            ) : null}
            {perms.approve && open > 0 ? (
              <Button size="sm" variant="ghost" leadingIcon={<XCircle aria-hidden />} onClick={() => setPlanDialog({ kind: "cancel" })} data-testid="km-rodizio-plan-cancel-open">
                Cancelar plano
              </Button>
            ) : null}
          </div>
        </div>
      </header>

      {plan.stale && open > 0 ? (
        <Alert variant="warning" data-testid="km-rodizio-plan-stale">
          <AlertDescription>
            Dados analisados há {plural(plan.staleDays ?? 0, "dia", "dias")}. Recomendamos revalidar antes da execução.
          </AlertDescription>
        </Alert>
      ) : null}

      {revalidation ? (
        <Alert variant="success" onDismiss={() => setRevalidation(null)} data-testid="km-rodizio-plan-revalidated">
          <AlertTitle>Plano revalidado</AlertTitle>
          <AlertDescription>
            {plural(revalidation.updated, "rodízio atualizado", "rodízios atualizados")} · {fmtInt(revalidation.noBenefit)} sem benefício ·{" "}
            {fmtInt(revalidation.withoutData)} sem dados no período · novo período analisado {period(revalidation.periodFrom, revalidation.periodTo)}.
          </AlertDescription>
        </Alert>
      ) : null}

      <Section title="Informações do plano" testId="km-rodizio-plan-info">
        <Facts className="lg:grid-cols-4">
          <Fact label="Objetivo">{OBJECTIVE}</Fact>
          <Fact label="Período analisado">{period(plan.periodFrom, plan.periodTo)}</Fact>
          <Fact label="Horizonte de projeção">{fmtInt(plan.horizonDays)} dias</Fact>
          <Fact label="Escopo">{scopeText(plan.scopeMode, plan.differentLocationsOnly)}</Fact>
          <Fact label="Rodízios">
            {fmtInt(active.length)}
            <span className="text-fg-muted">
              {" "}
              · {fmtInt(executed)} {executed === 1 ? "executado" : "executados"}
              {cancelled ? ` · ${fmtInt(cancelled)} ${cancelled === 1 ? "cancelado" : "cancelados"}` : ""}
            </span>
          </Fact>
          <Fact label="Grupos envolvidos">{fmtInt(groupItems(active).length)}</Fact>
          <Fact label="Locais envolvidos">{localsText(active)}</Fact>
          <Fact label="Redução média estimada do desequilíbrio">
            {fmtPct(row?.avgReductionPct)}
            {row?.reductionKm != null ? <span className="text-fg-muted"> · {fmtKm(row.reductionKm)} no total</span> : null}
          </Fact>
          <Fact label="Dados analisados em">
            {formatStamp(plan.analyzedAt ?? plan.createdAt)}
            {plan.dataAsOf ? <span className="text-fg-muted"> · leituras até {formatDate(plan.dataAsOf)}</span> : null}
          </Fact>
          {plan.revalidatedAt ? <Fact label="Revalidado em">{formatStamp(plan.revalidatedAt)}</Fact> : null}
          <Fact label="Criado por">
            {plan.createdByName ?? "—"}
            <span className="text-fg-muted"> · {formatStamp(plan.createdAt)}</span>
          </Fact>
          {plan.cancelReason ? <Fact label="Motivo do cancelamento">{plan.cancelReason}</Fact> : null}
          <Fact label="Observação" wide>
            {plan.notes ?? "—"}
          </Fact>
        </Facts>
      </Section>

      <section aria-labelledby="km-rodizio-items-title" className="flex flex-col gap-3">
        <h3 id="km-rodizio-items-title" className="text-section-title font-semibold text-fg">
          Rodízios ({fmtInt(items.length)})
        </h3>
        {items.length === 0 ? (
          <EmptyState variant="panel" size="sm" title="Este plano não tem rodízios." />
        ) : (
          groups.map((g) => (
            <div key={g.label} className="flex flex-col gap-2 rounded-lg border border-border bg-surface-raised p-3 shadow-card sm:p-4" data-testid="km-rodizio-plan-group">
              <h4 className="text-h4 font-semibold text-fg">
                {g.label} <span className="text-body-sm font-normal text-fg-muted">· {plural(g.items.length, "rodízio", "rodízios")}</span>
              </h4>
              <div className="flex flex-col gap-3">
                {g.items.map((it) => (
                  <PlanItemCard
                    key={it.id}
                    item={it}
                    plan={plan}
                    perms={itemPerms}
                    employees={data.employees}
                    onAnalyze={() => setAnalysis({ view: analysisFromItem(it, plan), item: it })}
                    onAction={(action) => setItemDialog({ kind: "action", item: it, action })}
                    onFidelization={() => setItemDialog({ kind: "fidelization", item: it })}
                    onSaved={done}
                  />
                ))}
              </div>
            </div>
          ))
        )}
      </section>

      <Section
        title="Linha do tempo"
        description="Cada decisão do plano, com autor e data."
        action={<History className="size-4 text-fg-muted" aria-hidden />}
        testId="km-rodizio-plan-timeline"
      >
        {events.length === 0 ? (
          <p className="text-body-sm text-fg-muted">Sem eventos registrados.</p>
        ) : (
          <>
            <ol className="flex flex-col">
              {shownEvents.map((ev) => (
                <li key={ev.id} className="relative flex gap-3 border-l border-border pb-3 pl-4 last:pb-0">
                  <span aria-hidden className="absolute top-1.5 -left-[4.5px] size-2 rounded-full bg-accent" />
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <p className="text-body-sm text-fg">{eventText(ev, items, employees)}</p>
                    {ev.reason ? <p className="text-caption text-fg-secondary">Motivo: {ev.reason}</p> : null}
                    <p className="text-caption text-fg-muted">
                      <time dateTime={ev.occurredAt}>{formatStamp(ev.occurredAt)}</time> · {ev.actorName ?? "Sistema"}
                    </p>
                  </div>
                </li>
              ))}
            </ol>
            {events.length > 12 ? (
              <Button variant="ghost" size="sm" className="w-fit" onClick={() => setShowAllEvents((v) => !v)}>
                {showAllEvents ? "Mostrar menos" : `Mostrar todos (${fmtInt(events.length)})`}
              </Button>
            ) : null}
          </>
        )}
      </Section>

      {/* Diálogos do plano */}
      {planDialog?.kind === "edit" ? (
        <EditPlanDialog plan={plan} open onOpenChange={(o) => !o && setPlanDialog(null)} onDone={done} />
      ) : null}
      {planDialog?.kind === "approve" || planDialog?.kind === "cancel" ? (
        <PlanStatusDialog
          plan={plan}
          status={planDialog.kind === "approve" ? "approved" : "cancelled"}
          count={planDialog.kind === "approve" ? suggested : open}
          onClose={() => setPlanDialog(null)}
          onDone={done}
        />
      ) : null}
      {planDialog?.kind === "revalidate" ? (
        <ActionDialog
          open
          onOpenChange={(o) => !o && setPlanDialog(null)}
          title={`Revalidar o plano ${plan.code}?`}
          description={`${plural(open, "rodízio não executado é recalculado", "rodízios não executados são recalculados")} com as leituras atuais (mesma duração de período, terminando no último dia com leitura). Os executados e cancelados não mudam; nada é movimentado.`}
          confirmLabel="Revalidar"
          onConfirm={async () => {
            const res = await revalidatePlan(plan.id);
            if (!res.ok || !res.data) return res.error ?? "Não foi possível revalidar o plano.";
            setRevalidation(res.data);
            ctx.refresh();
            return null;
          }}
          testId="km-rodizio-plan-revalidate-dialog"
        />
      ) : null}

      {/* Diálogos do rodízio */}
      {itemDialog?.kind === "action" ? (
        <ItemActionDialog
          key={`${itemDialog.item.id}:${itemDialog.action}`}
          item={itemDialog.item}
          action={itemDialog.action}
          today={today}
          onClose={() => setItemDialog(null)}
          onDone={done}
        />
      ) : null}
      {itemDialog?.kind === "fidelization" ? (
        <FidelizationDialog
          key={itemDialog.item.id}
          item={itemDialog.item}
          plan={plan}
          today={today}
          onClose={() => setItemDialog(null)}
          onDone={done}
        />
      ) : null}

      <AnalysisDrawer
        analysis={analysis?.view ?? null}
        onOpenChange={(o) => !o && setAnalysis(null)}
        onSimulate={
          analysis
            ? () =>
                simulateRotation(analysis.item.vehicleAId, analysis.item.vehicleBId, {
                  ...detail.filtersRaw,
                  horizon_days: plan.horizonDays,
                  scope_mode: plan.scopeMode,
                  different_locations_only: plan.differentLocationsOnly,
                })
            : undefined
        }
      />
    </div>
  );
}
