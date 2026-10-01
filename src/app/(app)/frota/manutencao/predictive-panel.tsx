"use client";

import * as React from "react";
import { useSearchParams } from "next/navigation";
import { ClipboardCheck, Eye, History, Info, MoreHorizontal, RotateCw, Wrench, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { Badge } from "@/components/ui/badge";
import { Button, IconButton } from "@/components/ui/button";
import { DateInput } from "@/components/ui/date-input";
import {
  Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { FilterBar, FilterChip } from "@/components/ui/filter-bar";
import { FormField } from "@/components/ui/form-field";
import { Pagination } from "@/components/ui/pagination";
import { SearchField } from "@/components/ui/search-field";
import { Table, TableBody, TableCell, TableContainer, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Alert, AlertDescription, AlertTitle } from "@/components/feedback/alert";
import { EmptyState } from "@/components/feedback/empty-state";
import { ErrorState } from "@/components/feedback/error-state";
import { Skeleton } from "@/components/feedback/skeleton";
import { useToast } from "@/components/feedback/toast";
import { NativeSelect } from "@/components/governance/selects";
import { PredictiveStatusBadge } from "@/components/maintenance/badges";
import { generatePredictiveMaintenance } from "@/lib/maintenance/actions";
import type { MaintenanceFilterOptions, PredictiveFilters } from "@/lib/maintenance/queries";
import {
  CONFORMITY_LABEL,
  EXECUTION_LABEL,
  formatDate,
  formatInt,
  formatKm,
  PREDICTIVE_STATUS_LABEL,
  PREDICTIVE_STATUS_TONE,
  REFERENCE_TYPE_LABEL,
  vehicleLabel,
  type MaintenanceCatalog,
  type PredictiveAlert,
  type PredictiveCell,
  type PredictiveExecution,
  type PredictiveOverview,
  type PredictiveStatus,
} from "@/lib/maintenance/types";
import {
  ExecutionBadge,
  PredictiveCycleDrawer,
  remainingDaysText,
  remainingKmText,
  servicesForCluster,
  useCycleHistory,
  type PredictiveCycleContext,
} from "./predictive-cycle-drawer";
import { PredictiveVerificationDialog } from "./predictive-verification-dialog";
import { FilterField, StatTile, TONE_BORDER, useUrlPage } from "./preventive-panel";
import type { MaintenancePerms, PanelActions } from "./shared";

/**
 * Manutenção → Preditiva.
 *
 * Duas perguntas, duas situações: a técnica (a banda de KM/dias até o próximo
 * marco do item) e a de execução (a manutenção do item). As duas chegam
 * calculadas do servidor e aparecem sempre separadas. A tela oferece os
 * alertas priorizados e a matriz veículo × item; verificação, geração de
 * manutenção e reinício de ciclo são rotinas do banco.
 */

export interface PredictivePanelProps {
  predictive: { overview: PredictiveOverview | null; filters: PredictiveFilters };
  options: MaintenanceFilterOptions;
  catalog: MaintenanceCatalog;
  perms: MaintenancePerms;
  actions: PanelActions;
}

const TECH_ORDER: PredictiveStatus[] = ["critical", "due", "to_schedule", "upcoming", "ok", "initial_inspection", "no_km"];
const EXEC_ORDER: PredictiveExecution[] = ["awaiting_corrective", "to_schedule", "scheduled", "in_progress", "not_programmed"];
/** "Programadas" do resumo = há agendar + agendadas. */
const PROGRAMMED = "to_schedule,scheduled";

type View = "alertas" | "matriz";

const pct1 = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 });

function clusterCounts(entry: PredictiveOverview["criticalClusters"][number]) {
  return { critical: entry.critical ?? 0, toSchedule: entry.toSchedule ?? null };
}

function toContext(cell: PredictiveCell, extra: Omit<PredictiveCycleContext, keyof PredictiveCell>): PredictiveCycleContext {
  return {
    cycleId: cell.cycleId,
    status: cell.status,
    execution: cell.execution,
    conformity: cell.conformity,
    monitoring: cell.monitoring,
    nextKm: cell.nextKm,
    nextDate: cell.nextDate,
    kmRemaining: cell.kmRemaining,
    daysRemaining: cell.daysRemaining,
    referenceKm: cell.referenceKm,
    referenceDate: cell.referenceDate,
    referenceType: cell.referenceType,
    lastVerificationOn: cell.lastVerificationOn,
    openMaintenanceId: cell.openMaintenanceId,
    openMaintenanceCode: cell.openMaintenanceCode,
    ...extra,
  };
}

export function PredictivePanel({ predictive, options, catalog, perms, actions }: PredictivePanelProps) {
  const { overview, filters } = predictive;
  const params = useSearchParams();
  const view: View = params.get("visao") === "matriz" ? "matriz" : "alertas";
  const pending = actions.pending;
  const [drawerId, setDrawerId] = React.useState<string | null>(null);
  const [verifyId, setVerifyId] = React.useState<string | null>(null);
  const [generateId, setGenerateId] = React.useState<string | null>(null);

  const canVerify = perms.managePredictive;
  // O banco exige maintenance.manage_predictive para gerar; agendar na mesma chamada exige também schedule.
  const canGenerate = perms.managePredictive;
  const today = overview?.today ?? "";

  const set = (patch: Record<string, string | null>) => actions.navigate({ ...patch, pagina: null });

  // Tudo o que a tela sabe de cada ciclo — a gaveta e os diálogos leem daqui,
  // e o dado acompanha a releitura da página depois de uma escrita.
  const contexts = React.useMemo(() => {
    const map = new Map<string, PredictiveCycleContext>();
    if (!overview) return map;
    const columns = new Map(overview.columns.map((c) => [c.itemId, c]));
    for (const row of overview.rows) {
      for (const [itemId, cell] of Object.entries(row.cells)) {
        const column = columns.get(itemId);
        map.set(
          cell.cycleId,
          toContext(cell, {
            vehicleLabel: vehicleLabel(row.licensePlate, row.fleetCode),
            cluster: column?.cluster ?? null,
            item: column?.item ?? null,
            planName: row.planName,
            currentKm: row.currentKm,
          }),
        );
      }
    }
    for (const alert of overview.alerts) {
      if (map.has(alert.cycleId)) continue;
      map.set(
        alert.cycleId,
        toContext(alert, {
          vehicleLabel: vehicleLabel(alert.licensePlate, alert.fleetCode),
          cluster: alert.cluster,
          item: alert.item,
          planName: alert.planName,
          currentKm: alert.currentKm,
        }),
      );
    }
    return map;
  }, [overview]);

  const contextOf = (id: string | null) => (id ? contexts.get(id) ?? null : null);

  // ------------------------------------------------------------------ filtros
  const clusters = React.useMemo(
    () => catalog.clusters.slice().sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, "pt-BR")),
    [catalog.clusters],
  );
  const vehicleFilterLabel = React.useMemo(() => {
    if (!filters.vehicle) return null;
    const row = overview?.rows.find((r) => r.vehicleId === filters.vehicle);
    return row ? vehicleLabel(row.licensePlate, row.fleetCode) : "Veículo selecionado";
  }, [filters.vehicle, overview]);

  const anyFilter = Boolean(
    filters.q || filters.operation || filters.cluster || filters.status || filters.execution || filters.vehicle,
  );
  const clearFilters = () =>
    set({ q: null, operacao: null, cluster: null, pd_situacao: null, pd_execucao: null, veiculo: null });

  const filterBar = (
    <FilterBar className="items-end gap-3" label="Filtros da preditiva" data-testid="maintenance-predictive-filters">
      <FilterField label="Situação técnica">
        <NativeSelect
          fieldSize="sm"
          aria-label="Filtrar por situação técnica"
          value={filters.status ?? ""}
          disabled={pending}
          onChange={(e) => set({ pd_situacao: e.target.value || null })}
          className="min-w-[10rem]"
        >
          <option value="">Todas</option>
          {TECH_ORDER.map((code) => (
            <option key={code} value={code}>{PREDICTIVE_STATUS_LABEL[code]}</option>
          ))}
        </NativeSelect>
      </FilterField>
      <FilterField label="Execução">
        <NativeSelect
          fieldSize="sm"
          aria-label="Filtrar por situação de execução"
          value={filters.execution ?? ""}
          disabled={pending}
          onChange={(e) => set({ pd_execucao: e.target.value || null })}
          className="min-w-[11rem]"
        >
          <option value="">Todas</option>
          <option value={PROGRAMMED}>Programadas (há agendar + agendadas)</option>
          {EXEC_ORDER.map((code) => (
            <option key={code} value={code}>{EXECUTION_LABEL[code]}</option>
          ))}
        </NativeSelect>
      </FilterField>
      <FilterField label="Cluster">
        <NativeSelect
          fieldSize="sm"
          aria-label="Filtrar por cluster técnico"
          value={filters.cluster ?? ""}
          disabled={pending}
          onChange={(e) => set({ cluster: e.target.value || null, servico: null })}
          className="min-w-[10rem]"
        >
          <option value="">Todos</option>
          {clusters.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </NativeSelect>
      </FilterField>
      <FilterField label="Operação">
        <NativeSelect
          fieldSize="sm"
          aria-label="Filtrar por operação"
          value={filters.operation ?? ""}
          disabled={pending}
          onChange={(e) => set({ operacao: e.target.value || null, uf: null, cidade: null })}
          className="min-w-[11rem]"
        >
          <option value="">Todas</option>
          {options.operations.map((o) => (
            <option key={o.id} value={o.id}>{o.name}</option>
          ))}
        </NativeSelect>
      </FilterField>
      <FilterField label="Veículo, cluster ou item" className="min-w-[11rem] flex-1 sm:max-w-[16rem]">
        <SearchField
          key={filters.q ?? ""}
          size="sm"
          aria-label="Buscar por placa, frota, cluster ou item (Enter para aplicar)"
          defaultValue={filters.q ?? ""}
          placeholder="SNT8J46, Freios…"
          onKeyDown={(e) => {
            if (e.key === "Enter") set({ q: (e.target as HTMLInputElement).value.trim() || null });
          }}
          onClear={() => set({ q: null })}
        />
      </FilterField>
      {vehicleFilterLabel ? (
        <FilterChip label="Veículo" value={vehicleFilterLabel} onRemove={() => set({ veiculo: null })} disabled={pending} />
      ) : null}
      {anyFilter ? (
        <Button variant="ghost" size="sm" leadingIcon={<X />} onClick={clearFilters} disabled={pending}>
          Limpar filtros
        </Button>
      ) : null}
    </FilterBar>
  );

  const explainer = (
    <Alert variant="info" icon={<Info aria-hidden />} data-testid="maintenance-predictive-explainer">
      <AlertTitle>Situação técnica e execução são coisas diferentes</AlertTitle>
      <AlertDescription>
        A situação técnica é a banda de KM/dias até o próximo marco do item (vale o que vencer primeiro). A execução é
        a manutenção do item: há agendar, agendada, em execução ou aguardando corretiva. Um item pode estar crítico e
        já agendado. Intervalos por horas de motor estão cadastrados nos planos, mas ainda não entram no cálculo.
      </AlertDescription>
    </Alert>
  );

  if (!overview) {
    return (
      <div className="flex flex-col gap-4" data-testid="maintenance-predictive-panel">
        {filterBar}
        <ErrorState
          title="Não foi possível carregar a preditiva."
          description="A leitura dos ciclos preditivos falhou. Tente de novo em instantes."
          onRetry={actions.refresh}
          retryLabel="Tentar de novo"
          retrying={pending}
        />
      </div>
    );
  }

  const s = overview.summary;
  const techTile = (code: PredictiveStatus, label: string, value: number | undefined) => (
    <StatTile
      key={code}
      label={label}
      value={formatInt(value ?? 0)}
      unit="itens"
      tone={PREDICTIVE_STATUS_TONE[code]}
      onClick={() => set({ pd_situacao: filters.status === code ? null : code })}
      active={filters.status === code}
      disabled={pending}
      testId={`maintenance-predictive-kpi-${code}`}
    />
  );
  const execTile = (code: string, label: string, value: number | undefined, tone: "danger" | "info" | "progress") => (
    <StatTile
      key={code}
      label={label}
      value={formatInt(value ?? 0)}
      unit="itens"
      tone={tone}
      onClick={() => set({ pd_execucao: filters.execution === code ? null : code })}
      active={filters.execution === code}
      disabled={pending}
      testId={`maintenance-predictive-exec-${code.replace(",", "-")}`}
    />
  );

  const coverage = overview.coverage;
  const coveragePct = coverage?.coveragePct ?? null;
  const total = view === "alertas" ? overview.alerts.length : overview.rows.length;

  return (
    <div className="flex flex-col gap-4" data-testid="maintenance-predictive-panel">
      {filterBar}
      {explainer}

      <section aria-labelledby="predictive-tech-title" className="flex flex-col gap-2">
        <h3 id="predictive-tech-title" className="text-label font-semibold text-fg">
          Situação técnica <span className="font-normal text-fg-muted">· banda de KM/dias</span>
        </h3>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-8">
          <StatTile label="Itens monitorados" value={formatInt(s.itemsMonitored ?? 0)} unit="no recorte" />
          {techTile("critical", "Críticos", s.critical)}
          {techTile("due", "Vencidos", s.due)}
          {techTile("to_schedule", "A programar", s.toSchedule)}
          {techTile("upcoming", "Próximos", s.upcoming)}
          {techTile("ok", "Em dia", s.ok)}
          {techTile("initial_inspection", "Inspeção inicial", s.initialInspection)}
          {techTile("no_km", "Sem KM", s.noKm)}
        </div>
      </section>

      <section aria-labelledby="predictive-exec-title" className="flex flex-col gap-2">
        <h3 id="predictive-exec-title" className="text-label font-semibold text-fg">
          Execução e previsão <span className="font-normal text-fg-muted">· manutenção do item</span>
        </h3>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
          {execTile("awaiting_corrective", "Aguardando corretiva", s.awaitingCorrective, "danger")}
          {execTile(PROGRAMMED, "Programadas", s.scheduled, "info")}
          {execTile("in_progress", "Em execução", s.inProgress, "progress")}
          <StatTile label="Em monitoramento" value={formatInt(s.monitoring ?? 0)} unit="itens" hint="com alvo reduzido" />
          <StatTile
            label="Previsão por KM"
            value={formatInt(s.forecastKm ?? 0)}
            unit="itens"
            hint={`nos próximos ${formatInt(s.forecastKmWindow ?? 0)} km`}
          />
          <StatTile
            label="Previsão por data"
            value={formatInt(s.forecastDays ?? 0)}
            unit="itens"
            hint={`nos próximos ${formatInt(s.forecastDaysWindow ?? 0)} dias`}
          />
        </div>
      </section>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <section className="flex flex-col gap-2 rounded-md border border-border bg-surface p-3" aria-labelledby="predictive-coverage-title">
          <h3 id="predictive-coverage-title" className="text-label font-semibold text-fg">Cobertura do plano técnico</h3>
          <p className="flex items-baseline gap-2">
            <span className="text-h2 font-bold text-fg tabular-nums">
              {coveragePct == null ? "Sem base" : `${pct1.format(coveragePct)}%`}
            </span>
            <span className="text-caption text-fg-muted">
              {formatInt(coverage?.coveredVehicles ?? 0)} de {formatInt(coverage?.activeVehicles ?? 0)} veículos ativos
            </span>
          </p>
          <div className="h-1.5 w-full overflow-hidden rounded-xs bg-surface-tertiary" aria-hidden>
            <div className="h-full rounded-xs bg-primary" style={{ width: `${Math.min(100, Math.max(0, coveragePct ?? 0))}%` }} />
          </div>
          <p className="text-caption text-fg-muted">
            {formatInt(coverage?.uncoveredVehicles ?? 0)} veículo(s) ativo(s) sem plano técnico aplicável — sem plano, não
            há ciclo preditivo.
          </p>
        </section>
        <section className="flex flex-col gap-2 rounded-md border border-border bg-surface p-3" aria-labelledby="predictive-clusters-title">
          <h3 id="predictive-clusters-title" className="text-label font-semibold text-fg">
            Clusters em atenção <span className="font-normal text-fg-muted">· críticos e vencidos</span>
          </h3>
          {overview.criticalClusters.length === 0 ? (
            <p className="text-body-sm text-fg-muted">Nenhum cluster com itens críticos, vencidos ou a programar.</p>
          ) : (
            <ul className="flex flex-col divide-y divide-border-subtle">
              {overview.criticalClusters.slice(0, 8).map((entry) => {
                const counts = clusterCounts(entry);
                const clusterId = catalog.clusters.find((c) => c.name === entry.cluster)?.id;
                const text = (
                  <>
                    <span className="min-w-0 truncate text-body-sm text-fg">{entry.cluster}</span>
                    <span className="flex shrink-0 items-center gap-2 text-caption tabular-nums">
                      <span className="text-danger-soft-fg">{formatInt(counts.critical)} crít./venc.</span>
                      {counts.toSchedule != null ? (
                        <span className="text-fg-muted">{formatInt(counts.toSchedule)} a programar</span>
                      ) : null}
                    </span>
                  </>
                );
                return (
                  <li key={entry.cluster} className="py-1 first:pt-0 last:pb-0">
                    {clusterId ? (
                      <button
                        type="button"
                        className="flex w-full items-center justify-between gap-3 rounded-xs py-0.5 text-left hfm-transition hfm-focus-ring hover:bg-hover-overlay"
                        onClick={() => set({ cluster: filters.cluster === clusterId ? null : clusterId })}
                        aria-pressed={filters.cluster === clusterId}
                        aria-label={`Filtrar pelo cluster ${entry.cluster}`}
                        disabled={pending}
                      >
                        {text}
                      </button>
                    ) : (
                      <div className="flex items-center justify-between gap-3 py-0.5">{text}</div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>

      <section className="flex flex-col gap-3 rounded-md border border-border bg-surface p-3 sm:p-4" aria-label="Alertas e matriz preditiva">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div role="group" aria-label="Visão da preditiva" className="inline-flex max-w-full flex-wrap gap-1 rounded-md border border-border bg-surface-secondary p-0.5">
            <ViewButton pressed={view === "alertas"} disabled={pending} onClick={() => set({ visao: null })} testId="maintenance-predictive-view-alerts">
              Alertas <span className="tabular-nums text-fg-muted">({formatInt(overview.alerts.length)})</span>
            </ViewButton>
            <ViewButton pressed={view === "matriz"} disabled={pending} onClick={() => set({ visao: "matriz" })} testId="maintenance-predictive-view-matrix">
              Matriz veículo × item <span className="tabular-nums text-fg-muted">({formatInt(overview.rows.length)})</span>
            </ViewButton>
          </div>
          <p className="text-caption text-fg-muted">
            {view === "alertas"
              ? "Priorizados pelo servidor: situação técnica, depois menor saldo de KM."
              : "Selecione uma célula para o histórico do item."}
          </p>
        </div>

        {view === "alertas" ? (
          <AlertsTable
            alerts={overview.alerts}
            total={total}
            anyFilter={anyFilter}
            canVerify={canVerify}
            canGenerate={canGenerate}
            pending={pending}
            actions={actions}
            onHistory={setDrawerId}
            onVerify={setVerifyId}
            onGenerate={setGenerateId}
            onClear={clearFilters}
          />
        ) : (
          <MatrixTable overview={overview} total={total} anyFilter={anyFilter} pending={pending} actions={actions} onOpen={setDrawerId} onClear={clearFilters} />
        )}
      </section>

      <PredictiveCycleDrawer
        cycleId={drawerId}
        context={contextOf(drawerId)}
        today={today}
        perms={perms}
        onOpenChange={(open) => {
          if (!open) setDrawerId(null);
        }}
        onOpenMaintenance={actions.openMaintenance}
        onChanged={actions.refresh}
        onRegisterVerification={
          canVerify
            ? (id) => {
                setDrawerId(null);
                setVerifyId(id);
              }
            : undefined
        }
      />

      {canVerify ? (
        <PredictiveVerificationDialog
          cycleId={verifyId}
          context={contextOf(verifyId)}
          today={today}
          catalog={catalog}
          onOpenChange={(open) => {
            if (!open) setVerifyId(null);
          }}
          onDone={actions.refresh}
          onOpenMaintenance={actions.openMaintenance}
        />
      ) : null}

      {canGenerate ? (
        <GenerateDialog
          cycleId={generateId}
          context={contextOf(generateId)}
          today={today}
          catalog={catalog}
          canSchedule={perms.schedule}
          onOpenChange={(open) => {
            if (!open) setGenerateId(null);
          }}
          actions={actions}
        />
      ) : null}
    </div>
  );
}

function ViewButton({
  pressed, disabled, onClick, children, testId,
}: {
  pressed: boolean;
  disabled: boolean;
  onClick: () => void;
  children: React.ReactNode;
  testId: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      disabled={disabled}
      onClick={onClick}
      data-testid={testId}
      className={cn(
        "inline-flex h-8 items-center gap-1 rounded-sm px-2.5 text-body-sm font-medium hfm-transition hfm-focus-ring",
        "disabled:pointer-events-none disabled:opacity-55",
        pressed ? "bg-surface text-fg shadow-sm" : "text-fg-secondary hover:bg-hover-overlay hover:text-fg",
      )}
    >
      {children}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Alertas
// ---------------------------------------------------------------------------

function AlertsTable({
  alerts, total, anyFilter, canVerify, canGenerate, pending, actions, onHistory, onVerify, onGenerate, onClear,
}: {
  alerts: PredictiveAlert[];
  total: number;
  anyFilter: boolean;
  canVerify: boolean;
  canGenerate: boolean;
  pending: boolean;
  actions: PanelActions;
  onHistory: (cycleId: string) => void;
  onVerify: (cycleId: string) => void;
  onGenerate: (cycleId: string) => void;
  onClear: () => void;
}) {
  const { page, pageSize, start, pageSizes } = useUrlPage(total);
  if (alerts.length === 0) {
    return (
      <EmptyState
        variant="panel"
        size="sm"
        title="Nenhum item em alerta"
        description={
          anyFilter
            ? "Nenhum item crítico, vencido, a programar, próximo, em inspeção inicial ou aguardando corretiva corresponde aos filtros."
            : "Nenhum item crítico, vencido, a programar, próximo, em inspeção inicial ou aguardando corretiva."
        }
        action={
          anyFilter ? (
            <Button variant="secondary" size="sm" leadingIcon={<X />} onClick={onClear}>
              Limpar filtros
            </Button>
          ) : undefined
        }
      />
    );
  }
  const rows = alerts.slice(start, start + pageSize);

  return (
    <>
      <TableContainer tabIndex={0} data-testid="maintenance-predictive-alerts">
        <Table layout="fixed" style={{ minWidth: "90rem" }}>
          <TableHeader>
            <TableRow>
              <TableHead className="sticky left-0 z-10 w-[10rem] border-r border-border bg-surface-secondary sm:w-[12rem]">
                Veículo
              </TableHead>
              <TableHead className="w-[15rem]">Item técnico</TableHead>
              <TableHead className="w-[10rem]">Situação técnica</TableHead>
              <TableHead className="w-[10.5rem]">Execução</TableHead>
              <TableHead className="w-[8.5rem]">Conformidade</TableHead>
              <TableHead className="w-[9rem]">Próximo marco</TableHead>
              <TableHead className="w-[10rem]">Saldo</TableHead>
              <TableHead className="w-[12rem]">Referência</TableHead>
              <TableHead className="w-[9rem]">Manutenção</TableHead>
              <TableHead className="w-[3.5rem]">
                <span className="sr-only">Ações</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((a) => {
              const vehicle = vehicleLabel(a.licensePlate, a.fleetCode);
              return (
                <TableRow key={a.cycleId} className="align-top" data-testid="maintenance-predictive-alert">
                  <TableCell className="sticky left-0 z-[1] border-r border-border bg-surface py-2 align-top">
                    <p className="truncate text-label font-semibold text-fg" title={vehicle}>
                      {a.fleetCode ?? "—"} <span className="font-normal text-fg-muted">{a.licensePlate ?? ""}</span>
                    </p>
                    <p className="truncate text-caption text-fg-muted">{a.operationName ?? "Sem operação"}</p>
                    <p className="truncate text-caption text-fg-muted">KM {formatKm(a.currentKm)}</p>
                  </TableCell>
                  <TableCell className="py-2 align-top">
                    <button
                      type="button"
                      className="block max-w-full truncate rounded-xs text-left font-medium text-link underline-offset-2 hover:underline hfm-focus-ring"
                      onClick={() => onHistory(a.cycleId)}
                      title={`${a.item} — abrir histórico`}
                    >
                      {a.item}
                    </button>
                    <p className="truncate text-caption text-fg-muted" title={`${a.cluster} · ${a.planName}`}>
                      {a.cluster} · {a.planName}
                    </p>
                  </TableCell>
                  <TableCell className="py-2 align-top">
                    <div className="flex flex-col items-start gap-1">
                      <PredictiveStatusBadge status={a.status} />
                      {a.monitoring ? (
                        <Badge size="sm" variant="neutral" appearance="outline" icon={<Eye />}>
                          Monitorando
                        </Badge>
                      ) : null}
                    </div>
                  </TableCell>
                  <TableCell className="py-2 align-top">
                    <ExecutionBadge execution={a.execution} />
                  </TableCell>
                  <TableCell className="py-2 align-top text-fg-secondary">{CONFORMITY_LABEL[a.conformity] ?? a.conformity}</TableCell>
                  <TableCell className="py-2 align-top tabular-nums">
                    <p className="text-fg">{a.nextKm != null ? formatKm(a.nextKm) : "—"}</p>
                    <p className="text-caption text-fg-muted">{a.nextDate ? formatDate(a.nextDate) : "sem data"}</p>
                  </TableCell>
                  <TableCell className="py-2 align-top tabular-nums">
                    <p className={cn(a.kmRemaining != null && a.kmRemaining < 0 ? "text-danger-soft-fg" : "text-fg")}>
                      {remainingKmText(a.kmRemaining)}
                    </p>
                    <p className={cn("text-caption", a.daysRemaining != null && a.daysRemaining < 0 ? "text-danger-soft-fg" : "text-fg-muted")}>
                      {remainingDaysText(a.daysRemaining)}
                    </p>
                  </TableCell>
                  <TableCell className="py-2 align-top">
                    <p className="truncate text-fg">{REFERENCE_TYPE_LABEL[a.referenceType] ?? a.referenceType}</p>
                    <p className="truncate text-caption text-fg-muted">
                      {[a.referenceDate ? formatDate(a.referenceDate) : null, a.referenceKm != null ? formatKm(a.referenceKm) : null]
                        .filter(Boolean)
                        .join(" · ") || "—"}
                    </p>
                  </TableCell>
                  <TableCell className="py-2 align-top">
                    {a.openMaintenanceId ? (
                      <button
                        type="button"
                        className="rounded-xs font-semibold text-link underline-offset-2 hover:underline hfm-focus-ring"
                        onClick={() => actions.openMaintenance(a.openMaintenanceId!)}
                        aria-label={`Abrir a manutenção ${a.openMaintenanceCode ?? ""} de ${a.item} em ${vehicle}`}
                      >
                        {a.openMaintenanceCode ?? "Abrir"}
                      </button>
                    ) : (
                      <span className="text-fg-muted">—</span>
                    )}
                  </TableCell>
                  <TableCell className="px-1 py-1.5 align-top">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <IconButton label={`Ações de ${a.item} em ${vehicle}`} size="sm" variant="ghost" disabled={pending}>
                          <MoreHorizontal aria-hidden />
                        </IconButton>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="min-w-56">
                        <DropdownMenuLabel className="truncate">{a.item}</DropdownMenuLabel>
                        <DropdownMenuSeparator />
                        {canVerify ? (
                          <DropdownMenuItem onSelect={() => onVerify(a.cycleId)}>
                            <ClipboardCheck aria-hidden /> Registrar verificação
                          </DropdownMenuItem>
                        ) : null}
                        {canGenerate && !a.openMaintenanceId ? (
                          <DropdownMenuItem onSelect={() => onGenerate(a.cycleId)}>
                            <Wrench aria-hidden /> Gerar manutenção
                          </DropdownMenuItem>
                        ) : null}
                        <DropdownMenuItem onSelect={() => onHistory(a.cycleId)}>
                          <History aria-hidden /> Histórico
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </TableContainer>
      {total > pageSizes[0] ? (
        <Pagination
          page={page}
          pageSize={pageSize}
          total={total}
          pageSizeOptions={pageSizes}
          disabled={pending}
          onPageChange={(p) => actions.navigate({ pagina: String(p) })}
          onPageSizeChange={(size) => actions.navigate({ por_pagina: String(size), pagina: null })}
          label="Páginas dos alertas preditivos"
        />
      ) : null}
    </>
  );
}

// ---------------------------------------------------------------------------
// Matriz veículo × item
// ---------------------------------------------------------------------------

function MatrixTable({
  overview, total, anyFilter, pending, actions, onOpen, onClear,
}: {
  overview: PredictiveOverview;
  total: number;
  anyFilter: boolean;
  pending: boolean;
  actions: PanelActions;
  onOpen: (cycleId: string) => void;
  onClear: () => void;
}) {
  const { page, pageSize, start, pageSizes } = useUrlPage(total);
  const columns = overview.columns;
  // Cabeçalho agrupado: o servidor já ordena por cluster e item.
  const groups = React.useMemo(() => {
    const out: { clusterId: string; cluster: string; span: number; first: string }[] = [];
    for (const c of columns) {
      const last = out[out.length - 1];
      if (last && last.clusterId === c.clusterId) last.span += 1;
      else out.push({ clusterId: c.clusterId, cluster: c.cluster, span: 1, first: c.itemId });
    }
    return out;
  }, [columns]);
  const groupStarts = React.useMemo(() => new Set(groups.map((g) => g.first)), [groups]);

  if (overview.rows.length === 0 || columns.length === 0) {
    return (
      <EmptyState
        variant="panel"
        size="sm"
        title="Nenhum veículo com plano técnico no recorte"
        description={
          anyFilter
            ? "Nenhum ciclo preditivo corresponde aos filtros. Ajuste ou limpe os filtros."
            : "Não há ciclos preditivos ativos. Aprove um plano técnico para o tipo/modelo e sincronize os ciclos."
        }
        action={
          anyFilter ? (
            <Button variant="secondary" size="sm" leadingIcon={<X />} onClick={onClear}>
              Limpar filtros
            </Button>
          ) : undefined
        }
      />
    );
  }
  const rows = overview.rows.slice(start, start + pageSize);

  return (
    <>
      <ul className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-caption text-fg-muted" aria-label="Legenda da matriz">
        {TECH_ORDER.map((code) => (
          <li key={code}>
            <PredictiveStatusBadge status={code} size="sm" />
          </li>
        ))}
        <li className="inline-flex items-center gap-1">
          <Eye className="size-3.5" aria-hidden /> em monitoramento
        </li>
        <li className="inline-flex items-center gap-1">
          <Wrench className="size-3.5" aria-hidden /> execução (manutenção do item)
        </li>
      </ul>
      <TableContainer tabIndex={0} stickyHeader maxHeight="72vh" data-testid="maintenance-predictive-matrix">
        <Table layout="fixed" style={{ minWidth: `${13 + columns.length * 9.5}rem` }}>
          <colgroup>
            <col className="w-[10rem] sm:w-[13rem]" />
            {columns.map((c) => (
              <col key={c.itemId} className="w-[9.5rem]" />
            ))}
          </colgroup>
          <TableHeader>
            <TableRow>
              <TableHead rowSpan={2} className="left-0 z-20! border-r border-border align-bottom">
                Veículo
              </TableHead>
              {groups.map((g) => (
                <TableHead
                  key={g.clusterId}
                  colSpan={g.span}
                  scope="colgroup"
                  className="border-l border-border text-center"
                  title={g.cluster}
                >
                  <span className="block truncate">{g.cluster}</span>
                </TableHead>
              ))}
            </TableRow>
            <TableRow>
              {columns.map((c) => (
                <TableHead
                  key={c.itemId}
                  className={cn("top-(--table-header-height)! font-medium", groupStarts.has(c.itemId) && "border-l border-border")}
                  title={`${c.cluster} · ${c.item}`}
                >
                  <span className="block truncate">{c.item}</span>
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => {
              const vehicle = vehicleLabel(row.licensePlate, row.fleetCode);
              return (
                <TableRow key={row.vehicleId} className="align-top" data-testid="maintenance-predictive-matrix-row">
                  <TableCell className="sticky left-0 z-[1] border-r border-border bg-surface py-2 align-top">
                    <p className="truncate text-label font-semibold text-fg" title={vehicle}>
                      {row.fleetCode ?? "—"} <span className="font-normal text-fg-muted">{row.licensePlate ?? ""}</span>
                    </p>
                    <p className="truncate text-caption text-fg-muted" title={[row.typeName, row.modelName].filter(Boolean).join(" · ")}>
                      {[row.typeName, row.modelName].filter(Boolean).join(" · ") || "—"}
                    </p>
                    <p className="truncate text-caption text-fg-muted" title={row.planName ?? undefined}>
                      {formatKm(row.currentKm)}
                      {row.operationName ? ` · ${row.operationName}` : ""}
                    </p>
                  </TableCell>
                  {columns.map((c) => {
                    const cell = row.cells[c.itemId];
                    return (
                      <TableCell
                        key={c.itemId}
                        className={cn("px-1 py-1 align-top", groupStarts.has(c.itemId) && "border-l border-border-subtle")}
                      >
                        {cell ? (
                          <MatrixCell cell={cell} item={c.item} vehicle={vehicle} onOpen={onOpen} />
                        ) : (
                          <span className="flex min-h-[4.25rem] items-center justify-center text-fg-muted">
                            <span aria-hidden>—</span>
                            <span className="sr-only">{c.item} não se aplica a {vehicle}</span>
                          </span>
                        )}
                      </TableCell>
                    );
                  })}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </TableContainer>
      {total > pageSizes[0] ? (
        <Pagination
          page={page}
          pageSize={pageSize}
          total={total}
          pageSizeOptions={pageSizes}
          disabled={pending}
          onPageChange={(p) => actions.navigate({ pagina: String(p) })}
          onPageSizeChange={(size) => actions.navigate({ por_pagina: String(size), pagina: null })}
          label="Páginas da matriz preditiva"
        />
      ) : null}
    </>
  );
}

function MatrixCell({
  cell, item, vehicle, onOpen,
}: {
  cell: PredictiveCell;
  item: string;
  vehicle: string;
  onOpen: (cycleId: string) => void;
}) {
  const tone = PREDICTIVE_STATUS_TONE[cell.status] ?? "neutral";
  const executing = cell.execution !== "not_programmed";
  const label = [
    `${item} em ${vehicle}`,
    `situação técnica: ${PREDICTIVE_STATUS_LABEL[cell.status] ?? cell.status}`,
    `execução: ${EXECUTION_LABEL[cell.execution] ?? cell.execution}`,
    cell.nextKm != null ? `próximo marco ${formatKm(cell.nextKm)}` : null,
    cell.nextDate ? `até ${formatDate(cell.nextDate)}` : null,
    cell.monitoring ? "em monitoramento" : null,
    cell.openMaintenanceCode ? `manutenção ${cell.openMaintenanceCode}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <button
      type="button"
      onClick={() => onOpen(cell.cycleId)}
      aria-label={`${label}. Abrir histórico.`}
      title={label}
      data-status={cell.status}
      className={cn(
        "flex min-h-[4.25rem] w-full flex-col items-start gap-0.5 rounded-sm border border-border-subtle border-l-2 bg-surface px-1.5 py-1 text-left text-caption",
        "hfm-transition hfm-focus-ring hover:bg-hover-overlay",
        TONE_BORDER[tone],
      )}
    >
      <PredictiveStatusBadge status={cell.status} size="sm" />
      <span className="tabular-nums text-fg-secondary">{cell.nextKm != null ? formatKm(cell.nextKm) : "—"}</span>
      {cell.nextDate ? <span className="tabular-nums text-fg-muted">{formatDate(cell.nextDate)}</span> : null}
      {cell.monitoring || executing ? (
        <span className="flex max-w-full items-center gap-1 text-fg-muted">
          {cell.monitoring ? <Eye className="size-3 shrink-0" aria-hidden /> : null}
          {executing ? (
            <>
              <Wrench className="size-3 shrink-0" aria-hidden />
              <span className="truncate">{EXECUTION_LABEL[cell.execution]}</span>
            </>
          ) : null}
        </span>
      ) : null}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Gerar manutenção preditiva (idempotente)
// ---------------------------------------------------------------------------

function GenerateDialog({
  cycleId, context, today, catalog, canSchedule, onOpenChange, actions,
}: {
  cycleId: string | null;
  context: PredictiveCycleContext | null;
  today: string;
  catalog: MaintenanceCatalog;
  canSchedule: boolean;
  onOpenChange: (open: boolean) => void;
  actions: PanelActions;
}) {
  return (
    <Dialog open={Boolean(cycleId)} onOpenChange={onOpenChange}>
      <DialogContent size="md" data-testid="maintenance-predictive-generate-dialog">
        {cycleId ? (
          <GenerateForm
            key={cycleId}
            cycleId={cycleId}
            context={context}
            today={today}
            catalog={catalog}
            canSchedule={canSchedule}
            onOpenChange={onOpenChange}
            actions={actions}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function GenerateForm({
  cycleId, context, today, catalog, canSchedule, onOpenChange, actions,
}: {
  cycleId: string;
  context: PredictiveCycleContext | null;
  today: string;
  catalog: MaintenanceCatalog;
  canSchedule: boolean;
  onOpenChange: (open: boolean) => void;
  actions: PanelActions;
}) {
  const { toast } = useToast();
  const { history, error, loading, reload } = useCycleHistory(cycleId);
  const [busy, startTransition] = React.useTransition();
  const [date, setDate] = React.useState("");
  const [serviceId, setServiceId] = React.useState("");
  const [tried, setTried] = React.useState(false);

  const needsService = Boolean(history) && !history?.item.serviceId;
  const cluster = context?.cluster ?? null;
  const services = React.useMemo(() => servicesForCluster(catalog.services, cluster), [catalog.services, cluster]);
  const serviceMissing = needsService && !serviceId;

  const submit = () => {
    setTried(true);
    if (serviceMissing) return;
    startTransition(async () => {
      const result = await generatePredictiveMaintenance(cycleId, {
        scheduledDate: canSchedule ? date || null : null,
        serviceIds: serviceId ? [serviceId] : undefined,
      });
      if (!result.ok || !result.data) {
        toast({ title: result.error ?? "Não foi possível gerar a manutenção preditiva.", variant: "danger" });
        return;
      }
      const { id, code, created } = result.data;
      onOpenChange(false);
      if (created === false) {
        toast({ title: `Já existia a manutenção ${code}.`, description: "Nenhuma nova foi criada para este item.", variant: "info" });
      } else {
        toast({ title: `Manutenção ${code} gerada.`, description: context?.item ?? undefined, variant: "success" });
      }
      actions.refresh();
      actions.openMaintenance(id);
    });
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>Gerar manutenção preditiva</DialogTitle>
        <DialogDescription>
          {[context?.vehicleLabel, context?.cluster, history?.item.name ?? context?.item].filter(Boolean).join(" · ") ||
            "Ciclo preditivo"}
        </DialogDescription>
      </DialogHeader>
      <DialogBody className="flex flex-col gap-4" aria-busy={loading || busy}>
        {context ? (
          <div className="flex flex-wrap items-center gap-2 text-caption text-fg-muted">
            <span>Situação técnica</span>
            <PredictiveStatusBadge status={context.status} />
            <span className="ml-1">Execução</span>
            <ExecutionBadge execution={context.execution} />
          </div>
        ) : null}
        {loading && !history ? <Skeleton className="h-16 w-full" /> : null}
        {error ? (
          <Alert
            variant="danger"
            action={
              <Button size="sm" variant="outline" leadingIcon={<RotateCw />} onClick={reload}>
                Tentar de novo
              </Button>
            }
          >
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        {canSchedule ? (
          <FormField
            label="Data de agendamento"
            labelHint="Opcional"
            helperText="Sem data, a manutenção nasce como Há agendar; com data, já nasce agendada."
          >
            <DateInput value={date} min={today || undefined} onChange={(e) => setDate(e.target.value)} />
          </FormField>
        ) : null}
        {needsService ? (
          <FormField
            label="Serviço"
            required
            helperText="O item do plano não tem serviço padrão."
            error={tried && serviceMissing ? "Escolha o serviço da manutenção." : undefined}
          >
            <NativeSelect value={serviceId} onChange={(e) => setServiceId(e.target.value)}>
              <option value="">Escolha…</option>
              {services.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} · {s.clusterName}
                </option>
              ))}
            </NativeSelect>
          </FormField>
        ) : null}
        <p className="text-caption text-fg-muted">
          A prioridade vem da criticidade do item. Se já houver manutenção aberta para o item, nenhuma nova é criada: a
          existente é aberta.
        </p>
      </DialogBody>
      <DialogFooter>
        <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={busy}>
          Cancelar
        </Button>
        <Button
          leadingIcon={<Wrench />}
          onClick={submit}
          loading={busy}
          disabled={loading && !history}
          data-testid="maintenance-predictive-generate-submit"
        >
          Gerar manutenção
        </Button>
      </DialogFooter>
    </>
  );
}
