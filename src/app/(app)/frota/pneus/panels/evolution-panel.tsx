"use client";

import * as React from "react";
import { CalendarClock, LineChart } from "lucide-react";
import { ErrorState } from "@/components/feedback/error-state";
import { Button } from "@/components/ui/button";
import type { TiresTabData } from "@/lib/tires/loaders";
import { modernTerms, tiresVisibleTabs } from "@/lib/tires/types";
import type { TiresPanelContext } from "../shared";
import { EvolutionControls } from "./evolution/evolution-controls";
import { EvolutionRanking } from "./evolution/evolution-ranking";
import { EvolutionRuns } from "./evolution/evolution-runs";
import { EvolutionSeries } from "./evolution/evolution-series";
import { EvolutionSummary } from "./evolution/evolution-summary";
import { IMMUTABLE_RULE, formatSlot, scheduleRule } from "./evolution/evolution-utils";
import { PanelEmpty, useTiresLink } from "./tires-ui";

/**
 * Gestão de Pneus → Evolução dos indicadores.
 *
 * Lê as capturas periódicas gravadas pelo banco (`tires_kpi_history`): o
 * resumo atual × anterior de todos os indicadores, a série do indicador
 * escolhido (Geral ou um item da dimensão), o ranking da dimensão e as
 * execuções recentes. Cada captura é imutável — a tela não recalcula nada a
 * partir da base atual; período sem captura não ganha número.
 */
const RECORTE_PARAMS = ["periodo", "indicador", "dimensao", "membro"] as const;

export function EvolutionPanel({ data, ctx }: { data: TiresTabData["evolucao"] | null; ctx: TiresPanelContext }) {
  const link = useTiresLink(ctx);

  if (ctx.error) {
    const custom = RECORTE_PARAMS.some((k) => ctx.params[k]);
    return (
      <ErrorState
        variant="panel"
        title="Não foi possível carregar a evolução dos indicadores."
        description={modernTerms(ctx.error)}
        onRetry={ctx.refresh}
        retryLabel="Tentar de novo"
        retrying={ctx.pending}
        action={
          custom ? (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => ctx.navigate({ periodo: null, indicador: null, dimensao: null, membro: null })}
              data-testid="tires-evolution-reset"
            >
              Voltar à visão Geral
            </Button>
          ) : undefined
        }
        data-testid="tires-evolution-error"
      />
    );
  }
  if (!data) {
    return (
      <PanelEmpty
        icon={<LineChart />}
        title="Evolução indisponível"
        description="A rotina não devolveu o histórico dos indicadores. Recarregue a página."
        testId="tires-evolution-empty"
      />
    );
  }

  // Sem nenhuma captura concluída: nada de série nem de resumo — só a agenda.
  const hasCaptures = data.series.length > 0 || data.members.length > 0 || data.summary.some((s) => s.current != null);
  const ranking = data.dimension !== "geral" && !data.dimensionId;

  if (!hasCaptures) {
    const s = data.schedule;
    const toSchedule = ctx.perms.parameters && tiresVisibleTabs(ctx.perms).includes("parametros")
      ? link({ aba: "parametros", sub: "indicadores", periodo: null, indicador: null, dimensao: null, membro: null })
      : null;
    return (
      <div className="flex flex-col gap-5" data-testid="tires-evolution" data-state="empty">
        <PanelEmpty
          icon={<CalendarClock />}
          title="Nenhuma captura de indicadores ainda"
          description={
            <>
              {!s ? (
                "A agenda dos indicadores ainda não foi configurada: sem ela não há captura automática."
              ) : !s.isActive ? (
                `A agenda está pausada (${scheduleRule(s)}): a primeira captura acontece quando ela for reativada.`
              ) : (
                <>
                  A primeira captura acontece no próximo horário agendado:{" "}
                  <span className="font-semibold text-fg" data-testid="tires-evolution-next-slot">
                    {formatSlot(s.nextSlotAt, s.timezone)}
                  </span>{" "}
                  ({scheduleRule(s)}). Até lá não há série para mostrar.
                </>
              )}{" "}
              {IMMUTABLE_RULE}
            </>
          }
          action={
            toSchedule ? (
              <Button asChild variant="secondary" size="sm">
                <a href={toSchedule.href} onClick={toSchedule.onClick} data-testid="tires-evolution-open-schedule">
                  Abrir a agenda dos indicadores
                </a>
              </Button>
            ) : undefined
          }
          testId="tires-evolution-empty"
        />
        {data.runs.length > 0 ? <EvolutionRuns data={data} ctx={ctx} /> : null}
      </div>
    );
  }

  return (
    <div
      className="flex flex-col gap-6"
      data-testid="tires-evolution"
      data-period={data.period}
      data-indicator={data.indicator}
      data-dimension={data.dimension}
    >
      <EvolutionControls data={data} ctx={ctx} />
      <EvolutionSummary data={data} ctx={ctx} />
      {ranking ? <EvolutionRanking data={data} ctx={ctx} /> : <EvolutionSeries data={data} ctx={ctx} />}
      <EvolutionRuns data={data} ctx={ctx} />
    </div>
  );
}
