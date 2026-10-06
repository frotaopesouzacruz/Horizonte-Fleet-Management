"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { PageContent, PageHeader } from "@/components/layout/page-header";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { TiresTabData } from "@/lib/tires/loaders";
import { TIRES_TAB_LABEL, type TiresTab } from "@/lib/tires/types";
import { TiresFilterBar, type TiresFilterField } from "./tires-filters";
import type { TiresPanelContext, TiresViewData } from "./shared";
import { OverviewPanel } from "./panels/overview-panel";
import { BasePanel } from "./panels/base-panel";
import { AdherencePanel } from "./panels/adherence-panel";
import { SchedulePanel } from "./panels/schedule-panel";
import { InspectionsPanel } from "./panels/inspections-panel";
import { ServicesPanel } from "./panels/services-panel";
import { QualityPanel } from "./panels/quality-panel";
import { HistoryPanel } from "./panels/history-panel";
import { ImportPanel } from "./panels/import-panel";
import { ParametersPanel } from "./panels/parameters-panel";

/** Abas cujo conteúdo depende dos filtros globais (e quais campos cada uma usa). */
const SNAPSHOT_FIELDS: TiresFilterField[] = [
  "reference", "operation", "state", "city", "br", "leader", "unit", "vehicleType", "status", "brand", "model", "dimension",
  "life", "position", "tread", "measurement", "calibration", "psi", "severity", "quality", "retread", "q",
];
const FILTERED: Partial<Record<TiresTab, TiresFilterField[]>> = {
  "visao-geral": SNAPSHOT_FIELDS,
  base: SNAPSHOT_FIELDS,
  medicao: SNAPSHOT_FIELDS,
  calibragem: SNAPSHOT_FIELDS,
  cronograma: SNAPSHOT_FIELDS.filter((f) => f !== "reference"),
  qualidade: SNAPSHOT_FIELDS,
  vistorias: ["operation", "state", "city", "br", "leader", "q"],
  servicos: ["q"],
  historico: ["q"],
};

/** Parâmetros próprios de cada aba: a troca de aba os limpa. */
const TAB_OWNED_PARAMS = [
  "pagina", "ordem", "dir", "visao", "pendencia", "janela", "fase", "inspetor", "divergencia", "de", "ate", "sub", "registro",
  "servico", "status_manutencao", "problema", "evento", "acao", "lote", "secao", "filtro", "vistoria", "grupo",
];

/**
 * Gestão de Frota → Gestão de Pneus.
 *
 * Uma tela, onze abas, uma fonte: a fotografia oficial importada do Rodopar
 * 10 (`tire_daily_snapshots`), avaliada no banco. O estado vive na URL (aba,
 * filtros, página, gaveta); a tela não decide nada — cada ação chama uma
 * rotina do banco, que confere permissão e escopo e grava a trilha.
 */
export function TiresView({ data }: { data: TiresViewData }) {
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

  const ctx: TiresPanelContext = {
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

  const d = data.tabData as TiresTabData[TiresTab] | null;
  const filterFields = FILTERED[tab];

  const switchTab = (v: string) => {
    const patch: Record<string, string | null> = { aba: v };
    for (const key of TAB_OWNED_PARAMS) patch[key] = null;
    navigate(patch);
  };

  return (
    <Tabs value={tab} onValueChange={switchTab} className="gap-0" data-testid="tires-view">
      <PageHeader
        eyebrow="Gestão de Frota"
        title="Gestão de Pneus"
        description="Fotografia oficial dos pneus importada do Rodopar 10: situação, sulco, pressão e prazos de medição e calibragem por frota, Nº Fogo e posição; vistorias de campo em leitura cega, serviços e trilha completa."
        tabsPlacement="top"
        tabs={
          <TabsList className="w-max max-w-full" aria-label="Telas da Gestão de Pneus">
            {tabs.map((t) => (
              <TabsTrigger key={t} value={t} data-testid={`tires-tab-${t}`}>
                {TIRES_TAB_LABEL[t]}
              </TabsTrigger>
            ))}
          </TabsList>
        }
        filters={
          filterFields && data.options ? (
            <TiresFilterBar
              filters={data.filters}
              options={data.options}
              navigate={navigate}
              pending={pending}
              fields={filterFields}
              searchLabel={tab === "vistorias" ? "Placa, frota ou protocolo" : tab === "servicos" ? "Nº Fogo, placa ou OS" : undefined}
              searchPlaceholder={tab === "vistorias" ? "Ex.: SNT8I36 ou PNEU-2026" : undefined}
            />
          ) : undefined
        }
      />

      <PageContent className="flex flex-col gap-5">
        <div aria-busy={pending} className={pending ? "opacity-70 transition-opacity" : "transition-opacity"}>
          <TabsContent value={tab}>
            {tab === "visao-geral" ? <OverviewPanel data={d as TiresTabData["visao-geral"] | null} ctx={ctx} /> : null}
            {tab === "base" ? <BasePanel data={d as TiresTabData["base"] | null} ctx={ctx} /> : null}
            {tab === "medicao" ? <AdherencePanel kind="measurement" data={d as TiresTabData["medicao"] | null} ctx={ctx} /> : null}
            {tab === "calibragem" ? <AdherencePanel kind="calibration" data={d as TiresTabData["calibragem"] | null} ctx={ctx} /> : null}
            {tab === "cronograma" ? <SchedulePanel data={d as TiresTabData["cronograma"] | null} ctx={ctx} /> : null}
            {tab === "vistorias" ? <InspectionsPanel data={d as TiresTabData["vistorias"] | null} ctx={ctx} /> : null}
            {tab === "servicos" ? <ServicesPanel data={d as TiresTabData["servicos"] | null} ctx={ctx} /> : null}
            {tab === "qualidade" ? <QualityPanel data={d as TiresTabData["qualidade"] | null} ctx={ctx} /> : null}
            {tab === "historico" ? <HistoryPanel data={d as TiresTabData["historico"] | null} ctx={ctx} /> : null}
            {tab === "importacao" ? <ImportPanel data={d as TiresTabData["importacao"] | null} ctx={ctx} /> : null}
            {tab === "parametros" ? <ParametersPanel data={d as TiresTabData["parametros"] | null} ctx={ctx} /> : null}
          </TabsContent>
        </div>
      </PageContent>
    </Tabs>
  );
}
