"use client";

import * as React from "react";
import { cn } from "@/lib/cn";
import { KpiCard, type KpiCardProps } from "@/components/ui/kpi-card";
import type { TiresNavLink } from "../tires-ui";

const INTERACTIVE = cn(
  "cursor-pointer",
  "after:pointer-events-none after:absolute after:inset-0 after:rounded-[inherit] after:bg-hover-overlay after:opacity-0",
  "after:transition-opacity after:duration-(--duration-base) group-hover:after:opacity-100",
);

export type IndicatorKpiProps = Omit<KpiCardProps, "size"> & {
  /** `data-testid` do cartão (no link, quando ele leva a outra visão). */
  testId: string;
  nav?: TiresNavLink | null;
  /** Para leitor de tela: para onde o link leva. */
  destination?: string;
};

/**
 * Cartão de indicador das visões gerenciais — o mesmo desenho de `TiresKpi`,
 * com o `data-testid` escolhido por quem chama. O rótulo reserva duas linhas
 * para os números da fileira ficarem na mesma linha de base.
 */
export function IndicatorKpi({ testId, nav, destination, label, className, ...card }: IndicatorKpiProps) {
  const body = (
    <KpiCard
      size="compact"
      label={<span className="block min-h-9 leading-snug">{label}</span>}
      className={cn("h-full justify-start", nav && INTERACTIVE, className)}
      data-testid={nav ? undefined : testId}
      {...card}
    />
  );
  if (!nav) return body;
  return (
    <a href={nav.href} onClick={nav.onClick} className="group block h-full rounded-lg hfm-focus-ring" data-testid={testId}>
      {body}
      {destination ? <span className="sr-only">. {destination}</span> : null}
    </a>
  );
}
