"use client";

import * as React from "react";
import {
  Activity, CalendarCheck, CalendarDays, CircleSlash, Clock, Flame, Gauge, Percent, RefreshCw, Route, Sigma,
  SignalZero, TriangleAlert, Truck,
} from "lucide-react";
import { EmptyState } from "@/components/feedback/empty-state";
import { ErrorState } from "@/components/feedback/error-state";
import type { KmOverviewData } from "@/lib/km/overview";
import { competenceLabel, fmt1, fmtInt, fmtKm, fmtKm1, fmtPct, formatDate } from "@/lib/km/types";
import type { KmPanelContext } from "../shared";
import { InsightsCard, KmShareCard, StatusCard } from "./overview/distributions";
import { FreshnessCard } from "./overview/freshness-card";
import { KmByDayChart } from "./overview/km-by-day-chart";
import { dateLong, formatStamp, KmKpi, Section, shareOf, useKmLink } from "./overview/km-ui";
import { VehicleRankCard } from "./overview/vehicle-rank-card";

/**
 * KM → Visão geral (§24–27).
 *
 * Tudo chega pronto de `km_overview` sobre a grade veículo × dia: totais,
 * médias e medianas, cobertura, faixas de atualização, distribuições,
 * Top/Bottom e as leituras. A tela formata e liga cada número à visão que o
 * explica (Visão diária, Histórico por frota, Qualidade de dados).
 */
export function OverviewPanel({ data, ctx }: { data: KmOverviewData | null; ctx: KmPanelContext }) {
  const link = useKmLink(ctx);

  if (ctx.error) {
    return (
      <ErrorState
        variant="panel"
        title="Não foi possível carregar a visão geral do KM."
        description={ctx.error}
        onRetry={ctx.refresh}
        retryLabel="Tentar de novo"
        retrying={ctx.pending}
        data-testid="km-visao-geral-error"
      />
    );
  }
  if (!data || !data.kpis || !data.period) {
    return (
      <EmptyState
        variant="panel"
        icon={<Route />}
        title="Sem dados de KM para mostrar"
        description="A leitura da visão geral não trouxe resultado. Ajuste os filtros ou importe as leituras diárias."
        data-testid="km-visao-geral-empty"
      />
    );
  }

  const { period, kpis: k, settings } = data;
  const refDay = period.referenceDay;
  const canDaily = ctx.perms.daily;
  const coverageRefPct = shareOf(k.coverageRefCount, k.coverageRefTotal);
  const highKm = k.highMileageKm ?? settings?.highMileageKm ?? null;
  const dailyNav = canDaily && refDay ? link({ aba: "diaria", dia: refDay }) : null;
  const minCoverage = settings?.minCoveragePct;

  const header = (
    <p className="text-body-sm text-fg-muted" data-testid="km-visao-geral-period">
      Período <span className="font-medium text-fg-secondary tabular-nums">{formatDate(period.from)} a {formatDate(period.to)}</span>
      {period.from.slice(0, 7) === period.to.slice(0, 7) ? ` (${competenceLabel(period.competence)})` : ""} · dia de referência{" "}
      {refDay ? (
        <span className="font-medium text-fg-secondary" data-testid="km-visao-geral-reference-day">
          {dateLong(refDay)}
        </span>
      ) : (
        <span className="font-medium text-fg-secondary" data-testid="km-visao-geral-reference-day">sem KM validado no período</span>
      )}{" "}
      (último dia com KM validado) · hoje <span className="tabular-nums">{formatDate(period.today)}</span>
    </p>
  );

  if (k.vehicles === 0) {
    return (
      <div className="flex flex-col gap-4" data-testid="km-visao-geral">
        {header}
        <EmptyState
          variant="panel"
          icon={<Truck />}
          title="Nenhuma frota no recorte"
          description="Nenhum veículo corresponde aos filtros neste período. Ajuste o período ou limpe os filtros."
          data-testid="km-visao-geral-empty"
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6" data-testid="km-visao-geral">
      {header}

      {/* ------------------------------------------------------------ Rodagem */}
      <Section
        title="Rodagem do período"
        testId="km-visao-geral-kpis-mileage"
        description={
          <>
            Só KM validado entra nos totais: Sem leitura e Inconsistente não somam e nunca viram 0 km. As médias diárias
            usam os {fmtInt(k.validDays)} dias com leitura; médias por veículo, os veículos com KM no período.
          </>
        }
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-5">
          <KmKpi
            testId="km-visao-geral-kpi-km-total"
            label="KM total do período"
            value={k.kmTotal == null ? "—" : fmtInt(k.kmTotal)}
            unit={k.kmTotal == null ? undefined : "km"}
            period={`${fmtInt(k.validDays)} dias com KM válido · ${fmtInt(k.vehicles)} frotas`}
            icon={<Route />}
            status="primary"
          />
          <KmKpi
            testId="km-visao-geral-kpi-km-ref-day"
            label="KM no dia de referência"
            value={k.kmRefDay == null ? "—" : fmtInt(k.kmRefDay)}
            unit={k.kmRefDay == null ? undefined : "km"}
            period={refDay ? `Leitura válida de ${formatDate(refDay)}` : "Sem KM validado no período"}
            icon={<CalendarCheck />}
            nav={dailyNav}
            destination="Abrir a Visão diária do dia de referência"
          />
          <KmKpi
            testId="km-visao-geral-kpi-avg-daily-fleet"
            label="Média diária da frota"
            value={k.avgDailyFleet == null ? "—" : fmtInt(k.avgDailyFleet)}
            unit={k.avgDailyFleet == null ? undefined : "km/dia"}
            period={`mediana ${fmtKm(k.medianDailyFleet)}`}
            icon={<CalendarDays />}
          />
          <KmKpi
            testId="km-visao-geral-kpi-avg-vehicle"
            label="KM por veículo no período"
            value={k.avgPerVehicle == null ? "—" : fmtInt(k.avgPerVehicle)}
            unit={k.avgPerVehicle == null ? undefined : "km (média)"}
            period={`mediana ${fmtKm(k.medianPerVehicle)}`}
            icon={<Sigma />}
          />
          <KmKpi
            testId="km-visao-geral-kpi-avg-daily-vehicle"
            label="Média diária por veículo"
            value={k.avgDailyPerVehicle == null ? "—" : fmt1(k.avgDailyPerVehicle)}
            unit={k.avgDailyPerVehicle == null ? undefined : "km/dia"}
            period="KM ÷ dias com leitura de cada frota"
            icon={<Gauge />}
          />
        </div>
      </Section>

      {/* ------------------------------------------------- Cobertura e situação */}
      <Section
        title="Cobertura e situação da frota"
        testId="km-visao-geral-kpis-coverage"
        description={
          refDay ? (
            <>Contagens do dia de referência ({formatDate(refDay)}) sobre as frotas ativas no recorte; a cobertura do período soma todos os dias até hoje.</>
          ) : (
            <>Sem dia de referência: nenhuma leitura validada no período. A cobertura do período soma todos os dias até hoje.</>
          )
        }
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <KmKpi
            testId="km-visao-geral-kpi-coverage-ref"
            label="Cobertura no dia de referência"
            value={coverageRefPct == null ? "—" : fmt1(coverageRefPct)}
            unit={coverageRefPct == null ? undefined : "%"}
            period={`${fmtInt(k.coverageRefCount)} de ${fmtInt(k.coverageRefTotal)} frotas ativas com leitura`}
            status={coverageRefPct != null && coverageRefPct < 90 ? "warning" : coverageRefPct != null ? "success" : undefined}
            icon={<Percent />}
          />
          <KmKpi
            testId="km-visao-geral-kpi-coverage-period"
            label="Cobertura do período"
            value={k.coveragePeriodPct == null ? "—" : fmt1(k.coveragePeriodPct)}
            unit={k.coveragePeriodPct == null ? undefined : "%"}
            period="veículo × dia com leitura, até hoje"
            icon={<Activity />}
          />
          <KmKpi
            testId="km-visao-geral-kpi-updated"
            label="Frotas atualizadas"
            value={fmtInt(k.vehiclesUpdated)}
            unit={`de ${fmtInt(k.vehicles)}`}
            period={`${fmtInt(k.vehiclesStale)} com 2 dias ou mais sem leitura (ou nunca)`}
            status={k.vehiclesStale > 0 ? "warning" : "success"}
            icon={<RefreshCw />}
          />
          <KmKpi
            testId="km-visao-geral-kpi-no-reading-ref"
            label="Sem leitura no dia de referência"
            value={fmtInt(k.vehiclesWithoutReadingRef)}
            unit="frotas"
            period="ativas, sem leitura — não é 0 km"
            status={k.vehiclesWithoutReadingRef > 0 ? "warning" : undefined}
            icon={<SignalZero />}
            nav={dailyNav}
            destination="Abrir a Visão diária do dia de referência"
          />
          <KmKpi
            testId="km-visao-geral-kpi-no-movement-ref"
            label="Sem movimento no dia de referência"
            value={fmtInt(k.noMovementRef)}
            unit="frotas"
            period="leitura válida, deslocamento na tolerância"
            icon={<CircleSlash />}
            nav={dailyNav}
            destination="Abrir a Visão diária do dia de referência"
          />
          <KmKpi
            testId="km-visao-geral-kpi-high-mileage"
            label="Dias de alta rodagem"
            value={fmtInt(k.highMileageDays)}
            unit={`em ${fmtInt(k.highMileageVehicles)} ${k.highMileageVehicles === 1 ? "veículo" : "veículos"}`}
            period={highKm == null ? "acima do limite configurado" : `acima de ${fmtKm(highKm)} no dia`}
            status={k.highMileageDays > 0 ? "warning" : undefined}
            icon={<Flame />}
          />
          <KmKpi
            testId="km-visao-geral-kpi-inconsistencies"
            label="Inconsistências"
            value={fmtInt(k.inconsistencies)}
            unit="leituras"
            period="inconsistente, divergência ou hodômetro regressivo"
            status={k.inconsistencies > 0 ? "danger" : undefined}
            icon={<TriangleAlert />}
            nav={ctx.perms.quality ? link({ aba: "qualidade" }) : null}
            destination="Abrir Qualidade de dados"
          />
          <KmKpi
            testId="km-visao-geral-kpi-last-update"
            label="Última atualização"
            value={<span className="text-h3">{formatStamp(k.lastUpdate)}</span>}
            period="última importação de leituras"
            icon={<Clock />}
          />
        </div>
      </Section>

      {/* -------------------------------------------- Atualização e evolução */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-5">
        <FreshnessCard data={data} ctx={ctx} />
        <div className="min-w-0 xl:col-span-3">
          <KmByDayChart data={data} ctx={ctx} />
        </div>
      </div>

      {/* ------------------------------------------------------- Distribuições */}
      <Section title="Distribuição" testId="km-visao-geral-distribution">
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 2xl:grid-cols-3">
          <KmShareCard
            title="KM por operação"
            description="Operação de cada leitura (o contexto do dia)."
            rows={data.byOperation.map((o) => ({ key: o.operationId ?? "none", label: o.operation, km: o.km, vehicles: o.vehicles }))}
            testId="km-visao-geral-by-operation"
          />
          <KmShareCard
            title="KM por tipo de veículo"
            description="Tipo do cadastro do veículo."
            rows={data.byType.map((t) => ({ key: t.vehicleTypeId ?? "none", label: t.type, km: t.km, vehicles: t.vehicles }))}
            testId="km-visao-geral-by-type"
          />
          <StatusCard data={data} />
        </div>
      </Section>

      {/* -------------------------------------------------------- Top/Bottom */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <VehicleRankCard
          ctx={ctx}
          title="Top 10 — maior rodagem"
          description="Veículos com mais KM validado no período."
          rows={data.topVehicles}
          empty="Nenhum veículo com KM validado no período."
          testId="km-visao-geral-top"
        />
        <VehicleRankCard
          ctx={ctx}
          title="Bottom 10 — menor rodagem"
          description={
            <>
              Só entram veículos com cobertura mínima no período
              {minCoverage != null ? ` (leitura em pelo menos ${fmtPct(minCoverage)} dos dias até hoje)` : " (parâmetro de cobertura mínima)"}:
              frota sem leitura não é tratada como menor rodagem.
            </>
          }
          rows={data.bottomVehicles}
          empty="Nenhum veículo atinge a cobertura mínima no período."
          testId="km-visao-geral-bottom"
        />
      </div>

      <InsightsCard insights={data.insights} />

      <p className="text-caption text-fg-muted">
        Médias e medianas: KM médio por veículo {fmtKm1(k.avgPerVehicle)} · mediana {fmtKm1(k.medianPerVehicle)}. Frotas no
        recorte: {fmtInt(k.vehicles)} ({fmtInt(k.activeVehicles)} ativas).
      </p>
    </div>
  );
}
