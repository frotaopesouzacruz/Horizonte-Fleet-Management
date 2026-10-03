"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { PageContent, PageHeader } from "@/components/layout/page-header";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { MtsrTabData } from "@/lib/mtsr/loaders";
import { MTSR_TAB_LABEL, type MtsrTab } from "@/lib/mtsr/types";
import { MtsrFilterBar, type MtsrFilterField } from "./mtsr-filters";
import type { MtsrPanelContext, MtsrViewData } from "./shared";
import { OverviewPanel } from "./panels/overview-panel";
import { ConformityPanel } from "./panels/conformity-panel";
import { InspectionsPanel } from "./panels/inspections-panel";
import { MaintenancePanel } from "./panels/maintenance-panel";
import { IngestionPanel } from "./panels/ingestion-panel";
import { CatalogPanel } from "./panels/catalog-panel";
import { AuditPanel } from "./panels/audit-panel";
import { HealthPanel } from "./panels/health-panel";

/** Abas cujo conteúdo depende dos filtros globais (e quais campos cada uma usa). */
const FILTERED: Partial<Record<MtsrTab, MtsrFilterField[] | "all">> = {
  "visao-geral": "all",
  conformidade: "all",
  manutencoes: ["component", "q"],
  auditoria: ["q"],
};

/** Parâmetros próprios de cada aba: a troca de aba os limpa. */
const TAB_OWNED_PARAMS = [
  "pagina", "ordem", "dir", "situacao", "inspetor", "de", "ate", "nok", "vinculo", "revalidacao_status", "resultado",
  "fonte", "evento", "vistoria", "veiculo", "sub", "agrupar",
];

/** Componentes disponíveis para o filtro, a partir do que a aba já carregou. */
function componentsOf(tab: MtsrTab, data: unknown): { id: string; name: string }[] | undefined {
  if (!data) return undefined;
  if (tab === "visao-geral") {
    const d = data as MtsrTabData["visao-geral"];
    return d.byComponent?.map((c) => ({ id: c.componentId, name: c.name }));
  }
  if (tab === "conformidade") {
    const d = data as MtsrTabData["conformidade"];
    const seen = new Map<string, string>();
    for (const row of d.rows ?? []) for (const c of row.components ?? []) if (!seen.has(c.componentId)) seen.set(c.componentId, c.name);
    return [...seen.entries()].map(([id, name]) => ({ id, name }));
  }
  if (tab === "manutencoes") {
    const d = data as MtsrTabData["manutencoes"];
    return d.catalog?.components?.filter((c) => c.isActive).map((c) => ({ id: c.id, name: c.name }));
  }
  return undefined;
}

/**
 * Segurança → Gestão de MTSR.
 *
 * Uma tela, oito abas, uma fonte: o estado oficial de cada componente de
 * segurança por veículo (`mtsr_*`). O estado vive na URL (aba, filtros,
 * página, gaveta); a tela não decide nada — cada ação chama uma rotina do
 * banco, que confere permissão e escopo e grava a trilha.
 */
export function MtsrView({ data }: { data: MtsrViewData }) {
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

  const ctx: MtsrPanelContext = {
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

  const d = data.tabData as MtsrTabData[MtsrTab] | null;
  const filterFields = FILTERED[tab];
  const components = React.useMemo(() => componentsOf(tab, data.tabData), [tab, data.tabData]);

  const switchTab = (v: string) => {
    const patch: Record<string, string | null> = { aba: v };
    for (const key of TAB_OWNED_PARAMS) patch[key] = null;
    navigate(patch);
  };

  return (
    <Tabs value={tab} onValueChange={switchTab} className="gap-0" data-testid="mtsr-view">
      <PageHeader
        eyebrow="Segurança"
        title="Gestão de MTSR"
        description="Conformidade dos componentes de segurança MTSR da frota, conforme o catálogo cadastrado: estado oficial por veículo, prazo da última vistoria válida, vistorias recebidas do app, manutenções vinculadas e trilha completa."
        tabsPlacement="top"
        tabs={
          <TabsList className="w-max max-w-full" aria-label="Telas da Gestão de MTSR">
            {tabs.map((t) => (
              <TabsTrigger key={t} value={t} data-testid={`mtsr-tab-${t}`}>
                {MTSR_TAB_LABEL[t]}
              </TabsTrigger>
            ))}
          </TabsList>
        }
        filters={
          filterFields ? (
            <MtsrFilterBar
              filters={data.filters}
              options={data.options}
              navigate={navigate}
              pending={pending}
              components={components}
              fields={filterFields === "all" ? undefined : filterFields}
              searchPlaceholder={tab === "manutencoes" ? "Placa, frota ou código da manutenção" : undefined}
            />
          ) : undefined
        }
      />

      <PageContent className="flex flex-col gap-5">
        <div aria-busy={pending} className={pending ? "opacity-70 transition-opacity" : "transition-opacity"}>
          <TabsContent value={tab}>
            {tab === "visao-geral" ? <OverviewPanel data={d as MtsrTabData["visao-geral"] | null} ctx={ctx} /> : null}
            {tab === "conformidade" ? <ConformityPanel data={d as MtsrTabData["conformidade"] | null} ctx={ctx} /> : null}
            {tab === "vistorias" ? <InspectionsPanel data={d as MtsrTabData["vistorias"] | null} ctx={ctx} /> : null}
            {tab === "manutencoes" ? <MaintenancePanel data={d as MtsrTabData["manutencoes"] | null} ctx={ctx} /> : null}
            {tab === "ingestao" ? <IngestionPanel data={d as MtsrTabData["ingestao"] | null} ctx={ctx} /> : null}
            {tab === "cadastros" ? <CatalogPanel data={d as MtsrTabData["cadastros"] | null} ctx={ctx} /> : null}
            {tab === "auditoria" ? <AuditPanel data={d as MtsrTabData["auditoria"] | null} ctx={ctx} /> : null}
            {tab === "saude" ? <HealthPanel data={d as MtsrTabData["saude"] | null} ctx={ctx} /> : null}
          </TabsContent>
        </div>
      </PageContent>
    </Tabs>
  );
}
