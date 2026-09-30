"use client";

import * as React from "react";
import { Gauge, ShieldOff, Target, XCircle } from "lucide-react";
import { KpiCard, MetricStrip, type KpiStatus, type KpiTrend } from "@/components/ui/kpi-card";
import { ChartCard, ChartLegend, HBarChart, chartFormat } from "@/components/charts";
import { SectionHeader } from "@/components/layout/section-header";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  Table, TableBody, TableCell, TableContainer, TableEmpty, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { NativeSelect } from "@/components/governance/selects";
import type {
  AdherenceGroupBy, AdherenceInsights, AdherenceMonthly, AdherenceSummary, ChecklistContext,
} from "@/lib/adherence/queries";
import { formatCompetence, MONTH_NAMES, type Competence } from "@/lib/governance/competence";
import { CONTEXT_LABEL, formatInt, formatPct } from "./status";
import { MonthlyDashboard } from "./monthly-dashboard";
import { InsightsPanel } from "./insights-panel";
import type { Navigate } from "./adherence-view";

const GROUP_LABEL: Record<AdherenceGroupBy, string> = {
  operation: "Operação",
  state: "Estado",
  city: "Cidade",
  branch: "Filial",
  leader: "Liderança",
  br: "BR",
  vehicle_type: "Tipo de equipamento",
  vehicle: "Veículo",
};

/** Tom do percentual em relação à meta; sem meta, sem julgamento. */
export function pctTone(pct: number | null, target: number | null): "success" | "warning" | "danger" | "neutral" {
  if (pct == null) return "neutral";
  if (target == null) return "neutral";
  if (pct >= target) return "success";
  if (pct >= target - 10) return "warning";
  return "danger";
}

export interface ConsolidatedPanelProps {
  summary: AdherenceSummary;
  groupBy: AdherenceGroupBy;
  context: ChecklistContext;
  competence: Competence;
  navigate: Navigate;
  pending: boolean;
  /** Dashboard mensal do ano escolhido (§25) e os insights da competência (§27). */
  monthly: AdherenceMonthly | null;
  dashboardYear: number;
  insights: AdherenceInsights | null;
  today: string;
}

const pts = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const signedPts = (v: number) => `${v > 0 ? "+" : ""}${pts.format(v)} p.p.`;
const direction = (v: number): KpiTrend["direction"] => (v > 0 ? "up" : v < 0 ? "down" : "flat");
const signedInt = (v: number) => `${v > 0 ? "+" : ""}${formatInt(v)}`;

const TONE_STATUS: Record<ReturnType<typeof pctTone>, KpiStatus> = {
  success: "success",
  warning: "warning",
  danger: "danger",
  neutral: "primary",
};

/**
 * Visão consolidada (§44), em níveis de leitura (Etapa 17):
 * 1. resultado da competência — aderência, meta, não realizados e expurgos,
 *    com a composição do número logo abaixo;
 * 2. tendência do ano contra a meta (§25);
 * 3. onde está o desvio — ranking por dimensão, gráfico e tabela;
 * 4. as leituras gerenciais (§27), com o detalhe nas outras abas.
 *
 * Todos os números saem das rotinas do banco; a tela não soma nada. As
 * variações contra o mês anterior também vêm prontas: a da aderência dos
 * insights, as de não realizados e expurgos do dashboard mensal.
 */
export function ConsolidatedPanel({
  summary, groupBy, context, competence, navigate, pending, monthly, dashboardYear, insights,
}: ConsolidatedPanelProps) {
  const tone = pctTone(summary.adherencePct, summary.targetPct);
  const gap = summary.gapPct;
  const sameYear = monthly != null && monthly.year === competence.year;
  const pastMonths = sameYear ? monthly.months.filter((m) => m.month <= competence.month && !m.isFuture) : [];
  const prevMonth = sameYear && competence.month > 1 ? monthly.months.find((m) => m.month === competence.month - 1) : undefined;
  const prevName = prevMonth ? MONTH_NAMES[prevMonth.month].toLowerCase() : null;
  const spark = <T,>(pick: (m: (typeof pastMonths)[number]) => T) => (pastMonths.length > 1 ? pastMonths.map(pick) : undefined);

  const adherenceTrend: KpiTrend | undefined =
    insights?.variationPts != null
      ? { value: signedPts(insights.variationPts), direction: direction(insights.variationPts), goodWhen: "up", comparison: `vs. ${insights.previous.competence}` }
      : undefined;
  const notDoneTrend: KpiTrend | undefined = prevMonth
    ? { value: signedInt(summary.notDone - prevMonth.notDone), direction: direction(summary.notDone - prevMonth.notDone), goodWhen: "down", comparison: `vs. ${prevName}` }
    : undefined;
  const excludedTrend: KpiTrend | undefined = prevMonth
    ? { value: signedInt(summary.excluded - prevMonth.excluded), direction: direction(summary.excluded - prevMonth.excluded), goodWhen: "neutral", comparison: `vs. ${prevName}` }
    : undefined;

  // O gráfico mostra as maiores bases; a tabela ao lado tem todas as linhas.
  const chartGroups = [...summary.groups]
    .sort((a, b) => b.denominator - a.denominator)
    .slice(0, 12)
    .map((g) => {
      const below = summary.targetPct != null && g.adherencePct != null && g.adherencePct < summary.targetPct;
      return {
        key: g.key || g.label,
        label: g.label,
        value: g.adherencePct,
        color: below ? "var(--chart-danger)" : "var(--chart-brand-primary)",
        detail: `· ${formatInt(g.numerator)}/${formatInt(g.denominator)}`,
        tooltip: {
          title: g.label,
          subtitle: `${GROUP_LABEL[groupBy]} · ${formatCompetence(competence)}`,
          rows: [
            { label: "Aderência", value: formatPct(g.adherencePct), color: below ? "var(--chart-danger)" : "var(--chart-brand-primary)", marker: "square" as const, emphasis: true },
            ...(summary.targetPct != null
              ? [
                  { label: "Meta", value: formatPct(summary.targetPct), color: "var(--chart-target)", marker: "dashed" as const },
                  {
                    label: "Desvio",
                    value: g.adherencePct == null ? "—" : signedPts(Math.round((g.adherencePct - summary.targetPct) * 100) / 100),
                    tone: below ? ("danger" as const) : ("success" as const),
                  },
                ]
              : []),
            { label: "Realizados / devidas", value: `${formatInt(g.numerator)} / ${formatInt(g.denominator)}` },
            { label: "Não realizados", value: formatInt(g.notDone) },
            { label: "Expurgos", value: formatInt(g.excluded) },
          ],
          announce: `${g.label}: ${formatPct(g.adherencePct)}, ${formatInt(g.numerator)} de ${formatInt(g.denominator)}`,
        },
      };
    });
  const belowCount = summary.groups.filter((g) => summary.targetPct != null && g.adherencePct != null && g.adherencePct < summary.targetPct).length;

  return (
    <div className="flex flex-col gap-6">
      <section aria-label="Resultado da competência" className="flex flex-col gap-3">
        <SectionHeader
          title="Resultado da competência"
          description={
            <>
              {CONTEXT_LABEL[context]} · {formatCompetence(competence)} · numerador {formatInt(summary.numerator)} de{" "}
              {formatInt(summary.denominator)} obrigações devidas
              {summary.provisional > 0
                ? ` · ${formatInt(summary.provisional)} do dia vigente ainda podem ser regularizadas`
                : ""}
            </>
          }
        />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <KpiCard
            label="Aderência atual"
            value={formatPct(summary.adherencePct)}
            status={TONE_STATUS[tone]}
            icon={<Gauge />}
            trend={adherenceTrend}
            period={adherenceTrend ? undefined : `${formatInt(summary.numerator)} / ${formatInt(summary.denominator)}`}
            sparkline={spark((m) => m.adherencePct)}
            sparklineTarget={summary.targetPct}
            data-testid="adherence-kpi-adherence"
          />
          <KpiCard
            label="Meta"
            value={summary.targetPct == null ? "Não definida" : formatPct(summary.targetPct)}
            status="highlight"
            icon={<Target />}
            trend={gap != null ? { value: signedPts(gap), direction: direction(gap), goodWhen: "up", comparison: gap >= 0 ? "acima da meta" : "abaixo da meta" } : undefined}
            period={summary.targetPct == null ? "defina em Importação e reconciliação" : gap == null ? "sem base para comparar" : undefined}
            data-testid="adherence-kpi-target"
          />
          <KpiCard
            label="Não realizados"
            value={formatInt(summary.notDone)}
            status={summary.notDone > 0 && tone !== "success" && tone !== "neutral" ? TONE_STATUS[tone] : "neutral"}
            icon={<XCircle />}
            trend={notDoneTrend}
            period={context === "retorno" && summary.pendingReturn > 0 ? `${formatInt(summary.pendingReturn)} retornos no prazo` : notDoneTrend ? undefined : `de ${formatInt(summary.denominator)} devidas`}
            sparkline={spark((m) => m.notDone)}
            data-testid="adherence-kpi-not-done"
          />
          <KpiCard
            label="Expurgos"
            value={formatInt(summary.excluded)}
            status="info"
            icon={<ShieldOff />}
            trend={excludedTrend}
            period={`${formatInt(summary.pendingRequests)} justificativa(s) pendente(s)`}
            sparkline={spark((m) => m.excluded)}
            data-testid="adherence-kpi-excluded"
          />
        </div>
        <MetricStrip
          ariaLabel="Composição do indicador"
          items={[
            { key: "obligations", label: "Obrigações previstas", value: formatInt(summary.obligations), hint: `${formatInt(summary.planned)} planejadas (futuras)` },
            { key: "done", label: "Checklists realizados", value: formatInt(summary.done) },
            { key: "pending", label: "Justificativas pendentes", value: formatInt(summary.pendingRequests), hint: "continuam no denominador" },
            { key: "formula", label: "Realizados / devidas", value: `${formatInt(summary.numerator)} / ${formatInt(summary.denominator)}`, hint: "numerador / denominador" },
          ]}
        />
      </section>

      <MonthlyDashboard monthly={monthly} year={dashboardYear} context={context} navigate={navigate} pending={pending} />

      <section aria-label="Onde está o desvio" className="flex flex-col gap-3">
        <SectionHeader
          title={`Aderência por ${GROUP_LABEL[groupBy].toLowerCase()}`}
          description="Mesma fórmula da consolidada: soma dos numeradores sobre soma dos denominadores."
          actions={
            <label className="flex items-center gap-2">
              <span className="whitespace-nowrap text-caption text-fg-muted">Agrupar por</span>
              <NativeSelect
                fieldSize="sm"
                aria-label="Agrupar por"
                value={groupBy}
                disabled={pending}
                onChange={(e) => navigate({ agrupar: e.target.value })}
                className="min-w-[11rem]"
              >
                {(Object.keys(GROUP_LABEL) as AdherenceGroupBy[]).map((g) => (
                  <option key={g} value={g}>{GROUP_LABEL[g]}</option>
                ))}
              </NativeSelect>
            </label>
          }
        />
        <div className="grid grid-cols-1 gap-4 2xl:grid-cols-[minmax(0,5fr)_minmax(0,4fr)]">
          <ChartCard
            title={`Ranking por ${GROUP_LABEL[groupBy].toLowerCase()}`}
            description={summary.groups.length > chartGroups.length ? `${chartGroups.length} maiores bases de ${summary.groups.length}` : `${formatCompetence(competence)} · ${CONTEXT_LABEL[context]}`}
            legend={
              <ChartLegend
                items={[
                  { key: "ok", label: "Na meta ou acima", color: "var(--chart-brand-primary)" },
                  { key: "below", label: "Abaixo da meta", color: "var(--chart-danger)" },
                  ...(summary.targetPct != null ? [{ key: "target", label: `Meta ${formatPct(summary.targetPct)}`, color: "var(--chart-target)", shape: "dashed" as const }] : []),
                ]}
              />
            }
            insight={
              summary.targetPct != null && summary.groups.length > 0
                ? belowCount === 0
                  ? `Todos os ${formatInt(summary.groups.length)} grupos estão na meta.`
                  : `${formatInt(belowCount)} de ${formatInt(summary.groups.length)} grupos abaixo da meta de ${formatPct(summary.targetPct)}.`
                : undefined
            }
            empty={chartGroups.length === 0 ? "Sem obrigações no recorte escolhido." : undefined}
          >
            <HBarChart
              items={chartGroups}
              kind="percent"
              target={summary.targetPct}
              format={chartFormat.pct}
              targetLabel={summary.targetPct != null ? `Meta ${chartFormat.pct(summary.targetPct)}` : undefined}
              ariaLabel={`Aderência por ${GROUP_LABEL[groupBy].toLowerCase()}, ${formatCompetence(competence)}`}
            />
          </ChartCard>

          <TableContainer className="self-start shadow-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{GROUP_LABEL[groupBy]}</TableHead>
                  <TableHead className="text-right">Obrigações</TableHead>
                  <TableHead className="text-right">Realizados</TableHead>
                  <TableHead className="text-right">Não realizados</TableHead>
                  <TableHead className="text-right">Expurgos</TableHead>
                  <TableHead className="text-right">Pendentes</TableHead>
                  <TableHead className="text-right">Num / Den</TableHead>
                  <TableHead className="text-right">Aderência</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {summary.groups.length === 0 ? (
                  <TableEmpty colSpan={8} message="Sem obrigações no recorte escolhido." />
                ) : (
                  summary.groups.map((g) => (
                    <TableRow key={g.key || g.label}>
                      <TableCell className="font-medium text-fg">{g.label}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatInt(g.obligations)}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatInt(g.done)}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatInt(g.notDone)}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatInt(g.excluded)}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatInt(g.pendingRequests)}</TableCell>
                      <TableCell className="text-right tabular-nums text-fg-muted">{formatInt(g.numerator)} / {formatInt(g.denominator)}</TableCell>
                      <TableCell className="text-right">
                        <StatusBadge status={pctTone(g.adherencePct, summary.targetPct)}>{formatPct(g.adherencePct)}</StatusBadge>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </TableContainer>
        </div>
        {tone === "danger" && summary.targetPct != null ? (
          <p className="text-caption text-danger-soft-fg">A competência está abaixo da meta de {formatPct(summary.targetPct)}.</p>
        ) : null}
      </section>

      <InsightsPanel insights={insights} />
    </div>
  );
}
