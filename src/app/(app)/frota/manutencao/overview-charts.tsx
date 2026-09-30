"use client";

import * as React from "react";
import { cn } from "@/lib/cn";
import {
  ChartLegend as KitLegend,
  ColumnChart as KitColumnChart,
  HBarChart as KitHBarChart,
  SrTable,
  chartFormat,
} from "@/components/charts";

export { SrTable, type SrTableProps } from "@/components/charts";

/**
 * Gráficos da Visão geral da Manutenção sobre o kit do HFM
 * (`@/components/charts`): a mesma gramática da Aderência — grade recessiva
 * em hairline, marcas com canto arredondado e base reta no eixo, valor escrito
 * junto à marca em cor de texto, tooltip no hover/teclado e uma tabela gêmea,
 * visível ou só para leitor de tela. Nada é recalculado aqui: os números
 * chegam prontos do servidor; a tela só dimensiona as marcas.
 *
 * Cores só pelos papéis `--chart-*`, em ordem fixa por entidade: o tipo de
 * manutenção tem sempre a mesma cor, em qualquer gráfico da aba.
 */

const nf = new Intl.NumberFormat("pt-BR");
const pct1 = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 });

export interface ChartSeries {
  key: string;
  label: string;
  /** Sempre um token: `var(--chart-…)`. */
  color: string;
}

/** Tipo de manutenção → cor. Mesma ordem e mesma cor em todos os gráficos. */
export const TYPE_SERIES: ChartSeries[] = [
  { key: "preventive", label: "Preventiva", color: "var(--chart-brand-primary)" },
  { key: "corrective", label: "Corretiva", color: "var(--chart-accent)" },
  { key: "predictive", label: "Preditiva", color: "var(--chart-brand-secondary)" },
  { key: "other", label: "Outros tipos", color: "var(--chart-neutral)" },
];
export const DEFAULT_BAR_COLOR = "var(--chart-brand-primary)";

export function typeColor(code: string): string {
  return (TYPE_SERIES.find((s) => s.key === code) ?? TYPE_SERIES[TYPE_SERIES.length - 1]).color;
}

// ---------------------------------------------------------------------------
// Legenda
// ---------------------------------------------------------------------------
export function ChartLegend({ series, className }: { series: ChartSeries[]; className?: string }) {
  return <KitLegend items={series.map((s) => ({ key: s.key, label: s.label, color: s.color }))} className={className} />;
}

// ---------------------------------------------------------------------------
// Colunas empilhadas (volume mensal por tipo)
// ---------------------------------------------------------------------------
export interface StackedColumnItem {
  key: string;
  /** Rótulo curto do eixo ("abr/26"). */
  label: string;
  /** Título do tooltip ("Abril/2026"). */
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
 * Colunas empilhadas na ordem da legenda (de baixo para cima) e o total
 * escrito acima de cada coluna. A composição por tipo fica no tooltip e na
 * tabela gêmea — um número em cada fatia viraria ruído.
 */
export function StackedColumnChart({ items, series, ariaLabel, className }: StackedColumnChartProps) {
  return (
    <KitColumnChart
      className={className}
      ariaLabel={ariaLabel}
      kind="count"
      format={chartFormat.int}
      axisFormat={chartFormat.compact}
      items={items.map((item) => ({
        key: item.key,
        label: item.label,
        value: item.total,
        segments: series.map((s) => ({ key: s.key, value: item.values[s.key] ?? 0, color: s.color })),
        tooltip: {
          title: item.title,
          rows: [
            ...series
              .filter((s) => (item.values[s.key] ?? 0) > 0)
              .map((s) => ({ label: s.label, value: nf.format(item.values[s.key] ?? 0), color: s.color, marker: "square" as const })),
            { label: "Total", value: nf.format(item.total), emphasis: true },
          ],
          announce: `${item.title}: ${nf.format(item.total)} manutenções`,
        },
      }))}
    />
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
  const sum = items.reduce((acc, i) => acc + i.value, 0);
  const share = (v: number) => (sum > 0 ? `${pct1.format((v / sum) * 100)}%` : "—");
  return (
    <div className={cn("min-w-0", className)}>
      <KitHBarChart
        ariaLabel={ariaLabel}
        kind="count"
        format={chartFormat.int}
        labelWidth={128}
        items={items.map((i) => ({
          key: i.key,
          label: i.label,
          value: i.value,
          color: i.color ?? DEFAULT_BAR_COLOR,
          detail: `· ${share(i.value)}`,
          tooltip: {
            title: i.label,
            rows: [
              { label: valueLabel, value: nf.format(i.value), color: i.color ?? DEFAULT_BAR_COLOR, marker: "square" as const, emphasis: true },
              { label: "Participação", value: share(i.value) },
            ],
            announce: `${i.label}: ${nf.format(i.value)} (${share(i.value)})`,
          },
        }))}
      />
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
  return (
    <div className={cn("min-w-0", className)}>
      <KitColumnChart
        ariaLabel={ariaLabel}
        kind="count"
        format={chartFormat.int}
        height={150}
        items={items.map((i) => ({
          key: i.key,
          label: i.label,
          value: i.value,
          tooltip: {
            title: i.title ?? i.label,
            rows: [{ label: valueLabel, value: nf.format(i.value), color: DEFAULT_BAR_COLOR, marker: "square" as const, emphasis: true }],
            announce: `${i.label}: ${nf.format(i.value)}`,
          },
        }))}
      />
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
    <span aria-hidden className={cn("relative block h-2 w-full min-w-12 overflow-hidden rounded-full bg-surface-sunken", className)}>
      <span className="absolute inset-y-0 left-0 rounded-full bg-chart-brand-primary" style={{ width: `${pct}%` }} />
    </span>
  );
}
