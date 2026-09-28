"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ChevronDown, Download, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { PageContent, PageHeader } from "@/components/layout/page-header";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TAB_LABEL, type MaintenanceTab } from "@/lib/maintenance/types";
import { MaintenanceFilterBar } from "./maintenance-filters";
import { OverviewPanel } from "./overview-panel";
import { SchedulePanel } from "./schedule-panel";
import { PreventivePanel } from "./preventive-panel";
import { PredictivePanel } from "./predictive-panel";
import { BasePanel } from "./base-panel";
import { CatalogPanel } from "./catalog-panel";
import { ImportPanel } from "./import-panel";
import { MaintenanceDrawer } from "./maintenance-drawer";
import { MaintenanceWizard } from "./maintenance-wizard";
import { visibleTabs, type MaintenanceViewData, type Navigate, type PanelActions, type WizardPreset } from "./shared";

/**
 * Gestão de Frota → Manutenção.
 *
 * Uma tela, sete abas, uma fonte: a tabela `maintenances` e suas rotinas.
 * O estado vive na URL (aba, filtros, ordenação, página); a gaveta de detalhe
 * e o assistente de abertura vivem aqui e servem a todas as abas. A tela não
 * decide nada — cada botão chama uma rotina do banco, que confere permissão,
 * escopo e transição, e grava a trilha.
 */
export function MaintenanceView({ data }: { data: MaintenanceViewData }) {
  const router = useRouter();
  const params = useSearchParams();
  const [pending, startTransition] = React.useTransition();
  const [openId, setOpenId] = React.useState<string | null>(() => params.get("m"));
  const [wizard, setWizard] = React.useState<{ open: boolean; preset?: WizardPreset }>({ open: false });
  const { basePath, tab, perms } = data;
  const tabs = visibleTabs(perms);

  const navigate: Navigate = React.useCallback(
    (patch) => {
      const next = new URLSearchParams(params.toString());
      for (const [key, value] of Object.entries(patch)) {
        if (value === null || value === "") next.delete(key);
        else next.set(key, value);
      }
      next.delete("m");
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
      openMaintenance: (id: string) => setOpenId(id),
      openWizard: (preset?: WizardPreset) => setWizard({ open: true, preset }),
    }),
    [navigate, pending, refresh],
  );

  /** O arquivo é o que se vê: aba, filtros e ordenação vão junto. */
  const exportHref = (format: "xlsx" | "csv") => {
    const next = new URLSearchParams(params.toString());
    for (const key of ["pagina", "por_pagina", "m", "secao", "visao"]) next.delete(key);
    next.set("format", format);
    if (!next.get("aba")) next.set("aba", tab);
    return `${basePath}/export?${next.toString()}`;
  };

  const showFilters = tab === "visao-geral" || tab === "programacao" || tab === "base";

  return (
    <>
      <PageHeader
        title="Manutenção"
        description="Programação, execução, preventiva, preditiva e base geral das manutenções da frota."
        primaryAction={
          perms.create ? (
            <Button leadingIcon={<Plus />} onClick={() => actions.openWizard()} data-testid="maintenance-new">
              Nova manutenção
            </Button>
          ) : undefined
        }
        secondaryActions={
          perms.export ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="secondary" leadingIcon={<Download />} trailingIcon={<ChevronDown />}>
                  Exportar
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-60">
                <DropdownMenuLabel>Base de manutenções · filtros atuais</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild>
                  <a href={exportHref("xlsx")} download>Planilha (XLSX)</a>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <a href={exportHref("csv")} download>Texto separado (CSV)</a>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : undefined
        }
        filters={
          showFilters ? (
            <MaintenanceFilterBar
              filters={data.filters}
              options={data.options}
              catalog={data.catalog}
              navigate={navigate}
              pending={pending}
              showStatus={tab !== "programacao"}
            />
          ) : undefined
        }
      />

      <PageContent className="flex flex-col gap-5">
        <Tabs
          value={tab}
          onValueChange={(v) =>
            navigate({ aba: v, pagina: null, ordenar: null, dir: null, visao: null, secao: null, fila: null })
          }
        >
          <div className="-mx-1 overflow-x-auto px-1 pb-1">
            <TabsList className="w-max">
              {tabs.map((t) => (
                <TabsTrigger key={t} value={t}>
                  {TAB_LABEL[t as MaintenanceTab]}
                </TabsTrigger>
              ))}
            </TabsList>
          </div>

          <div aria-busy={pending} className={pending ? "opacity-70 transition-opacity" : "transition-opacity"}>
            {tab === "visao-geral" ? (
              <TabsContent value="visao-geral">
                <OverviewPanel dashboard={data.dashboard ?? null} filters={data.filters} catalog={data.catalog} actions={actions} />
              </TabsContent>
            ) : null}
            {tab === "programacao" && data.schedule ? (
              <TabsContent value="programacao">
                <SchedulePanel schedule={data.schedule} filters={data.filters} catalog={data.catalog} perms={perms} actions={actions} />
              </TabsContent>
            ) : null}
            {tab === "preventiva" && data.preventive ? (
              <TabsContent value="preventiva">
                <PreventivePanel preventive={data.preventive} options={data.options} catalog={data.catalog} perms={perms} actions={actions} />
              </TabsContent>
            ) : null}
            {tab === "preditiva" && data.predictive ? (
              <TabsContent value="preditiva">
                <PredictivePanel predictive={data.predictive} options={data.options} catalog={data.catalog} perms={perms} actions={actions} />
              </TabsContent>
            ) : null}
            {tab === "base" && data.base ? (
              <TabsContent value="base">
                <BasePanel base={data.base} filters={data.filters} catalog={data.catalog} perms={perms} actions={actions} />
              </TabsContent>
            ) : null}
            {tab === "cadastros" && data.cadastros ? (
              <TabsContent value="cadastros">
                <CatalogPanel cadastros={data.cadastros} catalog={data.catalog} options={data.options} perms={perms} actions={actions} />
              </TabsContent>
            ) : null}
            {tab === "importacoes" && data.importacoes ? (
              <TabsContent value="importacoes">
                <ImportPanel importacoes={data.importacoes} perms={perms} actions={actions} />
              </TabsContent>
            ) : null}
          </div>
        </Tabs>
      </PageContent>

      <MaintenanceDrawer
        maintenanceId={openId}
        onOpenChange={(open) => {
          if (!open) setOpenId(null);
        }}
        catalog={data.catalog}
        perms={perms}
        onChanged={refresh}
        onOpenMaintenance={(id) => setOpenId(id)}
      />

      {perms.create ? (
        <MaintenanceWizard
          open={wizard.open}
          preset={wizard.preset}
          onOpenChange={(open) => setWizard((w) => ({ ...w, open }))}
          catalog={data.catalog}
          perms={perms}
          onCreated={(id) => {
            setWizard({ open: false });
            refresh();
            setOpenId(id);
          }}
          onOpenMaintenance={(id) => {
            // "Complementar a existente" também grava: a lista de fundo relê.
            setWizard({ open: false });
            refresh();
            setOpenId(id);
          }}
        />
      ) : null}
    </>
  );
}
