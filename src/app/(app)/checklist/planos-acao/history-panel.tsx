"use client";

import * as React from "react";
import { Filter, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { DateInput } from "@/components/ui/date-input";
import { SearchField } from "@/components/ui/search-field";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { StatusBadge, type StatusTone } from "@/components/ui/status-badge";
import { Pagination } from "@/components/ui/pagination";
import {
  Table, TableBody, TableCell, TableContainer, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { EmptyState } from "@/components/feedback/empty-state";
import { ErrorState } from "@/components/feedback/error-state";
import { CHECKLIST_TYPE_LABEL, formatDate, formatDateTime, formatInt } from "@/lib/action-plans/labels";
import type { ActionPlanCatalog, HistoryRow } from "@/lib/action-plans/types";
import { FILTER_PARAM } from "@/lib/action-plans/types";
import { PAGE_SIZES, type ActionPlansViewData, type PanelActions } from "./shared";

/**
 * Histórico de checklists (§66) — os checklists enviados com inconformidade,
 * paginados no servidor. Cada linha abre o rastro ponta a ponta: checklist →
 * inconformidade → plano → manutenção → resolução. A tela não calcula nada:
 * contagens e situação do recebimento vêm prontas da rotina.
 */

export interface HistoryPanelProps {
  history: NonNullable<ActionPlansViewData["history"]>;
  catalog: ActionPlanCatalog;
  actions: PanelActions;
}

const INGESTION: Record<string, { label: string; tone: StatusTone }> = {
  processed: { label: "Processado", tone: "success" },
  pending: { label: "Pendente", tone: "pending" },
  failed: { label: "Falhou", tone: "danger" },
};
const NO_INGESTION = { label: "Sem registro", tone: "neutral" as StatusTone };

const ALL = "__todas__";

const timeFormat = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" });
const sentAt = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : `enviado ${timeFormat.format(d)}`;
};

const vehicleText = (row: HistoryRow) =>
  [row.licensePlate, row.fleetCode ? `Frota ${row.fleetCode}` : null].filter(Boolean).join(" · ") || "Veículo sem identificação";

export function HistoryPanel({ history, catalog, actions }: HistoryPanelProps) {
  const { page, filters, list } = history;
  const { navigate, pending, openTrace } = actions;

  const extraFilters = [
    filters.vehicle ? { key: FILTER_PARAM.vehicle, label: "Veículo selecionado" } : null,
    filters.employee ? { key: "colaborador", label: "Colaborador selecionado" } : null,
  ].filter((f): f is { key: string; label: string } => f !== null);

  return (
    <div className="flex min-w-0 flex-col gap-4" data-testid="action-plans-history">
      <div className="flex flex-col gap-1">
        <h2 className="text-h4 font-semibold text-fg">Histórico de checklists</h2>
        <p className="text-body-sm text-fg-muted">
          Checklists enviados com inconformidade, do mais recente ao mais antigo. Abra uma linha para ver o caminho completo:
          checklist → inconformidade → plano → manutenção → resolução.
        </p>
      </div>

      <HistoryFilterBar
        key={`${filters.from ?? ""}|${filters.to ?? ""}|${filters.q ?? ""}|${filters.operation ?? ""}`}
        filters={filters}
        catalog={catalog}
        actions={actions}
      />

      {extraFilters.length ? (
        <div className="flex flex-wrap items-center gap-2">
          {extraFilters.map((f) => (
            <Badge key={f.key} variant="info" size="sm" className="gap-1">
              {f.label}
              <button
                type="button"
                aria-label={`Remover filtro: ${f.label}`}
                className="rounded-xs hfm-focus-ring"
                onClick={() => navigate({ [f.key]: null, pagina: null })}
              >
                <X className="size-3" aria-hidden />
              </button>
            </Badge>
          ))}
        </div>
      ) : null}

      {!page ? (
        <ErrorState
          variant="panel"
          headingLevel={3}
          title="Não foi possível carregar o histórico."
          description="A consulta falhou. Tente de novo; se persistir, avise o administrador do HFM."
          onRetry={actions.refresh}
          retrying={pending}
        />
      ) : page.rows.length === 0 ? (
        <EmptyState
          variant="panel"
          headingLevel={3}
          title={page.total > 0 && list.page > 1 ? "Esta página não tem registros" : "Nenhum checklist com inconformidade no recorte"}
          description={
            page.total > 0 && list.page > 1
              ? `O histórico tem ${formatInt(page.total)} checklists, mas a página ${formatInt(list.page)} ficou vazia.`
              : "Ajuste o período, a placa/frota ou a operação. Só aparecem checklists enviados com ao menos uma inconformidade, nas operações do seu acesso."
          }
          action={
            page.total > 0 && list.page > 1 ? (
              <Button variant="secondary" size="sm" onClick={() => navigate({ pagina: null })} disabled={pending}>
                Ir para a primeira página
              </Button>
            ) : undefined
          }
        />
      ) : (
        <>
          <p className="text-caption text-fg-muted" aria-live="polite">
            {formatInt(page.total)} {page.total === 1 ? "checklist" : "checklists"} com inconformidade
          </p>
          <HistoryTable rows={page.rows} openTrace={openTrace} />
          <HistoryCards rows={page.rows} openTrace={openTrace} />
          <Pagination
            page={list.page}
            pageSize={list.pageSize}
            total={page.total}
            pageSizeOptions={PAGE_SIZES}
            disabled={pending}
            onPageChange={(p) => navigate({ pagina: p > 1 ? String(p) : null })}
            onPageSizeChange={(size) => navigate({ por_pagina: String(size), pagina: null })}
            label="Paginação do histórico de checklists"
          />
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Filtros (período, placa/frota, operação) — vivem na URL
// ---------------------------------------------------------------------------
function HistoryFilterBar({
  filters, catalog, actions,
}: { filters: HistoryPanelProps["history"]["filters"]; catalog: ActionPlanCatalog; actions: PanelActions }) {
  const [from, setFrom] = React.useState(filters.from ?? "");
  const [to, setTo] = React.useState(filters.to ?? "");
  const [q, setQ] = React.useState(filters.q ?? "");
  const [operation, setOperation] = React.useState(filters.operation?.split(",")[0] ?? ALL);
  const invalid = Boolean(from && to && to < from);
  const active = Boolean(filters.from || filters.to || filters.q || filters.operation);

  const apply = (event: React.FormEvent) => {
    event.preventDefault();
    if (invalid) return;
    actions.navigate({
      [FILTER_PARAM.from]: from || null,
      [FILTER_PARAM.to]: to || null,
      [FILTER_PARAM.q]: q.trim() || null,
      [FILTER_PARAM.operation]: operation === ALL ? null : operation,
      pagina: null,
    });
  };

  const clear = () =>
    actions.navigate({
      [FILTER_PARAM.from]: null,
      [FILTER_PARAM.to]: null,
      [FILTER_PARAM.q]: null,
      [FILTER_PARAM.operation]: null,
      pagina: null,
    });

  return (
    <form
      onSubmit={apply}
      role="search"
      aria-label="Filtros do histórico de checklists"
      className="grid grid-cols-2 items-end gap-3 rounded-md border border-border bg-surface p-3 md:grid-cols-[repeat(2,minmax(0,9.5rem))_minmax(0,1fr)_minmax(0,14rem)_auto]"
    >
      <label className="flex min-w-0 flex-col gap-1">
        <span className="text-caption font-medium text-fg-secondary">De</span>
        <DateInput size="sm" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} />
      </label>
      <label className="flex min-w-0 flex-col gap-1">
        <span className="text-caption font-medium text-fg-secondary">Até</span>
        <DateInput
          size="sm"
          value={to}
          min={from || undefined}
          onChange={(e) => setTo(e.target.value)}
          aria-invalid={invalid || undefined}
        />
      </label>
      <label className="col-span-2 flex min-w-0 flex-col gap-1 md:col-span-1">
        <span className="text-caption font-medium text-fg-secondary">Placa ou frota</span>
        <SearchField size="sm" value={q} onValueChange={setQ} placeholder="Ex.: ABC1D23 ou 1024" aria-label="Placa ou frota" />
      </label>
      <div className="col-span-2 flex min-w-0 flex-col gap-1 md:col-span-1">
        <span id="history-operation-label" className="text-caption font-medium text-fg-secondary">Operação</span>
        <Select value={operation} onValueChange={setOperation}>
          <SelectTrigger size="sm" aria-labelledby="history-operation-label">
            <SelectValue placeholder="Todas" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Todas as operações</SelectItem>
            {catalog.operations.map((o) => (
              <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="col-span-2 flex flex-wrap items-center gap-2 md:col-span-1">
        <Button type="submit" size="sm" leadingIcon={<Filter />} disabled={invalid || actions.pending}>
          Aplicar
        </Button>
        {active ? (
          <Button type="button" size="sm" variant="ghost" onClick={clear} disabled={actions.pending}>
            Limpar
          </Button>
        ) : null}
      </div>
      {invalid ? (
        <p className="col-span-2 text-caption text-danger md:col-span-5" role="alert">
          A data final precisa ser igual ou posterior à inicial.
        </p>
      ) : null}
    </form>
  );
}

// ---------------------------------------------------------------------------
// Tabela (lg+) e cartões (celular)
// ---------------------------------------------------------------------------
function Ingestion({ status }: { status: HistoryRow["ingestionStatus"] }) {
  const meta = (status && INGESTION[status]) || NO_INGESTION;
  return <StatusBadge status={meta.tone} size="sm">{meta.label}</StatusBadge>;
}

function Counter({ value, extra, tone }: { value: number; extra?: string | null; tone?: "danger" | "warning" }) {
  return (
    <span className="inline-flex flex-col items-end leading-tight">
      <span className="font-medium text-fg tabular-nums">{formatInt(value)}</span>
      {extra ? (
        <span className={cn("text-caption tabular-nums", tone === "danger" ? "text-danger" : tone === "warning" ? "text-warning-soft-fg" : "text-fg-muted")}>
          {extra}
        </span>
      ) : null}
    </span>
  );
}

function rowLabel(row: HistoryRow) {
  return `Abrir checklist de ${formatDate(row.operationalDate)} · ${vehicleText(row)}`;
}

function HistoryTable({ rows, openTrace }: { rows: HistoryRow[]; openTrace: (id: string) => void }) {
  const onRowClick = (event: React.MouseEvent<HTMLTableRowElement>, id: string) => {
    const row = event.currentTarget;
    const own = (event.target as HTMLElement).closest("a, button, input, select, textarea");
    if (own && own !== row && row.contains(own)) return;
    openTrace(id);
  };

  return (
    <TableContainer tabIndex={0} stickyHeader maxHeight="max(24rem, calc(100dvh - 18rem))" className="hidden lg:block">
      <Table layout="fixed" style={{ minWidth: 1180 }} aria-label="Checklists com inconformidade">
        <TableHeader>
          <TableRow>
            <TableHead style={{ width: 132 }}>Data</TableHead>
            <TableHead style={{ width: 84 }}>Tipo</TableHead>
            <TableHead style={{ width: 150 }}>Placa / frota</TableHead>
            <TableHead style={{ width: 190 }}>Colaborador</TableHead>
            <TableHead style={{ width: 170 }}>Operação</TableHead>
            <TableHead style={{ width: 110 }}>BR</TableHead>
            <TableHead style={{ width: 110 }} numeric title="Inconformidades (críticas)">Inconformidades</TableHead>
            <TableHead style={{ width: 110 }} numeric title="Apontamentos de manutenção (em aberto)">Apontamentos</TableHead>
            <TableHead style={{ width: 96 }} numeric title="Inconformidades encaminhadas ao fluxo de Avarias">Avarias</TableHead>
            <TableHead style={{ width: 128 }}>Recebimento</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow
              key={row.id}
              data-testid="action-plans-history-row"
              onClick={(event) => onRowClick(event, row.id)}
              className="h-(--table-row-height) cursor-pointer"
            >
              <TableCell className="py-1.5">
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    openTrace(row.id);
                  }}
                  aria-label={rowLabel(row)}
                  className="flex flex-col items-start rounded-xs text-left hfm-focus-ring"
                >
                  <span className="font-semibold text-link tabular-nums underline-offset-2 hover:underline">
                    {formatDate(row.operationalDate)}
                  </span>
                  {row.submittedAt ? (
                    <span className="text-caption text-fg-muted tabular-nums" title={formatDateTime(row.submittedAt)}>
                      {sentAt(row.submittedAt)}
                    </span>
                  ) : null}
                </button>
              </TableCell>
              <TableCell className="text-fg-secondary">
                {row.checklistType ? (CHECKLIST_TYPE_LABEL[row.checklistType] ?? row.checklistType) : "—"}
              </TableCell>
              <TableCell>
                <span className="flex min-w-0 flex-col leading-tight">
                  <span className="truncate font-mono font-medium text-fg">{row.licensePlate ?? "—"}</span>
                  {row.fleetCode ? <span className="truncate text-caption text-fg-muted">Frota {row.fleetCode}</span> : null}
                </span>
              </TableCell>
              <TableCell>
                <span className="flex min-w-0 flex-col leading-tight" title={row.employeeName ?? undefined}>
                  <span className="truncate text-fg">{row.employeeName ?? "Não identificado"}</span>
                  {row.employeeCode ? <span className="truncate text-caption text-fg-muted">Mat. {row.employeeCode}</span> : null}
                </span>
              </TableCell>
              <TableCell truncate title={row.operationName ?? undefined} className="text-fg-secondary">
                {row.operationName ?? "—"}
              </TableCell>
              <TableCell truncate title={row.brCode ?? undefined} className="text-fg-secondary">
                {row.brCode ?? "—"}
              </TableCell>
              <TableCell numeric>
                <Counter value={row.nonConforming} extra={row.critical > 0 ? `${formatInt(row.critical)} crít.` : null} tone="danger" />
              </TableCell>
              <TableCell numeric>
                <Counter value={row.items} extra={row.itemsOpen > 0 ? `${formatInt(row.itemsOpen)} abertos` : null} tone="warning" />
              </TableCell>
              <TableCell numeric className="text-fg-secondary">
                {row.damage == null ? "—" : formatInt(row.damage)}
              </TableCell>
              <TableCell>
                <Ingestion status={row.ingestionStatus} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  );
}

function HistoryCards({ rows, openTrace }: { rows: HistoryRow[]; openTrace: (id: string) => void }) {
  return (
    <ul className="flex flex-col gap-2 lg:hidden" aria-label="Checklists com inconformidade">
      {rows.map((row) => (
        <li key={row.id}>
          <button
            type="button"
            data-testid="action-plans-history-card"
            onClick={() => openTrace(row.id)}
            aria-label={rowLabel(row)}
            className="flex w-full min-w-0 flex-col gap-2 rounded-md border border-border bg-surface p-3 text-left hfm-transition hover:border-border-strong hfm-focus-ring"
          >
            <span className="flex w-full items-start justify-between gap-2">
              <span className="min-w-0">
                <span className="block text-body-sm font-semibold text-fg tabular-nums">
                  {formatDate(row.operationalDate)}
                  {row.checklistType ? (
                    <span className="font-normal text-fg-secondary"> · {CHECKLIST_TYPE_LABEL[row.checklistType] ?? row.checklistType}</span>
                  ) : null}
                </span>
                <span className="block truncate text-caption text-fg-secondary">{vehicleText(row)}</span>
              </span>
              <Ingestion status={row.ingestionStatus} />
            </span>
            <span className="block truncate text-caption text-fg-muted">
              {[row.employeeName, row.employeeCode ? `Mat. ${row.employeeCode}` : null, row.operationName, row.brCode]
                .filter(Boolean)
                .join(" · ") || "—"}
            </span>
            <span className="grid w-full grid-cols-3 gap-2 text-caption">
              <span className="flex min-w-0 flex-col">
                <span className="text-fg-muted">Inconformidades</span>
                <span className="text-fg tabular-nums">
                  {formatInt(row.nonConforming)}
                  {row.critical > 0 ? <span className="text-danger"> · {formatInt(row.critical)} crít.</span> : null}
                </span>
              </span>
              <span className="flex min-w-0 flex-col">
                <span className="text-fg-muted">Apontamentos</span>
                <span className="text-fg tabular-nums">
                  {formatInt(row.items)}
                  {row.itemsOpen > 0 ? <span className="text-warning-soft-fg"> · {formatInt(row.itemsOpen)} abertos</span> : null}
                </span>
              </span>
              <span className="flex min-w-0 flex-col">
                <span className="text-fg-muted">Avarias</span>
                <span className="text-fg tabular-nums">{row.damage == null ? "—" : formatInt(row.damage)}</span>
              </span>
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}
