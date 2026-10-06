"use client";

import * as React from "react";
import { CloudDownload, Disc3, History, SearchX } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { TiresTabData } from "@/lib/tires/loaders";
import { formatDate, tiresVisibleTabs, type TireOverviewV2 } from "@/lib/tires/types";
import type { TiresPanelContext } from "../shared";
import { PanelEmpty, PanelError, useTiresLink } from "./tires-ui";
import { AlertsSection } from "./overview/alerts-section";
import { ConformitySection } from "./overview/conformity-section";
import { GeneralSection } from "./overview/general-section";
import { HealthSection } from "./overview/health-section";
import { PrioritiesSection } from "./overview/priorities-section";
import { filterPatch, OVERVIEW_OWNED, type CrossField, type Nav } from "./overview/shared";

/**
 * Gestão de Pneus → Visão Geral.
 *
 * Tudo chega pronto do banco (`tires_overview` + `tires_priorities`) sobre os
 * dados escolhidos (os mais recentes por padrão) e os filtros da tela. A ordem
 * é a da leitura gerencial: Dados Gerais → Saúde e Prazos → Conformidade →
 * Prioridades → Alertas. A tela formata, liga cada número à lista que o
 * explica e aplica filtros com um clique nos gráficos — nunca recalcula classe
 * de sulco, prazo, PSI, conformidade ou criticidade.
 */
export function OverviewPanel({ data, ctx }: { data: TiresTabData["visao-geral"] | null; ctx: TiresPanelContext }) {
  const link = useTiresLink(ctx);
  const visible = React.useMemo(() => new Set(tiresVisibleTabs(ctx.perms)), [ctx.perms]);
  const to = React.useCallback<Nav>(
    (tab, patch = {}) => (visible.has(tab) ? link({ aba: tab, ...OVERVIEW_OWNED, ...patch }) : null),
    [visible, link],
  );
  const { filters, navigate } = ctx;
  // Filtro cruzado: o clique numa barra aplica (ou retira) o filtro global e recarrega a tela.
  const onFilter = React.useCallback(
    (field: CrossField, key: string) => {
      const patch = filterPatch(filters, field, key);
      if (patch) navigate({ ...patch, grupo: null, pagina: null });
    },
    [filters, navigate],
  );

  if (ctx.error) {
    return <PanelError ctx={ctx} title="Não foi possível carregar a Visão Geral dos pneus." testId="tires-overview-error" />;
  }
  if (!data) {
    return (
      <PanelEmpty
        icon={<Disc3 />}
        title="Sem dados da Visão Geral"
        description="A leitura da Visão Geral não trouxe resultado. Ajuste os filtros ou recarregue a página."
        testId="tires-overview-empty"
      />
    );
  }

  const { overview } = data;
  if (overview.empty || !overview.kpis) {
    const syncNav = ctx.perms.import || ctx.perms.audit ? to("sincronizacao") : null;
    return (
      <PanelEmpty
        icon={<CloudDownload />}
        title="Ainda não há dados de pneus sincronizados"
        description="Os números da Gestão de Pneus vêm da base oficial (Rodopar), sincronizada a partir da planilha do SharePoint. Assim que a primeira sincronização for concluída, a situação, o sulco, a pressão e os prazos dos pneus aparecem aqui."
        testId="tires-overview-empty"
        action={
          syncNav ? (
            <Button asChild size="sm" variant="primary">
              <a href={syncNav.href} onClick={syncNav.onClick} data-testid="tires-overview-sync">
                <CloudDownload aria-hidden />
                Abrir a Sincronização Rodopar
              </a>
            </Button>
          ) : undefined
        }
      />
    );
  }

  const k = overview.kpis;
  return (
    <div className="flex flex-col gap-8" data-testid="tires-overview">
      <ReferenceNotice overview={overview} link={link} />

      {k.total === 0 ? (
        <PanelEmpty
          icon={<SearchX />}
          title="Nenhum pneu neste recorte"
          description="Há dados sincronizados, mas nenhum pneu atende aos filtros escolhidos. Ajuste ou limpe os filtros para ver os números."
          testId="tires-overview-no-match"
        />
      ) : (
        <>
          <GeneralSection overview={overview} kpis={k} ctx={ctx} to={to} onFilter={onFilter} />
          <HealthSection overview={overview} kpis={k} ctx={ctx} to={to} onFilter={onFilter} />
          {overview.conformity ? <ConformitySection conformity={overview.conformity} to={to} /> : null}
          <PrioritiesSection priorities={data.priorities} error={data.prioritiesError} ctx={ctx} to={to} />
          <AlertsSection insights={overview.insights ?? []} to={to} />
        </>
      )}
    </div>
  );
}

/** Aviso discreto quando a tela mostra uma data anterior à mais recente. */
function ReferenceNotice({ overview, link }: { overview: TireOverviewV2; link: ReturnType<typeof useTiresLink> }) {
  if (overview.isLatest !== false || !overview.referenceDate) return null;
  const latest = overview.latestReferenceDate ?? null;
  const back = link({ data: null, foto: null, grupo: null });
  return (
    <p role="status" className="-mb-4 flex flex-wrap items-center gap-x-2 gap-y-1 text-body-sm text-fg-secondary" data-testid="tires-overview-not-latest">
      <History aria-hidden className="size-4 shrink-0 text-fg-muted" />
      <span>
        Você está consultando os dados de <strong className="font-semibold text-fg">{formatDate(overview.referenceDate)}</strong>.
      </span>
      <a
        href={back.href}
        onClick={back.onClick}
        className="rounded-xs font-medium text-link hover:text-link-hover hover:underline hfm-focus-ring"
        data-testid="tires-overview-latest"
      >
        Ver os dados mais recentes{latest ? ` (${formatDate(latest)})` : ""}
      </a>
    </p>
  );
}
