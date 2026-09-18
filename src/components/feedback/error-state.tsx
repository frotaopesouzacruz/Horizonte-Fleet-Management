"use client";

import * as React from "react";
import { AlertTriangle, RotateCw } from "lucide-react";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";

/**
 * ErrorState — what a region says when the data did not arrive. The tone is
 * operational, never dramatic or apologetic: state the fact, state the next
 * action, and keep the technical payload folded away for support.
 *
 * - `inline` — one row inside a panel body or next to a control.
 * - `panel`  — replaces the body of a card/panel.
 * - `page`   — replaces the whole content area of a route.
 */

export type ErrorStateVariant = "inline" | "panel" | "page";

export interface ErrorStateProps extends Omit<React.HTMLAttributes<HTMLDivElement>, "title" | "children"> {
  variant?: ErrorStateVariant;
  /** Defaults to "Não foi possível carregar os dados." */
  title?: React.ReactNode;
  /** Defaults to "Verifique sua conexão e tente novamente." */
  description?: React.ReactNode;
  /** Adds the "Tentar novamente" button. */
  onRetry?: () => void;
  retryLabel?: string;
  /** Keeps the retry button busy while the refetch is in flight. */
  retrying?: boolean;
  /** Technical payload (message, request id, stack) folded into a `<details>`. */
  details?: React.ReactNode;
  detailsLabel?: string;
  /** Extra action next to the retry button (e.g. "Abrir chamado"). */
  action?: React.ReactNode;
  /** Overrides the default warning icon. */
  icon?: React.ReactNode;
  /**
   * Heading level for `title` on `panel`/`page`. Defaults to h3 (`panel`) and
   * h2 (`page`). `inline` stays a paragraph — it sits inside another block.
   */
  headingLevel?: 2 | 3 | 4;
}

export const ErrorState = React.forwardRef<HTMLDivElement, ErrorStateProps>(function ErrorState(
  {
    className,
    variant = "panel",
    title = "Não foi possível carregar os dados.",
    description = "Verifique sua conexão e tente novamente.",
    onRetry,
    retryLabel = "Tentar novamente",
    retrying = false,
    details,
    detailsLabel = "Detalhes técnicos",
    action,
    icon,
    headingLevel,
    ...props
  },
  ref,
) {
  const isInline = variant === "inline";
  const Heading = `h${headingLevel ?? (variant === "page" ? 2 : 3)}` as const;

  const retryButton = onRetry ? (
    <Button
      variant="outline"
      size={isInline ? "sm" : "md"}
      onClick={onRetry}
      loading={retrying}
      leadingIcon={<RotateCw aria-hidden />}
    >
      {retryLabel}
    </Button>
  ) : null;

  const detailsBlock = details ? (
    <details className={cn("w-full text-left", isInline ? "mt-1" : "mt-1 max-w-lg")}>
      <summary className="inline-flex cursor-pointer list-none items-center rounded-xs text-caption font-medium text-fg-muted hfm-transition hover:text-fg hfm-focus-ring [&::-webkit-details-marker]:hidden">
        {detailsLabel}
      </summary>
      <pre className="mt-1.5 max-h-40 overflow-auto rounded-sm border border-border-subtle bg-surface-secondary p-2 font-mono text-caption whitespace-pre-wrap text-fg-secondary">
        {details}
      </pre>
    </details>
  ) : null;

  if (isInline) {
    return (
      <div
        ref={ref}
        className={cn("flex w-full items-start gap-2 text-body-sm text-fg-secondary", className)}
        {...props}
      >
        <span className="mt-0.5 shrink-0 text-danger [&_svg]:size-4" aria-hidden>
          {icon ?? <AlertTriangle />}
        </span>
        {/* The live region holds the message only: an `alert` must not contain
            focusable controls, so the retry button stays outside it. */}
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div role="alert" className="flex flex-col gap-1">
            <p className="font-medium text-fg">{title}</p>
            {description != null ? <p className="text-fg-secondary">{description}</p> : null}
          </div>
          {detailsBlock}
        </div>
        {retryButton || action ? (
          <div className="flex shrink-0 items-center gap-2">
            {retryButton}
            {action}
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div
      ref={ref}
      className={cn(
        "flex w-full flex-col items-center justify-center gap-3 text-center",
        variant === "panel" && "rounded-md border border-border bg-surface px-6 py-10",
        variant === "page" && "px-6 py-16",
        className,
      )}
      {...props}
    >
      <span
        aria-hidden
        className="flex size-10 shrink-0 items-center justify-center rounded-md bg-danger-soft text-danger [&_svg]:size-5"
      >
        {icon ?? <AlertTriangle />}
      </span>

      {/* The live region wraps the message only — the retry button below must
          stay outside it, and the title is a real heading, not styled text. */}
      <div aria-live="polite" className="flex flex-col items-center gap-1">
        <Heading className={cn("font-semibold text-fg", variant === "page" ? "text-h2" : "text-h3")}>{title}</Heading>
        {description != null ? <p className="max-w-md text-body-sm text-fg-secondary">{description}</p> : null}
      </div>

      {retryButton || action ? (
        <div className="mt-1 flex flex-wrap items-center justify-center gap-2">
          {retryButton}
          {action}
        </div>
      ) : null}

      {detailsBlock}
    </div>
  );
});
