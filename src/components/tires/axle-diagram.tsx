"use client";

import * as React from "react";
import { ArrowUp } from "lucide-react";
import { cn } from "@/lib/cn";
import { statusTone, type StatusTone } from "@/components/ui/status-badge";

/**
 * Desenho do veículo visto de cima (chassi, eixos e rodas), montado a partir
 * do dicionário de posições — grupo de eixo, índice, lado, rodado e ordem —,
 * nunca de um desenho fixo por tipo de veículo. Leve/van (4 rodas simples),
 * caminhão 2 eixos (dianteiro simples + traseiro duplo), tandem, estepes:
 * tudo sai das posições. Um layout novo cadastrado em Parâmetros aparece aqui
 * sem mudança de código.
 *
 * É o motor de desenho do croqui (`VehicleCroqui`), também usado sozinho nas
 * pré-visualizações de Parâmetros. Cada pneu é um botão (alvo de toque ≥ 44
 * px) com o código visível; a cor nunca é o único sinal (o estado também vai
 * num indicador de forma — `glyph` — e no nome acessível). Setas, Home e End
 * movem o foco entre as posições.
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
  /** Texto curto dentro do pneu (Nº Fogo…). */
  caption?: React.ReactNode;
  /** Segunda linha curta (ex.: menor sulco). */
  subcaption?: React.ReactNode;
  tone?: StatusTone | null;
  /** Indicador não cromático do estado (ícone, forma ou letra). */
  glyph?: React.ReactNode;
  /** Posição sem pneu: contorno tracejado. */
  empty?: boolean;
  /** Texto para leitor de tela (situação do pneu), somado ao rótulo da posição. */
  srText?: string;
  /** Nome acessível completo (substitui "rótulo (código) — srText"). */
  ariaLabel?: string;
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
  /** id do painel que os botões controlam (detalhes do pneu). */
  controls?: string;
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

/** Ordem de leitura do desenho: eixo a eixo, da esquerda para a direita; estepes e outras no fim. */
export function axleOrder(positions: AxlePosition[]): string[] {
  const { axles, extras } = buildAxleRows(positions);
  return [...axles.flatMap((row) => [...row.left, ...row.right]), ...extras].map((p) => p.code);
}

const DIMS = {
  md: { tire: "h-16 w-11 sm:h-[4.5rem] sm:w-12", spare: "size-14 sm:size-16", body: "w-14 sm:w-20" },
  sm: { tire: "h-14 w-11", spare: "size-14", body: "w-12 sm:w-14" },
} as const;

function Tire({
  position, state, selected, onSelect, size, testIdPrefix, controls, spare = false,
}: {
  position: AxlePosition;
  state: AxleTireState | undefined;
  selected: boolean;
  onSelect?: (code: string) => void;
  size: "sm" | "md";
  testIdPrefix: string;
  controls?: string;
  spare?: boolean;
}) {
  const tone = state?.tone && !state.empty ? statusTone(state.tone) : null;
  const interactive = Boolean(onSelect) && !state?.disabled;
  const name = state?.ariaLabel ?? `${position.label} (${position.code})${state?.srText ? ` — ${state.srText}` : ""}`;
  const Comp = interactive ? "button" : "div";
  return (
    <Comp
      type={interactive ? "button" : undefined}
      onClick={interactive ? () => onSelect?.(position.code) : undefined}
      aria-pressed={interactive ? selected : undefined}
      aria-controls={interactive && controls ? controls : undefined}
      aria-label={interactive ? name : undefined}
      title={position.label}
      data-testid={`${testIdPrefix}-${position.code}`}
      data-axle-pos=""
      data-position={position.code}
      data-tone={tone ? state?.tone ?? undefined : undefined}
      data-empty={state?.empty || undefined}
      data-selected={selected || undefined}
      className={cn(
        "relative flex shrink-0 flex-col items-center justify-center gap-0.5 border-2 px-0.5 text-center",
        spare ? cn("rounded-full", DIMS[size].spare) : cn("rounded-lg", DIMS[size].tire),
        state?.empty
          ? "border-dashed border-border-strong bg-surface"
          : tone
            ? tone.softClassName
            : "border-border-strong bg-surface-raised",
        selected && "ring-2 ring-primary ring-offset-2 ring-offset-surface",
        interactive && "cursor-pointer hfm-transition hover:border-primary hfm-focus-ring",
        state?.disabled && "opacity-50",
      )}
    >
      <span className={cn("text-[0.625rem] font-semibold leading-none tabular-nums", tone ? tone.softForegroundClassName : "text-fg-secondary")}>
        {position.code}
      </span>
      {state?.glyph ? (
        <span aria-hidden className={cn("flex items-center justify-center leading-none [&_svg]:size-3.5", tone ? tone.softForegroundClassName : "text-fg-muted")}>
          {state.glyph}
        </span>
      ) : null}
      {state?.caption != null ? (
        <span className={cn("max-w-full truncate text-[0.625rem] leading-tight tabular-nums", state.empty ? "text-fg-muted" : "text-fg")}>
          {state.caption}
        </span>
      ) : null}
      {state?.subcaption != null ? (
        <span className="max-w-full truncate text-[0.625rem] leading-tight tabular-nums text-fg-secondary">{state.subcaption}</span>
      ) : null}
      {interactive ? null : <span className="sr-only">{name}</span>}
    </Comp>
  );
}

const ARROWS_NEXT = new Set(["ArrowRight", "ArrowDown"]);
const ARROWS_PREV = new Set(["ArrowLeft", "ArrowUp"]);

export function AxleDiagram({
  positions, state, selected = null, onSelect, label = "Diagrama de eixos", size = "md", className, testIdPrefix = "axle-tire", controls,
}: AxleDiagramProps) {
  const { axles, extras } = React.useMemo(() => buildAxleRows(positions), [positions]);
  if (!positions.length) return null;

  const render = (p: AxlePosition, spare = false) => (
    <Tire
      key={p.code}
      position={p}
      state={state?.(p)}
      selected={selected === p.code}
      onSelect={onSelect}
      size={size}
      testIdPrefix={testIdPrefix}
      controls={controls}
      spare={spare}
    />
  );

  // Trilhas da grade: balanço dianteiro, eixos (tandem bem juntos, dianteiro ↔
  // traseiro afastados) e balanço traseiro. O chassi ocupa a coluna do meio inteira.
  const tracks: string[] = [size === "sm" ? "1.25rem" : "1.75rem"];
  const lines: number[] = [];
  axles.forEach((row, i) => {
    if (i > 0) tracks.push(row.group !== axles[i - 1].group ? (size === "sm" ? "1.5rem" : "2.25rem") : "0.375rem");
    tracks.push("auto");
    lines.push(tracks.length);
  });
  tracks.push(size === "sm" ? "0.75rem" : "1rem");

  const spares = extras.filter((p) => p.axleGroup === "spare");
  const others = extras.filter((p) => p.axleGroup !== "spare");

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const key = event.key;
    if (!ARROWS_NEXT.has(key) && !ARROWS_PREV.has(key) && key !== "Home" && key !== "End") return;
    const target = event.target as HTMLElement;
    if (!target.matches("button[data-axle-pos]")) return;
    const all = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>("button[data-axle-pos]:not(:disabled)"));
    const i = all.indexOf(target as HTMLButtonElement);
    if (i < 0) return;
    const next = key === "Home" ? 0 : key === "End" ? all.length - 1 : ARROWS_NEXT.has(key) ? Math.min(all.length - 1, i + 1) : Math.max(0, i - 1);
    event.preventDefault();
    all[next]?.focus();
  };

  return (
    <div
      role="group"
      aria-label={label}
      onKeyDown={onSelect ? onKeyDown : undefined}
      className={cn("flex max-w-full flex-col items-center gap-3", className)}
      data-testid="axle-diagram"
    >
      <span className="sr-only">Vista de cima; a frente do veículo fica no topo.</span>
      {axles.length ? (
        <div className="flex flex-col items-center gap-1">
          <span aria-hidden className="inline-flex items-center gap-1 text-[0.625rem] font-semibold uppercase tracking-wide text-fg-secondary">
            <ArrowUp className="size-3" />
            Frente
          </span>
          <div className="grid items-center gap-x-1" style={{ gridTemplateColumns: "auto auto auto", gridTemplateRows: tracks.join(" ") }}>
            {/* carroceria/chassi: coluna do meio, do para-choque à traseira */}
            <div
              aria-hidden
              className={cn("relative h-full rounded-t-[1.5rem] rounded-b-lg border-2 border-border-strong bg-surface-sunken", DIMS[size].body)}
              style={{ gridColumn: 2, gridRow: `1 / ${tracks.length + 1}` }}
            >
              <span className="absolute inset-x-1.5 top-1.5 h-2 rounded-t-[0.75rem] rounded-b-xs border border-border-strong bg-surface" />
              <span className="absolute bottom-2 left-[27%] top-6 w-0.5 rounded-full bg-border-strong" />
              <span className="absolute bottom-2 right-[27%] top-6 w-0.5 rounded-full bg-border-strong" />
            </div>
            {axles.map((row, i) => (
              <React.Fragment key={row.key}>
                <div className="flex gap-0.5 justify-self-end" style={{ gridColumn: 1, gridRow: lines[i] }}>
                  {row.left.map((p) => render(p))}
                </div>
                <div aria-hidden className="relative flex h-full items-center justify-center" style={{ gridColumn: 2, gridRow: lines[i] }}>
                  <span className="absolute -inset-x-1 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-fg-subtle" />
                  <span className="relative rounded-xs border border-border-strong bg-surface px-1 text-[0.625rem] font-semibold leading-tight tabular-nums text-fg-secondary">
                    {row.group === "front" ? "D" : "T"}
                    {row.index}
                  </span>
                </div>
                <div className="flex gap-0.5 justify-self-start" style={{ gridColumn: 3, gridRow: lines[i] }}>
                  {row.right.map((p) => render(p))}
                </div>
              </React.Fragment>
            ))}
          </div>
        </div>
      ) : null}
      {spares.length ? (
        <div className="flex flex-col items-center gap-1.5">
          <span className="text-caption text-fg-muted">{spares.length > 1 ? "Estepes" : "Estepe"}</span>
          <div className="flex flex-wrap items-center justify-center gap-2">{spares.map((p) => render(p, true))}</div>
        </div>
      ) : null}
      {others.length ? (
        <div className="flex flex-col items-center gap-1.5">
          <span className="text-caption text-fg-muted">Outras posições</span>
          <div className="flex flex-wrap items-center justify-center gap-2">{others.map((p) => render(p))}</div>
        </div>
      ) : null}
    </div>
  );
}
