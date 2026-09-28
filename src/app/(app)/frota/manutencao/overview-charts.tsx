"use client";

import * as React from "react";
import { cn } from "@/lib/cn";

/**
 * Gráficos da Visão geral da Manutenção, em SVG puro — a mesma gramática da
 * Aderência: grade recessiva em hairline, marcas finas com ponta arredondada e
 * base reta no eixo, valor escrito junto à marca em cor de texto (nunca na cor
 * da série) e uma tabela gêmea, visível ou só para leitor de tela. Nada é
 * recalculado aqui: os números chegam prontos do servidor; a tela só dimensiona
 * as marcas.
 *
 * Cores só pelos tokens `--chart-*`, em ordem fixa por entidade: o tipo de
 * manutenção tem sempre a mesma cor, em qualquer gráfico da aba.
 */

const nf = new Intl.NumberFormat("pt-BR");
const pct1 = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 });

/** Espaço de superfície entre fatias empilhadas: separa as cores sem depender delas. */
const GAP = 2;

export interface ChartSeries {
  key: string;
  label: string;
  /** Sempre um token: `var(--color-chart-N)`. */
  color: string;
}

/** Tipo de manutenção → cor. Mesma ordem e mesma cor em todos os gráficos. */
export const TYPE_SERIES: ChartSeries[] = [
  { key: "preventive", label: "Preventiva", color: "var(--color-chart-1)" },
  { key: "corrective", label: "Corretiva", color: "var(--color-chart-3)" },
  { key: "predictive", label: "Preditiva", color: "var(--color-chart-2)" },
  { key: "other", label: "Outros tipos", color: "var(--color-chart-6)" },
];
export const DEFAULT_BAR_COLOR = "var(--color-chart-1)";

export function typeColor(code: string): string {
  return (TYPE_SERIES.find((s) => s.key === code) ?? TYPE_SERIES[TYPE_SERIES.length - 1]).color;
}

// ---------------------------------------------------------------------------
// Utilidades de desenho
// ---------------------------------------------------------------------------

/** Eixo "redondo" para contagens: passo inteiro, topo cobrindo o máximo. */
function niceScale(max: number, ticks = 4): { top: number; step: number } {
  if (max <= 0) return { top: 4, step: 1 };
  const raw = max / ticks;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / mag;
  const nice = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10;
  const step = Math.max(1, Math.ceil(nice * mag));
  return { top: Math.ceil(max / step) * step, step };
}

/** Coluna com topo arredondado em 4px e base reta na linha de base. */
function columnPath(x: number, top: number, base: number, w: number, r = 4): string {
  const rr = Math.max(0, Math.min(r, base - top, w / 2));
  return `M${x},${base} V${top + rr} a${rr},${rr} 0 0 1 ${rr},${-rr} h${w - 2 * rr} a${rr},${rr} 0 0 1 ${rr},${rr} V${base} Z`;
}

/** Barra horizontal com ponta arredondada em 4px e base reta no eixo. */
function barPath(x0: number, cy: number, w: number, h: number, r = 4): string {
  const rr = Math.max(0, Math.min(r, w, h / 2));
  const straight = Math.max(0, w - rr);
  return `M${x0},${cy - h / 2} h${straight} a${rr},${rr} 0 0 1 ${rr},${rr} v${h - 2 * rr} a${rr},${rr} 0 0 1 ${-rr},${rr} h${-straight} Z`;
}

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** O SVG escala com o cartão, mas nunca vira pôster: no máximo 1,25× o desenho. */
function svgStyle(width: number, minWidth: number): React.CSSProperties {
  return { fontFamily: "inherit", maxWidth: `${Math.round(width * 1.25)}px`, minWidth: `${Math.round(minWidth)}px` };
}

// ---------------------------------------------------------------------------
// Tabela gêmea só para leitor de tela
// ---------------------------------------------------------------------------
export interface SrTableProps {
  caption: string;
  columns: string[];
  rows: { key: string; cells: React.ReactNode[] }[];
}

/**
 * O que o gráfico mostra, em linhas e colunas — para quem não enxerga o desenho.
 * O `sr-only` fica num div: uma tabela ignora a largura de 1 px e esticaria a
 * página no celular.
 */
export function SrTable({ caption, columns, rows }: SrTableProps) {
  return (
    <div className="sr-only">
      <table>
        <caption>{caption}</caption>
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c} scope="col">{c}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key}>
              {r.cells.map((cell, i) =>
                i === 0 ? <th key={i} scope="row">{cell}</th> : <td key={i}>{cell}</td>,
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Legenda
// ---------------------------------------------------------------------------
export function ChartLegend({ series, className }: { series: ChartSeries[]; className?: string }) {
  return (
    <ul
      aria-label="Legenda"
      className={cn("flex flex-wrap items-center gap-x-4 gap-y-1 text-caption text-fg-secondary", className)}
    >
      {series.map((s) => (
        <li key={s.key} className="inline-flex items-center gap-1.5">
          <span aria-hidden className="size-2.5 shrink-0 rounded-xs" style={{ background: s.color }} />
          {s.label}
        </li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------------------
// Colunas empilhadas (volume mensal por tipo)
// ---------------------------------------------------------------------------
export interface StackedColumnItem {
  key: string;
  /** Rótulo curto do eixo ("abr/26"). */
  label: string;
  /** Texto completo do tooltip nativo. */
  title: string;
  values: Record<string, number>;
  total: number;
}

export interface StackedColumnChartProps {
  items: StackedColumnItem[];
  series: ChartSeries[];
  ariaLabel: string;
  className?: string;
}

/**
 * Colunas empilhadas na ordem da legenda (de baixo para cima), 2px de
 * superfície entre as fatias e o total escrito acima de cada coluna. A
 * composição por tipo fica na tabela gêmea — um número em cada fatia viraria
 * ruído.
 */
export function StackedColumnChart({ items, series, ariaLabel, className }: StackedColumnChartProps) {
  const many = items.length > 12;
  const slot = many ? 44 : Math.max(52, Math.min(88, Math.floor(560 / Math.max(items.length, 1))));
  const barWidth = many ? 22 : 30;
  const left = 36;
  const right = 8;
  const top = 22;
  const bottom = 26;
  const plotHeight = 170;
  const width = left + right + slot * Math.max(items.length, 1);
  const height = top + plotHeight + bottom;
  const max = items.reduce((acc, i) => Math.max(acc, i.total), 0);
  const scale = niceScale(max);
  const y = (v: number) => top + plotHeight - (Math.max(0, v) / scale.top) * plotHeight;
  const ticks: number[] = [];
  for (let t = 0; t <= scale.top; t += scale.step) ticks.push(t);

  return (
    <div tabIndex={0} className={cn("overflow-x-auto rounded-sm hfm-focus-ring", className)}>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={ariaLabel}
        className="h-auto w-full text-fg"
        style={svgStyle(width, width * 0.75)}
      >
        {ticks.map((t) => (
          <g key={t}>
            <line x1={left} x2={width - right} y1={y(t)} y2={y(t)} stroke="var(--color-chart-grid)" strokeWidth="1" />
            <text x={left - 6} y={y(t) + 3.5} textAnchor="end" fontSize="10" fill="currentColor" className="text-fg-muted tabular-nums">
              {nf.format(t)}
            </text>
          </g>
        ))}

        {items.map((item, i) => {
          const cx = left + slot * i + slot / 2;
          const x = cx - barWidth / 2;
          const visible = series.filter((s) => (item.values[s.key] ?? 0) > 0);
          let acc = 0;
          return (
            <g key={item.key}>
              <title>{item.title}</title>
              {/* Área de toque maior que a marca: a coluna inteira responde ao hover. */}
              <rect x={left + slot * i} y={top} width={slot} height={plotHeight} fill="transparent" />
              {visible.map((s, idx) => {
                const v = item.values[s.key] ?? 0;
                const y0 = y(acc);
                acc += v;
                const y1 = y(acc);
                const base = idx === 0 ? y0 : y0 - GAP;
                if (base - y1 < 0.75) return null;
                return idx === visible.length - 1 ? (
                  <path key={s.key} d={columnPath(x, y1, base, barWidth)} fill={s.color} />
                ) : (
                  <rect key={s.key} x={x} y={y1} width={barWidth} height={base - y1} fill={s.color} />
                );
              })}
              <text
                x={cx}
                y={y(item.total) - 6}
                textAnchor="middle"
                fontSize="10.5"
                fontWeight={600}
                fill="currentColor"
                stroke="var(--color-surface)"
                strokeWidth="3"
                paintOrder="stroke"
                className={cn("tabular-nums", item.total > 0 ? "text-fg" : "text-fg-muted")}
              >
                {nf.format(item.total)}
              </text>
              <text x={cx} y={top + plotHeight + 16} textAnchor="middle" fontSize="10.5" fill="currentColor" className="text-fg-muted">
                {item.label}
              </text>
            </g>
          );
        })}

        <line x1={left} x2={width - right} y1={y(0)} y2={y(0)} stroke="var(--color-chart-axis)" strokeWidth="1" />
      </svg>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Barras horizontais de contagem (mix por tipo, por situação)
// ---------------------------------------------------------------------------
export interface CountBarItem {
  key: string;
  label: string;
  value: number;
  /** Cor da entidade (tipo); sem ela, a série única. */
  color?: string;
}

export interface CountBarChartProps {
  items: CountBarItem[];
  ariaLabel: string;
  /** Rótulo da coluna de valores na tabela gêmea. */
  valueLabel?: string;
  /** Dimensão na tabela gêmea ("Tipo", "Situação"). */
  dimensionLabel: string;
  className?: string;
}

/** Contagem por categoria: barra, número e participação escritos na ponta. */
export function CountBarChart({ items, ariaLabel, valueLabel = "Quantidade", dimensionLabel, className }: CountBarChartProps) {
  const rowHeight = 26;
  const barHeight = 12;
  const labelWidth = 112;
  const plotWidth = 150;
  const valueWidth = 84;
  const top = 4;
  const width = labelWidth + plotWidth + valueWidth;
  const height = top * 2 + rowHeight * Math.max(items.length, 1);
  const max = items.reduce((acc, i) => Math.max(acc, i.value), 0);
  const sum = items.reduce((acc, i) => acc + i.value, 0);
  const share = (v: number) => (sum > 0 ? `${pct1.format((v / sum) * 100)}%` : "—");

  return (
    <div tabIndex={0} className={cn("overflow-x-auto rounded-sm hfm-focus-ring", className)}>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={ariaLabel}
        className="h-auto w-full text-fg"
        style={svgStyle(width, 288)}
      >
        {items.map((item, i) => {
          const cy = top + rowHeight * i + rowHeight / 2;
          const w = max > 0 ? (item.value / max) * plotWidth : 0;
          return (
            <g key={item.key}>
              <title>{`${item.label}: ${nf.format(item.value)} (${share(item.value)})`}</title>
              <rect x={0} y={top + rowHeight * i} width={width} height={rowHeight} fill="transparent" />
              <text x={labelWidth - 8} y={cy + 3.5} textAnchor="end" fontSize="10.5" fill="currentColor" className="text-fg">
                {clip(item.label, 18)}
              </text>
              {w > 0.75 ? <path d={barPath(labelWidth, cy, w, barHeight)} fill={item.color ?? DEFAULT_BAR_COLOR} /> : null}
              <text x={labelWidth + w + 6} y={cy + 3.5} fontSize="10.5" fill="currentColor" className="tabular-nums text-fg">
                <tspan fontWeight={600}>{nf.format(item.value)}</tspan>
                <tspan className="text-fg-muted" fill="currentColor">{` · ${share(item.value)}`}</tspan>
              </text>
            </g>
          );
        })}
        <line x1={labelWidth} x2={labelWidth} y1={top} y2={height - top} stroke="var(--color-chart-axis)" strokeWidth="1" />
      </svg>
      <SrTable
        caption={ariaLabel}
        columns={[dimensionLabel, valueLabel, "Participação"]}
        rows={items.map((i) => ({ key: i.key, cells: [i.label, nf.format(i.value), share(i.value)] }))}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Colunas simples (aging por faixa)
// ---------------------------------------------------------------------------
export interface ColumnItem {
  key: string;
  label: string;
  value: number;
  title?: string;
}

export interface ColumnChartProps {
  items: ColumnItem[];
  ariaLabel: string;
  dimensionLabel: string;
  valueLabel?: string;
  className?: string;
}

/** Uma série, uma cor: colunas por faixa ordenada, valor escrito acima. */
export function ColumnChart({ items, ariaLabel, dimensionLabel, valueLabel = "Quantidade", className }: ColumnChartProps) {
  const slot = 72;
  const barWidth = 30;
  const left = 30;
  const right = 6;
  const top = 20;
  const bottom = 26;
  const plotHeight = 130;
  const width = left + right + slot * Math.max(items.length, 1);
  const height = top + plotHeight + bottom;
  const max = items.reduce((acc, i) => Math.max(acc, i.value), 0);
  const scale = niceScale(max, 3);
  const y = (v: number) => top + plotHeight - (Math.max(0, v) / scale.top) * plotHeight;
  const ticks: number[] = [];
  for (let t = 0; t <= scale.top; t += scale.step) ticks.push(t);

  return (
    <div tabIndex={0} className={cn("overflow-x-auto rounded-sm hfm-focus-ring", className)}>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={ariaLabel}
        className="h-auto w-full text-fg"
        style={svgStyle(width, Math.min(width, 300))}
      >
        {ticks.map((t) => (
          <g key={t}>
            <line x1={left} x2={width - right} y1={y(t)} y2={y(t)} stroke="var(--color-chart-grid)" strokeWidth="1" />
            <text x={left - 6} y={y(t) + 3.5} textAnchor="end" fontSize="10" fill="currentColor" className="text-fg-muted tabular-nums">
              {nf.format(t)}
            </text>
          </g>
        ))}
        {items.map((item, i) => {
          const cx = left + slot * i + slot / 2;
          const x = cx - barWidth / 2;
          const barTop = y(item.value);
          return (
            <g key={item.key}>
              <title>{item.title ?? `${item.label}: ${nf.format(item.value)}`}</title>
              <rect x={left + slot * i} y={top} width={slot} height={plotHeight} fill="transparent" />
              {y(0) - barTop > 0.75 ? <path d={columnPath(x, barTop, y(0), barWidth)} fill={DEFAULT_BAR_COLOR} /> : null}
              <text
                x={cx}
                y={barTop - 6}
                textAnchor="middle"
                fontSize="10.5"
                fontWeight={600}
                fill="currentColor"
                className={cn("tabular-nums", item.value > 0 ? "text-fg" : "text-fg-muted")}
              >
                {nf.format(item.value)}
              </text>
              <text x={cx} y={top + plotHeight + 16} textAnchor="middle" fontSize="10.5" fill="currentColor" className="text-fg-muted">
                {clip(item.label, 12)}
              </text>
            </g>
          );
        })}
        <line x1={left} x2={width - right} y1={y(0)} y2={y(0)} stroke="var(--color-chart-axis)" strokeWidth="1" />
      </svg>
      <SrTable
        caption={ariaLabel}
        columns={[dimensionLabel, valueLabel]}
        rows={items.map((i) => ({ key: i.key, cells: [i.label, nf.format(i.value)] }))}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Barra inline (dentro de tabela)
// ---------------------------------------------------------------------------

/**
 * Barra de magnitude para uma célula de tabela. Decorativa: o número está
 * escrito ao lado, na mesma célula.
 */
export function InlineBar({ value, max, className }: { value: number; max: number; className?: string }) {
  const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  return (
    <span aria-hidden className={cn("relative block h-2 w-full min-w-12 overflow-hidden rounded-xs bg-chart-grid", className)}>
      <span className="absolute inset-y-0 left-0 rounded-xs bg-chart-1" style={{ width: `${pct}%` }} />
    </span>
  );
}
