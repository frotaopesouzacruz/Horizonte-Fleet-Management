"use client";

import * as React from "react";
import { AlertTriangle, CheckCircle2, Clock, Info, Minus, RefreshCw, XCircle, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/cn";
import { Badge, type BadgeAppearance, type BadgeSize, type BadgeVariant } from "@/components/ui/badge";

/** Semantic operational states. `pending` = waiting for someone/something; `progress` = actively running. */
export type StatusTone = "success" | "warning" | "danger" | "info" | "neutral" | "pending" | "progress";

export interface StatusToneConfig {
  /** Badge color variant used for this status. */
  variant: BadgeVariant;
  /** Icon shown when `withIcon` is set. */
  icon: LucideIcon;
  /** Solid dot color utility. */
  dotClassName: string;
  /** Text color utility for standalone icons. */
  textClassName: string;
  /** Screen-reader hint appended to the dot when it stands alone. */
  srLabel: string;
  /** Tinted surface and border for a header or band in this tone. */
  softClassName: string;
  /** Text color made for `softClassName`. */
  softForegroundClassName: string;
}

const STATUS_TONES: Record<StatusTone, StatusToneConfig> = {
  success: {
    variant: "success",
    icon: CheckCircle2,
    dotClassName: "bg-success",
    textClassName: "text-success",
    srLabel: "Situação: ok",
    softClassName: "bg-success-soft border-success-border",
    softForegroundClassName: "text-success-soft-fg",
  },
  warning: {
    variant: "warning",
    icon: AlertTriangle,
    dotClassName: "bg-warning",
    textClassName: "text-warning",
    srLabel: "Situação: atenção",
    softClassName: "bg-warning-soft border-warning-border",
    softForegroundClassName: "text-warning-soft-fg",
  },
  danger: {
    variant: "danger",
    icon: XCircle,
    dotClassName: "bg-danger",
    textClassName: "text-danger",
    srLabel: "Situação: crítico",
    softClassName: "bg-danger-soft border-danger-border",
    softForegroundClassName: "text-danger-soft-fg",
  },
  info: {
    variant: "info",
    icon: Info,
    dotClassName: "bg-info",
    textClassName: "text-info",
    srLabel: "Situação: informativo",
    softClassName: "bg-info-soft border-info-border",
    softForegroundClassName: "text-info-soft-fg",
  },
  neutral: {
    variant: "neutral",
    icon: Minus,
    dotClassName: "bg-neutral",
    textClassName: "text-neutral",
    srLabel: "Situação: neutro",
    softClassName: "bg-neutral-soft border-neutral-border",
    softForegroundClassName: "text-neutral-soft-fg",
  },
  pending: {
    variant: "neutral",
    icon: Clock,
    dotClassName: "bg-neutral",
    textClassName: "text-fg-muted",
    srLabel: "Situação: pendente",
    softClassName: "bg-neutral-soft border-neutral-border",
    softForegroundClassName: "text-neutral-soft-fg",
  },
  // Violeta, não ciano: "em andamento" precisa se distinguir de "agendado"
  // (info) e de "dados" (accent) à primeira vista.
  progress: {
    variant: "progress",
    icon: RefreshCw,
    dotClassName: "bg-progress",
    textClassName: "text-progress",
    srLabel: "Situação: em andamento",
    softClassName: "bg-progress-soft border-progress-border",
    softForegroundClassName: "text-progress-soft-fg",
  },
};

/** Resolves a semantic status to its visual configuration. */
export function statusTone(status: StatusTone): StatusToneConfig {
  return STATUS_TONES[status];
}

/* -------------------------------------------------------------------------- */

export interface StatusDotProps extends Omit<React.HTMLAttributes<HTMLSpanElement>, "children"> {
  status: StatusTone;
  size?: "sm" | "md";
  /**
   * Accessible name. When omitted the dot is treated as decorative (use it next
   * to a visible label). Pass a label when the dot stands alone.
   */
  label?: string;
}

/** Small colored dot; never use it alone without a `label`. */
export const StatusDot = React.forwardRef<HTMLSpanElement, StatusDotProps>(function StatusDot(
  { status, size = "md", label, className, ...props },
  ref,
) {
  const tone = statusTone(status);
  return (
    <span
      ref={ref}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      title={label}
      className={cn(
        "inline-block shrink-0 rounded-full",
        size === "sm" ? "size-1.5" : "size-2",
        tone.dotClassName,
        className,
      )}
      {...props}
    />
  );
});

/* -------------------------------------------------------------------------- */

export interface StatusBadgeProps extends Omit<React.HTMLAttributes<HTMLSpanElement>, "children"> {
  status: StatusTone;
  /** Visible label. Required so the state is never conveyed by color alone. */
  children: React.ReactNode;
  /** Use the status icon instead of the dot. */
  withIcon?: boolean;
  appearance?: BadgeAppearance;
  size?: BadgeSize;
}

export const StatusBadge = React.forwardRef<HTMLSpanElement, StatusBadgeProps>(function StatusBadge(
  { status, children, withIcon = false, appearance = "soft", size = "md", className, ...props },
  ref,
) {
  const tone = statusTone(status);
  const Icon = tone.icon;
  return (
    <Badge
      ref={ref}
      variant={tone.variant}
      appearance={appearance}
      size={size}
      data-status={status}
      icon={withIcon ? <Icon aria-hidden /> : undefined}
      className={cn(className)}
      {...props}
    >
      {!withIcon ? (
        <span
          className={cn(
            "shrink-0 rounded-full",
            size === "sm" ? "size-1.5" : "size-2",
            appearance === "solid" ? "bg-current opacity-80" : tone.dotClassName,
          )}
          aria-hidden
        />
      ) : null}
      {children}
    </Badge>
  );
});
