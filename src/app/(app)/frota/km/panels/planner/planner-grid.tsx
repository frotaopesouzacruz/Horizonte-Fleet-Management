"use client";

import * as React from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "@/lib/cn";
import { Badge } from "@/components/ui/badge";
import type { KmPlannerData, KmPlannerRow } from "@/lib/km/planner";
import { fmt1, fmtInt, kmStatusLabel } from "@/lib/km/types";
import {
  cellTitle,
  cellView,
  dayValue,
  HEAT_CLASS,
  PLANNER_EXTRA_LABEL,
  vehicleStatusLabel,
  type DayMeta,
  type PlannerExtraColumn,
  type PlannerMode,
  type RowGroup,
} from "./model";

/**
 * A grade do planner: colunas de cadastro fixas à esquerda, um bloco por dia
 * (só KM no compacto; hodômetro inicial, final e KM no detalhado), rodapé com
 * o total do dia e as leituras do dia. Tabela simples, sem componentes por
 * célula: até ~600 frotas × 31 dias.
 */

type CSSVars = React.CSSProperties & Record<`--${string}`, string>;

interface FixedColumn {
  key: string;
  label: string;
  width: number;
  numeric?: boolean;
  /** Célula de identificação da linha (th scope="row"). */
  rowHeader?: boolean;
  cell: (row: KmPlannerRow) => React.ReactNode;
  title: (row: KmPlannerRow) => string | undefined;
}

const DAY_W = 58;
const ODO_W = 76;

function fixedColumns(extras: PlannerExtraColumn[]): FixedColumn[] {
  const cols: FixedColumn[] = [
    {
      key: "br",
      label: "BR",
      width: 132,
      cell: (r) => (
        <span className="flex min-w-0 items-center gap-1">
          <span className="truncate">{r.br ?? "—"}</span>
          {r.brs.length > 1 ? (
            <Badge size="sm" variant="warning" className="px-1">
              {r.brs.length} BRs<span className="sr-only"> no mês</span>
            </Badge>
          ) : null}
        </span>
      ),
      title: (r) =>
        r.brs.length > 1 ? `${r.brs.length} BRs no mês: ${r.brs.join(", ")} (último: ${r.br ?? "—"})` : (r.br ?? "Sem BR"),
    },
    {
      key: "local",
      label: "Local",
      width: 140,
      cell: (r) => (
        <span className="flex min-w-0 items-center gap-1">
          <span className="truncate">{r.local ?? "—"}</span>
          {r.locals.length > 1 ? (
            <Badge size="sm" variant="info" className="px-1">
              {r.locals.length} locais<span className="sr-only"> no mês</span>
            </Badge>
          ) : null}
        </span>
      ),
      title: (r) =>
        r.locals.length > 1
          ? `${r.locals.length} locais no mês: ${r.locals.join(", ")} (último: ${r.local ?? "—"})`
          : (r.local ?? "Sem local"),
    },
  ];
  if (extras.includes("operacao")) {
    cols.push({
      key: "operation",
      label: PLANNER_EXTRA_LABEL.operacao,
      width: 140,
      cell: (r) => <span className="block truncate">{r.operation ?? "—"}</span>,
      title: (r) => r.operation ?? "Sem operação",
    });
  }
  if (extras.includes("lideranca")) {
    cols.push({
      key: "leader",
      label: PLANNER_EXTRA_LABEL.lideranca,
      width: 150,
      cell: (r) => <span className="block truncate">{r.leader ?? "—"}</span>,
      title: (r) => r.leader ?? "Sem liderança",
    });
  }
  cols.push(
    {
      key: "fleet",
      label: "Frota",
      width: 72,
      cell: (r) => <span className="block truncate">{r.fleetCode ?? "—"}</span>,
      title: (r) => r.fleetCode ?? undefined,
    },
    {
      key: "plate",
      label: "Placa",
      width: 84,
      rowHeader: true,
      cell: (r) => <span className="block truncate font-semibold">{r.plate}</span>,
      title: (r) => r.plate,
    },
    {
      key: "type",
      label: "Tipo",
      width: 104,
      cell: (r) => <span className="block truncate">{r.type ?? "—"}</span>,
      title: (r) => [r.type, r.subcategory].filter(Boolean).join(" · ") || undefined,
    },
    {
      key: "model",
      label: "Modelo",
      width: 112,
      cell: (r) => <span className="block truncate">{r.model ?? "—"}</span>,
      title: (r) => r.model ?? undefined,
    },
    {
      key: "status",
      label: "Status",
      width: 76,
      cell: (r) => <span className="block truncate">{vehicleStatusLabel(r.status)}</span>,
      title: (r) => `Situação da frota no cadastro: ${vehicleStatusLabel(r.status)}`,
    },
    {
      key: "total",
      label: "TT KM Mês",
      width: 92,
      numeric: true,
      cell: (r) => <span className="font-semibold">{r.totalKm == null ? "—" : fmt1(r.totalKm)}</span>,
      title: (r) =>
        r.totalKm == null
          ? `Sem KM validado no mês · ${fmtInt(r.readingDays)} dia(s) com leitura`
          : `${fmt1(r.totalKm)} km validados · ${fmtInt(r.readingDays)} dia(s) com leitura`,
    },
  );
  return cols;
}

interface Layout {
  cols: (FixedColumn & { left: number })[];
  fixedWidth: number;
  dayWidth: number;
  totalWidth: number;
}

function layout(extras: PlannerExtraColumn[], days: number, mode: PlannerMode): Layout {
  let left = 0;
  const cols = fixedColumns(extras).map((c) => {
    const out = { ...c, left };
    left += c.width;
    return out;
  });
  const dayWidth = mode === "detalhado" ? ODO_W * 2 + DAY_W : DAY_W;
  return { cols, fixedWidth: left, dayWidth, totalWidth: left + dayWidth * days };
}

// Classes de posição: vertical sempre; horizontal só a partir de md e com "Fixar colunas".
const PIN = "md:sticky md:left-(--l)";
const pinStyle = (left: number): CSSVars => ({ "--l": `${left}px` });

const LAST_FIXED = "border-r-2 border-r-border";

// ---------------------------------------------------------------------------

interface RowProps {
  row: KmPlannerRow;
  cols: Layout["cols"];
  days: DayMeta[];
  mode: PlannerMode;
  pinned: boolean;
}

const MARK_RING = "shadow-[inset_0_0_0_1px_var(--warning)]";
/** Separador mais forte depois da última coluna fixa (sombra, para não brigar com a borda padrão). */
const LAST_FIXED_SHADOW = "shadow-[inset_-1px_0_0_var(--border)]";
const ODO_BASE = "pd text-fg-secondary";

const PlannerRow = React.memo(function PlannerRow({ row, cols, days, mode, pinned }: RowProps) {
  const last = cols.length - 1;
  return (
    <tr data-testid="km-planner-row" data-plate={row.plate} data-v={row.vehicleId}>
      {cols.map((c, i) => {
        const Tag = c.rowHeader ? "th" : "td";
        // Padrão da célula fixa (classe "pf") vem da tabela; aqui só o que muda.
        let cls = "pf";
        if (c.rowHeader) cls += " text-left";
        if (c.numeric) cls += " text-right tabular-nums";
        if (i === last) cls += ` ${LAST_FIXED_SHADOW}`;
        return (
          <Tag
            key={c.key}
            scope={c.rowHeader ? "row" : undefined}
            title={c.title(row)}
            style={pinned ? pinStyle(c.left) : undefined}
            className={cls}
          >
            {c.cell(row)}
          </Tag>
        );
      })}
      {days.map((d, i) => {
        const v = cellView(row.cells[i]);
        const tint = d.weekend && (v.heat === "no_reading" || v.heat === "out_of_filter" || v.heat === "future");
        // Classes montadas à mão (sem merge): até ~55 mil células no detalhado.
        let kmCls = `pd relative ${HEAT_CLASS[v.heat]}`;
        if (tint) kmCls += " bg-surface-sunken";
        if (v.mark) kmCls += ` ${MARK_RING}`;
        const kmCell = (
          <td key={`${d.day.date}-km`} data-c={i} className={kmCls}>
            {v.mark ? (
              <>
                <span aria-hidden className="absolute left-0.5 top-0 text-[9px] leading-tight font-bold text-fg">
                  {v.mark}
                </span>
                <span className="sr-only">{kmStatusLabel(row.cells[i]?.[0])}: </span>
              </>
            ) : null}
            {v.text}
          </td>
        );
        if (mode === "compacto") return kmCell;
        let odoCls = ODO_BASE;
        if (v.heat === "future" || v.heat === "out_of_filter") odoCls += ` ${HEAT_CLASS[v.heat]}`;
        if (d.weekend) odoCls += " bg-surface-sunken";
        return (
          <React.Fragment key={d.day.date}>
            <td data-c={i} className={odoCls}>
              {v.start}
            </td>
            <td data-c={i} className={odoCls}>
              {v.end}
            </td>
            {kmCell}
          </React.Fragment>
        );
      })}
    </tr>
  );
});

// ---------------------------------------------------------------------------

export interface PlannerGridProps {
  data: KmPlannerData;
  groups: RowGroup[] | null;
  rows: KmPlannerRow[];
  days: DayMeta[];
  mode: PlannerMode;
  extras: PlannerExtraColumn[];
  pinned: boolean;
  collapsed: Set<string>;
  onToggleGroup: (key: string) => void;
  emptyMessage: string | null;
}

export function PlannerGrid({
  data,
  groups,
  rows,
  days,
  mode,
  extras,
  pinned,
  collapsed,
  onToggleGroup,
  emptyMessage,
}: PlannerGridProps) {
  const lay = React.useMemo(() => layout(extras, days.length, mode), [extras, days.length, mode]);
  const byId = React.useMemo(() => new Map(data.rows.map((r) => [r.vehicleId, r])), [data.rows]);

  // Tooltip sob demanda: o título da célula (situação, hodômetros, KM) é montado
  // quando o cursor chega nela, em vez de milhares de textos prontos no DOM.
  const describeCell = React.useCallback(
    (event: React.SyntheticEvent<HTMLTableElement>) => {
      const td = (event.target as HTMLElement).closest?.("td[data-c]") as HTMLTableCellElement | null;
      // Recalculado a cada entrada: o React reaproveita a célula quando os dados mudam.
      if (!td) return;
      const row = byId.get((td.parentElement as HTMLElement | null)?.dataset.v ?? "");
      const i = Number(td.dataset.c);
      if (!row || !days[i]) return;
      td.title = cellTitle(row.cells[i], days[i].day, row.plate);
    },
    [byId, days],
  );
  const { cols } = lay;
  const detailed = mode === "detalhado";
  const dayCols = detailed ? days.length * 3 : days.length;
  const last = cols.length - 1;
  const headTop = "sticky top-0 z-20";
  const headCell = "border-b border-r border-border bg-surface-secondary px-1.5 text-caption font-semibold text-fg-secondary";

  const fixedHead = cols.map((c, i) => (
    <th
      key={c.key}
      scope="col"
      rowSpan={detailed ? 2 : undefined}
      style={pinned ? pinStyle(c.left) : undefined}
      className={cn(
        headCell,
        headTop,
        "h-10 text-left",
        c.numeric && "text-right",
        pinned && `${PIN} md:z-30`,
        i === last && LAST_FIXED,
      )}
    >
      {c.label}
    </th>
  ));

  const renderGroupRows = (list: KmPlannerRow[]) =>
    list.map((row) => <PlannerRow key={row.vehicleId} row={row} cols={cols} days={days} mode={mode} pinned={pinned} />);

  const footCell = "border-t border-r border-border bg-surface-secondary px-1.5 text-caption font-semibold tabular-nums";

  return (
    <div
      role="region"
      aria-label="Planner mês/dia: grade de KM por frota e dia (rolagem horizontal e vertical)"
      tabIndex={0}
      data-testid="km-planner-grid"
      className="relative max-h-[72vh] w-full overflow-auto rounded-md border border-border bg-surface hfm-focus-ring"
    >
      <table
        className={cn(
          "table-fixed border-separate border-spacing-0 text-caption text-fg",
          // padrão das células de dia ("pd") e fixas ("pf"), uma vez só na tabela
          "[&_.pd]:h-7 [&_.pd]:border-b [&_.pd]:border-r [&_.pd]:border-border-subtle [&_.pd]:px-1.5 [&_.pd]:text-right [&_.pd]:align-middle [&_.pd]:tabular-nums",
          "[&_.pf]:h-7 [&_.pf]:border-b [&_.pf]:border-r [&_.pf]:border-border-subtle [&_.pf]:bg-surface-raised [&_.pf]:px-1.5 [&_.pf]:align-middle [&_.pf]:font-normal [&_.pf]:text-fg",
          pinned && "md:[&_.pf]:sticky md:[&_.pf]:left-(--l) md:[&_.pf]:z-10",
        )}
        style={{ width: lay.totalWidth, minWidth: lay.totalWidth }}
        onMouseOver={describeCell}
        onFocus={describeCell}
      >
        <caption className="sr-only">
          Planner mês/dia da competência {data.period.competence}. “—” indica dia sem leitura (não é 0 km); célula
          vazia é dia futuro; “inc.” é leitura inconsistente, fora dos totais.
        </caption>
        <colgroup>
          {cols.map((c) => (
            <col key={c.key} style={{ width: c.width }} />
          ))}
          {days.map((d) =>
            detailed ? (
              <React.Fragment key={d.day.date}>
                <col style={{ width: ODO_W }} />
                <col style={{ width: ODO_W }} />
                <col style={{ width: DAY_W }} />
              </React.Fragment>
            ) : (
              <col key={d.day.date} style={{ width: DAY_W }} />
            ),
          )}
        </colgroup>

        <thead>
          <tr>
            {fixedHead}
            {days.map((d) => (
              <th
                key={d.day.date}
                scope={detailed ? "colgroup" : "col"}
                colSpan={detailed ? 3 : undefined}
                title={d.label}
                className={cn(headCell, headTop, "h-10 text-center", d.weekend && "bg-surface-sunken text-fg-muted")}
              >
                <span className="block text-label leading-tight font-semibold text-fg">{d.dd}</span>
                <span className="block text-[10px] leading-tight font-medium uppercase">{d.weekday}</span>
                <span className="sr-only">{d.future ? " (futuro)" : ""}</span>
              </th>
            ))}
          </tr>
          {detailed ? (
            <tr>
              {days.map((d) => (
                <React.Fragment key={d.day.date}>
                  {(["Inicial", "Final", "KM"] as const).map((sub) => (
                    <th
                      key={sub}
                      scope="col"
                      className={cn(
                        headCell,
                        "sticky top-10 z-20 h-6 text-right text-[10px] font-medium",
                        d.weekend && "bg-surface-sunken",
                      )}
                    >
                      <span className="sr-only">{d.label}: </span>
                      {sub === "KM" ? "KM" : sub === "Inicial" ? "Hod. ini." : "Hod. fin."}
                    </th>
                  ))}
                </React.Fragment>
              ))}
            </tr>
          ) : null}
        </thead>

        {emptyMessage ? (
          <tbody>
            <tr>
              <td colSpan={cols.length + dayCols} className="px-4 py-8 text-center text-body-sm text-fg-muted">
                {emptyMessage}
              </td>
            </tr>
          </tbody>
        ) : groups ? (
          groups.map((g) => {
            const open = !collapsed.has(g.key);
            return (
              <tbody key={g.key} data-testid="km-planner-group">
                <tr>
                  <th
                    scope="rowgroup"
                    colSpan={cols.length}
                    style={pinned ? pinStyle(0) : undefined}
                    className={cn(
                      "h-8 border-b border-r-2 border-border border-r-border bg-surface-secondary px-1 text-left",
                      pinned && `${PIN} md:z-10`,
                    )}
                  >
                    <button
                      type="button"
                      aria-expanded={open}
                      onClick={() => onToggleGroup(g.key)}
                      className="inline-flex max-w-full items-center gap-1.5 rounded-xs px-1 py-0.5 text-body-sm font-semibold text-fg hfm-focus-ring hover:bg-hover-overlay"
                    >
                      {open ? <ChevronDown className="size-4 shrink-0" aria-hidden /> : <ChevronRight className="size-4 shrink-0" aria-hidden />}
                      <span className="truncate">{g.label}</span>
                      <span className="shrink-0 font-normal text-fg-muted">
                        · {fmtInt(g.rows.length)} {g.rows.length === 1 ? "frota" : "frotas"}
                      </span>
                    </button>
                  </th>
                  <td colSpan={dayCols} className="border-b border-border bg-surface-secondary" />
                </tr>
                {open ? renderGroupRows(g.rows) : null}
              </tbody>
            );
          })
        ) : (
          <tbody>{renderGroupRows(rows)}</tbody>
        )}

        <tfoot>
          <tr data-testid="km-planner-day-totals">
            <th
              scope="row"
              colSpan={cols.length - 1}
              style={pinned ? pinStyle(0) : undefined}
              className={cn(footCell, "sticky bottom-7 z-20 h-7 text-left text-fg", pinned && `${PIN} md:z-30`)}
            >
              TOTAL KM DIA
            </th>
            <td
              style={pinned ? pinStyle(cols[last].left) : undefined}
              title={data.totals.daysWithKm > 0 ? `${fmt1(data.totals.km)} km validados no período` : "Sem leitura no período"}
              className={cn(footCell, LAST_FIXED, "sticky bottom-7 z-20 text-right text-fg", pinned && `${PIN} md:z-30`)}
            >
              {data.totals.daysWithKm > 0 ? fmt1(data.totals.km) : "—"}
            </td>
            {days.map((d, i) => (
              <td
                key={d.day.date}
                colSpan={detailed ? 3 : undefined}
                title={`${d.label}: ${d.future ? "dia futuro" : d.noReading ? "sem leitura no dia" : `${fmt1(data.dayTotals[i] ?? null)} km`}`}
                className={cn(
                  footCell,
                  "sticky bottom-7 z-20 text-right text-fg",
                  d.future && HEAT_CLASS.future,
                  d.weekend && "bg-surface-sunken",
                )}
              >
                {dayValue(d, data.dayTotals[i])}
              </td>
            ))}
          </tr>
          <tr data-testid="km-planner-day-readings">
            <th
              scope="row"
              colSpan={cols.length - 1}
              style={pinned ? pinStyle(0) : undefined}
              className={cn(
                footCell,
                "sticky bottom-0 z-20 h-7 border-t-border-subtle text-left font-medium text-fg-secondary",
                pinned && `${PIN} md:z-30`,
              )}
            >
              Frotas com leitura no dia
            </th>
            <td
              style={pinned ? pinStyle(cols[last].left) : undefined}
              title={`${fmtInt(data.totals.readingDays)} veículo-dia com leitura de ${fmtInt(data.totals.elapsedVehicleDays)} decorridos`}
              className={cn(
                footCell,
                LAST_FIXED,
                "sticky bottom-0 z-20 border-t-border-subtle text-right font-medium text-fg-secondary",
                pinned && `${PIN} md:z-30`,
              )}
            >
              {fmtInt(data.totals.readingDays)}
            </td>
            {days.map((d, i) => (
              <td
                key={d.day.date}
                colSpan={detailed ? 3 : undefined}
                title={`${d.label}: ${d.future ? "dia futuro" : `${fmtInt(data.dayReadings[i] ?? 0)} frota(s) com leitura`}`}
                className={cn(
                  footCell,
                  "sticky bottom-0 z-20 border-t-border-subtle text-right font-medium text-fg-secondary",
                  d.future && HEAT_CLASS.future,
                  d.weekend && "bg-surface-sunken",
                )}
              >
                {d.future ? "" : fmtInt(data.dayReadings[i] ?? 0)}
              </td>
            ))}
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
