"use client";

import * as React from "react";
import { ArrowLeftRight, Eye, History, MapPin, Pencil, Power } from "lucide-react";
import { IconButton } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  Table, TableBody, TableCell, TableContainer, TableEmpty, TableHead, TableHeader, TableRow,
  type TableSortDirection,
} from "@/components/ui/table";
import type { BrDirectoryRow, BrSort } from "@/lib/governance/brs";
import { LEADER_SCOPE_LABEL, formatDate, formatDateTime } from "./br-labels";

/** O que cada linha pode fazer. `onEdit` e `onToggleStatus` só chegam com `fidelization.manage_brs`. */
export interface BrRowHandlers {
  onDetail: (row: BrDirectoryRow) => void;
  onHistory: (row: BrDirectoryRow) => void;
  onEdit?: (row: BrDirectoryRow) => void;
  onToggleStatus?: (row: BrDirectoryRow) => void;
  /** Uma ação de escrita em curso — desabilita a que pode ser repetida. */
  pending?: boolean;
}

export interface BrsTableProps extends BrRowHandlers {
  rows: BrDirectoryRow[];
  sort: BrSort;
  dir: TableSortDirection;
  onSort: (sort: BrSort, dir: TableSortDirection) => void;
}

interface Column {
  key: string;
  label: string;
  width: number;
  sort?: BrSort;
}

/**
 * Largura mínima de cada coluna, escolhida para o cabeçalho ler inteiro. Quando
 * a soma passa da janela o contêiner rola, em vez de o texto sumir em "Lider…".
 */
const COLUMNS: Column[] = [
  { key: "code", label: "Código", width: 190, sort: "code" },
  { key: "operation", label: "Operação", width: 170, sort: "operation" },
  { key: "city", label: "Estado/Cidade", width: 160, sort: "city" },
  { key: "status", label: "Situação", width: 100, sort: "status" },
  { key: "leader", label: "Liderança vigente", width: 190, sort: "leader" },
  { key: "vehicle", label: "Veículo atual", width: 150, sort: "vehicle" },
  { key: "driver", label: "Motorista atual", width: 170, sort: "driver" },
  { key: "assignment", label: "Início da alocação", width: 130 },
  { key: "movement", label: "Última movimentação", width: 190, sort: "last_movement" },
];

const ACTIONS_WIDTH = 168;
const TABLE_MIN_WIDTH = COLUMNS.reduce((sum, c) => sum + c.width, ACTIONS_WIDTH);

/* -------------------------------------------------------------------- células */

function CodeCell({ row }: { row: BrDirectoryRow }) {
  return (
    <>
      <span className="block truncate font-medium text-fg" title={row.code}>{row.code}</span>
      {row.description ? (
        <span className="block truncate text-caption text-fg-muted" title={row.description}>
          {row.description}
        </span>
      ) : null}
    </>
  );
}

function StatusCell({ row }: { row: BrDirectoryRow }) {
  return (
    <StatusBadge status={row.status === "active" ? "success" : "neutral"}>
      {row.status === "active" ? "Ativa" : "Inativa"}
    </StatusBadge>
  );
}

/** §43: o nível que respondeu fica dito, não só o nome. A ausência também fica dita. */
function LeaderCell({ row }: { row: BrDirectoryRow }) {
  if (!row.leaderName) return <span className="text-fg-muted">Sem liderança definida</span>;
  return (
    <>
      <span className="block truncate text-fg" title={row.leaderName}>{row.leaderName}</span>
      {row.leaderScope ? (
        <span className="block text-caption text-fg-muted">por {LEADER_SCOPE_LABEL[row.leaderScope]}</span>
      ) : null}
    </>
  );
}

function VehicleCell({ row }: { row: BrDirectoryRow }) {
  if (!row.licensePlate && !row.fleetCode) return <span className="text-warning-fg">Sem veículo</span>;
  return (
    <>
      <span className="block truncate font-medium text-fg">{row.licensePlate ?? row.fleetCode}</span>
      {row.fleetCode && row.fleetCode !== row.licensePlate ? (
        <span className="block text-caption text-fg-muted">frota {row.fleetCode}</span>
      ) : null}
    </>
  );
}

function DriverCell({ row }: { row: BrDirectoryRow }) {
  if (!row.driverName) return <span className="text-fg-muted">Sem motorista</span>;
  return <span className="block truncate text-fg" title={row.driverName}>{row.driverName}</span>;
}

/** Última criação ou alteração de vínculo; a substituição iniciada no mês ganha um selo (§22). */
function MovementCell({ row }: { row: BrDirectoryRow }) {
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      <span className="tabular-nums">{formatDateTime(row.lastMovementAt)}</span>
      {row.swappedInPeriod ? (
        <Badge variant="info" appearance="soft" size="sm" icon={<ArrowLeftRight aria-hidden />}>
          substituição
        </Badge>
      ) : null}
    </span>
  );
}

/* --------------------------------------------------------------------- ações */

export function BrRowActions({
  row, onDetail, onHistory, onEdit, onToggleStatus, pending = false,
}: BrRowHandlers & { row: BrDirectoryRow }) {
  return (
    <div className="flex items-center justify-end gap-0.5">
      <IconButton label={`Detalhar a ${row.code}`} variant="ghost" size="sm" onClick={() => onDetail(row)}>
        <Eye aria-hidden />
      </IconButton>
      <IconButton
        label={`Histórico de veículos da ${row.code}`}
        variant="ghost"
        size="sm"
        onClick={() => onHistory(row)}
      >
        <History aria-hidden />
      </IconButton>
      {onEdit ? (
        <IconButton label={`Editar a ${row.code}`} variant="ghost" size="sm" onClick={() => onEdit(row)}>
          <Pencil aria-hidden />
        </IconButton>
      ) : null}
      {onToggleStatus ? (
        <IconButton
          label={row.status === "active" ? `Inativar a ${row.code}` : `Reativar a ${row.code}`}
          variant="ghost"
          size="sm"
          disabled={pending}
          onClick={() => onToggleStatus(row)}
        >
          <Power aria-hidden />
        </IconButton>
      ) : null}
    </div>
  );
}

/* -------------------------------------------------------------------- tabela */

/**
 * A listagem do módulo (§24), em duas formas para a mesma linha: tabela
 * ordenável acima de `lg`, cartões abaixo. A ordenação vive na URL — clicar
 * num cabeçalho navega, e o servidor devolve a página já ordenada; não há uma
 * segunda ordenação no cliente para discordar da primeira.
 */
export function BrsTable({ rows, sort, dir, onSort, ...handlers }: BrsTableProps) {
  const direction = (key: BrSort): TableSortDirection | null => (sort === key ? dir : null);

  return (
    <>
      <TableContainer className="hidden lg:block">
        <Table layout="fixed" style={{ minWidth: TABLE_MIN_WIDTH }}>
          <TableHeader>
            <TableRow>
              {COLUMNS.map((column) => (
                <TableHead
                  key={column.key}
                  style={{ width: column.width }}
                  sortable={Boolean(column.sort)}
                  sortDirection={column.sort ? direction(column.sort) : undefined}
                  onSort={column.sort ? (next) => onSort(column.sort as BrSort, next) : undefined}
                >
                  {column.label}
                </TableHead>
              ))}
              <TableHead style={{ width: ACTIONS_WIDTH }} align="right">
                Ações
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableEmpty
                colSpan={COLUMNS.length + 1}
                icon={<MapPin />}
                message="Nenhuma posição operacional encontrada com os filtros aplicados."
              />
            ) : (
              rows.map((row) => (
                <TableRow key={row.id} className={row.status === "inactive" ? "opacity-70" : undefined}>
                  <TableCell><CodeCell row={row} /></TableCell>
                  <TableCell>
                    <span className="block truncate" title={row.operationName}>{row.operationName}</span>
                  </TableCell>
                  <TableCell>
                    <span className="block truncate">
                      <span className="text-fg-muted">{row.stateUf}</span>
                      <span aria-hidden className="mx-1 text-fg-disabled">·</span>
                      {row.cityName}
                    </span>
                  </TableCell>
                  <TableCell><StatusCell row={row} /></TableCell>
                  <TableCell><LeaderCell row={row} /></TableCell>
                  <TableCell><VehicleCell row={row} /></TableCell>
                  <TableCell><DriverCell row={row} /></TableCell>
                  <TableCell className="tabular-nums">{formatDate(row.assignmentStart)}</TableCell>
                  <TableCell><MovementCell row={row} /></TableCell>
                  <TableCell>
                    <BrRowActions row={row} {...handlers} />
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </TableContainer>

      {/* Abaixo de lg as mesmas linhas viram cartões: código, local e recursos
          numa leitura vertical, nunca a tabela de dez colunas espremida. */}
      <ul className="flex flex-col gap-2 lg:hidden" aria-label="Posições operacionais">
        {rows.map((row) => (
          <li
            key={row.id}
            className="flex flex-col gap-2 rounded-md border border-border bg-surface p-3"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <span className="block truncate text-body-sm font-semibold text-fg">{row.code}</span>
                {row.description ? (
                  <span className="block truncate text-caption text-fg-muted">{row.description}</span>
                ) : null}
              </div>
              <StatusCell row={row} />
            </div>

            <div className="flex flex-wrap items-center gap-1.5 text-caption text-fg-secondary">
              <Badge variant="neutral">{row.operationName}</Badge>
              <Badge variant="neutral">{row.cityName}/{row.stateUf}</Badge>
              {row.swappedInPeriod ? (
                <Badge variant="info" icon={<ArrowLeftRight aria-hidden />}>substituição</Badge>
              ) : null}
            </div>

            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-body-sm">
              <dt className="text-fg-muted">Liderança</dt>
              <dd className="min-w-0"><LeaderCell row={row} /></dd>
              <dt className="text-fg-muted">Veículo</dt>
              <dd className="min-w-0"><VehicleCell row={row} /></dd>
              <dt className="text-fg-muted">Motorista</dt>
              <dd className="min-w-0"><DriverCell row={row} /></dd>
              <dt className="text-fg-muted">Movimentação</dt>
              <dd className="min-w-0 tabular-nums">{formatDateTime(row.lastMovementAt)}</dd>
            </dl>

            <div className="border-t border-border pt-2">
              <BrRowActions row={row} {...handlers} />
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}
