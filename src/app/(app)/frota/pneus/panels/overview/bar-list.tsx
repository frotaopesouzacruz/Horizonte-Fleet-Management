"use client";

import * as React from "react";
import { Check, ChevronDown, ChevronUp } from "lucide-react";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { fmtInt } from "@/lib/tires/types";

/**
 * Barras horizontais da Visão Geral, em HTML: cada linha é um botão de verdade
 * (Tab, Enter, foco visível) que aplica o filtro do item à tela, com o estado
 * "filtro aplicado" em `aria-pressed` e numa marca de seleção — nunca só na
 * cor. O valor fica escrito ao lado da barra; a barra só dá a proporção.
 * Fatias empilhadas (conformes × não conformes) são separadas por um filete
 * da superfície.
 */
export interface BarSegment {
  key: string;
  value: number;
  /** Token CSS da cor (ex.: `var(--chart-success)`). */
  color: string;
}

export interface BarRow {
  key: string;
  label: string;
  /** Comprimento da barra (o total do item). */
  value: number;
  /** Fatias; sem elas a barra tem uma cor só (`color`). */
  segments?: BarSegment[];
  color?: string;
  /** Texto curto depois do valor ("· 70,0% conformes"). */
  detail?: string;
  /** Complemento para leitor de tela (o que a cor das fatias diz). */
  srText?: string;
  /** Este item é o filtro aplicado. */
  active?: boolean;
  /** Sem ação = linha só de leitura. */
  onSelect?: () => void;
}

export function BarList({
  rows, ariaLabel, limit = 8, density = "regular", disabled = false, testId, emptyText = "Nenhum pneu neste recorte.",
}: {
  rows: BarRow[];
  ariaLabel: string;
  /** Linhas visíveis antes de "Mostrar todos". */
  limit?: number;
  /** "compact" para colunas estreitas (rótulos mais curtos). */
  density?: "regular" | "compact";
  disabled?: boolean;
  testId?: string;
  emptyText?: string;
}) {
  const [expanded, setExpanded] = React.useState(false);
  const listId = React.useId();
  if (rows.length === 0) return <p className="py-2 text-body-sm text-fg-muted">{emptyText}</p>;

  const max = Math.max(1, ...rows.map((r) => r.value));
  const shown = expanded ? rows : rows.slice(0, limit);
  const hiddenCount = rows.length - shown.length;
  const grid =
    density === "compact"
      ? "grid-cols-[minmax(0,7rem)_minmax(2rem,1fr)_auto]"
      : "grid-cols-[minmax(0,7.5rem)_minmax(2.5rem,1fr)_auto] sm:grid-cols-[minmax(0,11rem)_minmax(3rem,1fr)_auto]";

  return (
    <div className="flex min-w-0 flex-col gap-1" data-testid={testId}>
      <ul id={listId} aria-label={ariaLabel} className="flex min-w-0 flex-col">
        {shown.map((row) => {
          const segments = (row.segments ?? [{ key: "value", value: row.value, color: row.color ?? "var(--chart-brand-primary)" }]).filter(
            (s) => s.value > 0,
          );
          const inner = (
            <>
              <span className={cn("flex min-w-0 items-center gap-1.5 text-body-sm", row.active ? "font-semibold text-fg" : "text-fg")}>
                {row.active ? <Check aria-hidden className="size-3.5 shrink-0 text-primary" strokeWidth={3} /> : null}
                <span className="truncate" title={row.label}>{row.label}</span>
              </span>
              <span aria-hidden className="flex h-3.5 min-w-0 gap-0.5 overflow-hidden rounded-[4px] bg-surface-sunken">
                {segments.map((s) => (
                  <span key={s.key} className="h-full shrink-0" style={{ width: `${(s.value / max) * 100}%`, background: s.color }} />
                ))}
              </span>
              <span className="text-right text-body-sm whitespace-nowrap tabular-nums">
                <span className="font-semibold text-fg">{fmtInt(row.value)}</span>
                {row.detail ? <span className="text-fg-muted"> {row.detail}</span> : null}
              </span>
              {row.srText || row.onSelect ? (
                <span className="sr-only">
                  {row.srText ? `. ${row.srText}` : ""}
                  {row.onSelect ? (row.active ? ". Filtro aplicado — clique para retirar" : ". Clique para filtrar a tela") : ""}
                </span>
              ) : null}
            </>
          );
          const base = cn("grid w-full items-center gap-x-3 rounded-md px-2 py-1.5 text-left", grid);
          return (
            <li key={row.key} className="min-w-0">
              {row.onSelect ? (
                <button
                  type="button"
                  aria-pressed={Boolean(row.active)}
                  disabled={disabled}
                  onClick={row.onSelect}
                  className={cn(
                    base,
                    "hfm-transition hfm-focus-ring hover:bg-hover-overlay disabled:pointer-events-none disabled:opacity-60",
                    row.active && "bg-selected-overlay",
                  )}
                  data-testid={testId ? `${testId}-row` : undefined}
                  data-key={row.key}
                  data-active={row.active || undefined}
                >
                  {inner}
                </button>
              ) : (
                <div className={base} data-testid={testId ? `${testId}-row` : undefined} data-key={row.key}>
                  {inner}
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {rows.length > limit ? (
        <Button
          variant="ghost"
          size="sm"
          className="self-start"
          aria-expanded={expanded}
          aria-controls={listId}
          leadingIcon={expanded ? <ChevronUp /> : <ChevronDown />}
          onClick={() => setExpanded((v) => !v)}
          data-testid={testId ? `${testId}-more` : undefined}
        >
          {expanded ? "Mostrar menos" : `Mostrar todos (${fmtInt(rows.length)})`}
          {!expanded && hiddenCount > 0 ? <span className="sr-only">, mais {fmtInt(hiddenCount)} itens</span> : null}
        </Button>
      ) : null}
    </div>
  );
}
