"use client";

import * as React from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { Pencil, Plus, Power, Shapes, SlidersHorizontal } from "lucide-react";
import { cn } from "@/lib/cn";
import { PageContent, PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { SearchField } from "@/components/ui/search-field";
import { FilterBar, FilterChip, FilterBarClear } from "@/components/ui/filter-bar";
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
const dateFormat = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short" });
const timeFormat = new Intl.DateTimeFormat("pt-BR", { timeStyle: "short" });

const STATUS_LABELS: Record<string, string> = { active: "Ativo", inactive: "Inativo" };

/**
 * Prioridade de coluna (UI 2.0): num contêiner mais estreito que 62rem (1280
 * com o menu aberto) a data de atualização vira a segunda linha da Situação, e
 * a largura dela volta para o nome do tipo; a partir dessa largura (1366) é uma
 * coluna própria. As classes ficam escritas por extenso para o Tailwind gerá-las.
 */
const UPDATED_FOLD = { column: "hidden @min-[62rem]:table-cell", line: "@min-[62rem]:hidden" } as const;
const SCOPE_LABELS: Record<string, string> = { global: "Catálogo base", organization: "Da organização" };

interface Column {
  key: string;
  label: string;
  /** The one column without a fixed width: it absorbs what the others leave, down to `width`. */
  fluid?: boolean;
  /** Short header (with `<abbr title>`) when the full label would not fit — never an ellipsis. */
  header?: React.ReactNode;
  width: number;
  numeric?: boolean;
  /** Coluna que vira segunda linha de outra abaixo de 62rem de tabela (`UPDATED_FOLD`). */
  foldable?: boolean;
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
        width: 92,
        render: (row) => <span className="font-mono text-caption whitespace-nowrap text-fg">{row.code}</span>,
      },
      {
        key: "name",
        label: "Tipo",
        fluid: true,
        width: 104,
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
        width: 128,
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
        width: 88,
        numeric: true,
        render: (row) => <span className="tabular-nums">{numberFormat.format(row.vehicleCount)}</span>,
      },
      {
        key: "operations",
        label: "Operações habilitadas",
        header: (
          <abbr title="Operações habilitadas" className="no-underline">
            Operações
          </abbr>
        ),
        width: 156,
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
        width: 104,
        numeric: true,
        render: (row) =>
          row.appCount === 0 ? <span className="text-fg-muted">—</span> : (
            <span className="tabular-nums">{numberFormat.format(row.appCount)}</span>
          ),
      },
      {
        key: "status",
        label: "Situação",
        width: 104,
        render: (row) => (
          <>
            <StatusBadge status={row.effectiveStatus === "active" ? "success" : "neutral"}>
              {STATUS_LABELS[row.effectiveStatus]}
            </StatusBadge>
            {/* A data dobrada (tabela estreita): só o dia, a hora fica no título. */}
            {row.updatedAt ? (
              <span
                className={cn("mt-0.5 block text-caption whitespace-nowrap text-fg-muted tabular-nums", UPDATED_FOLD.line)}
                title={`Atualizado em ${dateTimeFormat.format(new Date(row.updatedAt))}`}
              >
                <span className="sr-only">Atualizado em </span>
                {dateFormat.format(new Date(row.updatedAt))}
              </span>
            ) : null}
          </>
        ),
      },
      {
        key: "updated_at",
        label: "Última atualização",
        header: (
          <abbr title="Última atualização" className="no-underline">
            Atualização
          </abbr>
        ),
        width: 112,
        foldable: true,
        // Duas linhas (data / hora) em vez de uma coluna larga.
        render: (row) => {
          if (!row.updatedAt) return <span className="text-fg-muted">—</span>;
          const at = new Date(row.updatedAt);
          return (
            <span className="block whitespace-nowrap tabular-nums" title={dateTimeFormat.format(at)}>
              <span className="block">{dateFormat.format(at)}</span>
              <span className="block text-caption text-fg-muted">{timeFormat.format(at)}</span>
            </span>
          );
        },
      },
    ],
    [],
  );

  // 48px for the actions column. The table refuses to render narrower than the
  // sum of its columns — with the folded date counted only where it is a column.
  const tableMinWidth = {
    "--types-table-min": `${columns.reduce((sum, column) => sum + (column.foldable ? 0 : column.width), 48)}px`,
    "--types-table-min-wide": `${columns.reduce((sum, column) => sum + column.width, 48)}px`,
  } as React.CSSProperties;
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
      <PageHeader eyebrow="Estrutura operacional"
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
        filters={
          <>
            {/* Os campos crescem juntos e só quebram linha quando não cabem; a
                busca abre a barra e é o campo que mais cresce. */}
            <FilterBar className="items-end gap-x-3 gap-y-2.5" label="Filtros de tipos de equipamento">
              <div className="flex min-w-0 flex-1 basis-[36rem] flex-wrap items-end gap-2.5">
                <div className="flex min-w-0 flex-[2_1_16rem] flex-col gap-1">
                  <span className="text-caption text-fg-muted">Buscar</span>
                  <SearchField
                    size="sm"
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    onClear={() => setSearch("")}
                    placeholder="Código, nome ou descrição"
                    aria-label="Buscar tipos de equipamento"
                  />
                </div>
                <FilterSelect
                  label="Situação"
                  className="flex-[1_1_6rem]"
                  value={filters.status}
                  onChange={(value) => apply({ status: value })}
                  options={Object.entries(STATUS_LABELS).map(([id, label]) => ({ id, label }))}
                />
                <FilterSelect
                  label="Origem"
                  className="flex-[1_1_8rem]"
                  value={filters.scope}
                  onChange={(value) => apply({ scope: value })}
                  options={Object.entries(SCOPE_LABELS).map(([id, label]) => ({ id, label }))}
                />
                <FilterSelect
                  label="Operação"
                  className="flex-[1.2_1_8rem]"
                  value={filters.operation}
                  onChange={(value) => apply({ operation: value })}
                  options={options.operations.map((item) => ({ id: item.id, label: item.label }))}
                />
                {/* O filtro de aplicativos só aparece quando há aplicativos: um select
                    vazio não informa nada e ocupa a linha (§23). */}
                <FilterSelect
                  label="Aplicativo"
                  className="flex-[1.2_1_8rem]"
                  value={filters.app}
                  onChange={(value) => apply({ app: value })}
                  options={options.apps.map((item) => ({ id: item.id, label: item.label }))}
                />
              </div>
            </FilterBar>

            {/* Os chips pertencem aos filtros: ficam no mesmo cartão, logo abaixo. */}
            {activeFilters.length > 0 ? (
              <div
                role="group"
                aria-label="Filtros aplicados"
                className="flex flex-wrap items-center gap-1.5 border-t border-border-subtle pt-2 pb-1.5"
              >
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
          </>
        }
      />

      <PageContent className="flex min-h-0 flex-1 flex-col gap-5">
        <section className="flex flex-col gap-3">
          <h2 className="text-body-sm font-semibold text-fg-secondary">Visão geral</h2>
          {overview}
        </section>

        <div className="flex min-h-0 flex-1 flex-col gap-4">
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
              {/* `@container`: a tabela mede a própria largura (com o menu aberto
                  ou recolhido) para decidir se a data é coluna ou segunda linha. */}
              <TableContainer stickyHeader maxHeight="calc(100dvh - 24rem)" className="@container hidden lg:block">
                <Table
                  layout="fixed"
                  style={tableMinWidth}
                  className="min-w-(--types-table-min) @min-[62rem]:min-w-(--types-table-min-wide)"
                >
                  <TableHeader>
                    <TableRow>
                      {columns.map((column, index) => (
                        <TableHead
                          key={column.key}
                          style={{
                            width: column.fluid ? undefined : column.width,
                            left: index === 0 ? 0 : undefined,
                            zIndex: index === 0 ? 21 : undefined,
                          }}
                          className={cn(
                            index === 0 && "sticky border-r border-border bg-surface-secondary",
                            column.foldable && UPDATED_FOLD.column,
                          )}
                          numeric={column.numeric}
                        >
                          {column.header ?? column.label}
                        </TableHead>
                      ))}
                      <TableHead style={{ width: 48 }} className="px-2">
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
                              className={cn(
                                index === 0 && "sticky border-r border-border bg-inherit",
                                column.foldable && UPDATED_FOLD.column,
                              )}
                            >
                              {column.render(row)}
                            </TableCell>
                          ))}
                          <TableCell className="px-2" onClick={(event) => event.stopPropagation()}>
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
      </PageContent>

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

/** A filter of the toolbar: label above the control, as wide as its field (UI 2.0). */
function FilterSelect({
  label,
  value,
  onChange,
  options,
  className,
}: {
  label: string;
  value?: string;
  onChange: (value: string | undefined) => void;
  options: { id: string; label: string }[];
  className?: string;
}) {
  const id = React.useId();
  if (!options.length) return null;

  return (
    <div className={cn("flex min-w-0 flex-col gap-1", className)}>
      <label htmlFor={id} className="text-caption text-fg-muted">
        {label}
      </label>
      <Select value={value ?? "__all"} onValueChange={(next) => onChange(next === "__all" ? undefined : next)}>
        <SelectTrigger id={id} size="sm" className="w-full">
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
    </div>
  );
}
