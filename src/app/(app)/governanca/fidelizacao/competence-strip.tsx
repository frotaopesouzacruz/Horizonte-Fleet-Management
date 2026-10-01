"use client";

import * as React from "react";
import { CalendarRange, History } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { StatusBadge, type StatusTone } from "@/components/ui/status-badge";
import { cn } from "@/lib/cn";
import {
  formatDateBr,
  formatDateTimeBr,
  type CompetenceSituation,
  type FidelizationCompetenceSummary,
} from "@/lib/governance/fidelization-competence";

const number = new Intl.NumberFormat("pt-BR");

/** A cor de cada situação. "Em andamento" é a que pede atenção de quem planeja. */
const SITUATION_TONE: Record<CompetenceSituation, StatusTone> = {
  in_progress: "progress",
  planned: "info",
  closed: "neutral",
  historical: "pending",
  not_created: "warning",
};

export interface CompetenceStripProps {
  summary: FidelizationCompetenceSummary | null;
  /** "Outubro/2026" — usado quando o resumo não pôde ser lido. */
  fallbackLabel: string;
}

/**
 * A competência em tela, sem ambiguidade: mês/ano, situação, origem, quantas
 * placas, BRs e locais de operação estão fidelizados e quando (e por quem) a
 * competência mudou pela última vez. Fica logo abaixo do seletor de
 * competência e vale para todas as áreas da Central.
 *
 * A situação é derivada no banco (Histórica · Encerrada · Em andamento ·
 * Planejada · Não criada); a tela só a escreve.
 */
export function CompetenceStrip({ summary, fallbackLabel }: CompetenceStripProps) {
  const historical = summary?.kind === "historical";
  const label = summary?.label || fallbackLabel;

  const note = (() => {
    if (!summary) return "Não foi possível ler o resumo desta competência. As áreas abaixo continuam disponíveis.";
    if (historical) {
      return summary.counts.positions > 0
        ? "Competência histórica — somente consulta; não é usada para recriar vínculos atuais."
        : "Competência histórica — somente consulta. O histórico consolidado deste mês ainda não foi carregado.";
    }
    if (summary.situation === "not_created") {
      const prev = summary.previous;
      return prev.platesFound > 0
        ? `Ainda não criada. A posição inicial será a vigente em ${formatDateBr(prev.referenceDate)} (${prev.label}): ${number.format(prev.platesFound)} placa(s).`
        : `Ainda não criada. ${prev.label} não tem placas vigentes no último dia para replicar.`;
    }
    if (summary.referenceDate) {
      return `Posição inicial: a vigente em ${formatDateBr(summary.referenceDate)} (${summary.sourceLabel ?? summary.previous.label}). As mudanças do mês seguem pelas substituições, inversões e encerramentos; a competência seguinte parte do último dia deste mês.`;
    }
    if (summary.origin === "historical_import") return "Competência carregada pela importação de 2026, antes da replicação mensal.";
    if (summary.origin === "manual") return "Competência planejada à mão, sem replicação.";
    return null;
  })();

  const updatedBy = summary?.lastUpdatedAt
    ? summary.lastUpdatedByName ?? (summary.origin === "auto_replication" ? "Rotina automática" : "Sistema")
    : null;

  return (
    <section
      aria-label={`Competência em tela: ${label}`}
      data-testid="fidelization-competence-strip"
      className="flex flex-col rounded-lg border border-border bg-surface-raised shadow-card"
    >
      <div className="flex flex-col gap-4 p-4 lg:flex-row lg:items-center lg:justify-between lg:gap-6">
        <div className="flex min-w-0 items-start gap-3">
          <span
            aria-hidden
            className={cn(
              "grid size-10 shrink-0 place-items-center rounded-md [&_svg]:size-5",
              historical ? "bg-neutral-soft text-neutral-soft-fg" : "bg-primary-soft text-primary-soft-fg",
            )}
          >
            {historical ? <History /> : <CalendarRange />}
          </span>
          <div className="flex min-w-0 flex-col gap-1">
            <span className="text-overline font-semibold uppercase text-fg-muted">Competência</span>
            <span className="text-h3 font-semibold leading-tight text-fg" data-testid="fidelization-competence-label">
              {label}
            </span>
            <span className="flex flex-wrap items-center gap-1.5">
              {summary ? (
                <StatusBadge status={SITUATION_TONE[summary.situation] ?? "neutral"} data-testid="fidelization-competence-situation">
                  {summary.situationLabel}
                </StatusBadge>
              ) : null}
              {summary?.originLabel ? (
                <Badge variant="neutral" appearance="outline" data-testid="fidelization-competence-origin">
                  Origem: {summary.originLabel}
                </Badge>
              ) : null}
            </span>
          </div>
        </div>

        <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4 lg:shrink-0">
          <Fact label="Placas fidelizadas" value={summary ? number.format(summary.counts.plates) : "—"} />
          <Fact label="BRs" value={summary ? number.format(summary.counts.brs) : "—"} />
          <Fact label="Locais de operação" value={summary ? number.format(summary.counts.locais) : "—"} />
          <Fact
            label="Última atualização"
            value={summary?.lastUpdatedAt ? formatDateTimeBr(summary.lastUpdatedAt) : "—"}
            hint={updatedBy}
            small
          />
        </dl>
      </div>
      {note ? (
        <p className="border-t border-border-subtle px-4 py-2 text-caption text-fg-secondary" data-testid="fidelization-competence-note">
          {note}
        </p>
      ) : null}
    </section>
  );
}

function Fact({
  label,
  value,
  hint,
  small = false,
}: {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  small?: boolean;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className="text-caption text-fg-muted">{label}</dt>
      <dd className={cn("font-semibold tabular-nums text-fg", small ? "text-body" : "text-h4")}>{value}</dd>
      {hint ? <dd className="truncate text-caption text-fg-secondary">{hint}</dd> : null}
    </div>
  );
}
