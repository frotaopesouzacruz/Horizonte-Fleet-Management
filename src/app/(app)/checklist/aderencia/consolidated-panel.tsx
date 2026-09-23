"use client";

import * as React from "react";
import { CheckCircle2, ClipboardList, Gauge, ShieldOff, Target, TriangleAlert, XCircle } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { KpiCard } from "@/components/ui/kpi-card";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  Table, TableBody, TableCell, TableContainer, TableEmpty, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { NativeSelect } from "@/components/governance/selects";
import type {
  AdherenceGroupBy, AdherenceInsights, AdherenceMonthly, AdherenceSummary, ChecklistContext,
} from "@/lib/adherence/queries";
import { formatCompetence, type Competence } from "@/lib/governance/competence";
import { CONTEXT_LABEL, formatInt, formatPct } from "./status";
import { HBarChart } from "./adherence-charts";
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

/**
 * Visão consolidada (§44): os oito números da competência e a quebra por
 * dimensão. Todos saem da mesma rotina do banco; a tela não soma nada.
 * Abaixo, o dashboard mensal (§25) e os insights (§27) — também do banco.
 */
export function ConsolidatedPanel({
  summary, groupBy, context, competence, navigate, pending, monthly, dashboardYear, insights,
}: ConsolidatedPanelProps) {
  const tone = pctTone(summary.adherencePct, summary.targetPct);
  const gap = summary.gapPct;
  // O gráfico mostra as maiores bases; a tabela ao lado tem todas as linhas.
  const chartGroups = [...summary.groups]
    .sort((a, b) => b.denominator - a.denominator)
    .slice(0, 12)
    .map((g) => ({ key: g.key || g.label, label: g.label, value: g.adherencePct, numerator: g.numerator, denominator: g.denominator }));

  return (
    <div className="flex flex-col gap-5">
      <p className="text-body-sm text-fg-muted">
        {CONTEXT_LABEL[context]} · {formatCompetence(competence)} · numerador {formatInt(summary.numerator)} de{" "}
        {formatInt(summary.denominator)} obrigações devidas
        {summary.provisional > 0
          ? ` · ${formatInt(summary.provisional)} do dia vigente ainda podem ser regularizadas`
          : ""}
      </p>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard label="Obrigações previstas" value={formatInt(summary.obligations)}
          period={`${formatInt(summary.planned)} planejadas (futuras)`} icon={<ClipboardList />} />
        <KpiCard label="Checklists realizados" value={formatInt(summary.done)} icon={<CheckCircle2 />} />
        <KpiCard label="Não realizados" value={formatInt(summary.notDone)}
          period={context === "retorno" && summary.pendingReturn > 0 ? `${formatInt(summary.pendingReturn)} retornos no prazo` : undefined}
          icon={<XCircle />} />
        <KpiCard label="Expurgos aprovados" value={formatInt(summary.excluded)} icon={<ShieldOff />} />
        <KpiCard label="Justificativas pendentes" value={formatInt(summary.pendingRequests)}
          period="continuam no denominador" icon={<TriangleAlert />} />
        <KpiCard label="Aderência" value={formatPct(summary.adherencePct)}
          period={`${formatInt(summary.numerator)} / ${formatInt(summary.denominator)}`} icon={<Gauge />} />
        <KpiCard label="Meta" value={summary.targetPct == null ? "Não definida" : formatPct(summary.targetPct)}
          period={summary.targetPct == null ? "defina em Importação e reconciliação" : "vigente na competência"} icon={<Target />} />
        <KpiCard label="Diferença para a meta"
          value={gap == null ? "—" : `${gap > 0 ? "+" : ""}${formatPct(gap)}`}
          period={gap == null ? "sem meta ou sem base" : gap >= 0 ? "acima da meta" : "abaixo da meta"}
          icon={<Target />} />
      </div>

      <Card>
        <CardContent className="flex flex-col gap-4 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-h4 font-semibold text-fg">Aderência por {GROUP_LABEL[groupBy].toLowerCase()}</h3>
              <p className="text-caption text-fg-muted">Mesma fórmula da consolidada: soma dos numeradores sobre soma dos denominadores.</p>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-caption text-fg-muted">Agrupar por</span>
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
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          <TableContainer>
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
          {chartGroups.length > 0 ? (
            <div className="flex flex-col gap-1">
              <p className="text-caption text-fg-muted">
                Aderência por {GROUP_LABEL[groupBy].toLowerCase()}{summary.groups.length > chartGroups.length ? ` · ${chartGroups.length} maiores bases` : ""}
              </p>
              <HBarChart
                items={chartGroups}
                target={summary.targetPct}
                ariaLabel={`Aderência por ${GROUP_LABEL[groupBy].toLowerCase()}, ${formatCompetence(competence)}`}
              />
            </div>
          ) : null}
          </div>
          {tone === "danger" && summary.targetPct != null ? (
            <p className="text-caption text-danger">A competência está abaixo da meta de {formatPct(summary.targetPct)}.</p>
          ) : null}
        </CardContent>
      </Card>

      <MonthlyDashboard monthly={monthly} year={dashboardYear} context={context} navigate={navigate} pending={pending} />

      <InsightsPanel insights={insights} />
    </div>
  );
}
