"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { CalendarClock, CloudDownload, Upload } from "lucide-react";
import { PageContent, PageHeader, PageHeaderContext } from "@/components/layout/page-header";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { TiresTabData } from "@/lib/tires/loaders";
import { formatDate, formatStamp, TIRES_TAB_LABEL, type TiresTab } from "@/lib/tires/types";
import { TiresFilterBar, type TiresFilterField } from "./tires-filters";
import type { TiresPanelContext, TiresViewData } from "./shared";
import { OverviewPanel } from "./panels/overview-panel";
import { BasePanel } from "./panels/base-panel";
import { AdherencePanel } from "./panels/adherence-panel";
import { SchedulePanel } from "./panels/schedule-panel";
import { InspectionsPanel } from "./panels/inspections-panel";
import { ServicesPanel } from "./panels/services-panel";
import { AuditPanel } from "./panels/audit-panel";
import { HistoryPanel } from "./panels/history-panel";
import { SyncPanel } from "./panels/sync-panel";
import { EvolutionPanel } from "./panels/evolution-panel";
import { ParametersPanel } from "./panels/parameters-panel";

/** Abas cujo conteúdo depende dos filtros globais (e quais campos cada uma usa). */
const DATA_FIELDS: TiresFilterField[] = [
  "reference", "operation", "city", "leader", "vehicleType", "vehicle", "status", "brand", "model", "dimension",
  "state", "br", "unit", "life", "position", "tread", "measurement", "calibration", "psi", "severity", "quality", "retread",
  "conformity", "calConformity", "q",
];
const FILTERED: Partial<Record<TiresTab, TiresFilterField[]>> = {
  "visao-geral": DATA_FIELDS,
  base: DATA_FIELDS,
  medicao: DATA_FIELDS,
  calibragem: DATA_FIELDS,
  cronograma: DATA_FIELDS.filter((f) => f !== "reference"),
  qualidade: ["operation", "city", "leader", "vehicle", "q"],
  vistorias: ["operation", "city", "leader", "vehicle", "state", "br", "q"],
  servicos: ["vehicle", "q"],
  historico: ["vehicle", "q"],
};

/** Parâmetros próprios de cada aba: a troca de aba os limpa. */
const TAB_OWNED_PARAMS = [
  "pagina", "ordem", "dir", "visao", "pendencia", "janela", "fase", "inspetor", "divergencia", "de", "ate", "sub", "registro",
  "servico", "status_manutencao", "problema", "evento", "acao", "lote", "secao", "filtro", "vistoria", "grupo", "prioridade",
  "agrupar", "abertos", "periodo", "indicador", "dimensao", "membro", "categoria", "regra", "gravidade", "achado", "execucoes",
  "execucao",
];

/**
 * Gestão de Frota → Gestão de Pneus.
 *
 * Uma tela, doze abas, uma fonte: a base oficial Rodopar (planilha do
 * SharePoint sincronizada para `tire_daily_snapshots`), avaliada no banco. O
 * estado vive na URL (aba, filtros, página, gaveta); a tela não decide nada —
 * cada ação chama uma rotina do banco, que confere permissão e escopo e grava
 * a trilha. O cabeçalho (título, abas e filtros) fica fixo ao rolar.
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

  // cabeçalho fixo: ao rolar, fica enxuto (sem descrição) e ganha borda
  const sentinel = React.useRef<HTMLDivElement>(null);
  const [stuck, setStuck] = React.useState(false);
  React.useEffect(() => {
    const el = sentinel.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([entry]) => setStuck(!entry.isIntersecting), { rootMargin: "-56px 0px 0px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const current = data.options?.referenceDates[0] ?? null;
  const shown = data.filters.reference
    ? data.options?.referenceDates.find((r) => r.referenceDate === data.filters.reference) ?? null
    : current;

  const switchTab = (v: string) => {
    const patch: Record<string, string | null> = { aba: v };
    for (const key of TAB_OWNED_PARAMS) patch[key] = null;
    navigate(patch);
  };

  return (
    <Tabs value={tab} onValueChange={switchTab} className="gap-0" data-testid="tires-view">
      <div ref={sentinel} aria-hidden className="h-0" />
      <div
        data-slot="sticky-page-header"
        data-stuck={stuck || undefined}
        data-testid="tires-sticky-header"
        className="bg-background/95 transition-shadow duration-(--duration-base) supports-[backdrop-filter]:bg-background/85 supports-[backdrop-filter]:backdrop-blur md:sticky md:top-(--topbar-height) md:z-(--z-page-header) data-[stuck]:border-b data-[stuck]:border-border data-[stuck]:shadow-sm"
      >
      <PageHeader
        eyebrow="Gestão de Frota"
        title="Gestão de Pneus"
        compact={stuck}
        description="Pneus em uso, saúde do sulco, pressão e prazos de medição e calibragem a partir da base oficial Rodopar (SharePoint), com conformidade, evolução dos indicadores, auditoria dos dados e vistorias de campo."
        context={
          shown ? (
            <>
              <PageHeaderContext label="Dados de" icon={<CalendarClock />}>
                {formatDate(shown.referenceDate)}
                {shown === current ? "" : " (consulta)"}
              </PageHeaderContext>
              <PageHeaderContext label="Atualizado" icon={shown.sourceKind === "upload" ? <Upload /> : <CloudDownload />}>
                {formatStamp(shown.confirmedAt)} · {shown.sourceKind === "upload" ? "envio manual" : "SharePoint"}
              </PageHeaderContext>
            </>
          ) : undefined
        }
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
      </div>

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
            {tab === "evolucao" ? <EvolutionPanel data={d as TiresTabData["evolucao"] | null} ctx={ctx} /> : null}
            {tab === "qualidade" ? <AuditPanel data={d as TiresTabData["qualidade"] | null} ctx={ctx} /> : null}
            {tab === "historico" ? <HistoryPanel data={d as TiresTabData["historico"] | null} ctx={ctx} /> : null}
            {tab === "sincronizacao" ? <SyncPanel data={d as TiresTabData["sincronizacao"] | null} ctx={ctx} /> : null}
            {tab === "parametros" ? <ParametersPanel data={d as TiresTabData["parametros"] | null} ctx={ctx} /> : null}
          </TabsContent>
        </div>
      </PageContent>
    </Tabs>
  );
}
