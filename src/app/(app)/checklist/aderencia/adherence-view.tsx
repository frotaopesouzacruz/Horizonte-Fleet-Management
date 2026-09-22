"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { LogOut, Undo2 } from "lucide-react";
import { cn } from "@/lib/cn";
import { PageContent, PageHeader } from "@/components/layout/page-header";
import { FilterBar } from "@/components/ui/filter-bar";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SearchField } from "@/components/ui/search-field";
import { CompetencePicker } from "@/components/governance/competence-picker";
import { NativeSelect } from "@/components/governance/selects";
import type { CoverageEntry } from "@/components/governance/scope-picker";
import type {
  AdherenceGroupBy, AdherenceOptions, AdherenceSummary, ChecklistContext, HeatmapDay,
  JourneyRow, MatrixPage, RequestsPage, SimpleOption,
} from "@/lib/adherence/queries";
import type { Competence } from "@/lib/governance/competence";
import { CONTEXT_LABEL } from "./status";
import { ConsolidatedPanel } from "./consolidated-panel";
import { HeatmapPanel } from "./heatmap-panel";
import { MatrixPanel } from "./matrix-panel";
import { JourneyPanel } from "./journey-panel";
import { RequestsPanel, RequestsOverviewPanel } from "./requests-panel";
import { GovernancePanel } from "./governance-panel";
import { ObligationDrawer } from "./obligation-drawer";
import { ImportSection } from "./import-section";

export type AdherenceTab =
  | "consolidada" | "heatmap" | "matriz" | "jornada" | "expurgos" | "solicitacoes" | "governanca";

export interface AdherencePerms {
  request: boolean;
  approve: boolean;
  override: boolean;
  bulk: boolean;
  reconcile: boolean;
  import: boolean;
  manageTargets: boolean;
  manageRules: boolean;
  viewAudit: boolean;
}

export interface AdherenceFilterState {
  operationId?: string;
  stateId?: string;
  cityId?: string;
  branchId?: string;
  leaderEmployeeId?: string;
  brId?: string;
  vehicleTypeId?: string;
  status?: string;
  q?: string;
}

export interface AdherenceViewProps {
  context: ChecklistContext;
  competence: Competence;
  today: string;
  day: string;
  tab: AdherenceTab;
  groupBy: AdherenceGroupBy;
  summary: AdherenceSummary;
  heatmap: HeatmapDay[];
  matrix: MatrixPage;
  journey: JourneyRow[];
  requests: RequestsPage | null;
  options: AdherenceOptions;
  operations: { id: string; name: string; status: string }[];
  coverage: CoverageEntry[];
  leaders: { id: string; name: string }[];
  branches: SimpleOption[];
  vehicleTypes: SimpleOption[];
  filters: AdherenceFilterState;
  requestFilters: { status?: string; reasonCode?: string; q?: string };
  perms: AdherencePerms;
  /** Caminho base para navegação (a prévia de desenvolvimento usa outro). */
  basePath?: string;
}

export type Navigate = (patch: Record<string, string | null>) => void;

/**
 * Gestão de Checklist → Aderência.
 *
 * Todo o estado da tela mora na URL: contexto, competência, dia, aba, filtros
 * e página. Um link copiado abre exatamente a mesma visão, e cada mudança de
 * filtro é uma ida ao servidor — o navegador nunca recalcula um indicador.
 *
 * O contexto (saída ou retorno) fica no topo e governa tudo (§43): trocar de
 * contexto troca os indicadores, o heatmap, a matriz e as pendências. Os dois
 * denominadores nunca se misturam.
 */
export function AdherenceView({
  context, competence, today, day, tab, groupBy, summary, heatmap, matrix, journey, requests,
  options, operations, coverage, leaders, branches, vehicleTypes, filters, requestFilters, perms,
  basePath = "/checklist/aderencia",
}: AdherenceViewProps) {
  const router = useRouter();
  const params = useSearchParams();
  const [pending, startTransition] = React.useTransition();
  const [openObligation, setOpenObligation] = React.useState<string | null>(null);

  const navigate: Navigate = React.useCallback(
    (patch) => {
      const next = new URLSearchParams(params.toString());
      for (const [key, value] of Object.entries(patch)) {
        if (value === null || value === "") next.delete(key);
        else next.set(key, value);
      }
      startTransition(() => router.push(`${basePath}?${next.toString()}`, { scroll: false }));
    },
    [params, router, basePath],
  );

  const refresh = React.useCallback(() => router.refresh(), [router]);

  const statesOfOperation = React.useMemo(() => {
    const scoped = filters.operationId ? coverage.filter((c) => c.operationId === filters.operationId) : coverage;
    const seen = new Map<number, string>();
    for (const c of scoped) seen.set(c.stateId, c.uf);
    return [...seen.entries()].map(([id, uf]) => ({ id, uf })).sort((a, b) => a.uf.localeCompare(b.uf));
  }, [coverage, filters.operationId]);

  const citiesOfState = React.useMemo(() => {
    if (!filters.stateId) return [];
    const seen = new Map<number, string>();
    for (const c of coverage) {
      if (c.stateId === Number(filters.stateId) && (!filters.operationId || c.operationId === filters.operationId)) {
        seen.set(c.cityId, c.cityName);
      }
    }
    return [...seen.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  }, [coverage, filters.stateId, filters.operationId]);

  const contextSwitch = (
    <div
      role="group"
      aria-label="Contexto do checklist"
      className="inline-flex rounded-md border border-border bg-surface p-0.5"
    >
      {(["saida", "retorno"] as const).map((c) => {
        const active = context === c;
        const Icon = c === "saida" ? LogOut : Undo2;
        return (
          <button
            key={c}
            type="button"
            aria-pressed={active}
            disabled={pending}
            onClick={() => navigate({ contexto: c })}
            className={cn(
              "inline-flex h-8 items-center gap-1.5 rounded-sm px-3 text-label font-medium transition-colors hfm-focus-ring",
              active ? "bg-primary text-primary-fg shadow-xs" : "text-fg-muted hover:text-fg",
            )}
          >
            <Icon className="size-3.5" aria-hidden />
            {CONTEXT_LABEL[c]}
          </button>
        );
      })}
    </div>
  );

  return (
    <>
      <PageHeader
        title="Aderência"
        description="Acompanhe a execução dos checklists obrigatórios, identifique pendências e gerencie justificativas operacionais."
        meta={contextSwitch}
        filters={
          <FilterBar className="flex-wrap items-end gap-3">
            <div className="flex flex-col gap-1">
              <span className="text-caption text-fg-muted">Competência</span>
              <CompetencePicker
                value={competence}
                onChange={(v) => navigate({ ano: String(v.year), mes: String(v.month), dia: null, pagina: null })}
                disabled={pending}
              />
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-caption text-fg-muted">Operação</span>
              <NativeSelect
                fieldSize="sm"
                aria-label="Filtrar por operação"
                value={filters.operationId ?? ""}
                onChange={(e) => navigate({ operacao: e.target.value || null, uf: null, cidade: null, br: null, pagina: null })}
                className="min-w-[12rem]"
              >
                <option value="">Todas as operações</option>
                {operations.map((o) => (
                  <option key={o.id} value={o.id}>{o.name}</option>
                ))}
              </NativeSelect>
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-caption text-fg-muted">Estado</span>
              <NativeSelect
                fieldSize="sm"
                aria-label="Filtrar por estado"
                value={filters.stateId ?? ""}
                onChange={(e) => navigate({ uf: e.target.value || null, cidade: null, pagina: null })}
                className="min-w-[6.5rem]"
              >
                <option value="">Todos</option>
                {statesOfOperation.map((s) => (
                  <option key={s.id} value={s.id}>{s.uf}</option>
                ))}
              </NativeSelect>
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-caption text-fg-muted">Cidade</span>
              <NativeSelect
                fieldSize="sm"
                aria-label="Filtrar por cidade"
                value={filters.cityId ?? ""}
                disabled={!filters.stateId}
                onChange={(e) => navigate({ cidade: e.target.value || null, pagina: null })}
                className="min-w-[10rem]"
              >
                <option value="">{filters.stateId ? "Todas" : "Escolha o estado"}</option>
                {citiesOfState.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </NativeSelect>
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-caption text-fg-muted">Filial</span>
              <NativeSelect
                fieldSize="sm"
                aria-label="Filtrar por filial"
                value={filters.branchId ?? ""}
                onChange={(e) => navigate({ filial: e.target.value || null, pagina: null })}
                className="min-w-[10rem]"
              >
                <option value="">Todas</option>
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>{b.name}</option>
                ))}
              </NativeSelect>
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-caption text-fg-muted">Liderança</span>
              <NativeSelect
                fieldSize="sm"
                aria-label="Filtrar por liderança"
                value={filters.leaderEmployeeId ?? ""}
                onChange={(e) => navigate({ lideranca: e.target.value || null, pagina: null })}
                className="min-w-[11rem]"
              >
                <option value="">Todas</option>
                {leaders.map((l) => (
                  <option key={l.id} value={l.id}>{l.name}</option>
                ))}
              </NativeSelect>
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-caption text-fg-muted">Tipo</span>
              <NativeSelect
                fieldSize="sm"
                aria-label="Filtrar por tipo de equipamento"
                value={filters.vehicleTypeId ?? ""}
                onChange={(e) => navigate({ tipo: e.target.value || null, pagina: null })}
                className="min-w-[9rem]"
              >
                <option value="">Todos</option>
                {vehicleTypes.map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </NativeSelect>
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-caption text-fg-muted">Status</span>
              <NativeSelect
                fieldSize="sm"
                aria-label="Filtrar por status"
                value={filters.status ?? ""}
                onChange={(e) => navigate({ situacao: e.target.value || null, pagina: null })}
                className="min-w-[10rem]"
              >
                <option value="">Todos</option>
                {options.statuses.map((s) => (
                  <option key={s.code} value={s.code}>{s.label}</option>
                ))}
              </NativeSelect>
            </div>
            <div className="flex min-w-[12rem] flex-col gap-1">
              <span className="text-caption text-fg-muted">Frota ou placa</span>
              <SearchField
                size="sm"
                aria-label="Buscar por frota ou placa"
                defaultValue={filters.q ?? ""}
                placeholder="VA170, SNT8J46…"
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    navigate({ q: (e.target as HTMLInputElement).value.trim() || null, pagina: null });
                  }
                }}
                onClear={() => navigate({ q: null, pagina: null })}
              />
            </div>
          </FilterBar>
        }
      />

      <PageContent className="flex flex-col gap-5">
        <Tabs value={tab} onValueChange={(v) => navigate({ aba: v })}>
          <TabsList>
            <TabsTrigger value="consolidada">Visão consolidada</TabsTrigger>
            <TabsTrigger value="heatmap">Heatmap</TabsTrigger>
            <TabsTrigger value="matriz">Mês / Dia</TabsTrigger>
            <TabsTrigger value="jornada">Jornada</TabsTrigger>
            <TabsTrigger value="expurgos">Expurgos</TabsTrigger>
            <TabsTrigger value="solicitacoes">Solicitações</TabsTrigger>
            {perms.reconcile || perms.import || perms.manageTargets || perms.manageRules || perms.viewAudit ? (
              <TabsTrigger value="governanca">Importação e reconciliação</TabsTrigger>
            ) : null}
          </TabsList>

          <TabsContent value="consolidada">
            <ConsolidatedPanel summary={summary} groupBy={groupBy} context={context} competence={competence}
              navigate={navigate} pending={pending} />
          </TabsContent>
          <TabsContent value="heatmap">
            <HeatmapPanel days={heatmap} competence={competence} context={context} navigate={navigate} />
          </TabsContent>
          <TabsContent value="matriz">
            <MatrixPanel matrix={matrix} competence={competence} today={today} context={context}
              navigate={navigate} pending={pending} onSelect={setOpenObligation} />
          </TabsContent>
          <TabsContent value="jornada">
            <JourneyPanel rows={journey} day={day} today={today} navigate={navigate} pending={pending}
              onSelect={setOpenObligation} />
          </TabsContent>
          <TabsContent value="expurgos">
            <RequestsPanel requests={requests} filters={requestFilters} options={options} perms={perms}
              navigate={navigate} pending={pending} onSelect={setOpenObligation} onChanged={refresh} />
          </TabsContent>
          <TabsContent value="solicitacoes">
            <RequestsOverviewPanel requests={requests} onSelect={setOpenObligation} />
          </TabsContent>
          <TabsContent value="governanca">
            <GovernancePanel options={options} operations={operations} perms={perms} today={today}
              competence={competence} onChanged={refresh}
              importSection={perms.import && basePath === "/checklist/aderencia" ? <ImportSection onChanged={refresh} /> : undefined} />
          </TabsContent>
        </Tabs>
      </PageContent>

      <ObligationDrawer
        obligationId={openObligation}
        onOpenChange={(open) => { if (!open) setOpenObligation(null); }}
        options={options}
        perms={perms}
        onChanged={refresh}
        onNavigateSibling={setOpenObligation}
      />
    </>
  );
}
