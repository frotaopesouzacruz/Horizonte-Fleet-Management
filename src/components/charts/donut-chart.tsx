"use client";

import * as React from "react";
import { cn } from "@/lib/cn";
import { ChartTooltipCard, type ChartTooltipContent } from "./chart-frame";

/**
 * DonutChart — composição de um total em poucas fatias (até ~6): situação das
 * leituras, distribuição por faixa, participação por operação. Fatias com
 * respiro entre si, total no centro, legenda com valor e percentual. Para mais
 * categorias, use barras horizontais.
 */
export interface DonutSlice {
  key: string;
  label: string;
  value: number;
  /** Token CSS da cor (var(--chart-1)…). */
  color: string;
}

export interface DonutChartProps {
  slices: DonutSlice[];
  ariaLabel: string;
  /** Rótulo e valor do centro (padrão: total). */
  centerLabel?: React.ReactNode;
  centerValue?: React.ReactNode;
  format?: (value: number) => string;
  size?: number;
  showLegend?: boolean;
  className?: string;
}

const nf = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 });
const pf = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

export function DonutChart({
  slices,
  ariaLabel,
  centerLabel = "Total",
  centerValue,
  format = (v) => nf.format(v),
  size = 168,
  showLegend = true,
  className,
}: DonutChartProps) {
  const [active, setActive] = React.useState<number | null>(null);
  const total = slices.reduce((acc, s) => acc + Math.max(0, s.value), 0);
  const stroke = Math.round(size * 0.14);
  const r = (size - stroke) / 2 - 2;
  const c = 2 * Math.PI * r;
  const gap = slices.filter((s) => s.value > 0).length > 1 ? 2.5 : 0;
  let offset = 0;

  const tooltip: ChartTooltipContent | null =
    active != null && slices[active]
      ? {
          title: slices[active].label,
          rows: [
            { label: "Quantidade", value: format(slices[active].value), color: slices[active].color, emphasis: true },
            { label: "Participação", value: total > 0 ? `${pf.format((100 * slices[active].value) / total)}%` : "—" },
          ],
        }
      : null;

  return (
    <div className={cn("flex flex-wrap items-center gap-5", className)}>
      <div className="relative shrink-0" style={{ width: size, height: size }}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={ariaLabel}>
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--chart-track)" strokeWidth={stroke} />
          {total > 0
            ? slices.map((s, i) => {
                const len = (Math.max(0, s.value) / total) * c;
                const dash = Math.max(0, len - gap);
                const el =
                  len > 0 ? (
                    <circle
                      key={s.key}
                      cx={size / 2}
                      cy={size / 2}
                      r={r}
                      fill="none"
                      stroke={s.color}
                      strokeWidth={active === i ? stroke + 4 : stroke}
                      strokeDasharray={`${dash} ${c - dash}`}
                      strokeDashoffset={-offset}
                      transform={`rotate(-90 ${size / 2} ${size / 2})`}
                      className="cursor-pointer transition-[stroke-width] duration-(--duration-fast)"
                      onMouseEnter={() => setActive(i)}
                      onMouseLeave={() => setActive(null)}
                    />
                  ) : null;
                offset += len;
                return el;
              })
            : null}
        </svg>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
          <span className="text-h3 font-semibold text-fg tabular-nums">{centerValue ?? format(total)}</span>
          <span className="text-caption text-fg-muted">{centerLabel}</span>
        </div>
        {tooltip ? (
          <div className="absolute top-full left-1/2 z-10 mt-1 -translate-x-1/2">
            <ChartTooltipCard content={tooltip} />
          </div>
        ) : null}
      </div>
      {showLegend ? (
        <ul className="flex min-w-40 flex-1 flex-col gap-1.5">
          {slices.map((s, i) => (
            <li
              key={s.key}
              className={cn("flex items-center gap-2 rounded-sm px-1.5 py-0.5 text-caption hfm-transition", active === i && "bg-hover-overlay")}
              onMouseEnter={() => setActive(i)}
              onMouseLeave={() => setActive(null)}
            >
              <span aria-hidden className="size-2.5 shrink-0 rounded-[3px]" style={{ background: s.color }} />
              <span className="min-w-0 flex-1 truncate text-fg-secondary">{s.label}</span>
              <span className="font-semibold text-fg tabular-nums">{format(s.value)}</span>
              <span className="w-12 text-right text-fg-muted tabular-nums">
                {total > 0 ? `${pf.format((100 * Math.max(0, s.value)) / total)}%` : "—"}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
