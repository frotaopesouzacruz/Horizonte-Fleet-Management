"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Building2, Download, MapPin, Network, Pencil, Plus, Power, Truck, Upload, Users, X } from "lucide-react";
import { PageContent, PageHeader } from "@/components/layout/page-header";
import { Button, IconButton } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { KpiCard } from "@/components/ui/kpi-card";
import { FilterBar } from "@/components/ui/filter-bar";
import { SearchField } from "@/components/ui/search-field";
import { StatusBadge } from "@/components/ui/status-badge";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Table, TableBody, TableCell, TableContainer, TableEmpty, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { useToast } from "@/components/feedback/toast";
import { useConfirm } from "@/components/feedback/confirm-dialog";
import { NativeSelect } from "@/components/governance/selects";
import { loadBranchImpact, setBranchStatus } from "@/lib/branches/actions";
import type { BranchFilters, BranchOperationRow, BranchRow, BranchSummary } from "@/lib/branches/queries";
import { formatAddress, formatCnpj } from "@/lib/branches/format";
import type { BranchExportKind } from "@/lib/branches/import-columns";
import { BranchFormDrawer, type BranchFormValue } from "./branch-form-drawer";
import { BranchImportDrawer, type BranchImportLoaders } from "./branch-import-drawer";
import { BranchExportDialog } from "./branch-export-dialog";
import type { BranchCostCenterLoaders } from "./branch-cost-centers-tab";

const number = new Intl.NumberFormat("pt-BR");

function formatDateTime(value: string | null): string {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

export interface BranchesViewProps {
  rows: BranchRow[];
  links: BranchOperationRow[];
  summary: BranchSummary | null;
  filters: BranchFilters;
  operations: { id: string; code: string | null; name: string; status: string }[];
  locations: { stateId: number; uf: string; cityId: number; cityName: string }[];
  states: { id: number; uf: string; name: string }[];
  canCreate: boolean;
  canUpdate: boolean;
  canDeactivate: boolean;
  canManageOperations: boolean;
  canViewEmployees: boolean;
  canViewVehicles: boolean;
  canViewAudit: boolean;
  /** §58: importar pelo fluxo validado (`branches.import`). */
  canImport?: boolean;
  /** §61: exportar (`branches.export`); também liga a seleção de linhas. */
  canExport?: boolean;
  /** §38: ler (`cost_centers.view`) e associar (`branches.update` + `cost_centers.manage`). */
  canViewCostCenters?: boolean;
  canManageCostCenters?: boolean;
  /** Prévia de desenvolvimento: dados fixos no lugar das server actions. */
  importLoaders?: BranchImportLoaders;
  costCenterLoaders?: BranchCostCenterLoaders;
  exportPath?: string;
  /** Rota da própria tela, para os filtros navegarem no lugar certo. */
  basePath?: string;
}

/**
 * Estrutura Operacional → Filiais.
 *
 * A filial é a unidade que responde pelos colaboradores e pela frota. Ela não é
 * a operação — uma filial atende várias operações e uma operação é atendida por
 * várias filiais — e o seu endereço não é a cobertura geográfica de nenhuma
 * delas. As três distinções vivem nesta tela e é por isso que a coluna de
 * localização diz "endereço" e a de operações diz "operações".
 */
export function BranchesView({
  rows,
  links,
  summary,
  filters,
  operations,
  locations,
  states,
  canCreate,
  canUpdate,
  canDeactivate,
  canManageOperations,
  canViewEmployees,
  canViewVehicles,
  canViewAudit,
  canImport = false,
  canExport = false,
  canViewCostCenters = false,
  canManageCostCenters = false,
  importLoaders,
  costCenterLoaders,
  exportPath = "/estrutura/filiais/export",
  basePath = "/estrutura/filiais",
}: BranchesViewProps) {
  const router = useRouter();
  const params = useSearchParams();
  const { toast } = useToast();
  const confirm = useConfirm();
  const [pending, startTransition] = React.useTransition();
  const [formOpen, setFormOpen] = React.useState(false);
  const [formKey, setFormKey] = React.useState(0);
  const [editing, setEditing] = React.useState<BranchFormValue | undefined>();
  const [search, setSearch] = React.useState(filters.q ?? "");
  const [importOpen, setImportOpen] = React.useState(false);
  const [exportOpen, setExportOpen] = React.useState(false);
  const [exportKind, setExportKind] = React.useState<BranchExportKind | undefined>();
  // A seleção só existe para exportar (§61). Guarda ids; o que conta é o que
  // ainda está na lista — trocar o filtro não exporta linhas que sumiram.
  const [selected, setSelected] = React.useState<Set<string>>(() => new Set());
  const selectedRows = React.useMemo(() => rows.filter((r) => selected.has(r.id)), [rows, selected]);
  const allSelected = rows.length > 0 && selectedRows.length === rows.length;
  const someSelected = selectedRows.length > 0 && !allSelected;

  const toggleRow = (id: string, checked: boolean) =>
    setSelected((current) => {
      const next = new Set(current);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  const toggleAll = (checked: boolean) => setSelected(checked ? new Set(rows.map((r) => r.id)) : new Set());

  const hasFilters = Boolean(
    filters.q || filters.status || filters.operationId || filters.stateId || filters.cityId ||
    filters.withVehicles || filters.withEmployees,
  );
  const openExport = (kind?: BranchExportKind) => {
    setExportKind(kind);
    setExportOpen(true);
  };

  const navigate = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params.toString());
    for (const [key, value] of Object.entries(patch)) {
      if (value === null || value === "") next.delete(key);
      else next.set(key, value);
    }
    startTransition(() => router.push(`${basePath}?${next.toString()}`, { scroll: false }));
  };

  const citiesOfState = React.useMemo(
    () =>
      filters.stateId
        ? locations.filter((l) => l.stateId === Number(filters.stateId))
        : locations,
    [locations, filters.stateId],
  );

  const statesWithBranches = React.useMemo(() => {
    const seen = new Map<number, string>();
    for (const l of locations) seen.set(l.stateId, l.uf);
    return [...seen.entries()].map(([id, uf]) => ({ id, uf })).sort((a, b) => a.uf.localeCompare(b.uf));
  }, [locations]);

  const linksOf = (branchId: string) => links.filter((l) => l.organizationUnitId === branchId);

  const openNew = () => {
    setEditing(undefined);
    setFormKey((k) => k + 1);
    setFormOpen(true);
  };

  const openEdit = (branch: BranchRow) => {
    setEditing({
      id: branch.id,
      code: branch.code ?? "",
      name: branch.name,
      legalName: branch.legalName,
      documentNumber: branch.documentNumber,
      status: branch.status,
      notes: branch.notes,
      postalCode: branch.postalCode,
      street: branch.street,
      streetNumber: branch.streetNumber,
      complement: branch.complement,
      district: branch.district,
      stateId: branch.stateId,
      cityId: branch.cityId,
      operations: linksOf(branch.id).filter((l) => l.isCurrent).map((l) => l.operationId),
      updatedAt: branch.updatedAt,
    });
    setFormKey((k) => k + 1);
    setFormOpen(true);
  };

  const toggleStatus = async (branch: BranchRow) => {
    const next = branch.status === "active" ? "inactive" : "active";

    if (next === "inactive") {
      // §51: dependências reais, contadas das tabelas. Nada de contador fictício.
      const impact = await loadBranchImpact(branch.id);
      const d = impact.ok ? impact.data : null;
      const lines = d
        ? `Hoje ela tem ${d.activeEmployees} colaborador(es) ativo(s), ${d.activeVehicles} veículo(s) ativo(s), ${d.currentOperations} operação(ões) vinculada(s) e ${d.costCenters} centro(s) de custo.`
        : "Não foi possível calcular as dependências agora.";

      const confirmed = await confirm({
        title: `Inativar ${branch.name}?`,
        description: `${lines} Nada é apagado: colaboradores, veículos, operações e histórico continuam como estão. A filial deixa de aparecer em novos vínculos e segue disponível para consulta.`,
        confirmLabel: "Inativar",
        destructive: true,
      });
      if (!confirmed) return;
    }

    startTransition(async () => {
      const result = await setBranchStatus(branch.id, next, null);
      if (result.ok) {
        toast({ title: next === "inactive" ? "Filial inativada." : "Filial reativada.", variant: "success" });
        router.refresh();
      } else {
        toast({ title: result.error ?? "Não foi possível alterar a situação.", variant: "danger" });
      }
    });
  };

  return (
    <>
      <PageHeader
        title="Filiais"
        description="Gerencie as unidades organizacionais e seus vínculos com operações, colaboradores e frotas."
        primaryAction={
          canCreate ? (
            <Button leadingIcon={<Plus />} onClick={openNew}>
              Nova filial
            </Button>
          ) : undefined
        }
        secondaryActions={
          canExport || canImport ? (
            <>
              {canExport ? (
                <Button variant="secondary" leadingIcon={<Download />} onClick={() => openExport()}>
                  Exportar
                </Button>
              ) : null}
              {canImport ? (
                <Button variant="secondary" leadingIcon={<Upload />} onClick={() => setImportOpen(true)}>
                  Importar
                </Button>
              ) : null}
            </>
          ) : undefined
        }
        filters={
          <FilterBar className="flex-wrap items-end gap-3">
            <div className="flex min-w-[18rem] flex-1 flex-col gap-1">
              <span className="text-caption text-fg-muted">Buscar</span>
              <SearchField
                value={search}
                placeholder="Código interno, nome da filial, razão social ou CNPJ"
                aria-label="Buscar filial"
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") navigate({ q: search || null });
                }}
              />
            </div>

            <div className="flex flex-col gap-1">
              <span className="text-caption text-fg-muted">Situação</span>
              <NativeSelect
                fieldSize="sm"
                aria-label="Filtrar por situação"
                value={filters.status ?? ""}
                onChange={(e) => navigate({ situacao: e.target.value || null })}
                className="min-w-[8rem]"
              >
                <option value="">Todas</option>
                <option value="active">Ativas</option>
                <option value="inactive">Inativas</option>
              </NativeSelect>
            </div>

            <div className="flex flex-col gap-1">
              <span className="text-caption text-fg-muted">Operação</span>
              <NativeSelect
                fieldSize="sm"
                aria-label="Filtrar por operação vinculada"
                value={filters.operationId ?? ""}
                onChange={(e) => navigate({ operacao: e.target.value || null })}
                className="min-w-[12rem]"
              >
                <option value="">Todas</option>
                {operations.map((o) => (
                  <option key={o.id} value={o.id}>{o.name}</option>
                ))}
              </NativeSelect>
            </div>

            <div className="flex flex-col gap-1">
              <span className="text-caption text-fg-muted">Estado da filial</span>
              <NativeSelect
                fieldSize="sm"
                aria-label="Filtrar pelo estado do endereço da filial"
                value={filters.stateId ?? ""}
                onChange={(e) => navigate({ uf: e.target.value || null, cidade: null })}
                className="min-w-[7rem]"
              >
                <option value="">Todos</option>
                {statesWithBranches.map((s) => (
                  <option key={s.id} value={s.id}>{s.uf}</option>
                ))}
              </NativeSelect>
            </div>

            <div className="flex flex-col gap-1">
              <span className="text-caption text-fg-muted">Cidade da filial</span>
              <NativeSelect
                fieldSize="sm"
                aria-label="Filtrar pela cidade do endereço da filial"
                value={filters.cityId ?? ""}
                onChange={(e) => navigate({ cidade: e.target.value || null })}
                className="min-w-[11rem]"
              >
                <option value="">Todas</option>
                {citiesOfState.map((c) => (
                  <option key={c.cityId} value={c.cityId}>{c.cityName}</option>
                ))}
              </NativeSelect>
            </div>

            <div className="flex flex-col gap-1">
              <span className="text-caption text-fg-muted">Frota</span>
              <NativeSelect
                fieldSize="sm"
                aria-label="Filtrar por presença de veículos"
                value={filters.withVehicles ?? ""}
                onChange={(e) => navigate({ frota: e.target.value || null })}
                className="min-w-[9rem]"
              >
                <option value="">Todas</option>
                <option value="yes">Com veículos</option>
                <option value="no">Sem veículos</option>
              </NativeSelect>
            </div>
          </FilterBar>
        }
      />

      <PageContent className="flex flex-col gap-5">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          <KpiCard label="Filiais" value={number.format(summary?.totalBranches ?? rows.length)} icon={<Building2 />} />
          <KpiCard label="Ativas" value={number.format(summary?.activeBranches ?? 0)} />
          <KpiCard
            label="Inativas"
            value={number.format(summary?.inactiveBranches ?? 0)}
            status={(summary?.inactiveBranches ?? 0) > 0 ? "warning" : undefined}
          />
          <KpiCard label="Operações vinculadas" value={number.format(summary?.linkedOperations ?? 0)} icon={<Network />} />
          <KpiCard label="Colaboradores" value={number.format(summary?.linkedEmployees ?? 0)} icon={<Users />} />
          <KpiCard label="Veículos" value={number.format(summary?.linkedVehicles ?? 0)} icon={<Truck />} />
        </div>

        {canExport && selectedRows.length > 0 ? (
          <div
            role="region"
            aria-label="Filiais selecionadas"
            className="flex flex-wrap items-center gap-2 rounded-md border border-primary/40 bg-primary-soft px-3 py-2 text-body-sm text-primary-soft-fg"
          >
            <span className="font-medium">{number.format(selectedRows.length)} filial(is) selecionada(s)</span>
            <span className="flex-1" />
            <Button size="sm" variant="secondary" leadingIcon={<Download />} onClick={() => openExport("selecionadas")}>
              Exportar selecionadas
            </Button>
            <Button size="sm" variant="ghost" leadingIcon={<X />} onClick={() => setSelected(new Set())}>
              Limpar seleção
            </Button>
          </div>
        ) : null}

        <Card>
          <CardContent className="p-0">
            <TableContainer className="rounded-none border-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    {canExport ? (
                      <TableHead style={{ width: 32 }} className="pr-0">
                        <Checkbox
                          aria-label="Selecionar todas as filiais da lista"
                          checked={allSelected ? true : someSelected ? "indeterminate" : false}
                          disabled={rows.length === 0}
                          onCheckedChange={(v) => toggleAll(v === true)}
                        />
                      </TableHead>
                    ) : null}
                    <TableHead style={{ width: 110 }}>Código</TableHead>
                    <TableHead style={{ width: 220 }}>Filial</TableHead>
                    <TableHead style={{ width: 170 }}>CNPJ</TableHead>
                    <TableHead style={{ width: 240 }}>Localização</TableHead>
                    <TableHead numeric style={{ width: 110 }}>Operações</TableHead>
                    <TableHead numeric style={{ width: 130 }}>Colaboradores</TableHead>
                    <TableHead numeric style={{ width: 100 }}>Frotas</TableHead>
                    <TableHead style={{ width: 110 }}>Situação</TableHead>
                    <TableHead style={{ width: 130 }}>Atualizada em</TableHead>
                    <TableHead style={{ width: 96 }}>Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.length === 0 ? (
                    <TableEmpty
                      colSpan={canExport ? 11 : 10}
                      icon={<Building2 />}
                      message={
                        filters.q
                          ? "Nenhuma filial encontrada para esta busca."
                          : "Nenhuma filial cadastrada."
                      }
                    />
                  ) : (
                    rows.map((branch) => (
                      <TableRow
                        key={branch.id}
                        className="h-(--table-row-height)"
                        data-state={selected.has(branch.id) ? "selected" : undefined}
                      >
                        {canExport ? (
                          <TableCell className="pr-0">
                            <Checkbox
                              aria-label={`Selecionar ${branch.name}`}
                              checked={selected.has(branch.id)}
                              onCheckedChange={(v) => toggleRow(branch.id, v === true)}
                            />
                          </TableCell>
                        ) : null}
                        <TableCell className="font-mono text-caption text-fg-secondary">
                          {branch.code ?? "—"}
                        </TableCell>
                        <TableCell>
                          <span className="block truncate font-medium text-fg">{branch.name}</span>
                          {branch.legalName ? (
                            <span className="block truncate text-caption text-fg-muted" title={branch.legalName}>
                              {branch.legalName}
                            </span>
                          ) : null}
                        </TableCell>
                        <TableCell className="font-mono text-caption text-fg-secondary">
                          {formatCnpj(branch.documentNumber)}
                        </TableCell>
                        <TableCell>
                          <span
                            className="block truncate text-body-sm"
                            title={formatAddress({
                              street: branch.street,
                              streetNumber: branch.streetNumber,
                              district: branch.district,
                              cityName: branch.cityName,
                              stateUf: branch.stateUf,
                            })}
                          >
                            {branch.cityName ? `${branch.cityName}/${branch.stateUf}` : "Endereço não informado"}
                          </span>
                          {branch.street ? (
                            <span className="block truncate text-caption text-fg-muted">
                              {[branch.street, branch.streetNumber].filter(Boolean).join(", ")}
                            </span>
                          ) : null}
                        </TableCell>
                        <TableCell numeric>
                          {branch.operationCount === 0 ? (
                            <Badge variant="neutral" appearance="soft" size="sm">Sem vínculo</Badge>
                          ) : (
                            number.format(branch.operationCount)
                          )}
                        </TableCell>
                        <TableCell numeric>{number.format(branch.employeeCount)}</TableCell>
                        <TableCell numeric>{number.format(branch.vehicleCount)}</TableCell>
                        <TableCell>
                          <StatusBadge status={branch.status === "active" ? "success" : "neutral"}>
                            {branch.status === "active" ? "Ativa" : "Inativa"}
                          </StatusBadge>
                        </TableCell>
                        <TableCell className="text-body-sm text-fg-secondary">
                          {formatDateTime(branch.updatedAt)}
                        </TableCell>
                        <TableCell>
                          <div className="flex gap-1">
                            {canUpdate ? (
                              <IconButton
                                label={`Editar ${branch.name}`}
                                variant="ghost"
                                size="sm"
                                onClick={() => openEdit(branch)}
                              >
                                <Pencil />
                              </IconButton>
                            ) : null}
                            {canDeactivate ? (
                              <IconButton
                                label={branch.status === "active" ? `Inativar ${branch.name}` : `Reativar ${branch.name}`}
                                variant="ghost"
                                size="sm"
                                disabled={pending}
                                onClick={() => toggleStatus(branch)}
                              >
                                <Power />
                              </IconButton>
                            ) : null}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </TableContainer>
          </CardContent>
        </Card>

        <p className="flex items-start gap-2 text-caption text-fg-muted">
          <MapPin aria-hidden className="mt-0.5 size-3.5 shrink-0" />
          O estado e a cidade desta tela são o endereço físico da filial. A cobertura geográfica
          de cada operação é definida dentro da própria operação, e uma coisa não determina a outra.
        </p>
      </PageContent>

      <BranchFormDrawer
        key={`branch-${formKey}`}
        open={formOpen}
        onOpenChange={setFormOpen}
        value={editing}
        operations={operations}
        links={editing?.id ? linksOf(editing.id) : []}
        states={states}
        canManageOperations={canManageOperations}
        canViewEmployees={canViewEmployees}
        canViewVehicles={canViewVehicles}
        canViewAudit={canViewAudit}
        canViewCostCenters={canViewCostCenters}
        canManageCostCenters={canManageCostCenters}
        costCenterLoaders={costCenterLoaders}
      />

      {canImport ? (
        <BranchImportDrawer
          open={importOpen}
          onOpenChange={setImportOpen}
          loaders={importLoaders}
          exportPath={exportPath}
        />
      ) : null}

      {canExport ? (
        <BranchExportDialog
          key={exportOpen ? `export-${exportKind ?? "todas"}` : "export-closed"}
          open={exportOpen}
          onOpenChange={setExportOpen}
          filterQuery={params.toString()}
          hasFilters={hasFilters}
          filteredCount={rows.length}
          totalCount={summary?.totalBranches ?? rows.length}
          selectedIds={selectedRows.map((r) => r.id)}
          canExport={canExport}
          canImport={canImport}
          initialKind={exportKind}
          exportPath={exportPath}
        />
      ) : null}
    </>
  );
}
