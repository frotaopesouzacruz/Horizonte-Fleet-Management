"use client";

import * as React from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { ChevronsDownUp, ChevronsUpDown, FileSpreadsheet, Rows3, TableProperties } from "lucide-react";
import { Alert, AlertTitle } from "@/components/feedback/alert";
import { EmptyState } from "@/components/feedback/empty-state";
import { ErrorState } from "@/components/feedback/error-state";
import { SectionHeader } from "@/components/layout/section-header";
import { Button } from "@/components/ui/button";
import { MetricStrip } from "@/components/ui/kpi-card";
import { SearchField } from "@/components/ui/search-field";
import { SegmentedControl, ToggleChip } from "@/components/ui/segmented-control";
import { SwitchField } from "@/components/ui/switch";
import { NativeSelect } from "@/components/governance/selects";
import type { KmPlannerData } from "@/lib/km/planner";
import { competenceLabel, fmt1, fmtInt, formatDate } from "@/lib/km/types";
import { formatStamp } from "@/lib/maintenance/types";
import { kmFiltersQuery } from "@/lib/km/url";
import type { KmPanelContext } from "../shared";
import {
  dayMetas,
  groupByLocal,
  matchesSearch,
  parsePlannerColumns,
  parsePlannerMode,
  parsePlannerSort,
  presence,
  PLANNER_EXTRA_LABEL,
  PLANNER_PARAM,
  PLANNER_SORT_LABEL,
  sortRows,
  type PlannerExtraColumn,
  type PlannerMode,
  type PlannerSort,
} from "./planner/model";
import { PlannerGrid } from "./planner/planner-grid";
import { PlannerLegend } from "./planner/planner-legend";
import { PlannerSummary, type SummaryGroup } from "./planner/planner-summary";

/**
 * Planner mês/dia — a grade da competência no formato do Controle Mensal:
 * todas as frotas elegíveis (inclusive sem leitura), uma coluna por dia, total
 * do dia e leituras do dia no rodapé, resumos por tipo e por local. O mesmo
 * conjunto sai no arquivo "Controle Mensal" (XLSX).
 *
 * Modo, colunas extras, ordem e fixação só mudam a apresentação: ficam na URL
 * (link copiado abre igual) sem nova leitura no servidor.
 */
export function PlannerPanel({ data, ctx }: { data: KmPlannerData | null; ctx: KmPanelContext }) {
  if (ctx.error) {
    return (
      <ErrorState
        title="Não foi possível carregar o planner."
        description={ctx.error}
        onRetry={ctx.refresh}
        retrying={ctx.pending}
        data-testid="km-planner-error"
      />
    );
  }
  if (!data || data.days.length === 0 || data.rows.length === 0) {
    return (
      <EmptyState
        variant="panel"
        icon={<TableProperties />}
        title="Nenhuma frota no planner"
        description={
          data && data.days.length > 0
            ? `Nenhuma frota elegível em ${competenceLabel(data.period.competence)} com os filtros atuais. Ajuste os filtros ou escolha outra competência.`
            : "O período da competência não foi devolvido. Recarregue a página ou escolha outra competência."
        }
        data-testid="km-planner-empty"
      />
    );
  }
  return <PlannerContent data={data} ctx={ctx} />;
}

/** Estado de exibição na URL, sem consulta nova (o roteador acompanha o histórico). */
function useViewParams() {
  const params = useSearchParams();
  const pathname = usePathname();
  const set = React.useCallback(
    (patch: Record<string, string | null>) => {
      const next = new URLSearchParams(params.toString());
      for (const [k, v] of Object.entries(patch)) {
        if (v == null || v === "") next.delete(k);
        else next.set(k, v);
      }
      const qs = next.toString();
      window.history.replaceState(null, "", qs ? `${pathname}?${qs}` : pathname);
    },
    [params, pathname],
  );
  return [params, set] as const;
}

function PlannerContent({ data, ctx }: { data: KmPlannerData; ctx: KmPanelContext }) {
  const [params, setParams] = useViewParams();
  // A URL atual (inclusive o que veio do servidor em ctx.params) é a fonte do estado de exibição.
  const mode: PlannerMode = parsePlannerMode(params.get(PLANNER_PARAM.mode) ?? undefined);
  const sort: PlannerSort = parsePlannerSort(params.get(PLANNER_PARAM.sort) ?? undefined);
  const columnsParam = params.get(PLANNER_PARAM.columns);
  const extras = React.useMemo(() => parsePlannerColumns(columnsParam ?? undefined), [columnsParam]);
  const pinned = params.get(PLANNER_PARAM.pin) !== "nao";

  const [search, setSearch] = React.useState("");
  const deferredSearch = React.useDeferredValue(search);
  const [collapsed, setCollapsed] = React.useState<Set<string>>(() => new Set());

  const days = React.useMemo(() => dayMetas(data), [data]);
  const visibleRows = React.useMemo(
    () => sortRows(data.rows.filter((r) => matchesSearch(r, deferredSearch)), sort),
    [data.rows, deferredSearch, sort],
  );
  const groups = React.useMemo(() => (sort === "local" ? groupByLocal(visibleRows) : null), [visibleRows, sort]);

  const toggleGroup = React.useCallback((key: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const toggleExtra = (col: PlannerExtraColumn) => {
    const next = extras.includes(col) ? extras.filter((c) => c !== col) : [...extras, col];
    setParams({ [PLANNER_PARAM.columns]: next.join(",") || null });
  };

  const typeGroups: SummaryGroup[] = React.useMemo(
    () =>
      data.byType.map((g) => ({
        key: g.vehicleTypeId ?? g.type,
        label: g.type,
        vehicles: g.vehicles,
        km: g.km,
        days: g.days,
        present: presence(
          data.rows.filter((r) => (r.vehicleTypeId ?? null) === (g.vehicleTypeId ?? null)),
          data.days.length,
        ),
      })),
    [data.byType, data.rows, data.days.length],
  );
  const localGroups: SummaryGroup[] = React.useMemo(
    () =>
      data.byLocal.map((g) => ({
        key: String(g.cityId ?? g.local),
        label: g.local,
        vehicles: g.vehicles,
        km: g.km,
        days: g.days,
        // O local é o de cada dia: "—" só quando nenhuma frota que passou por ele no mês tem leitura no dia.
        present: presence(
          g.cityId == null ? data.rows : data.rows.filter((r) => r.local === g.local || r.locals.includes(g.local)),
          data.days.length,
        ),
      })),
    [data.byLocal, data.rows, data.days.length],
  );

  const competence = data.period.competence;
  // Mesmo conjunto da tela: mesmos filtros e a competência exibida (o planner não usa período personalizado).
  const exportHref = `${ctx.basePath}/export/controle-mensal?${kmFiltersQuery({
    ...ctx.filters,
    competence,
    from: undefined,
    to: undefined,
  })}`;
  const { totals } = data;
  const emptyMessage = visibleRows.length === 0 ? `Nenhuma frota encontrada para “${deferredSearch.trim()}”.` : null;

  return (
    <div className="flex flex-col gap-5" data-testid="km-planner-panel">
      <SectionHeader
        icon={<TableProperties />}
        title={`Planner mês/dia — ${competenceLabel(competence)}`}
        description={`${formatDate(data.period.from)} a ${formatDate(data.period.to)} · leitura de ${formatStamp(data.generatedAt)}`}
        actions={
          ctx.perms.export ? (
            <Button asChild variant="outline" size="sm" data-testid="km-planner-export">
              <a href={exportHref} download>
                <FileSpreadsheet aria-hidden />
                Exportar Controle Mensal
              </a>
            </Button>
          ) : null
        }
      />

      {data.ignoredPeriod ? (
        <Alert variant="info" data-testid="km-planner-period-notice">
          <AlertTitle>O planner trabalha por competência</AlertTitle>
          <p>
            O período personalizado ({formatDate(data.ignoredPeriod.from)} a {formatDate(data.ignoredPeriod.to)}) não se aplica a
            esta aba. Exibindo {competenceLabel(competence)}; os demais filtros continuam valendo.
          </p>
        </Alert>
      ) : null}

      <MetricStrip
        ariaLabel="Totais do planner"
        items={[
          {
            key: "km",
            label: "KM validado no mês",
            value: totals.daysWithKm > 0 ? fmt1(totals.km) : "—",
            hint: totals.daysWithKm > 0 ? "situações que contam nos totais" : "sem leitura no período (não é 0 km)",
          },
          {
            key: "vehicles",
            label: "Frotas no planner",
            value: fmtInt(totals.vehicles),
            hint: `${fmtInt(totals.vehiclesWithReading)} com leitura no mês`,
          },
          {
            key: "readings",
            label: "Leituras (veículo-dia)",
            value: fmtInt(totals.readingDays),
            hint: `de ${fmtInt(totals.elapsedVehicleDays)} veículo-dia decorridos`,
          },
          {
            key: "days",
            label: "Dias com KM",
            value: fmtInt(totals.daysWithKm),
            hint: `de ${fmtInt(data.days.length)} dias da competência`,
          },
        ]}
      />

      <section aria-label="Grade do planner" className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2.5" data-testid="km-planner-toolbar">
          <SearchField
            size="sm"
            value={search}
            onValueChange={setSearch}
            placeholder="Buscar placa ou frota"
            aria-label="Buscar placa ou frota no planner"
            wrapperClassName="w-full sm:w-60"
            data-testid="km-planner-search"
          />
          <NativeSelect
            fieldSize="sm"
            aria-label="Ordenar o planner"
            value={sort}
            onChange={(e) => setParams({ [PLANNER_PARAM.sort]: e.target.value === "local" ? null : e.target.value })}
            className="min-w-[12rem]"
            data-testid="km-planner-sort"
          >
            {(Object.keys(PLANNER_SORT_LABEL) as PlannerSort[]).map((s) => (
              <option key={s} value={s}>
                Ordenar: {PLANNER_SORT_LABEL[s]}
              </option>
            ))}
          </NativeSelect>

          <SegmentedControl
            aria-label="Modo de exibição"
            data-testid="km-planner-mode"
            value={mode}
            onValueChange={(value) => setParams({ [PLANNER_PARAM.mode]: value === "compacto" ? null : value })}
            options={[
              { value: "compacto", label: "Compacto", title: "Só o KM do dia", icon: <Rows3 aria-hidden />, "data-testid": "km-planner-mode-compacto" },
              {
                value: "detalhado",
                label: "Detalhado",
                title: "Hodômetro inicial, final e KM por dia",
                icon: <TableProperties aria-hidden />,
                "data-testid": "km-planner-mode-detalhado",
              },
            ]}
          />

          <div role="group" aria-label="Colunas opcionais" className="flex items-center gap-1.5">
            {(["operacao", "lideranca"] as const).map((col) => (
              <ToggleChip
                key={col}
                pressed={extras.includes(col)}
                onPressedChange={() => toggleExtra(col)}
                data-testid={`km-planner-col-${col}`}
              >
                {PLANNER_EXTRA_LABEL[col]}
              </ToggleChip>
            ))}
          </div>

          <SwitchField
            label="Fixar colunas"
            checked={pinned}
            onCheckedChange={(v) => setParams({ [PLANNER_PARAM.pin]: v ? null : "nao" })}
            className="hidden w-auto md:flex"
            data-testid="km-planner-pin"
          />

          {groups && groups.length > 1 ? (
            <div className="ml-auto flex items-center gap-1">
              <Button
                size="sm"
                variant="ghost"
                leadingIcon={<ChevronsDownUp aria-hidden />}
                onClick={() => setCollapsed(new Set(groups.map((g) => g.key)))}
              >
                Recolher locais
              </Button>
              <Button size="sm" variant="ghost" leadingIcon={<ChevronsUpDown aria-hidden />} onClick={() => setCollapsed(new Set())}>
                Expandir
              </Button>
            </div>
          ) : null}
        </div>

        <p className="text-caption text-fg-muted" aria-live="polite" data-testid="km-planner-count">
          {fmtInt(visibleRows.length)} de {fmtInt(data.rows.length)} frotas
          {sort === "local" ? " · agrupadas por local (BR e placa na ordem da rotina)" : ` · ${PLANNER_SORT_LABEL[sort].toLowerCase()}`}
        </p>

        <PlannerGrid
          data={data}
          groups={groups}
          rows={visibleRows}
          days={days}
          mode={mode}
          extras={extras}
          pinned={pinned}
          collapsed={collapsed}
          onToggleGroup={toggleGroup}
          emptyMessage={emptyMessage}
        />

        <PlannerLegend />
      </section>

      <div className="grid grid-cols-1 gap-5">
        <PlannerSummary
          title="Resumo por tipo de frota"
          meta="KM validado por dia"
          labelHeader="Tipo de frota"
          groups={typeGroups}
          data={data}
          days={days}
          testId="km-planner-by-type"
        />
        <PlannerSummary
          title="Resumo por local de operação"
          meta="KM validado por dia, pelo local de cada dia"
          labelHeader="Local de operação"
          groups={localGroups}
          data={data}
          days={days}
          testId="km-planner-by-local"
        />
      </div>
    </div>
  );
}
