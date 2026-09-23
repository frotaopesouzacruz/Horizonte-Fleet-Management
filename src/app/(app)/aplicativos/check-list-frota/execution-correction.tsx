"use client";

import * as React from "react";
import { Check, Lock, PenLine, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { DrawerBody, DrawerFooter } from "@/components/ui/drawer";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CheckboxField } from "@/components/ui/checkbox";
import { FormField } from "@/components/ui/form-field";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription, AlertTitle } from "@/components/feedback/alert";
import { ConfirmDialog } from "@/components/feedback/confirm-dialog";
import { Skeleton } from "@/components/feedback/skeleton";
import { loadCorrectionForm, runExecutionCorrection } from "@/lib/applications/correction-actions";
import {
  ANSWER_TEXT, NOTE_MAX, REASON_MAX, REASON_MIN, checkDraft, checkReason, draftFrom, situationText,
  type CorrectableAnswer, type CorrectionDraft, type CorrectionForm, type CorrectionInput, type CorrectionResult,
} from "@/lib/applications/correction-model";
import type { ChecklistConditional } from "@/lib/applications/queries";
import type { ExecutionDetail } from "@/lib/applications/history-queries";
import { CorrectionDiffList, SummaryDiff } from "./correction-history";

interface Result<T> {
  ok: boolean;
  error?: string;
  data?: T;
}

/** Tudo o que a correção pede ao servidor — injetável para a prévia e os testes. */
export interface CorrectionLoaders {
  loadForm: (executionId: string) => Promise<Result<CorrectionForm>>;
  run: (input: CorrectionInput) => Promise<Result<CorrectionResult>>;
}

const DEFAULT_LOADERS: CorrectionLoaders = { loadForm: loadCorrectionForm, run: runExecutionCorrection };

const TYPE_LABEL = { saida: "Saída para rota", retorno: "Retorno de rota" } as const;

function formatDate(value: string): string {
  const [y, m, d] = value.slice(0, 10).split("-");
  return d ? `${d}/${m}/${y}` : value;
}

export interface ExecutionCorrectionProps {
  detail: ExecutionDetail;
  loaders?: CorrectionLoaders;
  onCancel: () => void;
  onDone: (result: CorrectionResult) => void;
}

/**
 * Corrigir execução (§60) — o procedimento administrativo, dentro do detalhe.
 *
 * Editar → revisar (antes/depois e resumo, calculados pela MESMA rotina que
 * grava, em modo prévia) → confirmar. Só respostas, campos condicionais e
 * observações; a identidade da execução aparece trancada e não é enviada.
 * Nada aqui abre câmera, galeria ou anexo (§26).
 */
export function ExecutionCorrection({ detail, loaders = DEFAULT_LOADERS, onCancel, onDone }: ExecutionCorrectionProps) {
  const [form, setForm] = React.useState<CorrectionForm | null>(null);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [drafts, setDrafts] = React.useState<Record<string, CorrectionDraft>>({});
  const [reason, setReason] = React.useState("");
  const [showErrors, setShowErrors] = React.useState(false);
  const [serverError, setServerError] = React.useState<string | null>(null);
  const [preview, setPreview] = React.useState<CorrectionResult | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const bodyRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    let cancelled = false;
    loaders
      .loadForm(detail.id)
      .then((result) => {
        if (cancelled) return;
        if (result.ok && result.data) setForm(result.data);
        else setLoadError(result.error ?? "Não foi possível abrir a correção.");
      })
      .catch(() => {
        if (!cancelled) setLoadError("Não foi possível abrir a correção.");
      });
    return () => {
      cancelled = true;
    };
  }, [detail.id, loaders]);

  const answers = React.useMemo(
    () => new Map((form?.clusters ?? []).flatMap((c) => c.answers.map((a) => [a.questionId, a] as const))),
    [form],
  );

  const checks = React.useMemo(
    () =>
      Object.entries(drafts).flatMap(([questionId, draft]) => {
        const answer = answers.get(questionId);
        return answer ? [{ answer, ...checkDraft(answer, draft) }] : [];
      }),
    [drafts, answers],
  );

  const reasonError = checkReason(reason);
  const selectedCount = checks.length;
  const itemErrors = checks.filter((c) => c.error);

  const toggle = (a: CorrectableAnswer, on: boolean) => {
    setServerError(null);
    setDrafts((current) => {
      const next = { ...current };
      if (on) next[a.questionId] = draftFrom(a);
      else delete next[a.questionId];
      return next;
    });
  };

  const update = (questionId: string, draft: CorrectionDraft) => {
    setServerError(null);
    setDrafts((current) => ({ ...current, [questionId]: draft }));
  };

  const input = (dryRun: boolean): CorrectionInput => ({
    executionId: detail.id,
    reason: reason.trim(),
    items: checks.map((c) => c.item),
    dryRun,
  });

  const withConditionals = (result: CorrectionResult): CorrectionResult => ({
    ...result,
    items: result.items.map((item) => {
      const c = answers.get(item.questionId)?.conditional;
      return c ? { ...item, conditional: { label: c.label, options: c.options } } : item;
    }),
  });

  const review = async () => {
    setShowErrors(true);
    setServerError(null);
    if (selectedCount === 0 || itemErrors.length > 0 || reasonError) {
      bodyRef.current?.querySelector<HTMLElement>("[data-correction-error]")?.scrollIntoView({ block: "center" });
      return;
    }
    setBusy(true);
    try {
      const result = await loaders.run(input(true));
      if (result.ok && result.data) {
        setPreview(withConditionals(result.data));
        bodyRef.current?.scrollIntoView({ block: "start" });
      } else {
        setServerError(result.error ?? "Não foi possível preparar a prévia.");
      }
    } catch {
      setServerError("Não foi possível preparar a prévia.");
    } finally {
      setBusy(false);
    }
  };

  const confirm = async () => {
    try {
      const result = await loaders.run(input(false));
      if (result.ok && result.data) {
        setConfirmOpen(false);
        onDone(withConditionals(result.data));
        return;
      }
      setServerError(result.error ?? "Não foi possível registrar a correção.");
    } catch {
      setServerError("Não foi possível registrar a correção.");
    }
    setConfirmOpen(false);
    setPreview(null);
  };

  return (
    <>
      <DrawerBody data-testid="execution-correction">
        <div ref={bodyRef} className="flex flex-col gap-4">
          {serverError ? (
            <Alert variant="danger">
              <AlertTitle>A correção não foi aceita</AlertTitle>
              <AlertDescription>{serverError}</AlertDescription>
            </Alert>
          ) : null}

          {preview ? (
            <section aria-labelledby="correction-review-title" className="flex flex-col gap-4">
              <div className="flex flex-col gap-1">
                <h3 id="correction-review-title" className="text-h4 font-semibold text-fg">
                  Revise antes de confirmar
                </h3>
                <p className="text-body-sm text-fg-secondary">
                  {preview.items.length === 1 ? "1 item será corrigido." : `${preview.items.length} itens serão corrigidos.`}{" "}
                  O resumo de conformidade é recalculado pela resposta conforme de cada pergunta.
                </p>
              </div>
              <SummaryDiff before={preview.summaryBefore} after={preview.summaryAfter} />
              <CorrectionDiffList items={preview.items} />
              <div className="flex min-w-0 flex-col gap-0.5 rounded-md border border-border bg-surface-secondary p-3">
                <p className="text-caption text-fg-muted">Motivo</p>
                <p className="whitespace-pre-line break-words text-body-sm text-fg">{reason.trim()}</p>
              </div>
              <Alert variant="warning">
                <AlertDescription>
                  Ao confirmar, a correção fica registrada com o seu nome, a data e a hora, o motivo e os
                  valores anteriores. Ela não se desfaz: uma nova correção entra como um novo registro.
                </AlertDescription>
              </Alert>
            </section>
          ) : (
            <>
              <Alert variant="info" icon={<PenLine />}>
                <AlertTitle>Correção administrativa</AlertTitle>
                <AlertDescription>
                  Corrija só respostas, campos condicionais e observações. Quem corrigiu, quando, o motivo e o
                  valor anterior de cada item ficam registrados — nada é apagado.
                </AlertDescription>
              </Alert>

              <section
                aria-labelledby="correction-identity-title"
                className="flex min-w-0 flex-col gap-2 rounded-md border border-border bg-surface-secondary p-3"
              >
                <h3 id="correction-identity-title" className="flex items-center gap-1.5 text-label font-semibold text-fg">
                  <Lock className="size-3.5 shrink-0" aria-hidden />
                  Não corrigível por este procedimento
                </h3>
                <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-body-sm sm:grid-cols-3">
                  {[
                    ["Placa", [detail.licensePlate, detail.fleetCode].filter(Boolean).join(" · ") || "—"],
                    ["Data", formatDate(detail.operationalDate)],
                    ["Tipo", TYPE_LABEL[detail.checklistType]],
                    ["Operação", detail.operationName],
                    ["BR", detail.brCode ?? "—"],
                    ["Colaborador", detail.employeeName ?? "—"],
                  ].map(([label, value]) => (
                    <div key={label} className="flex min-w-0 flex-col">
                      <dt className="text-caption text-fg-muted">{label}</dt>
                      <dd className="truncate text-fg">{value}</dd>
                    </div>
                  ))}
                </dl>
                <p className="text-caption text-fg-muted">
                  Veículo, data, tipo (saída/retorno), operação e BR definem a conciliação com a Aderência e não são
                  alterados aqui.
                </p>
              </section>

              {loadError ? (
                <Alert variant="danger">
                  <AlertDescription>{loadError}</AlertDescription>
                </Alert>
              ) : !form ? (
                <div className="flex flex-col gap-2" aria-busy>
                  <Skeleton className="h-14 w-full" />
                  <Skeleton className="h-14 w-full" />
                  <Skeleton className="h-14 w-full" />
                </div>
              ) : (
                <section aria-labelledby="correction-items-title" className="flex flex-col gap-3">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <h3 id="correction-items-title" className="text-label font-semibold text-fg">
                      Itens a corrigir
                    </h3>
                    <span className="text-caption tabular-nums text-fg-muted" aria-live="polite">
                      {selectedCount === 1 ? "1 selecionado" : `${selectedCount} selecionados`}
                    </span>
                  </div>
                  {showErrors && selectedCount === 0 ? (
                    <p data-correction-error role="alert" className="text-body-sm text-danger">
                      Escolha ao menos um item para corrigir.
                    </p>
                  ) : null}
                  {form.clusters.map((cluster) => (
                    <section key={cluster.clusterKey} aria-label={cluster.name} className="flex flex-col gap-2">
                      <h4 className="text-caption font-semibold tracking-wide text-fg-secondary uppercase">
                        {cluster.name}
                      </h4>
                      <ul className="flex flex-col gap-2">
                        {cluster.answers.map((a) => {
                          const draft = drafts[a.questionId];
                          const check = draft ? checks.find((c) => c.answer.questionId === a.questionId) : undefined;
                          return (
                            <CorrectionRow
                              key={a.questionId}
                              answer={a}
                              draft={draft}
                              error={showErrors ? (check?.error ?? null) : null}
                              onToggle={(on) => toggle(a, on)}
                              onChange={(d) => update(a.questionId, d)}
                            />
                          );
                        })}
                      </ul>
                    </section>
                  ))}
                </section>
              )}

              <FormField
                label="Motivo da correção"
                required
                id="correction-reason"
                helperText={`Explique o que estava errado e como foi confirmado. Entre ${REASON_MIN} e ${REASON_MAX} caracteres.`}
                error={showErrors && reasonError ? reasonError : undefined}
              >
                <Textarea
                  autoResize
                  minRows={3}
                  maxLength={REASON_MAX}
                  value={reason}
                  data-correction-error={showErrors && reasonError ? "" : undefined}
                  onChange={(e) => {
                    setServerError(null);
                    setReason(e.target.value);
                  }}
                />
              </FormField>
            </>
          )}
        </div>
      </DrawerBody>

      <DrawerFooter className="sm:items-center sm:justify-between">
        <p className="hidden text-caption text-fg-muted sm:block">
          {preview ? "Confira o antes e o depois." : "A correção passa por revisão antes de ser registrada."}
        </p>
        <div className="flex flex-col-reverse gap-2 sm:flex-row">
          {preview ? (
            <>
              <Button variant="secondary" onClick={() => setPreview(null)}>
                Voltar e editar
              </Button>
              <Button onClick={() => setConfirmOpen(true)}>Confirmar correção</Button>
            </>
          ) : (
            <>
              <Button variant="secondary" onClick={onCancel} disabled={busy}>
                Cancelar
              </Button>
              <Button onClick={review} loading={busy} disabled={!form}>
                Revisar correção
              </Button>
            </>
          )}
        </div>
      </DrawerFooter>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Registrar a correção administrativa?"
        description={
          preview
            ? `${preview.items.length === 1 ? "1 item" : `${preview.items.length} itens`} deste checklist passam a valer com a correção. O valor anterior, o motivo, o seu nome e a data ficam no histórico.`
            : undefined
        }
        confirmLabel="Registrar correção"
        onConfirm={confirm}
      />
    </>
  );
}

// ---------------------------------------------------------------------------
// Uma pergunta
// ---------------------------------------------------------------------------

function CorrectionRow({
  answer, draft, error, onToggle, onChange,
}: {
  answer: CorrectableAnswer;
  draft: CorrectionDraft | undefined;
  error: string | null;
  onToggle: (on: boolean) => void;
  onChange: (draft: CorrectionDraft) => void;
}) {
  const selected = Boolean(draft);
  const current = `Atual: ${ANSWER_TEXT[answer.answer]} · ${situationText(answer.isConforming, answer.criticality)}`;
  const showConditional = draft && answer.conditional && draft.answer === answer.conditional.triggerAnswer;

  const setAnswer = (value: "yes" | "no") => {
    if (!draft || value === draft.answer) return;
    // §25: trocar a resposta descarta o que o condicional coletou; voltar à
    // resposta original devolve o valor gravado, para não parecer mudança.
    onChange({
      ...draft,
      answer: value,
      conditional: value === answer.answer ? { ...(answer.conditionalValue ?? {}) } : {},
    });
  };

  return (
    <li
      className={cn(
        "flex min-w-0 flex-col rounded-md border bg-surface p-2 hfm-transition",
        selected ? "border-primary/60" : "border-border",
        error && "border-danger",
      )}
    >
      <CheckboxField
        checked={selected}
        onCheckedChange={(v) => onToggle(v === true)}
        label={<span className="break-words">{answer.text}</span>}
        description={
          <span className="flex flex-wrap items-center gap-1.5">
            {current}
            {answer.criticality === "critica" ? <Badge variant="danger" appearance="soft" size="sm">Crítica</Badge> : null}
          </span>
        }
      />

      {draft ? (
        <div className="flex min-w-0 flex-col gap-3 px-1.5 pt-1 pb-2 sm:pl-8">
          <div role="radiogroup" aria-label={`Nova resposta: ${answer.text}`} className="grid grid-cols-2 gap-2">
            {(["yes", "no"] as const).map((value) => {
              const active = draft.answer === value;
              const conforms = value === answer.conformingAnswer;
              return (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => setAnswer(value)}
                  className={cn(
                    "flex h-12 items-center justify-center gap-2 rounded-md border text-body font-semibold hfm-transition hfm-focus-ring",
                    active
                      ? conforms
                        ? "border-success bg-success text-success-fg"
                        : "border-danger bg-danger text-danger-fg"
                      : "border-border bg-surface text-fg-secondary hover:border-border-strong",
                  )}
                >
                  {value === "yes" ? <Check className="size-4" aria-hidden /> : <X className="size-4" aria-hidden />}
                  {ANSWER_TEXT[value]}
                </button>
              );
            })}
          </div>
          <p className="text-caption text-fg-secondary">
            Passa a: {situationText(draft.answer === answer.conformingAnswer, answer.criticality)}
            {draft.answer !== answer.answer ? " (resposta alterada)" : ""}
          </p>

          {showConditional && answer.conditional ? (
            <ConditionalEditor
              questionId={answer.questionId}
              conditional={answer.conditional}
              value={draft.conditional[answer.conditional.fieldKey]}
              onChange={(v) =>
                onChange({ ...draft, conditional: { [answer.conditional!.fieldKey]: v } })
              }
            />
          ) : null}

          {answer.allowsNote ? (
            <FormField label="Observação" labelHint="Opcional" id={`correction-note-${answer.questionId}`}>
              <Textarea
                autoResize
                minRows={1}
                maxLength={NOTE_MAX}
                value={draft.note}
                onChange={(e) => onChange({ ...draft, note: e.target.value })}
              />
            </FormField>
          ) : null}

          {error ? (
            <p data-correction-error role="alert" className="text-caption text-danger">
              {error}
            </p>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

function ConditionalEditor({
  questionId, conditional, value, onChange,
}: {
  questionId: string;
  conditional: ChecklistConditional;
  value: string | string[] | undefined;
  onChange: (value: string | string[]) => void;
}) {
  const id = `correction-cond-${questionId}`;

  if (conditional.fieldType === "text") {
    return (
      <FormField label={conditional.label} required={conditional.isRequired} id={id}>
        <Textarea
          autoResize
          minRows={2}
          maxLength={NOTE_MAX}
          value={typeof value === "string" ? value : ""}
          onChange={(e) => onChange(e.target.value)}
        />
      </FormField>
    );
  }

  const multi = conditional.fieldType === "multi_select";
  const selected = multi ? (Array.isArray(value) ? value : []) : typeof value === "string" ? [value] : [];
  const toggle = (option: string) => {
    if (!multi) return onChange(option);
    onChange(selected.includes(option) ? selected.filter((v) => v !== option) : [...selected, option]);
  };

  return (
    <fieldset className="flex min-w-0 flex-col gap-2">
      <legend className="mb-2 text-label font-medium text-fg">
        {conditional.label}
        {conditional.isRequired ? <span className="text-danger" aria-hidden> *</span> : null}
        {conditional.isRequired ? <span className="sr-only"> (obrigatório)</span> : null}
      </legend>
      <div className="grid grid-cols-2 gap-2" role={multi ? "group" : "radiogroup"} aria-label={conditional.label}>
        {conditional.options.map((option) => {
          const active = selected.includes(option.value);
          return (
            <button
              key={option.value}
              type="button"
              role={multi ? "checkbox" : "radio"}
              aria-checked={active}
              onClick={() => toggle(option.value)}
              className={cn(
                "flex min-h-11 items-center justify-center rounded-md border px-3 text-center text-body-sm font-medium hfm-transition hfm-focus-ring",
                active
                  ? "border-primary bg-primary-soft text-primary-soft-fg"
                  : "border-border bg-surface text-fg-secondary hover:border-border-strong",
              )}
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}
