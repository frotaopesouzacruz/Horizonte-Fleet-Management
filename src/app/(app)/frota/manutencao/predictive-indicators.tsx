"use client";

import * as React from "react";
import { Activity, Gauge, Target, Timer, Wrench } from "lucide-react";
import { KpiCard } from "@/components/ui/kpi-card";
import { Panel } from "@/components/ui/card";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Table, TableBody, TableCell, TableContainer, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState } from "@/components/feedback/empty-state";
import { ChartCard, ColumnChart, TrendChart, type TrendPoint } from "@/components/charts";
import {
  CRITICALITY_LABEL,
  formatDate,
  formatInt,
  formatKm,
  vehicleLabel,
  type Criticality,
  type PredictiveIndicators,
  type PredictiveOverview,
  type PredictiveTrends,
} from "@/lib/maintenance/types";
import { pctText } from "./predictive-shared";
import type { PanelActions } from "./shared";

/**
 * Indicadores da preditiva: verificações (volume, % NC, % monitoramento, % no
 * prazo, % com KM, pelo app), conversão NC → corretiva e antecipações, SLA por
 * criticidade, tempos médios, atraso atual, recorrência de não conformidade e
 * a tendência (previsto × realizado) dos snapshots diários.
 */
export interface PredictiveIndicatorsPanelProps {
  overview: PredictiveOverview;
  indicators: PredictiveIndicators | null | undefined;
  trends: PredictiveTrends | null | undefined;
  pending: boolean;
  actions: PanelActions;
}

type Metric = "backlog" | "critical" | "due" | "toSchedule" | "awaitingCorrective" | "monitoring";
const METRIC_LABEL: Record<Metric, string> = {
  backlog: "Backlog",
  critical: "Críticos",
  due: "Vencidos",
  toSchedule: "A programar",
  awaitingCorrective: "Aguardando corretiva",
  monitoring: "Em monitoramento",
};
const intFmt = (v: number) => formatInt(v);
const daysFmt = (v: number | null) => (v == null ? "—" : `${new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 }).format(v)} d`);
const shortDate = (iso: string) => {
  const [, m, d] = iso.split("-");
  return `${d}/${m}`;
};

export function PredictiveIndicatorsPanel({ overview, indicators, trends, pending, actions }: PredictiveIndicatorsPanelProps) {
  const [metric, setMetric] = React.useState<Metric>("backlog");
  const series = trends?.series ?? [];
  const points: TrendPoint[] = series.map((p, i) => ({
    key: p.date,
    label: shortDate(p.date),
    value: p[metric],
    current: i === series.length - 1,
    tooltip: { title: formatDate(p.date), rows: [{ label: METRIC_LABEL[metric], value: formatInt(p[metric]) }, { label: "Itens", value: formatInt(p.items) }] },
  }));

  if (!indicators) {
    return (
      <EmptyState
        variant="panel"
        size="sm"
        title="Indicadores indisponíveis"
        description="A leitura dos indicadores falhou. Tente de novo em instantes."
        action={<button type="button" className="text-link underline-offset-2 hover:underline" onClick={actions.refresh} disabled={pending}>Tentar de novo</button>}
      />
    );
  }
  const v = indicators.verifications;
  const c = indicators.conversion;
  const sla = indicators.sla;
  const lt = indicators.leadTimesDays;
  const cur = indicators.current;
  const rec = indicators.recurrence;

  return (
    <div className="flex flex-col gap-4" data-testid="maintenance-predictive-indicators">
      <p className="text-caption text-fg-muted">
        Período: {formatDate(indicators.period.from)} a {formatDate(indicators.period.to)} (ou o recorte de datas dos filtros). Os números respeitam os filtros
        de frota, operação e cluster.
      </p>

      <section aria-label="Verificações" className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <KpiCard size="compact" label="Verificações" value={formatInt(v.total)} period={`${formatInt(v.fromApp)} pelo aplicativo`} icon={<Activity />} />
        <KpiCard size="compact" label="Não conformidade" value={pctText(v.ncRatePct)} status={v.ncRatePct != null && v.ncRatePct > 30 ? "warning" : undefined} period={`${formatInt(v.nonConforming)} NC · ${formatInt(v.conforming)} conformes`} icon={<Target />} />
        <KpiCard size="compact" label="Monitoramento" value={pctText(v.monitoringRatePct)} period={`${formatInt(v.monitor)} verificações em monitoramento`} />
        <KpiCard size="compact" label="No prazo" value={pctText(v.onTimePct)} status={v.onTimePct != null && v.onTimePct < 70 ? "warning" : undefined} period={`${formatInt(v.onTime)} no prazo · ${formatInt(v.late)} depois do marco`} />
        <KpiCard size="compact" label="Com KM" value={pctText(v.withKmPct)} period="verificações com KM resolvido" />
        <KpiCard size="compact" label="Não realizadas" value={formatInt(v.notPerformed)} unit="registros" period="com motivo registrado" />
      </section>

      <section aria-label="Conversão, SLA e tempos" className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <KpiCard size="compact" label="NC → corretiva" value={pctText(c.conversionPct)} period={`${formatInt(c.ncWithMaintenance)} de ${formatInt(c.ncTotal)} NC`} icon={<Wrench />} />
        <KpiCard size="compact" label="Antecipações" value={formatInt(c.anticipations)} unit="NC tratadas" period={`${pctText(c.anticipationPct)} das NC · ${formatInt(c.open)} abertas · ${formatInt(c.withoutMaintenance)} sem manutenção`} />
        <KpiCard size="compact" label="Dentro do SLA" value={pctText(sla.withinSlaPct)} status={sla.ncOpenBeyondSla > 0 ? "danger" : undefined} period={`${formatInt(sla.ncWithinSla)} de ${formatInt(sla.ncTreated)} tratadas · ${formatInt(sla.ncOpenBeyondSla)} abertas fora do SLA`} icon={<Gauge />} />
        <KpiCard size="compact" label="NC → abertura" value={daysFmt(lt.ncToMaintenanceOpen)} period="tempo médio até abrir a corretiva" icon={<Timer />} />
        <KpiCard size="compact" label="Abertura → conclusão" value={daysFmt(lt.maintenanceOpenToDone)} period="tempo médio da corretiva" />
        <KpiCard size="compact" label="Sinal → verificação" value={daysFmt(lt.flaggedToVerified)} period={`${formatInt(lt.flaggedPending)} itens em alerta ainda sem verificação`} />
      </section>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        <Panel title="SLA por criticidade" meta="dias para tratar uma não conformidade" padding="none">
          <TableContainer>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Criticidade</TableHead>
                  <TableHead numeric>Dias</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(["critical", "high", "medium", "low"] as Criticality[]).map((k) => (
                  <TableRow key={k}>
                    <TableCell>{CRITICALITY_LABEL[k]}</TableCell>
                    <TableCell numeric>{formatInt(sla.days[k])}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </Panel>
        <Panel title="Atraso atual" meta="itens vencidos e críticos do recorte" padding="md">
          <dl className="grid grid-cols-2 gap-3 text-body-sm">
            <Fact label="Backlog">{formatInt(cur.backlog)} itens</Fact>
            <Fact label="Atraso médio em KM">{cur.avgOverdueKm != null ? formatKm(cur.avgOverdueKm) : "—"}</Fact>
            <Fact label="Maior atraso em KM">{cur.maxOverdueKm != null ? formatKm(cur.maxOverdueKm) : "—"}</Fact>
            <Fact label="Atraso médio em dias">{daysFmt(cur.avgOverdueDays)}</Fact>
            <Fact label="Maior atraso em dias">{daysFmt(cur.maxOverdueDays)}</Fact>
            <Fact label="Referência formal">{pctText(cur.formalReferencePct)}</Fact>
            <Fact label="Só histórico">{pctText(cur.historyOnlyPct)}</Fact>
          </dl>
        </Panel>
        <Panel title="Recorrência" meta="não conformidades repetidas" padding="md">
          <dl className="grid grid-cols-2 gap-3 text-body-sm">
            <Fact label="KM médio entre NC">{rec.meanKmBetweenNc != null ? formatKm(rec.meanKmBetweenNc) : "—"}</Fact>
            <Fact label="Dias médios entre NC">{daysFmt(rec.meanDaysBetweenNc)}</Fact>
          </dl>
          {rec.byCluster.length === 0 ? (
            <p className="mt-2 text-caption text-fg-muted">Nenhuma não conformidade no período.</p>
          ) : (
            <ul className="mt-2 flex flex-col divide-y divide-border-subtle">
              {rec.byCluster.slice(0, 6).map((r) => (
                <li key={r.clusterId} className="flex items-center justify-between gap-2 py-1 text-body-sm">
                  <span className="truncate text-fg">{r.cluster}</span>
                  <span className="shrink-0 tabular-nums text-fg-muted">
                    {formatInt(r.nonConforming)} NC · {pctText(r.sharePct)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <Panel title="Veículo × cluster com NC repetida" meta={`${formatInt(rec.byVehicleCluster.length)} combinação(ões)`} padding="none" data-testid="maintenance-predictive-recurrence">
          {rec.byVehicleCluster.length === 0 ? (
            <p className="px-4 py-3 text-body-sm text-fg-muted">Nenhum veículo repetiu não conformidade no mesmo cluster.</p>
          ) : (
            <TableContainer>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Veículo</TableHead>
                    <TableHead>Cluster</TableHead>
                    <TableHead numeric>NC</TableHead>
                    <TableHead>Última</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rec.byVehicleCluster.map((r) => (
                    <TableRow key={`${r.vehicleId}-${r.clusterId}`}>
                      <TableCell>{vehicleLabel(r.licensePlate, r.fleetCode)}</TableCell>
                      <TableCell>{r.cluster}</TableCell>
                      <TableCell numeric>{formatInt(r.nonConforming)}</TableCell>
                      <TableCell>{formatDate(r.last)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          )}
        </Panel>
        <div className="flex flex-col gap-3">
          <Panel title="Por modelo" padding="none">
            <SimpleList rows={rec.byModel.map((r) => ({ key: r.model ?? "—", label: r.model ?? "Sem modelo", value: `${formatInt(r.nonConforming)} NC · ${formatInt(r.vehicles)} veíc.` }))} />
          </Panel>
          <Panel title="Por operação" padding="none">
            <SimpleList rows={rec.byOperation.map((r) => ({ key: r.operation ?? "—", label: r.operation ?? "Sem operação", value: `${formatInt(r.nonConforming)} NC` }))} />
          </Panel>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <ChartCard
          title="Previsto × realizado"
          description="Evolução diária do recorte: o que o motor previa (itens a programar/vencidos) contra o que foi tratado (backlog cai quando verificações e corretivas acontecem)."
          actions={
            <SegmentedControl
              value={metric}
              onValueChange={setMetric}
              options={(Object.keys(METRIC_LABEL) as Metric[]).map((m) => ({ value: m, label: METRIC_LABEL[m] }))}
              aria-label="Métrica da tendência"
              wrap
              disabled={pending}
            />
          }
          empty={points.length < 2 ? "A tendência aparece a partir do segundo snapshot diário." : undefined}
        >
          <TrendChart points={points} ariaLabel={`${METRIC_LABEL[metric]} por dia`} kind="number" format={intFmt} height={200} />
        </ChartCard>
        <ChartCard
          title="Verificações e NC por semana"
          empty={(trends?.weeklyVerifications ?? []).length === 0 ? "Nenhuma verificação no período." : undefined}
        >
          <ColumnChart
            items={(trends?.weeklyVerifications ?? []).map((w) => ({
              key: w.weekStart,
              label: shortDate(w.weekStart),
              value: w.verifications,
              segments: [
                { key: "ok", value: Math.max(0, w.verifications - w.nonConforming), color: "var(--chart-1)" },
                { key: "nc", value: w.nonConforming, color: "var(--color-danger)" },
              ],
            }))}
            ariaLabel="Verificações por semana"
            format={intFmt}
            kind="count"
            height={200}
          />
        </ChartCard>
      </div>
      <p className="text-caption text-fg-muted">
        Itens monitorados no recorte: {formatInt(overview.summary.itemsMonitored)}. Indicadores são contagens e médias do servidor — sem projeções estatísticas.
      </p>
    </div>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className="text-caption text-fg-muted">{label}</dt>
      <dd className="text-body-sm text-fg tabular-nums">{children}</dd>
    </div>
  );
}

function SimpleList({ rows }: { rows: { key: string; label: string; value: string }[] }) {
  if (rows.length === 0) return <p className="px-4 py-3 text-body-sm text-fg-muted">Sem não conformidades no período.</p>;
  return (
    <ul className="flex flex-col divide-y divide-border-subtle px-4 py-1">
      {rows.slice(0, 8).map((r) => (
        <li key={r.key} className="flex items-center justify-between gap-2 py-1.5 text-body-sm">
          <span className="truncate text-fg">{r.label}</span>
          <span className="shrink-0 tabular-nums text-fg-muted">{r.value}</span>
        </li>
      ))}
    </ul>
  );
}
