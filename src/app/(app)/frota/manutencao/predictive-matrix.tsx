"use client";

import * as React from "react";
import { AlertTriangle, Clock, Eye, Wrench, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableContainer, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState } from "@/components/feedback/empty-state";
import { PredictiveStatusBadge } from "@/components/maintenance/badges";
import {
  CONFORMITY_LABEL,
  EXECUTION_LABEL,
  formatDate,
  formatInt,
  formatKm,
  PREDICTIVE_STATUS_LABEL,
  PREDICTIVE_STATUS_TONE,
  REFERENCE_TYPE_LABEL,
  vehicleLabel,
  type PredictiveCell,
  type PredictiveOverview,
  type PredictiveStatus,
} from "@/lib/maintenance/types";
import { TONE_BORDER } from "./preventive-panel";
import { ServerPagination } from "./predictive-shared";
import type { PanelActions } from "./shared";

/**
 * Matriz frota × cluster: uma linha por veículo (página do servidor), uma
 * coluna por item do plano, agrupadas pelo cluster. A célula mostra a situação
 * técnica, o próximo marco e os sinais que mudam a leitura: monitoramento,
 * execução em andamento, não conformidade e KM desatualizado. Cabeçalho e
 * coluna da placa fixos; selecionar uma célula abre a gaveta do ciclo.
 */
const TECH_ORDER: PredictiveStatus[] = ["critical", "due", "to_schedule", "upcoming", "ok", "initial_inspection", "no_km"];

export interface PredictiveMatrixProps {
  overview: PredictiveOverview;
  page: number;
  pageSize: number;
  anyFilter: boolean;
  pending: boolean;
  actions: PanelActions;
  onOpen: (cycleId: string) => void;
  onClear: () => void;
}

export function PredictiveMatrix({ overview, page, pageSize, anyFilter, pending, actions, onOpen, onClear }: PredictiveMatrixProps) {
  const columns = overview.columns;
  // Cabeçalho agrupado: o servidor já ordena por cluster e item.
  const groups = React.useMemo(() => {
    const out: { clusterId: string; cluster: string; span: number; first: string }[] = [];
    for (const c of columns) {
      const last = out[out.length - 1];
      if (last && last.clusterId === c.clusterId) last.span += 1;
      else out.push({ clusterId: c.clusterId, cluster: c.cluster, span: 1, first: c.itemId });
    }
    return out;
  }, [columns]);
  const groupStarts = React.useMemo(() => new Set(groups.map((g) => g.first)), [groups]);

  if (overview.rows.length === 0 || columns.length === 0) {
    return (
      <EmptyState
        variant="panel"
        size="sm"
        title="Nenhum veículo com plano técnico no recorte"
        description={
          anyFilter
            ? "Nenhum ciclo preditivo corresponde aos filtros. Ajuste ou limpe os filtros."
            : "Não há ciclos preditivos ativos. Aprove um plano técnico para o tipo/modelo e recalcule os ciclos."
        }
        action={
          anyFilter ? (
            <Button variant="secondary" size="sm" leadingIcon={<X />} onClick={onClear}>
              Limpar filtros
            </Button>
          ) : undefined
        }
      />
    );
  }

  return (
    <>
      <ul className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-caption text-fg-muted" aria-label="Legenda da matriz">
        {TECH_ORDER.map((code) => (
          <li key={code}>
            <PredictiveStatusBadge status={code} size="sm" />
          </li>
        ))}
        <li className="inline-flex items-center gap-1">
          <Eye className="size-3.5" aria-hidden /> em monitoramento
        </li>
        <li className="inline-flex items-center gap-1">
          <Wrench className="size-3.5" aria-hidden /> execução (manutenção do item)
        </li>
        <li className="inline-flex items-center gap-1">
          <AlertTriangle className="size-3.5" aria-hidden /> não conforme
        </li>
        <li className="inline-flex items-center gap-1">
          <Clock className="size-3.5" aria-hidden /> KM desatualizado
        </li>
      </ul>
      <TableContainer tabIndex={0} stickyHeader maxHeight="72vh" data-testid="maintenance-predictive-matrix">
        <Table layout="fixed" style={{ minWidth: `${14 + columns.length * 9.5}rem` }}>
          <colgroup>
            <col className="w-[10.5rem] sm:w-[14rem]" />
            {columns.map((c) => (
              <col key={c.itemId} className="w-[9.5rem]" />
            ))}
          </colgroup>
          <TableHeader>
            <TableRow>
              <TableHead rowSpan={2} className="left-0 z-20! border-r border-border align-bottom">
                Veículo
              </TableHead>
              {groups.map((g) => (
                <TableHead key={g.clusterId} colSpan={g.span} scope="colgroup" className="border-l border-border text-center" title={g.cluster}>
                  <span className="block truncate">{g.cluster}</span>
                </TableHead>
              ))}
            </TableRow>
            <TableRow>
              {columns.map((c) => (
                <TableHead
                  key={c.itemId}
                  className={cn("top-(--table-header-height)! font-medium", groupStarts.has(c.itemId) && "border-l border-border")}
                  title={`${c.cluster} · ${c.item}`}
                >
                  <span className="block truncate">{c.item}</span>
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {overview.rows.map((row) => {
              const vehicle = vehicleLabel(row.licensePlate, row.fleetCode);
              return (
                <TableRow key={row.vehicleId} className="align-top" data-testid="maintenance-predictive-matrix-row">
                  <TableCell className="sticky left-0 z-[1] border-r border-border bg-surface py-2 align-top">
                    <p className="truncate text-label font-semibold text-fg" title={vehicle}>
                      {row.fleetCode ?? "—"} <span className="font-normal text-fg-muted">{row.licensePlate ?? ""}</span>
                    </p>
                    <p className="truncate text-caption text-fg-muted" title={[row.typeName, row.modelName].filter(Boolean).join(" · ")}>
                      {[row.typeName, row.modelName].filter(Boolean).join(" · ") || "—"}
                    </p>
                    <p className="flex items-center gap-1 truncate text-caption text-fg-muted" title={row.planName ?? undefined}>
                      {row.kmStale ? <Clock className="size-3 shrink-0 text-warning" aria-label="KM desatualizado" /> : null}
                      <span className="truncate">
                        {formatKm(row.currentKm)}
                        {row.operationName ? ` · ${row.operationName}` : ""}
                      </span>
                    </p>
                    {row.leaderName || row.brCode ? (
                      <p className="truncate text-caption text-fg-muted">{[row.brCode ? `BR ${row.brCode}` : null, row.leaderName].filter(Boolean).join(" · ")}</p>
                    ) : null}
                  </TableCell>
                  {columns.map((c) => {
                    const cell = row.cells[c.itemId];
                    return (
                      <TableCell key={c.itemId} className={cn("px-1 py-1 align-top", groupStarts.has(c.itemId) && "border-l border-border-subtle")}>
                        {cell ? (
                          <MatrixCell cell={cell} item={c.item} vehicle={vehicle} onOpen={onOpen} />
                        ) : (
                          <span className="flex min-h-[4.25rem] items-center justify-center text-fg-muted">
                            <span aria-hidden>—</span>
                            <span className="sr-only">{c.item} não se aplica a {vehicle}</span>
                          </span>
                        )}
                      </TableCell>
                    );
                  })}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </TableContainer>
      <p className="text-caption text-fg-muted">
        {formatInt(overview.rowsTotal)} veículo(s) com plano no recorte · {formatInt(columns.length)} item(ns) em {formatInt(groups.length)} cluster(s).
      </p>
      <ServerPagination page={page} pageSize={pageSize} total={overview.rowsTotal} pending={pending} actions={actions} label="Páginas da matriz preditiva" />
    </>
  );
}

function MatrixCell({ cell, item, vehicle, onOpen }: { cell: PredictiveCell; item: string; vehicle: string; onOpen: (cycleId: string) => void }) {
  const tone = PREDICTIVE_STATUS_TONE[cell.status] ?? "neutral";
  const executing = cell.execution !== "not_programmed";
  const nonConforming = cell.conformity === "non_conforming";
  const label = [
    `${item} em ${vehicle}`,
    `situação técnica: ${PREDICTIVE_STATUS_LABEL[cell.status] ?? cell.status}`,
    `execução: ${EXECUTION_LABEL[cell.execution] ?? cell.execution}`,
    `conformidade: ${CONFORMITY_LABEL[cell.conformity] ?? cell.conformity}`,
    cell.nextKm != null ? `próximo marco ${formatKm(cell.nextKm)}` : null,
    cell.nextDate ? `até ${formatDate(cell.nextDate)}` : null,
    `referência: ${REFERENCE_TYPE_LABEL[cell.referenceType] ?? cell.referenceType}`,
    cell.monitoring ? "em monitoramento" : null,
    cell.kmStale ? "KM desatualizado" : null,
    cell.openMaintenanceCode ? `manutenção ${cell.openMaintenanceCode}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <button
      type="button"
      onClick={() => onOpen(cell.cycleId)}
      aria-label={`${label}. Abrir histórico.`}
      title={label}
      data-status={cell.status}
      data-conformity={cell.conformity}
      className={cn(
        "flex min-h-[4.25rem] w-full flex-col items-start gap-0.5 rounded-sm border border-border-subtle border-l-2 bg-surface px-1.5 py-1 text-left text-caption",
        "hfm-transition hfm-focus-ring hover:bg-hover-overlay",
        TONE_BORDER[tone],
      )}
    >
      <PredictiveStatusBadge status={cell.status} size="sm" />
      <span className="tabular-nums text-fg-secondary">{cell.nextKm != null ? formatKm(cell.nextKm) : "—"}</span>
      {cell.nextDate ? <span className="tabular-nums text-fg-muted">{formatDate(cell.nextDate)}</span> : null}
      {cell.monitoring || executing || nonConforming || cell.kmStale ? (
        <span className="flex max-w-full items-center gap-1 text-fg-muted">
          {nonConforming ? <AlertTriangle className="size-3 shrink-0 text-danger" aria-hidden /> : null}
          {cell.monitoring ? <Eye className="size-3 shrink-0" aria-hidden /> : null}
          {cell.kmStale ? <Clock className="size-3 shrink-0 text-warning" aria-hidden /> : null}
          {executing ? (
            <>
              <Wrench className="size-3 shrink-0" aria-hidden />
              <span className="truncate">{EXECUTION_LABEL[cell.execution]}</span>
            </>
          ) : null}
        </span>
      ) : null}
    </button>
  );
}
