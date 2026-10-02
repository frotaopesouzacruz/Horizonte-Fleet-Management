"use client";

import * as React from "react";
import { ShieldCheck } from "lucide-react";
import { EmptyState } from "@/components/feedback/empty-state";
import { ErrorState } from "@/components/feedback/error-state";
import type { KmQualityData } from "@/lib/km/quality";
import { formatDate } from "@/lib/km/types";
import { KmCorrectionDialog, type KmCorrectionTarget } from "../components/correction-dialog";
import type { KmPanelContext } from "../shared";
import { LastBatch, OdometerHealth, StaleFleets } from "./quality/fleet-health";
import { QualityIndicators } from "./quality/indicators";
import { IssuesTable, type IssueFilter } from "./quality/issues-table";
import { QualityScoreCard } from "./quality/score-card";
import { SettingsPanel, StatusCatalog } from "./quality/settings-panel";

/**
 * Gestão de KM → Qualidade de dados.
 *
 * O portal da qualidade: score documentado com os componentes, indicadores,
 * ocorrências com correção auditada, frotas desatualizadas, saúde do
 * hodômetro, último lote e — para quem pode — parâmetros e reprocessamento.
 * Tudo vem de `km_quality` (e `km_settings_get`); cada ação chama uma rotina
 * do banco, que confere permissão e escopo e grava a trilha.
 */
export function QualityPanel({ data, ctx }: { data: KmQualityData | null; ctx: KmPanelContext }) {
  const [filter, setFilter] = React.useState<IssueFilter>("all");
  const [target, setTarget] = React.useState<KmCorrectionTarget | null>(null);
  const [dialogOpen, setDialogOpen] = React.useState(false);

  if (ctx.error) {
    return (
      <ErrorState
        title="Não foi possível carregar a qualidade de dados."
        description={ctx.error}
        onRetry={ctx.refresh}
        retrying={ctx.pending}
        data-testid="km-qualidade-erro"
      />
    );
  }

  if (!data) {
    return (
      <EmptyState
        variant="panel"
        icon={<ShieldCheck />}
        title="Sem dados de qualidade"
        description="A rotina não devolveu dados para o período. Ajuste a competência ou limpe os filtros."
        data-testid="km-qualidade-vazio"
      />
    );
  }

  const canCorrect = ctx.perms.correct && data.canCorrect !== false;
  const showSettings = (ctx.perms.manageParameters || ctx.perms.reprocess) && (data.settings != null || data.settingsError != null);
  const vehicleIds = (ctx.filters.vehicle ?? "")
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
  const empty =
    (data.components?.elapsedVehicleDays ?? 0) === 0 && !(data.issues?.length ?? 0) && !(data.stale?.length ?? 0);
  const openBatch = ctx.perms.import || ctx.perms.audit ? (id: string) => ctx.navigate({ aba: "lotes", lote: id, sub: null }) : undefined;

  return (
    <div className="flex flex-col gap-6" data-testid="km-qualidade">
      {data.period ? (
        <p className="text-body-sm text-fg-secondary">
          Período analisado: <span className="font-medium text-fg">{formatDate(data.period.from)}</span> a{" "}
          <span className="font-medium text-fg">{formatDate(data.period.to)}</span>. Sem leitura nunca é contado como 0 km.
        </p>
      ) : null}

      {empty ? (
        <EmptyState
          variant="panel"
          icon={<ShieldCheck />}
          title="Sem dados de qualidade"
          description="Nenhuma frota com grade no período e filtros escolhidos. Ajuste a competência ou limpe os filtros."
          data-testid="km-qualidade-vazio"
        />
      ) : (
        <>
          <QualityScoreCard score={data.score} components={data.components} />

          <QualityIndicators indicators={data.indicators} filter={filter} onFilter={setFilter} />

          <IssuesTable
            issues={data.issues ?? []}
            filter={filter}
            onFilterChange={setFilter}
            canCorrect={canCorrect}
            onCorrect={(t) => {
              setTarget(t);
              setDialogOpen(true);
            }}
          />

          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_20rem]">
            <StaleFleets stale={data.stale ?? []} />
            <div className="grid content-start gap-4 sm:grid-cols-2 xl:grid-cols-1">
              <OdometerHealth health={data.health} />
              <LastBatch batch={data.lastBatch} onOpen={openBatch} />
            </div>
          </div>
        </>
      )}

      {showSettings ? (
        <SettingsPanel
          settings={data.settings}
          settingsError={data.settingsError}
          canEdit={ctx.perms.manageParameters}
          canReprocess={ctx.perms.reprocess}
          period={data.period}
          vehicleIds={vehicleIds}
          onChanged={ctx.refresh}
        />
      ) : null}

      <StatusCatalog settings={data.settings} />

      <KmCorrectionDialog
        target={target}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onDone={ctx.refresh}
        allowReview={canCorrect}
      />
    </div>
  );
}
