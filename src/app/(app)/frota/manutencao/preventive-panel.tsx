"use client";

import * as React from "react";
import { useSearchParams } from "next/navigation";
import { AlertTriangle, CalendarPlus, History, RefreshCw, SlidersHorizontal, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DateInput } from "@/components/ui/date-input";
import {
  Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { FilterBar } from "@/components/ui/filter-bar";
import { FormField } from "@/components/ui/form-field";
import { Pagination } from "@/components/ui/pagination";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { SearchField } from "@/components/ui/search-field";
import type { StatusTone } from "@/components/ui/status-badge";
import { Table, TableBody, TableCell, TableContainer, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Alert, AlertDescription, AlertTitle } from "@/components/feedback/alert";
import { EmptyState } from "@/components/feedback/empty-state";
import { ErrorState } from "@/components/feedback/error-state";
import { useToast } from "@/components/feedback/toast";
import { NativeSelect } from "@/components/governance/selects";
import { PreventiveStatusBadge } from "@/components/maintenance/badges";
import { schedulePreventiveCycle, syncPreventiveCycles } from "@/lib/maintenance/actions";
import type { MaintenanceFilterOptions, PreventiveFilters } from "@/lib/maintenance/queries";
import {
  ADHERENCE_LABEL,
  formatDate,
  formatInt,
  formatKm,
  PREVENTIVE_STATUS_LABEL,
  PREVENTIVE_STATUS_TONE,
  STATUS_LABEL,
  vehicleLabel,
  type MaintenanceCatalog,
  type PreventiveCycleCell,
  type PreventiveMatrix,
  type PreventiveMatrixRow,
  type PreventiveStatus,
} from "@/lib/maintenance/types";
import type { MaintenancePerms, PanelActions } from "./shared";

/**
 * Manutenção → Preventiva.
 *
 * Veículos nas linhas, ciclos MP1..MPn nas colunas. Situação, marco, saldo e
 * aderência de cada ciclo chegam prontos do servidor (faixa de alerta e
 * tolerância do parâmetro); a tela só apresenta e chama as rotinas: gerar a
 * manutenção do ciclo (idempotente) e sincronizar os ciclos. A frota inativa
 * é histórico — consulta, sem geração.
 */

// ---------------------------------------------------------------------------
// Peças compartilhadas com a aba Preditiva
// ---------------------------------------------------------------------------

/** Borda esquerda por tom: o texto carrega o significado, a cor só acompanha. */
export const TONE_BORDER: Record<StatusTone, string> = {
  success: "border-l-success",
  warning: "border-l-warning",
  danger: "border-l-danger",
  info: "border-l-info",
  neutral: "border-l-border-strong",
  pending: "border-l-border-strong",
  progress: "border-l-accent",
};

/** Linha de acento no topo do indicador — o mesmo gesto do KpiCard. */
const TONE_TOP: Record<StatusTone, string | null> = {
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-danger",
  info: "bg-info",
  neutral: null,
  pending: null,
  progress: "bg-accent",
};

export function FilterField({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <label className={cn("flex min-w-0 flex-col gap-1", className)}>
      <span className="text-caption text-fg-muted">{label}</span>
      {children}
    </label>
  );
}

export interface StatTileProps {
  label: string;
  value: React.ReactNode;
  unit?: React.ReactNode;
  hint?: React.ReactNode;
  tone?: StatusTone;
  /** Indicador clicável: filtra a visão. `active` marca o filtro aplicado. */
  onClick?: () => void;
  active?: boolean;
  disabled?: boolean;
  testId?: string;
}

/** Indicador compacto. Clicável quando filtra; `aria-pressed` diz se está aplicado. */
export function StatTile({ label, value, unit, hint, tone, onClick, active = false, disabled, testId }: StatTileProps) {
  const accent = tone ? TONE_TOP[tone] : null;
  const body = (
    <>
      {accent ? <span aria-hidden className={cn("absolute inset-x-0 top-0 h-0.5", accent)} /> : null}
      <span className="text-caption font-medium text-fg-secondary">{label}</span>
      <span className="flex min-w-0 items-baseline gap-1">
        <span className="text-h2 font-semibold leading-none text-fg tabular-nums">{value}</span>
        {unit != null ? <span className="truncate text-caption text-fg-muted">{unit}</span> : null}
      </span>
      {hint != null ? <span className="text-caption text-fg-muted">{hint}</span> : null}
    </>
  );
  const base = cn(
    "relative flex min-h-[4.25rem] min-w-0 flex-col justify-between gap-1.5 overflow-hidden rounded-lg border border-border bg-surface-raised px-3 py-2.5 text-left shadow-card",
  );
  if (!onClick) {
    return (
      <div className={base} data-testid={testId}>
        {body}
      </div>
    );
  }
  return (
    <button
      type="button"
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
      data-testid={testId}
      className={cn(
        base,
        "hfm-transition hfm-focus-ring hover:border-border-strong hover:shadow-card-hover",
        "disabled:pointer-events-none disabled:opacity-55",
        active && "border-primary bg-primary-soft hover:border-primary hover:bg-primary-soft",
      )}
    >
      {body}
    </button>
  );
}

const PAGE_SIZES = [25, 50, 100, 200];
const DEFAULT_PAGE_SIZE = 50;

/** Página e tamanho vindos da URL (`pagina`, `por_pagina`), já limitados ao total. */
export function useUrlPage(total: number) {
  const params = useSearchParams();
  const requested = Number(params.get("por_pagina"));
  const pageSize = PAGE_SIZES.includes(requested) ? requested : DEFAULT_PAGE_SIZE;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(pageCount, Math.max(1, Number(params.get("pagina")) || 1));
  return { page, pageSize, start: (page - 1) * pageSize, pageSizes: PAGE_SIZES };
}

// ---------------------------------------------------------------------------
// Preventiva
// ---------------------------------------------------------------------------

export interface PreventivePanelProps {
  preventive: { matrix: PreventiveMatrix | null; filters: PreventiveFilters };
  options: MaintenanceFilterOptions;
  catalog: MaintenanceCatalog;
  perms: MaintenancePerms;
  actions: PanelActions;
}

const STATUS_ORDER: PreventiveStatus[] = ["critical", "due", "to_schedule", "not_reached", "completed", "no_km"];
const ACTIONABLE: PreventiveStatus[] = ["to_schedule", "due", "critical"];

const DIAGNOSTIC_LABEL: Record<string, string> = {
  no_rule: "Sem parâmetro preventivo para este tipo/modelo.",
  no_km: "Sem leitura oficial de KM: os marcos não podem ser avaliados.",
  no_cycles: "Ciclos MP ainda não gerados. Sincronize os ciclos.",
};

function diagnosticsOf(row: PreventiveMatrixRow): string[] {
  const list = (row.diagnostics ?? []).map((d) => DIAGNOSTIC_LABEL[d] ?? d);
  if (!row.hasRule) list.unshift(DIAGNOSTIC_LABEL.no_rule);
  return [...new Set(list)];
}

const pct1 = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const sign = (v: number) => (v > 0 ? "+" : v < 0 ? "−" : "");

function adherenceText(c: PreventiveCycleCell): string | null {
  if (!c.adherence) return null;
  const parts: string[] = [];
  if (c.adherenceKm != null) parts.push(`${sign(c.adherenceKm)}${formatInt(Math.abs(c.adherenceKm))} km`);
  if (c.adherencePct != null) parts.push(`${sign(c.adherencePct)}${pct1.format(Math.abs(c.adherencePct))}%`);
  const label = ADHERENCE_LABEL[c.adherence] ?? c.adherence;
  return parts.length ? `${label} · ${parts.join(" · ")}` : label;
}

function balance(c: PreventiveCycleCell): { text: string; title: string } {
  if (c.kmExceeded != null && c.kmExceeded > 0) {
    return { text: `+${formatInt(c.kmExceeded)} km`, title: `${formatInt(c.kmExceeded)} km além do marco` };
  }
  if (c.kmRemaining != null) {
    return { text: `faltam ${formatInt(c.kmRemaining)} km`, title: `Faltam ${formatInt(c.kmRemaining)} km para o marco` };
  }
  return { text: "saldo indisponível", title: "Sem KM para calcular o saldo" };
}

type ScheduleTarget = { cycle: PreventiveCycleCell; row: PreventiveMatrixRow };

export function PreventivePanel({ preventive, options, catalog, perms, actions }: PreventivePanelProps) {
  const { matrix, filters } = preventive;
  const { toast } = useToast();
  const [syncing, startSync] = React.useTransition();
  const [target, setTarget] = React.useState<ScheduleTarget | null>(null);
  const pending = actions.pending;

  const inactive = (matrix?.situation ?? filters.situation) === "inactive";
  // O banco exige maintenance.manage_preventive para gerar; agendar na mesma chamada exige também schedule.
  const canGenerate = !inactive && perms.managePreventive;
  const canSync = !inactive && (perms.managePreventive || perms.reprocess);

  const set = (patch: Record<string, string | null>) => actions.navigate({ ...patch, pagina: null });

  // ---------------------------------------------------------------- opções
  const models = React.useMemo(() => {
    const makes = new Map(options.makes.map((m) => [m.id, m.name]));
    return options.models
      .map((m) => ({ id: m.id, label: [makes.get(m.makeId), m.name].filter(Boolean).join(" ") }))
      .sort((a, b) => a.label.localeCompare(b.label, "pt-BR"));
  }, [options.makes, options.models]);

  const cities = React.useMemo(() => {
    const seen = new Map<number, { id: number; label: string; stateId: number }>();
    for (const c of options.coverage) {
      if (filters.operation && c.operationId !== filters.operation) continue;
      seen.set(c.cityId, { id: c.cityId, label: `${c.cityName}/${c.uf}`, stateId: c.stateId });
    }
    return [...seen.values()].sort((a, b) => a.label.localeCompare(b.label, "pt-BR"));
  }, [options.coverage, filters.operation]);

  const brs = React.useMemo(
    () =>
      options.brs.filter(
        (b) => (!filters.operation || b.operationId === filters.operation) && (!filters.city || String(b.cityId) === filters.city),
      ),
    [options.brs, filters.operation, filters.city],
  );

  const moreCount = [filters.model, filters.city, filters.br].filter(Boolean).length;
  const anyFilter = Boolean(
    filters.q || filters.status || filters.vehicleType || filters.model || filters.operation || filters.city || filters.br,
  );
  const clearFilters = () =>
    set({ q: null, mp_situacao: null, equipamento: null, modelo: null, operacao: null, cidade: null, br: null });

  // ---------------------------------------------------------------- matriz
  const rows = React.useMemo(() => matrix?.rows ?? [], [matrix]);
  const maxCycle = React.useMemo(
    () => rows.reduce((max, r) => r.cycles.reduce((m, c) => Math.max(m, c.number), max), 0),
    [rows],
  );
  const cycleNumbers = React.useMemo(() => Array.from({ length: maxCycle }, (_, i) => i + 1), [maxCycle]);
  const { page, pageSize, start, pageSizes } = useUrlPage(rows.length);
  const pageRows = rows.slice(start, start + pageSize);

  const sync = () =>
    startSync(async () => {
      const result = await syncPreventiveCycles();
      if (!result.ok) {
        toast({ title: result.error ?? "Não foi possível sincronizar os ciclos preventivos.", variant: "danger" });
        return;
      }
      const data = (result.data ?? {}) as { vehicles?: number; withRule?: number; withoutRule?: number };
      toast({
        title: "Ciclos preventivos sincronizados.",
        description:
          data.vehicles != null
            ? `${formatInt(data.vehicles)} veículos · ${formatInt(data.withRule ?? 0)} com parâmetro · ${formatInt(data.withoutRule ?? 0)} sem parâmetro`
            : undefined,
        variant: "success",
      });
      actions.refresh();
    });

  const filterBar = (
    <FilterBar className="items-end gap-3" label="Filtros da preventiva" data-testid="maintenance-preventive-filters">
      <FilterField label="Frota">
        <NativeSelect
          fieldSize="sm"
          aria-label="Frota ativa ou histórico da frota inativa"
          value={filters.situation ?? "active"}
          disabled={pending}
          onChange={(e) => set({ mp_frota: e.target.value === "inactive" ? "inactive" : null })}
          className="min-w-[10rem]"
        >
          <option value="active">Ativa</option>
          <option value="inactive">Inativa (histórico)</option>
        </NativeSelect>
      </FilterField>
      <FilterField label="Situação do ciclo">
        <NativeSelect
          fieldSize="sm"
          aria-label="Filtrar por situação do ciclo"
          value={filters.status ?? ""}
          disabled={pending}
          onChange={(e) => set({ mp_situacao: e.target.value || null })}
          className="min-w-[9.5rem]"
        >
          <option value="">Todas</option>
          {STATUS_ORDER.map((code) => (
            <option key={code} value={code}>{PREVENTIVE_STATUS_LABEL[code]}</option>
          ))}
        </NativeSelect>
      </FilterField>
      <FilterField label="Tipo de equipamento">
        <NativeSelect
          fieldSize="sm"
          aria-label="Filtrar por tipo de equipamento"
          value={filters.vehicleType ?? ""}
          disabled={pending}
          onChange={(e) => set({ equipamento: e.target.value || null })}
          className="min-w-[11rem]"
        >
          <option value="">Todos</option>
          {options.vehicleTypes.map((t) => (
            <option key={t.id} value={t.id}>{t.name}</option>
          ))}
        </NativeSelect>
      </FilterField>
      <FilterField label="Operação">
        <NativeSelect
          fieldSize="sm"
          aria-label="Filtrar por operação"
          value={filters.operation ?? ""}
          disabled={pending}
          onChange={(e) => set({ operacao: e.target.value || null, uf: null, cidade: null, br: null })}
          className="min-w-[11rem]"
        >
          <option value="">Todas</option>
          {options.operations.map((o) => (
            <option key={o.id} value={o.id}>{o.name}</option>
          ))}
        </NativeSelect>
      </FilterField>
      <FilterField label="Placa ou frota" className="min-w-[11rem] flex-1 sm:max-w-[15rem]">
        <SearchField
          key={filters.q ?? ""}
          size="sm"
          aria-label="Buscar por placa ou frota (Enter para aplicar)"
          defaultValue={filters.q ?? ""}
          placeholder="SNT8J46, VA170…"
          onKeyDown={(e) => {
            if (e.key === "Enter") set({ q: (e.target as HTMLInputElement).value.trim() || null });
          }}
          onClear={() => set({ q: null })}
        />
      </FilterField>
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="secondary" size="sm" leadingIcon={<SlidersHorizontal />} disabled={pending}>
            Mais filtros
            {moreCount ? (
              <Badge variant="accent" size="sm" appearance="solid" className="ml-1">
                {moreCount}
              </Badge>
            ) : null}
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-[min(92vw,30rem)]">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <FilterField label="Modelo" className="sm:col-span-2">
              <NativeSelect fieldSize="sm" value={filters.model ?? ""} onChange={(e) => set({ modelo: e.target.value || null })}>
                <option value="">Todos</option>
                {models.map((m) => (
                  <option key={m.id} value={m.id}>{m.label}</option>
                ))}
              </NativeSelect>
            </FilterField>
            <FilterField label="Cidade">
              <NativeSelect
                fieldSize="sm"
                value={filters.city ?? ""}
                onChange={(e) => {
                  const city = cities.find((c) => String(c.id) === e.target.value);
                  set({ cidade: city ? String(city.id) : null, uf: city ? String(city.stateId) : null, br: null });
                }}
              >
                <option value="">Todas</option>
                {cities.map((c) => (
                  <option key={c.id} value={c.id}>{c.label}</option>
                ))}
              </NativeSelect>
            </FilterField>
            <FilterField label="BR">
              <NativeSelect fieldSize="sm" value={filters.br ?? ""} onChange={(e) => set({ br: e.target.value || null })}>
                <option value="">Todas</option>
                {brs.map((b) => (
                  <option key={b.id} value={b.id}>{b.code}</option>
                ))}
              </NativeSelect>
            </FilterField>
          </div>
        </PopoverContent>
      </Popover>
      {anyFilter ? (
        <Button variant="ghost" size="sm" leadingIcon={<X />} onClick={clearFilters} disabled={pending}>
          Limpar filtros
        </Button>
      ) : null}
    </FilterBar>
  );

  const inactiveNotice = inactive ? (
    <Alert variant="neutral" icon={<History aria-hidden />} data-testid="maintenance-preventive-inactive">
      <AlertTitle>Histórico da frota inativa</AlertTitle>
      <AlertDescription>
        Ciclos registrados enquanto os veículos estavam ativos, preservados para consulta. Nesta visão nenhum alerta
        novo é calculado e nenhuma manutenção é gerada.
      </AlertDescription>
    </Alert>
  ) : null;

  if (!matrix) {
    return (
      <div className="flex flex-col gap-4" data-testid="maintenance-preventive-panel">
        {filterBar}
        {inactiveNotice}
        <ErrorState
          title="Não foi possível carregar a matriz preventiva."
          description="A leitura dos ciclos falhou. Tente de novo em instantes."
          onRetry={actions.refresh}
          retryLabel="Tentar de novo"
          retrying={pending}
        />
      </div>
    );
  }

  const s = matrix.summary;
  const toggleStatus = (code: PreventiveStatus) => set({ mp_situacao: filters.status === code ? null : code });
  const statusTile = (code: PreventiveStatus, label: string, value: number | undefined) => (
    <StatTile
      key={code}
      label={label}
      value={formatInt(value ?? 0)}
      unit="ciclos"
      tone={PREVENTIVE_STATUS_TONE[code]}
      onClick={() => toggleStatus(code)}
      active={filters.status === code}
      disabled={pending}
      testId={`maintenance-preventive-kpi-${code}`}
    />
  );

  return (
    <div className="flex flex-col gap-4" data-testid="maintenance-preventive-panel">
      {filterBar}
      {inactiveNotice}

      <section aria-label="Resumo da preventiva" className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5 2xl:grid-cols-9">
        <StatTile label="Veículos" value={formatInt(s?.vehicles ?? 0)} unit="no recorte" />
        <StatTile label="Sem regra" value={formatInt(s?.noRule ?? 0)} unit="veículos" tone={s?.noRule ? "warning" : undefined} />
        <StatTile label="Sem KM" value={formatInt(s?.noKm ?? 0)} unit="veículos" tone={s?.noKm ? "pending" : undefined} />
        {statusTile("not_reached", "Não atingidas", s?.notReached)}
        {statusTile("to_schedule", "A programar", s?.toSchedule)}
        {statusTile("due", "Vencidas", s?.due)}
        {statusTile("critical", "Críticas", s?.critical)}
        {statusTile("completed", "Realizadas", s?.completed)}
        <StatTile label="Programadas" value={formatInt(s?.programmed ?? 0)} unit="com manutenção aberta" tone="info" />
      </section>

      <section className="flex flex-col gap-3 rounded-md border border-border bg-surface p-3 sm:p-4" aria-labelledby="preventive-matrix-title">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 id="preventive-matrix-title" className="text-h4 font-semibold text-fg">
              Matriz preventiva · veículos × ciclos MP
            </h3>
            <p className="text-caption text-fg-muted">
              {formatInt(rows.length)} veículo(s) · situação calculada pelo servidor a partir do KM atual, do marco de
              cada ciclo e da faixa de alerta/tolerância do parâmetro.
            </p>
          </div>
          {canSync ? (
            <Button
              variant="secondary"
              size="sm"
              leadingIcon={<RefreshCw />}
              onClick={sync}
              loading={syncing}
              disabled={pending}
              data-testid="maintenance-preventive-sync"
            >
              Sincronizar ciclos
            </Button>
          ) : null}
        </div>

        <ul className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-caption text-fg-muted" aria-label="Legenda das situações">
          {STATUS_ORDER.map((code) => (
            <li key={code}>
              <PreventiveStatusBadge status={code} size="sm" />
            </li>
          ))}
          <li>“faltam X km” = antes do marco · “+X km” = além do marco</li>
          <li>Código azul = manutenção aberta para o ciclo</li>
        </ul>

        {rows.length === 0 ? (
          <EmptyState
            variant="panel"
            size="sm"
            title={inactive ? "Nenhum veículo inativo com histórico preventivo" : "Nenhum veículo no recorte"}
            description={
              anyFilter
                ? "Nenhum veículo corresponde aos filtros. Ajuste ou limpe os filtros para ver a frota completa."
                : inactive
                  ? "Não há veículos inativos com ciclos preventivos registrados."
                  : "Não há veículos ativos no seu escopo. Cadastre parâmetros preventivos e sincronize os ciclos."
            }
            action={
              anyFilter ? (
                <Button variant="secondary" size="sm" leadingIcon={<X />} onClick={clearFilters}>
                  Limpar filtros
                </Button>
              ) : undefined
            }
          />
        ) : (
          <>
            <TableContainer tabIndex={0} stickyHeader maxHeight="72vh" data-testid="maintenance-preventive-matrix">
              <Table layout="fixed" style={{ minWidth: `${16 + Math.max(maxCycle, 1) * 10.5}rem` }}>
                <TableHeader>
                  <TableRow>
                    {/* Veículo, tipo, operação e KM numa coluna fixa: a rolagem horizontal
                        fica toda para os ciclos MP, que é o que se compara. */}
                    <TableHead className="left-0 z-20! w-[12.5rem] border-r border-border sm:w-[16rem]">Veículo · KM atual</TableHead>
                    {cycleNumbers.length ? (
                      cycleNumbers.map((n) => (
                        <TableHead key={n} className="w-[10.5rem]">MP{n}</TableHead>
                      ))
                    ) : (
                      <TableHead className="w-[10.5rem]">Ciclos MP</TableHead>
                    )}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pageRows.map((row) => (
                    <MatrixRow
                      key={row.vehicleId}
                      row={row}
                      cycleNumbers={cycleNumbers}
                      canGenerate={canGenerate}
                      onGenerate={(cycle) => setTarget({ cycle, row })}
                      onOpenMaintenance={actions.openMaintenance}
                    />
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
            {rows.length > pageSizes[0] ? (
              <Pagination
                page={page}
                pageSize={pageSize}
                total={rows.length}
                pageSizeOptions={pageSizes}
                disabled={pending}
                onPageChange={(p) => actions.navigate({ pagina: String(p) })}
                onPageSizeChange={(size) => actions.navigate({ por_pagina: String(size), pagina: null })}
                label="Páginas da matriz preventiva"
              />
            ) : null}
          </>
        )}
      </section>

      {canGenerate ? (
        <ScheduleCycleDialog
          target={target}
          today={matrix.today}
          catalog={catalog}
          canSchedule={perms.schedule}
          onOpenChange={(open) => {
            if (!open) setTarget(null);
          }}
          actions={actions}
        />
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Linha e célula
// ---------------------------------------------------------------------------

function MatrixRow({
  row, cycleNumbers, canGenerate, onGenerate, onOpenMaintenance,
}: {
  row: PreventiveMatrixRow;
  cycleNumbers: number[];
  canGenerate: boolean;
  onGenerate: (cycle: PreventiveCycleCell) => void;
  onOpenMaintenance: (id: string) => void;
}) {
  const byNumber = new Map(row.cycles.map((c) => [c.number, c]));
  const warnings = diagnosticsOf(row);
  const label = vehicleLabel(row.licensePlate, row.fleetCode);

  return (
    <TableRow className="align-top" data-testid="maintenance-preventive-row">
      <TableCell className="sticky left-0 z-[1] border-r border-border bg-surface py-2 align-top">
        <div className="flex items-start gap-1.5">
          <div className="min-w-0 flex-1">
            <p className="truncate text-label font-semibold text-fg" title={label}>
              {row.fleetCode ?? "—"} <span className="font-normal text-fg-muted">{row.licensePlate ?? ""}</span>
            </p>
            <p className="truncate text-caption text-fg-secondary" title={[row.typeName, row.modelName, row.subcategoryName].filter(Boolean).join(" · ")}>
              {[row.typeName, row.modelName].filter(Boolean).join(" · ") || "—"}
            </p>
            <p className="truncate text-caption text-fg-muted" title={[row.operationName, row.cityName, row.brCode ? `BR ${row.brCode}` : null].filter(Boolean).join(" · ")}>
              {[row.operationName ?? "Sem operação", row.cityName].filter(Boolean).join(" · ")}
            </p>
            <p className="text-caption tabular-nums text-fg">
              {formatKm(row.currentKm)}
              <span className="text-fg-muted">{row.currentKmDate ? ` em ${formatDate(row.currentKmDate)}` : " · sem leitura"}</span>
            </p>
            {row.vehicleStatus !== "active" ? (
              <Badge size="sm" variant="neutral" className="mt-0.5">Inativo</Badge>
            ) : null}
          </div>
          {warnings.length ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  className="mt-0.5 shrink-0 rounded-xs text-warning hfm-focus-ring"
                  aria-label={`Avisos de ${label}: ${warnings.join(" ")}`}
                >
                  <AlertTriangle className="size-4" aria-hidden />
                </button>
              </TooltipTrigger>
              <TooltipContent className="max-w-72">
                <ul className="flex flex-col gap-1">
                  {warnings.map((w) => (
                    <li key={w}>{w}</li>
                  ))}
                </ul>
              </TooltipContent>
            </Tooltip>
          ) : null}
        </div>
      </TableCell>
      {row.cycles.length === 0 ? (
        <TableCell colSpan={Math.max(cycleNumbers.length, 1)} className="py-2 align-top">
          <p className="flex items-start gap-1.5 text-caption text-fg-secondary">
            <AlertTriangle className="mt-px size-3.5 shrink-0 text-warning" aria-hidden />
            <span>{warnings.join(" ") || "Nenhum ciclo preventivo para este veículo."}</span>
          </p>
        </TableCell>
      ) : (
        cycleNumbers.map((n) => {
          const cycle = byNumber.get(n);
          return (
            <TableCell key={n} className="px-1.5 py-1.5 align-top">
              {cycle ? (
                <CycleCell
                  cycle={cycle}
                  vehicle={label}
                  canGenerate={canGenerate}
                  onGenerate={() => onGenerate(cycle)}
                  onOpenMaintenance={onOpenMaintenance}
                />
              ) : (
                <span className="flex h-full items-center justify-center text-fg-muted">
                  <span aria-hidden>—</span>
                  <span className="sr-only">Sem ciclo MP{n}</span>
                </span>
              )}
            </TableCell>
          );
        })
      )}
    </TableRow>
  );
}

function CycleCell({
  cycle, vehicle, canGenerate, onGenerate, onOpenMaintenance,
}: {
  cycle: PreventiveCycleCell;
  vehicle: string;
  canGenerate: boolean;
  onGenerate: () => void;
  onOpenMaintenance: (id: string) => void;
}) {
  const tone = PREVENTIVE_STATUS_TONE[cycle.status] ?? "neutral";
  const done = cycle.status === "completed";
  const actionable = canGenerate && ACTIONABLE.includes(cycle.status) && !cycle.openMaintenance;
  const bal = balance(cycle);
  const adherence = adherenceText(cycle);

  return (
    <div
      className={cn(
        "flex min-h-[5rem] flex-col items-start gap-1 rounded-sm border border-border-subtle border-l-2 bg-surface px-2 py-1.5 text-caption",
        TONE_BORDER[tone],
      )}
      data-status={cycle.status}
    >
      <PreventiveStatusBadge status={cycle.status} size="sm" />
      <span className="font-semibold text-fg tabular-nums" title="Marco do ciclo">
        <span className="sr-only">Marco </span>
        {formatKm(cycle.milestoneKm)}
      </span>
      {done ? (
        <>
          <span className="text-fg-secondary tabular-nums">
            {formatDate(cycle.completedOn)}
            {cycle.completedKm != null ? ` · ${formatKm(cycle.completedKm)}` : ""}
          </span>
          {adherence ? <span className="text-fg-secondary">{adherence}</span> : null}
          {cycle.completedMaintenanceId ? (
            <button
              type="button"
              className="rounded-xs font-medium text-link underline-offset-2 hover:underline hfm-focus-ring"
              onClick={() => onOpenMaintenance(cycle.completedMaintenanceId!)}
              aria-label={`Ver a manutenção que realizou o MP${cycle.number} de ${vehicle}`}
            >
              Ver manutenção
            </button>
          ) : null}
        </>
      ) : (
        <span className="text-fg-secondary tabular-nums" title={bal.title}>{bal.text}</span>
      )}
      {cycle.openMaintenance ? (
        <button
          type="button"
          className="rounded-xs text-left font-semibold text-link underline-offset-2 hover:underline hfm-focus-ring"
          onClick={() => onOpenMaintenance(cycle.openMaintenance!.id)}
          aria-label={`Abrir a manutenção ${cycle.openMaintenance.code} do MP${cycle.number} de ${vehicle}`}
        >
          {cycle.openMaintenance.code}
          <span className="font-normal text-fg-muted"> · {STATUS_LABEL[cycle.openMaintenance.status] ?? cycle.openMaintenance.status}</span>
        </button>
      ) : null}
      {actionable ? (
        <Button
          size="sm"
          variant="secondary"
          leadingIcon={<CalendarPlus />}
          className="mt-0.5 h-7 w-full justify-center px-2 text-caption"
          onClick={onGenerate}
          aria-label={`Gerar manutenção para o MP${cycle.number} de ${vehicle}`}
          data-testid="maintenance-preventive-generate"
        >
          Gerar
        </Button>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Gerar manutenção do ciclo
// ---------------------------------------------------------------------------

function ScheduleCycleDialog({
  target, today, catalog, canSchedule, onOpenChange, actions,
}: {
  target: ScheduleTarget | null;
  today: string;
  catalog: MaintenanceCatalog;
  canSchedule: boolean;
  onOpenChange: (open: boolean) => void;
  actions: PanelActions;
}) {
  return (
    <Dialog open={Boolean(target)} onOpenChange={onOpenChange}>
      <DialogContent size="md" data-testid="maintenance-preventive-schedule-dialog">
        {target ? (
          <ScheduleCycleForm
            key={target.cycle.id}
            target={target}
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

function ScheduleCycleForm({
  target, today, catalog, canSchedule, onOpenChange, actions,
}: {
  target: ScheduleTarget;
  today: string;
  catalog: MaintenanceCatalog;
  canSchedule: boolean;
  onOpenChange: (open: boolean) => void;
  actions: PanelActions;
}) {
  const { toast } = useToast();
  const [busy, startTransition] = React.useTransition();
  const [date, setDate] = React.useState("");
  const [supplier, setSupplier] = React.useState("");
  const { cycle, row } = target;
  const vehicle = vehicleLabel(row.licensePlate, row.fleetCode);
  const suppliers = React.useMemo(
    () =>
      catalog.suppliers
        .filter((s) => s.status === "active")
        .map((s) => ({ id: s.id, label: s.tradeName || s.name }))
        .sort((a, b) => a.label.localeCompare(b.label, "pt-BR")),
    [catalog.suppliers],
  );
  const bal = balance(cycle);

  const submit = () =>
    startTransition(async () => {
      const result = await schedulePreventiveCycle(cycle.id, {
        scheduledDate: canSchedule ? date || null : null,
        supplierId: supplier || null,
      });
      if (!result.ok || !result.data) {
        toast({ title: result.error ?? "Não foi possível gerar a manutenção preventiva.", variant: "danger" });
        return;
      }
      const { id, code, created } = result.data;
      onOpenChange(false);
      if (created === false) {
        toast({ title: `Já existia a manutenção ${code}.`, description: "Nenhuma nova foi criada para este ciclo.", variant: "info" });
      } else {
        toast({ title: `Manutenção ${code} gerada.`, description: `Preventiva MP${cycle.number} de ${vehicle}.`, variant: "success" });
      }
      actions.refresh();
      actions.openMaintenance(id);
    });

  return (
    <>
      <DialogHeader>
        <DialogTitle>Gerar manutenção preventiva</DialogTitle>
        <DialogDescription>
          MP{cycle.number} · marco {formatKm(cycle.milestoneKm)} · {vehicle}
        </DialogDescription>
      </DialogHeader>
      <DialogBody className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2 text-body-sm">
          <PreventiveStatusBadge status={cycle.status} />
          <span className="text-fg-secondary tabular-nums">{bal.title}</span>
        </div>
        {canSchedule ? (
          <FormField
            label="Data de agendamento"
            labelHint="Opcional"
            helperText="Sem data, a manutenção nasce como Há agendar; com data, já nasce agendada."
          >
            <DateInput value={date} min={today || undefined} onChange={(e) => setDate(e.target.value)} />
          </FormField>
        ) : (
          <p className="text-caption text-fg-muted">
            A manutenção nasce como Há agendar; o agendamento fica com quem tem permissão de agendar.
          </p>
        )}
        <FormField label="Fornecedor" labelHint="Opcional">
          <NativeSelect value={supplier} onChange={(e) => setSupplier(e.target.value)}>
            <option value="">Definir depois</option>
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>{s.label}</option>
            ))}
          </NativeSelect>
        </FormField>
        <p className="text-caption text-fg-muted">
          O serviço e a prioridade vêm do parâmetro preventivo. Se o ciclo já tiver manutenção aberta, nenhuma nova é
          criada: a existente é aberta.
        </p>
      </DialogBody>
      <DialogFooter>
        <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={busy}>
          Cancelar
        </Button>
        <Button leadingIcon={<CalendarPlus />} onClick={submit} loading={busy} data-testid="maintenance-preventive-schedule-submit">
          Gerar manutenção
        </Button>
      </DialogFooter>
    </>
  );
}
