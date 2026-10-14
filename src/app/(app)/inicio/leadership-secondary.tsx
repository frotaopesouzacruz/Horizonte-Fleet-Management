"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Activity, Route, TrendingUp, Wrench } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { KpiCard } from "@/components/ui/kpi-card";
import { ErrorState } from "@/components/feedback/error-state";
import { EmptyState } from "@/components/feedback/empty-state";
import { SkeletonCard } from "@/components/feedback/skeleton";
import { TrendChart, type TrendPoint } from "@/components/charts/trend-chart";
import type { LeadershipSecondary } from "@/lib/portal/leadership";
import { HomeSection } from "./shortcut-card";

const int = new Intl.NumberFormat("pt-BR");
const pct = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 });
const MONTHS = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];

function dateBr(iso: string | null | undefined): string {
  if (!iso) return "—";
  const [y, m, d] = iso.slice(0, 10).split("-");
  return d ? `${d}/${m}/${y}` : iso;
}

/** Enquanto os blocos secundários não chegam: um esqueleto por bloco, nunca um spinner gigante. */
export function LeadershipSecondarySkeleton() {
  return (
    <div className="flex flex-col gap-6" aria-busy="true" aria-label="Carregando manutenção, preditiva, KM e tendência" data-testid="secundarios-carregando">
      <SkeletonCard lines={2} />
      <div className="grid gap-6 xl:grid-cols-2">
        <SkeletonCard lines={3} />
        <SkeletonCard lines={3} />
      </div>
    </div>
  );
}

/**
 * Blocos de nível 3 e 4 da Home da Liderança — Manutenção, Alertas
 * preditivos, KM e a tendência mensal da aderência. Chegam depois da
 * primeira pintura (Suspense) e cada um falha sozinho, com o motivo e
 * "Tentar novamente" no lugar dos números.
 */
export function LeadershipSecondaryBlocks({ data, query }: { data: LeadershipSecondary; query: string }) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const retry = () => startTransition(() => router.refresh());
  const err = (title: string, error: string) => (
    <ErrorState variant="panel" headingLevel={3} title={title} description={error} onRetry={retry} retrying={pending} />
  );

  const trendPoints: TrendPoint[] = data.trend?.ok
    ? data.trend.data
        .filter((p) => !p.isFuture)
        .map((p) => ({
          key: String(p.month),
          label: MONTHS[p.month - 1] ?? String(p.month),
          value: p.adherencePct,
          current: p.isCurrent,
        }))
    : [];
  const target = data.trend?.ok ? (data.trend.data.find((p) => p.isCurrent)?.targetPct ?? null) : null;

  return (
    <div className="flex flex-col gap-6" data-testid="secundarios">
      {data.maintenance ? (
        <HomeSection
          id="manutencao"
          title="Manutenção"
          icon={<Wrench />}
          description="Programação e execução das manutenções da sua frota, pela rotina oficial do módulo."
          actions={
            <Button asChild size="sm" variant="secondary">
              <Link href={`/frota/manutencao?aba=programacao${query ? `&${query.slice(1)}` : ""}`}>Abrir Manutenção</Link>
            </Button>
          }
          testId="manutencao"
        >
          {!data.maintenance.ok ? (
            err("Não foi possível carregar a Manutenção.", data.maintenance.error)
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <KpiCard size="compact" label="Em manutenção" value={data.maintenance.data.inProgress} icon={<Wrench />}
                status={data.maintenance.data.inProgress > 0 ? "progress" : "neutral"}
                period={`${int.format(data.maintenance.data.immobilized)} frotas imobilizadas`} data-testid="kpi-em-manutencao" />
              <KpiCard size="compact" label="Corretivas e outras em aberto" value={data.maintenance.data.open}
                status={data.maintenance.data.open > 0 ? "info" : "neutral"}
                period={`${int.format(data.maintenance.data.toSchedule)} a agendar · ${int.format(data.maintenance.data.scheduled)} agendadas`} />
              <KpiCard size="compact" label="Fora do prazo" value={data.maintenance.data.exitOverdue + data.maintenance.data.unscheduledOverdue}
                status={data.maintenance.data.exitOverdue + data.maintenance.data.unscheduledOverdue > 0 ? "danger" : "success"}
                period={`${int.format(data.maintenance.data.exitOverdue)} com saída vencida · ${int.format(data.maintenance.data.unscheduledOverdue)} sem agendamento`} />
              <KpiCard size="compact" label="Preventivas a tratar" value={data.maintenance.data.preventiveCritical + data.maintenance.data.preventiveDue}
                status={data.maintenance.data.preventiveCritical > 0 ? "danger" : data.maintenance.data.preventiveDue > 0 ? "warning" : "success"}
                period={`${int.format(data.maintenance.data.preventiveCritical)} críticas · ${int.format(data.maintenance.data.preventiveDue)} vencidas · ${int.format(data.maintenance.data.preventiveToSchedule)} a programar`} />
            </div>
          )}
        </HomeSection>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-2">
        {data.predictive ? (
          <HomeSection
            id="preditiva"
            title="Alertas preditivos"
            icon={<Activity />}
            description="Itens monitorados por KM ou dias, na situação técnica oficial."
            actions={
              <Button asChild size="sm" variant="secondary">
                <Link href="/frota/manutencao?aba=preditiva">Abrir Preditiva</Link>
              </Button>
            }
            testId="preditiva"
          >
            {!data.predictive.ok ? (
              err("Não foi possível carregar a preditiva.", data.predictive.error)
            ) : data.predictive.data.itemsMonitored === 0 ? (
              <EmptyState variant="panel" headingLevel={3} icon={<Activity />} title="Nenhum item preditivo monitorado"
                description="Os alertas aparecem quando houver planos preditivos ativos para a sua frota." />
            ) : (
              <div className="flex flex-col gap-3">
                <div className="grid gap-3 sm:grid-cols-3">
                  <KpiCard size="compact" label="Críticos ou vencidos" value={data.predictive.data.critical}
                    status={data.predictive.data.critical > 0 ? "danger" : "success"} period="itens" data-testid="kpi-preditiva-critica" />
                  <KpiCard size="compact" label="A programar" value={data.predictive.data.toSchedule + data.predictive.data.due}
                    status={data.predictive.data.toSchedule + data.predictive.data.due > 0 ? "warning" : "success"} period="itens" />
                  <KpiCard size="compact" label="Cobertura" value={data.predictive.data.coveragePct == null ? "—" : `${pct.format(data.predictive.data.coveragePct)}%`}
                    status="neutral" period={`${int.format(data.predictive.data.uncoveredVehicles)} frotas sem plano`} />
                </div>
                {data.predictive.data.criticalClusters.length ? (
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-caption font-semibold text-fg-muted">Clusters críticos:</span>
                    {data.predictive.data.criticalClusters.slice(0, 6).map((c) => (
                      <Badge key={c.cluster} variant="danger" size="sm">{c.cluster} · {int.format(c.critical)}</Badge>
                    ))}
                  </div>
                ) : null}
              </div>
            )}
          </HomeSection>
        ) : null}

        {data.km ? (
          <HomeSection
            id="km"
            title="KM rodado"
            icon={<Route />}
            description={data.km.ok && data.km.data.referenceDay ? `Dia de referência ${dateBr(data.km.data.referenceDay)}.` : "Rodagem e atualização do hodômetro das suas placas."}
            actions={
              <Button asChild size="sm" variant="secondary">
                <Link href="/frota/km">Abrir KM</Link>
              </Button>
            }
            testId="km"
          >
            {!data.km.ok ? (
              err("Não foi possível carregar o KM.", data.km.error)
            ) : (
              <div className="grid gap-3 sm:grid-cols-3">
                <KpiCard size="compact" label="KM no mês" value={data.km.data.kmTotal == null ? "—" : int.format(Math.round(data.km.data.kmTotal))} unit={data.km.data.kmTotal == null ? undefined : "km"} status="primary" period="validado" data-testid="kpi-km-mes" />
                <KpiCard size="compact" label="Sem KM no dia" value={data.km.data.vehiclesWithoutReadingRef}
                  status={data.km.data.vehiclesWithoutReadingRef > 0 ? "warning" : "success"} period="frotas ativas sem leitura" />
                <KpiCard size="compact" label="Desatualizadas" value={data.km.data.vehiclesStale}
                  status={data.km.data.vehiclesStale > 0 ? "warning" : "success"} period={data.km.data.lastUpdate ? `última atualização ${dateBr(data.km.data.lastUpdate)}` : "frotas"} />
              </div>
            )}
          </HomeSection>
        ) : null}
      </div>

      {data.trend ? (
        <HomeSection
          id="tendencia"
          title="Tendência da aderência"
          icon={<TrendingUp />}
          description="Saída, mês a mês, no ano — a mesma fórmula da Aderência, com expurgos."
          testId="tendencia"
        >
          {!data.trend.ok ? (
            err("Não foi possível carregar a tendência.", data.trend.error)
          ) : trendPoints.every((p) => p.value == null) ? (
            <EmptyState variant="panel" headingLevel={3} icon={<TrendingUp />} title="Ainda sem base no ano"
              description="A tendência aparece a partir do primeiro mês com obrigações." />
          ) : (
            <div className="rounded-xl border border-border bg-surface-raised p-4 shadow-card">
              <TrendChart
                points={trendPoints}
                ariaLabel="Aderência de saída por mês"
                target={target}
                targetLabel={target != null ? `Meta ${pct.format(target)}%` : undefined}
                kind="percent"
                format={(v) => `${pct.format(v)}%`}
                height={160}
              />
            </div>
          )}
        </HomeSection>
      ) : null}
    </div>
  );
}
