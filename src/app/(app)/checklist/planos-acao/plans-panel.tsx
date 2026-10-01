"use client";

import * as React from "react";
import {
  ArrowDown,
  ArrowUp,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  Flag,
  Layers,
  List,
  Network,
  Truck,
  UserRound,
  X,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { Badge } from "@/components/ui/badge";
import { Button, IconButton } from "@/components/ui/button";
import { FilterChip } from "@/components/ui/filter-bar";
import { MetricStrip, type MetricStripItem } from "@/components/ui/kpi-card";
import { Pagination } from "@/components/ui/pagination";
import { Table, TableBody, TableCell, TableContainer, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { SectionHeader } from "@/components/layout/section-header";
import { EmptyState } from "@/components/feedback/empty-state";
import { ErrorState } from "@/components/feedback/error-state";
import { NativeSelect } from "@/components/governance/selects";
import {
  DeadlineBadge,
  PlanStatusBadge,
  PriorityBadge,
  RecurrenceBadge,
} from "@/components/action-plans/badges";
import {
  formatDate,
  formatDateTime,
  formatInt,
  GROUPING_LABEL,
  isClosed,
  MAINTENANCE_STATUS_LABEL,
  planTitle,
  PRIORITY_LABEL,
  PRIORITY_ORDER,
} from "@/lib/action-plans/labels";
import {
  FILTER_PARAM,
  type ActionPlanCatalog,
  type ActionPlanFilters,
  type ActionPlanRow,
  type ActionPlanSortKey,
  type GroupNode,
  type GroupRow,
  type Grouping,
  type Priority,
} from "@/lib/action-plans/types";
import { PAGE_SIZES, type ActionPlanPerms, type ActionPlansViewData, type PanelActions } from "./shared";

/**
 * Planos de manutenção — a árvore do agrupamento escolhido e a lista paginada.
 *
 * O servidor devolve uma linha por folha do agrupamento (com os totais) e a
 * página da lista, ambos sobre o mesmo filtro. A tela só soma os contadores
 * subindo a árvore; clicar num nó grava o filtro correspondente na URL e a
 * lista abaixo passa a mostrar exatamente aqueles planos.
 */

export interface PlansPanelProps {
  plans: NonNullable<ActionPlansViewData["plans"]>;
  filters: ActionPlanFilters;
  catalog: ActionPlanCatalog;
  perms: ActionPlanPerms;
  actions: PanelActions;
}

const P = FILTER_PARAM;
type Patch = Record<string, string | null>;
type GroupingValue = Grouping | "list";

const split = (value: string | undefined): string[] =>
  (value ?? "")
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);

const GROUPINGS: { value: GroupingValue; icon: React.ReactNode }[] = [
  { value: "operation", icon: <Network /> },
  { value: "cluster", icon: <Layers /> },
  { value: "vehicle", icon: <Truck /> },
  { value: "priority", icon: <Flag /> },
  { value: "responsible", icon: <UserRound /> },
  { value: "list", icon: <List /> },
];

const groupingLabel = (g: GroupingValue) => (g === "list" ? "Lista" : GROUPING_LABEL[g] ?? g);

/** Níveis de cada agrupamento, na ordem do `path` que o servidor devolve. */
type LevelFilter = "operation" | "state" | "city" | "br" | "vehicle" | "cluster" | "actionKey" | "priority" | "responsible";
interface Level {
  filter: LevelFilter;
  label: string;
}
const LEVELS: Record<Grouping, Level[]> = {
  operation: [
    { filter: "operation", label: "Operação" },
    { filter: "state", label: "UF" },
    { filter: "city", label: "Cidade" },
    { filter: "br", label: "BR" },
    { filter: "vehicle", label: "Veículo" },
  ],
  cluster: [
    { filter: "cluster", label: "Cluster" },
    { filter: "actionKey", label: "Item" },
    { filter: "operation", label: "Operação" },
    { filter: "vehicle", label: "Veículo" },
  ],
  vehicle: [{ filter: "vehicle", label: "Veículo" }],
  priority: [{ filter: "priority", label: "Prioridade" }],
  responsible: [{ filter: "responsible", label: "Responsável" }],
};

const SORT_LABEL: Record<ActionPlanSortKey, string> = {
  priority: "prioridade",
  due: "prazo",
  first: "primeiro apontamento",
  last: "último apontamento",
  occurrences: "ocorrências",
  open_items: "apontamentos pendentes",
  code: "código",
  plate: "placa",
  status: "situação",
  age: "idade do plano",
};

const brLabel = (code: string) => (/^br/i.test(code) ? code : `BR ${code}`);
const dash = <span className="text-fg-muted">—</span>;

// ---------------------------------------------------------------------------
// Árvore (montada no cliente a partir das folhas)
// ---------------------------------------------------------------------------

interface Counts {
  plans: number;
  open: number;
  overdue: number;
  onTime: number;
  critical: number;
  openItems: number;
  occurrences: number;
  recurrences: number;
}

const zero = (): Counts => ({ plans: 0, open: 0, overdue: 0, onTime: 0, critical: 0, openItems: 0, occurrences: 0, recurrences: 0 });

function add(target: Counts, row: GroupRow) {
  target.plans += Number(row.plans) || 0;
  target.open += Number(row.open) || 0;
  target.overdue += Number(row.overdue) || 0;
  target.onTime += Number(row.onTime) || 0;
  target.critical += Number(row.critical) || 0;
  target.openItems += Number(row.openItems) || 0;
  target.occurrences += Number(row.occurrences) || 0;
  target.recurrences += Number(row.recurrences) || 0;
}

interface TreeNode extends Counts {
  id: string;
  depth: number;
  node: GroupNode;
  path: GroupNode[];
  children: Map<string, TreeNode>;
}

function buildTree(rows: GroupRow[]): Map<string, TreeNode> {
  const roots = new Map<string, TreeNode>();
  for (const row of rows) {
    let level = roots;
    let parentId = "";
    row.path.forEach((n, depth) => {
      const id = `${parentId}/${n.key == null ? "∅" : String(n.key)}`;
      let node = level.get(id);
      if (!node) {
        node = { id, depth, node: n, path: row.path.slice(0, depth + 1), children: new Map(), ...zero() };
        level.set(id, node);
      }
      add(node, row);
      parentId = id;
      level = node.children;
    });
  }
  return roots;
}

function sortedChildren(map: Map<string, TreeNode>, grouping: Grouping): TreeNode[] {
  const list = [...map.values()];
  if (grouping === "priority") {
    const rank = (n: TreeNode) => {
      const i = PRIORITY_ORDER.indexOf(n.node.key as Priority);
      return i === -1 ? PRIORITY_ORDER.length : i;
    };
    return list.sort((a, b) => rank(a) - rank(b));
  }
  return list.sort(
    (a, b) =>
      Number(a.node.key == null) - Number(b.node.key == null) ||
      b.overdue - a.overdue ||
      b.open - a.open ||
      b.plans - a.plans ||
      a.node.label.localeCompare(b.node.label, "pt-BR"),
  );
}

function nodeLabel(grouping: Grouping, depth: number, n: GroupNode): { main: string; sub: string | null } {
  const level = LEVELS[grouping][depth];
  if (level?.filter === "priority") return { main: PRIORITY_LABEL[n.key as Priority] ?? n.label, sub: null };
  if (level?.filter === "br" && n.key != null) return { main: brLabel(n.label), sub: null };
  return { main: n.label, sub: n.sub ?? null };
}

/** O filtro que um nó grava na URL (todos os níveis com chave, do topo até ele). */
function nodePatch(grouping: Grouping, path: GroupNode[]): Patch | null {
  const levels = LEVELS[grouping];
  const own = path[path.length - 1];
  const ownLevel = levels[path.length - 1];
  if (!ownLevel || (own.key == null && ownLevel.filter !== "responsible")) return null;
  const patch: Patch = { pagina: null };
  path.forEach((n, i) => {
    const level = levels[i];
    if (!level) return;
    if (level.filter === "responsible") {
      patch[P.responsible] = n.key == null ? null : String(n.key);
      patch[P.unassigned] = n.key == null ? "1" : null;
      return;
    }
    if (n.key != null) patch[P[level.filter]] = String(n.key);
  });
  return patch;
}

/** O nó é exatamente o recorte atual (os níveis abaixo dele não estão filtrados). */
function nodeIsSelection(grouping: Grouping, path: GroupNode[], filters: ActionPlanFilters): boolean {
  const levels = LEVELS[grouping];
  let matched = false;
  for (let i = 0; i < path.length; i++) {
    const level = levels[i];
    const key = path[i].key;
    if (level.filter === "responsible" && key == null) {
      if (!filters.unassigned) return false;
      matched = true;
      continue;
    }
    if (key == null) continue;
    const raw = filters[level.filter];
    const values = typeof raw === "string" ? split(raw) : [];
    if (values.length !== 1 || values[0] !== String(key)) return false;
    matched = true;
  }
  const next = levels[path.length];
  if (next) {
    const raw = filters[next.filter];
    if (typeof raw === "string" && raw) return false;
  }
  return matched;
}

const CHILD_PAGE = 25;

function NodeCounts({ n }: { n: Counts }) {
  return (
    <span className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-caption text-fg-secondary tabular-nums">
      <span>
        <span className="font-semibold text-fg">{formatInt(n.plans)}</span> {n.plans === 1 ? "plano" : "planos"}
      </span>
      <span className={n.open ? undefined : "text-fg-muted"}>
        {formatInt(n.open)} {n.open === 1 ? "aberto" : "abertos"}
      </span>
      {n.overdue ? (
        <Badge variant="danger" size="sm">
          {formatInt(n.overdue)} {n.overdue === 1 ? "vencido" : "vencidos"}
        </Badge>
      ) : null}
      {n.onTime ? (
        <Badge variant="success" size="sm">
          {formatInt(n.onTime)} no prazo
        </Badge>
      ) : null}
      {n.critical ? (
        <Badge variant="danger" appearance="outline" size="sm">
          {formatInt(n.critical)} {n.critical === 1 ? "crítico" : "críticos"}
        </Badge>
      ) : null}
      {n.openItems ? (
        <span title="Apontamentos pendentes">
          {formatInt(n.openItems)} {n.openItems === 1 ? "apontamento pendente" : "apontamentos pendentes"}
        </span>
      ) : null}
      {n.recurrences ? (
        <Badge variant="warning" appearance="outline" size="sm">
          {formatInt(n.recurrences)} {n.recurrences === 1 ? "reincidência" : "reincidências"}
        </Badge>
      ) : null}
    </span>
  );
}

function GroupTree({
  grouping,
  rows,
  filters,
  actions,
}: {
  grouping: Grouping;
  rows: GroupRow[];
  filters: ActionPlanFilters;
  actions: PanelActions;
}) {
  const { navigate, pending } = actions;
  const tree = React.useMemo(() => buildTree(rows), [rows]);
  const [openState, setOpenState] = React.useState<Record<string, boolean>>({});
  const [limits, setLimits] = React.useState<Record<string, number>>({});
  const levels = LEVELS[grouping];
  const depthMax = levels.length - 1;
  const baseId = React.useId();

  // Sem escolha explícita: o primeiro nível vem aberto, e um filho único
  // também (depois de um clique, a árvore mostra o detalhamento do recorte).
  const isOpen = (n: TreeNode, onlyChild: boolean) => openState[n.id] ?? (n.depth === 0 || onlyChild);

  const setAll = (value: boolean) => {
    const next: Record<string, boolean> = {};
    const walk = (map: Map<string, TreeNode>) => {
      for (const n of map.values()) {
        if (n.children.size) {
          next[n.id] = value;
          walk(n.children);
        }
      }
    };
    walk(tree);
    setOpenState(next);
  };

  const renderLevel = (map: Map<string, TreeNode>, parentId: string): React.ReactNode => {
    const children = sortedChildren(map, grouping);
    const limit = limits[parentId] ?? CHILD_PAGE;
    const shown = children.slice(0, limit);
    const onlyChild = children.length === 1;
    return (
      <>
        {shown.map((n) => {
          const leaf = n.children.size === 0;
          const expanded = !leaf && isOpen(n, onlyChild);
          const level = levels[n.depth];
          const { main, sub } = nodeLabel(grouping, n.depth, n.node);
          const patch = nodePatch(grouping, n.path);
          const selected = nodeIsSelection(grouping, n.path, filters);
          const childrenId = `${baseId}-${n.id}`;
          return (
            <li key={n.id} data-level={n.depth} data-testid={leaf ? "action-plans-tree-leaf" : "action-plans-tree-node"}>
              <div
                className={cn(
                  "flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border-subtle py-1.5 pr-3",
                  n.depth === 0 && "bg-surface-secondary",
                  selected && "bg-selected-overlay",
                )}
                style={{ paddingLeft: 8 + n.depth * 18 }}
              >
                <span className="flex min-w-0 flex-1 basis-56 items-center gap-1">
                  {leaf ? (
                    <span aria-hidden className="inline-block size-7 shrink-0" />
                  ) : (
                    <button
                      type="button"
                      aria-expanded={expanded}
                      aria-controls={expanded ? childrenId : undefined}
                      aria-label={`${level?.label ?? "Grupo"} ${main}`}
                      onClick={() => setOpenState((s) => ({ ...s, [n.id]: !expanded }))}
                      className="inline-flex size-7 shrink-0 items-center justify-center rounded-xs text-fg-muted hfm-transition hfm-focus-ring hover:bg-hover-overlay hover:text-fg"
                    >
                      <ChevronRight aria-hidden className={cn("size-4 transition-transform", expanded && "rotate-90")} />
                    </button>
                  )}
                  {patch ? (
                    <button
                      type="button"
                      disabled={pending}
                      aria-current={selected || undefined}
                      title={`Mostrar na lista os planos de ${level?.label ?? "grupo"}: ${main}`}
                      onClick={() => navigate(patch)}
                      data-testid="action-plans-tree-select"
                      className={cn(
                        "flex min-w-0 items-baseline gap-1.5 rounded-xs px-1 py-0.5 text-left hfm-focus-ring",
                        "hover:text-link hover:underline underline-offset-2 disabled:cursor-wait",
                        n.depth === 0 ? "font-semibold text-fg" : "font-medium text-fg",
                        selected && "text-link",
                      )}
                    >
                      <span className="sr-only">{level?.label}: </span>
                      <span className="truncate">{main}</span>
                      {sub ? <span className="shrink-0 text-caption font-normal text-fg-muted">{sub}</span> : null}
                    </button>
                  ) : (
                    <span
                      className="flex min-w-0 items-baseline gap-1.5 px-1 py-0.5 text-fg-muted"
                      title="Grupo sem cadastro: não há filtro para ele, abra os níveis abaixo"
                    >
                      <span className="sr-only">{level?.label}: </span>
                      <span className="truncate">{main}</span>
                      {sub ? <span className="shrink-0 text-caption">{sub}</span> : null}
                    </span>
                  )}
                  {selected ? (
                    <Badge variant="primary" size="sm" className="shrink-0">
                      Na lista
                    </Badge>
                  ) : null}
                </span>
                <span className="w-full pl-8 sm:w-auto sm:pl-0">
                  <NodeCounts n={n} />
                </span>
              </div>
              {expanded ? (
                <ul id={childrenId} aria-label={`${levels[n.depth + 1]?.label ?? "Itens"} de ${main}`}>
                  {renderLevel(n.children, n.id)}
                </ul>
              ) : null}
            </li>
          );
        })}
        {children.length > limit ? (
          <li>
            <div className="border-b border-border-subtle py-1.5" style={{ paddingLeft: 8 + (shown[0]?.depth ?? 0) * 18 + 32 }}>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setLimits((l) => ({ ...l, [parentId]: limit + CHILD_PAGE * 4 }))}
              >
                Mostrar mais {formatInt(Math.min(children.length - limit, CHILD_PAGE * 4))} de {formatInt(children.length - limit)}
              </Button>
            </div>
          </li>
        ) : null}
      </>
    );
  };

  return (
    <section
      aria-label={`Planos agrupados por ${levels.map((l) => l.label).join(", ")}`}
      className="flex flex-col overflow-hidden rounded-md border border-border bg-surface"
      data-testid="action-plans-tree"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-surface-secondary px-3 py-2">
        <p className="min-w-0 text-caption text-fg-muted">
          {levels.map((l) => l.label).join(" › ")} · clique num grupo para ver os planos na lista
        </p>
        {depthMax > 0 ? (
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="sm" leadingIcon={<ChevronsUpDown />} onClick={() => setAll(true)}>
              Expandir tudo
            </Button>
            <Button variant="ghost" size="sm" leadingIcon={<ChevronsDownUp />} onClick={() => setAll(false)}>
              Recolher tudo
            </Button>
          </div>
        ) : null}
      </div>
      <div className="max-h-[28rem] overflow-y-auto">
        <ul aria-label={levels[0].label}>{renderLevel(tree, "")}</ul>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Lista
// ---------------------------------------------------------------------------

interface Column {
  key: string;
  label: string;
  /** Largura mínima, em px, para o cabeçalho caber inteiro. */
  width: number;
  sort?: ActionPlanSortKey;
  numeric?: boolean;
  hint?: string;
  render: (row: ActionPlanRow) => React.ReactNode;
}

function Two({ main, sub, title }: { main: React.ReactNode; sub?: React.ReactNode; title?: string }) {
  return (
    <div className="flex min-w-0 flex-col" title={title}>
      <span className="truncate">{main}</span>
      {sub ? <span className="truncate text-caption text-fg-muted">{sub}</span> : null}
    </div>
  );
}

const cityLabel = (row: ActionPlanRow) =>
  row.cityName ? `${row.cityName}${row.stateUf ? `/${row.stateUf}` : ""}` : row.stateUf ?? null;

function MaintenanceCodes({
  row,
  canOpen,
  onOpen,
}: {
  row: ActionPlanRow;
  canOpen: boolean;
  onOpen: (id: string) => void;
}) {
  if (row.maintenances.length === 0) {
    return <span className="text-fg-muted">{row.requiresMaintenance ? "Sem manutenção" : "Não exige"}</span>;
  }
  return (
    <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
      {row.maintenances.map((m) => {
        const title = `${m.code} · ${MAINTENANCE_STATUS_LABEL[m.status] ?? m.status}`;
        return canOpen ? (
          <button
            key={m.id}
            type="button"
            title={title}
            aria-label={`Abrir manutenção ${m.code} (${MAINTENANCE_STATUS_LABEL[m.status] ?? m.status})`}
            data-testid="action-plans-row-maintenance"
            onClick={(event) => {
              event.stopPropagation();
              onOpen(m.id);
            }}
            className="rounded-xs font-medium whitespace-nowrap text-link tabular-nums underline-offset-2 hfm-focus-ring hover:underline"
          >
            {m.code}
          </button>
        ) : (
          <span key={m.id} title={title} className="whitespace-nowrap text-fg-secondary tabular-nums">
            {m.code}
          </span>
        );
      })}
    </span>
  );
}

function buildColumns(canOpenMaintenance: boolean, openPlan: (id: string) => void, openMaintenance: (id: string) => void): Column[] {
  return [
    {
      key: "code",
      label: "Código",
      width: 156,
      sort: "code",
      render: (row) => (
        <div className="flex min-w-0 flex-col">
          <button
            type="button"
            data-testid="action-plans-row-open"
            aria-label={`Abrir plano ${row.code}`}
            onClick={(event) => {
              event.stopPropagation();
              openPlan(row.id);
            }}
            className="self-start rounded-xs font-semibold whitespace-nowrap text-link tabular-nums underline-offset-2 hfm-focus-ring hover:underline"
          >
            {row.code}
          </button>
          {row.cycleNumber > 1 ? <span className="text-caption text-fg-muted">Ciclo {row.cycleNumber}</span> : null}
        </div>
      ),
    },
    {
      key: "vehicle",
      label: "Veículo",
      width: 140,
      sort: "plate",
      render: (row) => (
        <Two
          main={<span className="font-medium text-fg">{row.licensePlate ?? "—"}</span>}
          sub={[row.fleetCode, row.vehicleTypeName].filter(Boolean).join(" · ") || undefined}
          title={[row.licensePlate, row.fleetCode, row.vehicleTypeName].filter(Boolean).join(" · ")}
        />
      ),
    },
    { key: "br", label: "BR", width: 104, render: (row) => (row.brCode ? <span className="whitespace-nowrap">{brLabel(row.brCode)}</span> : dash) },
    {
      key: "operation",
      label: "Operação",
      width: 170,
      render: (row) =>
        row.operationName ? (
          <Two main={row.operationName} sub={row.leaderName ?? undefined} title={[row.operationName, row.leaderName].filter(Boolean).join(" · ")} />
        ) : (
          <span className="text-fg-muted">Sem operação</span>
        ),
    },
    { key: "city", label: "Cidade", width: 150, render: (row) => (cityLabel(row) ? <Two main={cityLabel(row)} title={cityLabel(row) ?? undefined} /> : dash) },
    { key: "cluster", label: "Cluster", width: 140, render: (row) => (row.clusterName ? <Two main={row.clusterName} title={row.clusterName} /> : dash) },
    {
      key: "item",
      label: "Item",
      width: 250,
      render: (row) => <Two main={<span className="text-fg">{planTitle(row)}</span>} title={planTitle(row)} />,
    },
    {
      key: "first",
      label: "1º apontamento",
      width: 136,
      sort: "first",
      render: (row) => (
        <Two
          main={<span className="tabular-nums">{formatDate(row.firstOperationalDate)}</span>}
          sub={row.ageDays != null ? `aberto há ${formatInt(row.ageDays)} d` : undefined}
        />
      ),
    },
    {
      key: "last",
      label: "Último",
      width: 112,
      sort: "last",
      render: (row) => <span className="tabular-nums">{formatDate(row.lastOperationalDate)}</span>,
    },
    { key: "occurrences", label: "Ocorrências", width: 116, sort: "occurrences", numeric: true, render: (row) => formatInt(row.occurrences) },
    {
      key: "open_items",
      label: "Pendentes",
      width: 108,
      sort: "open_items",
      numeric: true,
      hint: "Apontamentos ainda sem solução",
      render: (row) => <span className={row.openItems > 0 ? "font-semibold text-fg" : "text-fg-muted"}>{formatInt(row.openItems)}</span>,
    },
    {
      key: "resolved",
      label: "Resolvidos",
      width: 108,
      numeric: true,
      render: (row) => <span className={row.resolvedItems > 0 ? "text-success-soft-fg" : "text-fg-muted"}>{formatInt(row.resolvedItems)}</span>,
    },
    { key: "priority", label: "Prioridade", width: 112, sort: "priority", render: (row) => <PriorityBadge priority={row.priority} /> },
    {
      key: "due",
      label: "Prazo",
      width: 176,
      sort: "due",
      render: (row) => (
        <div className="flex min-w-0 flex-col items-start gap-0.5">
          <DeadlineBadge deadline={row.deadline} days={row.daysOverdue} />
          {row.dueOn ? (
            <span className="text-caption text-fg-muted tabular-nums" title={row.dueSource === "user" ? "Prazo alterado manualmente" : "Prazo pelo SLA"}>
              até {formatDate(row.dueOn)}
              {row.dueSource === "user" ? " · manual" : ""}
            </span>
          ) : null}
        </div>
      ),
    },
    {
      key: "status",
      label: "Situação",
      width: 228,
      sort: "status",
      render: (row) => (
        <div className="flex flex-wrap items-center gap-1">
          <PlanStatusBadge status={row.status} />
          {row.isRecurrence ? <RecurrenceBadge /> : null}
        </div>
      ),
    },
    {
      key: "responsible",
      label: "Responsável",
      width: 160,
      render: (row) =>
        row.responsibleName ? <Two main={row.responsibleName} title={row.responsibleName} /> : <span className="text-fg-muted">Sem responsável</span>,
    },
    {
      key: "maintenances",
      label: "Manutenções",
      width: 176,
      render: (row) => <MaintenanceCodes row={row} canOpen={canOpenMaintenance} onOpen={openMaintenance} />,
    },
    {
      key: "treatment",
      label: "Última tratativa",
      width: 220,
      render: (row) =>
        row.lastTreatment ? (
          <Two main={row.lastTreatment} sub={formatDateTime(row.lastTreatmentAt)} title={row.lastTreatment} />
        ) : (
          <span className="text-fg-muted">Sem tratativa</span>
        ),
    },
  ];
}

const SORT_OPTIONS = Object.keys(SORT_LABEL) as ActionPlanSortKey[];

function PlansList({
  page,
  list,
  perms,
  actions,
}: {
  page: NonNullable<NonNullable<ActionPlansViewData["plans"]>["page"]>;
  list: NonNullable<ActionPlansViewData["plans"]>["list"];
  perms: ActionPlanPerms;
  actions: PanelActions;
}) {
  const { navigate, pending, openPlan, openMaintenance } = actions;
  const canOpenMaintenance = perms.maintenanceView;
  const columns = React.useMemo(
    () => buildColumns(canOpenMaintenance, openPlan, openMaintenance),
    [canOpenMaintenance, openPlan, openMaintenance],
  );
  const minWidth = columns.reduce((sum, c) => sum + c.width, 0);
  const label = "Planos de ação";

  const onRowClick = (event: React.MouseEvent<HTMLTableRowElement>, id: string) => {
    // Botões da linha (código, manutenções) têm ação própria.
    const row = event.currentTarget;
    const own = (event.target as HTMLElement).closest("a, button, input, select, textarea, [tabindex]");
    if (own && own !== row && row.contains(own)) return;
    openPlan(id);
  };

  const onSort = (key: ActionPlanSortKey) => (dir: "asc" | "desc") => navigate({ ordenar: key, dir, pagina: null });

  return (
    <div className="flex min-w-0 flex-col gap-3" aria-busy={pending || undefined} data-testid="action-plans-table">
      {/* Ordenação para os cartões (a tabela ordena pelos cabeçalhos). */}
      <div className="flex items-end gap-2 lg:hidden">
        <label className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="text-caption text-fg-muted">Ordenar por</span>
          <NativeSelect
            fieldSize="sm"
            value={list.sort}
            disabled={pending}
            onChange={(e) => navigate({ ordenar: e.target.value, pagina: null })}
          >
            {SORT_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {SORT_LABEL[s].charAt(0).toUpperCase() + SORT_LABEL[s].slice(1)}
              </option>
            ))}
          </NativeSelect>
        </label>
        <IconButton
          label={list.dir === "asc" ? "Ordem crescente (inverter)" : "Ordem decrescente (inverter)"}
          variant="outline"
          size="sm"
          disabled={pending}
          onClick={() => navigate({ dir: list.dir === "asc" ? "desc" : "asc", pagina: null })}
        >
          {list.dir === "asc" ? <ArrowUp aria-hidden /> : <ArrowDown aria-hidden />}
        </IconButton>
      </div>

      <TableContainer tabIndex={0} stickyHeader maxHeight="max(24rem, calc(100dvh - 18rem))" className="hidden lg:block">
        <Table layout="fixed" style={{ minWidth }} aria-label={label}>
          <TableHeader>
            <TableRow>
              {columns.map((column, index) => (
                <TableHead
                  key={column.key}
                  style={{ width: column.width, left: index === 0 ? 0 : undefined, zIndex: index === 0 ? 21 : undefined }}
                  className={cn(index === 0 && "sticky border-r border-border bg-surface-secondary")}
                  numeric={column.numeric}
                  title={column.hint}
                  sortable={Boolean(column.sort)}
                  sortDirection={column.sort && list.sort === column.sort ? list.dir : null}
                  onSort={column.sort ? onSort(column.sort) : undefined}
                >
                  {column.label}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {page.rows.map((row) => (
              <TableRow
                key={row.id}
                data-testid="action-plans-row"
                data-plan-id={row.id}
                onClick={(event) => onRowClick(event, row.id)}
                className="group h-(--table-row-height) cursor-pointer"
              >
                {columns.map((column, index) => (
                  <TableCell
                    key={column.key}
                    numeric={column.numeric}
                    style={{ left: index === 0 ? 0 : undefined, zIndex: index === 0 ? 1 : undefined }}
                    className={cn(
                      "py-1.5 text-fg-secondary",
                      index === 0 &&
                        "sticky border-r border-border bg-surface after:pointer-events-none after:absolute after:inset-0 after:bg-hover-overlay after:opacity-0 group-hover:after:opacity-100",
                    )}
                  >
                    {column.render(row)}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>

      {/* Abaixo de lg: cartões com o essencial; o detalhe completo está na gaveta. */}
      <ul className="flex flex-col gap-2 lg:hidden" aria-label={label}>
        {page.rows.map((row) => (
          <li
            key={row.id}
            data-testid="action-plans-card"
            className="overflow-hidden rounded-md border border-border bg-surface hfm-transition hover:border-border-strong"
          >
            <button
              type="button"
              onClick={() => openPlan(row.id)}
              aria-label={`Abrir plano ${row.code}: ${planTitle(row)}`}
              className="flex w-full flex-col gap-2 p-3 text-left hfm-focus-ring"
            >
              <span className="flex w-full items-start justify-between gap-2">
                <span className="min-w-0">
                  <span className="block truncate text-body-sm font-semibold text-fg tabular-nums">{row.code}</span>
                  <span className="block truncate text-caption text-fg-secondary">
                    {[row.licensePlate, row.fleetCode].filter(Boolean).join(" · ") || "—"}
                    {row.operationName ? ` · ${row.operationName}` : ""}
                  </span>
                </span>
                <PriorityBadge priority={row.priority} />
              </span>
              <span className="line-clamp-2 text-body-sm text-fg">{planTitle(row)}</span>
              <span className="flex flex-wrap items-center gap-1">
                <PlanStatusBadge status={row.status} />
                <DeadlineBadge deadline={row.deadline} days={row.daysOverdue} />
                {row.isRecurrence ? <RecurrenceBadge /> : null}
              </span>
              <span className="grid w-full grid-cols-2 gap-x-3 gap-y-1.5 text-caption">
                <CardField label="1º apontamento" value={formatDate(row.firstOperationalDate)} />
                <CardField label="Último" value={formatDate(row.lastOperationalDate)} />
                <CardField
                  label="Ocorr. · pend. · resolv."
                  value={`${formatInt(row.occurrences)} · ${formatInt(row.openItems)} · ${formatInt(row.resolvedItems)}`}
                />
                <CardField label="Prazo" value={row.dueOn ? formatDate(row.dueOn) : "Sem prazo"} />
                <CardField
                  label="Local"
                  value={[cityLabel(row), row.brCode ? brLabel(row.brCode) : null].filter(Boolean).join(" · ") || "—"}
                />
                <CardField label="Cluster" value={row.clusterName ?? "—"} />
                <CardField label="Responsável" value={row.responsibleName ?? "Sem responsável"} />
                <CardField
                  label="Última tratativa"
                  value={row.lastTreatment ? `${row.lastTreatment} · ${formatDate(row.lastTreatmentAt)}` : "Sem tratativa"}
                />
              </span>
            </button>
            {row.maintenances.length ? (
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-border-subtle px-3 py-2 text-caption">
                <span className="text-fg-muted">Manutenções:</span>
                <MaintenanceCodes row={row} canOpen={canOpenMaintenance} onOpen={openMaintenance} />
              </div>
            ) : null}
          </li>
        ))}
      </ul>

      <Pagination
        page={list.page}
        pageSize={list.pageSize}
        total={page.total}
        disabled={pending}
        pageSizeOptions={PAGE_SIZES}
        onPageChange={(p) => navigate({ pagina: p > 1 ? String(p) : null })}
        onPageSizeChange={(size) => navigate({ por_pagina: String(size), pagina: null })}
        label="Páginas: planos de ação"
      />
    </div>
  );
}

function CardField({ label, value }: { label: string; value: string }) {
  return (
    <span className="flex min-w-0 flex-col">
      <span className="text-fg-muted">{label}</span>
      <span className="truncate text-fg tabular-nums" title={value}>
        {value}
      </span>
    </span>
  );
}

// ---------------------------------------------------------------------------
// Painel
// ---------------------------------------------------------------------------

export function PlansPanel({ plans, filters, catalog, perms, actions }: PlansPanelProps) {
  const { grouping, groups, page, list } = plans;
  const { navigate, pending, refresh } = actions;
  const groupingLabelId = React.useId();

  // ---- resumo: das folhas do agrupamento quando há; senão, da página.
  const summary = React.useMemo(() => {
    if (groups) {
      const t = zero();
      for (const row of groups) add(t, row);
      return { ...t, scope: "group" as const };
    }
    const rows = page?.rows ?? [];
    const open = rows.filter((r) => !isClosed(r.status));
    return {
      ...zero(),
      plans: page?.total ?? 0,
      open: open.length,
      overdue: rows.filter((r) => r.deadline === "overdue").length,
      critical: open.filter((r) => r.priority === "critical").length,
      openItems: rows.reduce((s, r) => s + r.openItems, 0),
      scope: "page" as const,
    };
  }, [groups, page]);

  const onPage = summary.scope === "page";
  const metrics: MetricStripItem[] = [
    {
      key: "plans",
      label: "Planos",
      value: formatInt(summary.plans),
      hint: onPage ? "no recorte" : `${formatInt(summary.occurrences)} ocorrências`,
    },
    {
      key: "open",
      label: "Abertos",
      value: formatInt(summary.open),
      hint: onPage ? "na página atual" : `${formatInt(summary.openItems)} apontamentos pendentes`,
    },
    {
      key: "overdue",
      label: "Vencidos",
      value: <span className={summary.overdue ? "text-danger-soft-fg" : undefined}>{formatInt(summary.overdue)}</span>,
      hint: onPage
        ? "na página atual"
        : summary.open
          ? `${formatInt(Math.round((summary.overdue / summary.open) * 100))}% dos abertos`
          : "nenhum aberto",
    },
    {
      key: "critical",
      label: "Críticos",
      value: <span className={summary.critical ? "text-danger-soft-fg" : undefined}>{formatInt(summary.critical)}</span>,
      hint: onPage ? "abertos, na página atual" : "abertos com prioridade crítica",
    },
  ];

  // ---- recorte da árvore (níveis do agrupamento já filtrados)
  const trail = React.useMemo(() => {
    if (grouping === "list") return [];
    const levels = LEVELS[grouping];
    const fromGroups = (depth: number, key: string) =>
      groups?.find((g) => g.path[depth] && String(g.path[depth].key) === key)?.path[depth];
    const name = (level: Level, depth: number, key: string): string => {
      switch (level.filter) {
        case "operation":
          return catalog.operations.find((o) => o.id === key)?.name ?? fromGroups(depth, key)?.label ?? key;
        case "state":
          return catalog.states.find((s) => String(s.id) === key)?.uf ?? fromGroups(depth, key)?.label ?? key;
        case "city":
          return catalog.cities.find((c) => String(c.id) === key)?.name ?? fromGroups(depth, key)?.label ?? key;
        case "br": {
          const code = catalog.brs.find((b) => b.id === key)?.code ?? fromGroups(depth, key)?.label;
          return code ? brLabel(code) : key;
        }
        case "cluster":
          return catalog.clusters.find((c) => c.key === key)?.name ?? fromGroups(depth, key)?.label ?? key;
        case "actionKey": {
          const row = page?.rows.find((r) => r.planKey === key || r.actionKey === key);
          return fromGroups(depth, key)?.label ?? (row ? planTitle(row) : catalog.actionKeys.find((a) => a.key === key)?.title ?? key);
        }
        case "vehicle": {
          const row = page?.rows.find((r) => r.vehicleId === key);
          return row?.licensePlate ?? fromGroups(depth, key)?.label ?? "Veículo selecionado";
        }
        case "priority":
          return PRIORITY_LABEL[key as Priority] ?? key;
        case "responsible":
          return catalog.responsibles.find((r) => r.id === key)?.name ?? fromGroups(depth, key)?.label ?? key;
      }
    };
    const out: { key: string; label: string; value: string; patch: Patch }[] = [];
    levels.forEach((level, depth) => {
      if (level.filter === "responsible" && filters.unassigned) {
        out.push({ key: "unassigned", label: level.label, value: "Sem responsável", patch: { [P.unassigned]: null } });
      }
      const raw = filters[level.filter];
      const values = typeof raw === "string" ? split(raw) : [];
      if (!values.length) return;
      const shown = values.slice(0, 2).map((v) => name(level, depth, v));
      out.push({
        key: level.filter,
        label: level.label,
        value: values.length > 2 ? `${shown.join(", ")} +${values.length - 2}` : shown.join(", "),
        patch: { [P[level.filter]]: null },
      });
    });
    return out;
  }, [grouping, groups, page, filters, catalog]);

  const clearTrail = () => {
    const patch: Patch = { pagina: null };
    for (const t of trail) Object.assign(patch, t.patch);
    navigate(patch);
  };

  const description = page
    ? `${formatInt(page.total)} ${page.total === 1 ? "plano" : "planos"} · ordenados por ${SORT_LABEL[list.sort]} (${
        list.dir === "asc" ? "crescente" : "decrescente"
      })`
    : "Lista indisponível";

  return (
    <div className="flex min-w-0 flex-col gap-4" data-testid="action-plans-plans">
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
        <SectionHeader
          className="min-w-0"
          title="Planos de manutenção"
          description={<span aria-live="polite">{description}</span>}
        />
        <div className="flex min-w-0 max-w-full flex-wrap items-center gap-2">
          <span className="text-caption text-fg-muted" id={groupingLabelId}>
            Agrupar por
          </span>
          <div
            role="group"
            aria-labelledby={groupingLabelId}
            data-testid="action-plans-grouping"
            className="inline-flex max-w-full flex-wrap rounded-md border border-border bg-surface p-0.5"
          >
            {GROUPINGS.map((g) => {
              const active = grouping === g.value;
              return (
                <button
                  key={g.value}
                  type="button"
                  aria-pressed={active}
                  disabled={pending}
                  data-testid={`action-plans-grouping-${g.value}`}
                  onClick={() => {
                    if (!active) navigate({ agrupar: g.value === "operation" ? null : g.value, pagina: null });
                  }}
                  className={cn(
                    "inline-flex h-8 items-center gap-1.5 rounded-sm px-2.5 text-label font-medium transition-colors hfm-focus-ring [&_svg]:size-3.5",
                    "disabled:cursor-wait",
                    active ? "bg-primary text-primary-fg shadow-xs" : "text-fg-muted hover:text-fg",
                  )}
                >
                  <span aria-hidden className="inline-flex">
                    {g.icon}
                  </span>
                  {groupingLabel(g.value)}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <MetricStrip items={metrics} ariaLabel="Resumo dos planos no recorte" />

      {trail.length ? (
        <div
          role="group"
          aria-label="Recorte aplicado à lista"
          className="flex flex-wrap items-center gap-1.5 rounded-md border border-border-subtle bg-surface-secondary px-3 py-2"
          data-testid="action-plans-trail"
        >
          <span className="text-caption font-medium text-fg-secondary">Recorte:</span>
          {trail.map((t) => (
            <FilterChip
              key={t.key}
              label={t.label}
              value={t.value}
              disabled={pending}
              onRemove={() => navigate({ ...t.patch, pagina: null })}
            />
          ))}
          <Button variant="ghost" size="sm" leadingIcon={<X />} disabled={pending} onClick={clearTrail} className="ml-auto">
            Limpar recorte
          </Button>
        </div>
      ) : null}

      {grouping !== "list" ? (
        groups === null ? (
          <ErrorState
            variant="panel"
            title="Não foi possível carregar o agrupamento."
            description="A leitura agrupada falhou. A lista abaixo continua disponível."
            onRetry={refresh}
            retryLabel="Tentar de novo"
            retrying={pending}
            data-testid="action-plans-tree-error"
          />
        ) : groups.length === 0 ? null : (
          <GroupTree key={grouping} grouping={grouping} rows={groups} filters={filters} actions={actions} />
        )
      ) : null}

      {!page ? (
        <ErrorState
          variant="panel"
          title="Não foi possível carregar os planos."
          description="A leitura da lista falhou. Os demais dados da tela seguem disponíveis."
          onRetry={refresh}
          retryLabel="Tentar de novo"
          retrying={pending}
          data-testid="action-plans-table-error"
        />
      ) : page.rows.length === 0 ? (
        <EmptyState
          variant="panel"
          title={page.total > 0 && list.page > 1 ? "Esta página não tem planos" : "Nenhum plano com os filtros atuais"}
          description={
            page.total > 0 && list.page > 1
              ? `A lista tem ${formatInt(page.total)} planos, mas a página ${formatInt(list.page)} ficou vazia.`
              : "Ajuste o período, a situação ou limpe os filtros. Sem situação escolhida, a lista mostra só os planos em aberto."
          }
          action={
            page.total > 0 && list.page > 1 ? (
              <Button variant="secondary" size="sm" onClick={() => navigate({ pagina: null })} disabled={pending}>
                Ir para a primeira página
              </Button>
            ) : trail.length ? (
              <Button variant="secondary" size="sm" onClick={clearTrail} disabled={pending}>
                Limpar recorte
              </Button>
            ) : undefined
          }
          data-testid="action-plans-empty"
        />
      ) : (
        <PlansList page={page} list={list} perms={perms} actions={actions} />
      )}
    </div>
  );
}
