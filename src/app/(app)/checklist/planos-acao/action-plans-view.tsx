"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ChevronDown, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { PageContent, PageHeader } from "@/components/layout/page-header";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { WizardPreset } from "@/app/(app)/frota/manutencao/shared";
import { MaintenanceDrawer } from "@/app/(app)/frota/manutencao/maintenance-drawer";
import { MaintenanceWizard } from "@/app/(app)/frota/manutencao/maintenance-wizard";
import { ActionPlanFilterBar } from "./action-plan-filters";
import { OverviewPanel } from "./overview-panel";
import { PlansPanel } from "./plans-panel";
import { ReconciliationPanel } from "./reconciliation-panel";
import { ParametersPanel } from "./parameters-panel";
import { QualityPanel } from "./quality-panel";
import { MyViewPanel } from "./my-view-panel";
import { HistoryPanel } from "./history-panel";
import { PlanDrawer } from "./plan-drawer";
import { TraceDrawer } from "./trace-drawer";
import { BASE_PATH, TAB_LABEL, visibleTabs, type ActionPlansViewData, type Navigate, type PanelActions } from "./shared";

/**
 * Gestão de Checklist → Planos de Ação.
 *
 * O estado vive na URL (aba, filtros, agrupamento, ordenação, página, plano
 * aberto). A gaveta do plano, a do checklist e o assistente/gaveta oficiais da
 * Manutenção vivem aqui e servem a todas as abas. A tela não decide nada: cada
 * botão chama uma rotina do banco, que confere permissão, escopo e trilha.
 */
export function ActionPlansView({ data }: { data: ActionPlansViewData }) {
  const router = useRouter();
  const params = useSearchParams();
  const [pending, startTransition] = React.useTransition();
  const [planId, setPlanId] = React.useState<string | null>(() => params.get("plano"));
  const [maintenanceId, setMaintenanceId] = React.useState<string | null>(null);
  const [traceId, setTraceId] = React.useState<string | null>(null);
  const [wizard, setWizard] = React.useState<{ open: boolean; preset?: WizardPreset }>({ open: false });
  const { tab, perms, basePath } = data;
  const tabs = visibleTabs(perms);

  const navigate: Navigate = React.useCallback(
    (patch) => {
      const next = new URLSearchParams(params.toString());
      for (const [key, value] of Object.entries(patch)) {
        if (value === null || value === "") next.delete(key);
        else next.set(key, value);
      }
      next.delete("plano");
      startTransition(() => router.push(`${basePath}?${next.toString()}`, { scroll: false }));
    },
    [params, router, basePath],
  );

  const refresh = React.useCallback(() => startTransition(() => router.refresh()), [router]);

  const actions: PanelActions = React.useMemo(
    () => ({
      navigate,
      pending,
      refresh,
      openPlan: (id: string) => setPlanId(id),
      openMaintenance: (id: string) => setMaintenanceId(id),
      openWizard: (preset: WizardPreset) => setWizard({ open: true, preset }),
      openTrace: (id: string) => setTraceId(id),
    }),
    [navigate, pending, refresh],
  );

  /** O arquivo é o que se vê: filtros e ordenação vão junto. */
  const exportHref = (format: "xlsx" | "csv", scope: "plans" | "items") => {
    const next = new URLSearchParams(params.toString());
    for (const key of ["pagina", "por_pagina", "plano", "agrupar", "secao"]) next.delete(key);
    next.set("aba", tab);
    next.set("format", format);
    next.set("escopo", scope);
    return `${BASE_PATH}/export?${next.toString()}`; // a prévia não exporta
  };

  const showFilters = tab === "visao-geral" || tab === "planos" || tab === "conciliacao";

  return (
    <>
      {/* UI 2.0 (como o KM): as abas escolhem a tela e ficam logo abaixo do
          título; os filtros da tela escolhida vêm depois, no cartão de
          ferramentas. A lista de abas rola com setas quando não cabe. */}
      <Tabs
        value={tab}
        onValueChange={(v) =>
          navigate({ aba: v, pagina: null, ordenar: null, dir: null, agrupar: null, secao: null, confianca: null })
        }
        className="gap-0"
      >
        <PageHeader
          eyebrow="Gestão de checklist"
          title="Planos de Ação"
          description="Plano de Ação de Manutenção: as inconformidades técnicas do Check List de Frota, da ocorrência à resolução. Avarias seguem o fluxo próprio de Sinistros/Avarias."
          secondaryActions={
            perms.export ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="secondary" leadingIcon={<Download />} trailingIcon={<ChevronDown />} data-testid="action-plans-export">
                    Exportar
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="min-w-64">
                  <DropdownMenuLabel>Planos · filtros atuais</DropdownMenuLabel>
                  <DropdownMenuItem asChild>
                    <a href={exportHref("xlsx", "plans")} download>Planos (XLSX)</a>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <a href={exportHref("csv", "plans")} download>Planos (CSV)</a>
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuLabel>Apontamentos dos planos filtrados</DropdownMenuLabel>
                  <DropdownMenuItem asChild>
                    <a href={exportHref("xlsx", "items")} download>Apontamentos (XLSX)</a>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : undefined
          }
          tabsPlacement="top"
          tabs={
            <TabsList className="w-max max-w-full" aria-label="Telas dos Planos de Ação">
              {tabs.map((t) => (
                <TabsTrigger key={t} value={t} data-testid={`action-plans-tab-${t}`}>
                  {TAB_LABEL[t]}
                </TabsTrigger>
              ))}
            </TabsList>
          }
          filters={
            showFilters ? (
              <ActionPlanFilterBar filters={data.filters} catalog={data.catalog} navigate={navigate} pending={pending} />
            ) : undefined
          }
        />

        <PageContent className="flex flex-col gap-5">
          <div aria-busy={pending} className={pending ? "opacity-70 transition-opacity" : "transition-opacity"}>
            {tab === "visao-geral" ? (
              <TabsContent value="visao-geral">
                <OverviewPanel dashboard={data.dashboard ?? null} filters={data.filters} catalog={data.catalog} actions={actions} />
              </TabsContent>
            ) : null}
            {tab === "planos" && data.plans ? (
              <TabsContent value="planos">
                <PlansPanel plans={data.plans} filters={data.filters} catalog={data.catalog} perms={perms} actions={actions} />
              </TabsContent>
            ) : null}
            {tab === "conciliacao" && data.reconciliation ? (
              <TabsContent value="conciliacao">
                <ReconciliationPanel reconciliation={data.reconciliation} perms={perms} actions={actions} />
              </TabsContent>
            ) : null}
            {tab === "parametros" ? (
              <TabsContent value="parametros">
                <ParametersPanel
                  mapping={data.mapping ?? null}
                  catalog={data.catalog}
                  maintenanceCatalog={data.maintenanceCatalog}
                  perms={perms}
                  actions={actions}
                />
              </TabsContent>
            ) : null}
            {tab === "qualidade" && data.quality ? (
              <TabsContent value="qualidade">
                <QualityPanel quality={data.quality} perms={perms} actions={actions} />
              </TabsContent>
            ) : null}
            {tab === "minha-visao" ? (
              <TabsContent value="minha-visao">
                <MyViewPanel myView={data.myView ?? null} perms={perms} actions={actions} />
              </TabsContent>
            ) : null}
            {tab === "historico" && data.history ? (
              <TabsContent value="historico">
                <HistoryPanel history={data.history} catalog={data.catalog} actions={actions} />
              </TabsContent>
            ) : null}
          </div>
        </PageContent>
      </Tabs>

      <PlanDrawer
        planId={planId}
        onOpenChange={(open) => {
          if (!open) setPlanId(null);
        }}
        catalog={data.catalog}
        perms={perms}
        actions={actions}
        onChanged={refresh}
        fixtures={data.fixtures}
      />

      <TraceDrawer
        executionId={traceId}
        onOpenChange={(open) => {
          if (!open) setTraceId(null);
        }}
        actions={actions}
        perms={perms}
        fixtures={data.fixtures}
      />

      {data.maintenanceCatalog && data.maintenancePerms?.view ? (
        <MaintenanceDrawer
          maintenanceId={maintenanceId}
          onOpenChange={(open) => {
            if (!open) setMaintenanceId(null);
          }}
          catalog={data.maintenanceCatalog}
          perms={data.maintenancePerms}
          onChanged={refresh}
          onOpenMaintenance={(id) => setMaintenanceId(id)}
        />
      ) : null}

      {data.maintenanceCatalog && data.maintenancePerms && perms.openMaintenance && perms.maintenanceCreate ? (
        <MaintenanceWizard
          open={wizard.open}
          preset={wizard.preset}
          onOpenChange={(open) => setWizard((w) => ({ ...w, open }))}
          catalog={data.maintenanceCatalog}
          perms={data.maintenancePerms}
          onCreated={(id) => {
            setWizard({ open: false });
            refresh();
            setMaintenanceId(data.maintenancePerms?.view ? id : null);
          }}
          onOpenMaintenance={(id) => {
            // "Complementar a existente": o plano vincula pela conciliação/vínculo.
            setWizard({ open: false });
            refresh();
            setMaintenanceId(data.maintenancePerms?.view ? id : null);
          }}
        />
      ) : null}
    </>
  );
}
