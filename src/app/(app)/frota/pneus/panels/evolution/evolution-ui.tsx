"use client";

import * as React from "react";
import { ArrowDown, ArrowRight, ArrowUp, Equal, TrendingDown, TrendingUp, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/cn";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import { fmtDelta, fmtRelative, spokenDelta, type Comparison, type KpiKind, type Trend } from "./evolution-utils";

/**
 * Peças visuais da Evolução: tendência (ícone + texto, nunca só cor) e a
 * variação com seta pelo sentido do número.
 */
const TREND_META: Record<Exclude<Trend, "neutro">, { label: string; Icon: LucideIcon; variant: NonNullable<BadgeProps["variant"]> }> = {
  melhorando: { label: "Melhorando", Icon: TrendingUp, variant: "success" },
  piorando: { label: "Piorando", Icon: TrendingDown, variant: "danger" },
  estavel: { label: "Estável", Icon: Equal, variant: "neutral" },
};

export const TREND_GROUP_LABEL: Record<Trend, string> = {
  piorando: "Pioraram",
  melhorando: "Melhoraram",
  estavel: "Estáveis",
  neutro: "Sem julgamento",
};

/** Tendência como selo (Melhorando / Piorando / Estável) ou texto discreto quando não há julgamento. */
export function TrendBadge({ comparison, className }: { comparison: Comparison; className?: string }) {
  if (!comparison.comparable) {
    return <span className={cn("text-caption text-fg-muted", className)}>Sem comparação</span>;
  }
  if (comparison.trend === "neutro") {
    return (
      <span className={cn("text-caption text-fg-muted", className)} title="Indicador de volume: a variação não é boa nem ruim.">
        Neutro (volume)
      </span>
    );
  }
  const m = TREND_META[comparison.trend];
  return (
    <Badge variant={m.variant} size="sm" icon={<m.Icon aria-hidden />} className={className}>
      {m.label}
    </Badge>
  );
}

/** Variação absoluta com seta pelo sentido do número (subiu / caiu / igual). */
export function DeltaValue({ kind, delta, className }: { kind: KpiKind; delta: number | null; className?: string }) {
  if (delta == null) return <span className={cn("text-fg-muted", className)}>—</span>;
  const Icon = delta > 0 ? ArrowUp : delta < 0 ? ArrowDown : ArrowRight;
  return (
    <span className={cn("inline-flex items-center justify-end gap-1 whitespace-nowrap tabular-nums", className)}>
      <Icon className="size-3.5 shrink-0 text-fg-muted" aria-hidden />
      <span aria-hidden>{fmtDelta(kind, delta)}</span>
      <span className="sr-only">{spokenDelta(kind, delta)}</span>
    </span>
  );
}

export function RelativeValue({ relative, className }: { relative: number | null; className?: string }) {
  return <span className={cn("whitespace-nowrap tabular-nums", relative == null && "text-fg-muted", className)}>{fmtRelative(relative)}</span>;
}

/**
 * Rótulo curto de um controle da barra. Com `htmlFor` é um <label> de verdade;
 * sem ele (grupo de botões que já tem nome acessível) é só visual.
 */
export function FieldLabel({ htmlFor, children }: { htmlFor?: string; children: React.ReactNode }) {
  const cls = "text-label font-medium text-fg-secondary";
  if (htmlFor) {
    return (
      <label htmlFor={htmlFor} className={cls}>
        {children}
      </label>
    );
  }
  return (
    <span aria-hidden className={cls}>
      {children}
    </span>
  );
}
