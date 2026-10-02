"use client";

import { ShieldCheck } from "lucide-react";
import { Alert, AlertDescription } from "@/components/feedback/alert";
import { EmptyState } from "@/components/feedback/empty-state";
import { ErrorState } from "@/components/feedback/error-state";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { KmRotationData } from "@/lib/km/rotation";
import type { KmPanelContext } from "../shared";
import { SAFETY_NOTICE } from "./rotation/format";
import { PlanDetailView } from "./rotation/plan-detail";
import { PlansTable } from "./rotation/plans-table";
import { SuggestionsView } from "./rotation/suggestions";

/**
 * Gestão de KM → Plano de rodízio.
 *
 * Duas sub-abas na URL (`sub`): Sugestões — trocas calculadas pelo banco para
 * os parâmetros da tela — e Planos salvos, com o detalhe do plano aberto
 * (`plano`). O rodízio só sugere: aprovar, programar, executar e aplicar na
 * Fidelização são passos explícitos, cada um com a sua permissão.
 */
export function RotationPanel({ data, ctx }: { data: KmRotationData | null; ctx: KmPanelContext }) {
  if (ctx.error) {
    return (
      <ErrorState
        title="Não foi possível carregar o plano de rodízio."
        description={ctx.error}
        onRetry={ctx.refresh}
        retrying={ctx.pending}
        data-testid="km-rodizio-error"
      />
    );
  }
  if (!data) {
    return <EmptyState title="Sem dados do plano de rodízio" description="Atualize a tela para carregar as sugestões e os planos." />;
  }

  const sub = data.params.sub;
  const suggestionsCount = data.candidates?.items.length;

  return (
    <div className="flex flex-col gap-5" data-testid="km-rodizio">
      <Alert variant="info" icon={<ShieldCheck aria-hidden />} data-testid="km-rodizio-notice">
        <AlertDescription>{SAFETY_NOTICE}</AlertDescription>
      </Alert>

      <Tabs
        appearance="segmented"
        value={sub}
        onValueChange={(v) => ctx.navigate({ sub: v === "planos" ? "planos" : null, plano: null })}
      >
        <TabsList aria-label="Plano de rodízio">
          <TabsTrigger value="sugestoes" count={suggestionsCount} data-testid="km-rodizio-sub-sugestoes">
            Sugestões
          </TabsTrigger>
          <TabsTrigger value="planos" count={data.plans.length} data-testid="km-rodizio-sub-planos">
            Planos salvos
          </TabsTrigger>
        </TabsList>
        <TabsContent value="sugestoes" className="pt-2">
          {sub === "sugestoes" ? <SuggestionsView data={data} ctx={ctx} /> : null}
        </TabsContent>
        <TabsContent value="planos" className="pt-2">
          {sub === "planos" ? (
            data.params.planId ? (
              <PlanDetailView data={data} ctx={ctx} />
            ) : (
              <PlansTable plans={data.plans} onOpen={(id) => ctx.navigate({ sub: "planos", plano: id })} />
            )
          ) : null}
        </TabsContent>
      </Tabs>
    </div>
  );
}
