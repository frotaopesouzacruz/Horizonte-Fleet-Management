"use client";

import * as React from "react";
import { ChevronDown, ChevronRight, ChevronsDownUp, ChevronsUpDown, ListTree, Table2, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { Alert, AlertDescription, AlertTitle } from "@/components/feedback/alert";
import { Button } from "@/components/ui/button";
import {
  Table, TableBody, TableCell, TableContainer, TableFooter, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { EmptyState } from "@/components/feedback/empty-state";
import { ErrorState } from "@/components/feedback/error-state";
import {
  formatDate,
  formatInt,
  vehicleLabel,
  type HierarchyRow,
  type MaintenanceCatalog,
  type MaintenanceFilters,
} from "@/lib/maintenance/types";
import { MaintenanceTable, SORT_LABEL } from "./maintenance-table";
import type { MaintenancePerms, MaintenanceViewData, Navigate, PanelActions } from "./shared";

/**
 * Base geral — todas as manutenções do recorte, em tabela paginada ou
 * agrupadas por Operação → Cidade (UF) → BR → Veículo. A hierarquia é só
 * agrupamento das linhas que o servidor já filtrou (pelo contexto histórico
 * gravado na manutenção); a tela soma contadores, não decide nada.
 */

export interface BasePanelProps {
  base: NonNullable<MaintenanceViewData["base"]>;
  filters: MaintenanceFilters;
  catalog: MaintenanceCatalog;
  perms: MaintenancePerms;
  actions: PanelActions;
}

type View = "tabela" | "hierarquia";

const VIEWS: { value: View; label: string; icon: React.ReactNode }[] = [
  { value: "tabela", label: "Tabela", icon: <Table2 /> },
  { value: "hierarquia", label: "Hierarquia", icon: <ListTree /> },
];

const LEVEL_LABEL = ["Operação", "Cidade", "BR", "Veículo"] as const;

// ---------------------------------------------------------------------------
// Árvore (montada no cliente, só agrupando)
// ---------------------------------------------------------------------------
interface TreeNode {
  key: string;
  level: 0 | 1 | 2 | 3;
  label: string;
  /** "Sem operação", "Sem BR"… vão para o fim do nível. */
  missing: boolean;
  total: number;
  open: number;
  inProgress: number;
  vehicleIds: Set<string>;
  lastReference: string | null;
  vehicleId?: string;
  children: Map<string, TreeNode>;
}

function node(map: Map<string, TreeNode>, key: string, level: TreeNode["level"], label: string, missing: boolean) {
  let n = map.get(key);
  if (!n) {
    n = { key, level, label, missing, total: 0, open: 0, inProgress: 0, vehicleIds: new Set(), lastReference: null, children: new Map() };
    map.set(key, n);
  }
  return n;
}

function brLabel(code: string | null) {
  if (!code) return "Sem BR";
  return /^br/i.test(code) ? code : `BR ${code}`;
}

function buildTree(rows: HierarchyRow[]): Map<string, TreeNode> {
  const roots = new Map<string, TreeNode>();
  for (const r of rows) {
    const op = node(roots, `o:${r.operationId ?? "-"}`, 0, r.operationName ?? "Sem operação", !r.operationId);
    const cityLabel = r.cityName
      ? `${r.cityName}${r.stateUf ? ` (${r.stateUf})` : ""}`
      : r.stateUf
        ? `Sem cidade (${r.stateUf})`
        : "Sem cidade";
    const city = node(op.children, `${op.key}|c:${r.cityId ?? `uf-${r.stateUf ?? "-"}`}`, 1, cityLabel, r.cityId == null);
    const br = node(city.children, `${city.key}|b:${r.brId ?? "-"}`, 2, brLabel(r.brCode), !r.brId);
    const vehicle = node(br.children, `${br.key}|v:${r.vehicleId}`, 3, vehicleLabel(r.licensePlate, r.fleetCode), false);
    vehicle.vehicleId = r.vehicleId;
    for (const n of [op, city, br, vehicle]) {
      n.total += r.total;
      n.open += r.open;
      n.inProgress += r.inProgress;
      n.vehicleIds.add(r.vehicleId);
      if (r.lastReference && (!n.lastReference || r.lastReference > n.lastReference)) n.lastReference = r.lastReference;
    }
  }
  return roots;
}

function sorted(map: Map<string, TreeNode>): TreeNode[] {
  return [...map.values()].sort(
    (a, b) =>
      Number(a.missing) - Number(b.missing) || b.total - a.total || a.label.localeCompare(b.label, "pt-BR"),
  );
}

function allGroupKeys(map: Map<string, TreeNode>, out: string[] = []): string[] {
  for (const n of map.values()) {
    if (n.level < 3) {
      out.push(n.key);
      allGroupKeys(n.children, out);
    }
  }
  return out;
}

function HierarchyView({ rows, navigate, pending }: { rows: HierarchyRow[]; navigate: Navigate; pending: boolean }) {
  const tree = React.useMemo(() => buildTree(rows), [rows]);
  // Sem escolha explícita, só as operações vêm abertas.
  const [openState, setOpenState] = React.useState<Record<string, boolean>>({});
  const isOpen = (n: TreeNode) => openState[n.key] ?? n.level === 0;
  const setAll = (value: boolean) =>
    setOpenState(Object.fromEntries(allGroupKeys(tree).map((k) => [k, value])));

  const totals = React.useMemo(() => {
    const vehicles = new Set<string>();
    let total = 0;
    let open = 0;
    let inProgress = 0;
    for (const r of rows) {
      vehicles.add(r.vehicleId);
      total += r.total;
      open += r.open;
      inProgress += r.inProgress;
    }
    return { vehicles: vehicles.size, total, open, inProgress, operations: tree.size };
  }, [rows, tree]);

  const visible: TreeNode[] = [];
  const walk = (map: Map<string, TreeNode>) => {
    for (const n of sorted(map)) {
      visible.push(n);
      if (n.level < 3 && isOpen(n)) walk(n.children);
    }
  };
  walk(tree);

  const widths = [300, 92, 120, 92, 112, 136, 168];
  const minWidth = widths.reduce((a, b) => a + b, 0);

  return (
    <div className="flex flex-col gap-3" data-testid="maintenance-hierarchy">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-caption text-fg-muted">
          {formatInt(totals.operations)} {totals.operations === 1 ? "operação" : "operações"} ·{" "}
          {formatInt(totals.vehicles)} {totals.vehicles === 1 ? "veículo" : "veículos"} · {formatInt(totals.total)} manutenções
          · agrupadas pelo contexto gravado em cada manutenção
        </p>
        <div className="flex items-center gap-1.5">
          <Button variant="ghost" size="sm" leadingIcon={<ChevronsUpDown />} onClick={() => setAll(true)}>
            Expandir tudo
          </Button>
          <Button variant="ghost" size="sm" leadingIcon={<ChevronsDownUp />} onClick={() => setAll(false)}>
            Recolher tudo
          </Button>
        </div>
      </div>

      <TableContainer tabIndex={0} stickyHeader maxHeight="max(24rem, calc(100dvh - 18rem))">
        <Table layout="fixed" style={{ minWidth }} aria-label="Manutenções por operação, cidade, BR e veículo">
          <TableHeader>
            <TableRow>
              <TableHead style={{ width: widths[0] }}>Operação → Cidade (UF) → BR → Veículo</TableHead>
              <TableHead style={{ width: widths[1] }} numeric>Veículos</TableHead>
              <TableHead style={{ width: widths[2] }} numeric>Manutenções</TableHead>
              <TableHead style={{ width: widths[3] }} numeric>Abertas</TableHead>
              <TableHead style={{ width: widths[4] }} numeric>Em execução</TableHead>
              <TableHead style={{ width: widths[5] }}>Última referência</TableHead>
              <TableHead style={{ width: widths[6] }}>
                <span className="sr-only">Ações</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visible.map((n) => {
              const leaf = n.level === 3;
              const expanded = !leaf && isOpen(n);
              return (
                <TableRow
                  key={n.key}
                  data-testid={leaf ? "maintenance-hierarchy-vehicle" : "maintenance-hierarchy-group"}
                  data-level={n.level}
                  className={cn(n.level === 0 ? "font-semibold [&>td]:bg-surface-secondary" : n.level === 1 ? "font-medium" : "")}
                >
                  <TableCell className="py-1.5">
                    <div className="flex min-w-0 items-center" style={{ paddingLeft: n.level * 20 }}>
                      {leaf ? (
                        <span className="flex min-w-0 items-center gap-1.5 pl-6">
                          <span className="sr-only">{LEVEL_LABEL[n.level]}: </span>
                          <span className="truncate text-fg" title={n.label}>{n.label}</span>
                        </span>
                      ) : (
                        <button
                          type="button"
                          aria-expanded={expanded}
                          onClick={() => setOpenState((s) => ({ ...s, [n.key]: !expanded }))}
                          className="-ml-1 flex min-h-8 min-w-0 items-center gap-1 rounded-xs px-1 text-left text-fg hfm-focus-ring hover:bg-hover-overlay"
                        >
                          {expanded ? (
                            <ChevronDown className="size-4 shrink-0 text-fg-muted" aria-hidden />
                          ) : (
                            <ChevronRight className="size-4 shrink-0 text-fg-muted" aria-hidden />
                          )}
                          <span className="sr-only">{LEVEL_LABEL[n.level]}: </span>
                          <span className={cn("truncate", n.missing && "text-fg-muted")} title={n.label}>
                            {n.label}
                          </span>
                        </button>
                      )}
                    </div>
                  </TableCell>
                  <TableCell numeric className="text-fg-secondary">{leaf ? "" : formatInt(n.vehicleIds.size)}</TableCell>
                  <TableCell numeric className="text-fg">{formatInt(n.total)}</TableCell>
                  <TableCell numeric className={n.open > 0 ? "text-fg" : "text-fg-muted"}>{formatInt(n.open)}</TableCell>
                  <TableCell numeric className={n.inProgress > 0 ? "text-fg" : "text-fg-muted"}>{formatInt(n.inProgress)}</TableCell>
                  <TableCell className="text-fg-secondary tabular-nums">{formatDate(n.lastReference)}</TableCell>
                  <TableCell className="py-1">
                    {leaf && n.vehicleId ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={pending}
                        aria-label={`Ver manutenções de ${n.label}`}
                        data-testid="maintenance-hierarchy-open-vehicle"
                        onClick={() => navigate({ visao: "tabela", veiculo: n.vehicleId ?? null, pagina: null })}
                      >
                        Ver manutenções
                      </Button>
                    ) : null}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
          <TableFooter>
            <TableRow>
              <TableCell className="font-semibold text-fg">Total</TableCell>
              <TableCell numeric>{formatInt(totals.vehicles)}</TableCell>
              <TableCell numeric>{formatInt(totals.total)}</TableCell>
              <TableCell numeric>{formatInt(totals.open)}</TableCell>
              <TableCell numeric>{formatInt(totals.inProgress)}</TableCell>
              <TableCell />
              <TableCell />
            </TableRow>
          </TableFooter>
        </Table>
      </TableContainer>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Painel
// ---------------------------------------------------------------------------
export function BasePanel(props: BasePanelProps) {
  const { base, filters, actions } = props;
  const { view, page, hierarchy, list } = base;
  const { navigate, pending, refresh } = actions;

  // O nome do veículo filtrado sai das próprias linhas (todas são dele).
  const vehicleName = React.useMemo(() => {
    if (!filters.vehicle) return null;
    const row = page?.rows.find((r) => r.vehicleId === filters.vehicle);
    if (row) return vehicleLabel(row.licensePlate, row.fleetCode);
    const h = hierarchy?.find((r) => r.vehicleId === filters.vehicle);
    return h ? vehicleLabel(h.licensePlate, h.fleetCode) : null;
  }, [filters.vehicle, page, hierarchy]);

  const summary =
    view === "tabela"
      ? page
        ? `${formatInt(page.total)} ${page.total === 1 ? "manutenção" : "manutenções"} · ordenadas por ${SORT_LABEL[list.sort]} (${list.dir === "asc" ? "crescente" : "decrescente"})`
        : "Lista indisponível"
      : "Totais por nível: manutenções, abertas e em execução";

  return (
    <div className="flex flex-col gap-4" data-testid="maintenance-base">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-h4 font-semibold text-fg">Base geral de manutenções</h2>
          <p className="text-caption text-fg-muted" aria-live="polite">{summary}</p>
        </div>
        <div role="group" aria-label="Visão da base" className="inline-flex rounded-md border border-border bg-surface p-0.5">
          {VIEWS.map((v) => {
            const active = view === v.value;
            return (
              <button
                key={v.value}
                type="button"
                aria-pressed={active}
                disabled={pending}
                data-testid={`maintenance-base-view-${v.value}`}
                onClick={() => {
                  if (!active) navigate({ visao: v.value, pagina: null });
                }}
                className={cn(
                  "inline-flex h-8 items-center gap-1.5 rounded-sm px-3 text-label font-medium transition-colors hfm-focus-ring [&_svg]:size-3.5",
                  "disabled:cursor-wait",
                  active ? "bg-primary text-primary-fg shadow-xs" : "text-fg-muted hover:text-fg",
                )}
              >
                <span aria-hidden className="inline-flex">{v.icon}</span>
                {v.label}
              </button>
            );
          })}
        </div>
      </div>

      {filters.vehicle ? (
        <Alert
          variant="info"
          data-testid="maintenance-base-vehicle-filter"
          action={
            <Button
              variant="outline"
              size="sm"
              leadingIcon={<X />}
              disabled={pending}
              onClick={() => navigate({ veiculo: null, pagina: null })}
            >
              Mostrar todos os veículos
            </Button>
          }
        >
          <AlertTitle>Filtrando por veículo: {vehicleName ?? "veículo selecionado"}</AlertTitle>
          <AlertDescription>Somente as manutenções deste veículo aparecem, somadas aos demais filtros da página.</AlertDescription>
        </Alert>
      ) : null}

      {view === "tabela" ? (
        <MaintenanceTable
          page={page}
          list={list}
          actions={actions}
          label="Base geral de manutenções"
          emptyTitle="Nenhuma manutenção na base"
          emptyDescription="Nenhuma manutenção corresponde aos filtros escolhidos. Ajuste o período, a frota (ativos, inativos ou todos) ou limpe os filtros."
        />
      ) : hierarchy === null ? (
        <ErrorState
          title="Não foi possível carregar a hierarquia."
          description="A leitura agrupada falhou. A visão em tabela continua disponível."
          onRetry={refresh}
          retryLabel="Tentar de novo"
          retrying={pending}
          data-testid="maintenance-hierarchy-error"
        />
      ) : hierarchy.length === 0 ? (
        <EmptyState
          variant="panel"
          title="Nenhuma manutenção para agrupar"
          description="Nenhuma manutenção corresponde aos filtros escolhidos. Ajuste o período, a frota ou limpe os filtros."
          data-testid="maintenance-hierarchy-empty"
        />
      ) : (
        <HierarchyView rows={hierarchy} navigate={navigate} pending={pending} />
      )}
    </div>
  );
}
