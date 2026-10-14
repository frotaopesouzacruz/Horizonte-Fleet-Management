"use client";

import * as React from "react";
import { Info, RefreshCw, SlidersHorizontal, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CheckboxField } from "@/components/ui/checkbox";
import { DateInput } from "@/components/ui/date-input";
import {
  Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { FilterBar, FilterChip } from "@/components/ui/filter-bar";
import { FormField } from "@/components/ui/form-field";
import { SearchField } from "@/components/ui/search-field";
import { Alert, AlertDescription, AlertTitle } from "@/components/feedback/alert";
import { ErrorState } from "@/components/feedback/error-state";
import { Skeleton } from "@/components/feedback/skeleton";
import { useToast } from "@/components/feedback/toast";
import { NativeSelect } from "@/components/governance/selects";
import { PredictiveStatusBadge } from "@/components/maintenance/badges";
import { generatePredictiveMaintenance, syncPredictiveCycles } from "@/lib/maintenance/actions";
import type { MaintenanceFilterOptions } from "@/lib/maintenance/queries";
import {
  CONFORMITY_LABEL,
  CRITICALITY_LABEL,
  EXECUTION_LABEL,
  formatInt,
  PREDICTIVE_STATUS_LABEL,
  PREDICTIVE_STATUS_TONE,
  PREDICTIVE_VIEW_LABEL,
  PREDICTIVE_VIEWS,
  REFERENCE_TYPE_LABEL,
  vehicleLabel,
  type Conformity,
  type Criticality,
  type MaintenanceCatalog,
  type PredictiveExecution,
  type PredictiveOverview,
  type PredictiveStatus,
} from "@/lib/maintenance/types";
import { PredictiveAlerts } from "./predictive-alerts";
import { PredictiveAuditPanel } from "./predictive-audit";
import {
  ExecutionBadge,
  PredictiveCycleDrawer,
  servicesForCluster,
  useCycleHistory,
  type PredictiveCycleContext,
} from "./predictive-cycle-drawer";
import { PredictiveExecutive } from "./predictive-executive";
import { PredictiveIndicatorsPanel } from "./predictive-indicators";
import { PredictiveMatrix } from "./predictive-matrix";
import { PredictiveQualityPanel } from "./predictive-quality";
import { ViewButton } from "./predictive-shared";
import { PredictiveSubmissionsPanel } from "./predictive-submissions";
import { PredictiveVerificationDialog } from "./predictive-verification-dialog";
import { FilterField, StatTile } from "./preventive-panel";
import type { MaintenancePerms, PanelActions, PredictiveViewData } from "./shared";

/**
 * Manutenção → Preditiva.
 *
 * Três situações, sempre separadas: a técnica (banda de KM/dias até o marco),
 * a de execução (a manutenção do item) e a de conformidade (a última
 * verificação formal). Sete visões sobre o mesmo recorte — painel executivo,
 * alertas e ações, matriz frota × cluster, indicadores, qualidade dos dados,
 * auditoria e verificações do app — todas filtradas e paginadas no servidor.
 * Verificar, gerar manutenção e dar baixa manual são rotinas do banco.
 */

export interface PredictivePanelProps {
  predictive: PredictiveViewData;
  options: MaintenanceFilterOptions;
  catalog: MaintenanceCatalog;
  perms: MaintenancePerms;
  actions: PanelActions;
}

const TECH_ORDER: PredictiveStatus[] = ["critical", "due", "to_schedule", "upcoming", "ok", "initial_inspection", "no_km"];
const EXEC_ORDER: PredictiveExecution[] = ["awaiting_corrective", "to_schedule", "scheduled", "in_progress", "not_programmed"];
const CONFORMITY_ORDER: Conformity[] = ["conforming", "monitor", "non_conforming", "not_performed", "no_verification"];
const CRITICALITY_ORDER: Criticality[] = ["critical", "high", "medium", "low"];
/** "Programadas" do resumo = há agendar + agendadas. */
const PROGRAMMED = "to_schedule,scheduled";
const MORE_FILTER_PARAMS = ["pd_criticidade", "pd_referencia", "equipamento", "subcategoria", "marca", "modelo", "uf", "cidade", "br", "lideranca", "frota", "pd_monitoramento", "pd_km", "de", "ate"];

function toContext(cell: PredictiveOverview["rows"][number]["cells"][string], extra: Omit<PredictiveCycleContext, keyof typeof cell>): PredictiveCycleContext {
  return { ...cell, ...extra };
}

export function PredictivePanel({ predictive, options, catalog, perms, actions }: PredictivePanelProps) {
  const { overview, filters, view, page, pageSize, params } = predictive;
  const { toast } = useToast();
  const pending = actions.pending;
  const [drawerId, setDrawerId] = React.useState<string | null>(null);
  const [verifyId, setVerifyId] = React.useState<string | null>(null);
  const [generateId, setGenerateId] = React.useState<string | null>(null);
  const [syncing, startSync] = React.useTransition();
  const [moreOpen, setMoreOpen] = React.useState(false);

  const canVerify = perms.predictiveVerify;
  const canGenerate = perms.predictiveGenerate;
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
        map.set(cell.cycleId, toContext(cell, {
          vehicleLabel: vehicleLabel(row.licensePlate, row.fleetCode),
          cluster: column?.cluster ?? null,
          item: column?.item ?? null,
          planName: row.planName,
          currentKm: row.currentKm,
        }));
      }
    }
    for (const alert of overview.alerts) {
      if (map.has(alert.cycleId)) continue;
      map.set(alert.cycleId, toContext(alert, {
        vehicleLabel: vehicleLabel(alert.licensePlate, alert.fleetCode),
        cluster: alert.cluster,
        item: alert.item,
        planName: alert.planName,
        currentKm: alert.currentKm,
      }));
    }
    return map;
  }, [overview]);
  const contextOf = (id: string | null) => (id ? contexts.get(id) ?? null : null);

  // ------------------------------------------------------------------ filtros
  const clusters = React.useMemo(
    () => catalog.clusters.slice().sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, "pt-BR")),
    [catalog.clusters],
  );
  const subcategories = options.subcategories.filter((s) => !filters.vehicleType || s.vehicleTypeId === filters.vehicleType);
  const models = options.models.filter((m) => !filters.make || m.makeId === filters.make);
  const coverage = options.coverage.filter((c) => !filters.operation || c.operationId === filters.operation);
  const ufs = Array.from(new Map(coverage.map((c) => [c.stateId, c.uf])).entries()).sort((a, b) => a[1].localeCompare(b[1]));
  const cities = Array.from(new Map(coverage.filter((c) => !filters.state || String(c.stateId) === filters.state).map((c) => [c.cityId, `${c.cityName}/${c.uf}`])).entries())
    .sort((a, b) => a[1].localeCompare(b[1], "pt-BR"));
  const brs = options.brs.filter((b) => (!filters.operation || b.operationId === filters.operation) && (!filters.city || String(b.cityId) === filters.city));

  const vehicleFilterLabel = React.useMemo(() => {
    if (!filters.vehicle) return null;
    const row = overview?.rows.find((r) => r.vehicleId === filters.vehicle) ?? null;
    const alert = overview?.alerts.find((a) => a.vehicleId === filters.vehicle) ?? null;
    const src = row ?? alert;
    return src ? vehicleLabel(src.licensePlate, src.fleetCode) : "Veículo selecionado";
  }, [filters.vehicle, overview]);

  const moreActive = Boolean(
    filters.criticality || filters.reference || filters.vehicleType || filters.subcategory || filters.make || filters.model || filters.state ||
      filters.city || filters.br || filters.leader || filters.includeInactive || filters.monitoring || filters.kmStale || filters.from || filters.to,
  );
  const anyFilter = Boolean(filters.q || filters.operation || filters.cluster || filters.status || filters.execution || filters.conformity || filters.vehicle || filters.plan || moreActive);
  const clearFilters = () =>
    set({
      q: null, operacao: null, cluster: null, pd_situacao: null, pd_execucao: null, pd_conformidade: null, veiculo: null, plano: null,
      ...Object.fromEntries(MORE_FILTER_PARAMS.map((k) => [k, null])),
    });
  const showMore = moreOpen || moreActive;

  const nameOf = (list: { id: string; name: string }[], id: string | undefined) => (id ? list.find((x) => x.id === id)?.name ?? id : null);

  const filterBar = (
    <FilterBar className="items-end gap-3" label="Filtros da preditiva" data-testid="maintenance-predictive-filters">
      <FilterField label="Situação técnica">
        <NativeSelect fieldSize="sm" aria-label="Filtrar por situação técnica" value={filters.status ?? ""} disabled={pending} onChange={(e) => set({ pd_situacao: e.target.value || null })} className="min-w-[10rem]">
          <option value="">Todas</option>
          <option value="critical,due">Críticos e vencidos</option>
          {TECH_ORDER.map((code) => (
            <option key={code} value={code}>{PREDICTIVE_STATUS_LABEL[code]}</option>
          ))}
        </NativeSelect>
      </FilterField>
      <FilterField label="Execução">
        <NativeSelect fieldSize="sm" aria-label="Filtrar por situação de execução" value={filters.execution ?? ""} disabled={pending} onChange={(e) => set({ pd_execucao: e.target.value || null })} className="min-w-[11rem]">
          <option value="">Todas</option>
          <option value={PROGRAMMED}>Programadas (há agendar + agendadas)</option>
          {EXEC_ORDER.map((code) => (
            <option key={code} value={code}>{EXECUTION_LABEL[code]}</option>
          ))}
        </NativeSelect>
      </FilterField>
      <FilterField label="Conformidade">
        <NativeSelect fieldSize="sm" aria-label="Filtrar por conformidade" value={filters.conformity ?? ""} disabled={pending} onChange={(e) => set({ pd_conformidade: e.target.value || null })} className="min-w-[10rem]">
          <option value="">Todas</option>
          {CONFORMITY_ORDER.map((code) => (
            <option key={code} value={code}>{CONFORMITY_LABEL[code]}</option>
          ))}
        </NativeSelect>
      </FilterField>
      <FilterField label="Cluster">
        <NativeSelect fieldSize="sm" aria-label="Filtrar por cluster técnico" value={filters.cluster ?? ""} disabled={pending} onChange={(e) => set({ cluster: e.target.value || null, servico: null })} className="min-w-[10rem]">
          <option value="">Todos</option>
          {clusters.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </NativeSelect>
      </FilterField>
      <FilterField label="Operação">
        <NativeSelect fieldSize="sm" aria-label="Filtrar por operação" value={filters.operation ?? ""} disabled={pending} onChange={(e) => set({ operacao: e.target.value || null, uf: null, cidade: null, br: null })} className="min-w-[11rem]">
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
      <Button variant={showMore ? "secondary" : "ghost"} size="sm" leadingIcon={<SlidersHorizontal />} onClick={() => setMoreOpen((v) => !v)} aria-expanded={showMore} aria-controls="predictive-more-filters" data-testid="maintenance-predictive-more-filters">
        Mais filtros
      </Button>
      {vehicleFilterLabel ? <FilterChip label="Veículo" value={vehicleFilterLabel} onRemove={() => set({ veiculo: null })} disabled={pending} /> : null}
      {anyFilter ? (
        <Button variant="ghost" size="sm" leadingIcon={<X />} onClick={clearFilters} disabled={pending}>
          Limpar filtros
        </Button>
      ) : null}
    </FilterBar>
  );

  const moreFilters = showMore ? (
    <FilterBar id="predictive-more-filters" className="items-end gap-3 border-t border-border-subtle pt-3" label="Mais filtros da preditiva" data-testid="maintenance-predictive-more">
      <FilterField label="Criticidade">
        <NativeSelect fieldSize="sm" aria-label="Filtrar por criticidade" value={filters.criticality ?? ""} disabled={pending} onChange={(e) => set({ pd_criticidade: e.target.value || null })} className="min-w-[8rem]">
          <option value="">Todas</option>
          {CRITICALITY_ORDER.map((c) => (
            <option key={c} value={c}>{CRITICALITY_LABEL[c]}</option>
          ))}
        </NativeSelect>
      </FilterField>
      <FilterField label="Referência">
        <NativeSelect fieldSize="sm" aria-label="Filtrar por tipo de referência" value={filters.reference ?? ""} disabled={pending} onChange={(e) => set({ pd_referencia: e.target.value || null })} className="min-w-[10rem]">
          <option value="">Todas</option>
          <option value="verification,maintenance,manual_reset">Formais</option>
          {Object.entries(REFERENCE_TYPE_LABEL).map(([code, label]) => (
            <option key={code} value={code}>{label}</option>
          ))}
        </NativeSelect>
      </FilterField>
      <FilterField label="Tipo de equipamento">
        <NativeSelect fieldSize="sm" aria-label="Filtrar por tipo de equipamento" value={filters.vehicleType ?? ""} disabled={pending} onChange={(e) => set({ equipamento: e.target.value || null, subcategoria: null })} className="min-w-[10rem]">
          <option value="">Todos</option>
          {options.vehicleTypes.map((t) => (
            <option key={t.id} value={t.id}>{t.name}</option>
          ))}
        </NativeSelect>
      </FilterField>
      <FilterField label="Subcategoria">
        <NativeSelect fieldSize="sm" aria-label="Filtrar por subcategoria" value={filters.subcategory ?? ""} disabled={pending || !filters.vehicleType} onChange={(e) => set({ subcategoria: e.target.value || null })} className="min-w-[9rem]">
          <option value="">{filters.vehicleType ? "Todas" : "Escolha o tipo"}</option>
          {subcategories.map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </NativeSelect>
      </FilterField>
      <FilterField label="Marca">
        <NativeSelect fieldSize="sm" aria-label="Filtrar por marca" value={filters.make ?? ""} disabled={pending} onChange={(e) => set({ marca: e.target.value || null, modelo: null })} className="min-w-[8rem]">
          <option value="">Todas</option>
          {options.makes.map((m) => (
            <option key={m.id} value={m.id}>{m.name}</option>
          ))}
        </NativeSelect>
      </FilterField>
      <FilterField label="Modelo">
        <NativeSelect fieldSize="sm" aria-label="Filtrar por modelo" value={filters.model ?? ""} disabled={pending} onChange={(e) => set({ modelo: e.target.value || null })} className="min-w-[9rem]">
          <option value="">Todos</option>
          {models.map((m) => (
            <option key={m.id} value={m.id}>{m.name}</option>
          ))}
        </NativeSelect>
      </FilterField>
      <FilterField label="UF">
        <NativeSelect fieldSize="sm" aria-label="Filtrar por UF" value={filters.state ?? ""} disabled={pending} onChange={(e) => set({ uf: e.target.value || null, cidade: null, br: null })} className="min-w-[5rem]">
          <option value="">Todas</option>
          {ufs.map(([id, uf]) => (
            <option key={id} value={String(id)}>{uf}</option>
          ))}
        </NativeSelect>
      </FilterField>
      <FilterField label="Cidade">
        <NativeSelect fieldSize="sm" aria-label="Filtrar por cidade" value={filters.city ?? ""} disabled={pending} onChange={(e) => set({ cidade: e.target.value || null, br: null })} className="min-w-[10rem]">
          <option value="">Todas</option>
          {cities.map(([id, name]) => (
            <option key={id} value={String(id)}>{name}</option>
          ))}
        </NativeSelect>
      </FilterField>
      <FilterField label="BR">
        <NativeSelect fieldSize="sm" aria-label="Filtrar por BR" value={filters.br ?? ""} disabled={pending} onChange={(e) => set({ br: e.target.value || null })} className="min-w-[7rem]">
          <option value="">Todas</option>
          {brs.map((b) => (
            <option key={b.id} value={b.id}>{b.code}</option>
          ))}
        </NativeSelect>
      </FilterField>
      <FilterField label="Liderança">
        <NativeSelect fieldSize="sm" aria-label="Filtrar por liderança" value={filters.leader ?? ""} disabled={pending} onChange={(e) => set({ lideranca: e.target.value || null })} className="min-w-[10rem]">
          <option value="">Todas</option>
          {options.leaders.map((l) => (
            <option key={l.id} value={l.id}>{l.name}</option>
          ))}
        </NativeSelect>
      </FilterField>
      <FilterField label="Frota">
        <NativeSelect fieldSize="sm" aria-label="Filtrar por situação da frota" value={filters.includeInactive ? "all" : ""} disabled={pending} onChange={(e) => set({ frota: e.target.value || null })} className="min-w-[8rem]">
          <option value="">Só ativa</option>
          <option value="all">Ativa e inativa</option>
        </NativeSelect>
      </FilterField>
      <FilterField label="Período (referência)" className="min-w-[9rem]">
        <DateInput size="sm" aria-label="Referência a partir de" value={filters.from ?? ""} disabled={pending} onChange={(e) => set({ de: e.target.value || null })} />
      </FilterField>
      <FilterField label="até" className="min-w-[9rem]">
        <DateInput size="sm" aria-label="Referência até" value={filters.to ?? ""} disabled={pending} onChange={(e) => set({ ate: e.target.value || null })} />
      </FilterField>
      <CheckboxField label="Só em monitoramento" checked={Boolean(filters.monitoring)} disabled={pending} onCheckedChange={(v) => set({ pd_monitoramento: v === true ? "1" : null })} />
      <CheckboxField label="Só KM desatualizado" checked={Boolean(filters.kmStale)} disabled={pending} onCheckedChange={(v) => set({ pd_km: v === true ? "desatualizado" : null })} />
    </FilterBar>
  ) : moreActive ? null : null;

  const activeChips = (
    <div className="flex flex-wrap gap-2" aria-label="Filtros avançados aplicados">
      {filters.criticality ? <FilterChip label="Criticidade" value={filters.criticality.split(",").map((c) => CRITICALITY_LABEL[c as Criticality] ?? c).join(", ")} onRemove={() => set({ pd_criticidade: null })} disabled={pending} /> : null}
      {filters.reference ? <FilterChip label="Referência" value={filters.reference.split(",").map((c) => REFERENCE_TYPE_LABEL[c] ?? c).join(", ")} onRemove={() => set({ pd_referencia: null })} disabled={pending} /> : null}
      {filters.vehicleType ? <FilterChip label="Tipo" value={nameOf(options.vehicleTypes, filters.vehicleType) ?? ""} onRemove={() => set({ equipamento: null, subcategoria: null })} disabled={pending} /> : null}
      {filters.subcategory ? <FilterChip label="Subcategoria" value={nameOf(options.subcategories, filters.subcategory) ?? ""} onRemove={() => set({ subcategoria: null })} disabled={pending} /> : null}
      {filters.make ? <FilterChip label="Marca" value={nameOf(options.makes, filters.make) ?? ""} onRemove={() => set({ marca: null, modelo: null })} disabled={pending} /> : null}
      {filters.model ? <FilterChip label="Modelo" value={nameOf(options.models, filters.model) ?? ""} onRemove={() => set({ modelo: null })} disabled={pending} /> : null}
      {filters.state ? <FilterChip label="UF" value={ufs.find(([id]) => String(id) === filters.state)?.[1] ?? filters.state} onRemove={() => set({ uf: null, cidade: null, br: null })} disabled={pending} /> : null}
      {filters.city ? <FilterChip label="Cidade" value={cities.find(([id]) => String(id) === filters.city)?.[1] ?? filters.city} onRemove={() => set({ cidade: null, br: null })} disabled={pending} /> : null}
      {filters.br ? <FilterChip label="BR" value={options.brs.find((b) => b.id === filters.br)?.code ?? filters.br} onRemove={() => set({ br: null })} disabled={pending} /> : null}
      {filters.leader ? <FilterChip label="Liderança" value={nameOf(options.leaders, filters.leader) ?? ""} onRemove={() => set({ lideranca: null })} disabled={pending} /> : null}
      {filters.includeInactive ? <FilterChip label="Frota" value="ativa e inativa" onRemove={() => set({ frota: null })} disabled={pending} /> : null}
      {filters.monitoring ? <FilterChip label="Monitoramento" value="só em monitoramento" onRemove={() => set({ pd_monitoramento: null })} disabled={pending} /> : null}
      {filters.kmStale ? <FilterChip label="KM" value="desatualizado" onRemove={() => set({ pd_km: null })} disabled={pending} /> : null}
      {filters.from || filters.to ? <FilterChip label="Referência" value={`${filters.from ?? "…"} a ${filters.to ?? "…"}`} onRemove={() => set({ de: null, ate: null })} disabled={pending} /> : null}
    </div>
  );

  const explainer = (
    <Alert variant="info" icon={<Info aria-hidden />} data-testid="maintenance-predictive-explainer">
      <AlertTitle>Situação técnica, execução e conformidade são coisas diferentes</AlertTitle>
      <AlertDescription>
        A situação técnica é a banda de KM/dias até o próximo marco do item (vale o pior caso). A execução é a manutenção do item: há agendar,
        agendada, em execução ou aguardando corretiva. A conformidade é o resultado da última verificação formal. Um item pode estar crítico,
        já agendado e não conforme ao mesmo tempo. O KM oficial vem da Gestão de KM Rodado; quando está velho, a situação é sinalizada como estimativa.
      </AlertDescription>
    </Alert>
  );

  const recalc = () =>
    startSync(async () => {
      const result = await syncPredictiveCycles(filters.vehicle?.includes(",") ? null : filters.vehicle ?? null);
      if (!result.ok) toast({ title: result.error ?? "Não foi possível recalcular os ciclos.", variant: "danger" });
      else {
        toast({ title: "Ciclos recalculados.", description: "Planos aplicáveis, referências e inconsistências foram reavaliados.", variant: "success" });
        actions.refresh();
      }
    });

  const viewSwitch = (counts: { alerts: number; rows: number; quality: number }) => (
    <div role="group" aria-label="Visão da preditiva" className="inline-flex max-w-full flex-wrap gap-1 rounded-md border border-border bg-surface-secondary p-0.5">
      {PREDICTIVE_VIEWS.filter((v) => (v === "auditoria" ? perms.predictiveAudit : true)).map((v) => (
        <ViewButton key={v} pressed={view === v} disabled={pending} onClick={() => set({ pd_visao: v === "painel" ? null : v, pd_lista: null })} testId={`maintenance-predictive-view-${v}`}>
          {PREDICTIVE_VIEW_LABEL[v]}
          {v === "alertas" ? <span className="tabular-nums text-fg-muted">({formatInt(counts.alerts)})</span> : null}
          {v === "matriz" ? <span className="tabular-nums text-fg-muted">({formatInt(counts.rows)})</span> : null}
          {v === "qualidade" && counts.quality > 0 ? <span className="tabular-nums text-fg-muted">({formatInt(counts.quality)})</span> : null}
        </ViewButton>
      ))}
    </div>
  );

  if (!overview) {
    return (
      <div className="flex flex-col gap-4" data-testid="maintenance-predictive-panel">
        {filterBar}
        {moreFilters}
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
      onClick={() => set({ pd_situacao: filters.status === code ? null : code, pd_visao: view === "painel" ? "alertas" : null })}
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
      onClick={() => set({ pd_execucao: filters.execution === code ? null : code, pd_visao: view === "painel" ? "alertas" : null })}
      active={filters.execution === code}
      disabled={pending}
      testId={`maintenance-predictive-exec-${code.replace(",", "-")}`}
    />
  );

  return (
    <div className="flex flex-col gap-4" data-testid="maintenance-predictive-panel">
      <div className="flex flex-col gap-3">
        {filterBar}
        {moreFilters}
        {moreActive ? activeChips : null}
      </div>
      {explainer}

      <section aria-labelledby="predictive-tech-title" className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 id="predictive-tech-title" className="text-label font-semibold text-fg">
            Situação técnica <span className="font-normal text-fg-muted">· banda de KM/dias · {formatInt(s.vehicles)} veículo(s)</span>
          </h3>
          {perms.predictiveRecalculate ? (
            <Button variant="ghost" size="sm" leadingIcon={<RefreshCw />} onClick={recalc} loading={syncing} disabled={pending} data-testid="maintenance-predictive-recalc">
              Recalcular ciclos
            </Button>
          ) : null}
        </div>
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
          Execução, conformidade e previsão <span className="font-normal text-fg-muted">· manutenção do item</span>
        </h3>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-8">
          {execTile("awaiting_corrective", "Aguardando corretiva", s.awaitingCorrective, "danger")}
          {execTile(PROGRAMMED, "Programadas", s.scheduled, "info")}
          {execTile("in_progress", "Em execução", s.inProgress, "progress")}
          <StatTile label="Em monitoramento" value={formatInt(s.monitoring ?? 0)} unit="itens" hint="com alvo reduzido" onClick={() => set({ pd_monitoramento: filters.monitoring ? null : "1" })} active={Boolean(filters.monitoring)} disabled={pending} testId="maintenance-predictive-kpi-monitoring" />
          <StatTile label="KM desatualizado" value={formatInt(s.kmStale ?? 0)} unit="itens" tone="warning" hint={`além de ${formatInt(s.kmMaxAgeDays)} dias`} onClick={() => set({ pd_km: filters.kmStale ? null : "desatualizado" })} active={Boolean(filters.kmStale)} disabled={pending} testId="maintenance-predictive-kpi-km-stale" />
          <StatTile label="Referência formal" value={s.formalReferencePct == null ? "—" : `${formatInt(Math.round(s.formalReferencePct))}%`} hint={`${formatInt(s.historyReference)} só por histórico`} />
          <StatTile label="Previsão por KM" value={formatInt(s.forecastKm ?? 0)} unit="itens" hint={`nos próximos ${formatInt(s.forecastKmWindow ?? 0)} km`} />
          <StatTile label="Previsão por data" value={formatInt(s.forecastDays ?? 0)} unit="itens" hint={`nos próximos ${formatInt(s.forecastDaysWindow ?? 0)} dias`} />
        </div>
      </section>

      <section className="flex flex-col gap-3 rounded-md border border-border bg-surface p-3 sm:p-4" aria-label="Visões da preditiva">
        <div className="flex flex-wrap items-center justify-between gap-3">
          {viewSwitch({ alerts: overview.alertsTotal, rows: overview.rowsTotal, quality: overview.quality.open })}
          <p className="text-caption text-fg-muted">
            {view === "painel" ? "Saúde do programa, previsão de demanda, rankings e insights do recorte." : null}
            {view === "alertas" ? "Priorizados pelo servidor e agrupados por placa; a página vem do servidor." : null}
            {view === "matriz" ? "Selecione uma célula para o histórico do item; a página vem do servidor." : null}
            {view === "indicadores" ? "Efetividade do programa: verificações, conversão, SLA, recorrência e tendência." : null}
            {view === "qualidade" ? "Inconsistências que o motor detecta e resolve a cada recálculo." : null}
            {view === "auditoria" ? "Linha do tempo imutável dos ciclos: quem fez, quando e por onde." : null}
            {view === "envios" ? "Envios do aplicativo de campo e todas as verificações formais." : null}
          </p>
        </div>

        {view === "painel" ? (
          <PredictiveExecutive overview={overview} indicators={predictive.indicators} trends={predictive.trends} filters={filters} catalog={catalog} pending={pending} actions={actions} />
        ) : null}
        {view === "alertas" ? (
          <PredictiveAlerts
            overview={overview}
            page={page}
            pageSize={pageSize}
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
        ) : null}
        {view === "matriz" ? (
          <PredictiveMatrix overview={overview} page={page} pageSize={pageSize} anyFilter={anyFilter} pending={pending} actions={actions} onOpen={setDrawerId} onClear={clearFilters} />
        ) : null}
        {view === "indicadores" ? (
          <PredictiveIndicatorsPanel overview={overview} indicators={predictive.indicators} trends={predictive.trends} pending={pending} actions={actions} />
        ) : null}
        {view === "qualidade" ? (
          <PredictiveQualityPanel
            quality={predictive.quality}
            page={page}
            pageSize={pageSize}
            params={{ type: params.pd_inconsistencia, severity: params.pd_severidade, includeResolved: params.pd_resolvidas === "1" }}
            perms={perms}
            pending={pending}
            actions={actions}
            onOpenCycle={setDrawerId}
          />
        ) : null}
        {view === "auditoria" ? (
          <PredictiveAuditPanel
            events={predictive.events}
            page={page}
            pageSize={pageSize}
            params={{ type: params.pd_evento, cycle: params.ciclo, vehicleLabel: contextOf(params.ciclo ?? null)?.vehicleLabel ?? null }}
            pending={pending}
            actions={actions}
            onOpenCycle={setDrawerId}
          />
        ) : null}
        {view === "envios" ? (
          <PredictiveSubmissionsPanel
            submissions={predictive.submissions}
            verifications={predictive.verifications}
            list={params.pd_lista === "verificacoes" ? "verificacoes" : "envios"}
            page={page}
            pageSize={pageSize}
            params={{ result: params.pd_resultado, source: params.pd_origem, onlyNc: params.pd_so_nc === "1" }}
            pending={pending}
            actions={actions}
            onOpenCycle={setDrawerId}
          />
        ) : null}
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
        onRegisterVerification={canVerify ? (id) => { setDrawerId(null); setVerifyId(id); } : undefined}
        onGenerate={canGenerate ? (id) => { setDrawerId(null); setGenerateId(id); } : undefined}
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
          <GenerateForm key={cycleId} cycleId={cycleId} context={context} today={today} catalog={catalog} canSchedule={canSchedule} onOpenChange={onOpenChange} actions={actions} />
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
  const cluster = history?.item.cluster ?? context?.cluster ?? null;
  const services = React.useMemo(() => servicesForCluster(catalog.services, cluster), [catalog.services, cluster]);
  const serviceMissing = needsService && !serviceId;
  const status = history?.state?.technicalStatus ?? context?.status ?? null;
  const execution = history?.state?.executionStatus ?? context?.execution ?? null;

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
        toast({ title: `Manutenção ${code} gerada.`, description: history?.item.name ?? context?.item ?? undefined, variant: "success" });
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
          {[context?.vehicleLabel, cluster, history?.item.name ?? context?.item].filter(Boolean).join(" · ") || "Ciclo preditivo"}
        </DialogDescription>
      </DialogHeader>
      <DialogBody className="flex flex-col gap-4" aria-busy={loading || busy}>
        {status && execution ? (
          <div className="flex flex-wrap items-center gap-2 text-caption text-fg-muted">
            <span>Situação técnica</span>
            <PredictiveStatusBadge status={status} />
            <span className="ml-1">Execução</span>
            <ExecutionBadge execution={execution} />
          </div>
        ) : null}
        {loading && !history ? <Skeleton className="h-16 w-full" /> : null}
        {error ? (
          <Alert variant="danger" action={<Button size="sm" variant="outline" leadingIcon={<RefreshCw />} onClick={reload}>Tentar de novo</Button>}>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        {canSchedule ? (
          <FormField label="Data de agendamento" labelHint="Opcional" helperText="Sem data, a manutenção nasce como Há agendar; com data, já nasce agendada.">
            <DateInput value={date} min={today || undefined} onChange={(e) => setDate(e.target.value)} />
          </FormField>
        ) : null}
        {needsService ? (
          <FormField label="Serviço" required helperText="O item do plano não tem serviço padrão." error={tried && serviceMissing ? "Escolha o serviço da manutenção." : undefined}>
            <NativeSelect value={serviceId} onChange={(e) => setServiceId(e.target.value)}>
              <option value="">Escolha…</option>
              {services.map((sv) => (
                <option key={sv.id} value={sv.id}>
                  {sv.name} · {sv.clusterName}
                </option>
              ))}
            </NativeSelect>
          </FormField>
        ) : null}
        <p className="text-caption text-fg-muted">
          A prioridade vem da criticidade do item e a origem fica registrada como preditiva. Se já houver manutenção aberta para o item, nenhuma nova é criada: a existente é aberta.
        </p>
      </DialogBody>
      <DialogFooter>
        <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={busy}>
          Cancelar
        </Button>
        <Button onClick={submit} loading={busy} disabled={loading && !history} data-testid="maintenance-predictive-generate-submit">
          Gerar manutenção
        </Button>
      </DialogFooter>
    </>
  );
}
