"use client";

import * as React from "react";
import {
  Activity, CalendarClock, CalendarDays, CircleSlash, Flame, Gauge, Route, SignalZero, TriangleAlert, Truck,
} from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/feedback/alert";
import { EmptyState } from "@/components/feedback/empty-state";
import { ErrorState } from "@/components/feedback/error-state";
import type { KpiTrend } from "@/components/ui/kpi-card";
import type { KmDailyData } from "@/lib/km/daily";
import { fmt1, fmtInt, fmtKm, fmtKm1 } from "@/lib/km/types";
import type { KmPanelContext } from "../shared";
import { BandsCard, GroupCard, WithoutReadingCard } from "./daily/breakdown-cards";
import { DayPicker } from "./daily/day-picker";
import { InconsistenciesCard } from "./daily/inconsistencies-card";
import { RankingCard } from "./daily/ranking-card";
import { KmKpi, plural, Section } from "./overview/km-ui";

const signedPct = (v: number) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${fmt1(Math.abs(v))}%`;

/**
 * KM → Visão diária.
 *
 * Um dia, a frota inteira do recorte: `km_daily` devolve indicadores, ranking
 * (só KM validado), faixas, agrupamentos, sem leitura e inconsistências com o
 * mesmo critério do indicador. A tela não recalcula nada — fatia o ranking e
 * troca de dia pela URL.
 */
export function DailyPanel({ data, ctx }: { data: KmDailyData | null; ctx: KmPanelContext }) {
  if (ctx.error) {
    return (
      <ErrorState
        variant="panel"
        title="Não foi possível carregar a visão diária do KM."
        description={ctx.error}
        onRetry={ctx.refresh}
        retryLabel="Tentar de novo"
        retrying={ctx.pending}
        data-testid="km-diaria-error"
      />
    );
  }
  if (!data || !data.kpis || !data.date) {
    return (
      <EmptyState
        variant="panel"
        icon={<CalendarDays />}
        title="Sem dados de KM para mostrar"
        description="A leitura do dia não trouxe resultado. Ajuste os filtros ou escolha outro dia."
        data-testid="km-diaria-empty"
      />
    );
  }

  const k = data.kpis;
  const picker = <DayPicker key={data.date} data={data} ctx={ctx} />;

  if (data.date > data.today) {
    return (
      <div className="flex flex-col gap-4" data-testid="km-diaria">
        {picker}
        <EmptyState
          variant="panel"
          icon={<CalendarClock />}
          title="Dia futuro"
          description="Ainda não há resultado para este dia. Escolha hoje ou um dia anterior."
          data-testid="km-diaria-future"
        />
      </div>
    );
  }
  if (k.vehicles === 0) {
    return (
      <div className="flex flex-col gap-4" data-testid="km-diaria">
        {picker}
        <EmptyState
          variant="panel"
          icon={<Truck />}
          title="Nenhuma frota no recorte"
          description="Nenhum veículo corresponde aos filtros neste dia. Ajuste ou limpe os filtros."
          data-testid="km-diaria-empty"
        />
      </div>
    );
  }

  // Sem nenhum KM validado no dia, o total não é "0 km": fica em branco.
  const hasKm = data.ranking.length > 0;
  const diff = k.diffVsMonthAvgPct;
  const trend: KpiTrend | undefined =
    hasKm && diff != null
      ? {
          value: signedPct(diff),
          direction: diff > 0 ? "up" : diff < 0 ? "down" : "flat",
          goodWhen: "neutral",
          comparison: "vs. média diária do mês",
        }
      : undefined;

  return (
    <div className="flex flex-col gap-6" data-testid="km-diaria">
      {picker}

      {!hasKm ? (
        <Alert variant="neutral" data-testid="km-diaria-no-km">
          <AlertTitle>Nenhuma frota com KM validado neste dia</AlertTitle>
          <AlertDescription>
            O KM do dia fica em branco — ausência de leitura não é 0 km. Veja abaixo as frotas sem leitura.
          </AlertDescription>
        </Alert>
      ) : null}

      <Section
        title="Indicadores do dia"
        testId="km-diaria-kpis"
        description={
          k.monthDailyAvg != null ? (
            <span data-testid="km-diaria-month-compare">
              Comparado com a média diária do mês: {fmtKm(k.monthDailyAvg)}
              {hasKm && diff != null ? ` (${signedPct(diff)} vs. média)` : ""}. A média do mês considera do dia 1 até este
              dia, só os dias com leitura.
            </span>
          ) : (
            "Sem média do mês para comparar: nenhum dia com leitura do dia 1 até este dia."
          )
        }
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
          <KmKpi
            testId="km-diaria-kpi-km"
            label="KM do dia"
            value={hasKm ? fmtInt(k.kmTotal) : "—"}
            unit={hasKm ? "km" : undefined}
            trend={trend}
            period={hasKm ? undefined : "sem KM validado no dia"}
            icon={<Route />}
            status="primary"
          />
          <KmKpi
            testId="km-diaria-kpi-vehicles"
            label="Veículos no recorte"
            value={fmtInt(k.vehicles)}
            period="frotas dos filtros neste dia"
            icon={<Truck />}
          />
          <KmKpi
            testId="km-diaria-kpi-used"
            label="Em uso"
            value={fmtInt(k.vehiclesUsed)}
            unit={plural(k.vehiclesUsed, "frota", "frotas")}
            period="KM validado acima da tolerância"
            icon={<Activity />}
          />
          <KmKpi
            testId="km-diaria-kpi-no-movement"
            label="Sem movimento"
            value={fmtInt(k.noMovement)}
            unit={plural(k.noMovement, "frota", "frotas")}
            period="leitura válida, deslocamento na tolerância"
            icon={<CircleSlash />}
          />
          <KmKpi
            testId="km-diaria-kpi-no-reading"
            label="Sem leitura"
            value={fmtInt(k.noReading)}
            unit={plural(k.noReading, "frota", "frotas")}
            period="sem hodômetro confiável — não é 0 km"
            status={k.noReading > 0 ? "warning" : undefined}
            icon={<SignalZero />}
          />
          <KmKpi
            testId="km-diaria-kpi-inconsistencies"
            label="Inconsistências"
            value={fmtInt(k.inconsistencies)}
            unit={plural(k.inconsistencies, "leitura", "leituras")}
            period="mesmo critério da lista abaixo"
            status={k.inconsistencies > 0 ? "danger" : undefined}
            icon={<TriangleAlert />}
            nav={k.inconsistencies > 0 ? { href: "#km-diaria-inconsistencias" } : null}
            destination="Ir para a lista de inconsistências do dia"
          />
          <KmKpi
            testId="km-diaria-kpi-high-mileage"
            label="Alta rodagem"
            value={fmtInt(k.highMileage)}
            unit={plural(k.highMileage, "frota", "frotas")}
            period="acima do limite de alta rodagem"
            status={k.highMileage > 0 ? "warning" : undefined}
            icon={<Flame />}
          />
          <KmKpi
            testId="km-diaria-kpi-avg-used"
            label="Média por veículo em uso"
            value={k.avgPerVehicle == null ? "—" : fmt1(k.avgPerVehicle)}
            unit={k.avgPerVehicle == null ? undefined : "km"}
            period={`mediana ${fmtKm1(k.medianPerVehicle)}`}
            icon={<Gauge />}
          />
          <KmKpi
            testId="km-diaria-kpi-month-avg"
            label="Média diária do mês"
            value={k.monthDailyAvg == null ? "—" : fmtInt(k.monthDailyAvg)}
            unit={k.monthDailyAvg == null ? undefined : "km/dia"}
            period="do dia 1 até este dia, dias com leitura"
            icon={<CalendarDays />}
          />
          <KmKpi
            testId="km-diaria-kpi-diff-month"
            label="Diferença vs. média do mês"
            value={hasKm && diff != null ? signedPct(diff) : "—"}
            period={hasKm && diff != null ? `${fmtKm(k.kmTotal)} no dia × ${fmtKm(k.monthDailyAvg)} de média` : "sem base de comparação"}
            icon={<CalendarClock />}
          />
        </div>
      </Section>

      <RankingCard rows={data.ranking} ctx={ctx} />

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <BandsCard bands={data.bands} hasKm={hasKm} />
        <WithoutReadingCard rows={data.withoutReading} ctx={ctx} />
      </div>

      <InconsistenciesCard rows={data.inconsistencies} ctx={ctx} />

      <Section
        title="Distribuição do dia"
        testId="km-diaria-groups"
        description="KM validado, frotas e frotas com leitura por agrupamento. Grupo sem nenhuma leitura mostra “Sem leitura”, não 0 km."
      >
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 2xl:grid-cols-3">
          <GroupCard title="Por operação" groupLabel="Operação" rows={data.byOperation} testId="km-diaria-by-operation" />
          <GroupCard title="Por local" groupLabel="Local" rows={data.byLocal} testId="km-diaria-by-local" />
          <GroupCard title="Por BR" groupLabel="BR" rows={data.byBr} testId="km-diaria-by-br" />
          <GroupCard title="Por liderança" groupLabel="Liderança" rows={data.byLeader} testId="km-diaria-by-leader" />
          <GroupCard title="Por tipo de veículo" groupLabel="Tipo" rows={data.byType} testId="km-diaria-by-type" />
        </div>
      </Section>
    </div>
  );
}
