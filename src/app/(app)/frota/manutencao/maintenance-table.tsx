"use client";

import * as React from "react";
import { cn } from "@/lib/cn";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Pagination } from "@/components/ui/pagination";
import { StatusBadge } from "@/components/ui/status-badge";
import { Table, TableBody, TableCell, TableContainer, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState } from "@/components/feedback/empty-state";
import { ErrorState } from "@/components/feedback/error-state";
import { KmStatusBadge, MaintenanceStatusBadge, MaintenanceTypeBadge } from "@/components/maintenance/badges";
import {
  formatDate,
  formatDateTime,
  formatHours,
  formatInt,
  formatKm,
  KM_STATUS_LABEL,
  KM_STATUS_TONE,
  vehicleLabel,
  type MaintenancePage,
  type MaintenanceRow,
  type MaintenanceSortKey,
} from "@/lib/maintenance/types";
import type { ListState, PanelActions } from "./shared";

/**
 * Tabela de manutenções da Programação e da Base geral.
 *
 * Só apresenta: situação, TMM, KM e alertas chegam prontos do servidor. A
 * ordenação e a página moram na URL (`ordenar`, `dir`, `pagina`,
 * `por_pagina`) e cada clique é uma ida ao servidor. Abaixo de `lg` as mesmas
 * linhas viram cartões — uma tabela de catorze colunas num celular é uma
 * tabela escondida.
 */

export type MaintenanceColumnKey =
  | "code"
  | "vehicle"
  | "type"
  | "services"
  | "status"
  | "location"
  | "supplier"
  | "requested"
  | "scheduled"
  | "entry"
  | "exit"
  | "age"
  | "duration"
  | "entryKm";

interface Column {
  key: MaintenanceColumnKey;
  label: string;
  /** Largura mínima, em px, para o cabeçalho caber inteiro. */
  width: number;
  sort?: MaintenanceSortKey;
  numeric?: boolean;
  hint?: string;
  render: (row: MaintenanceRow, open: (id: string) => void) => React.ReactNode;
}

export const SORT_LABEL: Record<MaintenanceSortKey, string> = {
  reference: "data de referência",
  requested: "data da solicitação",
  scheduled: "agendamento",
  entry: "entrada",
  exit: "saída",
  code: "código",
  plate: "veículo",
  status: "situação",
  duration: "TMM",
};

const dash = <span className="text-fg-muted">—</span>;

function Two({ main, sub, title }: { main: React.ReactNode; sub?: React.ReactNode; title?: string }) {
  return (
    <div className="flex min-w-0 flex-col" title={title}>
      <span className="truncate">{main}</span>
      {sub ? <span className="truncate text-caption text-fg-muted">{sub}</span> : null}
    </div>
  );
}

function ServicesCell({ row }: { row: MaintenanceRow }) {
  if (row.items.length === 0) return <span className="text-fg-muted">Sem serviços</span>;
  const [first, ...rest] = row.items;
  const clusters = [...new Set(row.items.map((i) => i.cluster))];
  const full = row.items.map((i) => `${i.cluster}: ${i.service}`).join("\n");
  return (
    <div className="flex min-w-0 flex-col" title={full}>
      <span className="flex min-w-0 items-center gap-1.5">
        <span className="truncate text-fg">{first.service}</span>
        {rest.length > 0 ? (
          <Badge variant="neutral" size="sm" className="tabular-nums">
            <span aria-hidden>+{rest.length}</span>
            <span className="sr-only">e mais: {rest.map((i) => i.service).join(", ")}</span>
          </Badge>
        ) : null}
      </span>
      <span className="truncate text-caption text-fg-muted">{clusters.join(" · ")}</span>
    </div>
  );
}

/** Selos de alerta da linha — todos calculados pelo banco. */
function AlertBadges({ row }: { row: MaintenanceRow }) {
  return (
    <>
      {row.lateEntry ? (
        <Badge variant="warning" appearance="outline" size="sm" title="Agendada para uma data que já passou, sem entrada registrada">
          Entrada atrasada
        </Badge>
      ) : null}
      {row.exitOverdue ? (
        <Badge variant="danger" appearance="outline" size="sm" title="Em execução com a previsão de saída já vencida">
          Saída vencida
        </Badge>
      ) : null}
      {row.reopenCount > 0 ? (
        <Badge variant="neutral" appearance="outline" size="sm" title={`Reaberta ${row.reopenCount} vez(es)`}>
          Reaberta{row.reopenCount > 1 ? ` ${row.reopenCount}×` : ""}
        </Badge>
      ) : null}
    </>
  );
}

function location(row: MaintenanceRow) {
  const city = row.cityName ? `${row.cityName}${row.stateUf ? `/${row.stateUf}` : ""}` : row.stateUf;
  return [city, row.brCode ? `BR ${row.brCode}` : null].filter(Boolean).join(" · ");
}

function ExitCell({ row }: { row: MaintenanceRow }) {
  if (row.exitDate) return <span className="tabular-nums">{formatDateTime(row.exitDate, row.exitTime)}</span>;
  if (row.expectedExitDate) {
    return (
      <span className={cn("tabular-nums", row.exitOverdue && "text-danger-soft-fg")} title="Previsão de saída">
        <span className="text-caption text-fg-muted">Prev. </span>
        {formatDateTime(row.expectedExitDate, row.expectedExitTime)}
      </span>
    );
  }
  return dash;
}

function DurationValue({ row }: { row: MaintenanceRow }) {
  if (row.durationHours == null) return dash;
  const approx = row.durationPrecision === "date";
  return (
    <span title={approx ? "Aproximado: calculado só pelas datas, sem a hora de entrada ou de saída" : "Entrada e saída reais"}>
      {approx ? (
        <>
          <span aria-hidden>≈ </span>
          <span className="sr-only">aproximadamente </span>
        </>
      ) : null}
      {formatHours(row.durationHours)}
    </span>
  );
}

const COLUMNS: Column[] = [
  {
    key: "code",
    label: "Código",
    width: 164,
    sort: "code",
    render: (row, open) => (
      <button
        type="button"
        data-testid="maintenance-row-open"
        onClick={(event) => {
          event.stopPropagation();
          open(row.id);
        }}
        aria-label={`Abrir manutenção ${row.code}`}
        className="rounded-xs font-semibold whitespace-nowrap text-link tabular-nums underline-offset-2 hfm-focus-ring hover:underline"
      >
        {row.code}
      </button>
    ),
  },
  {
    key: "vehicle",
    label: "Veículo",
    width: 170,
    sort: "plate",
    render: (row) => (
      <Two
        main={<span className="font-medium text-fg">{vehicleLabel(row.licensePlate, row.fleetCode)}</span>}
        sub={row.leaderName ?? undefined}
        title={[vehicleLabel(row.licensePlate, row.fleetCode), row.leaderName].filter(Boolean).join(" · ")}
      />
    ),
  },
  {
    key: "type",
    label: "Tipo",
    width: 124,
    render: (row) => <MaintenanceTypeBadge type={row.type} name={row.typeName} />,
  },
  { key: "services", label: "Serviços", width: 230, render: (row) => <ServicesCell row={row} /> },
  {
    key: "status",
    label: "Situação",
    width: 232,
    sort: "status",
    render: (row) => (
      <div className="flex flex-wrap items-center gap-1">
        <MaintenanceStatusBadge status={row.status} />
        <AlertBadges row={row} />
      </div>
    ),
  },
  {
    key: "location",
    label: "Operação / Cidade / BR",
    width: 210,
    render: (row) => (
      <Two
        main={row.operationName ?? <span className="text-fg-muted">Sem operação</span>}
        sub={location(row) || undefined}
        title={[row.operationName, location(row)].filter(Boolean).join(" · ")}
      />
    ),
  },
  {
    key: "supplier",
    label: "Fornecedor",
    width: 180,
    render: (row) =>
      row.supplierName || row.supplierNameInformed || row.serviceOrderNumber ? (
        <Two
          main={
            row.supplierName ??
            (row.supplierNameInformed ? (
              <span className="text-fg-secondary">
                {row.supplierNameInformed} <span className="text-fg-muted">(fora do catálogo)</span>
              </span>
            ) : (
              <span className="text-fg-muted">Sem fornecedor</span>
            ))
          }
          sub={row.serviceOrderNumber ? `OS ${row.serviceOrderNumber}` : undefined}
          title={[
            row.supplierName ?? (row.supplierNameInformed ? `${row.supplierNameInformed} (informado na importação, fora do catálogo)` : null),
            row.serviceOrderNumber ? `OS ${row.serviceOrderNumber}` : null,
          ]
            .filter(Boolean)
            .join(" · ")}
        />
      ) : (
        dash
      ),
  },
  {
    key: "requested",
    label: "Solicitação",
    width: 116,
    sort: "requested",
    render: (row) => <span className="tabular-nums">{formatDate(row.requestedOn)}</span>,
  },
  {
    key: "scheduled",
    label: "Agendamento",
    width: 144,
    sort: "scheduled",
    render: (row) =>
      row.scheduledDate ? <span className="tabular-nums">{formatDateTime(row.scheduledDate, row.scheduledTime)}</span> : dash,
  },
  {
    key: "entry",
    label: "Entrada",
    width: 140,
    sort: "entry",
    render: (row) => (row.entryDate ? <span className="tabular-nums">{formatDateTime(row.entryDate, row.entryTime)}</span> : dash),
  },
  { key: "exit", label: "Saída / previsão", width: 168, sort: "exit", render: (row) => <ExitCell row={row} /> },
  {
    key: "age",
    label: "Aberta há",
    width: 100,
    numeric: true,
    hint: "Dias desde a entrada (em execução) ou desde a solicitação",
    render: (row) => (row.ageDays == null ? dash : `${formatInt(row.ageDays)} d`),
  },
  {
    key: "duration",
    label: "TMM",
    width: 104,
    sort: "duration",
    numeric: true,
    hint: "Tempo de manutenção: da entrada real à saída real",
    render: (row) => <DurationValue row={row} />,
  },
  {
    key: "entryKm",
    label: "KM de entrada",
    width: 210,
    render: (row) => (
      <div className="flex items-center gap-1.5">
        {row.entryKm != null ? <span className="tabular-nums">{formatKm(row.entryKm)}</span> : null}
        <KmStatusBadge status={row.entryKmStatus} />
      </div>
    ),
  },
];

export interface MaintenanceTableProps {
  /** `null` quando a leitura falhou. */
  page: MaintenancePage | null;
  list: ListState;
  actions: PanelActions;
  /** Nome acessível da tabela. */
  label: string;
  hiddenColumns?: MaintenanceColumnKey[];
  /** Colunas em destaque (ex.: agendamento e previsão, na Programação). */
  highlightColumns?: MaintenanceColumnKey[];
  emptyTitle?: string;
  emptyDescription?: string;
  emptyAction?: React.ReactNode;
  className?: string;
}

const PAGE_SIZES = [25, 50, 100, 200];

export function MaintenanceTable({
  page,
  list,
  actions,
  label,
  hiddenColumns = [],
  highlightColumns = [],
  emptyTitle = "Nenhuma manutenção encontrada",
  emptyDescription = "Nenhuma manutenção corresponde aos filtros escolhidos. Ajuste o período ou limpe os filtros.",
  emptyAction,
  className,
}: MaintenanceTableProps) {
  const { navigate, openMaintenance, pending, refresh } = actions;
  const columns = COLUMNS.filter((c) => !hiddenColumns.includes(c.key));
  const minWidth = columns.reduce((sum, c) => sum + c.width, 0);
  const strong = (key: MaintenanceColumnKey) => highlightColumns.includes(key);

  if (!page) {
    return (
      <ErrorState
        className={className}
        title="Não foi possível carregar as manutenções."
        description="A leitura da lista falhou. Os demais dados da tela seguem disponíveis."
        onRetry={refresh}
        retryLabel="Tentar de novo"
        retrying={pending}
        data-testid="maintenance-table-error"
      />
    );
  }

  if (page.rows.length === 0) {
    const beyond = page.total > 0 && list.page > 1;
    return (
      <EmptyState
        className={className}
        variant="panel"
        title={beyond ? "Esta página não tem registros" : emptyTitle}
        description={
          beyond
            ? `A lista tem ${formatInt(page.total)} manutenções, mas a página ${formatInt(list.page)} ficou vazia.`
            : emptyDescription
        }
        action={
          beyond ? (
            <Button variant="secondary" size="sm" onClick={() => navigate({ pagina: null })} disabled={pending}>
              Ir para a primeira página
            </Button>
          ) : (
            emptyAction
          )
        }
        data-testid="maintenance-table-empty"
      />
    );
  }

  const onRowClick = (event: React.MouseEvent<HTMLTableRowElement>, id: string) => {
    // Botões e o selo de KM (com dica) têm ação própria. Só conta o que está
    // dentro da linha: a aba em volta também tem tabindex.
    const row = event.currentTarget;
    const own = (event.target as HTMLElement).closest("a, button, input, select, textarea, [tabindex]");
    if (own && own !== row && row.contains(own)) return;
    openMaintenance(id);
  };

  const onSort = (key: MaintenanceSortKey) => (dir: "asc" | "desc") => navigate({ ordenar: key, dir, pagina: null });

  const visibleDates = (["requested", "scheduled", "entry", "exit"] as const).filter((k) => !hiddenColumns.includes(k));

  return (
    <div className={cn("flex min-w-0 flex-col gap-3", className)} aria-busy={pending || undefined} data-testid="maintenance-table">
      <TableContainer tabIndex={0} stickyHeader maxHeight="max(24rem, calc(100dvh - 18rem))" className="hidden lg:block">
        <Table layout="fixed" style={{ minWidth }} aria-label={label}>
          <TableHeader>
            <TableRow>
              {columns.map((column, index) => (
                <TableHead
                  key={column.key}
                  style={{ width: column.width, left: index === 0 ? 0 : undefined, zIndex: index === 0 ? 21 : undefined }}
                  className={cn(
                    index === 0 && "sticky border-r border-border bg-surface-secondary",
                    strong(column.key) && "text-fg",
                  )}
                  numeric={column.numeric}
                  title={column.hint}
                  sortable={Boolean(column.sort)}
                  sortDirection={column.sort && list.sort === column.sort ? list.dir : null}
                  onSort={column.sort ? onSort(column.sort) : undefined}
                >
                  {column.label}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {page.rows.map((row) => (
              <TableRow
                key={row.id}
                data-testid="maintenance-row"
                onClick={(event) => onRowClick(event, row.id)}
                className="group h-(--table-row-height) cursor-pointer"
              >
                {columns.map((column, index) => (
                  <TableCell
                    key={column.key}
                    numeric={column.numeric}
                    style={{ left: index === 0 ? 0 : undefined, zIndex: index === 0 ? 1 : undefined }}
                    className={cn(
                      "py-1.5",
                      index === 0 &&
                        "sticky border-r border-border bg-surface after:pointer-events-none after:absolute after:inset-0 after:bg-hover-overlay after:opacity-0 group-hover:after:opacity-100",
                      strong(column.key) ? "font-medium text-fg" : "text-fg-secondary",
                    )}
                  >
                    {column.render(row, openMaintenance)}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>

      {/* Abaixo de lg: cartões com o essencial; o detalhe completo está na gaveta. */}
      <ul className="flex flex-col gap-2 lg:hidden" aria-label={label}>
        {page.rows.map((row) => (
          <li key={row.id}>
            <button
              type="button"
              data-testid="maintenance-card"
              onClick={() => openMaintenance(row.id)}
              className="flex w-full flex-col gap-2 rounded-md border border-border bg-surface p-3 text-left hfm-transition hover:border-border-strong hfm-focus-ring"
            >
              <span className="flex w-full items-start justify-between gap-2">
                <span className="min-w-0">
                  <span className="block truncate text-body-sm font-semibold text-fg tabular-nums">{row.code}</span>
                  <span className="block truncate text-caption text-fg-secondary">
                    {vehicleLabel(row.licensePlate, row.fleetCode)}
                    {row.operationName ? ` · ${row.operationName}` : ""}
                  </span>
                </span>
                <MaintenanceTypeBadge type={row.type} name={row.typeName} />
              </span>
              <span className="flex flex-wrap items-center gap-1">
                <MaintenanceStatusBadge status={row.status} />
                <AlertBadges row={row} />
              </span>
              {row.items.length ? (
                <span className="line-clamp-2 text-caption text-fg-secondary">
                  {row.items.map((i) => i.service).join(" · ")}
                </span>
              ) : null}
              <span className="grid w-full grid-cols-2 gap-x-3 gap-y-1 text-caption">
                {visibleDates.map((k) => (
                  <span key={k} className="flex min-w-0 flex-col">
                    <span className="text-fg-muted">
                      {k === "requested" ? "Solicitação" : k === "scheduled" ? "Agendamento" : k === "entry" ? "Entrada" : row.exitDate ? "Saída" : "Previsão de saída"}
                    </span>
                    <span className={cn("truncate text-fg tabular-nums", strong(k) && "font-semibold")}>
                      {k === "requested"
                        ? formatDate(row.requestedOn)
                        : k === "scheduled"
                          ? formatDateTime(row.scheduledDate, row.scheduledTime)
                          : k === "entry"
                            ? formatDateTime(row.entryDate, row.entryTime)
                            : row.exitDate
                              ? formatDateTime(row.exitDate, row.exitTime)
                              : formatDateTime(row.expectedExitDate, row.expectedExitTime)}
                    </span>
                  </span>
                ))}
                {!hiddenColumns.includes("duration") ? (
                  <span className="flex min-w-0 flex-col">
                    <span className="text-fg-muted">TMM</span>
                    <span className="text-fg tabular-nums">
                      <DurationValue row={row} />
                    </span>
                  </span>
                ) : null}
                {!hiddenColumns.includes("entryKm") ? (
                  <span className="flex min-w-0 flex-col">
                    <span className="text-fg-muted">KM de entrada</span>
                    <span className="flex flex-wrap items-center gap-1 text-fg tabular-nums">
                      {formatKm(row.entryKm)}
                      {row.entryKmStatus ? (
                        <StatusBadge status={KM_STATUS_TONE[row.entryKmStatus] ?? "neutral"} size="sm">
                          {KM_STATUS_LABEL[row.entryKmStatus] ?? row.entryKmStatus}
                        </StatusBadge>
                      ) : null}
                    </span>
                  </span>
                ) : null}
              </span>
            </button>
          </li>
        ))}
      </ul>

      <Pagination
        page={list.page}
        pageSize={list.pageSize}
        total={page.total}
        disabled={pending}
        pageSizeOptions={PAGE_SIZES}
        onPageChange={(p) => navigate({ pagina: p > 1 ? String(p) : null })}
        onPageSizeChange={(size) => navigate({ por_pagina: String(size), pagina: null })}
        label={`Páginas: ${label}`}
      />
    </div>
  );
}
