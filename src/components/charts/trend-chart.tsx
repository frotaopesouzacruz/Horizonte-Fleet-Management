"use client";

import * as React from "react";
import { ChartFrame, type ChartTooltipContent } from "./chart-frame";
import { approxTextWidth, linePath, niceScale, percentDomain, segmentsOf, ticksOf } from "./chart-utils";

/**
 * TrendChart — série temporal com meta.
 *
 * Gramática HFM (docs/design/hfm-data-visualization.md):
 * - uma linha na cor da marca (2,5px), área suave abaixo dela;
 * - a meta é a ÚNICA linha tracejada, em dourado profundo, com o valor escrito;
 * - pontos abaixo da meta viram vermelhos — a cor marca o julgamento, e o
 *   tooltip e a tabela gêmea dizem o número, então a cor nunca está sozinha;
 * - períodos futuros não têm resultado: faixa recessiva e rótulo "Futuro";
 * - grade horizontal em hairline, sem linhas verticais nem traços de eixo.
 */

export interface TrendPoint {
  key: string;
  /** Rótulo curto do eixo ("Jan"). */
  label: string;
  value: number | null;
  future?: boolean;
  /** Período em foco: rótulo em destaque e valor escrito junto ao ponto. */
  current?: boolean;
  tooltip?: ChartTooltipContent;
}

export interface TrendChartProps {
  points: TrendPoint[];
  ariaLabel: string;
  target?: number | null;
  targetLabel?: string;
  /** "percent" fixa o eixo entre 0 e 100 (com zoom na faixa útil). */
  kind?: "percent" | "number";
  /** Formata o valor escrito junto ao ponto e no eixo. */
  format: (value: number) => string;
  axisFormat?: (value: number) => string;
  /** Altura da área de plotagem, em px. */
  height?: number;
  /** Pontos abaixo da meta em vermelho (padrão: sim, quando há meta). */
  flagBelowTarget?: boolean;
  /**
   * `kind="number"`: o eixo começa em zero (padrão). Desligue para séries que
   * vivem longe do zero (hodômetro em 80 mil km), senão a linha fica plana.
   */
  zeroBaseline?: boolean;
  onSelect?: (point: TrendPoint, index: number) => void;
  className?: string;
}

const GRADIENT_PREFIX = "hfm-trend-area-";
const HATCH_PREFIX = "hfm-trend-future-";

export function TrendChart({
  points, ariaLabel, target = null, targetLabel, kind = "percent", format, axisFormat, height = 200,
  flagBelowTarget = true, zeroBaseline = true, onSelect, className,
}: TrendChartProps) {
  const uid = React.useId().replace(/:/g, "");
  const [active, setActive] = React.useState<number | null>(null);
  const values = points.map((p) => (p.future ? null : p.value));

  let domain: [number, number];
  if (kind === "percent") domain = percentDomain(values, target);
  else {
    const present = values.filter((v): v is number => v != null);
    if (target != null) present.push(target);
    const lo = present.length ? Math.min(...present) : 0;
    const hi = present.length ? Math.max(...present) : 1;
    const s = zeroBaseline
      ? niceScale(Math.min(0, lo), Math.max(1, hi), 4)
      : niceScale(lo - (hi - lo) * 0.08, hi + (hi - lo) * 0.08 || hi + 1, 4);
    domain = [s.min, s.max];
  }

  const scale = niceScale(domain[0], domain[1], 4);
  const ticks = ticksOf({ min: domain[0], max: domain[1], step: kind === "percent" ? Math.max(5, scale.step) : scale.step })
    .filter((t) => t >= domain[0] && t <= domain[1]);
  const fmtAxis = axisFormat ?? format;

  const tLabel = target != null ? targetLabel ?? `Meta ${format(target)}` : "";

  return (
    <ChartFrame
      ariaLabel={ariaLabel}
      count={points.length}
      active={active}
      onActiveChange={setActive}
      onActivate={onSelect ? (i) => onSelect(points[i], i) : undefined}
      className={className}
      render={(width) => {
        // Margem do eixo pelo rótulo mais largo ("85.000" não perde o primeiro dígito).
        const left = Math.max(36, Math.round(Math.max(...ticks.map((t) => approxTextWidth(fmtAxis(t), 11))) + 14));
        const right = target != null ? Math.max(16, Math.min(84, approxTextWidth(tLabel, 11) + 14)) : 16;
        const top = 20;
        const bottom = 28;
        const plotW = Math.max(120, width - left - right);
        const slot = plotW / Math.max(points.length, 1);
        const totalH = top + height + bottom;
        const x = (i: number) => left + slot * i + slot / 2;
        const y = (v: number) => top + height - ((Math.max(domain[0], Math.min(domain[1], v)) - domain[0]) / (domain[1] - domain[0])) * height;
        const coords = points.map((p, i) => (p.future || p.value == null ? null : { x: x(i), y: y(p.value) }));
        const segments = segmentsOf(coords);
        const firstFuture = points.findIndex((p) => p.future);
        const below = (v: number | null) => flagBelowTarget && target != null && v != null && v < target;
        // Em cartões estreitos (celular), os rótulos do eixo alternam para não se
        // atropelarem; o período em foco e o ativo sempre aparecem.
        const labelEvery = slot >= 30 ? 1 : slot >= 18 ? 2 : 3;
        const activePoint = active != null ? points[active] : null;
        const tip = activePoint?.tooltip
          ? { content: activePoint.tooltip, x: x(active as number), y: coords[active as number]?.y ?? top + height / 2 }
          : null;

        const chart = (
            <svg
              width={width}
              height={totalH}
              viewBox={`0 0 ${width} ${totalH}`}
              role="img"
              aria-label={ariaLabel}
              className="block text-fg"
              style={{ fontFamily: "inherit" }}
              onPointerMove={(e) => {
                const rect = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
                const px = e.clientX - rect.left;
                const i = Math.floor((px - left) / slot);
                setActive(i >= 0 && i < points.length ? i : null);
              }}
              onClick={() => {
                if (active != null && onSelect) onSelect(points[active], active);
              }}
            >
              <defs>
                <linearGradient id={`${GRADIENT_PREFIX}${uid}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--chart-area-primary)" />
                  <stop offset="100%" stopColor="var(--chart-area-primary-fade)" />
                </linearGradient>
                <pattern id={`${HATCH_PREFIX}${uid}`} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                  <line x1="0" y1="0" x2="0" y2="6" stroke="var(--chart-future)" strokeWidth="1" opacity="0.6" />
                </pattern>
              </defs>

              {/* Faixa dos períodos futuros. */}
              {firstFuture >= 0 ? (
                <g>
                  <rect
                    x={left + slot * firstFuture}
                    y={top}
                    width={slot * (points.length - firstFuture)}
                    height={height}
                    fill={`url(#${HATCH_PREFIX}${uid})`}
                    opacity="0.55"
                  />
                  <text x={left + slot * firstFuture + 6} y={top + 12} fontSize="11" fill="var(--chart-label)">
                    Futuro
                  </text>
                </g>
              ) : null}

              {/* Grade recessiva e eixo Y. */}
              {ticks.map((t) => (
                <g key={t}>
                  <line x1={left} x2={left + plotW} y1={y(t)} y2={y(t)} stroke="var(--chart-grid)" strokeWidth="1" />
                  <text x={left - 8} y={y(t) + 4} textAnchor="end" fontSize="11" fill="var(--chart-label)" className="tabular-nums">
                    {fmtAxis(t)}
                  </text>
                </g>
              ))}

              {/* Banda do item ativo. */}
              {active != null ? (
                <rect x={left + slot * active} y={top} width={slot} height={height} fill="var(--chart-hover-band)" />
              ) : null}

              {/* Área e linha. */}
              {segments.map((seg, i) => (
                <g key={i}>
                  {seg.length > 1 ? (
                    <path
                      d={`${linePath(seg)} L${seg[seg.length - 1].x},${top + height} L${seg[0].x},${top + height} Z`}
                      fill={`url(#${GRADIENT_PREFIX}${uid})`}
                    />
                  ) : null}
                  <path d={linePath(seg)} fill="none" stroke="var(--chart-brand-primary)" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
                </g>
              ))}

              {/* Meta: a única linha tracejada do gráfico. */}
              {target != null ? (
                <g>
                  <line x1={left} x2={left + plotW} y1={y(target)} y2={y(target)} stroke="var(--chart-target)" strokeWidth="2" strokeDasharray="6 4" />
                  <text
                    x={left + plotW + 6}
                    y={y(target) + 4}
                    fontSize="11"
                    fontWeight={600}
                    fill="var(--chart-target-label)"
                    className="tabular-nums"
                  >
                    {tLabel}
                  </text>
                </g>
              ) : null}

              {/* Pontos e rótulos. */}
              {points.map((p, i) => {
                const c = coords[i];
                const isActive = active === i;
                const flagged = below(p.value);
                return (
                  <g key={p.key}>
                    {c ? (
                      <>
                        {isActive ? (
                          <line x1={c.x} x2={c.x} y1={top} y2={top + height} stroke="var(--chart-crosshair)" strokeWidth="1" />
                        ) : null}
                        <circle
                          cx={c.x}
                          cy={c.y}
                          r={isActive || p.current ? 5.5 : flagged ? 4.5 : 3.5}
                          fill={flagged ? "var(--chart-danger)" : isActive || p.current ? "var(--chart-brand-primary)" : "var(--surface-raised)"}
                          stroke={flagged ? "var(--surface-raised)" : "var(--chart-brand-primary)"}
                          strokeWidth={flagged ? 1.5 : 2}
                        />
                        {p.current || (isActive && !p.tooltip) ? (
                          <text
                            x={Math.min(Math.max(c.x, left), width - (approxTextWidth(format(p.value as number), 11) * 1.08) / 2 - 2)}
                            y={c.y - 11}
                            textAnchor="middle"
                            fontSize="11"
                            fontWeight={600}
                            fill="currentColor"
                            stroke="var(--surface-raised)"
                            strokeWidth="3"
                            paintOrder="stroke"
                            className="tabular-nums"
                          >
                            {format(p.value as number)}
                          </text>
                        ) : null}
                      </>
                    ) : null}
                    {i % labelEvery === 0 || p.current || isActive ? (
                    <text
                      x={x(i)}
                      y={top + height + 18}
                      textAnchor="middle"
                      fontSize="11"
                      fontWeight={p.current ? 700 : 500}
                      fill={p.current ? "currentColor" : "var(--chart-label)"}
                    >
                      {p.label}
                    </text>
                    ) : null}
                  </g>
                );
              })}

              {/* Linha de base. */}
              <line x1={left} x2={left + plotW} y1={top + height} y2={top + height} stroke="var(--chart-axis-line)" strokeWidth="1" />
            </svg>
        );
        return { chart, tooltip: tip };
      }}
    />
  );
}
