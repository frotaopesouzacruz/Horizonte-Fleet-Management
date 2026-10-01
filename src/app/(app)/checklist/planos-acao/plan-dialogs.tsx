"use client";

import * as React from "react";
import { AlertTriangle, Link2, Plus } from "lucide-react";
import { cn } from "@/lib/cn";
import {
  Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { StatusBadge, type StatusTone } from "@/components/ui/status-badge";
import { DateInput } from "@/components/ui/date-input";
import { Textarea } from "@/components/ui/textarea";
import { CheckboxField } from "@/components/ui/checkbox";
import { FormField } from "@/components/ui/form-field";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { NativeSelect } from "@/components/governance/selects";
import { Alert, AlertDescription, AlertTitle } from "@/components/feedback/alert";
import { EmptyState } from "@/components/feedback/empty-state";
import { ErrorState } from "@/components/feedback/error-state";
import { Skeleton, SkeletonGroup } from "@/components/feedback/skeleton";
import { ConfidenceBadge, ItemStatusBadge } from "@/components/action-plans/badges";
import { MaintenanceTypeBadge } from "@/components/maintenance/badges";
import type { ExecutionDetailLoader } from "@/app/(app)/aplicativos/check-list-frota/execution-detail-drawer";
import { loadExecutionDetail } from "@/lib/applications/history-actions";
import {
  addPlanNote,
  assignPlan,
  changePlanPriority,
  linkPlanMaintenance,
  reopenPlan,
  resolvePlanItems,
  setPlanAnalysis,
  setPlanDue,
  unlinkPlanMaintenance,
  type Result,
} from "@/lib/action-plans/actions";
import {
  FINDING_RESOLUTION_LABEL,
  MAINTENANCE_STATUS_LABEL,
  PRIORITY_LABEL,
  PRIORITY_ORDER,
  REASONS,
  RULE_LABEL,
  formatDate,
  formatInt,
} from "@/lib/action-plans/labels";
import { OPEN_STATUSES as MAINTENANCE_OPEN_STATUSES, type MaintenanceStatus } from "@/lib/maintenance/types";
import type {
  ActionPlanCatalog,
  ActionPlanDetail,
  AnalysisState,
  MaintenanceCandidate,
  PlanItem,
  PlanMaintenanceLink,
  Priority,
} from "@/lib/action-plans/types";

/**
 * Diálogos de tratativa do Plano de Ação.
 *
 * Cada um pede só o que a rotina do banco precisa — situação, permissão,
 * escopo, mínimos de texto e datas são decididos lá, na mesma transação da
 * escrita. A gaveta monta um diálogo por vez e o desmonta ao fechar: cada
 * abertura começa limpa. O erro do servidor aparece dentro do diálogo, que
 * continua aberto para a pessoa corrigir e tentar de novo.
 */

// ---------------------------------------------------------------------------
// Peças compartilhadas (gaveta do plano, gaveta do rastro e diálogos)
// ---------------------------------------------------------------------------

/** Hoje em São Paulo (aaaa-mm-dd), como o banco conta "o futuro". Só para limites de campo. */
export function todayIso(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

/** "1 apontamento" / "3 apontamentos". */
export const plural = (n: number, one: string, many: string) => `${formatInt(n)} ${n === 1 ? one : many}`;

export const answerLabel = (answer: string | null | undefined) =>
  answer === "yes" ? "SIM" : answer === "no" ? "NÃO" : answer || "—";

/** "lado_freio" / "ladoFreio" → "Lado freio". */
export function humanizeKey(value: string): string {
  const text = value
    .replace(/_/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .trim();
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : text;
}

/**
 * O valor condicional de uma resposta como pares "rótulo: valor(es)". Chaves de
 * opção (snake_case) ficam legíveis; texto livre do motorista passa intacto.
 */
export function conditionalPairs(value: Record<string, unknown> | null | undefined): { label: string; value: string }[] {
  if (!value) return [];
  const out: { label: string; value: string }[] = [];
  for (const [key, raw] of Object.entries(value)) {
    const list = Array.isArray(raw) ? raw : [raw];
    const parts = list
      .filter((v) => v !== null && v !== undefined && v !== "")
      .map((v) => (typeof v === "string" ? (/^[a-z0-9_]+$/.test(v) ? humanizeKey(v) : v) : String(v)));
    if (parts.length > 0) out.push({ label: humanizeKey(key), value: parts.join(", ") });
  }
  return out;
}

export const isOpenMaintenance = (status: string) => MAINTENANCE_OPEN_STATUSES.includes(status as MaintenanceStatus);

const MAINTENANCE_TONE: Record<string, StatusTone> = {
  to_schedule: "pending",
  scheduled: "info",
  in_progress: "progress",
  completed: "success",
  cancelled: "neutral",
  not_performed: "danger",
};

const FINDING_TONE: Record<string, StatusTone> = {
  pending: "pending",
  resolved: "success",
  partially_resolved: "warning",
  not_resolved: "danger",
};

export function MaintenanceStatusTag({ status, size = "sm" }: { status: string; size?: "sm" | "md" }) {
  return (
    <StatusBadge status={MAINTENANCE_TONE[status] ?? "neutral"} size={size}>
      {MAINTENANCE_STATUS_LABEL[status] ?? status}
    </StatusBadge>
  );
}

/** Situação do apontamento dentro da manutenção (maintenance_finding_links). */
export function FindingResolutionTag({ status }: { status: string }) {
  return (
    <StatusBadge status={FINDING_TONE[status] ?? "neutral"} size="sm">
      {FINDING_RESOLUTION_LABEL[status] ?? status}
    </StatusBadge>
  );
}

/** Uma manutenção candidata: código, situação, confiança, regra, serviços e datas. */
export function CandidateDetails({ candidate: c }: { candidate: MaintenanceCandidate }) {
  const dates = [
    c.requestedOn ? `Solicitada em ${formatDate(c.requestedOn)}` : null,
    c.scheduledDate ? `agendada para ${formatDate(c.scheduledDate)}` : null,
    c.entryDate ? `entrada em ${formatDate(c.entryDate)}` : null,
    c.exitDate ? `saída em ${formatDate(c.exitDate)}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  // Só conteúdo de frase (span): o bloco também vive dentro de um <label>.
  return (
    <span className="flex min-w-0 flex-1 flex-col gap-1">
      <span className="flex flex-wrap items-center gap-1.5">
        <span className="text-body-sm font-semibold tabular-nums text-fg">{c.code}</span>
        <MaintenanceStatusTag status={c.status} />
        <MaintenanceTypeBadge type={c.type} />
        <ConfidenceBadge confidence={c.confidence} />
      </span>
      <span className="text-caption text-fg-secondary">{RULE_LABEL[c.rule] ?? c.rule}</span>
      {c.services ? <span className="text-caption break-words text-fg-secondary">Serviços: {c.services}</span> : null}
      {dates ? <span className="text-caption text-fg-muted">{dates}</span> : null}
      {c.serviceMatch || c.autoResolveMatch || c.clusterMatch || c.contested ? (
        <span className="flex flex-wrap gap-1">
          {c.serviceMatch ? <Badge size="sm" variant="success" appearance="outline">Serviço mapeado</Badge> : null}
          {c.autoResolveMatch ? <Badge size="sm" variant="success" appearance="outline">Com baixa automática</Badge> : null}
          {!c.serviceMatch && c.clusterMatch ? <Badge size="sm" variant="info" appearance="outline">Mesmo cluster</Badge> : null}
          {c.contested ? <Badge size="sm" variant="warning" appearance="outline">Disputada por outro plano</Badge> : null}
        </span>
      ) : null}
    </span>
  );
}

/**
 * O checklist original, só leitura, pela leitura oficial do Check List de Frota.
 * Ela exige o acesso ao aplicativo (Aplicativos › Ver) e responde "sessão
 * expirada" também quando falta esse acesso; a dica diz o caminho alternativo.
 */
export const checklistLoader: ExecutionDetailLoader = async (id) => {
  const result = await loadExecutionDetail(id);
  if (result.ok) return result;
  return {
    ok: false,
    error: `${result.error ?? "Não foi possível carregar o checklist."} Abrir o checklist completo exige acesso ao Check List de Frota; sem ele, use “Ver rastro”.`,
  };
};

/** Na prévia de desenvolvimento não há sessão: o checklist completo não carrega. */
export const previewChecklistLoader: ExecutionDetailLoader = async () => ({
  ok: false,
  error: "Prévia de desenvolvimento: o checklist completo não é carregado aqui.",
});

// ---------------------------------------------------------------------------
// Contratos
// ---------------------------------------------------------------------------

/**
 * Executa a escrita e devolve o resultado do servidor. Na prévia de
 * desenvolvimento, recusa sem chamar o servidor (não há sessão).
 */
export type WriteRunner = <T>(call: () => Promise<Result<T>>) => Promise<Result<T>>;

export interface PlanDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  plan: ActionPlanDetail;
  run: WriteRunner;
  /** Depois de gravar: a gaveta avisa, relê o plano e a lista. */
  onSuccess: (title: string, description?: string) => void;
}

/** Os apontamentos a que uma tratativa por apontamento se aplica. */
export interface PlanTarget {
  items: PlanItem[];
  /** `true`: seleção explícita (os ids vão para o servidor); `false`: todos os abertos. */
  explicit: boolean;
}

const targetIds = (target: PlanTarget) => (target.explicit ? target.items.map((i) => i.id) : undefined);

// ---------------------------------------------------------------------------
// Casca comum
// ---------------------------------------------------------------------------

function useWrite({ run, onSuccess, onOpenChange }: Pick<PlanDialogProps, "run" | "onSuccess" | "onOpenChange">) {
  const [busy, start] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);
  const submit = React.useCallback(
    <T,>(call: () => Promise<Result<T>>, success: (data: T | undefined) => string, fallback: string) => {
      setError(null);
      start(async () => {
        const result = await run(call);
        if (result.ok) {
          onSuccess(success(result.data));
          onOpenChange(false);
        } else {
          setError(result.error ?? fallback);
        }
      });
    },
    [run, onSuccess, onOpenChange],
  );
  return { busy, error, submit };
}

function Shell({
  open, onOpenChange, busy, title, description, size = "md", testId, children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  busy: boolean;
  title: React.ReactNode;
  description?: React.ReactNode;
  size?: "sm" | "md" | "lg" | "xl";
  testId: string;
  children: React.ReactNode;
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        // Enquanto grava, o diálogo não fecha: o resultado precisa de um lugar para aparecer.
        if (!next && busy) return;
        onOpenChange(next);
      }}
    >
      <DialogContent
        size={size}
        data-testid={testId}
        aria-busy={busy || undefined}
        {...(description ? null : { "aria-describedby": undefined })}
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description ? <DialogDescription>{description}</DialogDescription> : null}
        </DialogHeader>
        {children}
      </DialogContent>
    </Dialog>
  );
}

function FormFrame({ onSubmit, children }: { onSubmit: () => void; children: React.ReactNode }) {
  return (
    <form
      noValidate
      className="flex min-h-0 flex-1 flex-col"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      {children}
    </form>
  );
}

function Footer({
  busy, onCancel, confirmLabel, confirmDisabled, destructive,
}: {
  busy: boolean;
  onCancel: () => void;
  confirmLabel: string;
  confirmDisabled?: boolean;
  destructive?: boolean;
}) {
  return (
    <DialogFooter>
      <Button variant="outline" onClick={onCancel} disabled={busy}>
        Voltar
      </Button>
      <Button
        type="submit"
        variant={destructive ? "danger" : "primary"}
        loading={busy}
        disabled={confirmDisabled}
        data-testid="plan-dialog-confirm"
      >
        {confirmLabel}
      </Button>
    </DialogFooter>
  );
}

/** A mensagem do servidor, dentro do diálogo (o diálogo continua aberto). */
function ServerError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <Alert variant="danger" data-testid="plan-dialog-error">
      <AlertDescription>{message}</AlertDescription>
    </Alert>
  );
}

/** A quais apontamentos a tratativa se aplica. */
export function TargetSummary({ target }: { target: PlanTarget }) {
  const { items, explicit } = target;
  const shown = items.slice(0, 4);
  return (
    <div className="flex flex-col gap-2 rounded-md border border-border bg-surface-secondary p-3" data-testid="plan-dialog-target">
      <p className="text-body-sm font-medium text-fg">
        {explicit
          ? `Aplica-se ${items.length === 1 ? "ao apontamento selecionado" : `aos ${formatInt(items.length)} apontamentos selecionados`}.`
          : `Aplica-se a todos os apontamentos em aberto (${formatInt(items.length)}).`}
      </p>
      <ul className="flex flex-col gap-1">
        {shown.map((i) => (
          <li key={i.id} className="flex flex-wrap items-center gap-x-2 gap-y-1 text-caption text-fg-secondary">
            <span className="tabular-nums">{formatDate(i.operationalDate)}</span>
            <span className="min-w-0 break-words">{i.optionLabel ?? i.question}</span>
            <ItemStatusBadge status={i.status} />
          </li>
        ))}
      </ul>
      {items.length > shown.length ? (
        <p className="text-caption text-fg-muted">e mais {plural(items.length - shown.length, "apontamento", "apontamentos")}.</p>
      ) : null}
    </div>
  );
}

const textError = (value: string, min: number, touched: boolean) =>
  touched && value.trim().length < min ? `Escreva pelo menos ${min} caracteres.` : undefined;

// ---------------------------------------------------------------------------
// Análise: iniciar / manutenção necessária
// ---------------------------------------------------------------------------

const ANALYSIS_COPY: Record<Exclude<AnalysisState, "new">, {
  title: string;
  description: string;
  confirm: string;
  success: (code: string) => string;
  testId: string;
}> = {
  in_analysis: {
    title: "Iniciar análise",
    description:
      "Registra que a tratativa do plano começou a ser analisada. Sem manutenção vinculada, a situação passa a “Em análise”.",
    confirm: "Iniciar análise",
    success: (code) => `${code} em análise.`,
    testId: "plan-dialog-analysis",
  },
  awaiting_maintenance: {
    title: "Manutenção necessária",
    description:
      "Define a tratativa: o problema exige manutenção. Sem manutenção vinculada, o plano passa a “Aguardando manutenção” até uma ser aberta ou vinculada.",
    confirm: "Definir manutenção necessária",
    success: (code) => `${code}: manutenção necessária.`,
    testId: "plan-dialog-maintenance-required",
  },
};

export function AnalysisDialog({ state, ...props }: PlanDialogProps & { state: Exclude<AnalysisState, "new"> }) {
  const { open, onOpenChange, plan } = props;
  const { busy, error, submit } = useWrite(props);
  const [note, setNote] = React.useState("");
  const copy = ANALYSIS_COPY[state];

  return (
    <Shell open={open} onOpenChange={onOpenChange} busy={busy} title={`${copy.title} · ${plan.code}`} description={copy.description} testId={copy.testId}>
      <FormFrame
        onSubmit={() =>
          submit(() => setPlanAnalysis(plan.id, state, note.trim() || undefined), () => copy.success(plan.code), "Não foi possível atualizar a tratativa.")
        }
      >
        <DialogBody className="flex flex-col gap-4">
          <ServerError message={error} />
          <FormField label="Observação" labelHint="Opcional" helperText="Fica registrada na linha do tempo do plano, com o seu nome e o horário.">
            <Textarea rows={3} maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} data-testid="plan-dialog-text" />
          </FormField>
        </DialogBody>
        <Footer busy={busy} onCancel={() => onOpenChange(false)} confirmLabel={copy.confirm} />
      </FormFrame>
    </Shell>
  );
}

// ---------------------------------------------------------------------------
// Resolver sem manutenção / improcedente / cancelar
// ---------------------------------------------------------------------------

export type ManualResolution = "resolved_without_maintenance" | "improper" | "cancelled";

const RESOLVE_COPY: Record<ManualResolution, {
  title: string;
  description: string;
  textLabel: string;
  placeholder: string;
  confirm: string;
  destructive?: boolean;
  withDate?: boolean;
  success: (n: number) => string;
  fallback: string;
  testId: string;
}> = {
  resolved_without_maintenance: {
    title: "Resolver sem manutenção",
    description:
      "O problema foi resolvido sem passar pela oficina. Nenhuma manutenção é criada e a resposta do checklist fica intacta.",
    textLabel: "Descrição da ação realizada",
    placeholder: "Ex.: retrovisor reapertado pela própria operação antes da saída para a rota.",
    confirm: "Resolver sem manutenção",
    withDate: true,
    success: (n) => (n === 1 ? "1 apontamento resolvido sem manutenção." : `${formatInt(n)} apontamentos resolvidos sem manutenção.`),
    fallback: "Não foi possível registrar a resolução.",
    testId: "plan-dialog-resolve-without-maintenance",
  },
  improper: {
    title: "Marcar como improcedente",
    description:
      "O apontamento não procede. A resposta do motorista fica intacta; a decisão e a justificativa ficam na trilha do plano.",
    textLabel: "Justificativa",
    placeholder: "Ex.: farol testado na base com o motorista; funcionando normalmente.",
    confirm: "Marcar como improcedente",
    success: (n) =>
      n === 1 ? "1 apontamento marcado como improcedente." : `${formatInt(n)} apontamentos marcados como improcedentes.`,
    fallback: "Não foi possível marcar como improcedente.",
    testId: "plan-dialog-improper",
  },
  cancelled: {
    title: "Cancelar apontamentos",
    description:
      "Cancelamento administrativo: o apontamento deixa de exigir tratativa sem contar como resolução técnica. Use para casos como veículo desmobilizado ou erro cadastral.",
    textLabel: "Justificativa do cancelamento",
    placeholder: "Ex.: veículo devolvido à locadora em 12/09; contrato encerrado.",
    confirm: "Cancelar apontamentos",
    destructive: true,
    success: (n) => (n === 1 ? "1 apontamento cancelado." : `${formatInt(n)} apontamentos cancelados.`),
    fallback: "Não foi possível cancelar os apontamentos.",
    testId: "plan-dialog-cancel",
  },
};

const MIN_JUSTIFICATION = 10;

export function ResolveDialog({
  resolution, target, ...props
}: PlanDialogProps & { resolution: ManualResolution; target: PlanTarget }) {
  const { open, onOpenChange, plan } = props;
  const { busy, error, submit } = useWrite(props);
  const copy = RESOLVE_COPY[resolution];
  const reasons = REASONS[resolution];
  const [reasonCode, setReasonCode] = React.useState("");
  const [text, setText] = React.useState("");
  const [resolvedOn, setResolvedOn] = React.useState("");
  const [touched, setTouched] = React.useState(false);
  const [today] = React.useState(todayIso);

  // A baixa retroativa vale entre o apontamento mais recente da seleção e hoje.
  const minDate = target.items.reduce((max, i) => (i.operationalDate > max ? i.operationalDate : max), "");
  const inMaintenance = target.items.filter((i) => i.status === "in_maintenance").length;

  const reasonError = touched && !reasonCode ? "Selecione o motivo." : undefined;
  const justificationError = textError(text, MIN_JUSTIFICATION, touched);
  const dateError =
    resolvedOn && resolvedOn > today
      ? "A data não pode estar no futuro."
      : resolvedOn && minDate && resolvedOn < minDate
        ? `A data não pode ser anterior ao apontamento (${formatDate(minDate)}).`
        : undefined;
  const invalid = !reasonCode || text.trim().length < MIN_JUSTIFICATION || Boolean(dateError);

  const confirm = () => {
    setTouched(true);
    if (invalid) return;
    submit(
      () =>
        resolvePlanItems(plan.id, {
          resolution,
          itemIds: targetIds(target),
          reasonCode,
          reason: text.trim(),
          resolvedOn: copy.withDate && resolvedOn ? resolvedOn : null,
        }),
      (data) => copy.success(data?.items ?? target.items.length),
      copy.fallback,
    );
  };

  return (
    <Shell open={open} onOpenChange={onOpenChange} busy={busy} size="lg" title={`${copy.title} · ${plan.code}`} description={copy.description} testId={copy.testId}>
      <FormFrame onSubmit={confirm}>
        <DialogBody className="flex flex-col gap-4">
          <ServerError message={error} />
          <TargetSummary target={target} />
          {resolution !== "cancelled" && inMaintenance > 0 ? (
            <Alert variant="warning">
              <AlertDescription>
                {inMaintenance === 1 ? "1 apontamento está" : `${formatInt(inMaintenance)} apontamentos estão`} em manutenção aberta.
                Conclua ou desvincule a manutenção antes desta baixa — o servidor recusa enquanto ela estiver aberta.
              </AlertDescription>
            </Alert>
          ) : null}
          <FormField label="Motivo" required error={reasonError}>
            <NativeSelect value={reasonCode} onChange={(e) => setReasonCode(e.target.value)} data-testid="plan-dialog-reason-code">
              <option value="">Selecione o motivo</option>
              {reasons.map((r) => (
                <option key={r.code} value={r.code}>
                  {r.label}
                </option>
              ))}
            </NativeSelect>
          </FormField>
          <FormField
            label={copy.textLabel}
            required
            helperText={`Mínimo de ${MIN_JUSTIFICATION} caracteres. Fica registrada na trilha do plano, com o seu nome e o horário.`}
            error={justificationError}
          >
            <Textarea
              rows={3}
              maxLength={2000}
              value={text}
              placeholder={copy.placeholder}
              onChange={(e) => setText(e.target.value)}
              onBlur={() => setTouched(true)}
              data-testid="plan-dialog-text"
            />
          </FormField>
          {copy.withDate ? (
            <FormField
              label="Data em que foi resolvido"
              labelHint="Opcional"
              helperText={`Para baixa retroativa: entre ${minDate ? formatDate(minDate) : "o apontamento"} e hoje. Em branco, vale o momento do registro.`}
              error={dateError}
            >
              <DateInput
                value={resolvedOn}
                min={minDate || undefined}
                max={today}
                onChange={(e) => setResolvedOn(e.target.value)}
                data-testid="plan-dialog-date"
              />
            </FormField>
          ) : null}
        </DialogBody>
        <Footer busy={busy} onCancel={() => onOpenChange(false)} confirmLabel={copy.confirm} destructive={copy.destructive} />
      </FormFrame>
    </Shell>
  );
}

// ---------------------------------------------------------------------------
// Validar a resolução pela manutenção concluída
// ---------------------------------------------------------------------------

/** Vínculos ativos com manutenção concluída — os que podem validar a resolução. */
export const completedLinks = (plan: ActionPlanDetail) =>
  plan.maintenanceLinks.filter((l) => l.linkStatus === "active" && l.status === "completed");

const MIN_OBSERVATION = 3;

export function ValidateDialog({ target, ...props }: PlanDialogProps & { target: PlanTarget }) {
  const { open, onOpenChange, plan } = props;
  const { busy, error, submit } = useWrite(props);
  const links = completedLinks(plan);
  const [maintenanceId, setMaintenanceId] = React.useState(links.length === 1 ? links[0].maintenanceId : "");
  const [text, setText] = React.useState("");
  const [touched, setTouched] = React.useState(false);
  const idBase = React.useId();
  const chosen = links.find((l) => l.maintenanceId === maintenanceId);
  const invalid = !chosen || text.trim().length < MIN_OBSERVATION;

  const confirm = () => {
    setTouched(true);
    if (invalid || !chosen) return;
    submit(
      () =>
        resolvePlanItems(plan.id, {
          resolution: "validated_by_maintenance",
          itemIds: targetIds(target),
          reason: text.trim(),
          maintenanceId: chosen.maintenanceId,
        }),
      (data) => {
        const n = data?.items ?? target.items.length;
        return `${n === 1 ? "Resolução validada" : `${formatInt(n)} resoluções validadas`} pela manutenção ${chosen.code}.`;
      },
      "Não foi possível validar a resolução.",
    );
  };

  return (
    <Shell
      open={open}
      onOpenChange={onOpenChange}
      busy={busy}
      size="lg"
      title={`Validar resolução pela manutenção · ${plan.code}`}
      description="Confirma que a manutenção concluída resolveu o problema. Use quando a baixa automática não aconteceu (serviço sem mapeamento específico ou apontamento com várias opções)."
      testId="plan-dialog-validate"
    >
      <FormFrame onSubmit={confirm}>
        <DialogBody className="flex flex-col gap-4">
          <ServerError message={error} />
          <TargetSummary target={target} />
          {links.length === 0 ? (
            <EmptyState
              size="sm"
              title="Nenhuma manutenção concluída vinculada"
              description="A validação exige uma manutenção vinculada a este plano e já concluída."
            />
          ) : (
            <FormField label="Manutenção concluída" required error={touched && !chosen ? "Escolha a manutenção que resolveu." : undefined}>
              <RadioGroup value={maintenanceId} onValueChange={setMaintenanceId} className="gap-2">
                {links.map((l) => {
                  const id = `${idBase}-${l.maintenanceId}`;
                  const selected = l.maintenanceId === maintenanceId;
                  return (
                    <div
                      key={l.id}
                      className={cn(
                        "flex items-start gap-3 rounded-md border p-3 hfm-transition",
                        selected ? "border-primary bg-surface-selected" : "border-border bg-surface hover:bg-hover-overlay",
                      )}
                    >
                      <RadioGroupItem id={id} value={l.maintenanceId} className="mt-0.5" aria-label={`${l.code} — saída em ${formatDate(l.exitDate)}`} />
                      <label htmlFor={id} className="flex min-w-0 flex-1 cursor-pointer flex-col gap-1">
                        <span className="flex flex-wrap items-center gap-1.5">
                          <span className="text-body-sm font-semibold tabular-nums text-fg">{l.code}</span>
                          <MaintenanceStatusTag status={l.status} />
                        </span>
                        <span className="text-caption text-fg-secondary">
                          Saída em {formatDate(l.exitDate)} · {plural(l.answersResolved, "apontamento tratado", "apontamentos tratados")} de {formatInt(l.answers)}
                        </span>
                        {l.services ? <span className="text-caption break-words text-fg-muted">Serviços: {l.services}</span> : null}
                      </label>
                    </div>
                  );
                })}
              </RadioGroup>
            </FormField>
          )}
          <FormField
            label="Observação da validação"
            required
            helperText={`Mínimo de ${MIN_OBSERVATION} caracteres. Diga o que confirmou a resolução.`}
            error={textError(text, MIN_OBSERVATION, touched)}
          >
            <Textarea
              rows={3}
              maxLength={2000}
              value={text}
              placeholder="Ex.: troca da lâmpada conferida na OS; farol testado na saída."
              onChange={(e) => setText(e.target.value)}
              onBlur={() => setTouched(true)}
              data-testid="plan-dialog-text"
            />
          </FormField>
        </DialogBody>
        <Footer busy={busy} onCancel={() => onOpenChange(false)} confirmLabel="Validar resolução" confirmDisabled={links.length === 0} />
      </FormFrame>
    </Shell>
  );
}

// ---------------------------------------------------------------------------
// Motivo obrigatório (reabrir, desvincular)
// ---------------------------------------------------------------------------

interface ReasonDialogProps extends PlanDialogProps {
  title: string;
  description?: React.ReactNode;
  warning?: React.ReactNode;
  label: string;
  placeholder?: string;
  minLength: number;
  confirmLabel: string;
  destructive?: boolean;
  testId: string;
  action: (reason: string) => Promise<Result<unknown>>;
  success: string;
  fallback: string;
}

function ReasonDialog({
  title, description, warning, label, placeholder, minLength, confirmLabel, destructive, testId, action, success, fallback, ...props
}: ReasonDialogProps) {
  const { open, onOpenChange } = props;
  const { busy, error, submit } = useWrite(props);
  const [reason, setReason] = React.useState("");
  const [touched, setTouched] = React.useState(false);
  const invalid = reason.trim().length < minLength;

  const confirm = () => {
    setTouched(true);
    if (invalid) return;
    submit(() => action(reason.trim()), () => success, fallback);
  };

  return (
    <Shell open={open} onOpenChange={onOpenChange} busy={busy} title={title} description={description} testId={testId}>
      <FormFrame onSubmit={confirm}>
        <DialogBody className="flex flex-col gap-4">
          <ServerError message={error} />
          {warning ? (
            <Alert variant="warning">
              <AlertDescription>{warning}</AlertDescription>
            </Alert>
          ) : null}
          <FormField
            label={label}
            required
            helperText={`Mínimo de ${minLength} caracteres. Fica registrado na trilha do plano, com o seu nome e o horário.`}
            error={textError(reason, minLength, touched)}
          >
            <Textarea
              rows={3}
              maxLength={2000}
              value={reason}
              placeholder={placeholder}
              onChange={(e) => setReason(e.target.value)}
              onBlur={() => setTouched(true)}
              data-testid="plan-dialog-text"
            />
          </FormField>
        </DialogBody>
        <Footer busy={busy} onCancel={() => onOpenChange(false)} confirmLabel={confirmLabel} destructive={destructive} />
      </FormFrame>
    </Shell>
  );
}

export function ReopenDialog(props: PlanDialogProps) {
  const { plan } = props;
  return (
    <ReasonDialog
      {...props}
      title={`Reabrir ${plan.code}`}
      description="O problema permaneceu ou voltou depois do encerramento."
      warning="Os apontamentos encerrados (exceto os cancelados) voltam a pendentes. As manutenções já terminadas continuam vinculadas como histórico, mas deixam de contar como tratativa. O ciclo anterior fica preservado na trilha."
      label="Motivo da reabertura"
      placeholder="Ex.: o motorista voltou a apontar o vazamento três dias depois da manutenção."
      minLength={MIN_JUSTIFICATION}
      confirmLabel="Reabrir plano"
      testId="plan-dialog-reopen"
      action={(reason) => reopenPlan(plan.id, reason)}
      success={`${plan.code} reaberto.`}
      fallback="Não foi possível reabrir o plano."
    />
  );
}

export function UnlinkDialog({ link, ...props }: PlanDialogProps & { link: PlanMaintenanceLink }) {
  const { plan } = props;
  return (
    <ReasonDialog
      {...props}
      title={`Desvincular ${link.code}`}
      description={`A manutenção deixa de tratar o plano ${plan.code}. Os apontamentos ainda não resolvidos saem dela, a menos que outro plano aberto os mantenha. O vínculo continua no histórico como desvinculado.`}
      label="Motivo do desvínculo"
      placeholder="Ex.: a manutenção trata outro defeito do veículo; vínculo feito por engano."
      minLength={MIN_JUSTIFICATION}
      confirmLabel="Desvincular"
      destructive
      testId="plan-dialog-unlink"
      action={(reason) => unlinkPlanMaintenance(plan.id, link.maintenanceId, reason)}
      success={`${link.code} desvinculada de ${plan.code}.`}
      fallback="Não foi possível desvincular a manutenção."
    />
  );
}

// ---------------------------------------------------------------------------
// Prioridade, prazo, responsável, observação
// ---------------------------------------------------------------------------

export const PRIORITY_SOURCE_LABEL: Record<string, string> = {
  parameter: "pelo parâmetro do item",
  criticality: "pela criticidade da pergunta",
  user: "definida por usuário",
};

export const DUE_SOURCE_LABEL: Record<string, string> = {
  sla: "calculado pelo SLA da prioridade",
  user: "definido por usuário",
};

export function PriorityDialog(props: PlanDialogProps) {
  const { open, onOpenChange, plan } = props;
  const { busy, error, submit } = useWrite(props);
  const [priority, setPriority] = React.useState<Priority>(plan.priority);
  const [reason, setReason] = React.useState("");
  const [recalculate, setRecalculate] = React.useState(true);
  const [touched, setTouched] = React.useState(false);
  const same = priority === plan.priority;
  const invalid = same || reason.trim().length < MIN_JUSTIFICATION;

  const confirm = () => {
    setTouched(true);
    if (invalid) return;
    submit(
      () => changePlanPriority(plan.id, priority, reason.trim(), recalculate),
      () => `Prioridade de ${plan.code} alterada para ${PRIORITY_LABEL[priority]}.`,
      "Não foi possível alterar a prioridade.",
    );
  };

  return (
    <Shell
      open={open}
      onOpenChange={onOpenChange}
      busy={busy}
      title={`Alterar prioridade · ${plan.code}`}
      description={`Prioridade atual: ${PRIORITY_LABEL[plan.priority]} (${PRIORITY_SOURCE_LABEL[plan.prioritySource] ?? plan.prioritySource}).`}
      testId="plan-dialog-priority"
    >
      <FormFrame onSubmit={confirm}>
        <DialogBody className="flex flex-col gap-4">
          <ServerError message={error} />
          <FormField label="Nova prioridade" required error={touched && same ? "Escolha uma prioridade diferente da atual." : undefined}>
            <NativeSelect value={priority} onChange={(e) => setPriority(e.target.value as Priority)} data-testid="plan-dialog-priority-select">
              {PRIORITY_ORDER.map((p) => (
                <option key={p} value={p}>
                  {PRIORITY_LABEL[p]}
                  {p === plan.priority ? " (atual)" : ""}
                </option>
              ))}
            </NativeSelect>
          </FormField>
          <FormField
            label="Motivo"
            required
            helperText={`Mínimo de ${MIN_JUSTIFICATION} caracteres.`}
            error={textError(reason, MIN_JUSTIFICATION, touched)}
          >
            <Textarea
              rows={3}
              maxLength={2000}
              value={reason}
              placeholder="Ex.: veículo escalado para rota longa amanhã; risco de parada."
              onChange={(e) => setReason(e.target.value)}
              onBlur={() => setTouched(true)}
              data-testid="plan-dialog-text"
            />
          </FormField>
          <CheckboxField
            label="Recalcular o prazo pela nova prioridade"
            description={
              plan.dueSource === "sla"
                ? `O prazo atual (${formatDate(plan.dueOn)}) foi calculado pelo SLA; desmarque para mantê-lo.`
                : "O prazo atual foi definido por usuário e é mantido mesmo com esta opção marcada."
            }
            checked={recalculate}
            onCheckedChange={(v) => setRecalculate(v === true)}
            data-testid="plan-dialog-recalculate"
          />
        </DialogBody>
        <Footer busy={busy} onCancel={() => onOpenChange(false)} confirmLabel="Alterar prioridade" />
      </FormFrame>
    </Shell>
  );
}

export function DueDialog(props: PlanDialogProps) {
  const { open, onOpenChange, plan } = props;
  const { busy, error, submit } = useWrite(props);
  const [dueOn, setDueOn] = React.useState(plan.dueOn ?? "");
  const [reason, setReason] = React.useState("");
  const [touched, setTouched] = React.useState(false);
  const dateError = !dueOn
    ? "Informe o novo prazo."
    : dueOn < plan.firstOperationalDate
      ? `O prazo não pode ser anterior ao primeiro apontamento (${formatDate(plan.firstOperationalDate)}).`
      : undefined;
  const invalid = Boolean(dateError) || reason.trim().length < MIN_JUSTIFICATION;

  const confirm = () => {
    setTouched(true);
    if (invalid) return;
    submit(
      () => setPlanDue(plan.id, dueOn, reason.trim()),
      () => `Prazo de ${plan.code} alterado para ${formatDate(dueOn)}.`,
      "Não foi possível alterar o prazo.",
    );
  };

  return (
    <Shell
      open={open}
      onOpenChange={onOpenChange}
      busy={busy}
      title={`Alterar prazo · ${plan.code}`}
      description={
        plan.dueOn
          ? `Prazo atual: ${formatDate(plan.dueOn)} (${DUE_SOURCE_LABEL[plan.dueSource] ?? plan.dueSource}). Um prazo definido aqui não é recalculado por mudança de prioridade.`
          : "O plano está sem prazo. Um prazo definido aqui não é recalculado por mudança de prioridade."
      }
      testId="plan-dialog-due"
    >
      <FormFrame onSubmit={confirm}>
        <DialogBody className="flex flex-col gap-4">
          <ServerError message={error} />
          <FormField label="Novo prazo" required error={touched ? dateError : undefined}>
            <DateInput value={dueOn} min={plan.firstOperationalDate} onChange={(e) => setDueOn(e.target.value)} data-testid="plan-dialog-date" />
          </FormField>
          <FormField
            label="Motivo"
            required
            helperText={`Mínimo de ${MIN_JUSTIFICATION} caracteres.`}
            error={textError(reason, MIN_JUSTIFICATION, touched)}
          >
            <Textarea
              rows={3}
              maxLength={2000}
              value={reason}
              placeholder="Ex.: oficina credenciada só tem vaga na próxima semana."
              onChange={(e) => setReason(e.target.value)}
              onBlur={() => setTouched(true)}
              data-testid="plan-dialog-text"
            />
          </FormField>
        </DialogBody>
        <Footer busy={busy} onCancel={() => onOpenChange(false)} confirmLabel="Alterar prazo" />
      </FormFrame>
    </Shell>
  );
}

export function AssignDialog({ catalog, ...props }: PlanDialogProps & { catalog: ActionPlanCatalog }) {
  const { open, onOpenChange, plan } = props;
  const { busy, error, submit } = useWrite(props);
  const current = plan.responsibleUserId ?? "";
  const [userId, setUserId] = React.useState(current);
  const [reason, setReason] = React.useState("");
  const [touched, setTouched] = React.useState(false);
  const options = React.useMemo(() => {
    const list = [...catalog.responsibles];
    // O responsável atual continua visível mesmo fora da lista (inativo, outra operação).
    if (plan.responsibleUserId && !list.some((r) => r.id === plan.responsibleUserId)) {
      list.push({ id: plan.responsibleUserId, name: plan.responsibleName ?? "Responsável atual" });
    }
    return list.sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
  }, [catalog.responsibles, plan.responsibleUserId, plan.responsibleName]);
  const same = userId === current;
  const chosenName = options.find((o) => o.id === userId)?.name;

  const confirm = () => {
    setTouched(true);
    if (same) return;
    submit(
      () => assignPlan(plan.id, userId || null, reason.trim() || undefined),
      () => (userId ? `${chosenName ?? "Responsável"} agora responde por ${plan.code}.` : `${plan.code} ficou sem responsável.`),
      "Não foi possível alterar o responsável.",
    );
  };

  return (
    <Shell
      open={open}
      onOpenChange={onOpenChange}
      busy={busy}
      title={`Responsável · ${plan.code}`}
      description="Quem acompanha a tratativa agora — distinto da liderança histórica do checklist, que fica preservada."
      testId="plan-dialog-assign"
    >
      <FormFrame onSubmit={confirm}>
        <DialogBody className="flex flex-col gap-4">
          <ServerError message={error} />
          <FormField label="Responsável" required error={touched && same ? "Escolha um responsável diferente do atual." : undefined}>
            <NativeSelect value={userId} onChange={(e) => setUserId(e.target.value)} data-testid="plan-dialog-responsible">
              <option value="">Sem responsável</option>
              {options.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                  {o.id === current ? " (atual)" : ""}
                </option>
              ))}
            </NativeSelect>
          </FormField>
          <FormField label="Motivo" labelHint="Opcional">
            <Textarea rows={2} maxLength={2000} value={reason} onChange={(e) => setReason(e.target.value)} data-testid="plan-dialog-text" />
          </FormField>
        </DialogBody>
        <Footer busy={busy} onCancel={() => onOpenChange(false)} confirmLabel="Salvar responsável" />
      </FormFrame>
    </Shell>
  );
}

export function NoteDialog(props: PlanDialogProps) {
  const { open, onOpenChange, plan } = props;
  const { busy, error, submit } = useWrite(props);
  const [note, setNote] = React.useState("");
  const [touched, setTouched] = React.useState(false);
  const invalid = note.trim().length < MIN_OBSERVATION;

  const confirm = () => {
    setTouched(true);
    if (invalid) return;
    submit(() => addPlanNote(plan.id, note.trim()), () => `Observação registrada em ${plan.code}.`, "Não foi possível registrar a observação.");
  };

  return (
    <Shell
      open={open}
      onOpenChange={onOpenChange}
      busy={busy}
      title={`Registrar observação · ${plan.code}`}
      description="Fica na linha do tempo do plano, com o seu nome e o horário. Não altera a situação."
      testId="plan-dialog-note"
    >
      <FormFrame onSubmit={confirm}>
        <DialogBody className="flex flex-col gap-4">
          <ServerError message={error} />
          <FormField label="Observação" required helperText={`Mínimo de ${MIN_OBSERVATION} caracteres.`} error={textError(note, MIN_OBSERVATION, touched)}>
            <Textarea
              rows={4}
              maxLength={2000}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              onBlur={() => setTouched(true)}
              data-testid="plan-dialog-text"
            />
          </FormField>
        </DialogBody>
        <Footer busy={busy} onCancel={() => onOpenChange(false)} confirmLabel="Registrar" />
      </FormFrame>
    </Shell>
  );
}

// ---------------------------------------------------------------------------
// Vincular manutenção existente
// ---------------------------------------------------------------------------

export type CandidateLoader = () => Promise<Result<MaintenanceCandidate[]>>;

export function LinkMaintenanceDialog({
  target, loadCandidates, ...props
}: PlanDialogProps & { target: PlanTarget; loadCandidates: CandidateLoader }) {
  const { open, onOpenChange, plan } = props;
  const { busy, error, submit } = useWrite(props);
  const [candidates, setCandidates] = React.useState<MaintenanceCandidate[] | null>(null);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [loading, startLoading] = React.useTransition();
  const [maintenanceId, setMaintenanceId] = React.useState("");
  const [reason, setReason] = React.useState("");
  const [resolutive, setResolutive] = React.useState(true);
  const [touched, setTouched] = React.useState(false);
  const idBase = React.useId();

  const fetchCandidates = React.useCallback(() => {
    startLoading(async () => {
      const result = await loadCandidates();
      if (result.ok) {
        setCandidates(result.data ?? []);
        setLoadError(null);
      } else {
        setLoadError(result.error ?? "Não foi possível buscar as manutenções candidatas.");
      }
    });
  }, [loadCandidates]);

  React.useEffect(() => {
    fetchCandidates();
  }, [fetchCandidates]);

  const chosen = candidates?.find((c) => c.maintenanceId === maintenanceId);

  const confirm = () => {
    setTouched(true);
    if (!chosen) return;
    submit(
      () =>
        linkPlanMaintenance(plan.id, chosen.maintenanceId, {
          itemIds: targetIds(target),
          resolutive,
          reason: reason.trim() || null,
          origin: "linked_manual",
        }),
      () => `${chosen.code} vinculada ao plano ${plan.code}.`,
      "Não foi possível vincular a manutenção.",
    );
  };

  return (
    <Shell
      open={open}
      onOpenChange={onOpenChange}
      busy={busy}
      size="lg"
      title={`Vincular manutenção existente · ${plan.code}`}
      description="Manutenções do mesmo veículo em aberto ou no período do plano, da correspondência mais forte para a mais fraca. O vínculo fica na trilha do plano e da manutenção."
      testId="plan-dialog-link-maintenance"
    >
      <FormFrame onSubmit={confirm}>
        <DialogBody className="flex flex-col gap-4" aria-busy={loading || undefined}>
          <ServerError message={error} />
          <TargetSummary target={target} />
          {candidates === null && !loadError ? (
            <SkeletonGroup label="Buscando manutenções candidatas…" className="flex flex-col gap-2">
              <Skeleton className="h-20 w-full" />
              <Skeleton className="h-20 w-full" />
            </SkeletonGroup>
          ) : loadError && candidates === null ? (
            <ErrorState
              variant="inline"
              title="Não foi possível buscar as manutenções candidatas."
              description={loadError}
              onRetry={fetchCandidates}
              retrying={loading}
            />
          ) : candidates && candidates.length === 0 ? (
            <EmptyState
              size="sm"
              variant="panel"
              title="Nenhuma manutenção candidata"
              description="Não há manutenção deste veículo em aberto nem no período do plano. Abra uma nova pelo plano."
            />
          ) : candidates ? (
            <FormField label="Manutenção" required error={touched && !chosen ? "Escolha a manutenção a vincular." : undefined}>
              <RadioGroup value={maintenanceId} onValueChange={setMaintenanceId} className="gap-2" data-testid="plan-dialog-candidates">
                {candidates.map((c) => {
                  const id = `${idBase}-${c.maintenanceId}`;
                  const selected = c.maintenanceId === maintenanceId;
                  return (
                    <div
                      key={c.maintenanceId}
                      className={cn(
                        "flex items-start gap-3 rounded-md border p-3 hfm-transition",
                        selected ? "border-primary bg-surface-selected" : "border-border bg-surface hover:bg-hover-overlay",
                      )}
                      data-testid="plan-candidate"
                    >
                      <RadioGroupItem
                        id={id}
                        value={c.maintenanceId}
                        className="mt-0.5"
                        aria-label={`${c.code} — ${MAINTENANCE_STATUS_LABEL[c.status] ?? c.status}`}
                      />
                      <label htmlFor={id} className="flex min-w-0 flex-1 cursor-pointer">
                        <CandidateDetails candidate={c} />
                      </label>
                    </div>
                  );
                })}
              </RadioGroup>
            </FormField>
          ) : null}
          {candidates && candidates.length > 0 ? (
            <>
              <CheckboxField
                label="Manutenção resolutiva"
                description="Ao ser concluída, a manutenção dá baixa nos apontamentos vinculados. Desmarque quando ela só acompanha o problema."
                checked={resolutive}
                onCheckedChange={(v) => setResolutive(v === true)}
                data-testid="plan-dialog-resolutive"
              />
              <FormField label="Motivo do vínculo" labelHint="Opcional">
                <Textarea
                  rows={2}
                  maxLength={2000}
                  value={reason}
                  placeholder="Ex.: a OS já inclui a troca do retrovisor apontado."
                  onChange={(e) => setReason(e.target.value)}
                  data-testid="plan-dialog-text"
                />
              </FormField>
            </>
          ) : null}
        </DialogBody>
        <Footer
          busy={busy}
          onCancel={() => onOpenChange(false)}
          confirmLabel="Vincular manutenção"
          confirmDisabled={!candidates || candidates.length === 0}
        />
      </FormFrame>
    </Shell>
  );
}

// ---------------------------------------------------------------------------
// Abrir manutenção: prevenção de duplicidade (§38)
// ---------------------------------------------------------------------------

export function DuplicateMaintenanceDialog({
  candidates, target, canLink, onOpenNew, ...props
}: PlanDialogProps & {
  /** Manutenções ATIVAS do veículo que o servidor apontou como candidatas. */
  candidates: MaintenanceCandidate[];
  target: PlanTarget;
  canLink: boolean;
  /** Abre o assistente oficial; ele pede a justificativa da duplicidade. */
  onOpenNew: () => void;
}) {
  const { open, onOpenChange, plan } = props;
  const { busy, error, submit } = useWrite(props);
  const [linkingId, setLinkingId] = React.useState<string | null>(null);
  const sameService = candidates.some((c) => c.serviceMatch);

  const link = (c: MaintenanceCandidate) => {
    setLinkingId(c.maintenanceId);
    submit(
      () => linkPlanMaintenance(plan.id, c.maintenanceId, { itemIds: targetIds(target), origin: "linked_manual" }),
      () => `${c.code} vinculada ao plano ${plan.code}.`,
      "Não foi possível vincular a manutenção.",
    );
  };

  return (
    <Shell
      open={open}
      onOpenChange={onOpenChange}
      busy={busy}
      size="lg"
      title={`Abrir manutenção · ${plan.code}`}
      testId="plan-dialog-duplicates"
    >
      <DialogBody className="flex flex-col gap-4">
        <Alert variant="warning" icon={<AlertTriangle />}>
          <AlertTitle>
            {sameService ? "Já existe manutenção ativa para este veículo e serviço" : "Já existe manutenção ativa para este veículo"}
          </AlertTitle>
          <AlertDescription>
            Para não levar o veículo duas vezes à oficina, vincule a manutenção existente ao plano. Se for mesmo outro
            serviço, abra uma nova: o assistente da Manutenção pede a justificativa.
          </AlertDescription>
        </Alert>
        <ServerError message={error} />
        <TargetSummary target={target} />
        <ul className="flex flex-col gap-2" aria-label="Manutenções ativas do veículo">
          {candidates.map((c) => (
            <li
              key={c.maintenanceId}
              className="flex flex-col gap-3 rounded-md border border-border bg-surface p-3 sm:flex-row sm:items-start"
              data-testid="plan-duplicate-candidate"
            >
              <CandidateDetails candidate={c} />
              {canLink ? (
                <Button
                  size="sm"
                  variant="primary"
                  leadingIcon={<Link2 />}
                  loading={busy && linkingId === c.maintenanceId}
                  disabled={busy && linkingId !== c.maintenanceId}
                  onClick={() => link(c)}
                  data-testid="plan-duplicate-link"
                >
                  Vincular esta
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
        {!canLink ? (
          <p className="text-caption text-fg-muted">
            Vincular manutenção exige a permissão de vínculo do Plano de Ação; peça a quem a tem ou abra uma nova com justificativa.
          </p>
        ) : null}
      </DialogBody>
      <DialogFooter>
        <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
          Voltar
        </Button>
        <Button
          variant="secondary"
          leadingIcon={<Plus />}
          disabled={busy}
          onClick={() => {
            onOpenChange(false);
            onOpenNew();
          }}
          data-testid="plan-duplicate-open-new"
        >
          Abrir nova mesmo assim
        </Button>
      </DialogFooter>
    </Shell>
  );
}

