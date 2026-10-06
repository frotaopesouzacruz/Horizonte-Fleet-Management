"use client";

import * as React from "react";
import { Layers } from "lucide-react";
import { cn } from "@/lib/cn";
import { InsightCard } from "@/components/feedback/insight-card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableContainer, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { NativeSelect } from "@/components/governance/selects";
import {
  INDICATOR_DIM_LABEL, fmtInt, fmtMm, fmtPct, plural,
  type TireIndicatorBreakdownItem, type TireIndicatorDim, type TiresIndicator,
} from "@/lib/tires/types";
import type { TiresPanelContext } from "../../shared";
import { PanelEmpty, Section, chartColorOf, useTiresLink, useViewParam } from "../tires-ui";
import { DIM_FILTER_PARAM, DIM_ORDER, DIM_PARAM, fmtDaysAvg } from "./model";

/** Colunas próprias de cada indicador na tabela de quebras. */
type Extra = { key: string; head: string; title: string; value: (b: TireIndicatorBreakdownItem) => React.ReactNode };

function extrasOf(ind: TiresIndicator): Extra[] {
  switch (ind.indicator) {
    case "tread":
      return [{ key: "avgTread", head: "MM médio", title: "Média do menor sulco dos pneus do grupo", value: (b) => fmtMm(b.avgTread) }];
    case "measurement":
    case "calibration":
      return [
        { key: "avgLate", head: "Atraso médio", title: "Média dos dias além do prazo, entre os vencidos", value: (b) => fmtDaysAvg(b.avgLate) },
        { key: "maxLate", head: "Atraso máximo", title: "Maior atraso entre os vencidos do grupo", value: (b) => (b.maxLate == null ? "—" : `${fmtInt(b.maxLate)} ${b.maxLate === 1 ? "dia" : "dias"}`) },
      ];
    case "psi":
    case "calibration_conformity":
      return [
        { key: "avgPsiDevPct", head: "Desvio médio PSI", title: "Média do desvio, em % sobre o ideal, dos pneus com PSI fora da faixa", value: (b) => fmtPct(b.avgPsiDevPct) },
      ];
    default:
      return [];
  }
}

/**
 * "Onde estão os desvios": as quebras do banco (já ordenadas do pior % para o
 * melhor) por Operação, Local, Liderança, Tipo de equipamento e Perfil. A
 * escolha da quebra é estado de exibição na URL (`?agrupar=`), sem nova
 * consulta. O nome do grupo filtra a tela inteira por ele.
 */
export function BreakdownSection({ ind, ctx }: { ind: TiresIndicator; ctx: TiresPanelContext }) {
  const link = useTiresLink(ctx);
  const [raw, setRaw] = useViewParam("agrupar");
  const selectId = React.useId();
  const dims = DIM_ORDER.filter((d) => Array.isArray(ind.breakdowns?.[d]));
  const dim: TireIndicatorDim | undefined = dims.find((d) => DIM_PARAM[d] === raw) ?? dims[0];
  const items = dim ? ind.breakdowns[dim] ?? [] : [];
  const extras = extrasOf(ind);
  const dimLabel = dim ? INDICATOR_DIM_LABEL[dim] : "Grupo";
  // o banco ordena por % asc: o primeiro com base é o pior (sem inventar critério)
  const worst = items.find((b) => b.pct != null) ?? null;
  const worstHasIssue = worst != null && worst.nok > 0;
  const filterParam = dim ? DIM_FILTER_PARAM[dim] : null;

  return (
    <Section
      title="Onde estão os desvios"
      testId="tires-indicator-breakdown"
      description={`Conformidade por ${dimLabel.toLowerCase()}, do pior percentual para o melhor. Clique no nome de um grupo para filtrar a tela por ele.`}
      actions={
        dims.length > 0 ? (
          <div className="flex items-center gap-2">
            <label htmlFor={selectId} className="whitespace-nowrap text-caption text-fg-muted">
              Ver por
            </label>
            <NativeSelect
              id={selectId}
              fieldSize="sm"
              value={dim}
              onChange={(e) => {
                const d = e.target.value as TireIndicatorDim;
                setRaw(d === dims[0] ? null : DIM_PARAM[d]);
              }}
              className="min-w-[12rem]"
              data-testid="tires-indicator-dim"
            >
              {dims.map((d) => (
                <option key={d} value={d}>
                  {INDICATOR_DIM_LABEL[d]}
                </option>
              ))}
            </NativeSelect>
          </div>
        ) : undefined
      }
    >
      {!dim || items.length === 0 ? (
        <PanelEmpty
          icon={<Layers />}
          title="Nenhum grupo no recorte"
          description="Nenhum pneu em uso corresponde aos filtros. Ajuste ou limpe os filtros da tela."
          testId="tires-indicator-breakdown-empty"
        />
      ) : (
        <div className="flex flex-col gap-3">
          {worst ? (
            <InsightCard
              tone={worstHasIssue ? "warning" : "success"}
              label={worstHasIssue ? "Maior desvio" : "Sem desvios"}
              compact
              data-testid="tires-indicator-worst"
            >
              {worstHasIssue ? (
                <>
                  Pior {dimLabel.toLowerCase()}: <strong className="font-semibold text-fg">{worst.label}</strong> ({fmtPct(worst.pct)}) —{" "}
                  {fmtInt(worst.nok)} {plural(worst.nok, "pneu não conforme", "pneus não conformes")} de {fmtInt(worst.total)}
                  {worst.critical > 0 ? `, ${fmtInt(worst.critical)} ${plural(worst.critical, "crítico", "críticos")}` : ""}.
                </>
              ) : (
                <>Todos os grupos por {dimLabel.toLowerCase()} estão 100% conformes neste indicador.</>
              )}
            </InsightCard>
          ) : null}
          <TableContainer stickyHeader maxHeight={440} data-testid="tires-indicator-breakdown-table">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{dimLabel}</TableHead>
                  <TableHead numeric>Pneus</TableHead>
                  <TableHead numeric>Conformes</TableHead>
                  <TableHead numeric>Não conformes</TableHead>
                  <TableHead className="min-w-36">% conformidade</TableHead>
                  <TableHead numeric>Críticos</TableHead>
                  {extras.map((x) => (
                    <TableHead key={x.key} numeric title={x.title}>
                      {x.head}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((b, i) => {
                  const isWorst = worstHasIssue && b === worst;
                  const nav = b.id != null && filterParam ? link({ [filterParam]: b.id, pendencia: null }) : null;
                  const tone = b.pct == null ? "neutral" : b.nok === 0 ? "success" : b.critical > 0 ? "danger" : "warning";
                  return (
                    <TableRow
                      key={b.id ?? `none-${i}`}
                      className={cn("h-10", isWorst && "bg-warning-soft/40")}
                      data-testid="tires-indicator-breakdown-row"
                      data-worst={isWorst || undefined}
                    >
                      <TableCell className="max-w-[18rem] py-1.5">
                        <span className="flex min-w-0 items-center gap-2">
                          {nav ? (
                            <a
                              href={nav.href}
                              onClick={nav.onClick}
                              className="truncate rounded-xs font-medium text-fg underline-offset-2 hover:text-primary hover:underline hfm-focus-ring"
                            >
                              {b.label}
                              <span className="sr-only"> — filtrar a tela por este grupo</span>
                            </a>
                          ) : (
                            <span className={cn("truncate font-medium", b.id == null ? "text-fg-muted" : "text-fg")}>{b.label}</span>
                          )}
                          {isWorst ? (
                            <Badge variant="warning" size="sm">
                              Pior
                            </Badge>
                          ) : null}
                        </span>
                      </TableCell>
                      <TableCell numeric className="py-1.5">{fmtInt(b.total)}</TableCell>
                      <TableCell numeric className="py-1.5 text-fg-secondary">{fmtInt(b.ok)}</TableCell>
                      <TableCell numeric className={cn("py-1.5", b.nok > 0 ? "font-semibold text-fg" : "text-fg-muted")}>{fmtInt(b.nok)}</TableCell>
                      <TableCell className="py-1.5">
                        <span className="flex items-center gap-2">
                          <span aria-hidden className="block h-1.5 w-16 shrink-0 overflow-hidden rounded-full bg-surface-sunken">
                            <span className="block h-full rounded-full" style={{ width: `${b.pct ?? 0}%`, background: chartColorOf(tone) }} />
                          </span>
                          <span className="font-semibold tabular-nums text-fg">{fmtPct(b.pct)}</span>
                        </span>
                      </TableCell>
                      <TableCell numeric className={cn("py-1.5", b.critical > 0 ? "font-semibold text-danger-soft-fg" : "text-fg-muted")}>
                        {fmtInt(b.critical)}
                      </TableCell>
                      {extras.map((x) => (
                        <TableCell key={x.key} numeric className="whitespace-nowrap py-1.5 text-fg-secondary">
                          {x.value(b)}
                        </TableCell>
                      ))}
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </TableContainer>
        </div>
      )}
    </Section>
  );
}
