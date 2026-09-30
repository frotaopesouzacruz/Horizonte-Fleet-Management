"use client";

import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { cn } from "@/lib/cn";
import type { BadgeVariant } from "@/components/ui/badge";
import { Sparkline } from "@/components/charts/sparkline";

/**
 * KpiCard — uma métrica operacional.
 *
 * Anatomia (Etapa 17): rótulo › valor (numeral KPI, tabular) › variação com
 * semântica de negócio › comparação/meta. Opcionalmente um ícone em chip
 * suave e uma sparkline da série. O tom (`status`) aparece como uma linha de
 * 2px no topo e no chip do ícone — nunca no número, que fica sempre na cor do
 * texto: a cor acompanha, não carrega a informação.
 */

export type KpiTrendDirection = "up" | "down" | "flat";

/**
 * Quando a subida é boa. `up` para aderência e disponibilidade; `down` para
 * custo, pendências, não realizados e tempo parado; `neutral` quando a direção
 * não é julgamento (volume, obrigações previstas).
 */
export type KpiGoodWhen = "up" | "down" | "neutral";

export interface KpiTrend {
  /** Numbers are formatted with pt-BR grouping; strings are printed verbatim ("+3,2 p.p."). */
  value: React.ReactNode;
  direction: KpiTrendDirection;
  /** Semântica da variação. Tem precedência sobre `positiveIsGood`. */
  goodWhen?: KpiGoodWhen;
  /** @deprecated use `goodWhen`. Whether "up" is a good thing. Defaults to `true`. */
  positiveIsGood?: boolean;
  /** Texto do comparativo, ex. "vs. agosto". Escrito ao lado da variação. */
  comparison?: React.ReactNode;
}

const trendNumberFormat = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 });
const valueNumberFormat = new Intl.NumberFormat("pt-BR");

/** Screen-reader wording so the direction is never carried by color alone. */
const TREND_SR_LABEL: Record<KpiTrendDirection, string> = {
  up: "Alta de",
  down: "Queda de",
  flat: "Estável em",
};

const TREND_ICON = { up: ArrowUpRight, down: ArrowDownRight, flat: Minus } as const;

export type KpiTrendTone = "positive" | "negative" | "neutral";

/** Resolve a variação para bom / ruim / neutro a partir da direção e da semântica. */
export function kpiTrendTone(trend: KpiTrend): KpiTrendTone {
  if (trend.direction === "flat") return "neutral";
  const goodWhen: KpiGoodWhen = trend.goodWhen ?? (trend.positiveIsGood === false ? "down" : "up");
  if (goodWhen === "neutral") return "neutral";
  return trend.direction === goodWhen ? "positive" : "negative";
}

/** Resolves the badge tone of a trend from its direction and what counts as good. */
export function kpiTrendVariant(trend: KpiTrend): BadgeVariant {
  const tone = kpiTrendTone(trend);
  return tone === "positive" ? "success" : tone === "negative" ? "danger" : "neutral";
}

const TREND_TONE_CLASS: Record<KpiTrendTone, string> = {
  positive: "bg-delta-positive-bg text-delta-positive",
  negative: "bg-delta-negative-bg text-delta-negative",
  neutral: "bg-delta-neutral-bg text-delta-neutral",
};

export interface TrendIndicatorProps extends Omit<React.HTMLAttributes<HTMLSpanElement>, "children"> {
  trend: KpiTrend;
  size?: "sm" | "md";
}

/** Variação com seta e cor de negócio — usada no KpiCard, em tabelas e em tooltips. */
export function TrendIndicator({ trend, size = "md", className, ...props }: TrendIndicatorProps) {
  const tone = kpiTrendTone(trend);
  const Icon = TREND_ICON[trend.direction];
  const value = typeof trend.value === "number" ? trendNumberFormat.format(trend.value) : trend.value;
  return (
    <span
      data-direction={trend.direction}
      data-tone={tone}
      className={cn(
        "inline-flex shrink-0 items-center gap-0.5 rounded-xs font-semibold tabular-nums",
        size === "sm" ? "h-5 px-1 text-caption [&_svg]:size-3" : "h-6 px-1.5 text-caption [&_svg]:size-3.5",
        TREND_TONE_CLASS[tone],
        className,
      )}
      {...props}
    >
      <Icon aria-hidden />
      <span className="sr-only">{TREND_SR_LABEL[trend.direction]} </span>
      {value}
    </span>
  );
}

export const kpiCardVariants = cva(
  "relative flex flex-col overflow-hidden rounded-lg border border-border bg-surface-raised text-fg shadow-card",
  {
    variants: {
      size: {
        default: "min-h-28 gap-2 px-4 py-3.5",
        compact: "min-h-24 gap-1.5 px-3.5 py-3",
        hero: "min-h-32 gap-2.5 px-5 py-4",
      },
      status: {
        neutral: "",
        secondary: "",
        primary: "",
        accent: "",
        highlight: "",
        success: "",
        warning: "",
        danger: "",
        info: "",
      },
    },
    defaultVariants: { size: "default", status: "neutral" },
  },
);

/** Semantic accent: a 2px line on top and the icon chip tint. */
export type KpiStatus = NonNullable<VariantProps<typeof kpiCardVariants>["status"]>;
export type KpiSize = NonNullable<VariantProps<typeof kpiCardVariants>["size"]>;

const ACCENT_LINE: Record<KpiStatus, string | null> = {
  neutral: null,
  secondary: null,
  primary: "bg-primary",
  accent: "bg-accent",
  highlight: "bg-highlight",
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-danger",
  info: "bg-info",
};

const ICON_CHIP: Record<KpiStatus, string> = {
  neutral: "bg-surface-secondary text-fg-secondary",
  secondary: "bg-surface-secondary text-fg-secondary",
  primary: "bg-primary-soft text-primary-soft-fg",
  accent: "bg-accent-soft text-accent-soft-fg",
  highlight: "bg-highlight-soft text-highlight-soft-fg",
  success: "bg-success-soft text-success-soft-fg",
  warning: "bg-warning-soft text-warning-soft-fg",
  danger: "bg-danger-soft text-danger-soft-fg",
  info: "bg-info-soft text-info-soft-fg",
};

const SPARK_COLOR: Record<KpiStatus, string> = {
  neutral: "var(--chart-brand-primary)",
  secondary: "var(--chart-neutral)",
  primary: "var(--chart-brand-primary)",
  accent: "var(--chart-brand-secondary)",
  highlight: "var(--chart-target)",
  success: "var(--chart-success)",
  warning: "var(--chart-warning)",
  danger: "var(--chart-danger)",
  info: "var(--chart-brand-secondary)",
};

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
  /** Comparison window or context, e.g. "vs. mês anterior", "8 / 9". */
  period?: React.ReactNode;
  /** Meta/benchmark da métrica, escrita no rodapé ("Meta 90,00%"). */
  target?: React.ReactNode;
  /** Selo de situação ao lado do rótulo (use StatusBadge size="sm"). */
  badge?: React.ReactNode;
  /** Série curta para a sparkline (últimos períodos, nulos permitidos). */
  sparkline?: (number | null)[];
  sparklineDomain?: [number, number];
  sparklineTarget?: number | null;
  /** Lucide icon in a soft chip, top-right. */
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
    target,
    badge,
    sparkline,
    sparklineDomain,
    sparklineTarget,
    icon,
    loading = false,
    loadingLabel = "Carregando…",
    ...props
  },
  ref,
) {
  const resolvedStatus: KpiStatus = status ?? "neutral";
  const accent = ACCENT_LINE[resolvedStatus];
  const valueSize = size === "compact" ? "text-kpi-sm" : size === "hero" ? "text-kpi-lg" : "text-kpi";

  if (loading) {
    return (
      <section ref={ref} aria-busy className={cn(kpiCardVariants({ size, status }), className)} {...props}>
        <span role="status" className="sr-only">
          {loadingLabel}
        </span>
        <span className="hfm-skeleton h-3 w-24" aria-hidden />
        <span className={cn("hfm-skeleton w-32", size === "compact" ? "h-6" : "h-7")} aria-hidden />
        <span className="hfm-skeleton h-3 w-20" aria-hidden />
      </section>
    );
  }

  const hasFooter = trend || period != null || target != null;

  return (
    <section
      ref={ref}
      data-status={resolvedStatus}
      className={cn(kpiCardVariants({ size, status }), className)}
      {...props}
    >
      {accent ? <span aria-hidden className={cn("absolute inset-x-0 top-0 h-0.5", accent)} /> : null}

      <header className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          <h3 className="min-w-0 text-balance text-label font-medium text-fg-secondary">{label}</h3>
          {badge}
        </div>
        {icon ? (
          <span
            className={cn(
              "flex size-8 shrink-0 items-center justify-center rounded-md [&_svg]:size-4 [&_svg]:shrink-0",
              size === "compact" && "size-7",
              ICON_CHIP[resolvedStatus],
            )}
            aria-hidden
          >
            {icon}
          </span>
        ) : null}
      </header>

      <div className="flex min-w-0 items-end justify-between gap-3">
        <p className="flex min-w-0 items-baseline gap-1.5">
          <span className={cn("font-semibold text-fg tabular-nums", valueSize)}>
            {typeof value === "number" ? valueNumberFormat.format(value) : value}
          </span>
          {unit != null ? <span className="text-body-sm font-medium text-fg-muted">{unit}</span> : null}
        </p>
        {sparkline && sparkline.filter((v) => v != null).length > 1 ? (
          <Sparkline
            values={sparkline}
            domain={sparklineDomain}
            target={sparklineTarget}
            color={SPARK_COLOR[resolvedStatus]}
            className="mb-1"
          />
        ) : null}
      </div>

      {hasFooter ? (
        <footer className="flex flex-wrap items-center gap-x-2 gap-y-1">
          {trend ? <TrendIndicator trend={trend} size={size === "compact" ? "sm" : "md"} /> : null}
          {trend?.comparison != null ? <span className="text-caption text-fg-muted">{trend.comparison}</span> : null}
          {period != null ? <span className="min-w-0 truncate text-caption text-fg-muted">{period}</span> : null}
          {target != null ? (
            <span className="inline-flex items-center gap-1 text-caption text-fg-muted">
              <span aria-hidden className="inline-block h-0 w-3 border-t-2 border-dashed border-chart-target" />
              {target}
            </span>
          ) : null}
        </footer>
      ) : null}
    </section>
  );
});

/* -------------------------------------------------------------------------- */

export interface MetricStripItem {
  key: string;
  label: React.ReactNode;
  value: React.ReactNode;
  hint?: React.ReactNode;
}

/**
 * MetricStrip — números de apoio numa faixa só, abaixo dos KPIs principais.
 * É o segundo nível da leitura: compõe o indicador sem competir com ele.
 */
export function MetricStrip({ items, ariaLabel, className }: { items: MetricStripItem[]; ariaLabel?: string; className?: string }) {
  return (
    <dl
      aria-label={ariaLabel}
      className={cn(
        "grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-border bg-border-subtle shadow-card md:grid-cols-4",
        className,
      )}
    >
      {items.map((item) => (
        <div key={item.key} className="flex min-w-0 flex-col gap-0.5 bg-surface-raised px-4 py-3">
          <dt className="truncate text-caption text-fg-muted">{item.label}</dt>
          <dd className="text-h3 font-semibold text-fg tabular-nums">{item.value}</dd>
          {item.hint != null ? <dd className="truncate text-caption text-fg-muted">{item.hint}</dd> : null}
        </div>
      ))}
    </dl>
  );
}
