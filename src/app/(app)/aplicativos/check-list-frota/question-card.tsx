"use client";

import * as React from "react";
import { AlertTriangle, Check, Info, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { FormField } from "@/components/ui/form-field";
import type { ChecklistQuestion } from "@/lib/applications/queries";

export interface AnswerState {
  answer: "yes" | "no" | null;
  conditional: Record<string, string | string[]>;
  note: string;
}

export const emptyAnswer = (): AnswerState => ({ answer: null, conditional: {}, note: "" });

/** A resposta desta pergunta é uma inconformidade? §11, por pergunta. */
export function isNonConforming(question: ChecklistQuestion, state: AnswerState): boolean {
  return state.answer !== null && state.answer !== question.conformingAnswer;
}

/** O condicional está acionado e ainda não foi preenchido? */
export function conditionalPending(question: ChecklistQuestion, state: AnswerState): boolean {
  const c = question.conditional;
  if (!c || !c.isRequired || state.answer !== c.triggerAnswer) return false;
  const value = state.conditional[c.fieldKey];
  if (c.fieldType === "multi_select") return !Array.isArray(value) || value.length === 0;
  return typeof value !== "string" || value.trim() === "";
}

/**
 * Uma pergunta, um cartão (§37).
 *
 * SIM e NÃO são dois botões grandes, não um par de rádios: quem responde está
 * em pé ao lado do veículo, muitas vezes de luva e sob sol. O alvo de toque é
 * 56px — acima do mínimo de 44px do design system — porque errar o botão aqui
 * significa registrar uma inconformidade que não existe.
 *
 * Nenhum caminho deste cartão abre câmera, galeria ou anexo (§26). A
 * inconformidade se descreve em texto.
 */
export function QuestionCard({
  question,
  index,
  state,
  onChange,
  highlightPending,
}: {
  question: ChecklistQuestion;
  index: number;
  state: AnswerState;
  onChange: (next: AnswerState) => void;
  highlightPending: boolean;
}) {
  const nonConforming = isNonConforming(question, state);
  const pending = conditionalPending(question, state);
  const showConditional =
    question.conditional && state.answer === question.conditional.triggerAnswer;

  const setAnswer = (answer: "yes" | "no") =>
    onChange(
      // Trocar a resposta invalida o que o condicional anterior coletou (§25):
      // manter "farol esquerdo" depois de responder SIM guardaria um defeito
      // que a pessoa acabou de dizer que não existe.
      answer === state.answer
        ? state
        : { answer, conditional: {}, note: state.note },
    );

  const setConditional = (key: string, value: string | string[]) =>
    onChange({ ...state, conditional: { ...state.conditional, [key]: value } });

  return (
    <li
      className={cn(
        "flex flex-col gap-3 rounded-md border bg-surface p-4 hfm-transition",
        nonConforming
          ? question.criticality === "critica"
            ? "border-danger"
            : "border-warning"
          : "border-border",
        highlightPending && (state.answer === null || pending) && "border-danger",
      )}
    >
      <div className="flex items-start gap-2">
        <span className="mt-0.5 shrink-0 text-caption tabular-nums text-fg-muted">{index}</span>
        <p className="flex-1 text-body font-medium text-fg">{question.text}</p>
        {question.criticality === "critica" ? (
          <Badge variant="danger" appearance="soft" size="sm">
            Crítica
          </Badge>
        ) : null}
      </div>

      {question.guidance ? (
        <p className="flex items-start gap-1.5 rounded-sm bg-info-soft px-2.5 py-2 text-caption text-info-soft-fg">
          <Info className="mt-px size-3.5 shrink-0" aria-hidden />
          {question.guidance}
        </p>
      ) : null}

      <div
        role="radiogroup"
        aria-label={question.text}
        className="grid grid-cols-2 gap-2"
      >
        {(["yes", "no"] as const).map((value) => {
          const active = state.answer === value;
          const conforms = value === question.conformingAnswer;
          return (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => setAnswer(value)}
              className={cn(
                "flex h-14 items-center justify-center gap-2 rounded-md border text-body font-semibold hfm-transition hfm-focus-ring",
                active
                  ? conforms
                    ? "border-success bg-success text-success-fg"
                    : "border-danger bg-danger text-danger-fg"
                  : "border-border bg-surface text-fg-secondary hover:border-border-strong",
              )}
            >
              {value === "yes" ? <Check className="size-5" aria-hidden /> : <X className="size-5" aria-hidden />}
              {value === "yes" ? "SIM" : "NÃO"}
            </button>
          );
        })}
      </div>

      {nonConforming ? (
        <p className="flex items-center gap-1.5 text-caption text-warning-fg">
          <AlertTriangle className="size-3.5 shrink-0" aria-hidden />
          Inconformidade registrada{question.criticality === "critica" ? " — item crítico" : ""}.
        </p>
      ) : null}

      {showConditional && question.conditional ? (
        <ConditionalField
          conditional={question.conditional}
          value={state.conditional[question.conditional.fieldKey]}
          onChange={(v) => setConditional(question.conditional!.fieldKey, v)}
          invalid={highlightPending && pending}
        />
      ) : null}

      {question.allowsNote ? (
        <FormField
          label="Observação"
          labelHint="Opcional"
          id={`note-${question.id}`}
          className="pt-1"
        >
          <Textarea
            id={`note-${question.id}`}
            autoResize
            minRows={1}
            maxLength={2000}
            value={state.note}
            placeholder="Algo que ajude quem for tratar este item."
            onChange={(e) => onChange({ ...state, note: e.target.value })}
          />
        </FormField>
      ) : null}
    </li>
  );
}

function ConditionalField({
  conditional,
  value,
  onChange,
  invalid,
}: {
  conditional: NonNullable<ChecklistQuestion["conditional"]>;
  value: string | string[] | undefined;
  onChange: (value: string | string[]) => void;
  invalid: boolean;
}) {
  const id = `cond-${conditional.fieldKey}`;

  if (conditional.fieldType === "text") {
    return (
      <FormField
        label={conditional.label}
        required={conditional.isRequired}
        id={id}
        error={invalid ? "Descreva para poder concluir o checklist." : undefined}
      >
        <Textarea
          id={id}
          autoResize
          minRows={2}
          maxLength={2000}
          aria-invalid={invalid || undefined}
          value={typeof value === "string" ? value : ""}
          onChange={(e) => onChange(e.target.value)}
        />
      </FormField>
    );
  }

  const multi = conditional.fieldType === "multi_select";
  const selected = multi
    ? Array.isArray(value)
      ? value
      : []
    : typeof value === "string"
      ? [value]
      : [];

  const toggle = (option: string) => {
    if (!multi) return onChange(option);
    onChange(
      selected.includes(option)
        ? selected.filter((v) => v !== option)
        : [...selected, option],
    );
  };

  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="text-label font-medium text-fg">
        {conditional.label}
        {conditional.isRequired ? <span className="text-danger"> *</span> : null}
      </legend>
      <div className="grid grid-cols-2 gap-2">
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
                "flex min-h-12 items-center justify-center rounded-md border px-3 text-body-sm font-medium hfm-transition hfm-focus-ring",
                active
                  ? "border-primary bg-primary-soft text-primary-soft-fg"
                  : "border-border bg-surface text-fg-secondary hover:border-border-strong",
                invalid && "border-danger",
              )}
            >
              {option.label}
            </button>
          );
        })}
      </div>
      {invalid ? (
        <p className="text-caption text-danger">
          {multi ? "Escolha ao menos uma opção." : "Escolha uma opção."}
        </p>
      ) : null}
    </fieldset>
  );
}
