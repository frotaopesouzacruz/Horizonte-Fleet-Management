"use client";

import * as React from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import {
  Archive,
  Download,
  FileSpreadsheet,
  KeyRound,
  Pause,
  Play,
  Plus,
  Upload,
  Users as UsersIcon,
  Columns3,
  SlidersHorizontal,
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
import { EMPLOYMENT_STATUS_LABELS, ACCESS_STATUS_LABELS } from "@/lib/admin/qlp";
import type { DirectoryFilters, DirectoryOptions, DirectoryPage, SortKey } from "@/lib/admin/queries";
import { bulkArchive, bulkSetAccessStatus } from "@/lib/admin/actions";
import { EmployeeDetailDrawer } from "./employee-detail-drawer";
import { EmployeeFormDrawer } from "./employee-form-drawer";
import { ImportDrawer } from "./import-drawer";

/* -------------------------------------------------------------------------- */
/* Presentation helpers                                                       */
/* -------------------------------------------------------------------------- */

/** Employment situation and HFM access use different scales on purpose. */
const EMPLOYMENT_TONE = {
  active: "success",
  on_leave: "warning",
  terminated: "neutral",
  inactive: "neutral",
} as const;

const ACCESS_TONE = {
  active: "success",
  invited: "pending",
  suspended: "warning",
  removed: "neutral",
  none: "neutral",
} as const;

export function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  const [year, month, day] = value.split("-");
  return year && month && day ? `${day}/${month}/${year}` : value;
}

/* -------------------------------------------------------------------------- */
/* Columns                                                                    */
/* -------------------------------------------------------------------------- */

type DirectoryRow = DirectoryPage["rows"][number];

interface UserColumn {
  key: string;
  label: string;
  /**
   * Floor width in px, chosen so the header reads in full. This is the whole
   * fix for "Matrí…", "Situa…" and "Acesso H…": a column is never allowed to
   * shrink below its own name, and when the sum exceeds the viewport the
   * container scrolls instead of the text disappearing.
   */
  width: number;
  sort?: SortKey;
  numeric?: boolean;
  /** Secondary field: available in the Colunas menu, off by default. */
  optional?: boolean;
  render: (row: DirectoryRow) => React.ReactNode;
}

const COLUMN_STORAGE_KEY = "hfm.usuarios.columns";

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
/* View                                                                       */
/* -------------------------------------------------------------------------- */

export interface UsersViewProps {
  page: DirectoryPage;
  options: DirectoryOptions;
  filters: DirectoryFilters;
  permissions: string[];
  isPlatformAdmin: boolean;
  /**
   * The indicator row, streamed by the route so a slow aggregate never holds
   * the table hostage and a failed one never takes the page with it.
   */
  overview: React.ReactNode;
}

export function UsersView({
  page,
  options,
  filters,
  permissions,
  isPlatformAdmin,
  overview,
}: UsersViewProps) {
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
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [detailId, setDetailId] = React.useState<string | null>(null);
  const [formOpen, setFormOpen] = React.useState(false);
  const [editId, setEditId] = React.useState<string | null>(null);
  const [importOpen, setImportOpen] = React.useState(false);

  // Adjusting state during render (React's documented pattern) rather than in an
  // effect: the search box follows the URL, and a new page of rows drops the
  // selection, without an extra commit in between.
  const [syncedQuery, setSyncedQuery] = React.useState(filters.q ?? "");
  if (syncedQuery !== (filters.q ?? "")) {
    setSyncedQuery(filters.q ?? "");
    setSearch(filters.q ?? "");
  }

  const [selectionSource, setSelectionSource] = React.useState(page.rows);
  if (selectionSource !== page.rows) {
    setSelectionSource(page.rows);
    setSelected(new Set());
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

  // Debounced so typing does not fire a query per keystroke.
  React.useEffect(() => {
    if ((filters.q ?? "") === search) return;
    const timer = setTimeout(() => apply({ q: search || undefined }), 350);
    return () => clearTimeout(timer);
  }, [search, filters.q, apply]);

  const activeFilters = React.useMemo(() => {
    const labelOf = (list: { id: string; label: string }[], id?: string) => list.find((o) => o.id === id)?.label;
    return [
      filters.status && { key: "status", label: "Situação", value: EMPLOYMENT_STATUS_LABELS[filters.status] ?? filters.status },
      filters.area && { key: "area", label: "Área", value: labelOf(options.areas, filters.area) },
      filters.operation && { key: "operation", label: "Operação", value: labelOf(options.operations, filters.operation) },
      filters.profile && {
        key: "profile",
        label: "Perfil organizacional",
        value: labelOf(options.profiles, filters.profile),
      },
      filters.location && { key: "location", label: "Localidade", value: labelOf(options.locations, filters.location) },
      filters.unit && { key: "unit", label: "Filial", value: labelOf(options.units, filters.unit) },
      filters.manager && { key: "manager", label: "Líder", value: labelOf(options.managers, filters.manager) },
      filters.access && { key: "access", label: "Acesso", value: ACCESS_STATUS_LABELS[filters.access] ?? filters.access },
      filters.archived && { key: "archived", label: "Exibindo", value: "Inativos" },
    ].filter(Boolean) as { key: string; label: string; value: string }[];
  }, [filters, options]);

  const exportHref = React.useCallback(
    (layout: "hfm" | "qlp" | "template", format: "xlsx" | "csv", sensitive = false) => {
      const params = new URLSearchParams(searchParams.toString());
      params.delete("page");
      params.delete("pageSize");
      params.set("layout", layout);
      params.set("format", format);
      if (sensitive) params.set("sensitive", "1");
      return `${pathname}/export?${params.toString()}`;
    },
    [pathname, searchParams],
  );

  const sortDirection = (key: SortKey) => (filters.sort === key ? (filters.dir ?? "asc") : null);
  const onSort = (key: SortKey) => (direction: "asc" | "desc") => apply({ sort: key, dir: direction });

  const allOnPageSelected = page.rows.length > 0 && page.rows.every((row) => row.id && selected.has(row.id));

  /* ----------------------------------------------------------- columns ---- */

  const columns = React.useMemo<UserColumn[]>(
    () => [
      {
        key: "full_name",
        label: "Nome",
        width: 280,
        sort: "full_name",
        render: (row) => (
          <>
            {/* The row reacts to a click; this button is what keyboards and
                screen readers use, so the record is never mouse-only. */}
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                if (row.id) setDetailId(row.id);
              }}
              title={row.full_name ?? undefined}
              className="block w-full truncate rounded-xs text-left font-medium text-fg hfm-focus-ring hover:text-primary"
            >
              {row.full_name}
            </button>
            {row.corporate_email ? (
              <span title={row.corporate_email} className="block truncate text-caption text-fg-muted">
                {row.corporate_email}
              </span>
            ) : null}
          </>
        ),
      },
      {
        key: "employee_code",
        label: "Matrícula",
        width: 116,
        sort: "employee_code",
        numeric: true,
        render: (row) => <span className="tabular-nums">{row.employee_code}</span>,
      },
      {
        key: "employment_status",
        label: "Situação",
        width: 120,
        sort: "employment_status",
        render: (row) => (
          <StatusBadge
            status={EMPLOYMENT_TONE[(row.employment_status ?? "active") as keyof typeof EMPLOYMENT_TONE] ?? "neutral"}
          >
            {EMPLOYMENT_STATUS_LABELS[row.employment_status ?? ""] ?? row.employment_status ?? "—"}
          </StatusBadge>
        ),
      },
      {
        key: "job_position_name",
        label: "Cargo",
        width: 200,
        sort: "job_position_name",
        render: (row) => <Cell value={row.job_position_name} />,
      },
      {
        key: "operation_name",
        label: "Operação",
        width: 180,
        sort: "operation_name",
        render: (row) => <Cell value={row.operation_name} />,
      },
      {
        key: "work_location_name",
        label: "Localidade",
        width: 160,
        render: (row) => <Cell value={row.work_location_name} />,
      },
      {
        key: "access_status",
        label: "Acesso HFM",
        width: 144,
        sort: "access_status",
        render: (row) => (
          <StatusBadge status={ACCESS_TONE[(row.access_status ?? "none") as keyof typeof ACCESS_TONE] ?? "neutral"}>
            {ACCESS_STATUS_LABELS[row.access_status ?? "none"] ?? "—"}
          </StatusBadge>
        ),
      },
      {
        key: "access_role_names",
        label: "Perfil de acesso",
        width: 190,
        render: (row) =>
          row.access_role_names?.length ? (
            <span className="flex flex-nowrap items-center gap-1 overflow-hidden">
              <Badge variant="neutral" className="max-w-36 truncate" title={row.access_role_names.join(", ")}>
                {row.access_role_names[0]}
              </Badge>
              {row.access_role_names.length > 1 ? (
                <Badge variant="neutral" title={row.access_role_names.join(", ")}>
                  +{row.access_role_names.length - 1}
                </Badge>
              ) : null}
            </span>
          ) : (
            <span className="text-fg-muted">—</span>
          ),
      },
      {
        key: "employment_area_name",
        label: "Área",
        width: 150,
        optional: true,
        render: (row) => <Cell value={row.employment_area_name} />,
      },
      {
        key: "business_profile_name",
        label: "Perfil organizacional",
        width: 190,
        optional: true,
        render: (row) => <Cell value={row.business_profile_name} />,
      },
      {
        key: "organization_unit_name",
        label: "Filial",
        width: 170,
        optional: true,
        render: (row) => <Cell value={row.organization_unit_name} />,
      },
      {
        key: "manager_name",
        label: "Líder",
        width: 200,
        optional: true,
        render: (row) => <Cell value={row.manager_name} />,
      },
    ],
    [],
  );

  // Eight columns by default, twelve available. Showing all twelve was what
  // forced every header into an ellipsis; the other four are one menu away and
  // all of them are in the detail drawer regardless.
  const defaultHidden = React.useMemo(
    () => columns.filter((column) => column.optional).map((column) => column.key),
    [columns],
  );
  const [hidden, toggleColumn] = usePersistedSet(COLUMN_STORAGE_KEY, defaultHidden);

  /** Filters that live behind "Mais filtros", so the button can say how many. */
  const advancedCount = [filters.area, filters.location, filters.unit, filters.manager, filters.archived].filter(
    Boolean,
  ).length;

  const overviewLabelId = React.useId();

  const visibleColumns = columns.filter((column) => !hidden.includes(column.key));
  // 44px for the selection column. The table refuses to render narrower than
  // the sum, which is what turns an unreadable squeeze into a scrollbar.
  const tableMinWidth = visibleColumns.reduce((sum, column) => sum + column.width, 44);


  async function runBulk(action: "suspend" | "reactivate" | "archive") {
    const ids = [...selected];
    if (!ids.length) return;

    const copy = {
      suspend: { title: "Suspender acesso", description: `O acesso ao HFM de ${ids.length} colaborador(es) será suspenso. O cadastro permanece ativo.`, confirmLabel: "Suspender" },
      reactivate: { title: "Reativar acesso", description: `O acesso ao HFM de ${ids.length} colaborador(es) será reativado.`, confirmLabel: "Reativar" },
      archive: { title: "Inativar cadastro", description: `${ids.length} colaborador(es) serão inativados e o acesso ao HFM será suspenso. Nenhum dado é excluído.`, confirmLabel: "Inativar" },
    }[action];

    const confirmed = await confirm({ ...copy, destructive: action !== "reactivate" });
    if (!confirmed) return;

    startTransition(async () => {
      const result =
        action === "archive"
          ? await bulkArchive(ids, true)
          : await bulkSetAccessStatus(ids, action === "suspend" ? "suspended" : "active");

      if (result.ok) {
        toast({ title: `${result.data?.applied ?? 0} registro(s) atualizados.`, variant: "success" });
        setSelected(new Set());
        router.refresh();
      } else {
        toast({ title: "Não foi possível concluir a ação", description: result.error, variant: "danger" });
      }
    });
  }

  const isEmpty = page.total === 0 && !activeFilters.length && !filters.q;

  return (
    <>
      <PageHeader
        title="Usuários"
        description="Gerencie colaboradores, acessos, perfis e operações."
        primaryAction={
          can("users.create") ? (
            <Button
              leadingIcon={<Plus />}
              onClick={() => {
                setEditId(null);
                setFormOpen(true);
              }}
            >
              Novo usuário
            </Button>
          ) : undefined
        }
        secondaryActions={
          <>
            {can("users.import") ? (
              <Button variant="secondary" leadingIcon={<Upload />} onClick={() => setImportOpen(true)}>
                Importar
              </Button>
            ) : null}
            {can("users.export") ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="secondary" leadingIcon={<Download />}>
                    Exportar
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="min-w-64">
                  <DropdownMenuLabel>Exportar {page.total} registro(s) com os filtros atuais</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem asChild>
                    <a href={exportHref("hfm", "xlsx")} download>
                      <FileSpreadsheet aria-hidden /> Base HFM (XLSX)
                    </a>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <a href={exportHref("hfm", "csv")} download>
                      <FileSpreadsheet aria-hidden /> Base HFM (CSV)
                    </a>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <a href={exportHref("qlp", "xlsx")} download>
                      <FileSpreadsheet aria-hidden /> Formato QLP (19 colunas)
                    </a>
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem asChild>
                    <a href={exportHref("template", "xlsx")} download>
                      <Download aria-hidden /> Modelo de importação
                    </a>
                  </DropdownMenuItem>
                  {can("users.export_sensitive") ? (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        onSelect={async (event) => {
                          event.preventDefault();
                          const confirmed = await confirm({
                            title: "Exportar dados pessoais",
                            description:
                              "O arquivo incluirá CPF, data de nascimento e dados de CNH. A exportação é registrada na auditoria.",
                            confirmLabel: "Exportar",
                            destructive: true,
                          });
                          if (confirmed) window.location.href = exportHref("hfm", "xlsx", true);
                        }}
                      >
                        <KeyRound aria-hidden /> Incluir dados pessoais…
                      </DropdownMenuItem>
                    </>
                  ) : null}
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}
          </>
        }
      />

      <div className="flex min-h-0 flex-1 flex-col px-4 pb-6 sm:px-6">
      {/* Cabeçalho → busca: 24px. Quem chega nesta tela quase sempre chega
          procurando uma pessoa, então a busca abre o conteúdo sozinha, numa
          largura em que o próprio texto de ajuda cabe inteiro — o campo cresce
          para caber a frase, a frase nunca encolhe para caber no campo. */}
      <div className="flex flex-wrap items-center gap-2 pt-6">
        <SearchField
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          onClear={() => setSearch("")}
          placeholder="Buscar por nome, matrícula ou e-mail"
          aria-label="Buscar colaboradores"
          // The width belongs on the wrapper: the component's own is `w-full`,
          // and a class on the input alone leaves the field claiming the whole
          // row. 400px is chosen so the placeholder fits without shrinking.
          wrapperClassName="w-full sm:w-100"
        />

        {/* Shaping the table is not filtering it, and the control was spilling
            onto a line of its own anyway. It sits at the far end of the search
            row, where the row had space to spare. */}
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
                        // The menu is a set of toggles, so it stays open while
                        // the table is being shaped.
                        onSelect={(event) => {
                          event.preventDefault();
                          toggleColumn(column.key);
                        }}
                        // "Nome" is the row's identity and its keyboard handle;
                        // a table of anonymous rows is not a view anyone wants.
                        disabled={column.key === "full_name"}
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

      {/* Busca → filtros: 10px. Os filtros continuam os mesmos, validados pelo
          Product Owner; o que muda é que deixam de disputar a mesma linha. */}
      <FilterBar
        className="mt-2.5 py-0"
        label="Filtros de colaboradores"
      >
          {/* Four filters carry almost every real query. The remaining four
              used to sit on the same line and squeezed all eight into
              unreadable stubs. */}
          <FilterSelect
            label="Situação"
            value={filters.status}
            onChange={(value) => apply({ status: value })}
            options={Object.entries(EMPLOYMENT_STATUS_LABELS).map(([id, label]) => ({ id, label }))}
          />
          <FilterSelect
            label="Operação"
            value={filters.operation}
            onChange={(value) => apply({ operation: value })}
            options={options.operations}
          />
          {/* "Perfil" on its own is now ambiguous: this is the organizational
              profile that comes from the corporate base, and the HFM access
              profile is a different thing entirely. Same filter, same field,
              same behaviour — only the label stops conflating the two. */}
          <FilterSelect
            label="Perfil organizacional"
            value={filters.profile}
            onChange={(value) => apply({ profile: value })}
            options={options.profiles}
          />
          <FilterSelect
            label="Acesso"
            value={filters.access}
            onChange={(value) => apply({ access: value })}
            options={Object.entries(ACCESS_STATUS_LABELS)
              .filter(([id]) => id !== "removed")
              .map(([id, label]) => ({ id, label }))}
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
                  label="Área"
                  value={filters.area}
                  onChange={(value) => apply({ area: value })}
                  options={options.areas}
                />
                <StackedFilter
                  label="Localidade"
                  value={filters.location}
                  onChange={(value) => apply({ location: value })}
                  options={options.locations}
                />
                <StackedFilter
                  label="Filial"
                  value={filters.unit}
                  onChange={(value) => apply({ unit: value })}
                  options={options.units}
                />
                <StackedFilter
                  label="Líder"
                  value={filters.manager}
                  onChange={(value) => apply({ manager: value })}
                  options={options.managers}
                />
                {can("users.archive") ? (
                  <label className="flex items-center gap-2 border-t border-border-subtle pt-3 text-body-sm text-fg-secondary">
                    <Checkbox
                      checked={Boolean(filters.archived)}
                      onCheckedChange={(checked) => apply({ archived: checked ? "1" : undefined })}
                    />
                    Exibir cadastros inativos
                  </label>
                ) : null}
              </div>
            </PopoverContent>
          </Popover>
      </FilterBar>

        {/* Os chips pertencem aos filtros, não aos indicadores: ficam
            imediatamente abaixo deles, onde foram criados. */}
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

        {/* Filtros → indicadores: 24px.

            A mudança de assunto é deliberada: a tela respondia "quem tem acesso
            ao HFM" e passa a responder "quantas pessoas existem, onde estão,
            quantas estão ativas e quantas têm liderança definida". O estado do
            acesso continua no filtro, na coluna e no detalhe de cada pessoa —
            e como segunda linha do primeiro cartão. Só deixou de ser a primeira
            pergunta da página.

            Os cartões seguem os filtros estruturais e ignoram a busca: recontar
            a organização a cada tecla digitada faria os números piscarem sem
            informar nada. */}
        <section className="mt-6 flex flex-col gap-3" aria-labelledby={overviewLabelId}>
          <h2 id={overviewLabelId} className="text-body-sm font-semibold text-fg-secondary">
            Visão geral
          </h2>

          {overview}
        </section>

        {selected.size > 0 ? (
          <div className="mt-4 flex flex-wrap items-center gap-2 rounded-md border border-border bg-surface-secondary px-3 py-2">
            <span className="text-body-sm font-medium text-fg">{selected.size} selecionado(s)</span>
            <span aria-hidden className="h-4 w-px bg-border" />
            {can("users.bulk_manage") && can("users.manage_access") ? (
              <>
                <Button size="sm" variant="ghost" leadingIcon={<Pause />} onClick={() => runBulk("suspend")} disabled={pending}>
                  Suspender acesso
                </Button>
                <Button size="sm" variant="ghost" leadingIcon={<Play />} onClick={() => runBulk("reactivate")} disabled={pending}>
                  Reativar acesso
                </Button>
              </>
            ) : null}
            {can("users.bulk_manage") && can("users.archive") ? (
              <Button size="sm" variant="ghost" leadingIcon={<Archive />} onClick={() => runBulk("archive")} disabled={pending}>
                Inativar cadastro
              </Button>
            ) : null}
            <Button size="sm" variant="ghost" className="ml-auto" onClick={() => setSelected(new Set())}>
              Limpar seleção
            </Button>
          </div>
        ) : null}

        {/* Indicadores → tabela: 24px. */}
        <div className="mt-6 flex min-h-0 flex-1 flex-col gap-4">
          {isEmpty ? (
            <EmptyState
              icon={<UsersIcon />}
              title="Nenhum usuário cadastrado"
              description="Cadastre manualmente ou importe sua base de colaboradores."
              action={
                can("users.create") ? (
                  <Button leadingIcon={<Plus />} onClick={() => { setEditId(null); setFormOpen(true); }}>
                    Novo usuário
                  </Button>
                ) : undefined
              }
              secondaryAction={
                can("users.import") ? (
                  <Button variant="secondary" leadingIcon={<Upload />} onClick={() => setImportOpen(true)}>
                    Importar base
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <>
              {/* Desktop: the full table. Below lg the same rows become cards.
                  The table is never squeezed below the sum of its columns — it
                  scrolls sideways instead, which keeps every header readable. */}
              <TableContainer stickyHeader maxHeight="calc(100dvh - 22rem)" className="hidden lg:block">
                <Table layout="fixed" style={{ minWidth: tableMinWidth }}>
                  <TableHeader>
                    <TableRow>
                      <TableHead style={{ width: 44, zIndex: 21 }} className="sticky left-0 bg-surface-secondary">
                        <Checkbox
                          checked={allOnPageSelected}
                          onCheckedChange={(checked) =>
                            setSelected(
                              checked
                                ? new Set(page.rows.map((row) => row.id).filter((id): id is string => Boolean(id)))
                                : new Set(),
                            )
                          }
                          aria-label="Selecionar todos os registros desta página"
                        />
                      </TableHead>
                      {visibleColumns.map((column, index) => (
                        <TableHead
                          key={column.key}
                          style={{
                            width: column.width,
                            left: index === 0 ? 44 : undefined,
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
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {page.rows.length === 0 ? (
                      <TableEmpty
                        colSpan={visibleColumns.length + 1}
                        message="Nenhum colaborador encontrado com os filtros aplicados."
                      />
                    ) : (
                      page.rows.map((row) => (
                        <TableRow
                          key={row.id}
                          onClick={() => row.id && setDetailId(row.id)}
                          className={cn("h-(--table-row-height) cursor-pointer", row.deleted_at && "opacity-70")}
                        >
                          <TableCell onClick={(event) => event.stopPropagation()} style={{ zIndex: 1 }} className="sticky left-0 bg-inherit">
                            <Checkbox
                              checked={Boolean(row.id && selected.has(row.id))}
                              onCheckedChange={(checked) =>
                                setSelected((current) => {
                                  const next = new Set(current);
                                  if (!row.id) return next;
                                  if (checked) next.add(row.id);
                                  else next.delete(row.id);
                                  return next;
                                })
                              }
                              aria-label={`Selecionar ${row.full_name}`}
                            />
                          </TableCell>
                          {visibleColumns.map((column, index) => (
                            <TableCell
                              key={column.key}
                              numeric={column.numeric}
                              style={{ left: index === 0 ? 44 : undefined, zIndex: index === 0 ? 1 : undefined }}
                              className={cn(index === 0 && "sticky border-r border-border bg-inherit")}
                            >
                              {column.render(row)}
                            </TableCell>
                          ))}
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </TableContainer>

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
                          <span className="block truncate text-body-sm font-semibold text-fg">{row.full_name}</span>
                          <span className="block truncate text-caption text-fg-muted">
                            {row.employee_code} · {row.job_position_name ?? "Sem cargo"}
                          </span>
                        </span>
                        <StatusBadge
                          status={EMPLOYMENT_TONE[(row.employment_status ?? "active") as keyof typeof EMPLOYMENT_TONE] ?? "neutral"}>{EMPLOYMENT_STATUS_LABELS[row.employment_status ?? ""] ?? "—"}</StatusBadge>
                      </span>
                      <span className="flex flex-wrap items-center gap-1.5 text-caption text-fg-secondary">
                        {row.operation_name ? <Badge variant="neutral">{row.operation_name}</Badge> : null}
                        {row.work_location_name ? <Badge variant="neutral">{row.work_location_name}</Badge> : null}
                        <StatusBadge
                          status={ACCESS_TONE[(row.access_status ?? "none") as keyof typeof ACCESS_TONE] ?? "neutral"}>{ACCESS_STATUS_LABELS[row.access_status ?? "none"] ?? "—"}</StatusBadge>
                      </span>
                    </button>
                  </li>
                ))}
                {page.rows.length === 0 ? (
                  <li className="rounded-md border border-border bg-surface p-6 text-center text-body-sm text-fg-muted">
                    Nenhum colaborador encontrado com os filtros aplicados.
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

      <EmployeeDetailDrawer
        employeeId={detailId}
        options={options}
        onClose={() => setDetailId(null)}
        onEdit={(id) => {
          setDetailId(null);
          setEditId(id);
          setFormOpen(true);
        }}
      />

      <EmployeeFormDrawer
        open={formOpen}
        employeeId={editId}
        options={options}
        permissions={permissions}
        isPlatformAdmin={isPlatformAdmin}
        onOpenChange={(open) => {
          setFormOpen(open);
          if (!open) setEditId(null);
        }}
      />

      <ImportDrawer open={importOpen} onOpenChange={setImportOpen} />
    </>
  );
}

/* -------------------------------------------------------------------------- */

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
    <FilterGroup label={label} htmlFor={id} className={className}>
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
 * A filter in the advanced popover: label above the control, full width. The
 * inline variant used in the toolbar puts the label beside a 160px select,
 * which is exactly the shape that stopped fitting once there were eight of them.
 */
function StackedFilter({
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
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-caption font-medium text-fg-secondary">
        {label}
      </label>
      <Select value={value ?? "__all"} onValueChange={(next) => onChange(next === "__all" ? undefined : next)}>
        <SelectTrigger id={id} className="w-full">
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
