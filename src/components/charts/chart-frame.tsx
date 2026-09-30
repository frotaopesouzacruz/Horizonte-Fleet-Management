"use client";

import * as React from "react";
import { cn } from "@/lib/cn";

/**
 * Moldura interativa dos gráficos do HFM.
 *
 * - mede a largura real do cartão (ResizeObserver) e entrega ao desenho, que
 *   então trabalha em pixels de verdade — o texto do eixo nunca escala;
 * - controla o item ativo por ponteiro e por teclado (setas, Home/End, Esc),
 *   com um anúncio discreto para leitores de tela;
 * - posiciona o tooltip, que nunca sai do cartão.
 */

export interface ChartTooltipRow {
  label: React.ReactNode;
  value: React.ReactNode;
  /** Cor da marca da linha (token CSS). */
  color?: string;
  /** Forma da marca: linha contínua, tracejada (meta) ou ponto. */
  marker?: "dot" | "line" | "dashed" | "square";
  /** Valor em tom semântico (desvio negativo, abaixo da meta…). */
  tone?: "success" | "warning" | "danger" | "muted";
  /** Linha de destaque (a métrica principal do ponto). */
  emphasis?: boolean;
}

export interface ChartTooltipContent {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  rows: ChartTooltipRow[];
  footer?: React.ReactNode;
  /** Texto corrido para o anúncio de leitor de tela. */
  announce?: string;
}

const TONE_CLASS: Record<NonNullable<ChartTooltipRow["tone"]>, string> = {
  success: "text-success-soft-fg",
  warning: "text-warning-soft-fg",
  danger: "text-danger-soft-fg",
  muted: "text-fg-muted",
};

function Marker({ color, marker = "dot" }: { color?: string; marker?: ChartTooltipRow["marker"] }) {
  if (!color) return <span aria-hidden className="size-2 shrink-0" />;
  if (marker === "line" || marker === "dashed") {
    return (
      <span aria-hidden className="inline-flex w-3 shrink-0 items-center">
        <span
          className="h-0 w-full border-t-2"
          style={{ borderColor: color, borderTopStyle: marker === "dashed" ? "dashed" : "solid" }}
        />
      </span>
    );
  }
  return (
    <span
      aria-hidden
      className={cn("size-2 shrink-0", marker === "square" ? "rounded-[2px]" : "rounded-full")}
      style={{ background: color }}
    />
  );
}

/** Conteúdo do tooltip — também usado fora dos gráficos (heatmap, mapas de calor). */
export function ChartTooltipCard({ content, className }: { content: ChartTooltipContent; className?: string }) {
  return (
    <div
      className={cn(
        "pointer-events-none min-w-44 max-w-72 rounded-md border border-chart-tooltip-border bg-chart-tooltip px-3 py-2.5 text-fg shadow-md",
        className,
      )}
    >
      <p className="text-caption font-semibold text-fg">{content.title}</p>
      {content.subtitle ? <p className="text-caption text-fg-muted">{content.subtitle}</p> : null}
      {content.rows.length > 0 ? (
        <dl className="mt-1.5 flex flex-col gap-1">
          {content.rows.map((row, i) => (
            <div key={i} className="flex items-center gap-2 text-caption">
              <Marker color={row.color} marker={row.marker} />
              <dt className="min-w-0 flex-1 truncate text-fg-secondary">{row.label}</dt>
              <dd
                className={cn(
                  "shrink-0 tabular-nums",
                  row.emphasis ? "font-semibold text-fg" : "font-medium text-fg",
                  row.tone ? TONE_CLASS[row.tone] : null,
                )}
              >
                {row.value}
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
      {content.footer ? <p className="mt-1.5 border-t border-border-subtle pt-1.5 text-caption text-fg-muted">{content.footer}</p> : null}
    </div>
  );
}

/** Largura do elemento, atualizada quando o cartão muda de tamanho. */
export function useElementWidth<T extends HTMLElement>(fallback = 640): [React.RefObject<T | null>, number] {
  const ref = React.useRef<T | null>(null);
  const [width, setWidth] = React.useState(fallback);
  React.useLayoutEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      const next = Math.round(entries[0]?.contentRect.width ?? 0);
      if (next > 0) setWidth((prev) => (Math.abs(prev - next) >= 1 ? next : prev));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return [ref, width];
}

export interface ChartTooltipAnchorProps {
  content: ChartTooltipContent;
  /** Âncora em px, relativa à moldura. */
  x: number;
  y: number;
}

export interface ChartFrameRender {
  chart: React.ReactNode;
  tooltip?: ChartTooltipAnchorProps | null;
}

export interface ChartFrameProps {
  /** Nome acessível do gráfico (vai para o `role="img"` do desenho). */
  ariaLabel: string;
  /** Quantidade de itens navegáveis por teclado. */
  count: number;
  active: number | null;
  onActiveChange: (index: number | null) => void;
  /** Orientação da navegação por setas. */
  orientation?: "horizontal" | "vertical";
  /** Clique/Enter no item ativo (drill-down). */
  onActivate?: (index: number) => void;
  className?: string;
  /** Desenha o gráfico na largura medida e devolve o tooltip do item ativo. */
  render: (width: number) => ChartFrameRender;
  minWidth?: number;
}

export function ChartFrame({
  ariaLabel, count, active, onActiveChange, orientation = "horizontal", onActivate, className, render, minWidth = 240,
}: ChartFrameProps) {
  const [ref, measured] = useElementWidth<HTMLDivElement>();
  const width = Math.max(minWidth, measured);
  const { chart, tooltip } = render(width);

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (count === 0) return;
    const next = orientation === "horizontal" ? ["ArrowRight", "ArrowDown"] : ["ArrowDown", "ArrowRight"];
    const prev = orientation === "horizontal" ? ["ArrowLeft", "ArrowUp"] : ["ArrowUp", "ArrowLeft"];
    if (next.includes(event.key)) {
      event.preventDefault();
      onActiveChange(active == null ? 0 : Math.min(count - 1, active + 1));
    } else if (prev.includes(event.key)) {
      event.preventDefault();
      onActiveChange(active == null ? count - 1 : Math.max(0, active - 1));
    } else if (event.key === "Home") {
      event.preventDefault();
      onActiveChange(0);
    } else if (event.key === "End") {
      event.preventDefault();
      onActiveChange(count - 1);
    } else if (event.key === "Escape") {
      onActiveChange(null);
    } else if ((event.key === "Enter" || event.key === " ") && active != null && onActivate) {
      event.preventDefault();
      onActivate(active);
    }
  };

  // O tooltip fica ao lado da marca e vira para o outro lado na metade direita:
  // sem medir o cartão do tooltip, sem sair da moldura.
  const flip = tooltip ? tooltip.x > width / 2 : false;

  return (
    <div ref={ref} className={cn("relative w-full min-w-0", className)}>
      {/* A própria área rolável recebe o foco: quem navega por teclado alcança
          o gráfico e, quando ele é mais largo que o cartão, também o rola. */}
      <div
        tabIndex={0}
        role="group"
        aria-label={`${ariaLabel}. Use as setas para percorrer os pontos.`}
        onKeyDown={onKeyDown}
        onBlur={() => onActiveChange(null)}
        onMouseLeave={() => onActiveChange(null)}
        className="overflow-x-auto overflow-y-hidden rounded-sm hfm-focus-ring"
      >
        {chart}
      </div>
      {tooltip ? (
        <div
          className="pointer-events-none absolute z-10"
          style={{
            left: tooltip.x,
            top: Math.max(48, tooltip.y),
            transform: flip ? "translate(calc(-100% - 14px), -50%)" : "translate(14px, -50%)",
            transition: "left var(--duration-fast) var(--ease-out), top var(--duration-fast) var(--ease-out)",
          }}
        >
          <ChartTooltipCard content={tooltip.content} className="animate-fade-in" />
        </div>
      ) : null}
      <p className="sr-only" aria-live="polite">
        {tooltip?.content.announce ?? ""}
      </p>
    </div>
  );
}
