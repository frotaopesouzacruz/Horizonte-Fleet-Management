"use client";

import * as React from "react";
import { cn } from "@/lib/cn";
import { formatPct } from "./status";

/**
 * Gráficos da Aderência, em SVG puro.
 *
 * Uma série só, uma cor só (`--chart-1`): o que se compara é a magnitude do
 * percentual contra a meta, e a meta é uma linha de referência tracejada — a
 * única coisa tracejada do gráfico, para que o tracejado signifique "limiar"
 * e nunca "grade". O valor é sempre escrito ao lado da marca, em cor de texto
 * e não na cor da série, porque a cor nunca é a única informação (§16). A
 * tabela ao lado é a gêmea acessível: nada existe só no gráfico.
 *
 * Meses futuros não têm resultado (§16/§25): a coluna aparece hachurada e o
 * valor é um traço. Sem base (denominador zero) a coluna fica vazia.
 */

const pctShort = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 });

export interface BarChartItem {
  key: string;
  /** Rótulo curto do eixo ("Jan"). */
  label: string;
  value: number | null;
  /** Período ainda não vencido: nunca mostra resultado. */
  future?: boolean;
  /** Período em foco (mês corrente): rótulo em destaque. */
  current?: boolean;
  /** Texto completo para o tooltip nativo. */
  title?: string;
}

export interface BarChartProps {
  items: BarChartItem[];
  /** Linha de referência (meta), em pontos percentuais. */
  target: number | null;
  ariaLabel: string;
  className?: string;
}

const HATCH_ID = "hfm-adherence-hatch";

/** Percentuais de 0 a 100 em colunas, com a meta como linha tracejada. */
export function BarChart({ items, target, ariaLabel, className }: BarChartProps) {
  const slot = 56;
  const barWidth = 24;
  const left = 36;
  // Margem direita larga o bastante para o rótulo da meta ficar fora da área
  // das colunas, onde nunca colide com o valor de dezembro.
  const right = 64;
  const top = 26;
  const bottom = 26;
  const plotHeight = 160;
  const width = left + right + slot * items.length;
  const height = top + plotHeight + bottom;
  const y = (pct: number) => top + plotHeight - (Math.max(0, Math.min(100, pct)) / 100) * plotHeight;
  const ticks = [0, 25, 50, 75, 100];

  return (
    <div className={cn("overflow-x-auto", className)}>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={ariaLabel}
        className="h-auto w-full min-w-[36rem] text-fg"
        style={{ fontFamily: "inherit" }}
      >
        <defs>
          <pattern id={HATCH_ID} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <line x1="0" y1="0" x2="0" y2="6" stroke="var(--color-chart-6)" strokeWidth="1" />
          </pattern>
        </defs>

        {/* Grade recessiva: hairline sólida, um passo acima da superfície. */}
        {ticks.map((t) => (
          <g key={t}>
            <line x1={left} x2={width - right} y1={y(t)} y2={y(t)} stroke="var(--color-chart-grid)" strokeWidth="1" />
            <text x={left - 6} y={y(t) + 3.5} textAnchor="end" fontSize="10" fill="currentColor" className="text-fg-muted tabular-nums">
              {t}%
            </text>
          </g>
        ))}

        {items.map((item, i) => {
          const cx = left + slot * i + slot / 2;
          const x = cx - barWidth / 2;
          const hasValue = item.value != null && !item.future;
          const barTop = hasValue ? y(item.value as number) : y(0);
          const barHeight = hasValue ? y(0) - barTop : 0;
          const valueText = item.future ? "—" : item.value == null ? "Sem base" : `${pctShort.format(item.value)}%`;
          return (
            <g key={item.key}>
              <title>{item.title ?? `${item.label}: ${formatPct(item.value)}`}</title>
              {/* Área de toque maior que a marca: a coluna inteira responde ao hover. */}
              <rect x={left + slot * i} y={top} width={slot} height={plotHeight} fill="transparent" />
              {item.future ? (
                <rect x={x} y={top + plotHeight * 0.55} width={barWidth} height={plotHeight * 0.45} rx="4"
                  fill={`url(#${HATCH_ID})`} stroke="var(--color-chart-6)" strokeWidth="1" strokeDasharray="3 3" />
              ) : hasValue && barHeight > 0 ? (
                // Topo arredondado em 4px e base reta na linha de base.
                <path
                  d={`M${x},${y(0)} V${barTop + 4} a4,4 0 0 1 4,-4 h${barWidth - 8} a4,4 0 0 1 4,4 V${y(0)} Z`}
                  fill="var(--color-chart-1)"
                />
              ) : null}
              <text
                x={cx}
                y={(hasValue ? barTop : top + plotHeight) - 6}
                textAnchor="middle"
                fontSize={item.value == null && !item.future ? "9" : "10.5"}
                fontWeight={item.current ? 600 : 500}
                fill="currentColor"
                // Halo na cor da superfície: o valor continua legível onde a
                // linha da meta cruza o texto dos meses próximos a ela.
                stroke="var(--color-surface)"
                strokeWidth="3"
                paintOrder="stroke"
                className={cn("tabular-nums", hasValue ? "text-fg" : "text-fg-muted")}
              >
                {valueText}
              </text>
              <text
                x={cx}
                y={top + plotHeight + 16}
                textAnchor="middle"
                fontSize="10.5"
                fontWeight={item.current ? 700 : 400}
                fill="currentColor"
                className={item.current ? "text-fg" : "text-fg-muted"}
              >
                {item.label}
              </text>
            </g>
          );
        })}

        {/* Linha de base e, quando há meta, a referência tracejada com o valor escrito. */}
        <line x1={left} x2={width - right} y1={y(0)} y2={y(0)} stroke="var(--color-chart-axis)" strokeWidth="1" />
        {target != null ? (
          <g>
            <line x1={left} x2={width - right} y1={y(target)} y2={y(target)}
              stroke="var(--color-chart-axis)" strokeWidth="1.5" strokeDasharray="5 4" />
            <text x={width - right + 6} y={y(target) + 3.5} textAnchor="start" fontSize="10" fontWeight={600} fill="currentColor" className="text-fg-muted tabular-nums">
              Meta {pctShort.format(target)}%
            </text>
          </g>
        ) : null}
      </svg>
    </div>
  );
}

export interface HBarChartItem {
  key: string;
  label: string;
  value: number | null;
  numerator: number;
  denominator: number;
}

export interface HBarChartProps {
  items: HBarChartItem[];
  target: number | null;
  ariaLabel: string;
  className?: string;
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** Barras horizontais por dimensão: percentual escrito na ponta, meta tracejada. */
export function HBarChart({ items, target, ariaLabel, className }: HBarChartProps) {
  const rowHeight = 28;
  const barHeight = 14;
  const labelWidth = 150;
  const valueWidth = 62;
  const plotWidth = 240;
  const top = 8;
  const width = labelWidth + plotWidth + valueWidth;
  const height = top + rowHeight * Math.max(items.length, 1) + 18;
  const x = (pct: number) => labelWidth + (Math.max(0, Math.min(100, pct)) / 100) * plotWidth;

  return (
    <div className={cn("overflow-x-auto", className)}>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={ariaLabel}
        className="h-auto w-full min-w-[22rem] text-fg"
        style={{ fontFamily: "inherit" }}
      >
        {[0, 50, 100].map((t) => (
          <line key={t} x1={x(t)} x2={x(t)} y1={top} y2={top + rowHeight * items.length}
            stroke="var(--color-chart-grid)" strokeWidth="1" />
        ))}

        {items.map((item, i) => {
          const cy = top + rowHeight * i + rowHeight / 2;
          const hasValue = item.value != null;
          const end = hasValue ? x(item.value as number) : x(0);
          const w = Math.max(0, end - labelWidth);
          return (
            <g key={item.key}>
              <title>{`${item.label}: ${formatPct(item.value)} · ${item.numerator}/${item.denominator}`}</title>
              <rect x={0} y={top + rowHeight * i} width={width} height={rowHeight} fill="transparent" />
              <text x={labelWidth - 8} y={cy + 3.5} textAnchor="end" fontSize="10.5" fill="currentColor" className="text-fg">
                {truncate(item.label, 24)}
              </text>
              {hasValue && w > 0 ? (
                // Ponta arredondada em 4px, base reta no eixo.
                <path
                  d={`M${labelWidth},${cy - barHeight / 2} h${Math.max(0, w - 4)} a4,4 0 0 1 4,4 v${barHeight - 8} a4,4 0 0 1 -4,4 h${-Math.max(0, w - 4)} Z`}
                  fill="var(--color-chart-1)"
                />
              ) : null}
              <text x={end + 6} y={cy + 3.5} fontSize="10.5" fontWeight={600} fill="currentColor"
                className={cn("tabular-nums", hasValue ? "text-fg" : "text-fg-muted")}>
                {hasValue ? `${pctShort.format(item.value as number)}%` : "Sem base"}
              </text>
            </g>
          );
        })}

        <line x1={labelWidth} x2={labelWidth} y1={top} y2={top + rowHeight * items.length}
          stroke="var(--color-chart-axis)" strokeWidth="1" />
        {target != null ? (
          <g>
            <line x1={x(target)} x2={x(target)} y1={top - 2} y2={top + rowHeight * items.length + 2}
              stroke="var(--color-chart-axis)" strokeWidth="1.5" strokeDasharray="5 4" />
            <text x={x(target)} y={top + rowHeight * items.length + 14} textAnchor="middle" fontSize="10" fontWeight={600}
              fill="currentColor" className="text-fg-muted tabular-nums">
              Meta {pctShort.format(target)}%
            </text>
          </g>
        ) : null}
      </svg>
    </div>
  );
}
