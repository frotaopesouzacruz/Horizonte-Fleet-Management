"use client";

import * as React from "react";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  Table, TableBody, TableCell, TableContainer, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { NativeSelect } from "@/components/governance/selects";
import { cn } from "@/lib/cn";
import type { AdherenceMonthly, ChecklistContext } from "@/lib/adherence/queries";
import { MONTH_NAMES } from "@/lib/governance/competence";
import { CONTEXT_LABEL, formatInt, formatPct } from "./status";
import { pctTone } from "./consolidated-panel";
import { ChartCard, ChartLegend, TrendChart, chartFormat, type TrendPoint } from "@/components/charts";
import { SectionHeader } from "@/components/layout/section-header";
import type { Navigate } from "./adherence-view";

export interface MonthlyDashboardProps {
  monthly: AdherenceMonthly | null;
  year: number;
  context: ChecklistContext;
  navigate: Navigate;
  pending: boolean;
}

const signed = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
function formatGap(gap: number | null): string {
  if (gap == null) return "—";
  return `${gap > 0 ? "+" : ""}${signed.format(gap)} pts`;
}

/**
 * Tendência (§25): os doze meses do ano pela mesma fórmula da consolidada. O
 * ano do dashboard é independente da competência (`ano_dash`), para que se
 * olhe o histórico sem sair do mês em análise. Meses futuros nunca mostram
 * resultado (§16): faixa "Futuro" e traço na tabela.
 *
 * O gráfico é a linha da marca contra a meta tracejada; o mês abaixo da meta
 * ganha o ponto vermelho, e o tooltip e a tabela dizem o número.
 */
export function MonthlyDashboard({ monthly, year, context, navigate, pending }: MonthlyDashboardProps) {
  const years = [year - 2, year - 1, year, year + 1, year + 2];
  const target = monthly?.months.find((m) => m.isCurrent)?.targetPct
    ?? monthly?.months.find((m) => !m.isFuture && m.targetPct != null)?.targetPct
    ?? null;

  const points: TrendPoint[] = (monthly?.months ?? []).map((m) => {
    const name = `${MONTH_NAMES[m.month]}/${year}`;
    const monthTarget = m.targetPct ?? target;
    const below = monthTarget != null && m.adherencePct != null && m.adherencePct < monthTarget;
    return {
      key: String(m.month),
      label: MONTH_NAMES[m.month].slice(0, 3),
      value: m.isFuture ? null : m.adherencePct,
      future: m.isFuture,
      current: m.isCurrent,
      tooltip: m.isFuture
        ? { title: name, subtitle: "Mês futuro", rows: [{ label: "Obrigações previstas", value: formatInt(m.obligations) }], announce: `${name}: mês futuro, sem resultado` }
        : {
            title: name,
            subtitle: m.isCurrent ? "Mês corrente" : undefined,
            rows: [
              { label: "Aderência", value: formatPct(m.adherencePct), color: below ? "var(--chart-danger)" : "var(--chart-brand-primary)", marker: "dot" as const, emphasis: true },
              ...(monthTarget != null ? [{ label: "Meta", value: formatPct(monthTarget), color: "var(--chart-target)", marker: "dashed" as const }] : []),
              ...(m.gapPct != null ? [{ label: "Desvio", value: formatGap(m.gapPct), tone: (m.gapPct < 0 ? "danger" : "success") as "danger" | "success" }] : []),
              { label: "Realizados / devidas", value: `${formatInt(m.numerator)} / ${formatInt(m.denominator)}` },
              { label: "Não realizados", value: formatInt(m.notDone) },
              { label: "Expurgos", value: formatInt(m.excluded) },
            ],
            announce: `${name}: ${formatPct(m.adherencePct)}, ${formatInt(m.numerator)} de ${formatInt(m.denominator)}`,
          },
    };
  });
  const past = (monthly?.months ?? []).filter((m) => !m.isFuture && m.adherencePct != null);
  const belowMonths = target == null ? [] : past.filter((m) => (m.adherencePct as number) < (m.targetPct ?? target));

  return (
    <section aria-label="Tendência" className="flex flex-col gap-3">
      <SectionHeader
        title={`Dashboard mensal · ${year}`}
        description={`${CONTEXT_LABEL[context]} · aderência de cada mês pela mesma fórmula; meses futuros não têm resultado.`}
        actions={
          <label className="flex items-center gap-2">
            <span className="text-caption text-fg-muted">Ano</span>
            <NativeSelect
              fieldSize="sm"
              aria-label="Ano do dashboard"
              value={String(year)}
              disabled={pending}
              onChange={(e) => navigate({ ano_dash: e.target.value })}
              className="min-w-[6rem]"
            >
              {years.map((y) => (
                <option key={y} value={y}>{y}</option>
              ))}
            </NativeSelect>
          </label>
        }
      />

      {monthly && monthly.months.length > 0 ? (
        <>
          <ChartCard
            title="Tendência da aderência"
            description={`${CONTEXT_LABEL[context]} · ${year}`}
            legend={
              <ChartLegend
                items={[
                  { key: "adh", label: "Aderência", color: "var(--chart-brand-primary)", shape: "line" },
                  ...(target != null
                    ? [
                        { key: "target", label: `Meta ${formatPct(target)}`, color: "var(--chart-target)", shape: "dashed" as const },
                        { key: "below", label: "Mês abaixo da meta", color: "var(--chart-danger)", shape: "dot" as const },
                      ]
                    : []),
                ]}
              />
            }
            insight={
              past.length === 0
                ? undefined
                : target == null
                  ? `${past.length} ${past.length === 1 ? "mês" : "meses"} com resultado; sem meta definida para comparar.`
                  : belowMonths.length === 0
                    ? `Todos os ${past.length} meses com resultado ficaram na meta ou acima.`
                    : `${belowMonths.length} de ${past.length} meses com resultado abaixo da meta: ${belowMonths.map((m) => MONTH_NAMES[m.month].slice(0, 3).toLowerCase()).join(", ")}.`
            }
          >
            <TrendChart
              points={points}
              target={target}
              kind="percent"
              format={chartFormat.pct}
              axisFormat={chartFormat.pctAxis}
              ariaLabel={`Aderência mensal de ${year}, ${CONTEXT_LABEL[context]}`}
            />
          </ChartCard>

          <TableContainer className="shadow-card">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Mês</TableHead>
                  <TableHead className="text-right">Obrigações</TableHead>
                  <TableHead className="text-right">Num / Den</TableHead>
                  <TableHead className="text-right">Expurgos</TableHead>
                  <TableHead className="text-right">Aderência</TableHead>
                  <TableHead className="text-right">Meta</TableHead>
                  <TableHead className="text-right">Desvio</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {monthly.months.map((m) => (
                  <TableRow
                    key={m.month}
                    data-current={m.isCurrent ? "true" : undefined}
                    className={cn(m.isCurrent && "bg-primary-soft/60", m.isFuture && "text-fg-muted")}
                  >
                    <TableCell className="font-medium text-fg">
                      {MONTH_NAMES[m.month]}
                      {m.isCurrent ? <span className="ml-2 text-caption font-normal text-fg-muted">mês corrente</span> : null}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{formatInt(m.obligations)}</TableCell>
                    <TableCell className="text-right tabular-nums text-fg-muted">
                      {m.isFuture ? "—" : `${formatInt(m.numerator)} / ${formatInt(m.denominator)}`}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{m.isFuture ? "—" : formatInt(m.excluded)}</TableCell>
                    <TableCell className="text-right">
                      {m.isFuture ? (
                        <span className="text-fg-muted">Futuro</span>
                      ) : (
                        <StatusBadge status={pctTone(m.adherencePct, m.targetPct)}>{formatPct(m.adherencePct)}</StatusBadge>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{m.targetPct == null ? "—" : formatPct(m.targetPct)}</TableCell>
                    <TableCell
                      className={cn(
                        "text-right tabular-nums",
                        !m.isFuture && m.gapPct != null && (m.gapPct < 0 ? "text-danger-soft-fg" : "text-success-soft-fg"),
                      )}
                    >
                      {m.isFuture ? "—" : formatGap(m.gapPct)}
                    </TableCell>
                  </TableRow>
                ))}
                <TableRow className="bg-surface-secondary font-semibold">
                  <TableCell className="text-fg">Total do ano</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatInt(monthly.months.reduce((acc, m) => acc + m.obligations, 0))}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-fg-muted">
                    {formatInt(monthly.total.numerator)} / {formatInt(monthly.total.denominator)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{formatInt(monthly.total.excluded)}</TableCell>
                  <TableCell className="text-right">
                    <StatusBadge status={pctTone(monthly.total.adherencePct, target)}>{formatPct(monthly.total.adherencePct)}</StatusBadge>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{target == null ? "—" : formatPct(target)}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {monthly.total.adherencePct == null || target == null ? "—" : formatGap(Math.round((monthly.total.adherencePct - target) * 100) / 100)}
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </TableContainer>
        </>
      ) : (
        <ChartCard title="Tendência da aderência" empty={`Sem dados mensais para ${year} no recorte escolhido.`}>
          {null}
        </ChartCard>
      )}
    </section>
  );
}
