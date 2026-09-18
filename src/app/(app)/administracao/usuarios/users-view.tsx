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
  UserCheck,
  UserMinus,
  UserX,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { SearchField } from "@/components/ui/search-field";
import { FilterBar, FilterGroup, FilterChip, FilterBarClear } from "@/components/ui/filter-bar";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/ui/status-badge";
import { KpiCard } from "@/components/ui/kpi-card";
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
import type { DirectoryFilters, DirectoryOptions, DirectoryPage, DirectoryStats, SortKey } from "@/lib/admin/queries";
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
/* View                                                                       */
/* -------------------------------------------------------------------------- */

export interface UsersViewProps {
  page: DirectoryPage;
  options: DirectoryOptions;
  stats: DirectoryStats;
  filters: DirectoryFilters;
  permissions: string[];
  isPlatformAdmin: boolean;
}

export function UsersView({ page, options, stats, filters, permissions, isPlatformAdmin }: UsersViewProps) {
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
      filters.profile && { key: "profile", label: "Perfil", value: labelOf(options.profiles, filters.profile) },
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
        filters={
          <FilterBar>
            <SearchField
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              onClear={() => setSearch("")}
              placeholder="Buscar por nome, matrícula ou e-mail"
              aria-label="Buscar colaboradores"
              className="w-full sm:w-72"
            />

            <FilterSelect
              label="Situação"
              value={filters.status}
              onChange={(value) => apply({ status: value })}
              options={Object.entries(EMPLOYMENT_STATUS_LABELS).map(([id, label]) => ({ id, label }))}
            />
            <FilterSelect label="Área" value={filters.area} onChange={(value) => apply({ area: value })} options={options.areas} />
            <FilterSelect
              label="Operação"
              value={filters.operation}
              onChange={(value) => apply({ operation: value })}
              options={options.operations}
            />
            <FilterSelect
              label="Perfil"
              value={filters.profile}
              onChange={(value) => apply({ profile: value })}
              options={options.profiles}
            />
            <FilterSelect
              label="Localidade"
              value={filters.location}
              onChange={(value) => apply({ location: value })}
              options={options.locations}
              className="hidden xl:inline-flex"
            />
            <FilterSelect
              label="Filial"
              value={filters.unit}
              onChange={(value) => apply({ unit: value })}
              options={options.units}
              className="hidden xl:inline-flex"
            />
            <FilterSelect
              label="Líder"
              value={filters.manager}
              onChange={(value) => apply({ manager: value })}
              options={options.managers}
              className="hidden 2xl:inline-flex"
            />
            <FilterSelect
              label="Acesso"
              value={filters.access}
              onChange={(value) => apply({ access: value })}
              options={Object.entries(ACCESS_STATUS_LABELS)
                .filter(([id]) => id !== "removed")
                .map(([id, label]) => ({ id, label }))}
            />

            {can("users.archive") ? (
              <FilterGroup label="Inativos">
                <Checkbox
                  checked={Boolean(filters.archived)}
                  onCheckedChange={(checked) => apply({ archived: checked ? "1" : undefined })}
                  aria-label="Exibir cadastros inativos"
                />
              </FilterGroup>
            ) : null}
          </FilterBar>
        }
      />

      <div className="flex min-h-0 flex-1 flex-col gap-4 px-4 pb-6 sm:px-6">
        {/* Compact indicators: four numbers, not four posters. */}
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <KpiCard size="compact" label="Colaboradores" value={stats.total} icon={<UsersIcon aria-hidden />} />
          <KpiCard size="compact" status="success" label="Com acesso ao HFM" value={stats.withAccess} icon={<UserCheck aria-hidden />} />
          <KpiCard size="compact" label="Sem acesso" value={stats.withoutAccess} icon={<UserMinus aria-hidden />} />
          <KpiCard
            size="compact"
            status={stats.suspended > 0 ? "warning" : "neutral"}
            label="Acessos suspensos"
            value={stats.suspended}
            period={stats.pending > 0 ? `${stats.pending} convite(s) pendente(s)` : undefined}
            icon={<UserX aria-hidden />}
          />
        </div>

        {activeFilters.length > 0 ? (
          <div className="flex flex-wrap items-center gap-2">
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

        {selected.size > 0 ? (
          <div className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-surface-secondary px-3 py-2">
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
            {/* Desktop: the full table. Below lg the same rows become cards. */}
            <TableContainer stickyHeader maxHeight={620} className="hidden lg:block">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10">
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
                    <TableHead sortable sortDirection={sortDirection("full_name")} onSort={onSort("full_name")}>
                      Nome
                    </TableHead>
                    <TableHead sortable sortDirection={sortDirection("employee_code")} onSort={onSort("employee_code")}>
                      Matrícula
                    </TableHead>
                    <TableHead sortable sortDirection={sortDirection("employment_status")} onSort={onSort("employment_status")}>
                      Situação
                    </TableHead>
                    <TableHead sortable sortDirection={sortDirection("job_position_name")} onSort={onSort("job_position_name")}>
                      Cargo
                    </TableHead>
                    <TableHead className="hidden xl:table-cell">Área</TableHead>
                    <TableHead sortable sortDirection={sortDirection("operation_name")} onSort={onSort("operation_name")}>
                      Operação
                    </TableHead>
                    <TableHead className="hidden 2xl:table-cell">Perfil organizacional</TableHead>
                    <TableHead className="hidden xl:table-cell">Localidade</TableHead>
                    <TableHead className="hidden 2xl:table-cell">Filial</TableHead>
                    <TableHead className="hidden 2xl:table-cell">Líder</TableHead>
                    <TableHead sortable sortDirection={sortDirection("access_status")} onSort={onSort("access_status")}>
                      Acesso HFM
                    </TableHead>
                    <TableHead className="hidden xl:table-cell">Perfil de acesso</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {page.rows.length === 0 ? (
                    <TableEmpty colSpan={13} message="Nenhum colaborador encontrado com os filtros aplicados." />
                  ) : (
                    page.rows.map((row) => (
                      <TableRow
                        key={row.id}
                        onClick={() => row.id && setDetailId(row.id)}
                        className={cn("cursor-pointer", row.deleted_at && "opacity-70")}
                      >
                        <TableCell onClick={(event) => event.stopPropagation()}>
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
                        <TableCell className="font-medium text-fg">
                          {/* The row reacts to a click; this button is what keyboards and
                              screen readers use, so the record is never mouse-only. */}
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              if (row.id) setDetailId(row.id);
                            }}
                            className="block max-w-56 truncate rounded-xs text-left hfm-focus-ring hover:text-primary"
                          >
                            {row.full_name}
                          </button>
                          {row.corporate_email ? (
                            <span className="block max-w-56 truncate text-caption text-fg-muted">{row.corporate_email}</span>
                          ) : null}
                        </TableCell>
                        <TableCell numeric>{row.employee_code}</TableCell>
                        <TableCell>
                          <StatusBadge
                            status={EMPLOYMENT_TONE[(row.employment_status ?? "active") as keyof typeof EMPLOYMENT_TONE] ?? "neutral"}>{EMPLOYMENT_STATUS_LABELS[row.employment_status ?? ""] ?? row.employment_status ?? "—"}</StatusBadge>
                        </TableCell>
                        <TableCell>
                          <span className="block max-w-48 truncate">{row.job_position_name ?? "—"}</span>
                        </TableCell>
                        <TableCell className="hidden xl:table-cell">{row.employment_area_name ?? "—"}</TableCell>
                        <TableCell>{row.operation_name ?? "—"}</TableCell>
                        <TableCell className="hidden 2xl:table-cell">{row.business_profile_name ?? "—"}</TableCell>
                        <TableCell className="hidden xl:table-cell">{row.work_location_name ?? "—"}</TableCell>
                        <TableCell className="hidden 2xl:table-cell">{row.organization_unit_name ?? "—"}</TableCell>
                        <TableCell className="hidden 2xl:table-cell">
                          <span className="block max-w-40 truncate">{row.manager_name ?? "—"}</span>
                        </TableCell>
                        <TableCell>
                          <StatusBadge
                            status={ACCESS_TONE[(row.access_status ?? "none") as keyof typeof ACCESS_TONE] ?? "neutral"}>{ACCESS_STATUS_LABELS[row.access_status ?? "none"] ?? "—"}</StatusBadge>
                        </TableCell>
                        <TableCell className="hidden xl:table-cell">
                          {row.access_role_names?.length ? (
                            <span className="flex flex-wrap gap-1">
                              {row.access_role_names.slice(0, 2).map((name) => (
                                <Badge key={name} variant="neutral">
                                  {name}
                                </Badge>
                              ))}
                              {row.access_role_names.length > 2 ? (
                                <Badge variant="neutral">+{row.access_role_names.length - 2}</Badge>
                              ) : null}
                            </span>
                          ) : (
                            "—"
                          )}
                        </TableCell>
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
