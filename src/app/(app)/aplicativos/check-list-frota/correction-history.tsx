"use client";

import * as React from "react";
import { ArrowRight } from "lucide-react";
import { cn } from "@/lib/cn";
import { Badge } from "@/components/ui/badge";
import {
  ANSWER_TEXT, FIELD_LABEL, conditionalText, situationText,
  type CorrectionField, type CorrectionItem, type CorrectionSnapshot, type CorrectionSummary,
  type ExecutionCorrection,
} from "@/lib/applications/correction-model";

/**
 * Antes → depois de uma correção administrativa (§60, §62).
 *
 * Os mesmos blocos servem à revisão (antes de confirmar) e ao histórico
 * (depois de registrado): o que a pessoa confirma é exatamente o que fica
 * escrito. Só aparecem os campos que mudaram. Sem anexo, sem foto (§26).
 */

/** "23/09/2026 14:02", no fuso da operação. */
export function formatWhen(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date
    .toLocaleString("pt-BR", {
      timeZone: "America/Sao_Paulo",
      day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit",
    })
    .replace(", ", " ");
}

function fieldValue(field: CorrectionField, snap: CorrectionSnapshot, item: CorrectionItem): string {
  switch (field) {
    case "answer":
      return `${ANSWER_TEXT[snap.answer]} · ${situationText(snap.isConforming, item.criticality)}`;
    case "conditional_value":
      return conditionalText(snap.conditionalValue, item.conditional) ?? "—";
    case "note":
      return snap.note ?? "sem observação";
  }
}

function fieldLabel(field: CorrectionField, item: CorrectionItem): string {
  if (field === "conditional_value" && item.conditional?.label) return item.conditional.label;
  return FIELD_LABEL[field];
}

/** Uma linha "rótulo: antes → depois", legível por leitor de tela. */
function DiffLine({ label, before, after }: { label: string; before: string; after: string }) {
  return (
    <div className="grid min-w-0 gap-0.5 sm:grid-cols-[minmax(0,9rem)_minmax(0,1fr)] sm:gap-3">
      <dt className="text-caption text-fg-muted">{label}</dt>
      <dd className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 text-body-sm">
        <span className="min-w-0 break-words text-fg-muted line-through decoration-fg-muted/60">
          <span className="sr-only">Antes: </span>
          {before}
        </span>
        <ArrowRight className="size-3.5 shrink-0 text-fg-muted" aria-hidden />
        <span className="min-w-0 break-words font-medium text-fg">
          <span className="sr-only">Depois: </span>
          {after}
        </span>
      </dd>
    </div>
  );
}

export function CorrectionDiffList({ items, className }: { items: CorrectionItem[]; className?: string }) {
  return (
    <ul className={cn("flex flex-col gap-2", className)}>
      {items.map((item) => (
        <li
          key={item.questionId || item.questionKey}
          className="flex min-w-0 flex-col gap-2 rounded-md border border-border bg-surface p-3"
        >
          <div className="flex min-w-0 flex-wrap items-start gap-2">
            <p className="min-w-0 flex-1 break-words text-body-sm font-medium text-fg">{item.questionText}</p>
            {item.criticality === "critica" ? (
              <Badge variant="danger" appearance="soft" size="sm">Crítica</Badge>
            ) : null}
          </div>
          <dl className="flex flex-col gap-1.5">
            {item.changedFields.map((field) => (
              <DiffLine
                key={field}
                label={fieldLabel(field, item)}
                before={fieldValue(field, item.before, item)}
                after={fieldValue(field, item.after, item)}
              />
            ))}
          </dl>
        </li>
      ))}
    </ul>
  );
}

/** Conformes, inconformes e críticas: antes → depois. */
export function SummaryDiff({ before, after }: { before: CorrectionSummary; after: CorrectionSummary }) {
  const rows: { label: string; b: number; a: number; tone: "success" | "warning" | "danger" }[] = [
    { label: "Conformes", b: before.conforming, a: after.conforming, tone: "success" },
    { label: "Inconformes", b: before.nonConforming, a: after.nonConforming, tone: "warning" },
    { label: "Críticas", b: before.criticalNonConforming, a: after.criticalNonConforming, tone: "danger" },
  ];
  return (
    <dl className="grid grid-cols-3 gap-2" aria-label="Resumo de conformidade antes e depois">
      {rows.map((row) => (
        <div
          key={row.label}
          className={cn(
            "flex min-w-0 flex-col gap-0.5 rounded-md border px-2.5 py-2",
            row.a !== row.b ? "border-border-strong bg-surface" : "border-border bg-surface-secondary",
          )}
        >
          <dt className="truncate text-caption text-fg-muted">{row.label}</dt>
          <dd className="flex flex-wrap items-center gap-1 text-body-sm tabular-nums">
            <span className="text-fg-muted">
              <span className="sr-only">Antes: </span>
              {row.b}
            </span>
            <ArrowRight className="size-3 shrink-0 text-fg-muted" aria-hidden />
            <span
              className={cn(
                "font-semibold",
                row.a === row.b
                  ? "text-fg"
                  : row.tone === "success"
                    ? "text-success-soft-fg"
                    : row.tone === "warning"
                      ? "text-warning-soft-fg"
                      : "text-danger",
              )}
            >
              <span className="sr-only">Depois: </span>
              {row.a}
            </span>
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** O histórico de correções de uma execução, a mais recente primeiro. */
export function CorrectionHistory({ corrections }: { corrections: ExecutionCorrection[] }) {
  return (
    <ol className="flex flex-col gap-3" aria-label="Histórico de correções">
      {corrections.map((c) => (
        <li key={c.id}>
          <article
            aria-label={`Correção ${c.sequence}`}
            className="flex min-w-0 flex-col gap-3 rounded-md border border-border bg-surface-secondary p-3 sm:p-4"
          >
            <header className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
              <Badge variant="info" appearance="soft" size="sm">Correção {c.sequence}</Badge>
              <span className="min-w-0 break-words text-body-sm font-medium text-fg">
                {c.correctedByName ?? "Autor não identificado"}
              </span>
              <span className="text-caption tabular-nums text-fg-muted">{formatWhen(c.correctedAt)}</span>
            </header>
            <div className="flex min-w-0 flex-col gap-0.5">
              <p className="text-caption text-fg-muted">Motivo</p>
              <p className="whitespace-pre-line break-words text-body-sm text-fg">{c.reason}</p>
            </div>
            <SummaryDiff before={c.summaryBefore} after={c.summaryAfter} />
            <CorrectionDiffList items={c.items} />
          </article>
        </li>
      ))}
    </ol>
  );
}
