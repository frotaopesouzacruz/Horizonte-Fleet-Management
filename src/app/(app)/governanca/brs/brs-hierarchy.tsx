"use client";

import * as React from "react";
import {
  ArrowDown, ArrowLeftRight, ArrowUp, ArrowUpDown, ChevronRight, ChevronsDownUp, ChevronsUpDown, Eye, History,
  MapPin, Network, Pencil, Power, Truck,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { Button, IconButton } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/status-badge";
import { NativeSelect } from "@/components/governance/selects";
import type { TableSortDirection } from "@/components/ui/table";
import type { BrDirectoryRow, BrSort } from "@/lib/governance/brs";
import { LEADER_SCOPE_LABEL, formatDate, formatDateTime, number } from "./br-labels";

/** O que cada linha pode fazer. `onEdit` e `onToggleStatus` só chegam com `fidelization.manage_brs`. */
export interface BrRowHandlers {
  onDetail: (row: BrDirectoryRow) => void;
  onHistory: (row: BrDirectoryRow) => void;
  onEdit?: (row: BrDirectoryRow) => void;
  onToggleStatus?: (row: BrDirectoryRow) => void;
  /** Uma ação de escrita em curso — desabilita a que pode ser repetida. */
  pending?: boolean;
}

export interface BrsHierarchyProps extends BrRowHandlers {
  rows: BrDirectoryRow[];
  sort: BrSort;
  dir: TableSortDirection;
  onSort: (sort: BrSort, dir: TableSortDirection) => void;
}

/* ------------------------------------------------------------------ colunas */

/**
 * Operação e Estado/Cidade viraram os níveis da hierarquia; as colunas são o
 * que a BR tem de seu. A ordem escolhida vale dentro de cada local — os níveis
 * acima seguem em ordem alfabética, para a mesma operação nunca aparecer duas
 * vezes na página.
 */
const COLUMNS: { key: string; label: string; sort?: BrSort }[] = [
  { key: "code", label: "Código", sort: "code" },
  { key: "status", label: "Situação", sort: "status" },
  { key: "leader", label: "Liderança vigente", sort: "leader" },
  { key: "vehicle", label: "Veículo atual", sort: "vehicle" },
  { key: "driver", label: "Motorista atual", sort: "driver" },
  { key: "movement", label: "Última movimentação", sort: "last_movement" },
  { key: "actions", label: "Ações" },
];

const SORTABLE = COLUMNS.filter((c): c is { key: string; label: string; sort: BrSort } => Boolean(c.sort));

/** Mesma grade no cabeçalho e nas linhas; abaixo de `xl` a linha vira cartão. */
const ROW_GRID =
  "xl:grid xl:grid-cols-[minmax(0,0.95fr)_5.5rem_minmax(0,1.25fr)_minmax(0,1.1fr)_minmax(0,1.05fr)_10.5rem_8.5rem] xl:items-center xl:gap-3";

/** Operação e local ordenam por nome — a ordem do servidor vale dentro do local. */
const OPERATION_OR_CITY: BrSort[] = ["operation", "city"];

/* --------------------------------------------------------------- agrupamento */

interface CityGroup {
  key: string;
  cityName: string;
  rows: BrDirectoryRow[];
  withoutVehicle: number;
}

interface StateGroup {
  uf: string;
  cities: CityGroup[];
}

interface OperationGroup {
  id: string;
  name: string;
  states: StateGroup[];
  cities: number;
  brs: number;
  withVehicle: number;
  withoutVehicle: number;
  inactive: number;
}

const collator = new Intl.Collator("pt-BR", { sensitivity: "base" });

const hasVehicle = (row: BrDirectoryRow) => Boolean(row.licensePlate || row.fleetCode);

function groupRows(rows: BrDirectoryRow[]): OperationGroup[] {
  const operations = new Map<string, { name: string; cities: Map<string, CityGroup & { uf: string }> }>();
  for (const row of rows) {
    const operation = operations.get(row.operationId) ?? { name: row.operationName, cities: new Map() };
    operations.set(row.operationId, operation);
    const cityKey = `${row.operationId}:${row.cityId}`;
    const city =
      operation.cities.get(cityKey) ??
      { key: cityKey, uf: row.stateUf, cityName: row.cityName, rows: [], withoutVehicle: 0 };
    operation.cities.set(cityKey, city);
    city.rows.push(row);
    if (!hasVehicle(row)) city.withoutVehicle += 1;
  }

  return [...operations.entries()]
    .map(([id, { name, cities }]) => {
      const byState = new Map<string, CityGroup[]>();
      for (const city of cities.values()) {
        const list = byState.get(city.uf) ?? [];
        list.push(city);
        byState.set(city.uf, list);
      }
      const states = [...byState.entries()]
        .sort(([a], [b]) => collator.compare(a, b))
        .map(([uf, list]) => ({ uf, cities: list.sort((a, b) => collator.compare(a.cityName, b.cityName)) }));
      const all = [...cities.values()].flatMap((c) => c.rows);
      return {
        id,
        name,
        states,
        cities: cities.size,
        brs: all.length,
        withVehicle: all.filter(hasVehicle).length,
        withoutVehicle: all.filter((r) => !hasVehicle(r)).length,
        inactive: all.filter((r) => r.status === "inactive").length,
      };
    })
    .sort((a, b) => collator.compare(a.name, b.name));
}

const plural = (value: number, one: string, many: string) =>
  `${number.format(value)} ${value === 1 ? one : many}`;

/* -------------------------------------------------------------------- células */

/** Rótulo da célula: visível no cartão (abaixo de `xl`), lido pelo leitor de tela na grade. */
function CellLabel({ children }: { children: React.ReactNode }) {
  return <span className="text-caption text-fg-muted xl:sr-only">{children}</span>;
}

function Cell({ label, className, children }: { label: string; className?: string; children: React.ReactNode }) {
  return (
    <div className={cn("grid min-w-0 grid-cols-[8.5rem_minmax(0,1fr)] items-baseline gap-2 xl:block", className)}>
      <CellLabel>{label}</CellLabel>
      <div className="min-w-0">{children}</div>
    </div>
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
  if (!row.leaderName) return <span className="text-body-sm text-fg-muted">Sem liderança definida</span>;
  return (
    <span className="block min-w-0">
      <span className="block truncate text-body-sm text-fg" title={row.leaderName}>
        {row.leaderName}
      </span>
      {row.leaderScope ? (
        <span className="block text-caption text-fg-muted">por {LEADER_SCOPE_LABEL[row.leaderScope]}</span>
      ) : null}
    </span>
  );
}

/**
 * Placa e frota na primeira linha, como no Planner de Motoristas; o início do
 * vínculo que pôs o veículo ali na segunda — o que era a coluna "Início da
 * alocação".
 */
function VehicleCell({ row }: { row: BrDirectoryRow }) {
  if (!hasVehicle(row)) {
    return (
      <Badge variant="warning" appearance="soft" size="sm">
        Sem veículo
      </Badge>
    );
  }
  const fleet = row.fleetCode && row.fleetCode !== row.licensePlate ? row.fleetCode : null;
  return (
    <span className="flex min-w-0 items-start gap-1.5">
      <Truck aria-hidden className="mt-0.5 size-3.5 shrink-0 text-fg-muted" />
      <span className="min-w-0">
        <span className="block truncate text-body-sm">
          <span className="font-medium text-fg">{row.licensePlate ?? row.fleetCode}</span>
          {fleet ? (
            <span className="text-caption text-fg-muted" title={`Frota ${fleet}`}>
              {" · "}
              <span className="sr-only">frota </span>
              {fleet}
            </span>
          ) : null}
        </span>
        {row.assignmentStart ? (
          <span className="block truncate text-caption text-fg-muted" title="Início da alocação">
            <span className="sr-only">Início da alocação: </span>
            <span aria-hidden>desde </span>
            {formatDate(row.assignmentStart)}
          </span>
        ) : null}
      </span>
    </span>
  );
}

function DriverCell({ row }: { row: BrDirectoryRow }) {
  if (!row.driverName) return <span className="text-body-sm text-fg-muted">Sem motorista</span>;
  return (
    <span className="block truncate text-body-sm text-fg" title={row.driverName}>
      {row.driverName}
    </span>
  );
}

/** Última criação ou alteração de vínculo; a substituição iniciada no mês ganha um selo (§22). */
function MovementCell({ row }: { row: BrDirectoryRow }) {
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      <span className="text-body-sm tabular-nums text-fg-secondary">{formatDateTime(row.lastMovementAt)}</span>
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

/* ----------------------------------------------------------------- ordenação */

function SortHeader({
  label, sortKey, sort, dir, onSort,
}: {
  label: string;
  sortKey: BrSort;
  sort: BrSort;
  dir: TableSortDirection;
  onSort: (sort: BrSort, dir: TableSortDirection) => void;
}) {
  const active = sort === sortKey || (sortKey === "code" && OPERATION_OR_CITY.includes(sort));
  const Icon = !active ? ArrowUpDown : dir === "asc" ? ArrowUp : ArrowDown;
  return (
    <button
      type="button"
      onClick={() => onSort(sortKey, active && dir === "asc" ? "desc" : "asc")}
      aria-label={`Ordenar por ${label}`}
      aria-pressed={active}
      className={cn(
        "-mx-1 inline-flex min-w-0 items-center gap-1 rounded-sm px-1 py-0.5 text-left hfm-transition hfm-focus-ring hover:text-fg",
        active ? "text-fg" : "text-fg-secondary",
      )}
    >
      <span className="truncate">{label}</span>
      <Icon aria-hidden className={cn("size-3.5 shrink-0", active ? "text-primary" : "text-fg-muted")} />
    </button>
  );
}

/* --------------------------------------------------------------------- lista */

/**
 * A listagem do módulo (§24) no desenho da Hierarquia Operacional da Central
 * de Fidelização: Operação → Estado → Cidade → BR, com contadores reais em
 * cada nível e todas as informações que a tabela tinha em cada linha. A
 * ordenação continua na URL e no servidor — clicar num cabeçalho navega, e a
 * página volta já ordenada; não há uma segunda ordenação no cliente para
 * discordar da primeira. Abaixo de `xl` a linha da BR vira cartão.
 */
export function BrsHierarchy({ rows, sort, dir, onSort, ...handlers }: BrsHierarchyProps) {
  const operations = React.useMemo(() => groupRows(rows), [rows]);
  const [operationOpen, setOperationOpen] = React.useState<Record<string, boolean>>({});
  const [cityOpen, setCityOpen] = React.useState<Record<string, boolean>>({});

  const isOperationOpen = (id: string) => operationOpen[id] ?? true;
  const isCityOpen = (key: string) => cityOpen[key] ?? true;
  const cityKeys = operations.flatMap((o) => o.states.flatMap((s) => s.cities.map((c) => c.key)));
  const allOpen =
    operations.every((o) => isOperationOpen(o.id)) && cityKeys.every((key) => isCityOpen(key));
  const setAll = (value: boolean) => {
    setOperationOpen(Object.fromEntries(operations.map((o) => [o.id, value])));
    setCityOpen(Object.fromEntries(cityKeys.map((key) => [key, value])));
  };

  const selectedSort = OPERATION_OR_CITY.includes(sort) ? "code" : sort;

  if (rows.length === 0) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-2 py-10 text-center">
          <MapPin aria-hidden className="size-5 text-fg-muted" />
          <p className="text-body-sm text-fg-muted">Nenhuma posição operacional encontrada com os filtros aplicados.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <section aria-label="Posições operacionais" className="flex min-w-0 flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        {/* Abaixo de xl não há cabeçalho de colunas: a ordem se escolhe aqui. */}
        <label className="flex items-center gap-2 xl:hidden">
          <span className="text-caption text-fg-muted">Ordenar BRs por</span>
          <NativeSelect
            fieldSize="sm"
            value={selectedSort}
            onChange={(e) => onSort(e.target.value as BrSort, dir)}
          >
            {SORTABLE.map((c) => (
              <option key={c.key} value={c.sort}>{c.label}</option>
            ))}
          </NativeSelect>
        </label>
        <Button
          variant="ghost"
          size="sm"
          className="xl:hidden"
          leadingIcon={dir === "asc" ? <ArrowUp /> : <ArrowDown />}
          onClick={() => onSort(selectedSort, dir === "asc" ? "desc" : "asc")}
        >
          {dir === "asc" ? "Crescente" : "Decrescente"}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="ml-auto"
          leadingIcon={allOpen ? <ChevronsDownUp /> : <ChevronsUpDown />}
          onClick={() => setAll(!allOpen)}
        >
          {allOpen ? "Recolher tudo" : "Expandir tudo"}
        </Button>
      </div>

      {operations.map((operation) => {
        const opOpen = isOperationOpen(operation.id);
        const panelId = `brs-op-${operation.id}`;
        return (
          <Card key={operation.id} className="overflow-hidden">
            <button
              type="button"
              onClick={() => setOperationOpen((o) => ({ ...o, [operation.id]: !isOperationOpen(operation.id) }))}
              aria-expanded={opOpen}
              aria-controls={panelId}
              className="flex w-full flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3 text-left hfm-transition hfm-focus-ring hover:bg-hover-overlay"
            >
              <span className="flex min-w-0 flex-1 items-center gap-2">
                <ChevronRight
                  aria-hidden
                  className={cn("size-4 shrink-0 text-fg-muted transition-transform", opOpen && "rotate-90")}
                />
                <Network aria-hidden className="size-4 shrink-0 text-fg-muted" />
                <span className="min-w-0">
                  <span className="block truncate text-body font-semibold text-fg">{operation.name}</span>
                  <span className="block text-caption text-fg-muted">Operação</span>
                </span>
              </span>
              <span className="flex flex-wrap items-center gap-1.5 pl-6 sm:pl-0">
                <Badge variant="neutral" appearance="soft" size="sm">
                  {plural(operation.cities, "local", "locais")}
                </Badge>
                <Badge variant="neutral" appearance="soft" size="sm">
                  {plural(operation.brs, "BR", "BRs")}
                </Badge>
                {operation.withVehicle > 0 ? (
                  <Badge variant="neutral" appearance="soft" size="sm">
                    {number.format(operation.withVehicle)} com veículo
                  </Badge>
                ) : null}
                {operation.withoutVehicle > 0 ? (
                  <Badge variant="warning" appearance="soft" size="sm">
                    {number.format(operation.withoutVehicle)} sem veículo
                  </Badge>
                ) : null}
                {operation.inactive > 0 ? (
                  <Badge variant="neutral" appearance="outline" size="sm">
                    {plural(operation.inactive, "inativa", "inativas")}
                  </Badge>
                ) : null}
              </span>
            </button>

            {opOpen ? (
              <div id={panelId} className="border-t border-border">
                {/* Cabeçalho de colunas, uma vez por operação, só na grade larga. */}
                <div
                  className={cn(
                    "hidden border-b border-border bg-surface-secondary py-2 pr-4 pl-10 text-caption font-semibold",
                    ROW_GRID,
                  )}
                >
                  {COLUMNS.map((column) =>
                    column.sort ? (
                      <SortHeader
                        key={column.key}
                        label={column.label}
                        sortKey={column.sort}
                        sort={sort}
                        dir={dir}
                        onSort={onSort}
                      />
                    ) : (
                      <span key={column.key} className="text-right text-fg-secondary">
                        {column.label}
                      </span>
                    ),
                  )}
                </div>

                {operation.states.map((state) => (
                  <div key={state.uf} className="border-b border-border last:border-b-0">
                    <p className="bg-surface-secondary px-4 py-1.5 text-caption font-medium tracking-wide text-fg-secondary uppercase">
                      {state.uf}
                    </p>
                    {state.cities.map((city) => {
                      const open = isCityOpen(city.key);
                      const cityPanel = `brs-city-${city.key.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
                      return (
                        <div key={city.key} className="border-t border-border-subtle first:border-t-0">
                          <button
                            type="button"
                            onClick={() => setCityOpen((c) => ({ ...c, [city.key]: !isCityOpen(city.key) }))}
                            aria-expanded={open}
                            aria-controls={cityPanel}
                            className="flex w-full items-center gap-2 py-2 pr-4 pl-8 text-left hfm-transition hfm-focus-ring hover:bg-hover-overlay"
                          >
                            <ChevronRight
                              aria-hidden
                              className={cn("size-3.5 shrink-0 text-fg-muted transition-transform", open && "rotate-90")}
                            />
                            <MapPin aria-hidden className="size-3.5 shrink-0 text-fg-muted" />
                            <span className="min-w-0 flex-1 truncate text-body-sm font-medium text-fg">
                              {city.cityName}
                            </span>
                            <span className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
                              <Badge variant="neutral" appearance="soft" size="sm">
                                {plural(city.rows.length, "BR", "BRs")}
                              </Badge>
                              {city.withoutVehicle > 0 ? (
                                <Badge variant="warning" appearance="soft" size="sm">
                                  {number.format(city.withoutVehicle)} sem veículo
                                </Badge>
                              ) : null}
                            </span>
                          </button>

                          {open ? (
                            <ul id={cityPanel} aria-label={`BRs de ${city.cityName}/${state.uf}`}>
                              {city.rows.map((row) => (
                                <BrRow key={row.id} row={row} handlers={handlers} />
                              ))}
                            </ul>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
            ) : null}
          </Card>
        );
      })}
    </section>
  );
}

function BrRow({ row, handlers }: { row: BrDirectoryRow; handlers: BrRowHandlers }) {
  return (
    <li
      aria-label={`BR ${row.code}`}
      className={cn(
        "flex flex-col gap-2 border-t border-border-subtle py-3 pr-4 pl-8 sm:pl-10 xl:py-2",
        ROW_GRID,
        row.status === "inactive" && "bg-surface-secondary/40",
      )}
    >
      <div className="flex min-w-0 items-start justify-between gap-2 xl:block">
        <div className="min-w-0">
          <span className="sr-only">Código </span>
          <span className="block truncate text-body-sm font-semibold text-fg" title={row.code}>
            {row.code}
          </span>
          {row.description ? (
            <span className="block truncate text-caption text-fg-muted" title={row.description}>
              {row.description}
            </span>
          ) : null}
        </div>
        {/* No cartão a situação fica ao lado do código; na grade, na coluna dela. */}
        <span className="shrink-0 xl:hidden">
          <StatusCell row={row} />
        </span>
      </div>
      <div className="hidden xl:block">
        <span className="sr-only">Situação </span>
        <StatusCell row={row} />
      </div>
      <Cell label="Liderança vigente"><LeaderCell row={row} /></Cell>
      <Cell label="Veículo atual"><VehicleCell row={row} /></Cell>
      <Cell label="Motorista atual"><DriverCell row={row} /></Cell>
      <Cell label="Última movimentação"><MovementCell row={row} /></Cell>
      <div className="border-t border-border-subtle pt-2 xl:border-0 xl:pt-0">
        <BrRowActions row={row} {...handlers} />
      </div>
    </li>
  );
}
