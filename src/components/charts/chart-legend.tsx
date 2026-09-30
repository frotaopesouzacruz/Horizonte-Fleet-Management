import * as React from "react";
import { cn } from "@/lib/cn";

export interface ChartLegendItem {
  key: string;
  label: React.ReactNode;
  /** Token CSS da cor. */
  color: string;
  /** Forma da amostra: quadrado (barras), linha, tracejado (meta) ou ponto. */
  shape?: "square" | "line" | "dashed" | "dot";
}

/** Legenda compacta, sempre acima do desenho e na ordem das séries. */
export function ChartLegend({ items, className }: { items: ChartLegendItem[]; className?: string }) {
  return (
    <ul aria-label="Legenda" className={cn("flex flex-wrap items-center gap-x-4 gap-y-1 text-caption text-fg-secondary", className)}>
      {items.map((item) => (
        <li key={item.key} className="inline-flex items-center gap-1.5">
          <LegendSwatch color={item.color} shape={item.shape} />
          {item.label}
        </li>
      ))}
    </ul>
  );
}

export function LegendSwatch({ color, shape = "square" }: { color: string; shape?: ChartLegendItem["shape"] }) {
  if (shape === "line" || shape === "dashed") {
    return (
      <span aria-hidden className="inline-flex w-4 shrink-0 items-center">
        <span className="h-0 w-full border-t-2" style={{ borderColor: color, borderTopStyle: shape === "dashed" ? "dashed" : "solid" }} />
      </span>
    );
  }
  return (
    <span
      aria-hidden
      className={cn("size-2.5 shrink-0", shape === "dot" ? "rounded-full" : "rounded-[3px]")}
      style={{ background: color }}
    />
  );
}
