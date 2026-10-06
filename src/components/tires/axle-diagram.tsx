"use client";

import * as React from "react";
import { cn } from "@/lib/cn";
import { statusTone, type StatusTone } from "@/components/ui/status-badge";

/**
 * Diagrama de eixos visto de cima, montado a partir do dicionário de
 * posições (grupo de eixo, índice, lado, rodado e ordem) — nunca de um
 * desenho fixo por tipo de veículo. Um layout novo cadastrado em Parâmetros
 * aparece aqui sem mudança de código.
 *
 * Cada pneu é um botão (alvo de toque ≥ 44 px) com rótulo visível; a cor
 * nunca é o único sinal.
 */
export interface AxlePosition {
  code: string;
  label: string;
  axleGroup: "front" | "rear" | "spare" | "other";
  axleIndex: number;
  side: "left" | "right" | "center";
  slot: "single" | "outer" | "inner";
  sortOrder: number;
}

export interface AxleTireState {
  /** Texto curto dentro do pneu (Nº Fogo, sulco, "✓"…). */
  caption?: React.ReactNode;
  tone?: StatusTone | null;
  /** Texto para leitor de tela (situação do pneu). */
  srText?: string;
  disabled?: boolean;
}

export interface AxleDiagramProps {
  positions: AxlePosition[];
  state?: (position: AxlePosition) => AxleTireState | undefined;
  selected?: string | null;
  onSelect?: (code: string) => void;
  /** Rótulo do grupo para leitor de tela. */
  label?: string;
  size?: "sm" | "md";
  className?: string;
  testIdPrefix?: string;
}

interface AxleRow {
  key: string;
  group: AxlePosition["axleGroup"];
  index: number;
  left: AxlePosition[];
  right: AxlePosition[];
  center: AxlePosition[];
  order: number;
}

const SLOT_RANK: Record<AxlePosition["slot"], number> = { outer: 0, single: 1, inner: 2 };

/** Agrupa as posições por eixo, da frente para trás; estepe e outros ficam à parte. */
export function buildAxleRows(positions: AxlePosition[]): { axles: AxleRow[]; extras: AxlePosition[] } {
  const rows = new Map<string, AxleRow>();
  const extras: AxlePosition[] = [];
  for (const p of positions) {
    if (p.axleGroup === "spare" || p.axleGroup === "other" || p.side === "center") {
      extras.push(p);
      continue;
    }
    const key = `${p.axleGroup}:${p.axleIndex}`;
    let row = rows.get(key);
    if (!row) {
      row = { key, group: p.axleGroup, index: p.axleIndex, left: [], right: [], center: [], order: p.sortOrder };
      rows.set(key, row);
    }
    row.order = Math.min(row.order, p.sortOrder);
    (p.side === "left" ? row.left : row.right).push(p);
  }
  const groupRank = (g: AxlePosition["axleGroup"]) => (g === "front" ? 0 : 1);
  const axles = [...rows.values()].sort((a, b) => groupRank(a.group) - groupRank(b.group) || a.index - b.index || a.order - b.order);
  for (const r of axles) {
    // esquerda: externo → interno (de fora para o centro); direita: interno → externo
    r.left.sort((a, b) => SLOT_RANK[a.slot] - SLOT_RANK[b.slot] || a.sortOrder - b.sortOrder);
    r.right.sort((a, b) => SLOT_RANK[b.slot] - SLOT_RANK[a.slot] || a.sortOrder - b.sortOrder);
  }
  extras.sort((a, b) => a.sortOrder - b.sortOrder);
  return { axles, extras };
}

function Tire({
  position, state, selected, onSelect, size, testIdPrefix,
}: {
  position: AxlePosition;
  state: AxleTireState | undefined;
  selected: boolean;
  onSelect?: (code: string) => void;
  size: "sm" | "md";
  testIdPrefix: string;
}) {
  const tone = state?.tone ? statusTone(state.tone) : null;
  const interactive = Boolean(onSelect) && !state?.disabled;
  const Comp = interactive ? "button" : "div";
  return (
    <Comp
      type={interactive ? "button" : undefined}
      onClick={interactive ? () => onSelect?.(position.code) : undefined}
      aria-pressed={interactive ? selected : undefined}
      title={position.label}
      data-testid={`${testIdPrefix}-${position.code}`}
      data-tone={state?.tone ?? undefined}
      className={cn(
        "relative flex shrink-0 flex-col items-center justify-center gap-0.5 rounded-md border-2 text-center",
        size === "sm" ? "h-14 w-11 px-0.5" : "h-[4.5rem] w-14 px-1",
        tone ? tone.softClassName : "border-border bg-surface-sunken",
        selected && "ring-2 ring-primary ring-offset-2 ring-offset-surface",
        interactive && "cursor-pointer transition-colors hover:border-primary hfm-focus-ring",
        state?.disabled && "opacity-50",
      )}
    >
      <span className={cn("font-semibold leading-none tabular-nums", size === "sm" ? "text-[0.625rem]" : "text-caption", tone ? tone.softForegroundClassName : "text-fg-muted")}>
        {position.code}
      </span>
      {state?.caption != null ? (
        <span className={cn("max-w-full truncate leading-tight tabular-nums text-fg", size === "sm" ? "text-[0.625rem]" : "text-caption")}>{state.caption}</span>
      ) : null}
      <span className="sr-only">
        {position.label}
        {state?.srText ? ` — ${state.srText}` : ""}
      </span>
    </Comp>
  );
}

export function AxleDiagram({
  positions, state, selected = null, onSelect, label = "Diagrama de eixos", size = "md", className, testIdPrefix = "axle-tire",
}: AxleDiagramProps) {
  const { axles, extras } = React.useMemo(() => buildAxleRows(positions), [positions]);
  if (!positions.length) return null;
  const render = (p: AxlePosition) => (
    <Tire key={p.code} position={p} state={state?.(p)} selected={selected === p.code} onSelect={onSelect} size={size} testIdPrefix={testIdPrefix} />
  );
  return (
    <div role="group" aria-label={label} className={cn("flex flex-col items-center gap-3", className)} data-testid="axle-diagram">
      <div className="relative flex flex-col items-center gap-2 rounded-2xl border border-border bg-surface px-3 py-3">
        <span className="text-[0.625rem] font-semibold uppercase tracking-wide text-fg-subtle" aria-hidden>
          Frente
        </span>
        {axles.map((row, i) => (
          <div key={row.key} className={cn("flex items-center gap-1.5", i > 0 && row.group === "rear" && axles[i - 1]?.group === "front" && "mt-3")}>
            <div className="flex gap-1">{row.left.map(render)}</div>
            <div className="relative flex w-10 items-center justify-center sm:w-14" aria-hidden>
              <span className="h-1.5 w-full rounded-full bg-border-strong" />
              <span className="absolute -top-3 text-[0.625rem] text-fg-subtle tabular-nums">{row.group === "front" ? "D" : "T"}{row.index}</span>
            </div>
            <div className="flex gap-1">{row.right.map(render)}</div>
          </div>
        ))}
      </div>
      {extras.length ? (
        <div className="flex flex-wrap items-center justify-center gap-2">
          <span className="text-caption text-fg-muted">Estepe e outras</span>
          {extras.map(render)}
        </div>
      ) : null}
    </div>
  );
}
