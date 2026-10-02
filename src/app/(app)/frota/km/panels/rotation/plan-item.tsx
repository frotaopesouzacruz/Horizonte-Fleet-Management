"use client";

import * as React from "react";
import { ArrowRightLeft, CalendarCheck, CheckCircle2, Save, Undo2, XCircle } from "lucide-react";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { DateInput } from "@/components/ui/date-input";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { StatusBadge } from "@/components/ui/status-badge";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/feedback/alert";
import { NativeSelect } from "@/components/governance/selects";
import type { KmRotationEmployee, KmRotationItem, KmRotationPlan } from "@/lib/km/rotation";
import { setItem, type SetItemPayload } from "@/lib/km/rotation-actions";
import { fmtKm, fmtPct, formatDate } from "@/lib/km/types";
import type { ItemAction } from "./dialogs";
import { evaluationMeta, formatStamp, kmDay, kmMonth, pad2, pairText, priorityLabel, signedKm } from "./format";
import { ConditionedNote, Fact, Facts, PairLine, PriorityBadge, RotationStatusBadge } from "./ui";

export interface ItemPerms {
  approve: boolean;
  schedule: boolean;
  execute: boolean;
  edit: boolean;
  applyFidelization: boolean;
}

/** Ações de status válidas para o item, já filtradas pela permissão. */
function availableActions(status: string, perms: ItemPerms): ItemAction[] {
  const out: ItemAction[] = [];
  if (status === "suggested") {
    if (perms.approve) out.push("approve", "cancel");
  } else if (status === "approved") {
    if (perms.schedule) out.push("schedule");
    if (perms.approve) out.push("back_suggested", "cancel");
  } else if (status === "scheduled") {
    if (perms.execute) out.push("execute");
    if (perms.approve) out.push("back_approved", "cancel");
  }
  return out;
}

const ACTION_UI: Record<ItemAction, { label: string; icon: React.ReactNode; variant: "primary" | "outline" | "ghost" | "danger" }> = {
  approve: { label: "Aprovar", icon: <CheckCircle2 aria-hidden />, variant: "primary" },
  schedule: { label: "Programar", icon: <CalendarCheck aria-hidden />, variant: "primary" },
  execute: { label: "Executar", icon: <CheckCircle2 aria-hidden />, variant: "primary" },
  back_suggested: { label: "Voltar a sugerido", icon: <Undo2 aria-hidden />, variant: "ghost" },
  back_approved: { label: "Voltar a aprovado", icon: <Undo2 aria-hidden />, variant: "ghost" },
  cancel: { label: "Cancelar", icon: <XCircle aria-hidden />, variant: "ghost" },
};

export function PlanItemCard({
  item,
  plan,
  perms,
  employees,
  onAnalyze,
  onAction,
  onFidelization,
  onSaved,
}: {
  item: KmRotationItem;
  plan: KmRotationPlan;
  perms: ItemPerms;
  employees: KmRotationEmployee[];
  onAnalyze: () => void;
  onAction: (action: ItemAction) => void;
  onFidelization: () => void;
  onSaved: (message: string) => void;
}) {
  const s = item.snapshot ?? {};
  const a = s.vehicleA;
  const b = s.vehicleB;
  const closed = item.status === "executed" || item.status === "cancelled";
  const actions = availableActions(item.status, perms);
  const canApplyFidelization =
    perms.applyFidelization && ["approved", "scheduled", "executed"].includes(item.status) && !item.fidelizationAppliedAt;
  const title = `Rodízio ${pad2(item.itemNumber)}`;

  return (
    <article
      className={cn(
        "flex min-w-0 flex-col gap-3 rounded-md border border-border bg-surface p-3 sm:p-4",
        item.status === "cancelled" && "bg-surface-secondary",
      )}
      aria-label={`${title}: ${pairText(a, b)}`}
      data-testid="km-rodizio-item"
      data-status={item.status}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-body font-semibold text-fg">{title}</span>
        <RotationStatusBadge status={item.status} />
        <PriorityBadge priority={item.priority} revalidated={Boolean(item.revalidatedAt)} />
        {!item.inScope ? (
          <StatusBadge status="neutral" size="sm">
            Frota fora do seu escopo
          </StatusBadge>
        ) : null}
        <Button size="sm" variant="outline" className="ml-auto" onClick={onAnalyze} data-testid="km-rodizio-item-analyze">
          Ver análise
        </Button>
      </div>

      <PairLine a={a} b={b} />

      <Facts className="lg:grid-cols-4">
        <Fact label={`${a?.plate ?? "A"} · rodagem média`}>{kmMonth(a?.kmMonth)}</Fact>
        <Fact label={`${b?.plate ?? "B"} · rodagem média`}>{kmMonth(b?.kmMonth)}</Fact>
        <Fact label="Média do grupo">{kmMonth(s.cohort?.kmMonthMedian)}</Fact>
        <Fact label="Redução estimada do desequilíbrio">
          {fmtPct(item.reductionPct)} <span className="text-fg-muted">({fmtKm(item.reductionKm)} em {plan.horizonDays} dias)</span>
        </Fact>
      </Facts>

      {s.previous ? (
        <p className="text-caption text-fg-muted">
          Antes da revalidação: prioridade {priorityLabel(s.previous.priority).toLocaleLowerCase("pt-BR")} · redução de {fmtPct(s.previous.reductionPct ?? null)}.
        </p>
      ) : null}
      {s.revalidationNote ? (
        <Alert variant="warning">
          <AlertDescription>{s.revalidationNote}</AlertDescription>
        </Alert>
      ) : null}
      {s.conditioned ? <ConditionedNote reasons={s.conditionReasons ?? []} /> : null}

      {item.justification ? (
        <details className="group rounded-sm text-body-sm">
          <summary className="w-fit cursor-pointer rounded-xs text-caption font-medium text-link hfm-focus-ring">Justificativa</summary>
          <p className="mt-1 text-fg-secondary">{item.justification}</p>
        </details>
      ) : null}

      {closed || !perms.edit ? (
        <Facts className="lg:grid-cols-4">
          <Fact label="Data prevista">{formatDate(item.effectiveDate)}</Fact>
          <Fact label="Responsável">{item.responsibleName ?? "—"}</Fact>
          <Fact label="Observação" wide>
            {item.notes ?? "—"}
          </Fact>
        </Facts>
      ) : (
        <OperationalForm key={`${item.id}:${item.updatedAt}`} item={item} employees={employees} onSaved={onSaved} />
      )}

      {item.status === "cancelled" && item.cancelledReason ? (
        <p className="text-body-sm text-fg-secondary">
          <span className="font-medium text-fg">Motivo do cancelamento:</span> {item.cancelledReason}
        </p>
      ) : null}

      {item.status === "executed" ? (
        <ExecutionBlock item={item} />
      ) : null}

      {item.fidelizationAppliedAt ? (
        <p className="flex items-center gap-1.5 text-body-sm text-success-soft-fg" data-testid="km-rodizio-item-fidelization-applied">
          <ArrowRightLeft className="size-4 text-success" aria-hidden />
          Aplicado na Fidelização em {formatStamp(item.fidelizationAppliedAt)}
          {item.fidelizationPayload?.effectiveDate ? ` · vigência a partir de ${formatDate(item.fidelizationPayload.effectiveDate)}` : ""}
        </p>
      ) : null}

      {actions.length > 0 || canApplyFidelization ? (
        <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3" data-testid="km-rodizio-item-actions">
          {actions.map((act) => (
            <Button
              key={act}
              size="sm"
              variant={ACTION_UI[act].variant}
              leadingIcon={ACTION_UI[act].icon}
              onClick={() => onAction(act)}
              data-testid={`km-rodizio-item-${act}`}
            >
              {ACTION_UI[act].label}
            </Button>
          ))}
          {canApplyFidelization ? (
            <Button
              size="sm"
              variant="outline"
              className="sm:ml-auto"
              leadingIcon={<ArrowRightLeft aria-hidden />}
              onClick={onFidelization}
              data-testid="km-rodizio-item-fidelization"
            >
              Aplicar na Fidelização
            </Button>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}

// ---------------------------------------------------------------------------
// Data prevista, responsável e observação (salvos juntos)
// ---------------------------------------------------------------------------
function OperationalForm({
  item,
  employees,
  onSaved,
}: {
  item: KmRotationItem;
  employees: KmRotationEmployee[];
  onSaved: (message: string) => void;
}) {
  const [date, setDate] = React.useState(item.effectiveDate ?? "");
  const [responsible, setResponsible] = React.useState(item.responsibleEmployeeId ?? "");
  const [notes, setNotes] = React.useState(item.notes ?? "");
  const [search, setSearch] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const patch: SetItemPayload = {};
  if (date !== (item.effectiveDate ?? "")) patch.effective_date = date || null;
  if (responsible !== (item.responsibleEmployeeId ?? "")) patch.responsible_employee_id = responsible || null;
  if (notes.trim() !== (item.notes ?? "")) patch.notes = notes.trim() || null;
  const dirty = Object.keys(patch).length > 0;

  const term = search.trim().toLocaleLowerCase("pt-BR");
  const options = term
    ? employees.filter((e) => e.id === responsible || e.name.toLocaleLowerCase("pt-BR").includes(term))
    : employees;
  // Responsável já gravado que saiu da lista de ativos continua visível.
  const missing = item.responsibleEmployeeId && !employees.some((e) => e.id === item.responsibleEmployeeId);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!dirty || busy) return;
    setBusy(true);
    setError(null);
    const res = await setItem(item.id, patch);
    setBusy(false);
    if (!res.ok) {
      setError(res.error ?? "Não foi possível salvar.");
      return;
    }
    onSaved(`Rodízio ${pad2(item.itemNumber)} atualizado.`);
  }

  return (
    <form onSubmit={save} className="flex flex-col gap-3 rounded-sm bg-surface-secondary p-3" data-testid="km-rodizio-item-form">
      <div className="grid gap-3 md:grid-cols-[minmax(0,12rem)_minmax(0,1fr)]">
        <FormField label="Data prevista">
          <DateInput value={date} onChange={(e) => setDate(e.target.value)} data-testid="km-rodizio-item-date" />
        </FormField>
        <FormField label="Responsável">
          <div className="flex flex-col gap-1.5 sm:flex-row">
            {employees.length > 30 ? (
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Filtrar colaboradores"
                aria-label="Filtrar a lista de responsáveis"
                className="sm:max-w-48"
              />
            ) : null}
            <NativeSelect
              value={responsible}
              onChange={(e) => setResponsible(e.target.value)}
              aria-label="Responsável"
              data-testid="km-rodizio-item-responsible"
            >
              <option value="">{employees.length ? "Sem responsável" : "Nenhum colaborador ativo"}</option>
              {missing ? <option value={item.responsibleEmployeeId!}>{item.responsibleName ?? "Responsável atual"} (inativo)</option> : null}
              {options.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name}
                </option>
              ))}
            </NativeSelect>
          </div>
        </FormField>
      </div>
      <FormField label="Observação" labelHint="Opcional">
        <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} maxLength={1000} data-testid="km-rodizio-item-notes" />
      </FormField>
      {error ? (
        <Alert variant="danger">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      <div className="flex justify-end">
        <Button type="submit" size="sm" variant="secondary" leadingIcon={<Save aria-hidden />} disabled={!dirty} loading={busy} data-testid="km-rodizio-item-save">
          Salvar
        </Button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Execução e avaliação pós-rodízio
// ---------------------------------------------------------------------------
function ExecutionBlock({ item }: { item: KmRotationItem }) {
  const ev = item.evaluation;
  const meta = evaluationMeta(ev);
  const a = item.snapshot?.vehicleA?.plate ?? "A";
  const b = item.snapshot?.vehicleB?.plate ?? "B";
  const after = (v: number | null | undefined, days: number | null | undefined) =>
    v == null ? "Sem leitura" : `${kmDay(v)}${days != null ? ` (${days} ${days === 1 ? "dia" : "dias"} com leitura)` : ""}`;
  return (
    <div className="flex flex-col gap-3 rounded-sm border border-border p-3" data-testid="km-rodizio-item-evaluation">
      <div className="flex flex-wrap items-center gap-2">
        <h4 className="text-body-sm font-semibold text-fg">Avaliação pós-rodízio</h4>
        {ev ? (
          <StatusBadge status={meta.tone} withIcon>
            {meta.label}
          </StatusBadge>
        ) : null}
        <span className="text-caption text-fg-muted">
          Executado em {formatDate(item.executionDate)}
          {ev?.daysSince != null ? ` · há ${ev.daysSince} ${ev.daysSince === 1 ? "dia" : "dias"}` : ""}
        </span>
      </div>
      {ev ? (
        <>
          {meta.text ? <p className="text-body-sm text-fg-secondary">{meta.text}</p> : null}
          <Facts className="lg:grid-cols-3">
            <Fact label="Gap na execução">{fmtKm(ev.gapAtExecution)}</Fact>
            <Fact label="Gap hoje">{fmtKm(ev.gapNow)}</Fact>
            <Fact label="Variação do gap">{signedKm(ev.gapChange)}</Fact>
            <Fact label={`${a} · KM/dia antes`}>{kmDay(ev.aDailyBefore)}</Fact>
            <Fact label={`${a} · KM/dia depois`}>{after(ev.aDailyAfter, ev.aDaysAfter)}</Fact>
            <Fact label="Hodômetros na execução">
              {a} {fmtKm(item.executionOdometerA)} · {b} {fmtKm(item.executionOdometerB)}
            </Fact>
            <Fact label={`${b} · KM/dia antes`}>{kmDay(ev.bDailyBefore)}</Fact>
            <Fact label={`${b} · KM/dia depois`}>{after(ev.bDailyAfter, ev.bDaysAfter)}</Fact>
          </Facts>
        </>
      ) : (
        <p className="text-body-sm text-fg-muted">Avaliação indisponível.</p>
      )}
    </div>
  );
}
