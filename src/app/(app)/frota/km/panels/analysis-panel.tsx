"use client";

import * as React from "react";
import { BarChart3 } from "lucide-react";
import { EmptyState } from "@/components/feedback/empty-state";
import { ErrorState } from "@/components/feedback/error-state";
import { KpiCard } from "@/components/ui/kpi-card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { KmAnalysisData } from "@/lib/km/analysis";
import { fmt1, fmtInt, formatDate } from "@/lib/km/types";
import { KmInsights } from "../components/km-insights";
import type { KmPanelContext } from "../shared";
import { DispersionView } from "./analysis/dispersion-view";
import { LocationView } from "./analysis/location-view";
import { OperationView } from "./analysis/operation-view";
import { ProjectionsView } from "./analysis/projections-view";
import { useUrlParam } from "./analysis/shared";

/**
 * Gestão de KM → Análise gerencial.
 *
 * Uma chamada (`km_analysis`) alimenta as quatro visões: por operação, por
 * localização (Operação → Estado → Cidade → BR), dispersão & outliers por
 * coorte técnica e projeções. A sub-aba e a coorte ficam na URL (`sub`,
 * `coorte`). O navegador só apresenta, ordena e agrupa para exibir.
 */
const SUBS = [
  { key: "operacao", label: "Por operação" },
  { key: "localizacao", label: "Por localização" },
  { key: "dispersao", label: "Dispersão & outliers" },
  { key: "projecoes", label: "Projeções" },
] as const;
type Sub = (typeof SUBS)[number]["key"];

export function AnalysisPanel({ data, ctx }: { data: KmAnalysisData | null; ctx: KmPanelContext }) {
  const [subParam, setSub] = useUrlParam(ctx, "sub", "operacao");
  const sub: Sub = (SUBS.some((s) => s.key === subParam) ? subParam : "operacao") as Sub;

  if (ctx.error) {
    return (
      <ErrorState
        title="Não foi possível carregar a análise gerencial."
        description={ctx.error}
        onRetry={ctx.refresh}
        retrying={ctx.pending}
        data-testid="km-analise-erro"
      />
    );
  }

  const hasData = Boolean(data && ((data.vehicles?.length ?? 0) > 0 || (data.byOperation?.length ?? 0) > 0));
  if (!data || !hasData) {
    return (
      <EmptyState
        variant="panel"
        icon={<BarChart3 />}
        title="Sem dados para a análise"
        description="Nenhuma frota com leitura no período e filtros escolhidos. Ajuste a competência ou limpe os filtros."
        data-testid="km-analise-vazio"
      />
    );
  }

  const totals = data.totals;
  const period = data.period;

  return (
    <div className="flex flex-col gap-5" data-testid="km-analise">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <KpiCard
          size="compact"
          label="KM no período"
          value={fmt1(totals?.km ?? null)}
          unit="km"
          period={period ? `${formatDate(period.from)} a ${formatDate(period.to)}` : undefined}
          data-testid="km-analise-kpi-km"
        />
        <KpiCard
          size="compact"
          label="Veículos no recorte"
          value={fmtInt(totals?.vehicles)}
          period="Frotas com grade no período"
          data-testid="km-analise-kpi-veiculos"
        />
        <KpiCard
          size="compact"
          label="Dias com KM válido"
          value={fmtInt(totals?.days)}
          period={
            period?.previousFrom && period.previousTo
              ? `Comparações contra ${formatDate(period.previousFrom)} a ${formatDate(period.previousTo)}`
              : undefined
          }
          data-testid="km-analise-kpi-dias"
        />
      </div>

      <KmInsights items={data.insights ?? []} testId="km-analise-insights" />

      <Tabs appearance="segmented" value={sub} onValueChange={setSub} className="gap-4">
        <TabsList aria-label="Visões da análise gerencial" className="max-w-full">
          {SUBS.map((s) => (
            <TabsTrigger key={s.key} value={s.key} data-testid={`km-analise-sub-${s.key}`}>
              {s.label}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value="operacao">{sub === "operacao" ? <OperationView data={data} /> : null}</TabsContent>
        <TabsContent value="localizacao">{sub === "localizacao" ? <LocationView data={data} /> : null}</TabsContent>
        <TabsContent value="dispersao">{sub === "dispersao" ? <DispersionView data={data} ctx={ctx} /> : null}</TabsContent>
        <TabsContent value="projecoes">{sub === "projecoes" ? <ProjectionsView data={data} /> : null}</TabsContent>
      </Tabs>
    </div>
  );
}
