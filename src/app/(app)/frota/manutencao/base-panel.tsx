"use client";

import * as React from "react";
import {
  ChevronDown,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  ListTree,
  Table2,
  X,
} from "lucide-react";
import { cn } from "@/lib/cn";
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@/components/feedback/alert";
import { Button } from "@/components/ui/button";
import { ToggleChip } from "@/components/ui/segmented-control";
import {
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { EmptyState } from "@/components/feedback/empty-state";
import { ErrorState } from "@/components/feedback/error-state";
import {
  DEFAULT_HIERARCHY_LEVELS,
  formatDate,
  formatInt,
  HIERARCHY_LEVEL_LABEL,
  HIERARCHY_LEVELS,
  vehicleLabel,
  type HierarchyLevel,
  type HierarchyNode,
  type HierarchyPathNode,
  type MaintenanceCatalog,
  type MaintenanceFilters,
} from "@/lib/maintenance/types";
import { hierarchyLevelsParam } from "@/lib/maintenance/url";
import { MaintenanceTable, SORT_LABEL } from "./maintenance-table";
import type {
  MaintenancePerms,
  MaintenanceViewData,
  Navigate,
  PanelActions,
} from "./shared";

/**
 * Base geral — todas as manutenções do recorte, em tabela paginada ou em
 * hierarquia pelos níveis escolhidos (Operação, Cidade, Placa, Cluster,
 * Serviço). Os nós vêm prontos do servidor, com contagens distintas por nível
 * (pelo contexto histórico gravado na manutenção); a tela só monta a árvore.
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

// ---------------------------------------------------------------------------
// Árvore (montada no cliente a partir dos nós prontos do servidor)
// ---------------------------------------------------------------------------
interface TreeNode {
  /** Caminho completo (`level:key|level:key…`): único na árvore. */
  key: string;
  level: HierarchyLevel;
  depth: number;
  label: string;
  /** "Sem operação", "Sem cidade"… vão para o fim do nível. */
  missing: boolean;
  path: HierarchyPathNode[];
  total: number;
  open: number;
  inProgress: number;
  vehicles: number;
  lastReference: string | null;
  children: Map<string, TreeNode>;
}

/** Rótulo de um nível do caminho; o que falta vira "Sem …" e vai para o fim. */
function nodeLabel(p: HierarchyPathNode): { label: string; missing: boolean } {
  switch (p.level) {
    case "operation":
      return { label: p.label ?? "Sem operação", missing: !p.label };
    case "city":
      return {
        label: p.label
          ? `${p.label}${p.extra ? ` (${p.extra})` : ""}`
          : p.extra
            ? `Sem cidade (${p.extra})`
            : "Sem cidade",
        missing: !p.label,
      };
    case "vehicle":
      return {
        label:
          p.label || p.extra ? vehicleLabel(p.label, p.extra) : "Sem placa",
        missing: !p.label && !p.extra,
      };
    case "cluster":
      return { label: p.label ?? "Sem cluster", missing: !p.label };
    case "service":
      return { label: p.label ?? "Sem serviço", missing: !p.label };
  }
}

const pathKey = (path: HierarchyPathNode[]) =>
  path.map((p) => `${p.level}:${p.key}`).join("|");

/** Cada nó do servidor já traz os seus totais; aqui só se encaixa cada um no pai (o prefixo do caminho). */
function buildTree(nodes: HierarchyNode[]): Map<string, TreeNode> {
  const roots = new Map<string, TreeNode>();
  const index = new Map<string, TreeNode>();
  for (const n of [...nodes].sort((a, b) => a.depth - b.depth)) {
    const last = n.path[n.path.length - 1];
    if (!last || n.depth === 0) continue;
    const { label, missing } = nodeLabel(last);
    const node: TreeNode = {
      key: pathKey(n.path),
      level: last.level,
      depth: n.depth,
      label,
      missing,
      path: n.path,
      total: n.total,
      open: n.open,
      inProgress: n.inProgress,
      vehicles: n.vehicles,
      lastReference: n.lastReference,
      children: new Map(),
    };
    index.set(node.key, node);
    const parent =
      n.depth > 1 ? index.get(pathKey(n.path.slice(0, -1))) : undefined;
    (parent?.children ?? roots).set(node.key, node);
  }
  return roots;
}

function sorted(map: Map<string, TreeNode>): TreeNode[] {
  return [...map.values()].sort(
    (a, b) =>
      Number(a.missing) - Number(b.missing) ||
      b.total - a.total ||
      a.label.localeCompare(b.label, "pt-BR"),
  );
}

function allGroupKeys(
  map: Map<string, TreeNode>,
  leafDepth: number,
  out: string[] = [],
): string[] {
  for (const n of map.values()) {
    if (n.depth < leafDepth) {
      out.push(n.key);
      allGroupKeys(n.children, leafDepth, out);
    }
  }
  return out;
}

/** O filtro da lista para "Ver manutenções" de um nó: os ids do caminho, menos o que falta ("-"). */
function filtersFor(path: HierarchyPathNode[]): Record<string, string | null> {
  const patch: Record<string, string | null> = {
    visao: "tabela",
    pagina: null,
  };
  for (const p of path) {
    if (p.key === "-") continue;
    switch (p.level) {
      case "operation":
        patch.operacao = p.key;
        break;
      case "city":
        if (p.key.startsWith("uf:")) patch.uf = p.key.slice(3);
        else patch.cidade = p.key;
        break;
      case "vehicle":
        patch.veiculo = p.key;
        break;
      case "cluster":
        patch.cluster = p.key;
        break;
      case "service":
        patch.servico = p.key;
        break;
    }
  }
  return patch;
}

function HierarchyView({
  nodes,
  levels,
  navigate,
  pending,
}: {
  nodes: HierarchyNode[];
  levels: HierarchyLevel[];
  navigate: Navigate;
  pending: boolean;
}) {
  const tree = React.useMemo(() => buildTree(nodes), [nodes]);
  const root = React.useMemo(
    () => nodes.find((n) => n.depth === 0) ?? null,
    [nodes],
  );
  const leafDepth = levels.length;
  // Sem escolha explícita, só o primeiro nível vem aberto.
  const [openState, setOpenState] = React.useState<Record<string, boolean>>({});
  const isOpen = (n: TreeNode) => openState[n.key] ?? n.depth === 1;
  const setAll = (value: boolean) =>
    setOpenState(
      Object.fromEntries(allGroupKeys(tree, leafDepth).map((k) => [k, value])),
    );

  const visible: TreeNode[] = [];
  const walk = (map: Map<string, TreeNode>) => {
    for (const n of sorted(map)) {
      visible.push(n);
      if (n.depth < leafDepth && isOpen(n)) walk(n.children);
    }
  };
  walk(tree);

  const widths = [320, 92, 120, 92, 112, 136, 168];
  const minWidth = widths.reduce((a, b) => a + b, 0);
  const pathLabel = levels
    .map((level) => HIERARCHY_LEVEL_LABEL[level])
    .join(" → ");
  const firstLevel =
    HIERARCHY_LEVEL_LABEL[levels[0] ?? "operation"].toLowerCase();

  return (
    <div className="flex flex-col gap-3" data-testid="maintenance-hierarchy">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-caption text-fg-muted">
          {formatInt(tree.size)}{" "}
          {tree.size === 1
            ? firstLevel
            : `${firstLevel}s`.replace("operaçãos", "operações")}{" "}
          · {formatInt(root?.vehicles ?? 0)}{" "}
          {(root?.vehicles ?? 0) === 1 ? "veículo" : "veículos"} ·{" "}
          {formatInt(root?.total ?? 0)} manutenções · agrupadas pelo contexto
          gravado em cada manutenção
        </p>
        {leafDepth > 1 ? (
          <div className="flex items-center gap-1.5">
            <Button
              variant="ghost"
              size="sm"
              leadingIcon={<ChevronsUpDown />}
              onClick={() => setAll(true)}
            >
              Expandir tudo
            </Button>
            <Button
              variant="ghost"
              size="sm"
              leadingIcon={<ChevronsDownUp />}
              onClick={() => setAll(false)}
            >
              Recolher tudo
            </Button>
          </div>
        ) : null}
      </div>

      <TableContainer
        tabIndex={0}
        stickyHeader
        maxHeight="max(24rem, calc(100dvh - 18rem))"
      >
        <Table
          layout="fixed"
          style={{ minWidth }}
          aria-label={`Manutenções por ${pathLabel}`}
        >
          <TableHeader>
            <TableRow>
              <TableHead
                style={{ width: widths[0] }}
                data-testid="maintenance-hierarchy-path"
              >
                {pathLabel}
              </TableHead>
              <TableHead style={{ width: widths[1] }} numeric>
                Veículos
              </TableHead>
              <TableHead style={{ width: widths[2] }} numeric>
                Manutenções
              </TableHead>
              <TableHead style={{ width: widths[3] }} numeric>
                Abertas
              </TableHead>
              <TableHead style={{ width: widths[4] }} numeric>
                Em execução
              </TableHead>
              <TableHead style={{ width: widths[5] }}>
                Última referência
              </TableHead>
              <TableHead style={{ width: widths[6] }}>
                <span className="sr-only">Ações</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visible.map((n) => {
              const leaf = n.depth === leafDepth;
              const expanded = !leaf && isOpen(n);
              return (
                <TableRow
                  key={n.key}
                  data-testid={
                    leaf
                      ? "maintenance-hierarchy-leaf"
                      : "maintenance-hierarchy-group"
                  }
                  data-level={n.level}
                  data-depth={n.depth}
                  className={cn(
                    n.depth === 1
                      ? "font-semibold [&>td]:bg-surface-secondary"
                      : n.depth === 2
                        ? "font-medium"
                        : "",
                  )}
                >
                  <TableCell className="py-1.5">
                    <div
                      className="flex min-w-0 items-center"
                      style={{ paddingLeft: (n.depth - 1) * 20 }}
                    >
                      {leaf ? (
                        <span className="flex min-w-0 items-center gap-1.5 pl-6">
                          <span className="sr-only">
                            {HIERARCHY_LEVEL_LABEL[n.level]}:{" "}
                          </span>
                          <span
                            className={cn(
                              "truncate text-fg",
                              n.missing && "text-fg-muted italic",
                            )}
                            title={n.label}
                          >
                            {n.label}
                          </span>
                        </span>
                      ) : (
                        <button
                          type="button"
                          aria-expanded={expanded}
                          onClick={() =>
                            setOpenState((s) => ({ ...s, [n.key]: !expanded }))
                          }
                          className="-ml-1 flex min-h-8 min-w-0 items-center gap-1 rounded-xs px-1 text-left text-fg hfm-focus-ring hover:bg-hover-overlay"
                        >
                          {expanded ? (
                            <ChevronDown
                              className="size-4 shrink-0 text-fg-muted"
                              aria-hidden
                            />
                          ) : (
                            <ChevronRight
                              className="size-4 shrink-0 text-fg-muted"
                              aria-hidden
                            />
                          )}
                          <span className="sr-only">
                            {HIERARCHY_LEVEL_LABEL[n.level]}:{" "}
                          </span>
                          <span
                            className={cn(
                              "truncate",
                              n.missing && "text-fg-muted italic",
                            )}
                            title={n.label}
                          >
                            {n.label}
                          </span>
                        </button>
                      )}
                    </div>
                  </TableCell>
                  <TableCell numeric className="text-fg-secondary">
                    {n.level === "vehicle" ? "" : formatInt(n.vehicles)}
                  </TableCell>
                  <TableCell numeric className="text-fg">
                    {formatInt(n.total)}
                  </TableCell>
                  <TableCell
                    numeric
                    className={n.open > 0 ? "text-fg" : "text-fg-muted"}
                  >
                    {formatInt(n.open)}
                  </TableCell>
                  <TableCell
                    numeric
                    className={n.inProgress > 0 ? "text-fg" : "text-fg-muted"}
                  >
                    {formatInt(n.inProgress)}
                  </TableCell>
                  <TableCell className="text-fg-secondary tabular-nums">
                    {formatDate(n.lastReference)}
                  </TableCell>
                  <TableCell className="py-1">
                    {leaf ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={pending}
                        aria-label={`Ver manutenções de ${n.label}`}
                        data-testid="maintenance-hierarchy-open-leaf"
                        onClick={() => navigate(filtersFor(n.path))}
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
              <TableCell numeric>{formatInt(root?.vehicles ?? 0)}</TableCell>
              <TableCell numeric>{formatInt(root?.total ?? 0)}</TableCell>
              <TableCell numeric>{formatInt(root?.open ?? 0)}</TableCell>
              <TableCell numeric>{formatInt(root?.inProgress ?? 0)}</TableCell>
              <TableCell />
              <TableCell />
            </TableRow>
          </TableFooter>
        </Table>
      </TableContainer>
    </div>
  );
}

/** Quais níveis a árvore aninha; pelo menos um fica sempre marcado. */
function LevelPicker({
  levels,
  navigate,
  pending,
}: {
  levels: HierarchyLevel[];
  navigate: Navigate;
  pending: boolean;
}) {
  const choose = (level: HierarchyLevel, on: boolean) => {
    const next = on ? [...levels, level] : levels.filter((l) => l !== level);
    const param = hierarchyLevelsParam(next);
    navigate({
      niveis:
        param === hierarchyLevelsParam(DEFAULT_HIERARCHY_LEVELS) ? null : param,
    });
  };
  return (
    <div
      role="group"
      aria-label="Agrupar por"
      className="flex flex-wrap items-center gap-1.5"
      data-testid="maintenance-hierarchy-levels"
    >
      <span className="text-caption text-fg-muted">Agrupar por</span>
      {HIERARCHY_LEVELS.map((level) => {
        const pressed = levels.includes(level);
        return (
          <ToggleChip
            key={level}
            pressed={pressed}
            disabled={pending || (pressed && levels.length === 1)}
            onPressedChange={(on) => choose(level, on)}
            data-testid={`maintenance-hierarchy-level-${level}`}
          >
            {HIERARCHY_LEVEL_LABEL[level]}
          </ToggleChip>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Painel
// ---------------------------------------------------------------------------
export function BasePanel(props: BasePanelProps) {
  const { base, filters, actions } = props;
  const { view, page, hierarchy, list, levels } = base;
  const { navigate, pending, refresh } = actions;

  // O nome do veículo filtrado sai das próprias linhas (todas são dele).
  const vehicleName = React.useMemo(() => {
    if (!filters.vehicle) return null;
    const row = page?.rows.find((r) => r.vehicleId === filters.vehicle);
    if (row) return vehicleLabel(row.licensePlate, row.fleetCode);
    const h = hierarchy
      ?.flatMap((n) => n.path)
      .find((p) => p.level === "vehicle" && p.key === filters.vehicle);
    return h ? vehicleLabel(h.label, h.extra) : null;
  }, [filters.vehicle, page, hierarchy]);

  const summary =
    view === "tabela"
      ? page
        ? `${formatInt(page.total)} ${page.total === 1 ? "manutenção" : "manutenções"} · ordenadas por ${SORT_LABEL[list.sort]} (${list.dir === "asc" ? "crescente" : "decrescente"})`
        : "Lista indisponível"
      : `Totais por nível (${levels.map((l) => HIERARCHY_LEVEL_LABEL[l].toLowerCase()).join(" → ")}): manutenções, abertas e em execução`;

  return (
    <div className="flex flex-col gap-4" data-testid="maintenance-base">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-h4 font-semibold text-fg">
            Base geral de manutenções
          </h2>
          <p className="text-caption text-fg-muted" aria-live="polite">
            {summary}
          </p>
        </div>
        <div
          role="group"
          aria-label="Visão da base"
          className="inline-flex rounded-md border border-border bg-surface p-0.5"
        >
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
                  active
                    ? "bg-primary text-primary-fg shadow-xs"
                    : "text-fg-muted hover:text-fg",
                )}
              >
                <span aria-hidden className="inline-flex">
                  {v.icon}
                </span>
                {v.label}
              </button>
            );
          })}
        </div>
      </div>

      {view === "hierarquia" ? (
        <LevelPicker levels={levels} navigate={navigate} pending={pending} />
      ) : null}

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
          <AlertTitle>
            Filtrando por veículo: {vehicleName ?? "veículo selecionado"}
          </AlertTitle>
          <AlertDescription>
            Somente as manutenções deste veículo aparecem, somadas aos demais
            filtros da página.
          </AlertDescription>
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
      ) : !hierarchy.some((n) => n.depth > 0) ? (
        <EmptyState
          variant="panel"
          title="Nenhuma manutenção para agrupar"
          description="Nenhuma manutenção corresponde aos filtros escolhidos. Ajuste o período, a frota ou limpe os filtros."
          data-testid="maintenance-hierarchy-empty"
        />
      ) : (
        <HierarchyView
          nodes={hierarchy}
          levels={levels}
          navigate={navigate}
          pending={pending}
        />
      )}
    </div>
  );
}
