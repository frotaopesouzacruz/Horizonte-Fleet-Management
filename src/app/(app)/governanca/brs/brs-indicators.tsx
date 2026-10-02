"use client";

import * as React from "react";
import { ArrowLeftRight, CircleSlash, MapPin, Truck, UserCog, UserRound } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { KpiCard } from "@/components/ui/kpi-card";
import type { BrPlannerIndicators } from "@/lib/governance/br-planner";
import { formatCompetence, type Competence } from "@/lib/governance/competence";
import { formatDate, number } from "./br-labels";

interface BreakdownItem {
  key: string;
  label: string;
  total: number;
}

/** Uma lista curta "nome → quantidade": onde as posições estão, sem virar gráfico. */
function BreakdownCard({ title, items }: { title: string; items: BreakdownItem[] }) {
  return (
    <Card>
      <CardContent className="flex flex-col gap-2 p-3.5">
        <h3 className="text-body-sm font-medium text-fg-secondary">{title}</h3>
        {items.length === 0 ? (
          <p className="text-caption text-fg-muted">Nenhuma posição no recorte.</p>
        ) : (
          <ul className="flex max-h-44 flex-col gap-1 overflow-y-auto text-body-sm">
            {items.map((item) => (
              <li key={item.key} className="flex items-center justify-between gap-3">
                <span className="min-w-0 truncate text-fg" title={item.label}>{item.label}</span>
                <span className="shrink-0 tabular-nums text-fg-secondary">{number.format(item.total)}</span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

export interface BrsIndicatorsProps {
  indicators: BrPlannerIndicators | null;
  competence: Competence;
  /** Total da listagem, usado quando os indicadores não vieram. */
  fallbackTotal: number;
  anchorDate: string | null;
}

/**
 * §26: cadastrais e da competência, lado a lado mas separados — um BR com seis
 * trocas de placa no mês continua sendo um BR. Tudo contado por existência de
 * vínculo por BR, nunca `count(*)` sobre os vínculos.
 */
export function BrsIndicators({ indicators, competence, fallbackTotal, anchorDate }: BrsIndicatorsProps) {
  const withoutVehicle = indicators?.withoutVehicle ?? 0;
  const withoutLeader = indicators?.withoutLeader ?? 0;
  /** Indicadores que não vieram são "—", nunca 0 (ausência não é zero). */
  const count = (value: number | undefined) => (value === undefined ? "—" : number.format(value));

  const byOperation: BreakdownItem[] = (indicators?.byOperation ?? []).map((e) => ({
    key: e.operationId, label: e.operationName, total: e.total,
  }));
  const byCity: BreakdownItem[] = (indicators?.byCity ?? []).map((e) => ({
    key: String(e.cityId), label: `${e.cityName}/${e.stateUf}`, total: e.total,
  }));
  const byLeader: BreakdownItem[] = (indicators?.byLeader ?? []).map((e) => ({
    key: e.employeeId, label: e.leaderName, total: e.total,
  }));

  return (
    <>
      {/* Seis KPIs em 3 × 2 (UI 2.0): seis colunas a 1366 espremiam os rótulos. */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <KpiCard
          label="Posições cadastradas"
          value={number.format(indicators?.total ?? fallbackTotal)}
          period={indicators ? `${number.format(indicators.active)} ativas · ${number.format(indicators.inactive)} inativas` : undefined}
          icon={<MapPin />}
        />
        <KpiCard
          label="Com veículo"
          value={count(indicators?.withVehicle)}
          period={formatCompetence(competence)}
          icon={<Truck />}
        />
        <KpiCard
          label="Sem veículo"
          value={count(indicators?.withoutVehicle)}
          status={withoutVehicle > 0 ? "warning" : undefined}
          period={formatCompetence(competence)}
          icon={<CircleSlash />}
        />
        <KpiCard
          label="Com motorista"
          value={count(indicators?.withDriver)}
          period={indicators ? `${number.format(indicators.withoutDriver)} sem motorista` : undefined}
          icon={<UserRound />}
        />
        <KpiCard
          label="Com liderança"
          value={count(indicators?.withLeader)}
          status={withoutLeader > 0 ? "warning" : undefined}
          period={indicators ? `${number.format(withoutLeader)} sem liderança` : undefined}
          icon={<UserCog />}
        />
        <KpiCard
          label="Com substituição no período"
          value={count(indicators?.withVehicleSwapInPeriod)}
          period={formatCompetence(competence)}
          icon={<ArrowLeftRight />}
        />
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <BreakdownCard title="Por operação" items={byOperation} />
        <BreakdownCard title="Por local" items={byCity} />
        <BreakdownCard title="Por liderança" items={byLeader} />
      </div>

      {/* §22/§26: as contagens cadastrais existem independentemente do mês; as
          de ocupação são um retrato de uma data, e a data fica dita. */}
      <p className="text-caption text-fg-muted">
        Posições, ativas e inativas são contagens cadastrais e não dependem da competência. Veículo,
        motorista, liderança e substituição são resolvidos em {formatDate(anchorDate)}, a data que
        representa {formatCompetence(competence)}.
      </p>
    </>
  );
}
