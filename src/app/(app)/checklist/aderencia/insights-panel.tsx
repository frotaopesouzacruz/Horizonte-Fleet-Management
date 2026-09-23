"use client";

import * as React from "react";
import {
  ArrowDownRight, ArrowUpRight, CalendarClock, Info, Lightbulb, MapPin, Target, TriangleAlert, Trophy, type LucideIcon,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/cn";
import type { AdherenceGroup, AdherenceInsights } from "@/lib/adherence/queries";
import { formatInt, formatPct } from "./status";
import { pctTone } from "./consolidated-panel";

type Tone = "info" | "warning" | "success";

interface Insight {
  key: string;
  tone: Tone;
  icon: LucideIcon;
  text: string;
}

const TONE_ICON_CLASS: Record<Tone, string> = {
  info: "bg-info-soft text-info-soft-fg",
  warning: "bg-warning-soft text-warning-soft-fg",
  success: "bg-success-soft text-success-soft-fg",
};

const pts = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const signedPts = (v: number) => `${v > 0 ? "+" : ""}${pts.format(v)} pontos`;

function listGroups(groups: AdherenceGroup[], max = 5): string {
  const shown = groups.slice(0, max).map((g) => `${g.label} (${formatPct(g.adherencePct)})`);
  const rest = groups.length - shown.length;
  return rest > 0 ? `${shown.join(", ")} e mais ${rest}` : shown.join(", ");
}

/**
 * Frases curtas e factuais, todas derivadas do que a rotina do banco
 * devolveu (§27). Nada aqui é genérico: se o dado não existe, a frase não
 * aparece. Sem base elegível não é um problema de desempenho, então nunca
 * ganha tom de alerta.
 */
export function buildInsights(insights: AdherenceInsights): Insight[] {
  const { current, previous, today_, isFutureMonth } = insights;
  const list: Insight[] = [];

  if (isFutureMonth || current.denominator === 0) {
    list.push({
      key: "no-base", tone: "info", icon: Info,
      text: isFutureMonth
        ? "Sem base elegível no período: a competência ainda é futura e suas obrigações são planejamento, não descumprimento."
        : "Sem base elegível no período: nenhuma obrigação devida no recorte escolhido, portanto não há desempenho a julgar.",
    });
    if (current.pendingRequests > 0) {
      list.push({
        key: "pending", tone: "info", icon: TriangleAlert,
        text: `${formatInt(current.pendingRequests)} justificativa(s) aguardam decisão no período.`,
      });
    }
    return list;
  }

  // Variação em relação ao mês anterior.
  if (insights.variationPts != null && previous.adherencePct != null) {
    const up = insights.variationPts >= 0;
    list.push({
      key: "variation", tone: up ? "success" : "warning", icon: up ? ArrowUpRight : ArrowDownRight,
      text: `Aderência de ${formatPct(current.adherencePct)} (${formatInt(current.numerator)} de ${formatInt(current.denominator)}), ${signedPts(insights.variationPts)} em relação a ${previous.competence} (${formatPct(previous.adherencePct)}).`,
    });
  } else {
    list.push({
      key: "variation", tone: "info", icon: Info,
      text: `Aderência de ${formatPct(current.adherencePct)} (${formatInt(current.numerator)} de ${formatInt(current.denominator)}); sem base no mês anterior (${previous.competence}) para comparar.`,
    });
  }

  // Desvio em relação à meta, com os dias abaixo dela.
  if (current.targetPct != null && current.gapPct != null) {
    const tone = pctTone(current.adherencePct, current.targetPct);
    const days = insights.daysWithBase > 0
      ? ` ${formatInt(insights.daysBelowTarget)} de ${formatInt(insights.daysWithBase)} dias com base ficaram abaixo dela.`
      : "";
    list.push({
      key: "gap", tone: tone === "success" ? "success" : "warning", icon: Target,
      text: `Desvio de ${signedPts(current.gapPct)} em relação à meta de ${formatPct(current.targetPct)}.${days}`,
    });
  } else {
    list.push({
      key: "gap", tone: "info", icon: Target,
      text: "Meta não definida para a competência: o desvio não pode ser calculado.",
    });
  }

  // O dia vigente, quando o mês é o corrente.
  if (today_) {
    const parts = [`${formatInt(today_.done)} de ${formatInt(today_.obligations)} obrigações realizadas`];
    if (today_.provisional > 0) parts.push(`${formatInt(today_.provisional)} não realizada(s) provisória(s) que ainda podem ser regularizadas`);
    if (today_.pendingRequests > 0) parts.push(`${formatInt(today_.pendingRequests)} justificativa(s) pendente(s)`);
    list.push({
      key: "today", tone: today_.notDone > 0 ? "warning" : "success", icon: CalendarClock,
      text: `Hoje: ${parts.join("; ")}.`,
    });
  }

  // Operações e localidades abaixo da meta.
  if (current.targetPct != null) {
    if (insights.operationsBelowTarget.length > 0) {
      list.push({
        key: "ops-below", tone: "warning", icon: TriangleAlert,
        text: `${formatInt(insights.operationsBelowTarget.length)} operação(ões) abaixo da meta: ${listGroups(insights.operationsBelowTarget)}.`,
      });
    } else {
      list.push({ key: "ops-below", tone: "success", icon: Trophy, text: "Nenhuma operação abaixo da meta na competência." });
    }
    if (insights.citiesBelowTarget.length > 0) {
      list.push({
        key: "cities-below", tone: "warning", icon: MapPin,
        text: `Localidade(s) abaixo da meta: ${listGroups(insights.citiesBelowTarget)}.`,
      });
    }
  }

  // Onde as justificativas pendentes se concentram.
  if (insights.operationsWithPending.length > 0) {
    const shown = insights.operationsWithPending.slice(0, 5).map((g) => `${g.label} (${formatInt(g.pendingRequests)})`);
    list.push({
      key: "pending", tone: "info", icon: TriangleAlert,
      text: `Justificativas pendentes por operação: ${shown.join(", ")}; continuam no denominador até a decisão.`,
    });
  }

  // Melhor e pior operação.
  if (insights.bestOperation && insights.worstOperation && insights.bestOperation.key !== insights.worstOperation.key) {
    list.push({
      key: "best-worst", tone: "info", icon: Trophy,
      text: `Melhor operação: ${insights.bestOperation.label} (${formatPct(insights.bestOperation.adherencePct)}); pior: ${insights.worstOperation.label} (${formatPct(insights.worstOperation.adherencePct)}).`,
    });
  } else if (insights.bestOperation) {
    list.push({
      key: "best-worst", tone: "info", icon: Trophy,
      text: `Única operação com base: ${insights.bestOperation.label} (${formatPct(insights.bestOperation.adherencePct)}).`,
    });
  }

  return list.slice(0, 6);
}

export interface InsightsPanelProps {
  insights: AdherenceInsights | null;
}

/** Insights gerenciais (§27): o cartão só existe quando há o que dizer. */
export function InsightsPanel({ insights }: InsightsPanelProps) {
  const items = insights ? buildInsights(insights) : [];
  return (
    <Card>
      <CardContent className="flex flex-col gap-3 p-4">
        <div className="flex items-center gap-2">
          <Lightbulb className="size-4 text-fg-muted" aria-hidden />
          <h3 className="text-h4 font-semibold text-fg">Insights gerenciais</h3>
        </div>
        {items.length === 0 ? (
          <p className="text-body-sm text-fg-muted">Sem base elegível no período para gerar leituras.</p>
        ) : (
          <ul className="flex flex-col gap-2.5" aria-label="Insights da competência">
            {items.map((item) => {
              const Icon = item.icon;
              return (
                <li key={item.key} className="flex items-start gap-2.5" data-tone={item.tone}>
                  <span className={cn("mt-0.5 inline-flex size-6 shrink-0 items-center justify-center rounded-sm", TONE_ICON_CLASS[item.tone])}>
                    <Icon className="size-3.5" aria-hidden />
                  </span>
                  <p className="text-body-sm text-fg">{item.text}</p>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
