"use client";

import * as React from "react";
import { AlertTriangle, ArrowLeft, Camera, Check, CheckCircle2, ClipboardCheck, History, Plus, Send, ShieldCheck, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/ui/status-badge";
import { Textarea } from "@/components/ui/textarea";
import { FormField } from "@/components/ui/form-field";
import { Progress } from "@/components/feedback/progress";
import { Alert, AlertDescription, AlertTitle } from "@/components/feedback/alert";
import { EmptyState } from "@/components/feedback/empty-state";
import { useToast } from "@/components/feedback/toast";
import type { submitInspection } from "@/lib/mtsr/app-actions";
import { fmtInt, formatStamp, type MtsrAppComponent, type MtsrAppContext, type MtsrSubmitResult } from "@/lib/mtsr/types";
import { EvidenceCapture, type EvidenceLoaders, type EvidenceProgress } from "./evidence-capture";
import { clearDraft, emptyAnswer, saveDraft, type EvidenceRef, type InspectionDraft, type ItemAnswer } from "./draft";

/**
 * O executor da Vistoria MTSR: itens → revisão → envio → protocolo.
 *
 * Um cartão por componente de CAMPO (os de backoffice ficam num aviso fixo:
 * não entram na vistoria). OK e NOK são dois botões grandes; foto e observação
 * seguem a regra do componente (`evidenceRequiredWhenOk/Nok`,
 * `observationRequiredWhenNok`). "Revisar" só abre quando não há pendência e
 * nenhuma foto está a meio caminho.
 *
 * O rascunho é gravado no aparelho a cada alteração — mas a tela nunca diz
 * "enviado" por causa disso: enviado é o que o servidor confirmou com
 * protocolo. O envio usa a MESMA `clientSubmissionId` em todas as tentativas,
 * e a rotina devolve o mesmo protocolo se já tiver recebido (`duplicate`).
 */
export type SubmitFn = typeof submitInspection;

export interface RunnerLoaders extends EvidenceLoaders {
  submit: SubmitFn;
}

export type RunnerExit = "new" | "history";

type Phase = "items" | "review" | "done";

/** Pendências de um item, nas palavras que a tela mostra. */
export function itemIssues(component: MtsrAppComponent, answer: ItemAnswer): string[] {
  if (answer.status === null) return ["Responda OK ou NOK"];
  const issues: string[] = [];
  const needsPhoto = answer.status === "ok" ? component.evidenceRequiredWhenOk : component.evidenceRequiredWhenNok;
  if (needsPhoto && answer.evidence.length === 0) issues.push("Foto obrigatória");
  if (answer.status === "nok" && component.observationRequiredWhenNok && answer.observation.trim() === "") issues.push("Observação obrigatória em NOK");
  return issues;
}

/** O selo da regra de foto do componente, ou null quando a foto é sempre opcional. */
export function photoRuleLabel(c: MtsrAppComponent): string | null {
  if (c.evidenceRequiredWhenOk && c.evidenceRequiredWhenNok) return "Foto obrigatória";
  if (c.evidenceRequiredWhenOk) return "Foto obrigatória em OK";
  if (c.evidenceRequiredWhenNok) return "Foto obrigatória em NOK";
  return null;
}

export function vehicleLine(draft: InspectionDraft): string {
  const v = draft.vehicle;
  return [v.licensePlate, v.fleetCode ? `Frota ${v.fleetCode}` : null, v.vehicleTypeName].filter(Boolean).join(" · ");
}

export interface InspectionRunnerProps {
  context: MtsrAppContext;
  draft: InspectionDraft;
  /** Escopo do rascunho (id do usuário). */
  scope: string;
  loaders: RunnerLoaders;
  onCancel: () => void;
  onFinished: (exit: RunnerExit) => void;
  /** Prévia sem sessão: "Simular foto" visível nos itens. */
  preview?: boolean;
}

export function InspectionRunner({ context, draft, scope, loaders, onCancel, onFinished, preview = false }: InspectionRunnerProps) {
  const { toast } = useToast();
  const components = context.components;
  const [answers, setAnswers] = React.useState<Record<string, ItemAnswer>>(draft.answers);
  const [generalObservation, setGeneralObservation] = React.useState(draft.generalObservation ?? "");
  const [progress, setProgress] = React.useState<Record<string, EvidenceProgress>>({});
  const [phase, setPhase] = React.useState<Phase>("items");
  const [highlight, setHighlight] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [sending, startSending] = React.useTransition();
  const [result, setResult] = React.useState<MtsrSubmitResult | null>(null);

  // O rascunho acompanha cada alteração até o protocolo chegar.
  React.useEffect(() => {
    if (phase === "done") return;
    saveDraft(scope, { ...draft, answers, generalObservation });
  }, [scope, draft, answers, generalObservation, phase]);

  const updateAnswer = React.useCallback((componentId: string, patch: Partial<ItemAnswer>) => {
    setAnswers((current) => ({ ...current, [componentId]: { ...(current[componentId] ?? emptyAnswer()), ...patch } }));
  }, []);

  const onEvidence = React.useCallback(
    (componentId: string, refs: EvidenceRef[], p: EvidenceProgress) => {
      updateAnswer(componentId, { evidence: refs });
      setProgress((current) => ({ ...current, [componentId]: p }));
    },
    [updateAnswer],
  );

  const stats = React.useMemo(() => {
    let ok = 0;
    let nok = 0;
    let photos = 0;
    const pending: { component: MtsrAppComponent; issues: string[] }[] = [];
    for (const c of components) {
      const a = answers[c.id] ?? emptyAnswer();
      if (a.status === "ok") ok += 1;
      if (a.status === "nok") nok += 1;
      photos += a.evidence.length;
      const issues = itemIssues(c, a);
      if (issues.length) pending.push({ component: c, issues });
    }
    return { ok, nok, photos, answered: ok + nok, pending, total: components.length };
  }, [components, answers]);

  const uploading = Object.values(progress).reduce((sum, p) => sum + p.uploading, 0);

  const scrollToItem = (code: string) => {
    document.querySelector(`[data-testid="mtsr-app-item-${code}"]`)?.scrollIntoView({ block: "center", behavior: "smooth" });
  };

  const goReview = () => {
    setHighlight(true);
    if (stats.pending.length > 0) {
      setError(null);
      scrollToItem(stats.pending[0].component.code);
      return;
    }
    if (uploading > 0) {
      setError("Aguarde o envio das fotos antes de revisar.");
      return;
    }
    setHighlight(false);
    setError(null);
    setPhase("review");
    window.scrollTo({ top: 0 });
  };

  const send = () => {
    setError(null);
    if (stats.pending.length > 0 || uploading > 0) {
      setHighlight(true);
      setPhase("items");
      return;
    }
    startSending(async () => {
      const response = await loaders.submit({
        clientSubmissionId: draft.clientSubmissionId,
        vehicleId: draft.vehicle.id,
        inspectedAt: draft.startedAt,
        generalObservation: generalObservation.trim() || null,
        items: components.map((c) => {
          const a = answers[c.id] ?? emptyAnswer();
          return {
            componentId: c.id,
            status: (a.status ?? "ok") as "ok" | "nok",
            observation: a.observation.trim() || null,
            evidence: a.evidence.map((e) => ({
              storagePath: e.storagePath,
              mimeType: e.mimeType,
              sizeBytes: e.sizeBytes,
              sha256: e.sha256,
              capturedAt: e.capturedAt,
            })),
          };
        }),
      });
      if (!response.ok || !response.data) {
        setError(response.error ?? "Não foi possível enviar a vistoria.");
        return;
      }
      // Só agora o rascunho pode sair: o servidor confirmou com protocolo.
      clearDraft(scope);
      setResult(response.data);
      setPhase("done");
      window.scrollTo({ top: 0 });
      toast({
        title: response.data.duplicate ? "Esta vistoria já havia sido recebida." : `Vistoria enviada — protocolo ${response.data.protocol}.`,
        variant: "success",
      });
    });
  };

  const plate = draft.vehicle.licensePlate;

  // ------------------------------------------------------------------ done
  if (phase === "done" && result) {
    return (
      <div className="flex flex-col gap-4" data-testid="mtsr-app-done">
        <div className="flex flex-col items-center gap-3 rounded-lg border border-success-border bg-success-soft px-4 py-6 text-center shadow-card sm:p-6">
          <span className="flex size-16 items-center justify-center rounded-full bg-success text-success-fg">
            <CheckCircle2 className="size-9" aria-hidden />
          </span>
          <div className="flex flex-col gap-1">
            <h2 className="text-h3 font-semibold text-fg">{result.duplicate ? "Vistoria já recebida" : "Vistoria enviada"}</h2>
            <p className="text-caption uppercase tracking-wide text-fg-muted">Protocolo</p>
            <p className="font-mono text-h2 font-semibold tracking-wide text-fg" data-testid="mtsr-app-protocol">
              {result.protocol}
            </p>
            <p className="text-caption text-fg-muted">
              {plate} · {formatStamp(result.submittedAt)}
            </p>
          </div>
          <div className="grid w-full grid-cols-3 gap-2">
            <Stat label="Itens" value={result.itemCount} tone="neutral" />
            <Stat label="NOK" value={result.nokCount} tone={result.nokCount > 0 ? "danger" : "neutral"} />
            <Stat label="Fotos" value={result.evidenceCount} tone="neutral" />
          </div>
          {result.duplicate ? (
            <p className="text-caption text-fg-secondary">Este envio já havia chegado antes; o protocolo é o mesmo e nada foi duplicado.</p>
          ) : null}
          <p className="flex items-start gap-2 text-left text-body-sm text-fg-secondary">
            <ShieldCheck className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
            A vistoria foi enviada para validação da Segurança; o estado oficial dos componentes só muda após a validação.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Button size="lg" className="h-14" leadingIcon={<Plus />} onClick={() => onFinished("new")}>
            Nova vistoria
          </Button>
          <Button size="lg" variant="secondary" className="h-14" leadingIcon={<History />} onClick={() => onFinished("history")}>
            Minhas vistorias
          </Button>
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------- review
  if (phase === "review") {
    const v = draft.vehicle;
    const place = [v.cityName, v.stateUf].filter(Boolean).join("/");
    return (
      <div className="flex flex-col gap-4" data-testid="mtsr-app-review-screen">
        <AppTopBar label="Revisão" answered={stats.answered} total={stats.total} onBack={() => setPhase("items")} />
        <header className="flex flex-col gap-1">
          <h2 className="text-h3 font-semibold text-fg">Revisão</h2>
          <p className="text-body-sm text-fg-secondary">Confira antes de enviar. Você ainda pode voltar e corrigir.</p>
        </header>

        {error ? (
          <Alert variant="danger">
            <AlertTitle>Não foi possível enviar</AlertTitle>
            <AlertDescription>{error} Suas respostas e fotos continuam salvas neste aparelho — tente de novo quando a conexão voltar.</AlertDescription>
          </Alert>
        ) : null}

        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 rounded-lg border border-border bg-surface-raised p-4 shadow-card">
          <Field label="Placa" value={v.licensePlate} />
          <Field label="Frota" value={v.fleetCode ?? "—"} />
          <Field label="Tipo" value={v.vehicleTypeName ?? "—"} />
          <Field label="Operação" value={[v.operationName, place].filter(Boolean).join(" · ") || "—"} />
          <Field label="Vistoriador" value={context.actor.name ?? "—"} />
          <Field label="Início" value={formatStamp(draft.startedAt)} />
        </dl>

        <div className="grid grid-cols-3 gap-2">
          <Stat label="OK" value={stats.ok} tone="success" />
          <Stat label="NOK" value={stats.nok} tone={stats.nok > 0 ? "danger" : "neutral"} />
          <Stat label="Fotos" value={stats.photos} tone="neutral" />
        </div>

        <div className="overflow-hidden rounded-lg border border-border bg-surface-raised shadow-card">
          <p className="border-b border-border bg-surface-secondary px-4 py-2 text-caption font-semibold uppercase tracking-wide text-fg-muted">Itens da vistoria</p>
          <ul className="divide-y divide-border">
            {components.map((c) => {
              const a = answers[c.id] ?? emptyAnswer();
              return (
                <li key={c.id} className="flex flex-col gap-1 px-4 py-2.5" data-testid={`mtsr-app-review-item-${c.code}`}>
                  <div className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-body-sm font-medium text-fg">{c.name}</span>
                    <span className="text-caption tabular-nums text-fg-muted">
                      {fmtInt(a.evidence.length)} {a.evidence.length === 1 ? "foto" : "fotos"}
                    </span>
                    <StatusBadge status={a.status === "nok" ? "danger" : "success"} size="sm">
                      {a.status === "nok" ? "NOK" : "OK"}
                    </StatusBadge>
                  </div>
                  {a.observation.trim() ? <p className="text-caption text-fg-secondary">{a.observation.trim()}</p> : null}
                </li>
              );
            })}
          </ul>
        </div>

        <FormField id="mtsr-general-observation" label="Observação geral" labelHint="Opcional">
          <Textarea
            id="mtsr-general-observation"
            autoResize
            minRows={2}
            maxLength={2000}
            value={generalObservation}
            disabled={sending}
            placeholder="Algo sobre a vistoria como um todo que ajude a Segurança a validar."
            onChange={(e) => setGeneralObservation(e.target.value)}
          />
        </FormField>

        <Alert variant="info">
          <AlertDescription>A vistoria será enviada para validação da Segurança. O estado oficial dos componentes só muda após a validação.</AlertDescription>
        </Alert>

        <div className="grid grid-cols-2 gap-2 pb-2">
          <Button size="lg" variant="secondary" className="h-14" leadingIcon={<ArrowLeft />} onClick={() => setPhase("items")} disabled={sending}>
            Voltar
          </Button>
          <Button size="lg" className="h-14" leadingIcon={<Send />} onClick={send} loading={sending} data-testid="mtsr-app-submit">
            Enviar vistoria
          </Button>
        </div>
      </div>
    );
  }

  // ----------------------------------------------------------------- items
  if (components.length === 0) {
    return (
      <div className="flex flex-col gap-4" data-testid="mtsr-app-items">
        <AppTopBar label={`Vistoria · ${plate}`} onBack={onCancel} />
        <EmptyState
          variant="panel"
          icon={<ClipboardCheck />}
          title="Nenhum componente de campo"
          description="Nenhum componente de campo ativo foi cadastrado para a vistoria. Fale com a Segurança antes de continuar."
          action={<Button variant="secondary" onClick={onCancel}>Voltar</Button>}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4" data-testid="mtsr-app-items">
      <AppTopBar label={`Vistoria · ${plate}`} answered={stats.answered} total={stats.total} onBack={onCancel} />
      <header className="flex flex-col gap-1">
        <span className="text-caption text-fg-muted">{vehicleLine(draft)}</span>
        <h2 className="text-h3 font-semibold text-fg">Componentes de campo</h2>
        <p className="text-body-sm text-fg-secondary">Registre OK ou NOK em cada componente. Foto e observação seguem a regra de cada item.</p>
      </header>

      {highlight && stats.pending.length > 0 ? (
        <Alert variant="danger" data-testid="mtsr-app-pending">
          <AlertTitle>
            {stats.pending.length === 1 ? "1 item pendente" : `${fmtInt(stats.pending.length)} itens pendentes`}
          </AlertTitle>
          <AlertDescription>
            <ul className="list-disc pl-4">
              {stats.pending.map((p) => (
                <li key={p.component.id}>
                  {p.component.name}: {p.issues.join(", ").toLowerCase()}
                </li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      ) : null}
      {error ? (
        <Alert variant="warning">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <ol className="flex flex-col gap-3">
        {components.map((component, index) => (
          <ItemCard
            key={component.id}
            component={component}
            index={index + 1}
            answer={answers[component.id] ?? emptyAnswer()}
            highlight={highlight}
            disabled={sending}
            onStatus={(status) => updateAnswer(component.id, { status })}
            onObservation={(observation) => updateAnswer(component.id, { observation })}
            onEvidence={(refs, p) => onEvidence(component.id, refs, p)}
            clientSubmissionId={draft.clientSubmissionId}
            config={context.evidence}
            loaders={loaders}
            preview={preview}
          />
        ))}
      </ol>

      {context.backofficeComponents.length > 0 ? (
        <Alert variant="neutral" data-testid="mtsr-app-backoffice-notice">
          <AlertTitle>Verificados pelo backoffice (não entram na vistoria)</AlertTitle>
          <AlertDescription>
            {context.backofficeComponents.join(", ")}. O estado desses componentes vem das integrações e do backoffice da Segurança.
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="sticky bottom-0 -mx-4 flex gap-2 border-t border-border bg-surface-raised/95 px-4 py-3 backdrop-blur sm:mx-0 sm:rounded-lg sm:border sm:shadow-card">
        <Button size="lg" variant="ghost" className="h-14" leadingIcon={<ArrowLeft />} onClick={onCancel} disabled={sending}>
          Sair
        </Button>
        <Button size="lg" className="h-14 flex-1" trailingIcon={<ClipboardCheck />} onClick={goReview} data-testid="mtsr-app-review">
          Revisar ({fmtInt(stats.answered)} de {fmtInt(stats.total)})
        </Button>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

const toggleBase =
  "flex h-14 items-center justify-center gap-2 rounded-md border text-body font-semibold hfm-transition hfm-focus-ring disabled:pointer-events-none disabled:opacity-55";
const toggleIdle = "border-border bg-surface-raised text-fg-secondary shadow-xs hover:border-border-strong";

function ItemCard({
  component,
  index,
  answer,
  highlight,
  disabled,
  onStatus,
  onObservation,
  onEvidence,
  clientSubmissionId,
  config,
  loaders,
  preview,
}: {
  component: MtsrAppComponent;
  index: number;
  answer: ItemAnswer;
  highlight: boolean;
  disabled: boolean;
  onStatus: (status: "ok" | "nok") => void;
  onObservation: (value: string) => void;
  onEvidence: (refs: EvidenceRef[], progress: EvidenceProgress) => void;
  clientSubmissionId: string;
  config: MtsrAppContext["evidence"];
  loaders: EvidenceLoaders;
  preview: boolean;
}) {
  const issues = itemIssues(component, answer);
  const invalid = highlight && issues.length > 0;
  const needsObservation = answer.status === "nok" && component.observationRequiredWhenNok;
  const observationMissing = needsObservation && answer.observation.trim() === "";
  const photoRule = photoRuleLabel(component);
  const photoRequired = answer.status === "ok" ? component.evidenceRequiredWhenOk : answer.status === "nok" ? component.evidenceRequiredWhenNok : false;
  const observationId = `mtsr-obs-${component.id}`;

  return (
    <li
      data-testid={`mtsr-app-item-${component.code}`}
      data-status={answer.status ?? "pendente"}
      className={cn(
        "flex flex-col gap-3 rounded-lg border bg-surface-raised p-4 shadow-card hfm-transition",
        invalid ? "border-danger" : answer.status === "nok" ? "border-warning" : "border-border",
      )}
    >
      <div className="flex items-start gap-2">
        <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-surface-secondary text-caption font-semibold tabular-nums text-fg-muted">
          {index}
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-body font-semibold text-fg">{component.name}</h3>
          {component.description ? <p className="mt-0.5 text-body-sm text-fg-secondary">{component.description}</p> : null}
        </div>
      </div>

      {photoRule || component.observationRequiredWhenNok ? (
        <div className="flex flex-wrap gap-1.5">
          {photoRule ? (
            <Badge variant="warning" appearance="soft" size="sm" icon={<Camera />}>
              {photoRule}
            </Badge>
          ) : null}
          {component.observationRequiredWhenNok ? (
            <Badge variant="neutral" appearance="soft" size="sm">
              Observação obrigatória em NOK
            </Badge>
          ) : null}
        </div>
      ) : null}

      <div role="group" aria-label={`Resultado de ${component.name}`} className="grid grid-cols-2 gap-2">
        <button
          type="button"
          aria-pressed={answer.status === "ok"}
          data-testid={`mtsr-app-ok-${component.code}`}
          disabled={disabled}
          onClick={() => onStatus("ok")}
          className={cn(toggleBase, answer.status === "ok" ? "border-success bg-success text-success-fg" : toggleIdle)}
        >
          <Check className="size-5" aria-hidden />
          OK
        </button>
        <button
          type="button"
          aria-pressed={answer.status === "nok"}
          data-testid={`mtsr-app-nok-${component.code}`}
          disabled={disabled}
          onClick={() => onStatus("nok")}
          className={cn(toggleBase, answer.status === "nok" ? "border-danger bg-danger text-danger-fg" : toggleIdle)}
        >
          <X className="size-5" aria-hidden />
          NOK
        </button>
      </div>

      {answer.status === "nok" ? (
        <p className="flex items-start gap-1.5 text-caption text-fg-secondary">
          <AlertTriangle className="mt-px size-3.5 shrink-0 text-warning" aria-hidden />
          NOK registrado. A Segurança valida a vistoria antes de o estado oficial do componente mudar.
        </p>
      ) : null}

      {answer.status !== null ? (
        <EvidenceCapture
          componentId={component.id}
          componentCode={component.code}
          componentName={component.name}
          clientSubmissionId={clientSubmissionId}
          config={config}
          evidence={answer.evidence}
          onChange={onEvidence}
          required={photoRequired}
          highlight={highlight}
          disabled={disabled}
          loaders={loaders}
          preview={preview}
        />
      ) : null}

      <FormField
        id={observationId}
        label="Observação"
        labelHint={needsObservation ? "Obrigatória em NOK" : "Opcional"}
        required={needsObservation}
        error={highlight && observationMissing ? "Descreva o problema encontrado para registrar o NOK." : undefined}
      >
        <Textarea
          id={observationId}
          autoResize
          minRows={needsObservation ? 2 : 1}
          maxLength={2000}
          value={answer.observation}
          disabled={disabled}
          placeholder={needsObservation ? "O que foi encontrado? Ajude quem vai tratar o item." : "Algo que ajude a validação."}
          onChange={(e) => onObservation(e.target.value)}
        />
      </FormField>

      {invalid ? (
        <p className="text-caption font-medium text-danger" role="alert">
          Pendente: {issues.join(" · ")}.
        </p>
      ) : null}
    </li>
  );
}

/** Barra fixa do aplicativo: voltar, rótulo e (quando há) andamento. */
export function AppTopBar({ label, onBack, answered, total }: { label: string; onBack: () => void; answered?: number; total?: number }) {
  const pct = total ? Math.round(((answered ?? 0) / total) * 100) : null;
  return (
    <div className="sticky top-(--topbar-height) z-10 -mx-4 flex items-center gap-2 border-b border-border bg-surface-raised/95 px-3 py-2 backdrop-blur sm:mx-0 sm:rounded-lg sm:border sm:shadow-card">
      <button
        type="button"
        onClick={onBack}
        aria-label="Voltar"
        className="flex size-11 shrink-0 items-center justify-center rounded-md text-fg-secondary hfm-transition hover:bg-hover-overlay hfm-focus-ring"
      >
        <ArrowLeft className="size-5" aria-hidden />
      </button>
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2 text-caption">
          <span className="truncate font-semibold text-fg">{label}</span>
          {pct !== null ? (
            <span className="shrink-0 tabular-nums text-fg-muted">
              {fmtInt(answered ?? 0)} de {fmtInt(total ?? 0)}
            </span>
          ) : null}
        </div>
        {pct !== null ? <Progress value={pct} className="mt-1" srLabel="Progresso da vistoria" /> : null}
      </div>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone: "success" | "danger" | "neutral" }) {
  return (
    <div className="min-w-0 rounded-lg border border-border bg-surface-raised px-2 py-3 text-center shadow-card sm:px-3">
      <p className={cn("text-h2 font-semibold tabular-nums", tone === "success" ? "text-success" : tone === "danger" ? "text-danger" : "text-fg")}>{fmtInt(value)}</p>
      <p className="text-caption font-medium text-fg-muted">{label}</p>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 flex-col">
      <dt className="text-caption text-fg-muted">{label}</dt>
      <dd className="truncate text-body-sm font-medium text-fg">{value}</dd>
    </div>
  );
}
