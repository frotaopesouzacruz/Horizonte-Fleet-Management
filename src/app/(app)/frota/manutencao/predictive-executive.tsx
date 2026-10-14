"use client";

import * as React from "react";
import { Activity, AlertTriangle, ArrowRight, Clock, Eye, Gauge, HeartPulse, Layers, Target, Wrench } from "lucide-react";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { KpiCard } from "@/components/ui/kpi-card";
import { Panel } from "@/components/ui/card";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Table, TableBody, TableCell, TableContainer, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { InsightCard } from "@/components/feedback/insight-card";
import { EmptyState } from "@/components/feedback/empty-state";
import { ChartCard, ColumnChart, GaugeChart, HBarChart, TrendChart, type HBarDatum, type TrendPoint } from "@/components/charts";
import {
  formatDate,
  formatInt,
  PREDICTIVE_RANKING_LABEL,
  type MaintenanceCatalog,
  type PredictiveIndicators,
  type PredictiveOverview,
  type PredictiveRankingKey,
  type PredictiveTrends,
} from "@/lib/maintenance/types";
import type { PredictiveFilters } from "@/lib/maintenance/queries";
import { insightPatch, pct1Format, pctText, rankingPatch } from "./predictive-shared";
import type { PanelActions } from "./shared";

/**
 * Painel executivo da preditiva: a saúde do programa em uma tela — índice de
 * saúde, backlog, previsão de demanda por janelas de KM e dias, cobertura do
 * plano, rankings (frotas, clusters, modelos, tipos, operações, locais, BRs,
 * lideranças), insights determinísticos e a tendência dos snapshots diários.
 * Todo número vem calculado do servidor; os cliques só mudam filtros da URL.
 */
export interface PredictiveExecutiveProps {
  overview: PredictiveOverview;
  indicators: PredictiveIndicators | null | undefined;
  trends: PredictiveTrends | null | undefined;
  filters: PredictiveFilters;
  catalog: MaintenanceCatalog;
  pending: boolean;
  actions: PanelActions;
}

const RANKING_KEYS: PredictiveRankingKey[] = ["fleets", "clusters", "models", "types", "operations", "cities", "brs", "leaders"];
const HEALTH_COMPONENT_LABEL: Record<string, string> = {
  critical: "Críticos",
  due: "Vencidos",
  awaiting_corrective: "Aguardando corretiva",
  to_schedule: "A programar",
  no_km: "Sem KM",
  km_stale: "KM desatualizado",
  initial_inspection: "Inspeção inicial",
  monitoring: "Em monitoramento",
  history_reference: "Só histórico",
};

function healthStatus(score: number | null): "success" | "warning" | "danger" | undefined {
  if (score == null) return undefined;
  if (score >= 85) return "success";
  if (score >= 70) return "warning";
  return "danger";
}

const intFmt = (v: number) => formatInt(v);
const shortDate = (iso: string) => {
  const [, m, d] = iso.split("-");
  return `${d}/${m}`;
};

export function PredictiveExecutive({ overview, indicators, trends, filters, catalog, pending, actions }: PredictiveExecutiveProps) {
  const s = overview.summary;
  const health = overview.health;
  const [rankingKey, setRankingKey] = React.useState<PredictiveRankingKey>(() => RANKING_KEYS.find((k) => overview.rankings[k]?.length) ?? "fleets");
  const ranking = overview.rankings[rankingKey] ?? [];
  const currentRankingFilter: Record<PredictiveRankingKey, string | undefined> = {
    fleets: filters.vehicle,
    clusters: filters.cluster,
    models: filters.model,
    types: filters.vehicleType,
    operations: filters.operation,
    cities: filters.city,
    brs: filters.br,
    leaders: filters.leader,
  };
  const go = (patch: Record<string, string | null>) => actions.navigate(patch);

  const forecastKm: HBarDatum[] = overview.forecast.km.map((w) => ({
    key: `km-${w.window}`,
    label: `Próximos ${formatInt(w.window)} km`,
    value: w.count,
    detail: w.count === 1 ? "item" : "itens",
  }));
  const forecastDays: HBarDatum[] = overview.forecast.days.map((w) => ({
    key: `d-${w.window}`,
    label: `Próximos ${formatInt(w.window)} dias`,
    value: w.count,
    detail: w.count === 1 ? "item" : "itens",
  }));
  const clusterBars: HBarDatum[] = overview.criticalClusters.slice(0, 8).map((c) => ({
    key: c.clusterId ?? c.cluster,
    label: c.cluster,
    value: c.critical,
    detail: c.toSchedule ? `· ${formatInt(c.toSchedule)} a programar` : undefined,
  }));
  const rankingBars: HBarDatum[] = ranking.map((r) => ({
    key: r.key,
    label: r.label ?? "—",
    value: r.critical,
    detail: [r.detail, r.toSchedule ? `${formatInt(r.toSchedule)} a programar` : null, r.vehicles != null ? `${formatInt(r.vehicles)} veíc.` : null]
      .filter(Boolean)
      .join(" · ") || undefined,
  }));

  const series = trends?.series ?? [];
  const backlogPoints: TrendPoint[] = series.map((p, i) => ({
    key: p.date,
    label: shortDate(p.date),
    value: p.backlog,
    current: i === series.length - 1,
    tooltip: {
      title: formatDate(p.date),
      rows: [
        { label: "Backlog", value: formatInt(p.backlog) },
        { label: "Críticos", value: formatInt(p.critical) },
        { label: "Vencidos", value: formatInt(p.due) },
        { label: "Aguardando corretiva", value: formatInt(p.awaitingCorrective) },
        { label: "Itens", value: formatInt(p.items) },
      ],
    },
  }));
  const weekly = trends?.weeklyVerifications ?? [];

  const monitored = s.itemsMonitored || 0;
  const backlogPct = monitored > 0 ? (s.backlog * 100) / monitored : null;

  return (
    <div className="flex flex-col gap-4" data-testid="maintenance-predictive-executive">
      <section aria-label="Indicadores executivos" className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <KpiCard
          size="compact"
          label="Índice de saúde preditiva"
          value={health.score == null ? "—" : pct1Format(health.score).replace("%", "")}
          unit={health.score == null ? undefined : "/ 100"}
          status={healthStatus(health.score)}
          period={`${formatInt(monitored)} itens monitorados`}
          icon={<HeartPulse />}
          data-testid="maintenance-predictive-kpi-health"
        />
        <KpiCard
          size="compact"
          label="Backlog técnico"
          value={formatInt(s.backlog)}
          unit="itens"
          status={s.backlog > 0 ? "danger" : "success"}
          period={backlogPct == null ? "críticos + vencidos + aguardando corretiva" : `${pctText(backlogPct)} do monitorado`}
          icon={<AlertTriangle />}
          data-testid="maintenance-predictive-kpi-backlog"
        />
        <KpiCard
          size="compact"
          label={`Previsão · ${formatInt(s.forecastKmWindow)} km`}
          value={formatInt(s.forecastKm)}
          unit="itens"
          period={`${formatInt(s.forecastDays)} itens nos próximos ${formatInt(s.forecastDaysWindow)} dias`}
          icon={<Target />}
          data-testid="maintenance-predictive-kpi-forecast"
        />
        <KpiCard
          size="compact"
          label="Referência formal"
          value={pctText(s.formalReferencePct)}
          status={s.formalReferencePct != null && s.formalReferencePct < 60 ? "warning" : undefined}
          period={`${formatInt(s.historyReference)} só por histórico (${pctText(s.historyReferencePct)})`}
          icon={<Layers />}
          data-testid="maintenance-predictive-kpi-reference"
        />
        <KpiCard
          size="compact"
          label="KM desatualizado"
          value={formatInt(s.kmStale)}
          unit="itens"
          status={s.kmStale > 0 ? "warning" : undefined}
          period={`${formatInt(s.noKm)} sem KM · limite ${formatInt(s.kmMaxAgeDays)} dias`}
          icon={<Clock />}
          data-testid="maintenance-predictive-kpi-km-stale"
        />
        <KpiCard
          size="compact"
          label="Em monitoramento"
          value={formatInt(s.monitoring)}
          unit="itens"
          period={`${formatInt(s.awaitingCorrective)} aguardando corretiva · ${formatInt(s.scheduled + s.inProgress)} em execução/agendados`}
          icon={<Eye />}
          data-testid="maintenance-predictive-kpi-monitoring"
        />
      </section>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        <ChartCard
          title="Previsão de demanda por KM"
          description="Itens cujo marco chega dentro de cada janela de KM (janelas configuráveis)."
          empty={forecastKm.every((f) => !f.value) ? "Nenhum item vence nas janelas de KM." : undefined}
        >
          <HBarChart items={forecastKm} ariaLabel="Previsão de itens por janela de KM" format={intFmt} kind="count" labelWidth={150} />
        </ChartCard>
        <ChartCard
          title="Previsão de demanda por data"
          description="Itens cujo prazo chega dentro de cada janela de dias."
          empty={forecastDays.every((f) => !f.value) ? "Nenhum item vence nas janelas de dias." : undefined}
        >
          <HBarChart items={forecastDays} ariaLabel="Previsão de itens por janela de dias" format={intFmt} kind="count" labelWidth={150} />
        </ChartCard>
        <ChartCard
          title="Cobertura do plano técnico"
          description={`${formatInt(overview.coverage.coveredVehicles)} de ${formatInt(overview.coverage.activeVehicles)} veículos ativos com plano aplicável.`}
          footer={
            overview.coverage.uncoveredVehicles > 0 ? (
              <span className="text-caption text-fg-muted">
                {formatInt(overview.coverage.uncoveredVehicles)} veículo(s) sem plano: sem plano não há ciclo preditivo (inconsistência “frota sem plano”).
              </span>
            ) : undefined
          }
        >
          <div className="flex items-center justify-center py-1">
            <GaugeChart
              value={overview.coverage.coveragePct}
              tone={overview.coverage.coveragePct != null && overview.coverage.coveragePct >= 80 ? "success" : "warning"}
              label="Cobertura"
              ariaLabel="Cobertura do plano técnico sobre a frota ativa"
              size={150}
            />
          </div>
        </ChartCard>
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <ChartCard
          title="Rankings"
          description="Onde estão os itens críticos e vencidos. Selecione uma linha para filtrar os alertas."
          actions={
            <SegmentedControl
              value={rankingKey}
              onValueChange={setRankingKey}
              options={RANKING_KEYS.map((k) => ({ value: k, label: PREDICTIVE_RANKING_LABEL[k], "data-testid": `maintenance-predictive-ranking-${k}` }))}
              aria-label="Dimensão do ranking"
              wrap
              disabled={pending}
            />
          }
          empty={rankingBars.length === 0 ? `Nenhum item crítico ou vencido por ${PREDICTIVE_RANKING_LABEL[rankingKey].toLowerCase()} no recorte.` : undefined}
          data-testid="maintenance-predictive-rankings"
        >
          <HBarChart
            items={rankingBars}
            ariaLabel={`Ranking de ${PREDICTIVE_RANKING_LABEL[rankingKey]} por itens críticos e vencidos`}
            format={intFmt}
            kind="count"
            labelWidth={190}
            onSelect={(item) => {
              const entry = ranking.find((r) => r.key === item.key);
              if (entry) go(rankingPatch(rankingKey, entry, currentRankingFilter[rankingKey]));
            }}
          />
        </ChartCard>
        <ChartCard
          title="Clusters em atenção"
          description="Itens críticos e vencidos por cluster técnico; a programar entra como detalhe."
          empty={clusterBars.length === 0 ? "Nenhum cluster com itens críticos, vencidos ou a programar." : undefined}
        >
          <HBarChart
            items={clusterBars}
            ariaLabel="Clusters com itens críticos e vencidos"
            format={intFmt}
            kind="count"
            labelWidth={170}
            onSelect={(item) => {
              const id = overview.criticalClusters.find((c) => (c.clusterId ?? c.cluster) === item.key)?.clusterId
                ?? catalog.clusters.find((c) => c.name === item.label)?.id;
              if (id) go({ cluster: filters.cluster === id ? null : id, pagina: null, pd_visao: "alertas" });
            }}
          />
        </ChartCard>
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-[3fr_2fr]">
        <Panel title="Insights" meta="determinísticos, a partir dos números acima" padding="md" data-testid="maintenance-predictive-insights">
          {overview.insights.length === 0 ? (
            <p className="text-body-sm text-fg-muted">Nenhum fato relevante no recorte: nada crítico, vencido ou sem KM confiável.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {overview.insights.map((insight) => (
                <li key={insight.key}>
                  <InsightCard
                    tone={insight.tone}
                    title={insight.title}
                    compact
                    action={
                      insight.filter ? (
                        <Button size="sm" variant="ghost" trailingIcon={<ArrowRight />} onClick={() => go(insightPatch(insight.filter, catalog))} disabled={pending}>
                          Ver recorte
                        </Button>
                      ) : undefined
                    }
                  >
                    {insight.text}
                  </InsightCard>
                </li>
              ))}
            </ul>
          )}
        </Panel>
        <Panel title="Como o índice de saúde é calculado" meta={health.score == null ? undefined : `${pct1Format(health.score).replace("%", "")} / 100`} padding="none">
          <TableContainer>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Componente</TableHead>
                  <TableHead numeric>Peso</TableHead>
                  <TableHead numeric>Itens</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {health.components.map((c) => (
                  <TableRow key={c.key}>
                    <TableCell>{HEALTH_COMPONENT_LABEL[c.key] ?? c.key}</TableCell>
                    <TableCell numeric>{formatInt(c.weight)}</TableCell>
                    <TableCell numeric>{formatInt(c.count)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
          <p className="px-4 py-2 text-caption text-fg-muted">{health.formula}</p>
        </Panel>
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <ChartCard
          title="Tendência do backlog"
          description="Críticos + vencidos + aguardando corretiva por dia (snapshot diário do recorte da organização)."
          empty={backlogPoints.length < 2 ? "A tendência aparece a partir do segundo snapshot diário." : undefined}
          insight={
            backlogPoints.length >= 2
              ? `${formatInt(series[series.length - 1].backlog)} hoje · ${formatInt(series[0].backlog)} em ${formatDate(series[0].date)}`
              : undefined
          }
        >
          <TrendChart points={backlogPoints} ariaLabel="Backlog técnico por dia" kind="number" format={intFmt} height={180} />
        </ChartCard>
        <ChartCard
          title="Verificações por semana"
          description="Verificações registradas, com as não conformes em destaque."
          empty={weekly.length === 0 ? "Nenhuma verificação no período." : undefined}
        >
          <ColumnChart
            items={weekly.map((w) => ({
              key: w.weekStart,
              label: shortDate(w.weekStart),
              value: w.verifications,
              segments: [
                { key: "ok", value: Math.max(0, w.verifications - w.nonConforming), color: "var(--chart-1)" },
                { key: "nc", value: w.nonConforming, color: "var(--color-danger)" },
              ],
              tooltip: {
                title: `Semana de ${formatDate(w.weekStart)}`,
                rows: [
                  { label: "Verificações", value: formatInt(w.verifications) },
                  { label: "Não conformes", value: formatInt(w.nonConforming) },
                  { label: "Monitoramento", value: formatInt(w.monitoring) },
                  { label: "Pelo aplicativo", value: formatInt(w.fromApp) },
                ],
              },
            }))}
            ariaLabel="Verificações por semana"
            format={intFmt}
            kind="count"
            height={180}
          />
        </ChartCard>
      </div>

      {indicators ? (
        <section className="grid grid-cols-2 gap-3 md:grid-cols-4" aria-label="Efetividade do programa">
          <KpiCard
            size="compact"
            label="Verificações no prazo"
            value={pctText(indicators.verifications.onTimePct)}
            period={`${formatInt(indicators.verifications.onTime)} no prazo · ${formatInt(indicators.verifications.late)} atrasadas`}
            icon={<Activity />}
          />
          <KpiCard
            size="compact"
            label="NC → corretiva"
            value={pctText(indicators.conversion.conversionPct)}
            period={`${formatInt(indicators.conversion.ncWithMaintenance)} de ${formatInt(indicators.conversion.ncTotal)} não conformidades`}
            icon={<Wrench />}
          />
          <KpiCard
            size="compact"
            label="Dentro do SLA"
            value={pctText(indicators.sla.withinSlaPct)}
            status={indicators.sla.ncOpenBeyondSla > 0 ? "danger" : undefined}
            period={`${formatInt(indicators.sla.ncOpenBeyondSla)} NC abertas fora do SLA`}
            icon={<Gauge />}
          />
          <KpiCard
            size="compact"
            label="Antecipações"
            value={formatInt(indicators.conversion.anticipations)}
            unit="falhas evitadas"
            period="NC tratadas por corretiva concluída"
            icon={<Target />}
          />
        </section>
      ) : null}

      {overview.rowsTotal === 0 ? (
        <EmptyState
          variant="panel"
          size="sm"
          title="Nenhum veículo com plano técnico no recorte"
          description="Aprove um plano técnico para o tipo/modelo e recalcule os ciclos — ou ajuste os filtros."
        />
      ) : null}
      <p className={cn("text-caption text-fg-muted")}>
        Previsões usam o pior caso entre KM e dias; o índice de saúde pondera itens por situação. Nada aqui é estimativa estatística — são contagens do recorte.
      </p>
    </div>
  );
}
