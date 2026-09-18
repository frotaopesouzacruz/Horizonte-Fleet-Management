"use client";

import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { Minus, TrendingDown, TrendingUp } from "lucide-react";
import { cn } from "@/lib/cn";
import { Badge, type BadgeVariant } from "@/components/ui/badge";

/**
 * KpiCard — single operational metric. Deliberately restrained: one number, one
 * label, at most one trend and one period. The number never becomes a poster —
 * it stays at `text-h1` so a row of KPIs reads as data, not as marketing.
 */

export type KpiTrendDirection = "up" | "down" | "flat";

export interface KpiTrend {
  /** Numbers are formatted with pt-BR grouping; strings are printed verbatim ("+3,2%"). */
  value: React.ReactNode;
  direction: KpiTrendDirection;
  /** Whether "up" is a good thing. Defaults to `true`; set `false` for costs, downtime, incidents. */
  positiveIsGood?: boolean;
}

const trendNumberFormat = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 });
const valueNumberFormat = new Intl.NumberFormat("pt-BR");

/** Screen-reader wording so the direction is never carried by color alone. */
const TREND_SR_LABEL: Record<KpiTrendDirection, string> = {
  up: "Alta de",
  down: "Queda de",
  flat: "Estável em",
};

const TREND_ICON = { up: TrendingUp, down: TrendingDown, flat: Minus } as const;

/** Resolves the badge tone of a trend from its direction and what counts as good. */
export function kpiTrendVariant(trend: KpiTrend): BadgeVariant {
  if (trend.direction === "flat") return "neutral";
  const isGood = (trend.direction === "up") === (trend.positiveIsGood ?? true);
  return isGood ? "success" : "danger";
}

export const kpiCardVariants = cva("relative flex flex-col rounded-md border border-border bg-surface text-fg", {
  variants: {
    size: {
      default: "min-h-24 justify-center gap-1.5 px-4 py-3.5",
      compact: "min-h-20 justify-center gap-1 px-3.5 py-3",
    },
    status: {
      neutral: "",
      primary: "border-l-2 border-l-primary",
      accent: "border-l-2 border-l-accent",
      success: "border-l-2 border-l-success",
      warning: "border-l-2 border-l-warning",
      danger: "border-l-2 border-l-danger",
      info: "border-l-2 border-l-info",
    },
  },
  defaultVariants: { size: "default", status: "neutral" },
});

/** Semantic accent drawn as a 2px left border — the only color the card carries. */
export type KpiStatus = NonNullable<VariantProps<typeof kpiCardVariants>["status"]>;
export type KpiSize = NonNullable<VariantProps<typeof kpiCardVariants>["size"]>;

export interface KpiCardProps
  extends Omit<React.HTMLAttributes<HTMLElement>, "title">,
    VariantProps<typeof kpiCardVariants> {
  /** Metric name, e.g. "Veículos ativos". Sentence case — never shouted. */
  label: React.ReactNode;
  /** The measurement. Numbers are formatted with pt-BR grouping. */
  value: React.ReactNode;
  /** Unit rendered next to the value ("km", "%", "R$"). */
  unit?: React.ReactNode;
  trend?: KpiTrend;
  /** Comparison window, e.g. "vs. mês anterior". */
  period?: React.ReactNode;
  /** Lucide icon rendered muted in the top-right corner. Never decorative color. */
  icon?: React.ReactNode;
  /** Replaces the content with a skeleton of the same height. */
  loading?: boolean;
  /** Announced while `loading`. */
  loadingLabel?: string;
}

export const KpiCard = React.forwardRef<HTMLElement, KpiCardProps>(function KpiCard(
  {
    className,
    size,
    status,
    label,
    value,
    unit,
    trend,
    period,
    icon,
    loading = false,
    loadingLabel = "Carregando…",
    ...props
  },
  ref,
) {
  const isCompact = size === "compact";

  if (loading) {
    return (
      <section
        ref={ref}
        aria-busy
        className={cn(kpiCardVariants({ size, status }), className)}
        {...props}
      >
        <span role="status" className="sr-only">
          {loadingLabel}
        </span>
        <span className="hfm-skeleton h-3 w-24" aria-hidden />
        <span className={cn("hfm-skeleton w-32", isCompact ? "h-5" : "h-6")} aria-hidden />
        <span className="hfm-skeleton h-3 w-20" aria-hidden />
      </section>
    );
  }

  const TrendIcon = trend ? TREND_ICON[trend.direction] : null;
  const trendValue =
    trend && typeof trend.value === "number" ? trendNumberFormat.format(trend.value) : trend?.value;

  return (
    <section ref={ref} className={cn(kpiCardVariants({ size, status }), className)} {...props}>
      <header className="flex items-start justify-between gap-2">
        <h3 className="min-w-0 text-balance text-body-sm font-medium text-fg-secondary">{label}</h3>
        {icon ? (
          <span className="shrink-0 text-fg-muted [&_svg]:size-[18px] [&_svg]:shrink-0" aria-hidden>
            {icon}
          </span>
        ) : null}
      </header>

      <p className="flex min-w-0 items-baseline gap-1.5">
        <span
          className={cn(
            "font-bold text-fg tabular-nums leading-none",
            isCompact ? "text-[26px]" : "text-[30px]",
          )}
        >
          {typeof value === "number" ? valueNumberFormat.format(value) : value}
        </span>
        {unit != null ? <span className="text-body-sm font-medium text-fg-muted">{unit}</span> : null}
      </p>

      {trend || period != null ? (
        <footer className="flex flex-wrap items-center gap-x-2 gap-y-1">
          {trend && TrendIcon ? (
            <Badge
              variant={kpiTrendVariant(trend)}
              appearance="soft"
              size="sm"
              className="tabular-nums"
              data-direction={trend.direction}
              icon={<TrendIcon aria-hidden />}
            >
              <span className="sr-only">{TREND_SR_LABEL[trend.direction]} </span>
              {trendValue}
            </Badge>
          ) : null}
          {period != null ? <span className="truncate text-caption text-fg-muted">{period}</span> : null}
        </footer>
      ) : null}
    </section>
  );
});
