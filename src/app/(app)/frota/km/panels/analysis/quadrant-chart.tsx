"use client";

import * as React from "react";
import { ChartFrame, type ChartTooltipContent } from "@/components/charts/chart-frame";
import { SrTable } from "@/components/charts/sr-table";
import { chartFormat, niceScale, ticksOf } from "@/components/charts/chart-utils";
import { fmt1, fmtInt, fmtKm, KM_QUADRANT } from "@/lib/km/types";

/**
 * Quadrantes da coorte: hodômetro acumulado (x) × KM/dia (y), com as medianas
 * da coorte selecionada em tracejado. O quadrante de cada ponto vem da rotina
 * (`quadrant`); a tela só posiciona. Cor + forma + rótulo no tooltip e na
 * legenda — a cor nunca é a única informação — e a tabela sr-only repete os
 * pontos para leitor de tela.
 */
export type QuadrantShape = "circle" | "square" | "triangle" | "diamond" | "ring";

export const QUADRANT_STYLE: Record<string, { color: string; shape: QuadrantShape }> = {
  high_km_high_use: { color: "var(--chart-danger)", shape: "circle" },
  high_km_low_use: { color: "var(--chart-warning)", shape: "square" },
  low_km_high_use: { color: "var(--chart-brand-secondary)", shape: "triangle" },
  low_km_low_use: { color: "var(--chart-success)", shape: "diamond" },
};
export const NO_QUADRANT_STYLE = { color: "var(--chart-neutral)", shape: "ring" as QuadrantShape };
export const QUADRANT_ORDER = ["high_km_high_use", "high_km_low_use", "low_km_high_use", "low_km_low_use"] as const;

export const quadrantStyle = (code: string | null | undefined) => (code ? QUADRANT_STYLE[code] ?? NO_QUADRANT_STYLE : NO_QUADRANT_STYLE);

/** Marca de um ponto. `r` é o raio visual (o alvo de clique é maior). */
export function Marker({ shape, color, cx, cy, r, ring = true }: { shape: QuadrantShape; color: string; cx: number; cy: number; r: number; ring?: boolean }) {
  const stroke = ring ? { stroke: "var(--surface-raised)", strokeWidth: 1.5 } : {};
  switch (shape) {
    case "square":
      return <rect x={cx - r * 0.9} y={cy - r * 0.9} width={r * 1.8} height={r * 1.8} rx={1.5} fill={color} {...stroke} />;
    case "triangle": {
      const h = r * 1.15;
      return <path d={`M${cx},${cy - h} L${cx + h},${cy + h * 0.8} L${cx - h},${cy + h * 0.8} Z`} fill={color} {...stroke} />;
    }
    case "diamond": {
      const d = r * 1.2;
      return <path d={`M${cx},${cy - d} L${cx + d},${cy} L${cx},${cy + d} L${cx - d},${cy} Z`} fill={color} {...stroke} />;
    }
    case "ring":
      return <circle cx={cx} cy={cy} r={r * 0.85} fill="var(--surface-raised)" stroke={color} strokeWidth={2} />;
    default:
      return <circle cx={cx} cy={cy} r={r} fill={color} {...stroke} />;
  }
}

/** Amostra da legenda (mesma forma do gráfico). */
export function MarkerSwatch({ code }: { code: string | null }) {
  const s = quadrantStyle(code);
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden className="shrink-0">
      <Marker shape={s.shape} color={s.color} cx={7} cy={7} r={5} ring={false} />
    </svg>
  );
}

export interface QuadrantPoint {
  key: string;
  plate: string;
  subtitle: string;
  /** Hodômetro acumulado. */
  x: number;
  /** KM/dia no período. */
  y: number;
  kmPeriod: number | null;
  quadrant: string | null;
}

export interface QuadrantChartProps {
  points: QuadrantPoint[];
  medianX: number | null;
  medianY: number | null;
  ariaLabel: string;
  caption: string;
  height?: number;
  onSelect?: (point: QuadrantPoint) => void;
}

const MARGIN = { top: 22, right: 18, bottom: 40, left: 58 };

export function QuadrantChart({ points, medianX, medianY, ariaLabel, caption, height = 340, onSelect }: QuadrantChartProps) {
  const [active, setActive] = React.useState<number | null>(null);
  // Navegação por teclado da esquerda para a direita (hodômetro crescente).
  const ordered = React.useMemo(() => [...points].sort((a, b) => a.x - b.x || b.y - a.y), [points]);

  const xs = ordered.map((p) => p.x);
  const ys = ordered.map((p) => p.y);
  if (medianX != null) xs.push(medianX);
  if (medianY != null) ys.push(medianY);
  const xScale = niceScale(Math.min(...xs), Math.max(...xs), 5);
  const yScale = niceScale(0, Math.max(1, ...ys), 4);
  const xTicks = ticksOf(xScale);
  const yTicks = ticksOf(yScale);

  return (
    <div className="flex flex-col gap-2">
      <ChartFrame
        ariaLabel={ariaLabel}
        count={ordered.length}
        active={active}
        onActiveChange={setActive}
        orientation="horizontal"
        onActivate={onSelect ? (i) => onSelect(ordered[i]) : undefined}
        minWidth={320}
        render={(width) => {
          const plotW = Math.max(120, width - MARGIN.left - MARGIN.right);
          const plotH = height - MARGIN.top - MARGIN.bottom;
          const sx = (v: number) => MARGIN.left + ((v - xScale.min) / Math.max(1e-9, xScale.max - xScale.min)) * plotW;
          const sy = (v: number) => MARGIN.top + plotH - ((v - yScale.min) / Math.max(1e-9, yScale.max - yScale.min)) * plotH;
          const left = MARGIN.left;
          const right = MARGIN.left + plotW;
          const top = MARGIN.top;
          const bottom = MARGIN.top + plotH;
          const showCorners = width >= 520 && medianX != null && medianY != null;
          const ap = active != null ? ordered[active] : null;

          const tip = ap
            ? {
                x: sx(ap.x),
                y: sy(ap.y),
                content: {
                  title: ap.plate,
                  subtitle: ap.subtitle,
                  rows: [
                    { label: "Hodômetro", value: fmtKm(ap.x) },
                    { label: "KM/dia", value: `${fmt1(ap.y)} km`, emphasis: true },
                    { label: "KM no período", value: fmtKm(ap.kmPeriod) },
                    {
                      label: "Quadrante",
                      value: ap.quadrant ? KM_QUADRANT[ap.quadrant]?.label ?? ap.quadrant : "Sem quadrante",
                      color: quadrantStyle(ap.quadrant).color,
                    },
                  ],
                  announce: `${ap.plate}, ${ap.subtitle}. Hodômetro ${fmtKm(ap.x)}, ${fmt1(ap.y)} km por dia. ${
                    ap.quadrant ? KM_QUADRANT[ap.quadrant]?.label ?? ap.quadrant : "Sem quadrante"
                  }.`,
                } satisfies ChartTooltipContent,
              }
            : null;

          const chart = (
            <svg
              width={width}
              height={height}
              viewBox={`0 0 ${width} ${height}`}
              role="img"
              aria-label={ariaLabel}
              className="block text-fg"
              style={{ fontFamily: "inherit" }}
              onPointerMove={(e) => {
                const rect = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
                const px = e.clientX - rect.left;
                const py = e.clientY - rect.top;
                let best: number | null = null;
                let bestD = 18 * 18;
                ordered.forEach((p, i) => {
                  const dx = sx(p.x) - px;
                  const dy = sy(p.y) - py;
                  const d = dx * dx + dy * dy;
                  if (d < bestD) {
                    bestD = d;
                    best = i;
                  }
                });
                setActive(best);
              }}
              onClick={() => {
                if (ap && onSelect) onSelect(ap);
              }}
            >
              {/* grade e eixos */}
              {yTicks.map((t) => (
                <g key={`y${t}`}>
                  <line x1={left} x2={right} y1={sy(t)} y2={sy(t)} stroke="var(--chart-grid)" strokeWidth={1} />
                  <text x={left - 8} y={sy(t) + 4} textAnchor="end" fontSize={11} fill="var(--chart-label)" className="tabular-nums">
                    {chartFormat.int(t)}
                  </text>
                </g>
              ))}
              {xTicks.map((t) => (
                <g key={`x${t}`}>
                  <line x1={sx(t)} x2={sx(t)} y1={top} y2={bottom} stroke="var(--chart-grid)" strokeWidth={1} />
                  <text x={sx(t)} y={bottom + 16} textAnchor="middle" fontSize={11} fill="var(--chart-label)" className="tabular-nums">
                    {chartFormat.compact(t)}
                  </text>
                </g>
              ))}
              <line x1={left} x2={right} y1={bottom} y2={bottom} stroke="var(--chart-axis-line)" strokeWidth={1} />
              <text x={left} y={12} fontSize={11} fontWeight={600} fill="var(--chart-label)">
                KM/dia
              </text>
              <text x={right} y={height - 6} textAnchor="end" fontSize={11} fontWeight={600} fill="var(--chart-label)">
                Hodômetro acumulado (km)
              </text>

              {/* rótulos dos quadrantes, nos cantos */}
              {showCorners ? (
                <g fontSize={11} fill="var(--chart-label)" aria-hidden>
                  <text x={right - 6} y={top + 14} textAnchor="end">{KM_QUADRANT.high_km_high_use.label}</text>
                  <text x={right - 6} y={bottom - 8} textAnchor="end">{KM_QUADRANT.high_km_low_use.label}</text>
                  <text x={left + 6} y={top + 14}>{KM_QUADRANT.low_km_high_use.label}</text>
                  <text x={left + 6} y={bottom - 8}>{KM_QUADRANT.low_km_low_use.label}</text>
                </g>
              ) : null}

              {/* medianas da coorte */}
              {medianX != null ? (
                <g>
                  <line x1={sx(medianX)} x2={sx(medianX)} y1={top} y2={bottom} stroke="var(--chart-crosshair)" strokeWidth={1.5} strokeDasharray="5 4" />
                  <text x={sx(medianX) + 4} y={top - 6} fontSize={11} fill="var(--chart-label)" className="tabular-nums">
                    Mediana {chartFormat.compact(medianX)} km
                  </text>
                </g>
              ) : null}
              {medianY != null ? (
                <g>
                  <line x1={left} x2={right} y1={sy(medianY)} y2={sy(medianY)} stroke="var(--chart-crosshair)" strokeWidth={1.5} strokeDasharray="5 4" />
                  <text x={right - 4} y={sy(medianY) - 5} textAnchor="end" fontSize={11} fill="var(--chart-label)" className="tabular-nums">
                    Mediana {fmt1(medianY)} km/dia
                  </text>
                </g>
              ) : null}

              {/* pontos */}
              {ordered.map((p, i) => {
                const s = quadrantStyle(p.quadrant);
                return (
                  <g key={p.key} opacity={active == null || active === i ? 1 : 0.55}>
                    <Marker shape={s.shape} color={s.color} cx={sx(p.x)} cy={sy(p.y)} r={active === i ? 7 : 5} />
                  </g>
                );
              })}
              {ap ? (
                <circle cx={sx(ap.x)} cy={sy(ap.y)} r={11} fill="none" stroke="var(--chart-crosshair)" strokeWidth={1.5} />
              ) : null}
            </svg>
          );
          return { chart, tooltip: tip };
        }}
      />
      <SrTable
        caption={caption}
        columns={["Placa", "Modelo · local", "Hodômetro", "KM/dia", "KM no período", "Quadrante"]}
        rows={ordered.map((p) => ({
          key: p.key,
          cells: [
            p.plate,
            p.subtitle,
            fmtKm(p.x),
            `${fmt1(p.y)} km`,
            fmtKm(p.kmPeriod),
            p.quadrant ? KM_QUADRANT[p.quadrant]?.label ?? p.quadrant : "Sem quadrante",
          ],
        }))}
      />
      <p className="sr-only">{`${fmtInt(ordered.length)} pontos no gráfico.`}</p>
    </div>
  );
}
