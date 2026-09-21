"use client";

import * as React from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import {
  Archive,
  ArrowRightLeft,
  Columns3,
  Download,
  FileSpreadsheet,
  Gauge,
  Pencil,
  Plus,
  RotateCcw,
  SlidersHorizontal,
  Truck,
  Upload,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { usePersistedSet } from "@/lib/use-persisted-set";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { SearchField } from "@/components/ui/search-field";
import { FilterBar, FilterGroup, FilterChip, FilterBarClear } from "@/components/ui/filter-bar";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/ui/status-badge";
import { Pagination } from "@/components/ui/pagination";
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
import { useConfirm } from "@/components/feedback/confirm-dialog";
import { OWNERSHIP_LABELS, VEHICLE_STATUS_LABELS } from "@/lib/fleet/columns";
import type { FleetOptions, VehicleFilters, VehiclePage, VehicleSortKey } from "@/lib/fleet/queries";
import { archiveVehicle, restoreVehicle, setVehicleStatus } from "@/lib/fleet/actions";
import { useOperationGeography } from "./use-operation-geography";
import { VehicleFormDrawer } from "./vehicle-form-drawer";
import { VehicleDetailDrawer } from "./vehicle-detail-drawer";
import { FleetImportDrawer } from "./import-drawer";

/* -------------------------------------------------------------------------- */
/* Presentation helpers                                                       */
/* -------------------------------------------------------------------------- */

const numberFormat = new Intl.NumberFormat("pt-BR");
const currencyFormat = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

const STATUS_TONE = { active: "success", inactive: "neutral" } as const;

/** Persisted normalized; shown the way a plate is read. */
export function formatPlate(value: string | null | undefined): string {
  if (!value) return "—";
  if (/^[A-Z]{3}\d[A-Z]\d{2}$/.test(value)) return value; // Mercosul, read as one block
  if (/^[A-Z]{3}\d{4}$/.test(value)) return `${value.slice(0, 3)}-${value.slice(3)}`;
  return value;
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  const [year, month, day] = value.split("-");
  return year && month && day ? `${day}/${month}/${year}` : value;
}

/** One line, clipped with an ellipsis, with the full value on hover. */
function Cell({ value, className }: { value?: string | null; className?: string }) {
  const text = value?.trim();
  if (!text) return <span className="text-fg-muted">—</span>;
  return (
    <span title={text} className={cn("block truncate", className)}>
      {text}
    </span>
  );
}

/* -------------------------------------------------------------------------- */
/* Columns                                                                    */
/* -------------------------------------------------------------------------- */

type VehicleRow = VehiclePage["rows"][number];

interface FleetColumn {
  key: string;
  label: string;
  /** Floor width in px, chosen so the header reads in full — never an ellipsis
   *  on a column's own name. When the sum exceeds the viewport the container
   *  scrolls sideways instead of shrinking the type (§47). */
  width: number;
  sort?: VehicleSortKey;
  numeric?: boolean;
  /** Secondary field: available in the Colunas menu, off by default (§46). */
  optional?: boolean;
  render: (row: VehicleRow) => React.ReactNode;
}

const COLUMN_STORAGE_KEY = "hfm.frota.columns";

/* -------------------------------------------------------------------------- */

export interface FleetViewProps {
  page: VehiclePage;
  options: FleetOptions;
  filters: VehicleFilters;
  permissions: string[];
  isPlatformAdmin: boolean;
  overview: React.ReactNode;
}

export function FleetView({
  page,
  options,
  filters,
  permissions,
  isPlatformAdmin,
  overview,
}: FleetViewProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { toast } = useToast();
  const confirm = useConfirm();
  const [pending, startTransition] = React.useTransition();

  const can = React.useCallback(
    (permission: string) => isPlatformAdmin || permissions.includes(permission),
    [permissions, isPlatformAdmin],
  );

  const [search, setSearch] = React.useState(filters.q ?? "");
  const [detailId, setDetailId] = React.useState<string | null>(null);
  const [formOpen, setFormOpen] = React.useState(false);
  const [editId, setEditId] = React.useState<string | null>(null);
  const [importOpen, setImportOpen] = React.useState(false);

  // Adjusting state during render (React's documented pattern) rather than in
  // an effect: the search box follows the URL without an extra commit.
  const [syncedQuery, setSyncedQuery] = React.useState(filters.q ?? "");
  if (syncedQuery !== (filters.q ?? "")) {
    setSyncedQuery(filters.q ?? "");
    setSearch(filters.q ?? "");
  }

  /** Filters live in the URL: the page is shareable and the server does the work. */
  const apply = React.useCallback(
    (changes: Record<string, string | undefined>, resetPage = true) => {
      const params = new URLSearchParams(searchParams.toString());
      for (const [key, value] of Object.entries(changes)) {
        if (value === undefined || value === "") params.delete(key);
        else params.set(key, value);
      }
      if (resetPage) params.delete("page");
      startTransition(() => router.push(`${pathname}?${params.toString()}`, { scroll: false }));
    },
    [pathname, router, searchParams],
  );

  React.useEffect(() => {
    if ((filters.q ?? "") === search) return;
    const timer = setTimeout(() => apply({ q: search || undefined }), 350);
    return () => clearTimeout(timer);
  }, [search, filters.q, apply]);

  // Estado and Cidade only offer what the chosen operation covers — the Etapa 04
  // contract, reused. With no operation chosen there is nothing coherent to
  // offer, so both stay out of the way instead of listing Brazil.
  const geography = useOperationGeography(filters.operation, filters.state);

  /** Subcategories belong to a type; offering all of them under a filtered type
   *  is how an impossible combination gets chosen. */
  const subcategoryOptions = React.useMemo(
    () =>
      filters.type
        ? options.subcategories.filter((item) => item.vehicleTypeId === filters.type)
        : options.subcategories,
    [options.subcategories, filters.type],
  );

  const labelOf = (list: { id: string; label: string }[], id?: string): string =>
    list.find((item) => item.id === id)?.label ?? id ?? "";

  const activeFilters = React.useMemo(() => {
    const chips: { key: string; label: string; value: string }[] = [];
    if (filters.status) chips.push({ key: "status", label: "Situação", value: VEHICLE_STATUS_LABELS[filters.status] ?? filters.status });
    if (filters.ownership) chips.push({ key: "ownership", label: "Titularidade", value: OWNERSHIP_LABELS[filters.ownership] ?? filters.ownership });
    if (filters.type) chips.push({ key: "type", label: "Tipo", value: labelOf(options.types, filters.type) });
    if (filters.subcategory) chips.push({ key: "subcategory", label: "Subcategoria", value: labelOf(options.subcategories, filters.subcategory) });
    if (filters.operation) chips.push({ key: "operation", label: "Operação", value: labelOf(options.operations, filters.operation) });
    if (filters.state) {
      const state = geography.states.find((item) => String(item.stateId) === filters.state);
      chips.push({ key: "state", label: "Estado", value: state?.uf ?? filters.state });
    }
    if (filters.city) {
      const city = geography.cities.find((item) => String(item.cityId) === filters.city);
      chips.push({ key: "city", label: "Cidade", value: city?.name ?? filters.city });
    }
    if (filters.unit) chips.push({ key: "unit", label: "Filial", value: labelOf(options.units, filters.unit) });
    if (filters.archived) chips.push({ key: "archived", label: "Exibindo", value: "Arquivados" });
    return chips;
  }, [filters, options, geography.states, geography.cities]);

  const columns = React.useMemo<FleetColumn[]>(
    () => [
      {
        key: "fleet_code",
        label: "Frota",
        width: 116,
        sort: "fleet_code",
        // Alphanumeric and left-aligned on purpose: "000123" is a code, not a
        // number, and right-aligning it would invite reading it as one (§7).
        render: (row) => <Cell value={row.fleet_code} className="font-medium text-fg" />,
      },
      {
        key: "license_plate",
        label: "Placa",
        width: 120,
        sort: "license_plate",
        render: (row) => (
          <span className="font-medium tracking-wide text-fg">{formatPlate(row.license_plate)}</span>
        ),
      },
      {
        key: "vehicle_type_name",
        label: "Tipo",
        width: 140,
        sort: "vehicle_type_name",
        render: (row) => <Cell value={row.vehicle_type_name} />,
      },
      {
        key: "model",
        label: "Marca / Modelo",
        width: 200,
        sort: "vehicle_make_name",
        render: (row) => (
          <Cell
            value={
              [row.vehicle_make_name, row.vehicle_model_name].filter(Boolean).join(" ") || null
            }
          />
        ),
      },
      {
        key: "ownership_type",
        label: "Titularidade",
        width: 130,
        sort: "ownership_type",
        render: (row) => (
          <Badge variant="neutral">{OWNERSHIP_LABELS[row.ownership_type ?? ""] ?? "—"}</Badge>
        ),
      },
      {
        key: "operation_name",
        label: "Operação",
        width: 180,
        sort: "operation_name",
        render: (row) =>
          row.operation_name ? (
            <Cell value={row.operation_name} />
          ) : row.scheduled_operation_name ? (
            // Not allocated today, but already scheduled. Saying so is what
            // stops the same transfer being arranged twice.
            <span
              className="block truncate text-fg-muted"
              title={`A partir de ${formatDate(row.scheduled_from)}: ${row.scheduled_operation_name}`}
            >
              A partir de {formatDate(row.scheduled_from)}
            </span>
          ) : (
            <Badge variant="warning">Sem alocação</Badge>
          ),
      },
      {
        key: "city_name",
        label: "Cidade / UF",
        width: 170,
        sort: "city_name",
        render: (row) =>
          row.city_name ? (
            <Cell value={`${row.city_name}${row.state_uf ? ` / ${row.state_uf}` : ""}`} />
          ) : (
            <span className="text-fg-muted">—</span>
          ),
      },
      {
        key: "status",
        label: "Situação",
        width: 116,
        sort: "status",
        render: (row) => (
          <StatusBadge status={STATUS_TONE[(row.status ?? "active") as keyof typeof STATUS_TONE] ?? "neutral"}>
            {VEHICLE_STATUS_LABELS[row.status ?? ""] ?? "—"}
          </StatusBadge>
        ),
      },
      {
        key: "current_odometer_km",
        label: "KM atual",
        width: 118,
        sort: "current_odometer_km",
        numeric: true,
        render: (row) =>
          row.current_odometer_km === null || row.current_odometer_km === undefined ? (
            // A vehicle with no reading has no kilometres — it does not have
            // zero (§19). The dash is the honest value.
            <span className="text-fg-muted">—</span>
          ) : (
            <span className="tabular-nums" title={`Leitura de ${formatDate(row.odometer_reading_date)}`}>
              {numberFormat.format(row.current_odometer_km)}
            </span>
          ),
      },
      {
        key: "vehicle_subcategory_name",
        label: "Subcategoria",
        width: 160,
        optional: true,
        render: (row) => <Cell value={row.vehicle_subcategory_name} />,
      },
      {
        key: "vin",
        label: "Chassi",
        width: 180,
        optional: true,
        render: (row) => <Cell value={row.vin} className="font-mono text-caption" />,
      },
      {
        key: "renavam",
        label: "RENAVAM",
        width: 140,
        optional: true,
        render: (row) => <Cell value={row.renavam} className="font-mono text-caption" />,
      },
      {
        key: "organization_unit_name",
        label: "Filial",
        width: 160,
        optional: true,
        render: (row) => <Cell value={row.organization_unit_name} />,
      },
      {
        key: "cost_center_name",
        label: "Centro de custo",
        width: 170,
        optional: true,
        render: (row) => <Cell value={row.cost_center_name} />,
      },
      {
        key: "model_year",
        label: "Ano modelo",
        width: 120,
        optional: true,
        numeric: true,
        render: (row) => <span className="tabular-nums">{row.model_year ?? "—"}</span>,
      },
      {
        key: "asset_value",
        label: "Valor do ativo",
        width: 150,
        optional: true,
        numeric: true,
        render: (row) =>
          row.asset_value === null || row.asset_value === undefined ? (
            <span className="text-fg-muted" title="Valor não informado">
              —
            </span>
          ) : (
            <span className="tabular-nums">{currencyFormat.format(Number(row.asset_value))}</span>
          ),
      },
    ],
    [],
  );

  const defaultHidden = React.useMemo(
    () => columns.filter((column) => column.optional).map((column) => column.key),
    [columns],
  );
  const [hidden, toggleColumn] = usePersistedSet(COLUMN_STORAGE_KEY, defaultHidden);

  const advancedCount = [filters.subcategory, filters.state, filters.city, filters.unit, filters.archived].filter(
    Boolean,
  ).length;

  const overviewLabelId = React.useId();
  const visibleColumns = columns.filter((column) => !hidden.includes(column.key));
  // 56px for the actions column. The table refuses to render narrower than the
  // sum of its columns, which is what turns a squeeze into a scrollbar.
  const tableMinWidth = visibleColumns.reduce((sum, column) => sum + column.width, 56);

  const sortDirection = (key: VehicleSortKey) =>
    filters.sort === key ? (filters.dir === "desc" ? "desc" : "asc") : undefined;
  const onSort = (key: VehicleSortKey) => () =>
    apply({ sort: key, dir: filters.sort === key && filters.dir !== "desc" ? "desc" : "asc" });

  function exportHref(format: "xlsx" | "csv" | "template") {
    const params = new URLSearchParams(searchParams.toString());
    params.set("format", format);
    return `${pathname}/export?${params.toString()}`;
  }

  async function runStatus(row: VehicleRow, next: "active" | "inactive") {
    if (!row.id) return;
    const confirmed = await confirm({
      title: next === "inactive" ? "Inativar veículo" : "Reativar veículo",
      description:
        next === "inactive"
          ? "A situação cadastral passa a Inativo. A alocação vigente, o histórico e as leituras de quilometragem são preservados."
          : "A situação cadastral volta a Ativo. A alocação não é restaurada automaticamente.",
      confirmLabel: next === "inactive" ? "Inativar" : "Reativar",
      destructive: next === "inactive",
    });
    if (!confirmed) return;

    const result = await setVehicleStatus(row.id, next, null);
    if (result.ok) {
      toast({ title: "Situação atualizada", variant: "success" });
      startTransition(() => router.refresh());
    } else {
      toast({ title: result.error ?? "Não foi possível atualizar.", variant: "danger" });
    }
  }

  async function runArchive(row: VehicleRow) {
    if (!row.id) return;
    const impact = [
      row.operation_name ? `Alocação vigente em ${row.city_name ?? row.operation_name} será encerrada.` : null,
      row.scheduled_operation_name ? "Há uma transferência programada que será cancelada." : null,
    ].filter(Boolean);

    const confirmed = await confirm({
      title: "Arquivar cadastro",
      description: [
        "O veículo sai das listas e nada é apagado: histórico de alocação, leituras e situação permanecem.",
        ...impact,
      ].join(" "),
      confirmLabel: "Arquivar",
      destructive: true,
    });
    if (!confirmed) return;

    const result = await archiveVehicle(row.id, null);
    if (result.ok) {
      toast({ title: "Cadastro arquivado", variant: "success" });
      startTransition(() => router.refresh());
    } else {
      toast({ title: result.error ?? "Não foi possível arquivar.", variant: "danger" });
    }
  }

  async function runRestore(row: VehicleRow) {
    if (!row.id) return;
    const result = await restoreVehicle(row.id);
    if (result.ok) {
      toast({ title: "Cadastro restaurado", variant: "success" });
      startTransition(() => router.refresh());
    } else {
      toast({ title: result.error ?? "Não foi possível restaurar.", variant: "danger" });
    }
  }

  function RowActions({ row }: { row: VehicleRow }) {
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="sm" aria-label={`Ações para a frota ${row.fleet_code ?? ""}`}>
            <SlidersHorizontal aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-56">
          <DropdownMenuLabel>
            Frota {row.fleet_code} · {formatPlate(row.license_plate)}
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => row.id && setDetailId(row.id)}>
            <Truck aria-hidden /> Ver detalhes
          </DropdownMenuItem>
          {can("vehicles.update") && !row.deleted_at ? (
            <DropdownMenuItem
              onSelect={() => {
                setEditId(row.id ?? null);
                setFormOpen(true);
              }}
            >
              <Pencil aria-hidden /> Editar cadastro
            </DropdownMenuItem>
          ) : null}
          {can("vehicles.manage_assignment") && !row.deleted_at ? (
            <DropdownMenuItem onSelect={() => row.id && setDetailId(row.id)}>
              <ArrowRightLeft aria-hidden /> Transferir operação…
            </DropdownMenuItem>
          ) : null}
          {can("vehicles.correct_odometer") && !row.deleted_at ? (
            <DropdownMenuItem onSelect={() => row.id && setDetailId(row.id)}>
              <Gauge aria-hidden /> Corrigir quilometragem…
            </DropdownMenuItem>
          ) : null}
          {can("vehicles.update") && !row.deleted_at ? (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onSelect={() => runStatus(row, row.status === "active" ? "inactive" : "active")}
              >
                {row.status === "active" ? "Inativar veículo" : "Reativar veículo"}
              </DropdownMenuItem>
            </>
          ) : null}
          {can("vehicles.archive") ? (
            <DropdownMenuItem onSelect={() => (row.deleted_at ? runRestore(row) : runArchive(row))}>
              {row.deleted_at ? (
                <>
                  <RotateCcw aria-hidden /> Restaurar cadastro
                </>
              ) : (
                <>
                  <Archive aria-hidden /> Arquivar cadastro
                </>
              )}
            </DropdownMenuItem>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }

  const isEmpty = page.total === 0 && !activeFilters.length && !filters.q;

  return (
    <>
      <PageHeader
        title="Cadastro de Frotas"
        description="Gerencie veículos, vínculos operacionais e informações cadastrais da frota."
        primaryAction={
          can("vehicles.create") ? (
            <Button
              leadingIcon={<Plus />}
              onClick={() => {
                setEditId(null);
                setFormOpen(true);
              }}
            >
              Nova frota
            </Button>
          ) : undefined
        }
        secondaryActions={
          <>
            {can("vehicles.import") ? (
              <Button variant="secondary" leadingIcon={<Upload />} onClick={() => setImportOpen(true)}>
                Importar
              </Button>
            ) : null}
            {can("vehicles.export") ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="secondary" leadingIcon={<Download />}>
                    Exportar
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="min-w-64">
                  <DropdownMenuLabel>
                    Exportar {numberFormat.format(page.total)} registro(s) com os filtros atuais
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem asChild>
                    <a href={exportHref("xlsx")} download>
                      <FileSpreadsheet aria-hidden /> Cadastro de frotas (XLSX)
                    </a>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <a href={exportHref("csv")} download>
                      <FileSpreadsheet aria-hidden /> Cadastro de frotas (CSV)
                    </a>
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem asChild>
                    <a href={exportHref("template")} download>
                      <Download aria-hidden /> Modelo de importação
                    </a>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}
          </>
        }
      />

      <div className="flex min-h-0 flex-1 flex-col px-4 pb-6 sm:px-6">
        {/* Cabeçalho → busca: 24px. Quem chega nesta tela chega procurando um
            veículo, então a busca abre o conteúdo, numa largura em que o texto
            de ajuda cabe inteiro — o campo cresce para caber a frase. */}
        <div className="flex flex-wrap items-center gap-2 pt-6">
          <SearchField
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            onClear={() => setSearch("")}
            placeholder="Buscar por frota, placa, marca ou modelo"
            aria-label="Buscar veículos"
            // The width belongs on the wrapper: the component's own is `w-full`.
            wrapperClassName="w-full sm:w-110"
          />

          <div className="ml-auto flex flex-wrap items-center gap-2">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="secondary" size="sm" leadingIcon={<Columns3 />} className="hidden lg:inline-flex">
                  Colunas
                  <span className="tabular-nums text-fg-secondary">
                    {visibleColumns.length}/{columns.length}
                  </span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-56">
                <DropdownMenuLabel>Colunas visíveis</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {columns.map((column) => {
                  const shown = !hidden.includes(column.key);
                  return (
                    <DropdownMenuItem
                      key={column.key}
                      onSelect={(event) => {
                        event.preventDefault();
                        toggleColumn(column.key);
                      }}
                      // Frota is the row's identity and its keyboard handle.
                      disabled={column.key === "fleet_code"}
                    >
                      <Checkbox checked={shown} aria-hidden tabIndex={-1} className="pointer-events-none" />
                      {column.label}
                    </DropdownMenuItem>
                  );
                })}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        {/* Busca → filtros: 10px. */}
        <FilterBar className="mt-2.5 py-0" label="Filtros de veículos">
          <FilterSelect
            label="Situação"
            value={filters.status}
            onChange={(value) => apply({ status: value })}
            options={Object.entries(VEHICLE_STATUS_LABELS).map(([id, label]) => ({ id, label }))}
          />
          <FilterSelect
            label="Titularidade"
            value={filters.ownership}
            onChange={(value) => apply({ ownership: value })}
            options={Object.entries(OWNERSHIP_LABELS).map(([id, label]) => ({ id, label }))}
          />
          <FilterSelect
            label="Tipo"
            value={filters.type}
            onChange={(value) => apply({ type: value, subcategory: undefined })}
            options={options.types}
          />
          {/* Operação é o eixo dos três filtros geográficos: trocá-la invalida
              o estado e a cidade escolhidos, então os dois são limpos junto. */}
          <FilterSelect
            label="Operação"
            value={filters.operation}
            onChange={(value) => apply({ operation: value, state: undefined, city: undefined })}
            options={options.operations}
          />

          <Popover>
            <PopoverTrigger asChild>
              <Button variant="secondary" size="sm" leadingIcon={<SlidersHorizontal />}>
                Mais filtros
                {advancedCount > 0 ? (
                  <Badge variant="primary" size="sm" className="tabular-nums">
                    {advancedCount}
                  </Badge>
                ) : null}
              </Button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-80">
              <div className="flex flex-col gap-3">
                <p className="text-h4 font-semibold text-fg">Filtros adicionais</p>
                <StackedFilter
                  label="Subcategoria"
                  value={filters.subcategory}
                  onChange={(value) => apply({ subcategory: value })}
                  options={subcategoryOptions}
                />
                <StackedFilter
                  label="Estado"
                  value={filters.state}
                  onChange={(value) => apply({ state: value, city: undefined })}
                  options={geography.states.map((state) => ({
                    id: String(state.stateId),
                    label: `${state.name} (${state.uf})`,
                  }))}
                  emptyHint={
                    filters.operation
                      ? "Esta operação não possui estados na cobertura."
                      : "Escolha uma operação para filtrar por estado."
                  }
                />
                <StackedFilter
                  label="Cidade"
                  value={filters.city}
                  onChange={(value) => apply({ city: value })}
                  options={geography.cities.map((city) => ({ id: String(city.cityId), label: city.name }))}
                  emptyHint={
                    filters.state
                      ? "Nenhuma cidade coberta neste estado."
                      : "Escolha um estado para filtrar por cidade."
                  }
                />
                <StackedFilter
                  label="Filial"
                  value={filters.unit}
                  onChange={(value) => apply({ unit: value })}
                  options={options.units}
                />
                {can("vehicles.archive") ? (
                  <label className="flex items-center gap-2 border-t border-border-subtle pt-3 text-body-sm text-fg-secondary">
                    <Checkbox
                      checked={Boolean(filters.archived)}
                      onCheckedChange={(checked) => apply({ archived: checked ? "1" : undefined })}
                    />
                    Exibir cadastros arquivados
                  </label>
                ) : null}
              </div>
            </PopoverContent>
          </Popover>
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

        {/* Filtros → indicadores: 24px. Os cartões seguem os filtros
            estruturais e ignoram a busca: recontar a frota a cada tecla faria
            os números piscarem sem informar nada. */}
        <section className="mt-6 flex flex-col gap-3" aria-labelledby={overviewLabelId}>
          <h2 id={overviewLabelId} className="text-body-sm font-semibold text-fg-secondary">
            Visão geral
          </h2>
          {overview}
        </section>

        {/* Indicadores → tabela: 24px. */}
        <div className="mt-6 flex min-h-0 flex-1 flex-col gap-4">
          {isEmpty ? (
            <EmptyState
              icon={<Truck />}
              title="Nenhum veículo cadastrado"
              description="Cadastre manualmente ou importe a base de frotas."
              action={
                can("vehicles.create") ? (
                  <Button
                    leadingIcon={<Plus />}
                    onClick={() => {
                      setEditId(null);
                      setFormOpen(true);
                    }}
                  >
                    Nova frota
                  </Button>
                ) : undefined
              }
              secondaryAction={
                can("vehicles.import") ? (
                  <Button variant="secondary" leadingIcon={<Upload />} onClick={() => setImportOpen(true)}>
                    Importar base
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
                      {visibleColumns.map((column, index) => (
                        <TableHead
                          key={column.key}
                          style={{
                            width: column.width,
                            left: index === 0 ? 0 : undefined,
                            zIndex: index === 0 ? 21 : undefined,
                          }}
                          className={cn(index === 0 && "sticky border-r border-border bg-surface-secondary")}
                          numeric={column.numeric}
                          sortable={Boolean(column.sort)}
                          sortDirection={column.sort ? sortDirection(column.sort) : undefined}
                          onSort={column.sort ? onSort(column.sort) : undefined}
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
                    {page.rows.length === 0 ? (
                      <TableEmpty
                        colSpan={visibleColumns.length + 1}
                        message="Nenhum veículo encontrado com os filtros aplicados."
                      />
                    ) : (
                      page.rows.map((row) => (
                        <TableRow
                          key={row.id}
                          onClick={() => row.id && setDetailId(row.id)}
                          className={cn("h-(--table-row-height) cursor-pointer", row.deleted_at && "opacity-70")}
                        >
                          {visibleColumns.map((column, index) => (
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

              {/* Abaixo de lg as mesmas linhas viram cartões: uma lista
                  compacta com acesso ao detalhe, nunca a tabela espremida. */}
              <ul className="flex flex-col gap-2 lg:hidden">
                {page.rows.map((row) => (
                  <li key={row.id}>
                    <button
                      type="button"
                      onClick={() => row.id && setDetailId(row.id)}
                      className="flex w-full flex-col gap-1.5 rounded-md border border-border bg-surface p-3 text-left hfm-transition hover:border-border-strong hfm-focus-ring"
                    >
                      <span className="flex items-start justify-between gap-2">
                        <span className="min-w-0">
                          <span className="block truncate text-body-sm font-semibold text-fg">
                            {row.fleet_code} · {formatPlate(row.license_plate)}
                          </span>
                          <span className="block truncate text-caption text-fg-muted">
                            {[row.vehicle_type_name, row.vehicle_make_name, row.vehicle_model_name]
                              .filter(Boolean)
                              .join(" · ") || "Sem classificação"}
                          </span>
                        </span>
                        <StatusBadge
                          status={STATUS_TONE[(row.status ?? "active") as keyof typeof STATUS_TONE] ?? "neutral"}
                        >
                          {VEHICLE_STATUS_LABELS[row.status ?? ""] ?? "—"}
                        </StatusBadge>
                      </span>
                      <span className="flex flex-wrap items-center gap-1.5 text-caption text-fg-secondary">
                        {row.operation_name ? (
                          <Badge variant="neutral">{row.operation_name}</Badge>
                        ) : (
                          <Badge variant="warning">Sem alocação</Badge>
                        )}
                        {row.city_name ? (
                          <Badge variant="neutral">
                            {row.city_name}
                            {row.state_uf ? `/${row.state_uf}` : ""}
                          </Badge>
                        ) : null}
                        <Badge variant="neutral">{OWNERSHIP_LABELS[row.ownership_type ?? ""] ?? "—"}</Badge>
                        {row.current_odometer_km !== null && row.current_odometer_km !== undefined ? (
                          <span className="tabular-nums">{numberFormat.format(row.current_odometer_km)} km</span>
                        ) : null}
                      </span>
                    </button>
                  </li>
                ))}
                {page.rows.length === 0 ? (
                  <li className="rounded-md border border-border bg-surface p-6 text-center text-body-sm text-fg-muted">
                    Nenhum veículo encontrado com os filtros aplicados.
                  </li>
                ) : null}
              </ul>

              <Pagination
                page={page.page}
                pageSize={page.pageSize}
                total={page.total}
                disabled={pending}
                onPageChange={(value) => apply({ page: String(value) }, false)}
                onPageSizeChange={(value) => apply({ pageSize: String(value), page: undefined })}
              />
            </>
          )}
        </div>
      </div>

      <VehicleDetailDrawer
        vehicleId={detailId}
        permissions={permissions}
        isPlatformAdmin={isPlatformAdmin}
        onClose={() => setDetailId(null)}
        onEdit={(id) => {
          setDetailId(null);
          setEditId(id);
          setFormOpen(true);
        }}
      />

      <VehicleFormDrawer
        open={formOpen}
        vehicleId={editId}
        options={options}
        permissions={permissions}
        isPlatformAdmin={isPlatformAdmin}
        onOpenChange={(open) => {
          setFormOpen(open);
          if (!open) setEditId(null);
        }}
      />

      <FleetImportDrawer open={importOpen} onOpenChange={setImportOpen} />
    </>
  );
}

/* -------------------------------------------------------------------------- */

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

/**
 * A filter in the advanced popover: label above the control, full width.
 *
 * `emptyHint` is what a cascading filter needs and a flat one does not: with no
 * operation chosen there is no coherent list of states, and an empty select
 * that says nothing looks broken rather than dependent.
 */
function StackedFilter({
  label,
  value,
  onChange,
  options,
  emptyHint,
}: {
  label: string;
  value?: string;
  onChange: (value: string | undefined) => void;
  options: { id: string; label: string }[];
  emptyHint?: string;
}) {
  const id = React.useId();
  if (!options.length && !emptyHint) return null;

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-caption font-medium text-fg-secondary">
        {label}
      </label>
      {options.length === 0 ? (
        <p className="text-caption text-fg-muted">{emptyHint}</p>
      ) : (
        <Select value={value ?? "__all"} onValueChange={(next) => onChange(next === "__all" ? undefined : next)}>
          <SelectTrigger id={id} className="w-full">
            <SelectValue placeholder="Todas" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__all">Todas</SelectItem>
            {options.map((option) => (
              <SelectItem key={option.id} value={option.id}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </div>
  );
}
