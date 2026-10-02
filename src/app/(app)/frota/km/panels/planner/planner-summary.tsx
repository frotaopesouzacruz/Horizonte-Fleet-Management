"use client";

import * as React from "react";
import { cn } from "@/lib/cn";
import { Panel } from "@/components/ui/card";
import type { KmPlannerData } from "@/lib/km/planner";
import { fmt1, fmtInt } from "@/lib/km/types";
import { dayValue, HEAT_CLASS, type DayMeta } from "./model";

export interface SummaryGroup {
  key: string;
  label: string;
  vehicles: number;
  km: number;
  days: (number | null)[];
  /** Dias com alguma leitura que conta no conjunto (sem leitura → "—", nunca 0). */
  present: boolean[];
}

type CSSVars = React.CSSProperties & Record<`--${string}`, string>;
const pin = (left: number): CSSVars => ({ "--l": `${left}px` });
const PIN = "md:sticky md:left-(--l) md:z-10";

const LABEL_W = 200;
const COUNT_W = 64;
const KM_W = 100;
const DAY_W = 64;

/**
 * Resumo por tipo / por local — KM do mês e KM por dia, como a rotina devolveu
 * (`by_type`, `by_local`); dia sem nenhuma leitura aparece como "—".
 */
export function PlannerSummary({
  title,
  meta,
  labelHeader,
  groups,
  data,
  days,
  testId,
}: {
  title: string;
  meta?: string;
  labelHeader: string;
  groups: SummaryGroup[];
  data: KmPlannerData;
  days: DayMeta[];
  testId: string;
}) {
  const width = LABEL_W + COUNT_W + KM_W + DAY_W * days.length;
  const cell = "h-7 border-b border-r border-border-subtle px-1.5 text-right tabular-nums";
  const head = "h-9 border-b border-r border-border bg-surface-secondary px-1.5 text-caption font-semibold text-fg-secondary";
  const foot = "h-7 border-r border-border bg-surface-secondary px-1.5 text-right font-semibold tabular-nums";

  return (
    <Panel title={title} meta={meta} padding="none" data-testid={testId}>
      {groups.length === 0 ? (
        <p className="px-4 py-6 text-center text-body-sm text-fg-muted">Sem dados para o período e os filtros atuais.</p>
      ) : (
        <div
          role="region"
          aria-label={`${title}: tabela com rolagem horizontal`}
          tabIndex={0}
          className="w-full overflow-x-auto rounded-b-lg hfm-focus-ring"
        >
          <table
            className="table-fixed border-separate border-spacing-0 text-caption text-fg"
            style={{ width, minWidth: width }}
          >
            <colgroup>
              <col style={{ width: LABEL_W }} />
              <col style={{ width: COUNT_W }} />
              <col style={{ width: KM_W }} />
              {days.map((d) => (
                <col key={d.day.date} style={{ width: DAY_W }} />
              ))}
            </colgroup>
            <thead>
              <tr>
                <th scope="col" style={pin(0)} className={cn(head, "text-left", PIN)}>
                  {labelHeader}
                </th>
                <th scope="col" style={pin(LABEL_W)} className={cn(head, "text-right", PIN)}>
                  Frotas
                </th>
                <th scope="col" style={pin(LABEL_W + COUNT_W)} className={cn(head, "border-r-2 text-right", PIN)}>
                  KM no mês
                </th>
                {days.map((d) => (
                  <th
                    key={d.day.date}
                    scope="col"
                    title={d.label}
                    className={cn(head, "text-center", d.weekend && "bg-surface-sunken")}
                  >
                    <span className="block leading-tight text-fg">{d.dd}</span>
                    <span className="block text-[10px] leading-tight font-medium uppercase">{d.weekday}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {groups.map((g) => (
                <tr key={g.key}>
                  <th
                    scope="row"
                    style={pin(0)}
                    title={g.label}
                    className={cn(cell, "truncate bg-surface-raised text-left font-medium", PIN)}
                  >
                    {g.label}
                  </th>
                  <td style={pin(LABEL_W)} className={cn(cell, "bg-surface-raised", PIN)}>
                    {fmtInt(g.vehicles)}
                  </td>
                  <td
                    style={pin(LABEL_W + COUNT_W)}
                    className={cn(cell, "border-r-2 border-r-border bg-surface-raised font-semibold", PIN)}
                  >
                    {g.present.some(Boolean) ? fmt1(g.km) : "—"}
                  </td>
                  {days.map((d, i) => {
                    const value = dayValue(d, g.days[i], g.present[i]);
                    return (
                      <td
                        key={d.day.date}
                        title={`${g.label} · ${d.label}: ${d.future ? "dia futuro" : value === "—" ? "sem leitura no dia" : `${value} km`}`}
                        className={cn(cell, d.future && HEAT_CLASS.future, value === "—" && "text-fg-subtle", d.weekend && "bg-surface-sunken")}
                      >
                        {value}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th scope="row" style={pin(0)} className={cn(foot, "text-left", PIN)}>
                  Total
                </th>
                <td style={pin(LABEL_W)} className={cn(foot, PIN)}>
                  {fmtInt(data.totals.vehicles)}
                </td>
                <td style={pin(LABEL_W + COUNT_W)} className={cn(foot, "border-r-2", PIN)}>
                  {data.totals.daysWithKm > 0 ? fmt1(data.totals.km) : "—"}
                </td>
                {days.map((d, i) => (
                  <td key={d.day.date} className={cn(foot, d.future && HEAT_CLASS.future, d.weekend && "bg-surface-sunken")}>
                    {dayValue(d, data.dayTotals[i])}
                  </td>
                ))}
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </Panel>
  );
}
