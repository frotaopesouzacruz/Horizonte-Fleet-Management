"use client";

import * as React from "react";
import { cn } from "@/lib/cn";
import type { KmQualityIndicators } from "@/lib/km/quality";
import { fmtInt } from "@/lib/km/types";
import type { IssueFilter } from "./issues-table";

/**
 * Indicadores da qualidade (`indicators`). Os que têm ocorrência na lista
 * filtram a lista ao clicar (`aria-pressed` diz se o filtro está aplicado).
 * Sem leitura ≠ sem movimento: cada um tem o seu número.
 */
type Tone = "success" | "warning" | "danger" | "info" | "neutral";

interface IndicatorDef {
  key: keyof KmQualityIndicators;
  label: string;
  unit: string;
  tone: Tone;
  hint?: string;
  filter?: IssueFilter;
  anchor?: string;
}

const DEFS: IndicatorDef[] = [
  { key: "valid", label: "Válidas", unit: "leituras", tone: "success", hint: "Validadas, entram nos totais" },
  { key: "noMovement", label: "Sem movimento", unit: "leituras", tone: "neutral", hint: "Leitura válida, deslocamento zero" },
  { key: "noReading", label: "Sem leitura", unit: "dias-veículo", tone: "neutral", hint: "Sem dado no dia — não é 0 km" },
  { key: "highMileage", label: "Alta rodagem", unit: "leituras", tone: "warning", filter: "status:high_mileage" },
  { key: "kmDivergence", label: "Divergência de KM", unit: "leituras", tone: "warning", filter: "status:km_divergence" },
  { key: "pendingReview", label: "Pendentes de análise", unit: "leituras", tone: "warning", filter: "status:pending_review" },
  { key: "inconsistent", label: "Inconsistentes", unit: "leituras", tone: "danger", filter: "status:inconsistent" },
  { key: "jump", label: "Saltos de hodômetro", unit: "leituras", tone: "warning", filter: "alert:odometer_jump" },
  { key: "regression", label: "Regressões", unit: "leituras", tone: "danger", filter: "alert:odometer_regression" },
  { key: "registryDivergence", label: "Divergência cadastral", unit: "frotas", tone: "info", filter: "alert:registry_divergence" },
  { key: "duplicates", label: "Duplicidades", unit: "linhas no último lote", tone: "neutral" },
  { key: "corrected", label: "Corrigidas", unit: "leituras", tone: "info", filter: "corrected" },
  { key: "unregisteredPlates", label: "Placas não cadastradas", unit: "no último lote", tone: "danger" },
  { key: "staleVehicles", label: "Frotas desatualizadas", unit: "2+ dias sem leitura", tone: "warning", anchor: "km-qualidade-desatualizadas" },
];

const TOP: Record<Tone, string | null> = {
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-danger",
  info: "bg-info",
  neutral: null,
};

export function QualityIndicators({
  indicators, filter, onFilter,
}: {
  indicators: KmQualityIndicators | null | undefined;
  filter: IssueFilter;
  onFilter: (next: IssueFilter) => void;
}) {
  const ind = indicators ?? {};
  return (
    <section aria-labelledby="km-qualidade-indicadores" className="flex flex-col gap-2">
      <h3 id="km-qualidade-indicadores" className="text-label font-semibold text-fg">
        Indicadores do período
      </h3>
      <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5 2xl:grid-cols-7" data-testid="km-qualidade-indicadores">
        {DEFS.map((d) => {
          const value = ind[d.key] ?? null;
          const accent = value ? TOP[d.tone] : null;
          const body = (
            <>
              {accent ? <span aria-hidden className={cn("absolute inset-x-0 top-0 h-0.5", accent)} /> : null}
              <span className="text-caption font-medium text-fg-secondary">{d.label}</span>
              <span className="text-h3 font-semibold leading-none text-fg tabular-nums">{fmtInt(value)}</span>
              <span className="text-caption text-fg-muted">{d.hint ?? d.unit}</span>
            </>
          );
          const base =
            "relative flex h-full min-w-0 flex-col gap-1 overflow-hidden rounded-lg border border-border bg-surface-raised px-3 py-2.5 text-left shadow-card";
          const testId = `km-qualidade-indicador-${d.key}`;
          if (d.filter) {
            const active = filter === d.filter;
            return (
              <li key={d.key}>
                <button
                  type="button"
                  aria-pressed={active}
                  onClick={() => onFilter(active ? "all" : (d.filter as IssueFilter))}
                  className={cn(
                    base,
                    "w-full hfm-transition hfm-focus-ring hover:border-border-strong",
                    active && "border-primary bg-primary-soft hover:border-primary",
                  )}
                  title={active ? "Remover o filtro da lista de ocorrências" : "Filtrar a lista de ocorrências"}
                  data-testid={testId}
                >
                  {body}
                </button>
              </li>
            );
          }
          if (d.anchor) {
            return (
              <li key={d.key}>
                <a
                  href={`#${d.anchor}`}
                  className={cn(base, "hfm-transition hfm-focus-ring hover:border-border-strong")}
                  data-testid={testId}
                >
                  {body}
                </a>
              </li>
            );
          }
          return (
            <li key={d.key}>
              <div className={base} data-testid={testId}>
                {body}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
