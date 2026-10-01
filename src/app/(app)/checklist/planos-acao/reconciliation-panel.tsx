"use client";

import * as React from "react";
import { ArrowRight, Link2, SearchX, Settings2, Wand2, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge, type BadgeVariant } from "@/components/ui/badge";
import { Pagination } from "@/components/ui/pagination";
import { FormField } from "@/components/ui/form-field";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Alert, AlertDescription, AlertTitle } from "@/components/feedback/alert";
import { ConfirmDialog } from "@/components/feedback/confirm-dialog";
import { EmptyState } from "@/components/feedback/empty-state";
import { ErrorState } from "@/components/feedback/error-state";
import { useToast } from "@/components/feedback/toast";
import {
  ConfidenceBadge, DeadlineBadge, PlanStatusBadge, PriorityBadge, RecurrenceBadge,
} from "@/components/action-plans/badges";
import { MaintenanceStatusBadge, MaintenanceTypeBadge } from "@/components/maintenance/badges";
import { discardCandidate, linkPlanMaintenance, runReconciliation, type Result } from "@/lib/action-plans/actions";
import {
  CONFIDENCE_LABEL, CONFIDENCE_TONE, MAINTENANCE_STATUS_LABEL, PLAN_STATUS_LABEL, RULE_LABEL,
  formatDate, formatInt, formatPct, planTitle, type Tone,
} from "@/lib/action-plans/labels";
import type { Confidence, Coverage, MaintenanceCandidate, PlanStatus, ReconciliationRow } from "@/lib/action-plans/types";
import { typeLabel, type MaintenanceStatus } from "@/lib/maintenance/types";
import { cn } from "@/lib/cn";
import { PAGE_SIZES, type ActionPlanPerms, type ActionPlansViewData, type PanelActions } from "./shared";

/**
 * Planos de Ação → Conciliação × Manutenções (§39–§42).
 *
 * Planos em aberto sem manutenção que os cubra, cada um com as manutenções do
 * mesmo veículo que podem tratá-lo. A confiança vem pronta do servidor, pelo
 * mapeamento Pergunta × Serviço da Manutenção:
 *   alta — serviço mapeado, específico, sem disputa (elegível à automática);
 *   média — serviço mapeado com conflito, ou mesmo cluster técnico;
 *   revisão manual — mesmo veículo e período, sem correspondência técnica;
 *   sem correspondência — nenhuma candidata.
 * A tela só pergunta e mostra: vincular e descartar são rotinas do banco, com
 * motivo na trilha do plano. A confiança filtra pela URL (`confianca`), a lista
 * pagina no servidor (`pagina`, `por_pagina`).
 */

type Reconciliation = NonNullable<ActionPlansViewData["reconciliation"]>;

export interface ReconciliationPanelProps {
  reconciliation: Reconciliation;
  perms: ActionPlanPerms;
  actions: PanelActions;
}

const CONFIDENCES: Confidence[] = ["high", "medium", "manual_review", "none"];

const CONFIDENCE_HINT: Record<Confidence, string> = {
  high: "Serviço mapeado, sem conflito",
  medium: "Com conflito ou mesmo cluster",
  manual_review: "Mesmo veículo e período",
  none: "Nenhuma manutenção candidata",
};

const CONFIDENCE_EXPLAIN: Record<Confidence, string> = {
  high: "Serviço mapeado para o item, sem disputa com outro plano do veículo — elegível à conciliação automática.",
  medium: "Serviço mapeado em disputa, ou só o mesmo cluster técnico — confirme antes de vincular.",
  manual_review: "Mesmo veículo e período, sem correspondência técnica — decisão humana.",
  none: "Nenhuma manutenção do veículo na janela de conciliação. Abra a manutenção pelo plano, vincule uma existente pela gaveta do plano ou registre outra tratativa.",
};

const TONE_LINE: Record<Tone, string | null> = {
  neutral: null,
  info: "bg-info",
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-danger",
  accent: "bg-accent",
};

const CANDIDATE_DATES: [string, "requestedOn" | "scheduledDate" | "entryDate" | "exitDate"][] = [
  ["Solicitada", "requestedOn"],
  ["Agendada", "scheduledDate"],
  ["Entrada", "entryDate"],
  ["Saída", "exitDate"],
];

const isConfidence = (value: string | null): value is Confidence =>
  value != null && (CONFIDENCES as string[]).includes(value);

const plural = (n: number, one: string, many: string) => `${formatInt(n)} ${n === 1 ? one : many}`;

/** Chamada de action que nunca rejeita: falha de rede vira mensagem. */
async function safe<T>(call: () => Promise<Result<T>>, fallback: string): Promise<Result<T>> {
  try {
    return await call();
  } catch {
    return { ok: false, error: fallback };
  }
}

interface Decision {
  kind: "link" | "discard";
  plan: ReconciliationRow;
  candidate: MaintenanceCandidate;
}

export function ReconciliationPanel({ reconciliation, perms, actions }: ReconciliationPanelProps) {
  const { page, list } = reconciliation;
  const active = isConfidence(reconciliation.confidence) ? reconciliation.confidence : null;
  const { toast } = useToast();
  const [confirmRun, setConfirmRun] = React.useState(false);
  const [lastRun, setLastRun] = React.useState<{ checked: number; linked: number } | null>(null);
  const [decision, setDecision] = React.useState<Decision | null>(null);
  const listHeadingId = React.useId();

  const setConfidence = (value: Confidence | null) => actions.navigate({ confianca: value, pagina: null });

  const run = async () => {
    const fallback = "Não foi possível executar a conciliação.";
    const result = await safe(() => runReconciliation(), fallback);
    if (!result.ok || !result.data) {
      toast({ title: result.error ?? fallback, variant: "danger" });
      return;
    }
    const { checked, linked } = result.data;
    setLastRun({ checked, linked });
    toast({
      title: linked > 0
        ? `${plural(linked, "plano vinculado", "planos vinculados")} automaticamente.`
        : "Nenhuma candidata de alta confiança para vincular.",
      description: `${plural(checked, "plano em aberto verificado", "planos em aberto verificados")}.`,
      variant: linked > 0 ? "success" : "info",
    });
    actions.refresh();
  };

  const groups = page ? groupByConfidence(page.rows) : [];

  return (
    <div className="flex flex-col gap-4" data-testid="action-plans-reconciliation">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h2 className="text-h3 font-semibold text-fg">Conciliação × Manutenções</h2>
          <p className="mt-0.5 max-w-3xl text-body-sm text-fg-secondary">
            Planos em aberto sem manutenção que os cubra, com as manutenções do mesmo veículo que podem tratá-los. A
            confiança vem do mapeamento Pergunta × Serviço da Manutenção: só a alta confiança é vinculada
            automaticamente; as demais pedem decisão — vincular ou descartar, com o motivo na trilha do plano.
          </p>
        </div>
        {perms.reconcile ? (
          <Button
            leadingIcon={<Wand2 />}
            onClick={() => setConfirmRun(true)}
            disabled={actions.pending}
            data-testid="reconciliation-run"
            className="h-auto min-h-(--control-height-md) w-full shrink-0 py-2 whitespace-normal sm:w-auto"
          >
            Executar conciliação automática (alta confiança)
          </Button>
        ) : null}
      </div>

      {lastRun ? (
        <Alert
          variant={lastRun.linked > 0 ? "success" : "info"}
          onDismiss={() => setLastRun(null)}
          data-testid="reconciliation-run-result"
        >
          <AlertTitle>Conciliação automática executada</AlertTitle>
          <AlertDescription>
            {plural(lastRun.checked, "plano em aberto verificado", "planos em aberto verificados")} ·{" "}
            {lastRun.linked > 0
              ? `${plural(lastRun.linked, "vinculado", "vinculados")} à manutenção de alta confiança (origem “Conciliação automática”).`
              : "nenhum com candidata de alta confiança — os demais seguem para decisão manual abaixo."}
          </AlertDescription>
        </Alert>
      ) : null}

      {!page ? (
        <ErrorState
          title="Não foi possível carregar a conciliação."
          description="As manutenções candidatas não chegaram. Tente de novo; se persistir, os outros painéis seguem disponíveis."
          onRetry={actions.refresh}
          retrying={actions.pending}
        />
      ) : (
        <>
          <section aria-label="Planos por confiança da conciliação" className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            {CONFIDENCES.map((c) => (
              <ConfidenceTile
                key={c}
                confidence={c}
                value={page.counts[c] ?? 0}
                active={active === c}
                disabled={actions.pending}
                onToggle={() => setConfidence(active === c ? null : c)}
              />
            ))}
            <CoverageTile
              coverage={page.coverage ?? null}
              onOpen={() => actions.navigate({ aba: "parametros", confianca: null, pagina: null, por_pagina: null })}
            />
          </section>

          <section aria-labelledby={listHeadingId} className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 id={listHeadingId} className="text-h4 font-semibold text-fg">
                Planos e manutenções candidatas
              </h3>
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-caption text-fg-muted" aria-live="polite">
                  {active
                    ? `${CONFIDENCE_LABEL[active]} · ${plural(page.total, "plano", "planos")}`
                    : `${plural(page.total, "plano em aberto", "planos em aberto")} sem manutenção que os cubra`}
                </p>
                {active ? (
                  <Button size="sm" variant="ghost" onClick={() => setConfidence(null)} disabled={actions.pending}>
                    Ver todas as confianças
                  </Button>
                ) : null}
              </div>
            </div>

            {page.rows.length === 0 ? (
              active ? (
                <EmptyState
                  variant="panel"
                  icon={<SearchX />}
                  title={`Nenhum plano com ${CONFIDENCE_LABEL[active].toLowerCase()}`}
                  description="Nenhum plano em aberto do seu escopo cai nesta faixa com os filtros atuais. Veja todas as confianças ou ajuste os filtros."
                  action={
                    <Button variant="outline" onClick={() => setConfidence(null)}>
                      Ver todas as confianças
                    </Button>
                  }
                />
              ) : (
                <EmptyState
                  variant="panel"
                  icon={<Link2 />}
                  title="Nada para conciliar"
                  description="Todo plano em aberto do seu escopo já tem manutenção que o cobre, ou nenhum plano corresponde aos filtros. Ajuste o período ou os filtros para ampliar a busca."
                />
              )
            ) : (
              groups.map((group, index) => (
                <ConfidenceGroup
                  key={`${group.confidence}-${index}`}
                  confidence={group.confidence}
                  total={page.counts[group.confidence] ?? group.rows.length}
                  rows={group.rows}
                  perms={perms}
                  actions={actions}
                  onDecide={setDecision}
                />
              ))
            )}

            {page.total > 0 ? (
              <Pagination
                page={list.page}
                pageSize={list.pageSize}
                total={page.total}
                pageSizeOptions={PAGE_SIZES}
                disabled={actions.pending}
                onPageChange={(next) => actions.navigate({ pagina: next > 1 ? String(next) : null })}
                onPageSizeChange={(size) => actions.navigate({ por_pagina: String(size), pagina: null })}
                label="Paginação da conciliação"
              />
            ) : null}
          </section>
        </>
      )}

      <ConfirmDialog
        open={confirmRun}
        onOpenChange={setConfirmRun}
        icon={<Wand2 />}
        title="Executar a conciliação automática?"
        description="Cada plano em aberto do seu escopo com uma candidata de alta confiança (serviço mapeado, específico e sem disputa) é vinculado a essa manutenção, com origem “Conciliação automática” registrada na trilha. Média confiança e revisão manual não são tocadas."
        confirmLabel="Executar conciliação"
        onConfirm={run}
      />

      <DecisionDialog
        decision={decision}
        onOpenChange={(open) => {
          if (!open) setDecision(null);
        }}
        onDone={actions.refresh}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Indicadores
// ---------------------------------------------------------------------------
function ConfidenceTile({
  confidence,
  value,
  active,
  disabled,
  onToggle,
}: {
  confidence: Confidence;
  value: number;
  active: boolean;
  disabled: boolean;
  onToggle: () => void;
}) {
  const accent = TONE_LINE[CONFIDENCE_TONE[confidence]];
  const label = CONFIDENCE_LABEL[confidence];
  return (
    <button
      type="button"
      aria-pressed={active}
      disabled={disabled}
      onClick={onToggle}
      title={CONFIDENCE_EXPLAIN[confidence]}
      aria-label={`${label}: ${formatInt(value)} ${value === 1 ? "plano" : "planos"}. ${active ? "Remover o filtro da lista" : "Filtrar a lista"}`}
      data-testid={`reconciliation-confidence-${confidence}`}
      className={cn(
        "relative flex min-h-[5.5rem] min-w-0 flex-col justify-between gap-1.5 overflow-hidden rounded-lg border border-border bg-surface-raised px-3 py-2.5 text-left shadow-card",
        "hfm-transition hfm-focus-ring hover:border-border-strong hover:shadow-card-hover disabled:cursor-wait",
        active && "border-primary bg-primary-soft hover:border-primary",
      )}
    >
      {accent ? <span aria-hidden className={cn("absolute inset-x-0 top-0 h-0.5", accent)} /> : null}
      <span className="text-caption font-medium text-fg-secondary">{label}</span>
      <span className="text-h2 leading-none font-semibold text-fg tabular-nums">{formatInt(value)}</span>
      <span className={cn("text-caption", active ? "font-medium text-primary-soft-fg" : "text-fg-muted")}>
        {active ? "Filtrando a lista" : CONFIDENCE_HINT[confidence]}
      </span>
    </button>
  );
}

function CoverageTile({ coverage, onOpen }: { coverage: Coverage | null; onOpen: () => void }) {
  const pct = coverage?.pct ?? null;
  const tone = pct == null ? null : pct >= 90 ? "bg-success" : pct >= 60 ? "bg-warning" : "bg-danger";
  return (
    <div
      className="relative col-span-2 flex min-h-[5.5rem] min-w-0 flex-col justify-between gap-1.5 overflow-hidden rounded-lg border border-border bg-surface-raised px-3 py-2.5 shadow-card lg:col-span-1"
      data-testid="reconciliation-coverage"
    >
      {tone ? <span aria-hidden className={cn("absolute inset-x-0 top-0 h-0.5", tone)} /> : null}
      <span className="text-caption font-medium text-fg-secondary">Cobertura do mapeamento</span>
      <span className="flex items-baseline gap-2">
        <span className="text-h2 leading-none font-semibold text-fg tabular-nums">{formatPct(pct)}</span>
        {coverage ? (
          <span className="text-caption text-fg-muted">
            {formatInt(coverage.mapped)} de {formatInt(coverage.actionKeys)} ações com serviço
          </span>
        ) : null}
      </span>
      {pct != null ? (
        <span className="h-1 w-full overflow-hidden rounded-full bg-surface-tertiary" aria-hidden>
          <span className={cn("block h-full rounded-full", tone)} style={{ width: `${Math.min(100, Math.max(0, pct))}%` }} />
        </span>
      ) : null}
      <button
        type="button"
        onClick={onOpen}
        className="inline-flex items-center gap-1 self-start rounded-xs text-caption font-medium text-link hover:underline hfm-focus-ring"
      >
        <Settings2 aria-hidden className="size-3.5" />
        Sem mapeamento não há alta confiança — ver mapeamento
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Lista
// ---------------------------------------------------------------------------
function groupByConfidence(rows: ReconciliationRow[]) {
  const groups: { confidence: Confidence; rows: ReconciliationRow[] }[] = [];
  for (const row of rows) {
    const last = groups[groups.length - 1];
    if (last && last.confidence === row.bestConfidence) last.rows.push(row);
    else groups.push({ confidence: row.bestConfidence, rows: [row] });
  }
  return groups;
}

function ConfidenceGroup({
  confidence,
  total,
  rows,
  perms,
  actions,
  onDecide,
}: {
  confidence: Confidence;
  total: number;
  rows: ReconciliationRow[];
  perms: ActionPlanPerms;
  actions: PanelActions;
  onDecide: (decision: Decision) => void;
}) {
  return (
    <section aria-label={CONFIDENCE_LABEL[confidence]} className="flex flex-col gap-2" data-testid={`reconciliation-group-${confidence}`}>
      <div className="flex flex-col gap-1 border-b border-border pb-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <ConfidenceBadge confidence={confidence} size="md" />
          <span className="text-caption text-fg-muted">{plural(total, "plano", "planos")} no total</span>
        </div>
        <p className="text-caption text-fg-secondary">{CONFIDENCE_EXPLAIN[confidence]}</p>
      </div>
      <ul className="flex flex-col gap-3">
        {rows.map((row) => (
          <li key={row.id}>
            <PlanCard row={row} perms={perms} actions={actions} onDecide={onDecide} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function PlanCard({
  row,
  perms,
  actions,
  onDecide,
}: {
  row: ReconciliationRow;
  perms: ActionPlanPerms;
  actions: PanelActions;
  onDecide: (decision: Decision) => void;
}) {
  const vehicle = [row.licensePlate ?? "Sem placa", row.fleetCode].filter(Boolean).join(" · ");
  const context = [vehicle, row.operationName, row.clusterName, row.responsibleName ? `Resp.: ${row.responsibleName}` : null]
    .filter(Boolean)
    .join(" · ");
  return (
    <article
      className="overflow-hidden rounded-lg border border-border bg-surface-raised shadow-card"
      data-testid={`reconciliation-plan-${row.id}`}
    >
      <header className="flex flex-col gap-1.5 p-3">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="font-mono text-caption font-medium text-fg-muted">{row.code}</span>
          <PlanStatusBadge status={row.status} />
          <PriorityBadge priority={row.priority} />
          <DeadlineBadge deadline={row.deadline} days={row.daysOverdue} />
          {row.isRecurrence ? <RecurrenceBadge /> : null}
        </div>
        <button
          type="button"
          onClick={() => actions.openPlan(row.id)}
          className="self-start rounded-xs text-left text-body font-semibold text-fg hfm-transition hover:text-link hover:underline hfm-focus-ring"
          aria-label={`Abrir o plano ${row.code}: ${planTitle(row)}`}
        >
          {planTitle(row)}
        </button>
        <p className="text-caption text-fg-secondary">{context}</p>
        <p className="text-caption text-fg-muted">
          1º apontamento {formatDate(row.firstOperationalDate)} · último {formatDate(row.lastOperationalDate)} ·{" "}
          {plural(row.occurrences, "ocorrência", "ocorrências")} ·{" "}
          {plural(row.openItems, "apontamento aberto", "apontamentos abertos")}
          {row.dueOn ? ` · prazo ${formatDate(row.dueOn)}` : ""}
        </p>
      </header>

      {row.candidates.length > 0 ? (
        <ul
          aria-label={`Manutenções candidatas para o plano ${row.code}`}
          className="border-t border-border-subtle bg-surface"
        >
          {row.candidates.map((candidate) => (
            <CandidateItem
              key={candidate.maintenanceId}
              plan={row}
              candidate={candidate}
              perms={perms}
              actions={actions}
              onDecide={onDecide}
            />
          ))}
        </ul>
      ) : (
        <div className="flex flex-col gap-2 border-t border-border-subtle bg-surface px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
          <p className="flex items-start gap-2 text-caption text-fg-secondary">
            <SearchX aria-hidden className="mt-px size-3.5 shrink-0 text-fg-muted" />
            Sem manutenção candidata do veículo na janela de conciliação. Pela gaveta do plano: abrir manutenção,
            vincular uma existente ou registrar outra tratativa.
          </p>
          <Button size="sm" variant="outline" trailingIcon={<ArrowRight />} onClick={() => actions.openPlan(row.id)}>
            Abrir plano
          </Button>
        </div>
      )}
    </article>
  );
}

function CandidateItem({
  plan,
  candidate: c,
  perms,
  actions,
  onDecide,
}: {
  plan: ReconciliationRow;
  candidate: MaintenanceCandidate;
  perms: ActionPlanPerms;
  actions: PanelActions;
  onDecide: (decision: Decision) => void;
}) {
  return (
    <li
      className="flex flex-col gap-2 border-b border-border-subtle px-3 py-2.5 last:border-b-0 lg:flex-row lg:items-start lg:gap-4"
      data-testid={`reconciliation-candidate-${plan.id}-${c.maintenanceId}`}
    >
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex flex-wrap items-center gap-1.5">
          {perms.maintenanceView ? (
            <button
              type="button"
              onClick={() => actions.openMaintenance(c.maintenanceId)}
              className="rounded-xs font-mono text-body-sm font-semibold text-link hover:underline hfm-focus-ring"
              aria-label={`Abrir a manutenção ${c.code}`}
            >
              {c.code}
            </button>
          ) : (
            <span className="font-mono text-body-sm font-semibold text-fg">{c.code}</span>
          )}
          <MaintenanceStatusBadge status={c.status as MaintenanceStatus} />
          <MaintenanceTypeBadge type={c.type} />
          <ConfidenceBadge confidence={c.confidence} />
        </div>
        <p className="text-body-sm text-fg-secondary">{RULE_LABEL[c.rule] ?? c.rule}</p>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-caption sm:grid-cols-4">
          {CANDIDATE_DATES.map(([label, key]) => (
            <div key={key} className="flex min-w-0 gap-1">
              <dt className="text-fg-muted">{label}</dt>
              <dd className="text-fg tabular-nums">{formatDate(c[key])}</dd>
            </div>
          ))}
        </dl>
        <p className="text-caption text-fg-secondary">
          <span className="text-fg-muted">Serviços: </span>
          {c.services || "—"}
        </p>
        <CandidateFlags candidate={c} />
      </div>
      {perms.reconcile ? (
        <div className="flex shrink-0 flex-wrap gap-2 lg:w-36 lg:flex-col lg:items-stretch">
          <Button
            size="sm"
            variant={c.confidence === "high" ? "primary" : "secondary"}
            leadingIcon={<Link2 />}
            onClick={() => onDecide({ kind: "link", plan, candidate: c })}
            aria-label={`Vincular a manutenção ${c.code} ao plano ${plan.code}`}
            data-testid="reconciliation-link"
          >
            Vincular
          </Button>
          <Button
            size="sm"
            variant="ghost"
            leadingIcon={<XCircle />}
            onClick={() => onDecide({ kind: "discard", plan, candidate: c })}
            aria-label={`Descartar a manutenção ${c.code} como candidata do plano ${plan.code}`}
            data-testid="reconciliation-discard"
          >
            Descartar
          </Button>
        </div>
      ) : null}
    </li>
  );
}

function CandidateFlags({ candidate: c }: { candidate: MaintenanceCandidate }) {
  const flags: { label: string; variant: BadgeVariant }[] = [];
  if (c.serviceMatch) flags.push({ label: "Serviço mapeado", variant: "success" });
  if (c.autoResolveMatch) flags.push({ label: "Baixa automática", variant: "success" });
  if (c.clusterMatch) flags.push({ label: "Mesmo cluster", variant: "info" });
  if (c.contested) flags.push({ label: "Disputada por outro plano", variant: "warning" });
  if (flags.length === 0) flags.push({ label: "Sem correspondência técnica", variant: "neutral" });
  return (
    <ul className="flex flex-wrap gap-1" aria-label="Sinais da correspondência">
      {flags.map((f) => (
        <li key={f.label}>
          <Badge variant={f.variant} appearance="outline" size="sm">
            {f.label}
          </Badge>
        </li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------------------
// Vincular / descartar
// ---------------------------------------------------------------------------
function DecisionDialog({
  decision,
  onOpenChange,
  onDone,
}: {
  decision: Decision | null;
  onOpenChange: (open: boolean) => void;
  onDone: () => void;
}) {
  return (
    <Dialog open={decision != null} onOpenChange={onOpenChange}>
      <DialogContent size="md" data-testid="reconciliation-decision">
        {decision ? (
          <DecisionForm
            key={`${decision.kind}:${decision.plan.id}:${decision.candidate.maintenanceId}`}
            decision={decision}
            onClose={() => onOpenChange(false)}
            onDone={onDone}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function DecisionForm({ decision, onClose, onDone }: { decision: Decision; onClose: () => void; onDone: () => void }) {
  const { kind, plan, candidate: c } = decision;
  const isLink = kind === "link";
  const { toast } = useToast();
  const [reason, setReason] = React.useState("");
  const [touched, setTouched] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  // Descartar sempre pede motivo; vincular fora da alta confiança também.
  const minLength = !isLink || c.confidence !== "high" ? 10 : 0;
  const trimmed = reason.trim();
  const invalid = trimmed.length < minLength;

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setTouched(true);
    if (invalid || busy) return;
    setBusy(true);
    setError(null);
    if (isLink) {
      const fallback = "Não foi possível vincular a manutenção.";
      const result = await safe(
        () =>
          linkPlanMaintenance(plan.id, c.maintenanceId, {
            origin: "reconciliation_manual",
            confidence: c.confidence,
            rule: c.rule,
            reason: trimmed || null,
          }),
        fallback,
      );
      setBusy(false);
      if (!result.ok) {
        setError(result.error ?? fallback);
        return;
      }
      const status = result.data?.status as PlanStatus | undefined;
      toast({
        title: `Manutenção ${c.code} vinculada ao plano ${plan.code}.`,
        description: status ? `Situação do plano: ${PLAN_STATUS_LABEL[status] ?? status}.` : undefined,
        variant: "success",
      });
    } else {
      const fallback = "Não foi possível descartar a candidata.";
      const result = await safe(() => discardCandidate(plan.id, c.maintenanceId, trimmed), fallback);
      setBusy(false);
      if (!result.ok) {
        setError(result.error ?? fallback);
        return;
      }
      toast({ title: `Manutenção ${c.code} descartada como candidata do plano ${plan.code}.`, variant: "success" });
    }
    onDone();
    onClose();
  };

  return (
    <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col" aria-busy={busy}>
      <DialogHeader>
        <DialogTitle>{isLink ? "Vincular manutenção ao plano?" : "Descartar candidata?"}</DialogTitle>
        <DialogDescription>
          {isLink
            ? "O plano passa a acompanhar esta manutenção: os apontamentos abertos ficam “Em manutenção” e, quando um serviço com baixa automática é concluído, são resolvidos sozinhos. Origem registrada: Conciliação manual."
            : "A manutenção deixa de ser sugerida para este plano. Nada muda na manutenção; o descarte e o motivo ficam na trilha do plano."}
        </DialogDescription>
      </DialogHeader>
      <DialogBody className="flex flex-col gap-4">
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1.5 rounded-md border border-border bg-surface-secondary p-3 text-body-sm">
          <dt className="text-fg-muted">Plano</dt>
          <dd className="text-fg">
            <span className="font-mono">{plan.code}</span> — {planTitle(plan)}
          </dd>
          <dt className="text-fg-muted">Veículo</dt>
          <dd className="text-fg">{[plan.licensePlate ?? "Sem placa", plan.fleetCode].filter(Boolean).join(" · ")}</dd>
          <dt className="text-fg-muted">Manutenção</dt>
          <dd className="text-fg">
            <span className="font-mono">{c.code}</span> · {MAINTENANCE_STATUS_LABEL[c.status] ?? c.status} ·{" "}
            {typeLabel(c.type)}
          </dd>
          <dt className="text-fg-muted">Confiança</dt>
          <dd className="flex flex-wrap items-center gap-1.5 text-fg">
            <ConfidenceBadge confidence={c.confidence} />
            <span className="text-caption text-fg-secondary">{RULE_LABEL[c.rule] ?? c.rule}</span>
          </dd>
          <dt className="text-fg-muted">Serviços</dt>
          <dd className="text-fg">{c.services || "—"}</dd>
        </dl>

        {isLink && c.contested ? (
          <Alert variant="warning">
            <AlertDescription>
              Esta manutenção também é candidata de outro plano do mesmo veículo. Confirme que ela trata este problema
              antes de vincular.
            </AlertDescription>
          </Alert>
        ) : null}

        <FormField
          label={isLink ? "Justificativa" : "Motivo do descarte"}
          required={minLength > 0}
          labelHint={minLength > 0 ? undefined : "Opcional"}
          helperText="Fica registrado na trilha do plano, com o autor e a data."
          error={touched && invalid ? `Descreva em pelo menos ${minLength} caracteres.` : undefined}
        >
          <Textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            onBlur={() => setTouched(true)}
            rows={3}
            maxLength={2000}
            placeholder={
              isLink
                ? "Ex.: a OS trata exatamente o item apontado no checklist."
                : "Ex.: manutenção de outro sistema do veículo, sem relação com o item apontado."
            }
          />
        </FormField>

        {error ? (
          <Alert variant="danger">
            <AlertTitle>{isLink ? "Não foi possível vincular" : "Não foi possível descartar"}</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
      </DialogBody>
      <DialogFooter>
        <Button variant="outline" onClick={onClose} disabled={busy}>
          Cancelar
        </Button>
        <Button
          type="submit"
          variant={isLink ? "primary" : "danger"}
          leadingIcon={isLink ? <Link2 /> : <XCircle />}
          loading={busy}
          disabled={invalid}
          data-testid="reconciliation-decision-confirm"
        >
          {isLink ? "Vincular manutenção" : "Descartar candidata"}
        </Button>
      </DialogFooter>
    </form>
  );
}
