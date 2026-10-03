"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, ChevronRight, FileSpreadsheet, LayoutList, Layers, ShieldCheck, Truck } from "lucide-react";
import { cn } from "@/lib/cn";
import { ComponentStatusBadge, ConformityBadge, CriticalityBadge, DeadlineBadge } from "@/components/mtsr/badges";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SegmentedControl, ToggleChip } from "@/components/ui/segmented-control";
import { statusTone } from "@/components/ui/status-badge";
import { Table, TableBody, TableCell, TableContainer, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  COMPONENT_STATUS_LABEL, CONFORMITY_TONE, CRITICALITY_TONE, DEADLINE_TONE, fmtDays, fmtInt,
  formatDate, MTSR_BASE_PATH, MTSR_FILTER_PARAM, sourceTypeLabel, type MtsrFleetCell, type MtsrFleetStatus,
  type MtsrFleetStatusRow, type MtsrSortKey, type MtsrTone,
} from "@/lib/mtsr/types";
import { mtsrFiltersQuery } from "@/lib/mtsr/url";
import type { MtsrPanelContext } from "../shared";
import { MtsrPagination, PanelEmpty, PanelError, plural, useViewParam } from "./mtsr-ui";

/**
 * MTSR → Conformidade: a matriz veículo × componente.
 *
 * `mtsr_fleet_status` devolve a página já ordenada e filtrada, com uma célula
 * por componente do catálogo. A tela só desenha: cada quadradinho é o estado
 * oficial (OK / NOK / —) com a referência, a fonte e a observação no tooltip e
 * um indicador quando o componente aguarda revalidação após manutenção.
 */
export function ConformityPanel({ data, ctx }: { data: MtsrFleetStatus | null; ctx: MtsrPanelContext }) {
  if (ctx.error) return <PanelError ctx={ctx} title="Não foi possível carregar a matriz de conformidade." testId="mtsr-conformidade-error" />;
  if (!data) {
    return (
      <PanelEmpty
        icon={<ShieldCheck />}
        title="Sem dados de conformidade"
        description="A rotina não devolveu a matriz. Recarregue a página."
        testId="mtsr-conformidade-empty"
      />
    );
  }
  return <ConformityContent data={data} ctx={ctx} />;
}

const P = MTSR_FILTER_PARAM;
type ViewMode = "lista" | "operacao";

function ConformityContent({ data, ctx }: { data: MtsrFleetStatus; ctx: MtsrPanelContext }) {
  const { summary, rows, groups, total, limit } = data;
  const [grouping, setGrouping] = useViewParam("agrupar");
  const mode: ViewMode = grouping === "operacao" ? "operacao" : "lista";
  const [collapsed, setCollapsed] = React.useState<Set<string>>(() => new Set());

  const sort = (ctx.params.ordem as MtsrSortKey | undefined) ?? "criticality";
  const dir: "asc" | "desc" = ctx.params.dir === "asc" ? "asc" : "desc";

  // Colunas da matriz: a união dos componentes presentes nas linhas, na ordem da rotina.
  const components = React.useMemo(() => {
    const seen = new Map<string, MtsrFleetCell>();
    for (const row of rows) for (const c of row.components) if (!seen.has(c.componentId)) seen.set(c.componentId, c);
    return [...seen.values()];
  }, [rows]);

  const exportQs = mtsrFiltersQuery(ctx.filters, { ordem: sort, dir });
  const exportHref = `${MTSR_BASE_PATH}/export/conformidade${exportQs ? `?${exportQs}` : ""}`;

  const toggleFilter = (param: string, value: string) =>
    ctx.navigate({ [param]: ctx.params[param] === value ? null : value, pagina: null });

  const chip = (key: string, param: string, value: string, label: string, count: number, tone: MtsrTone) => (
    <ToggleChip
      key={key}
      pressed={ctx.params[param] === value}
      onPressedChange={() => toggleFilter(param, value)}
      disabled={ctx.pending}
      data-testid={`mtsr-conformity-summary-${key}`}
    >
      <span aria-hidden className={cn("size-2 rounded-full", statusTone(tone).dotClassName)} />
      {label}
      <span className="tabular-nums text-fg">{fmtInt(count)}</span>
    </ToggleChip>
  );

  return (
    <div className="flex flex-col gap-4" data-testid="mtsr-conformidade">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-2">
          <p className="text-body-sm text-fg-muted">
            <span className="font-medium text-fg-secondary tabular-nums">{fmtInt(summary.vehicles)}</span>{" "}
            {plural(summary.vehicles, "veículo no recorte", "veículos no recorte")} em {formatDate(data.today)} · clique num resumo para filtrar
          </p>
          <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Resumo do recorte" data-testid="mtsr-conformity-summary">
            {chip("conforme", P.conformity, "conforme", "Conformes", summary.conforme, CONFORMITY_TONE.conforme)}
            {chip("nao-conforme", P.conformity, "nao_conforme", "Não conformes", summary.naoConforme, CONFORMITY_TONE.nao_conforme)}
            {chip("sem-informacao", P.conformity, "sem_informacao", "Sem informação", summary.semInformacao, CONFORMITY_TONE.sem_informacao)}
            <span aria-hidden className="mx-1 h-5 w-px bg-border" />
            {chip("critica", P.criticality, "critica", "Críticas", summary.critica, CRITICALITY_TONE.critica)}
            {chip("alta", P.criticality, "alta", "Altas", summary.alta, CRITICALITY_TONE.alta)}
            {chip("media", P.criticality, "media", "Médias", summary.media, CRITICALITY_TONE.media)}
            <span aria-hidden className="mx-1 h-5 w-px bg-border" />
            {chip("vencido", P.deadline, "vencido", "Vencidos", summary.vencido, DEADLINE_TONE.vencido)}
            {chip("atencao", P.deadline, "atencao", "Atenção", summary.atencao, DEADLINE_TONE.atencao)}
            {chip("pendente", P.deadline, "pendente", "Pendentes", summary.pendente, DEADLINE_TONE.pendente)}
            <span aria-hidden className="mx-1 h-5 w-px bg-border" />
            {chip("awaiting", P.awaiting, "1", "Aguardando revalidação", summary.awaiting, "warning")}
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <SegmentedControl<ViewMode>
            aria-label="Modo de exibição"
            value={mode}
            onValueChange={(v) => setGrouping(v === "operacao" ? "operacao" : null)}
            options={[
              { value: "lista", label: "Lista", icon: <LayoutList aria-hidden />, "data-testid": "mtsr-conformity-mode-lista" },
              { value: "operacao", label: "Por operação", icon: <Layers aria-hidden />, "data-testid": "mtsr-conformity-mode-operacao" },
            ]}
          />
          {ctx.perms.export ? (
            <Button asChild size="sm" variant="secondary">
              <a href={exportHref} download data-testid="mtsr-conformity-export">
                <FileSpreadsheet aria-hidden />
                Exportar XLSX
              </a>
            </Button>
          ) : null}
        </div>
      </div>

      {rows.length === 0 ? (
        <PanelEmpty
          icon={<Truck />}
          title="Nenhum veículo no recorte"
          description="Nenhum veículo corresponde aos filtros. Ajuste ou limpe os filtros da tela."
          testId="mtsr-conformidade-empty"
        />
      ) : (
        <ConformityTable
          rows={rows}
          components={components}
          groups={groups}
          mode={mode}
          collapsed={collapsed}
          onToggle={(key) =>
            setCollapsed((prev) => {
              const next = new Set(prev);
              if (next.has(key)) next.delete(key);
              else next.add(key);
              return next;
            })
          }
          sort={sort}
          dir={dir}
          onSort={(key, d) => ctx.navigate({ ordem: key, dir: d, pagina: null })}
        />
      )}

      <MtsrPagination ctx={ctx} total={total} limit={limit} label="Paginação da matriz de conformidade" testId="mtsr-conformity-pagination" />

      <p className="text-caption text-fg-muted">
        Cada quadradinho é o estado oficial do componente no veículo: OK, NOK ou — (sem informação). Borda tracejada: componente
        aguardando revalidação — a manutenção foi concluída, mas o estado só muda com nova vistoria ou leitura. Passe o ponteiro para
        ver referência, fonte e observação.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tabela
// ---------------------------------------------------------------------------
const SORTABLE: Partial<Record<string, MtsrSortKey>> = {
  plate: "plate",
  operation: "operation",
  last_inspection: "last_inspection",
  deadline: "deadline",
  criticality: "criticality",
  nok: "nok",
};

function ConformityTable({
  rows, components, groups, mode, collapsed, onToggle, sort, dir, onSort,
}: {
  rows: MtsrFleetStatusRow[];
  components: MtsrFleetCell[];
  groups: MtsrFleetStatus["groups"];
  mode: ViewMode;
  collapsed: Set<string>;
  onToggle: (key: string) => void;
  sort: MtsrSortKey;
  dir: "asc" | "desc";
  onSort: (key: MtsrSortKey, dir: "asc" | "desc") => void;
}) {
  const router = useRouter();
  const open = (vehicleId: string) => router.push(`${MTSR_BASE_PATH}/veiculos/${vehicleId}`);
  const fixedCols = 13;
  const totalCols = fixedCols + components.length;

  const head = (key: MtsrSortKey, label: string, extra?: { numeric?: boolean; className?: string }) => (
    <TableHead
      sortable
      numeric={extra?.numeric}
      sortDirection={sort === SORTABLE[key] ? dir : null}
      onSort={(d) => onSort(key, d)}
      className={extra?.className}
    >
      {label}
    </TableHead>
  );

  const grouped = React.useMemo(() => {
    if (mode !== "operacao") return null;
    const map = new Map<string, { key: string; label: string; rows: MtsrFleetStatusRow[] }>();
    for (const row of rows) {
      const key = row.operationId ?? "none";
      const g = map.get(key) ?? { key, label: row.operationName ?? "Sem operação", rows: [] };
      g.rows.push(row);
      map.set(key, g);
    }
    return [...map.values()];
  }, [rows, mode]);

  const renderRow = (row: MtsrFleetStatusRow) => (
    <TableRow
      key={row.vehicleId}
      className="h-9 cursor-pointer"
      data-testid="mtsr-conformity-row"
      data-vehicle={row.vehicleId}
      data-conformity={row.conformityStatus}
      onClick={() => open(row.vehicleId)}
    >
      <TableCell className="whitespace-nowrap py-1">
        <a
          href={`${MTSR_BASE_PATH}/veiculos/${row.vehicleId}`}
          className="rounded-xs font-semibold text-fg tabular-nums underline-offset-2 hover:text-primary hover:underline hfm-focus-ring"
          data-testid="mtsr-conformity-plate"
          onClick={(e) => {
            if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
            e.preventDefault();
            e.stopPropagation();
            open(row.vehicleId);
          }}
        >
          {row.licensePlate}
          <span className="sr-only"> — abrir a ficha MTSR do veículo</span>
        </a>
      </TableCell>
      <TableCell className="whitespace-nowrap py-1 text-fg-secondary tabular-nums">{row.fleetCode ?? "—"}</TableCell>
      <TableCell className="py-1 text-fg-secondary">{row.vehicleTypeName ?? "—"}</TableCell>
      <TableCell className="py-1 text-fg-secondary">{row.operationName ?? "—"}</TableCell>
      <TableCell className="whitespace-nowrap py-1 text-fg-secondary">
        {[row.cityName, row.stateUf].filter(Boolean).join("/") || "—"}
      </TableCell>
      <TableCell className="whitespace-nowrap py-1">
        {row.lastValidInspectionDate ? (
          <span className="flex flex-col leading-tight">
            <span className="tabular-nums">{formatDate(row.lastValidInspectionDate)}</span>
            <span className="text-caption text-fg-muted">{row.daysSince == null ? "" : `há ${fmtDays(row.daysSince)}`}</span>
          </span>
        ) : (
          <span className="text-fg-muted">sem vistoria válida</span>
        )}
      </TableCell>
      <TableCell className="py-1"><DeadlineBadge value={row.deadlineStatus} size="sm" /></TableCell>
      <TableCell className="py-1"><ConformityBadge value={row.conformityStatus} size="sm" /></TableCell>
      <TableCell className="py-1"><CriticalityBadge value={row.criticality} size="sm" /></TableCell>
      <TableCell className="py-1 text-fg-secondary">{row.mainComponentName ?? "—"}</TableCell>
      <TableCell numeric className={cn("py-1 font-semibold", row.nokCount === 0 ? "text-fg-muted" : "text-danger")}>{fmtInt(row.nokCount)}</TableCell>
      {components.map((col) => {
        const cell = row.components.find((c) => c.componentId === col.componentId);
        return (
          <TableCell key={col.componentId} align="center" className="px-1 py-1">
            {cell ? <MatrixCell cell={cell} /> : <span className="text-fg-muted">—</span>}
          </TableCell>
        );
      })}
      <TableCell numeric className={cn("py-1", row.openMaintenances === 0 && "text-fg-muted")}>{fmtInt(row.openMaintenances)}</TableCell>
      <TableCell numeric className={cn("py-1", row.pendingInspections === 0 && "text-fg-muted")}>{fmtInt(row.pendingInspections)}</TableCell>
    </TableRow>
  );

  return (
    <TableContainer stickyHeader className="max-h-[70vh]" data-testid="mtsr-conformity-table">
      <Table className="text-caption">
        <TableHeader>
          <TableRow>
            {head("plate", "Placa")}
            <TableHead>Frota</TableHead>
            <TableHead>Tipo</TableHead>
            {head("operation", "Operação")}
            <TableHead>Cidade/UF</TableHead>
            {head("last_inspection", "Última vistoria válida")}
            {head("deadline", "Prazo")}
            <TableHead>Conformidade</TableHead>
            {head("criticality", "Criticidade")}
            <TableHead>Componente principal</TableHead>
            {head("nok", "NOK", { numeric: true })}
            {components.map((c) => (
              <TableHead key={c.componentId} align="center" className="min-w-[4.5rem] max-w-[6rem] whitespace-normal px-1 text-center leading-tight" title={c.name}>
                <span className="block text-[11px]">{c.name}</span>
              </TableHead>
            ))}
            <TableHead numeric className="whitespace-normal">Manut. abertas</TableHead>
            <TableHead numeric className="whitespace-normal">Vistorias pendentes</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {grouped
            ? grouped.map((group) => {
                const stats = groups.find((g) => (g.operationId ?? "none") === group.key);
                const isOpen = !collapsed.has(group.key);
                const Chevron = isOpen ? ChevronDown : ChevronRight;
                return (
                  <React.Fragment key={group.key}>
                    <TableRow className="bg-surface-sunken/60 hover:bg-surface-sunken/60" data-testid="mtsr-conformity-group" data-operation={group.key}>
                      <TableCell colSpan={totalCols} className="py-1.5">
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                          <button
                            type="button"
                            aria-expanded={isOpen}
                            onClick={() => onToggle(group.key)}
                            className="flex min-h-8 min-w-0 items-center gap-1.5 rounded-xs px-1 text-left text-body-sm hfm-focus-ring hover:bg-hover-overlay"
                            data-testid="mtsr-conformity-group-toggle"
                          >
                            <Chevron className="size-4 shrink-0 text-fg-muted" aria-hidden />
                            <span className="sr-only">Operação: </span>
                            <span className="truncate font-semibold text-fg">{group.label}</span>
                            <Badge variant="neutral" size="sm" className="shrink-0 tabular-nums">
                              {fmtInt(group.rows.length)} nesta página
                            </Badge>
                          </button>
                          {stats ? (
                            <span className="flex flex-wrap items-center gap-2 text-caption text-fg-muted tabular-nums">
                              <span>{fmtInt(stats.total)} {plural(stats.total, "veículo no recorte", "veículos no recorte")}</span>
                              {stats.naoConforme > 0 ? <GroupCount tone="danger" count={stats.naoConforme} label="não conformes" /> : null}
                              {stats.critica > 0 ? <GroupCount tone="danger" count={stats.critica} label="críticos" /> : null}
                              {stats.vencido > 0 ? <GroupCount tone="warning" count={stats.vencido} label="vencidos" /> : null}
                            </span>
                          ) : null}
                        </div>
                      </TableCell>
                    </TableRow>
                    {isOpen ? group.rows.map(renderRow) : null}
                  </React.Fragment>
                );
              })
            : rows.map(renderRow)}
        </TableBody>
      </Table>
    </TableContainer>
  );
}

function GroupCount({ tone, count, label }: { tone: "success" | "warning" | "danger" | "neutral"; count: number; label: string }) {
  const t = statusTone(tone);
  return (
    <span className="inline-flex items-center gap-1 tabular-nums">
      <span aria-hidden className={cn("size-1.5 rounded-full", t.dotClassName)} />
      {fmtInt(count)} {label}
    </span>
  );
}

const CELL_CLASS: Record<string, string> = {
  ok: "bg-success-soft text-success-soft-fg border-success-border",
  nok: "bg-danger-soft text-danger-soft-fg border-danger-border",
  sem_informacao: "bg-neutral-soft text-neutral-soft-fg border-neutral-border",
};

/** Quadradinho da matriz: estado oficial compacto, detalhes no tooltip. */
function MatrixCell({ cell }: { cell: MtsrFleetCell }) {
  const label = cell.status === "ok" ? "OK" : cell.status === "nok" ? "NOK" : "—";
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          tabIndex={0}
          role="img"
          aria-label={`${cell.name}: ${COMPONENT_STATUS_LABEL[cell.status] ?? cell.status}${cell.awaitingRevalidation ? ", aguardando revalidação" : ""}`}
          data-status={cell.status}
          data-awaiting={cell.awaitingRevalidation || undefined}
          className={cn(
            "inline-flex h-6 min-w-9 items-center justify-center rounded-xs border px-1 text-[11px] font-semibold tabular-nums hfm-focus-ring",
            CELL_CLASS[cell.status] ?? CELL_CLASS.sem_informacao,
            cell.awaitingRevalidation && "border-dashed border-warning ring-1 ring-warning/40",
          )}
          onClick={(e) => e.stopPropagation()}
        >
          {label}
        </span>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-xs">
        <div className="flex flex-col gap-0.5">
          <span className="font-semibold">{cell.name}</span>
          <span>
            <ComponentStatusBadge value={cell.status} awaiting={cell.awaitingRevalidation} size="sm" appearance="solid" />
          </span>
          <span className="opacity-90">Referência: {cell.referenceDate ? formatDate(cell.referenceDate) : "—"}</span>
          <span className="opacity-90">Fonte: {sourceTypeLabel(cell.sourceType)}</span>
          {cell.observation ? <span className="opacity-90">Observação: {cell.observation}</span> : null}
          {cell.awaitingRevalidation ? <span className="opacity-90">Aguardando revalidação: o estado só muda com nova vistoria ou leitura.</span> : null}
        </div>
      </TooltipContent>
    </Tooltip>
  );
}
