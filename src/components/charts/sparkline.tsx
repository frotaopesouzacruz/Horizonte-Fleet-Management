import * as React from "react";
import { cn } from "@/lib/cn";
import { linePath, segmentsOf } from "./chart-utils";

/**
 * Sparkline — a tendência de um KPI em 96×28px. Decorativa por padrão: o valor
 * e a variação estão escritos no cartão; quando carrega informação própria,
 * passe `ariaLabel`.
 */
export interface SparklineProps {
  values: (number | null)[];
  /** Cor da linha (token). Padrão: marca. */
  color?: string;
  /** Referência tracejada (meta). */
  target?: number | null;
  /** Força o domínio (ex.: [0, 100] para percentuais). */
  domain?: [number, number];
  width?: number;
  height?: number;
  ariaLabel?: string;
  className?: string;
}

export function Sparkline({
  values, color = "var(--chart-brand-primary)", target = null, domain, width = 96, height = 28, ariaLabel, className,
}: SparklineProps) {
  const uid = React.useId().replace(/:/g, "");
  const present = values.filter((v): v is number => v != null);
  if (present.length < 2) return null;
  const all = target != null ? [...present, target] : present;
  const lo = domain ? domain[0] : Math.min(...all);
  const hi = domain ? domain[1] : Math.max(...all);
  const span = hi - lo || 1;
  const pad = 3;
  const x = (i: number) => pad + (i / Math.max(values.length - 1, 1)) * (width - pad * 2);
  const y = (v: number) => pad + (1 - (v - lo) / span) * (height - pad * 2);
  const coords = values.map((v, i) => (v == null ? null : { x: x(i), y: y(v) }));
  const segments = segmentsOf(coords);
  const lastIndex = values.reduce<number>((acc, v, i) => (v != null ? i : acc), -1);

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role={ariaLabel ? "img" : undefined}
      aria-label={ariaLabel}
      aria-hidden={ariaLabel ? undefined : true}
      className={cn("shrink-0 overflow-visible", className)}
    >
      <defs>
        <linearGradient id={`hfm-spark-${uid}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.18" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      {target != null ? (
        <line x1={0} x2={width} y1={y(target)} y2={y(target)} stroke="var(--chart-target)" strokeWidth="1" strokeDasharray="3 3" />
      ) : null}
      {segments.map((seg, i) => (
        <g key={i}>
          {seg.length > 1 ? (
            <path
              d={`${linePath(seg)} L${seg[seg.length - 1].x},${height} L${seg[0].x},${height} Z`}
              fill={`url(#hfm-spark-${uid})`}
            />
          ) : null}
          <path d={linePath(seg)} fill="none" stroke={color} strokeWidth="1.75" strokeLinejoin="round" strokeLinecap="round" />
        </g>
      ))}
      {lastIndex >= 0 && coords[lastIndex] ? (
        <circle cx={coords[lastIndex]!.x} cy={coords[lastIndex]!.y} r="2.5" fill={color} stroke="var(--surface-raised)" strokeWidth="1.5" />
      ) : null}
    </svg>
  );
}
