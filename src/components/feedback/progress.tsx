"use client";

import * as React from "react";
import { cn } from "@/lib/cn";

/**
 * Progress — a thin determinate bar for work with a known end (uploads, batch
 * imports, checklist completion) and an indeterminate shimmer for work whose
 * duration is unknown. It is a readout, not a decoration: never taller than
 * 6px, never used to fill empty space.
 *
 * ```tsx
 * <Progress label="Importando veículos" value={62} showValue tone="primary" />
 * <Progress indeterminate srLabel="Sincronizando telemetria" />
 * ```
 */

export type ProgressTone = "primary" | "success" | "warning" | "danger" | "accent";
export type ProgressSize = "sm" | "md";

/** 4px / 6px — the bar stays a readout, never a slab. */
const trackSizes: Record<ProgressSize, string> = {
  sm: "h-1",
  md: "h-1.5",
};

const barTones: Record<ProgressTone, string> = {
  primary: "bg-primary",
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-danger",
  accent: "bg-accent",
};

const percentFormat = new Intl.NumberFormat("pt-BR", { style: "percent", maximumFractionDigits: 0 });

export interface ProgressProps extends Omit<React.HTMLAttributes<HTMLDivElement>, "children"> {
  /** Completion from 0 to 100. Ignored when `indeterminate`. */
  value?: number;
  /** Work with an unknown duration — renders the shimmer and drops `aria-valuenow`. */
  indeterminate?: boolean;
  tone?: ProgressTone;
  size?: ProgressSize;
  /** Visible label above the bar. */
  label?: React.ReactNode;
  /** Renders the percentage on the right of the label row. Ignored when `indeterminate`. */
  showValue?: boolean;
  /** Replaces the formatted percentage ("3 de 8 arquivos"). Implies `showValue`. */
  valueLabel?: React.ReactNode;
  /** Accessible name when there is no visible `label`. Defaults to "Progresso". */
  srLabel?: string;
}

export const Progress = React.forwardRef<HTMLDivElement, ProgressProps>(function Progress(
  {
    className,
    value = 0,
    indeterminate = false,
    tone = "primary",
    size = "md",
    label,
    showValue = false,
    valueLabel,
    srLabel = "Progresso",
    ...props
  },
  ref,
) {
  const labelId = React.useId();
  const percent = indeterminate ? 0 : Math.min(100, Math.max(0, Number.isFinite(value) ? value : 0));
  const formatted = percentFormat.format(percent / 100);
  // An indeterminate bar has no percentage: showing "0%" would be a lie. Only an
  // explicit `valueLabel` ("3 de 8 arquivos") still makes sense there.
  const readout = valueLabel ?? (showValue && !indeterminate ? formatted : null);
  const hasHeader = label != null || readout != null;
  // Keep the announced value and the visible readout telling the same story.
  const valueText = indeterminate ? undefined : typeof valueLabel === "string" ? valueLabel : formatted;

  return (
    <div ref={ref} className={cn("flex w-full flex-col gap-1.5", className)} {...props}>
      {hasHeader ? (
        <div className="flex items-baseline justify-between gap-2">
          {label != null ? (
            <span id={labelId} className="min-w-0 truncate text-label font-medium text-fg-secondary">
              {label}
            </span>
          ) : null}
          {readout != null ? (
            <span className="ml-auto shrink-0 text-caption tabular-nums text-fg-muted">{readout}</span>
          ) : null}
        </div>
      ) : null}

      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={indeterminate ? undefined : Math.round(percent)}
        aria-valuetext={valueText}
        aria-busy={indeterminate || undefined}
        aria-labelledby={label != null ? labelId : undefined}
        aria-label={label != null ? undefined : srLabel}
        className={cn("w-full overflow-hidden rounded-xs bg-surface-tertiary", trackSizes[size])}
      >
        {indeterminate ? (
          <div className="hfm-skeleton h-full w-full rounded-xs" />
        ) : (
          <div
            className={cn(
              "h-full rounded-xs transition-[width] duration-(--duration-base) ease-standard",
              barTones[tone],
            )}
            style={{ width: `${percent}%` }}
          />
        )}
      </div>
    </div>
  );
});
