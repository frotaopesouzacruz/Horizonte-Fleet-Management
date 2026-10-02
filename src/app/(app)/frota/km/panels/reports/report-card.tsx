"use client";

import * as React from "react";
import { Check } from "lucide-react";
import { cn } from "@/lib/cn";

/**
 * Cartão de um relatório: o que é, o que contém e as saídas disponíveis.
 */
export interface ReportCardProps {
  icon: React.ReactNode;
  title: string;
  description: string;
  contents: string[];
  actions?: React.ReactNode;
  /** Aviso de permissão ou de origem do arquivo. */
  note?: React.ReactNode;
  testId: string;
  className?: string;
}

export function ReportCard({ icon, title, description, contents, actions, note, testId, className }: ReportCardProps) {
  const headingId = React.useId();
  return (
    <section
      aria-labelledby={headingId}
      className={cn("flex min-w-0 flex-col rounded-lg border border-border bg-surface-raised shadow-card", className)}
      data-testid={testId}
    >
      <header className="flex items-start gap-3 p-4 pb-3">
        <span
          aria-hidden
          className="flex size-9 shrink-0 items-center justify-center rounded-md bg-primary-soft text-primary-soft-fg [&_svg]:size-4.5"
        >
          {icon}
        </span>
        <div className="flex min-w-0 flex-col gap-0.5">
          <h3 id={headingId} className="text-card-title font-semibold text-fg">{title}</h3>
          <p className="text-body-sm text-fg-muted">{description}</p>
        </div>
      </header>
      <div className="flex flex-1 flex-col gap-3 px-4 pb-4">
        <ul aria-label={`Conteúdo: ${title}`} className="flex flex-col gap-1">
          {contents.map((c) => (
            <li key={c} className="flex items-start gap-2 text-body-sm text-fg-secondary">
              <Check aria-hidden className="mt-0.5 size-3.5 shrink-0 text-success" />
              <span>{c}</span>
            </li>
          ))}
        </ul>
        {note ? <div className="rounded-md bg-surface-secondary px-3 py-2 text-caption text-fg-secondary">{note}</div> : null}
      </div>
      {actions ? (
        <footer className="flex flex-wrap items-center gap-2 border-t border-border-subtle px-4 py-3">{actions}</footer>
      ) : null}
    </section>
  );
}
