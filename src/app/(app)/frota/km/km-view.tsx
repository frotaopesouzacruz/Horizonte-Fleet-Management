"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { PageContent, PageHeader } from "@/components/layout/page-header";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { KM_TAB_LABEL, type KmTab } from "@/lib/km/types";
import type { KmTabData } from "@/lib/km/loaders";
import { KmFilterBar } from "./km-filters";
import type { KmPanelContext, KmViewData } from "./shared";
import { OverviewPanel } from "./panels/overview-panel";
import { AnalysisPanel } from "./panels/analysis-panel";
import { PlannerPanel } from "./panels/planner-panel";
import { DailyPanel } from "./panels/daily-panel";
import { HistoryPanel } from "./panels/history-panel";
import { RotationPanel } from "./panels/rotation-panel";
import { QualityPanel } from "./panels/quality-panel";
import { ImportPanel } from "./panels/import-panel";
import { BatchesPanel } from "./panels/batches-panel";
import { ReportsPanel } from "./panels/reports-panel";

/** Abas cujo conteúdo depende dos filtros globais. */
const FILTERED: KmTab[] = ["visao-geral", "analise", "planner", "diaria", "rodizio", "qualidade", "relatorios"];
/** Abas em que a competência não se aplica (têm data própria ou não usam período). */
const NO_PERIOD: KmTab[] = ["diaria"];

/** Competência efetiva informada pela aba (quando a URL não fixa uma). */
function effectiveCompetence(data: unknown): string | null {
  const period = (data as { period?: { competence?: string; from?: string } } | null)?.period;
  return period?.competence ?? (period?.from ? period.from.slice(0, 7) : null);
}

/**
 * Gestão de Frota → Gestão de KM Rodado.
 *
 * Uma tela, dez abas, uma fonte: a leitura diária oficial (`km_daily_readings`)
 * sobre a grade veículo × dia. O estado vive na URL (aba, filtros, dia,
 * veículo); a tela não decide nada — cada ação chama uma rotina do banco, que
 * confere permissão e escopo e grava a trilha.
 */
export function KmView({ data }: { data: KmViewData }) {
  const router = useRouter();
  const params = useSearchParams();
  const [pending, startTransition] = React.useTransition();
  const { basePath, tab, tabs, perms } = data;

  const navigate = React.useCallback(
    (patch: Record<string, string | null>) => {
      const next = new URLSearchParams(params.toString());
      for (const [key, value] of Object.entries(patch)) {
        if (value === null || value === "") next.delete(key);
        else next.set(key, value);
      }
      startTransition(() => router.push(`${basePath}?${next.toString()}`, { scroll: false }));
    },
    [params, router, basePath],
  );

  const refresh = React.useCallback(() => startTransition(() => router.refresh()), [router]);

  const ctx: KmPanelContext = {
    basePath,
    tab,
    filters: data.filters,
    options: data.options,
    perms,
    params: data.params,
    navigate,
    pending,
    refresh,
    error: data.error,
  };

  const d = data.tabData as KmTabData[KmTab] | null;
  const today = (data.tabData as { period?: { today?: string } } | null)?.period?.today ?? "";

  return (
    <Tabs
      value={tab}
      onValueChange={(v) => navigate({ aba: v, sub: null, item: null, plano: null, lote: null, atualizacao: null, dia_ranking: null })}
      className="gap-0"
    >
      <PageHeader
        eyebrow="Gestão de frota"
        title="Gestão de KM Rodado"
        description="Rodagem diária da frota: importação validada, planner mês/dia, análise gerencial, qualidade dos dados e plano de rodízio."
        tabsPlacement="top"
        tabs={
          <TabsList className="w-max max-w-full" aria-label="Telas da Gestão de KM">
            {tabs.map((t) => (
              <TabsTrigger key={t} value={t} data-testid={`km-tab-${t}`}>
                {KM_TAB_LABEL[t]}
              </TabsTrigger>
            ))}
          </TabsList>
        }
        filters={
          FILTERED.includes(tab) ? (
            <KmFilterBar
              filters={data.filters}
              options={data.options}
              navigate={navigate}
              pending={pending}
              effectiveCompetence={effectiveCompetence(data.tabData)}
              showPeriod={!NO_PERIOD.includes(tab)}
              today={today}
            />
          ) : undefined
        }
      />

      <PageContent className="flex flex-col gap-5">
        <div aria-busy={pending} className={pending ? "opacity-70 transition-opacity" : "transition-opacity"}>
          <TabsContent value={tab}>
            {tab === "visao-geral" ? <OverviewPanel data={d as KmTabData["visao-geral"] | null} ctx={ctx} /> : null}
            {tab === "analise" ? <AnalysisPanel data={d as KmTabData["analise"] | null} ctx={ctx} /> : null}
            {tab === "planner" ? <PlannerPanel data={d as KmTabData["planner"] | null} ctx={ctx} /> : null}
            {tab === "diaria" ? <DailyPanel data={d as KmTabData["diaria"] | null} ctx={ctx} /> : null}
            {tab === "historico" ? <HistoryPanel data={d as KmTabData["historico"] | null} ctx={ctx} /> : null}
            {tab === "rodizio" ? <RotationPanel data={d as KmTabData["rodizio"] | null} ctx={ctx} /> : null}
            {tab === "qualidade" ? <QualityPanel data={d as KmTabData["qualidade"] | null} ctx={ctx} /> : null}
            {tab === "importacao" ? <ImportPanel data={d as KmTabData["importacao"] | null} ctx={ctx} /> : null}
            {tab === "lotes" ? <BatchesPanel data={d as KmTabData["lotes"] | null} ctx={ctx} /> : null}
            {tab === "relatorios" ? <ReportsPanel data={null} ctx={ctx} /> : null}
          </TabsContent>
        </div>
      </PageContent>
    </Tabs>
  );
}
