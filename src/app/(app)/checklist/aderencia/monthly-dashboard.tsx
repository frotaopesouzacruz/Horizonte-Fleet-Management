"use client";

import * as React from "react";
import { Card, CardContent } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  Table, TableBody, TableCell, TableContainer, TableEmpty, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { NativeSelect } from "@/components/governance/selects";
import { cn } from "@/lib/cn";
import type { AdherenceMonthly, ChecklistContext } from "@/lib/adherence/queries";
import { MONTH_NAMES } from "@/lib/governance/competence";
import { CONTEXT_LABEL, formatInt, formatPct } from "./status";
import { pctTone } from "./consolidated-panel";
import { BarChart } from "./adherence-charts";
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
 * Dashboard mensal (§25): os doze meses do ano com a mesma fórmula da
 * consolidada, mês a mês. O ano do dashboard é independente da competência
 * (`ano_dash`), para que se olhe o histórico sem sair do mês em análise.
 * Meses futuros nunca mostram resultado (§16): coluna hachurada e traço.
 */
export function MonthlyDashboard({ monthly, year, context, navigate, pending }: MonthlyDashboardProps) {
  const years = [year - 2, year - 1, year, year + 1, year + 2];
  const target = monthly?.months.find((m) => m.isCurrent)?.targetPct
    ?? monthly?.months.find((m) => !m.isFuture && m.targetPct != null)?.targetPct
    ?? null;

  const items = (monthly?.months ?? []).map((m) => ({
    key: String(m.month),
    label: MONTH_NAMES[m.month].slice(0, 3),
    value: m.isFuture ? null : m.adherencePct,
    future: m.isFuture,
    current: m.isCurrent,
    title: m.isFuture
      ? `${MONTH_NAMES[m.month]}/${year}: mês futuro, sem resultado`
      : `${MONTH_NAMES[m.month]}/${year}: ${formatPct(m.adherencePct)} · ${m.numerator}/${m.denominator} · ${m.excluded} expurgos`,
  }));

  return (
    <Card>
      <CardContent className="flex flex-col gap-4 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-h4 font-semibold text-fg">Dashboard mensal · {year}</h3>
            <p className="text-caption text-fg-muted">
              {CONTEXT_LABEL[context]} · aderência de cada mês pela mesma fórmula; meses futuros não têm resultado.
            </p>
          </div>
          <div className="flex items-center gap-2">
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
          </div>
        </div>

        {monthly && monthly.months.length > 0 ? (
          <>
            <BarChart
              items={items}
              target={target}
              ariaLabel={`Aderência mensal de ${year}, ${CONTEXT_LABEL[context]}`}
            />

            <TableContainer>
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
                      <TableCell className="text-right tabular-nums">{m.isFuture ? "—" : formatGap(m.gapPct)}</TableCell>
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
          <TableContainer>
            <Table>
              <TableBody>
                <TableEmpty colSpan={1} message={`Sem dados mensais para ${year} no recorte escolhido.`} />
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </CardContent>
    </Card>
  );
}
