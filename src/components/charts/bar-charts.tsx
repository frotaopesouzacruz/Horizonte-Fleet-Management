"use client";

import * as React from "react";
import { ChartFrame, type ChartTooltipContent } from "./chart-frame";
import { approxTextWidth, barPath, clip, columnPath, niceScale, ticksOf } from "./chart-utils";

/**
 * Barras do HFM — colunas (verticais, simples ou empilhadas) e barras
 * horizontais. Mesma gramática da linha: grade horizontal em hairline, marca
 * com canto arredondado e base reta no eixo, valor escrito junto à marca em cor
 * de texto, meta tracejada em dourado profundo e tooltip no hover/teclado.
 */

/** Token CSS de cor da marca (ex.: `var(--chart-brand-primary)`). */
export type ChartColor = string;

export interface ColumnSegment {
  key: string;
  value: number;
  color: ChartColor;
}

export interface ColumnDatum {
  key: string;
  label: string;
  /** Valor total da coluna; nulo = sem base. */
  value: number | null;
  /** Fatias empilhadas (de baixo para cima). Sem elas, a coluna é uma cor só. */
  segments?: ColumnSegment[];
  color?: ChartColor;
  future?: boolean;
  current?: boolean;
  tooltip?: ChartTooltipContent;
}

export interface ColumnChartProps {
  items: ColumnDatum[];
  ariaLabel: string;
  format: (value: number) => string;
  axisFormat?: (value: number) => string;
  /** "percent" fixa 0–100; "count" começa em zero com passo inteiro. */
  kind?: "percent" | "count" | "number";
  target?: number | null;
  targetLabel?: string;
  height?: number;
  /** Escreve o valor acima de cada coluna (padrão: sim). */
  showValues?: boolean;
  onSelect?: (item: ColumnDatum, index: number) => void;
  className?: string;
  /** Texto para coluna sem valor (padrão "Sem base"; ex.: "Sem leitura"). */
  emptyLabel?: string;
}

const HATCH = "hfm-col-future-";

export function ColumnChart({
  items, ariaLabel, format, axisFormat, kind = "count", target = null, targetLabel, height = 180, showValues = true,
  onSelect, className, emptyLabel = "Sem base",
}: ColumnChartProps) {
  const uid = React.useId().replace(/:/g, "");
  const [active, setActive] = React.useState<number | null>(null);
  const max = items.reduce((acc, i) => Math.max(acc, i.value ?? 0), target ?? 0);
  const scale = kind === "percent" ? { min: 0, max: 100, step: 25 } : niceScale(0, Math.max(max, 1), 4, kind === "count");
  const ticks = ticksOf(scale);
  const fmtAxis = axisFormat ?? format;
  const tLabel = target != null ? targetLabel ?? `Meta ${format(target)}` : "";

  return (
    <ChartFrame
      ariaLabel={ariaLabel}
      count={items.length}
      active={active}
      onActiveChange={setActive}
      onActivate={onSelect ? (i) => onSelect(items[i], i) : undefined}
      className={className}
      render={(width) => {
        // Margem do eixo pelo rótulo mais largo ("85.000" não perde o primeiro dígito).
        const left = Math.max(36, Math.round(Math.max(...ticks.map((t) => approxTextWidth(fmtAxis(t), 11))) + 14));
        const right = target != null ? Math.max(16, Math.min(84, approxTextWidth(tLabel) + 14)) : 12;
        const top = 22;
        const bottom = 28;
        const plotW = Math.max(120, width - left - right);
        const slot = plotW / Math.max(items.length, 1);
        const barW = Math.max(10, Math.min(36, slot * 0.56));
        const totalH = top + height + bottom;
        const y = (v: number) => top + height - ((Math.max(scale.min, Math.min(scale.max, v)) - scale.min) / (scale.max - scale.min)) * height;
        const labelMax = Math.max(3, Math.floor(slot / 6.5));
        const labelEvery = slot >= 30 ? 1 : slot >= 18 ? 2 : 3;
        const activeItem = active != null ? items[active] : null;
        const tip = activeItem?.tooltip
          ? { content: activeItem.tooltip, x: left + slot * (active as number) + slot / 2, y: y(activeItem.value ?? 0) }
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
              const i = Math.floor((e.clientX - rect.left - left) / slot);
              setActive(i >= 0 && i < items.length ? i : null);
            }}
            onClick={() => {
              if (active != null && onSelect) onSelect(items[active], active);
            }}
          >
            <defs>
              <pattern id={`${HATCH}${uid}`} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                <line x1="0" y1="0" x2="0" y2="6" stroke="var(--chart-future)" strokeWidth="1" />
              </pattern>
            </defs>

            {ticks.map((t) => (
              <g key={t}>
                <line x1={left} x2={left + plotW} y1={y(t)} y2={y(t)} stroke="var(--chart-grid)" strokeWidth="1" />
                <text x={left - 8} y={y(t) + 4} textAnchor="end" fontSize="11" fill="var(--chart-label)" className="tabular-nums">
                  {fmtAxis(t)}
                </text>
              </g>
            ))}

            {active != null ? (
              <rect x={left + slot * active} y={top} width={slot} height={height} fill="var(--chart-hover-band)" rx="4" />
            ) : null}

            {items.map((item, i) => {
              const cx = left + slot * i + slot / 2;
              const x = cx - barW / 2;
              const base = y(scale.min);
              const hasValue = item.value != null && !item.future;
              const barTop = hasValue ? y(item.value as number) : base;
              const segs = item.segments?.filter((s) => s.value > 0) ?? [];
              let acc = 0;
              const valueText = item.future ? "—" : item.value == null ? emptyLabel : format(item.value);
              // Rótulo de valor contido no gráfico: na primeira/última coluna ele
              // encosta na borda em vez de ser cortado ("2.137 km" no dia 30).
              const half = (approxTextWidth(valueText, 11) * 1.08) / 2 + 2;
              const vx = Math.min(Math.max(cx, half), width - half);
              return (
                <g key={item.key}>
                  {item.future ? (
                    <rect x={x} y={top + height * 0.6} width={barW} height={height * 0.4} rx="4"
                      fill={`url(#${HATCH}${uid})`} stroke="var(--chart-future)" strokeWidth="1" strokeDasharray="3 3" />
                  ) : hasValue && base - barTop > 0.75 ? (
                    segs.length > 0 ? (
                      segs.map((s, idx) => {
                        const y0 = y(acc);
                        acc += s.value;
                        const y1 = y(acc);
                        const bottomEdge = idx === 0 ? y0 : y0 - 1.5;
                        if (bottomEdge - y1 < 0.75) return null;
                        return idx === segs.length - 1 ? (
                          <path key={s.key} d={columnPath(x, y1, bottomEdge, barW)} fill={s.color} />
                        ) : (
                          <rect key={s.key} x={x} y={y1} width={barW} height={bottomEdge - y1} fill={s.color} />
                        );
                      })
                    ) : (
                      <path d={columnPath(x, barTop, base, barW)} fill={item.color ?? "var(--chart-brand-primary)"} />
                    )
                  ) : null}
                  {(showValues && labelEvery === 1) || active === i || item.current ? (
                    <text
                      x={vx}
                      y={(hasValue ? barTop : top + height) - 7}
                      textAnchor="middle"
                      fontSize="11"
                      fontWeight={item.current || active === i ? 700 : 600}
                      fill={hasValue ? "currentColor" : "var(--chart-label)"}
                      stroke="var(--surface-raised)"
                      strokeWidth="3"
                      paintOrder="stroke"
                      className="tabular-nums"
                    >
                      {valueText}
                    </text>
                  ) : null}
                  {i % labelEvery === 0 || item.current || active === i ? (
                    <text
                      x={cx}
                      y={top + height + 18}
                      textAnchor="middle"
                      fontSize="11"
                      fontWeight={item.current ? 700 : 500}
                      fill={item.current ? "currentColor" : "var(--chart-label)"}
                    >
                      {clip(item.label, Math.max(labelMax, labelEvery > 1 ? 3 : labelMax))}
                    </text>
                  ) : null}
                </g>
              );
            })}

            <line x1={left} x2={left + plotW} y1={y(scale.min)} y2={y(scale.min)} stroke="var(--chart-axis-line)" strokeWidth="1" />
            {target != null ? (
              <g>
                <line x1={left} x2={left + plotW} y1={y(target)} y2={y(target)} stroke="var(--chart-target)" strokeWidth="2" strokeDasharray="6 4" />
                <text x={left + plotW + 6} y={y(target) + 4} fontSize="11" fontWeight={600} fill="var(--chart-target-label)" className="tabular-nums">
                  {tLabel}
                </text>
              </g>
            ) : null}
          </svg>
        );
        return { chart, tooltip: tip };
      }}
    />
  );
}

/* -------------------------------------------------------------------------- */

export interface HBarDatum {
  key: string;
  label: string;
  value: number | null;
  color?: ChartColor;
  /** Texto secundário escrito após o valor ("· 12%", "8/9"). */
  detail?: string;
  tooltip?: ChartTooltipContent;
}

export interface HBarChartProps {
  items: HBarDatum[];
  ariaLabel: string;
  format: (value: number) => string;
  /** "percent" fixa 0–100; "count" escala pelo maior valor. */
  kind?: "percent" | "count";
  target?: number | null;
  targetLabel?: string;
  onSelect?: (item: HBarDatum, index: number) => void;
  className?: string;
  /** Largura máxima da coluna de rótulos, em px. */
  labelWidth?: number;
}

export function HBarChart({
  items, ariaLabel, format, kind = "count", target = null, targetLabel, onSelect, className, labelWidth = 168,
}: HBarChartProps) {
  const [active, setActive] = React.useState<number | null>(null);
  const max = kind === "percent" ? 100 : Math.max(1, ...items.map((i) => i.value ?? 0));
  const tLabel = target != null ? targetLabel ?? `Meta ${format(target)}` : "";

  return (
    <ChartFrame
      ariaLabel={ariaLabel}
      count={items.length}
      active={active}
      onActiveChange={setActive}
      orientation="vertical"
      onActivate={onSelect ? (i) => onSelect(items[i], i) : undefined}
      className={className}
      minWidth={240}
      render={(width) => {
        const rowH = 30;
        const barH = 14;
        const top = 6;
        const bottom = target != null ? 22 : 6;
        const lw = Math.min(labelWidth, Math.max(96, Math.round(width * 0.3)));
        // A coluna de valor cresce com o texto mais longo (valor + detalhe), para
        // nunca cortar "160.945 km · 64 veíc."; o rótulo e a barra cedem espaço.
        const valueChars = Math.max(
          6,
          ...items.map((i) => (i.value != null ? format(i.value).length : 8) + (i.detail ? i.detail.length + 1 : 0)),
        );
        const valueW = Math.min(Math.round(width * 0.42), Math.max(64, Math.round(valueChars * 6.9) + 14));
        const plotW = Math.max(80, width - lw - valueW);
        const totalH = top + rowH * Math.max(items.length, 1) + bottom;
        const x = (v: number) => lw + (Math.max(0, Math.min(max, v)) / max) * plotW;
        const activeItem = active != null ? items[active] : null;
        const tip = activeItem?.tooltip
          ? { content: activeItem.tooltip, x: x(activeItem.value ?? 0), y: top + rowH * (active as number) + rowH / 2 }
          : null;
        const labelChars = Math.max(8, Math.floor((lw - 12) / 6.4));

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
              const i = Math.floor((e.clientY - rect.top - top) / rowH);
              setActive(i >= 0 && i < items.length ? i : null);
            }}
            onClick={() => {
              if (active != null && onSelect) onSelect(items[active], active);
            }}
          >
            {(kind === "percent" ? [0, 25, 50, 75, 100] : [0, max / 2, max]).map((t) => (
              <line key={t} x1={x(t)} x2={x(t)} y1={top} y2={top + rowH * items.length} stroke="var(--chart-grid)" strokeWidth="1" />
            ))}

            {items.map((item, i) => {
              const cy = top + rowH * i + rowH / 2;
              const hasValue = item.value != null;
              const end = hasValue ? x(item.value as number) : lw;
              const w = Math.max(0, end - lw);
              return (
                <g key={item.key}>
                  {active === i ? <rect x={0} y={top + rowH * i} width={width} height={rowH} fill="var(--chart-hover-band)" rx="4" /> : null}
                  <text x={lw - 10} y={cy + 4} textAnchor="end" fontSize="12" fill="currentColor">
                    {clip(item.label, labelChars)}
                  </text>
                  <rect x={lw} y={cy - barH / 2} width={plotW} height={barH} rx="4" fill="var(--surface-sunken)" />
                  {hasValue && w > 0.75 ? (
                    <path d={barPath(lw, cy, w, barH)} fill={item.color ?? "var(--chart-brand-primary)"} />
                  ) : null}
                  <text x={lw + plotW + 8} y={cy + 4} fontSize="12" fill="currentColor" className="tabular-nums">
                    <tspan fontWeight={600} fill={hasValue ? "currentColor" : "var(--chart-label)"}>
                      {hasValue ? format(item.value as number) : "Sem base"}
                    </tspan>
                    {item.detail ? <tspan fill="var(--chart-label)">{` ${item.detail}`}</tspan> : null}
                  </text>
                </g>
              );
            })}

            {target != null ? (
              <g>
                <line x1={x(target)} x2={x(target)} y1={top - 2} y2={top + rowH * items.length + 2}
                  stroke="var(--chart-target)" strokeWidth="2" strokeDasharray="6 4" />
                <text x={x(target)} y={top + rowH * items.length + 16} textAnchor="middle" fontSize="11" fontWeight={600}
                  fill="var(--chart-target-label)" className="tabular-nums">
                  {tLabel}
                </text>
              </g>
            ) : null}
          </svg>
        );
        return { chart, tooltip: tip };
      }}
    />
  );
}
