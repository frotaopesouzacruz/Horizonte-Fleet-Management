"use client";

import * as React from "react";
import { ChevronDown, ListPlus, Search, SlidersHorizontal } from "lucide-react";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { KpiCard } from "@/components/ui/kpi-card";
import { SwitchField } from "@/components/ui/switch";
import { EmptyState } from "@/components/feedback/empty-state";
import { ErrorState } from "@/components/feedback/error-state";
import { NativeSelect } from "@/components/governance/selects";
import type { KmRotationCandidate, KmRotationData, KmRotationGroup } from "@/lib/km/rotation";
import { fmtInt, fmtKm, fmtPct, formatDate, KM_ROTATION_SCOPE } from "@/lib/km/types";
import type { KmPanelContext } from "../../shared";
import { AddToPlanDialog } from "./add-to-plan-dialog";
import { AnalysisDrawer } from "./analysis-drawer";
import {
  analysisFromCandidate,
  formatStamp,
  kmMonth,
  pad2,
  pairText,
  period,
  plural,
  ROTATION_HORIZONS,
  type RotationAnalysis,
} from "./format";
import { ConditionedNote, PairLine, PriorityBadge } from "./ui";

/**
 * Sub-aba "Sugestões": parâmetros da simulação (na URL), indicadores e as
 * trocas sugeridas por coorte técnica. Tudo vem de `km_rotation_candidates`;
 * a tela só agrupa e permite selecionar o que vai para um plano.
 */
export function SuggestionsView({ data, ctx }: { data: KmRotationData; ctx: KmPanelContext }) {
  const { params, candidates } = data;
  const canCreate = ctx.perms.rotationCreate;
  const [selected, setSelected] = React.useState<Set<string>>(() => new Set());
  const [collapsed, setCollapsed] = React.useState<Set<string>>(() => new Set());
  const [adding, setAdding] = React.useState<KmRotationCandidate[] | null>(null);
  const [analysis, setAnalysis] = React.useState<RotationAnalysis | null>(null);

  const items = React.useMemo(() => candidates?.items ?? [], [candidates]);
  // Seleção efetiva: só as sugestões que ainda estão na lista (os parâmetros podem ter mudado).
  const chosen = items.filter((i) => selected.has(i.key));
  const byGroup = React.useMemo(() => {
    const map = new Map<string, KmRotationCandidate[]>();
    for (const it of items) {
      const list = map.get(it.cohortKey);
      if (list) list.push(it);
      else map.set(it.cohortKey, [it]);
    }
    return map;
  }, [items]);
  // Numeração única na ordem exibida (grupo a grupo), para citar a sugestão sem ambiguidade.
  const numberOf = React.useMemo(() => {
    const out = new Map<string, number>();
    for (const g of candidates?.groups ?? []) for (const it of byGroup.get(g.key) ?? []) out.set(it.key, out.size + 1);
    return out;
  }, [candidates, byGroup]);

  const toggle = (key: string, on: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(key);
      else next.delete(key);
      return next;
    });

  const analyzedPeriod = candidates?.period ?? null;

  return (
    <div className="flex flex-col gap-5" data-testid="km-rodizio-suggestions">
      <ParametersCard data={data} ctx={ctx} />

      {data.candidatesError ? (
        <ErrorState
          title="Não foi possível calcular as sugestões."
          description={data.candidatesError}
          onRetry={ctx.refresh}
          retrying={ctx.pending}
        />
      ) : !candidates ? (
        <EmptyState icon={<Search aria-hidden />} title="Sem sugestões carregadas" description="Atualize a tela para calcular as sugestões." />
      ) : (
        <>
          <Kpis data={data} />

          <div className="flex flex-wrap items-end justify-between gap-3">
            <div className="min-w-0">
              <h2 className="text-section-title font-semibold text-fg">Sugestões ({fmtInt(items.length)})</h2>
              <p className="text-body-sm text-fg-muted">
                Agrupadas por coorte técnica (tipo · subcategoria · modelo). Cada frota aparece em no máximo uma sugestão.
              </p>
            </div>
            {canCreate && items.length > 0 ? (
              <div className="flex flex-wrap items-center gap-2">
                {chosen.length > 0 ? (
                  <Button variant="ghost" size="sm" onClick={() => setSelected(new Set())}>
                    Limpar seleção
                  </Button>
                ) : (
                  <Button variant="ghost" size="sm" onClick={() => setSelected(new Set(items.map((i) => i.key)))}>
                    Selecionar todas
                  </Button>
                )}
                <Button
                  leadingIcon={<ListPlus aria-hidden />}
                  disabled={chosen.length === 0}
                  onClick={() => setAdding(chosen)}
                  data-testid="km-rodizio-add-selected"
                >
                  Adicionar selecionados ao plano ({fmtInt(chosen.length)})
                </Button>
              </div>
            ) : null}
          </div>

          {items.length === 0 ? (
            <EmptyState
              variant="panel"
              icon={<Search aria-hidden />}
              title="Nenhuma troca com ganho relevante para os parâmetros atuais."
              description="Tente outro horizonte, o escopo global ou desligar “Somente trocas entre locais diferentes”."
              data-testid="km-rodizio-suggestions-empty"
            />
          ) : (
            <div className="flex flex-col gap-3">
              {candidates.groups.map((g) => {
                const list = byGroup.get(g.key) ?? [];
                if (list.length === 0) return null;
                return (
                  <GroupBlock
                    key={g.key}
                    group={g}
                    items={list}
                    open={!collapsed.has(g.key)}
                    onToggle={() =>
                      setCollapsed((prev) => {
                        const next = new Set(prev);
                        if (next.has(g.key)) next.delete(g.key);
                        else next.add(g.key);
                        return next;
                      })
                    }
                    horizon={candidates.horizonDays}
                    numberOf={numberOf}
                    canCreate={canCreate}
                    selected={selected}
                    onSelect={toggle}
                    onAnalyze={(c) => setAnalysis(analysisFromCandidate(c, candidates.horizonDays, analyzedPeriod))}
                    onAdd={(list2) => setAdding(list2)}
                  />
                );
              })}
            </div>
          )}

          <p className="text-caption text-fg-muted">
            Calculado em {formatStamp(candidates.generatedAt)} · leituras até {formatDate(candidates.dataAsOf)}.
          </p>
        </>
      )}

      <AnalysisDrawer analysis={analysis} onOpenChange={(o) => !o && setAnalysis(null)} />
      <AddToPlanDialog
        open={adding != null}
        onOpenChange={(o) => !o && setAdding(null)}
        pairs={adding ?? []}
        plans={data.plans}
        params={params}
        analyzedPeriod={analyzedPeriod}
        filtersPayload={data.filtersPayload}
        onSaved={() => {
          setAdding(null);
          setSelected(new Set());
          ctx.refresh();
        }}
        onOpenPlan={(id) => ctx.navigate({ sub: "planos", plano: id })}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Parâmetros da simulação
// ---------------------------------------------------------------------------
function ParametersCard({ data, ctx }: { data: KmRotationData; ctx: KmPanelContext }) {
  const { params } = data;
  const p = data.candidates?.period;
  return (
    <section
      aria-labelledby="km-rodizio-params-title"
      className="flex flex-col gap-3 rounded-lg border border-border bg-surface-raised p-4 shadow-card"
      data-testid="km-rodizio-params"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex min-w-0 items-start gap-2.5">
          <span aria-hidden className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md bg-primary-soft text-primary-soft-fg">
            <SlidersHorizontal className="size-4" />
          </span>
          <div className="min-w-0">
            <h2 id="km-rodizio-params-title" className="text-h4 font-semibold text-fg">
              Parâmetros da simulação
            </h2>
            <p className="text-caption text-fg-muted">
              Usa a competência e os filtros do topo{p ? ` · período analisado ${period(p.from, p.to)}` : ""}.
            </p>
          </div>
        </div>
      </div>
      <div className="grid gap-4 md:grid-cols-[auto_minmax(0,1fr)_minmax(0,1fr)] md:items-end">
        <div className="flex flex-col gap-1">
          <span id="km-rodizio-horizon-label" className="text-caption text-fg-muted">
            Horizonte de projeção
          </span>
          <div
            role="group"
            aria-labelledby="km-rodizio-horizon-label"
            className="inline-flex w-fit gap-0.5 rounded-sm border border-border bg-surface-secondary p-0.5"
          >
            {ROTATION_HORIZONS.map((h) => {
              const active = params.horizon === h;
              return (
                <button
                  key={h}
                  type="button"
                  aria-pressed={active}
                  disabled={ctx.pending}
                  onClick={() => ctx.navigate({ horizonte: h === 90 ? null : String(h) })}
                  className={cn(
                    "h-8 rounded-xs px-3 text-body-sm font-medium hfm-transition hfm-focus-ring",
                    active ? "bg-surface text-fg shadow-xs" : "text-fg-secondary hover:text-fg",
                  )}
                  data-testid={`km-rodizio-horizon-${h}`}
                >
                  {h} dias
                </button>
              );
            })}
          </div>
        </div>
        <label className="flex min-w-0 flex-col gap-1">
          <span className="text-caption text-fg-muted">Escopo</span>
          <NativeSelect
            value={params.scope}
            disabled={ctx.pending}
            onChange={(e) => ctx.navigate({ escopo: e.target.value === "same_cohort_same_operation" ? null : e.target.value })}
            data-testid="km-rodizio-scope"
          >
            {Object.entries(KM_ROTATION_SCOPE).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </NativeSelect>
        </label>
        <SwitchField
          label="Somente trocas entre locais diferentes"
          description="Desligado, também sugere trocas dentro da mesma cidade."
          checked={params.differentLocations}
          disabled={ctx.pending}
          onCheckedChange={(on) => ctx.navigate({ locais: on ? null : "0" })}
          data-testid="km-rodizio-locals"
        />
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Indicadores
// ---------------------------------------------------------------------------
function Kpis({ data }: { data: KmRotationData }) {
  const c = data.candidates!;
  const s = c.summary;
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6" data-testid="km-rodizio-kpis">
      <KpiCard size="compact" status="primary" label="Trocas sugeridas" value={s.candidates} data-testid="km-rodizio-kpi-candidates" />
      <KpiCard
        size="compact"
        status="success"
        label="Redução potencial"
        value={s.reductionKmTotal ?? "—"}
        unit={s.reductionKmTotal != null ? "km" : undefined}
        period={`em ${c.horizonDays} dias`}
        data-testid="km-rodizio-kpi-reduction"
      />
      <KpiCard
        size="compact"
        label="Gap médio atual"
        value={s.avgGapCurrent ?? "—"}
        unit={s.avgGapCurrent != null ? "km" : undefined}
        period="entre os hodômetros de cada par"
        data-testid="km-rodizio-kpi-gap"
      />
      <KpiCard
        size="compact"
        status="success"
        label="Prioridade alta"
        value={s.high}
        period={`${fmtInt(s.medium)} ${s.medium === 1 ? "média" : "médias"} · ${fmtInt(s.low)} ${s.low === 1 ? "baixa" : "baixas"}`}
        data-testid="km-rodizio-kpi-high"
      />
      <KpiCard
        size="compact"
        status="warning"
        label="Condicionadas"
        value={s.conditioned}
        period="preventiva ou manutenção pendente"
        data-testid="km-rodizio-kpi-conditioned"
      />
      <KpiCard
        size="compact"
        label="Veículos analisados"
        value={s.vehiclesAnalyzed}
        period={plural(s.cohorts, "coorte", "coortes")}
        data-testid="km-rodizio-kpi-vehicles"
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Grupo (coorte) e cartão de sugestão
// ---------------------------------------------------------------------------
function GroupBlock({
  group,
  items,
  open,
  onToggle,
  horizon,
  numberOf,
  canCreate,
  selected,
  onSelect,
  onAnalyze,
  onAdd,
}: {
  group: KmRotationGroup;
  items: KmRotationCandidate[];
  open: boolean;
  onToggle: () => void;
  horizon: number;
  numberOf: Map<string, number>;
  canCreate: boolean;
  selected: Set<string>;
  onSelect: (key: string, on: boolean) => void;
  onAnalyze: (c: KmRotationCandidate) => void;
  onAdd: (list: KmRotationCandidate[]) => void;
}) {
  const panelId = React.useId();
  const support = [
    plural(group.vehicles, "frota", "frotas"),
    `KM atual médio ${fmtKm(group.odometerAvg)}`,
    `rodagem média ${kmMonth(group.kmMonthAvg)}`,
    `maior ${fmtInt(group.kmMonthMax)}`,
    `menor ${fmtInt(group.kmMonthMin)}`,
    `amplitude dos hodômetros ${fmtKm(group.odometerRange)}`,
    plural(items.length, "sugestão", "sugestões"),
  ].join(" · ");
  return (
    <section className="rounded-lg border border-border bg-surface-raised shadow-card" data-testid="km-rodizio-group">
      <div className="flex flex-wrap items-start justify-between gap-2 p-3 sm:p-4">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={onToggle}
          className="flex min-w-0 flex-1 items-start gap-2 rounded-sm text-left hfm-focus-ring"
        >
          <ChevronDown
            aria-hidden
            className={cn("mt-0.5 size-4 shrink-0 text-fg-muted hfm-transition", !open && "-rotate-90")}
          />
          <span className="flex min-w-0 flex-col gap-0.5">
            <span className="text-h4 font-semibold text-fg">{group.label}</span>
            <span className="text-caption text-fg-muted">{support}</span>
          </span>
        </button>
        {canCreate ? (
          <Button size="sm" variant="outline" leadingIcon={<ListPlus aria-hidden />} onClick={() => onAdd(items)} data-testid="km-rodizio-add-group">
            Adicionar grupo ao plano
          </Button>
        ) : null}
      </div>
      {open ? (
        <div id={panelId} className="grid gap-3 border-t border-border p-3 sm:p-4 lg:grid-cols-2">
          {items.map((c, i) => (
            <SuggestionCard
              key={c.key}
              index={numberOf.get(c.key) ?? i + 1}
              item={c}
              horizon={horizon}
              canCreate={canCreate}
              checked={selected.has(c.key)}
              onCheckedChange={(on) => onSelect(c.key, on)}
              onAnalyze={() => onAnalyze(c)}
              onAdd={() => onAdd([c])}
            />
          ))}
        </div>
      ) : null}
    </section>
  );
}

function SuggestionCard({
  index,
  item,
  horizon,
  canCreate,
  checked,
  onCheckedChange,
  onAnalyze,
  onAdd,
}: {
  index: number;
  item: KmRotationCandidate;
  horizon: number;
  canCreate: boolean;
  checked: boolean;
  onCheckedChange: (on: boolean) => void;
  onAnalyze: () => void;
  onAdd: () => void;
}) {
  const a = item.vehicleA;
  const b = item.vehicleB;
  const title = `Sugestão ${pad2(index)}`;
  return (
    <article
      className={cn(
        "flex min-w-0 flex-col gap-2 rounded-md border bg-surface p-3",
        checked ? "border-primary ring-1 ring-primary" : "border-border",
      )}
      aria-label={`${title}: ${pairText(a, b)}`}
      data-testid="km-rodizio-suggestion"
    >
      <div className="flex flex-wrap items-center gap-2">
        {canCreate ? (
          <Checkbox
            checked={checked}
            onCheckedChange={(v) => onCheckedChange(v === true)}
            aria-label={`Selecionar ${title} (${pairText(a, b)})`}
            data-testid="km-rodizio-suggestion-select"
          />
        ) : null}
        <span className="text-body-sm font-semibold text-fg">{title}</span>
        <PriorityBadge priority={item.priority} />
      </div>
      <PairLine a={a} b={b} />
      <p className="text-caption text-fg-muted">Grupo técnico: {item.cohortLabel}</p>
      <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-body-sm">
        <div className="min-w-0">
          <dt className="text-caption text-fg-muted">{a.plate} · rodagem</dt>
          <dd className="tabular-nums">{kmMonth(a.kmMonth)} · {fmtKm(a.odometer)}</dd>
        </div>
        <div className="min-w-0">
          <dt className="text-caption text-fg-muted">{b.plate} · rodagem</dt>
          <dd className="tabular-nums">{kmMonth(b.kmMonth)} · {fmtKm(b.odometer)}</dd>
        </div>
      </dl>
      <p className="text-body-sm text-fg">
        Redução estimada do desequilíbrio: <strong className="font-semibold tabular-nums">{fmtPct(item.reductionPct)}</strong> em{" "}
        {horizon} dias <span className="text-fg-muted tabular-nums">({fmtKm(item.reductionKm)})</span>
      </p>
      {item.conditioned ? <ConditionedNote reasons={item.conditionReasons ?? []} /> : null}
      <div className="mt-auto flex flex-wrap gap-2 pt-1">
        <Button size="sm" variant="outline" onClick={onAnalyze} data-testid="km-rodizio-suggestion-analyze">
          Ver análise
        </Button>
        {canCreate ? (
          <Button size="sm" variant="secondary" leadingIcon={<ListPlus aria-hidden />} onClick={onAdd} data-testid="km-rodizio-suggestion-add">
            Adicionar ao plano
          </Button>
        ) : null}
      </div>
    </article>
  );
}
