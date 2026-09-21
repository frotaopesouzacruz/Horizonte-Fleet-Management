"use client";

import * as React from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { Pencil, Plus, Power, Shapes, SlidersHorizontal } from "lucide-react";
import { cn } from "@/lib/cn";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { SearchField } from "@/components/ui/search-field";
import { FilterBar, FilterGroup, FilterChip, FilterBarClear } from "@/components/ui/filter-bar";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableEmpty,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { EmptyState } from "@/components/feedback/empty-state";
import { useToast } from "@/components/feedback/toast";
import type { EquipmentOptions, EquipmentTypeFilters, EquipmentTypeRow } from "@/lib/equipment/queries";
import { EquipmentTypeDrawer } from "./equipment-type-drawer";
import { DeactivateDialog } from "./deactivate-dialog";

const numberFormat = new Intl.NumberFormat("pt-BR");
const dateTimeFormat = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" });

const STATUS_LABELS: Record<string, string> = { active: "Ativo", inactive: "Inativo" };
const SCOPE_LABELS: Record<string, string> = { global: "Catálogo base", organization: "Da organização" };

function Cell({ value }: { value?: string | null }) {
  const text = value?.trim();
  if (!text) return <span className="text-fg-muted">—</span>;
  return (
    <span title={text} className="block truncate">
      {text}
    </span>
  );
}

interface Column {
  key: string;
  label: string;
  width: number;
  numeric?: boolean;
  render: (row: EquipmentTypeRow) => React.ReactNode;
}

export interface EquipmentTypesViewProps {
  rows: EquipmentTypeRow[];
  options: EquipmentOptions;
  filters: EquipmentTypeFilters;
  permissions: string[];
  isPlatformAdmin: boolean;
  overview: React.ReactNode;
}

export function EquipmentTypesView({
  rows,
  options,
  filters,
  permissions,
  isPlatformAdmin,
  overview,
}: EquipmentTypesViewProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { toast } = useToast();
  const [pending, startTransition] = React.useTransition();

  const can = React.useCallback(
    (permission: string) => isPlatformAdmin || permissions.includes(permission),
    [permissions, isPlatformAdmin],
  );

  const [search, setSearch] = React.useState(filters.q ?? "");
  const [formOpen, setFormOpen] = React.useState(false);
  const [editId, setEditId] = React.useState<string | null>(null);
  const [statusTarget, setStatusTarget] = React.useState<EquipmentTypeRow | null>(null);

  const [syncedQuery, setSyncedQuery] = React.useState(filters.q ?? "");
  if (syncedQuery !== (filters.q ?? "")) {
    setSyncedQuery(filters.q ?? "");
    setSearch(filters.q ?? "");
  }

  const apply = React.useCallback(
    (changes: Record<string, string | undefined>) => {
      const params = new URLSearchParams(searchParams.toString());
      for (const [key, value] of Object.entries(changes)) {
        if (value === undefined || value === "") params.delete(key);
        else params.set(key, value);
      }
      startTransition(() => router.push(`${pathname}?${params.toString()}`, { scroll: false }));
    },
    [pathname, router, searchParams],
  );

  React.useEffect(() => {
    if ((filters.q ?? "") === search) return;
    const timer = setTimeout(() => apply({ q: search || undefined }), 350);
    return () => clearTimeout(timer);
  }, [search, filters.q, apply]);

  const activeFilters = React.useMemo(() => {
    const chips: { key: string; label: string; value: string }[] = [];
    if (filters.status) chips.push({ key: "status", label: "Situação", value: STATUS_LABELS[filters.status] ?? filters.status });
    if (filters.scope) chips.push({ key: "scope", label: "Origem", value: SCOPE_LABELS[filters.scope] ?? filters.scope });
    if (filters.operation) {
      const operation = options.operations.find((item) => item.id === filters.operation);
      chips.push({ key: "operation", label: "Operação", value: operation?.label ?? filters.operation });
    }
    if (filters.app) {
      const app = options.apps.find((item) => item.id === filters.app);
      chips.push({ key: "app", label: "Aplicativo", value: app?.label ?? filters.app });
    }
    return chips;
  }, [filters, options]);

  const columns = React.useMemo<Column[]>(
    () => [
      {
        key: "code",
        label: "Código",
        width: 116,
        render: (row) => <span className="font-mono text-caption text-fg">{row.code}</span>,
      },
      {
        key: "name",
        label: "Tipo",
        width: 240,
        render: (row) => (
          <span className="flex min-w-0 items-center gap-2">
            <span className="min-w-0">
              <span className="block truncate font-medium text-fg" title={row.name}>
                {row.name}
              </span>
              {row.description ? (
                <span className="block truncate text-caption text-fg-muted" title={row.description}>
                  {row.description}
                </span>
              ) : null}
            </span>
            {/* Um tipo do catálogo base é compartilhado: a organização
                parametriza, mas não renomeia (§41). Dizer isso na lista evita
                a descoberta pelo erro. */}
            {row.scope === "global" ? (
              <Badge variant="neutral" size="sm" title="Mantido pela plataforma e compartilhado entre organizações">
                Base
              </Badge>
            ) : null}
          </span>
        ),
      },
      {
        key: "subcategories",
        label: "Subcategorias",
        width: 140,
        numeric: true,
        render: (row) => (
          <span className="tabular-nums">
            {row.subcategoryCount === 0 ? (
              <span className="text-fg-muted" title="Nenhuma subcategoria ativa — a subcategoria fica opcional no cadastro">
                —
              </span>
            ) : (
              numberFormat.format(row.subcategoryCount)
            )}
            {row.requiresSubcategory ? (
              <Badge variant="primary" size="sm" className="ml-2" title="O cadastro de frotas exige subcategoria para este tipo">
                exigida
              </Badge>
            ) : null}
          </span>
        ),
      },
      {
        key: "vehicles",
        label: "Veículos",
        width: 110,
        numeric: true,
        render: (row) => <span className="tabular-nums">{numberFormat.format(row.vehicleCount)}</span>,
      },
      {
        key: "operations",
        label: "Operações habilitadas",
        width: 190,
        render: (row) =>
          row.operationRestrictionEnabled ? (
            row.operationCount === 0 ? (
              // Restrição ligada e nenhuma operação: o tipo não pode ser alocado
              // em lugar nenhum. Dizer isso é melhor do que mostrar "0".
              <Badge variant="warning">Nenhuma habilitada</Badge>
            ) : (
              <span className="tabular-nums text-fg">
                {numberFormat.format(row.operationCount)} operação(ões)
              </span>
            )
          ) : (
            <span
              className="text-fg-secondary"
              title="Nenhuma restrição configurada: qualquer operação aceita este tipo"
            >
              Sem restrição
            </span>
          ),
      },
      {
        key: "apps",
        label: "Aplicativos",
        width: 120,
        numeric: true,
        render: (row) =>
          row.appCount === 0 ? <span className="text-fg-muted">—</span> : (
            <span className="tabular-nums">{numberFormat.format(row.appCount)}</span>
          ),
      },
      {
        key: "status",
        label: "Situação",
        width: 116,
        render: (row) => (
          <StatusBadge status={row.effectiveStatus === "active" ? "success" : "neutral"}>
            {STATUS_LABELS[row.effectiveStatus]}
          </StatusBadge>
        ),
      },
      {
        key: "updated_at",
        label: "Última atualização",
        width: 170,
        render: (row) => (
          <Cell value={row.updatedAt ? dateTimeFormat.format(new Date(row.updatedAt)) : null} />
        ),
      },
    ],
    [],
  );

  const tableMinWidth = columns.reduce((sum, column) => sum + column.width, 56);
  const isEmpty = rows.length === 0 && !activeFilters.length && !filters.q;

  function RowActions({ row }: { row: EquipmentTypeRow }) {
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" aria-label={`Ações para o tipo ${row.name}`}>
            <SlidersHorizontal aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-56">
          <DropdownMenuLabel>
            {row.code} · {row.name}
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onSelect={() => {
              setEditId(row.id);
              setFormOpen(true);
            }}
          >
            <Pencil aria-hidden /> {can("equipment_types.update") ? "Editar e parametrizar" : "Ver detalhes"}
          </DropdownMenuItem>
          {can("equipment_types.deactivate") ? (
            <DropdownMenuItem onSelect={() => setStatusTarget(row)}>
              <Power aria-hidden />{" "}
              {row.effectiveStatus === "active" ? "Inativar tipo…" : "Reativar tipo"}
            </DropdownMenuItem>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }

  return (
    <>
      <PageHeader
        title="Tipos de Equipamento"
        description="Gerencie categorias, subcategorias e regras operacionais aplicáveis à frota."
        primaryAction={
          can("equipment_types.create") ? (
            <Button
              leadingIcon={<Plus />}
              onClick={() => {
                setEditId(null);
                setFormOpen(true);
              }}
            >
              Novo tipo
            </Button>
          ) : undefined
        }
      />

      <div className="flex min-h-0 flex-1 flex-col px-4 pb-6 sm:px-6">
        <div className="flex flex-wrap items-center gap-2 pt-6">
          <SearchField
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            onClear={() => setSearch("")}
            placeholder="Buscar por código, nome ou descrição"
            aria-label="Buscar tipos de equipamento"
            wrapperClassName="w-full sm:w-96"
          />
        </div>

        <FilterBar className="mt-2.5 py-0" label="Filtros de tipos de equipamento">
          <FilterSelect
            label="Situação"
            value={filters.status}
            onChange={(value) => apply({ status: value })}
            options={Object.entries(STATUS_LABELS).map(([id, label]) => ({ id, label }))}
          />
          <FilterSelect
            label="Origem"
            value={filters.scope}
            onChange={(value) => apply({ scope: value })}
            options={Object.entries(SCOPE_LABELS).map(([id, label]) => ({ id, label }))}
          />
          <FilterSelect
            label="Operação"
            value={filters.operation}
            onChange={(value) => apply({ operation: value })}
            options={options.operations.map((item) => ({ id: item.id, label: item.label }))}
          />
          {/* O filtro de aplicativos só aparece quando há aplicativos: um select
              vazio não informa nada e ocupa a linha (§23). */}
          <FilterSelect
            label="Aplicativo"
            value={filters.app}
            onChange={(value) => apply({ app: value })}
            options={options.apps.map((item) => ({ id: item.id, label: item.label }))}
          />
        </FilterBar>

        {activeFilters.length > 0 ? (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {activeFilters.map((filter) => (
              <FilterChip
                key={filter.key}
                label={filter.label}
                value={filter.value}
                onRemove={() => apply({ [filter.key]: undefined })}
              />
            ))}
            <FilterBarClear
              onClear={() =>
                startTransition(() => {
                  setSearch("");
                  router.push(pathname, { scroll: false });
                })
              }
            />
          </div>
        ) : null}

        <section className="mt-6 flex flex-col gap-3">
          <h2 className="text-body-sm font-semibold text-fg-secondary">Visão geral</h2>
          {overview}
        </section>

        <div className="mt-6 flex min-h-0 flex-1 flex-col gap-4">
          {isEmpty ? (
            <EmptyState
              icon={<Shapes />}
              title="Nenhum tipo de equipamento"
              description="O catálogo base da plataforma não está disponível e nenhum tipo próprio foi criado."
              action={
                can("equipment_types.create") ? (
                  <Button
                    leadingIcon={<Plus />}
                    onClick={() => {
                      setEditId(null);
                      setFormOpen(true);
                    }}
                  >
                    Novo tipo
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <>
              <TableContainer stickyHeader maxHeight="calc(100dvh - 24rem)" className="hidden lg:block">
                <Table layout="fixed" style={{ minWidth: tableMinWidth }}>
                  <TableHeader>
                    <TableRow>
                      {columns.map((column, index) => (
                        <TableHead
                          key={column.key}
                          style={{
                            width: column.width,
                            left: index === 0 ? 0 : undefined,
                            zIndex: index === 0 ? 21 : undefined,
                          }}
                          className={cn(index === 0 && "sticky border-r border-border bg-surface-secondary")}
                          numeric={column.numeric}
                        >
                          {column.label}
                        </TableHead>
                      ))}
                      <TableHead style={{ width: 56 }}>
                        <span className="sr-only">Ações</span>
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.length === 0 ? (
                      <TableEmpty
                        colSpan={columns.length + 1}
                        message="Nenhum tipo encontrado com os filtros aplicados."
                      />
                    ) : (
                      rows.map((row) => (
                        <TableRow
                          key={row.id}
                          onClick={() => {
                            setEditId(row.id);
                            setFormOpen(true);
                          }}
                          className="h-(--table-row-height) cursor-pointer"
                        >
                          {columns.map((column, index) => (
                            <TableCell
                              key={column.key}
                              numeric={column.numeric}
                              style={{ left: index === 0 ? 0 : undefined, zIndex: index === 0 ? 1 : undefined }}
                              className={cn(index === 0 && "sticky border-r border-border bg-inherit")}
                            >
                              {column.render(row)}
                            </TableCell>
                          ))}
                          <TableCell onClick={(event) => event.stopPropagation()}>
                            <RowActions row={row} />
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </TableContainer>

              <ul className="flex flex-col gap-2 lg:hidden">
                {rows.map((row) => (
                  <li key={row.id}>
                    <button
                      type="button"
                      onClick={() => {
                        setEditId(row.id);
                        setFormOpen(true);
                      }}
                      className="flex w-full flex-col gap-1.5 rounded-md border border-border bg-surface p-3 text-left hfm-transition hover:border-border-strong hfm-focus-ring"
                    >
                      <span className="flex items-start justify-between gap-2">
                        <span className="min-w-0">
                          <span className="block truncate text-body-sm font-semibold text-fg">{row.name}</span>
                          <span className="block truncate font-mono text-caption text-fg-muted">{row.code}</span>
                        </span>
                        <StatusBadge status={row.effectiveStatus === "active" ? "success" : "neutral"}>
                          {STATUS_LABELS[row.effectiveStatus]}
                        </StatusBadge>
                      </span>
                      <span className="flex flex-wrap items-center gap-1.5 text-caption text-fg-secondary">
                        <Badge variant="neutral">
                          {numberFormat.format(row.subcategoryCount)} subcategoria(s)
                        </Badge>
                        <Badge variant="neutral">{numberFormat.format(row.vehicleCount)} veículo(s)</Badge>
                        {row.scope === "global" ? <Badge variant="neutral">Base</Badge> : null}
                      </span>
                    </button>
                  </li>
                ))}
                {rows.length === 0 ? (
                  <li className="rounded-md border border-border bg-surface p-6 text-center text-body-sm text-fg-muted">
                    Nenhum tipo encontrado com os filtros aplicados.
                  </li>
                ) : null}
              </ul>

              <p className="text-caption text-fg-muted">
                {numberFormat.format(rows.length)} tipo(s) · o catálogo base da plataforma aparece junto
                dos tipos criados pela organização.
              </p>
            </>
          )}
        </div>
      </div>

      <EquipmentTypeDrawer
        open={formOpen}
        typeId={editId}
        options={options}
        permissions={permissions}
        isPlatformAdmin={isPlatformAdmin}
        onOpenChange={(open) => {
          setFormOpen(open);
          if (!open) setEditId(null);
        }}
      />

      <DeactivateDialog
        target={statusTarget}
        onClose={() => setStatusTarget(null)}
        onDone={() => {
          setStatusTarget(null);
          toast({ title: "Situação atualizada", variant: "success" });
          startTransition(() => router.refresh());
        }}
        disabled={pending}
      />
    </>
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value?: string;
  onChange: (value: string | undefined) => void;
  options: { id: string; label: string }[];
}) {
  const id = React.useId();
  if (!options.length) return null;

  return (
    <FilterGroup label={label} htmlFor={id}>
      <Select value={value ?? "__all"} onValueChange={(next) => onChange(next === "__all" ? undefined : next)}>
        <SelectTrigger id={id} size="sm" className="w-40">
          <SelectValue placeholder="Todos" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__all">Todos</SelectItem>
          {options.map((option) => (
            <SelectItem key={option.id} value={option.id}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </FilterGroup>
  );
}
