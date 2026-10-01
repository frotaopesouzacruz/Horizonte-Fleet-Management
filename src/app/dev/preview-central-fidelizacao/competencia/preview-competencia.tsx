"use client";

import * as React from "react";
import { CopyCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CompetenceStrip } from "@/app/(app)/governanca/fidelizacao/competence-strip";
import { HistoryConsolidated } from "@/app/(app)/governanca/fidelizacao/history-consolidated";
import {
  ReplicateFidelizationDialog,
  type ReplicateRunner,
} from "@/app/(app)/governanca/fidelizacao/replicate-fidelization-dialog";
import type { Competence } from "@/lib/governance/competence";
import {
  CURRENT_COMPETENCE,
  historyEvolutionFor,
  historyRowsFor,
  replicationPreviewFor,
  summaryFor,
} from "../fixture-competencia";

const OPERATIONS = [
  { id: "op-1", name: "Last Mille MG", status: "active" },
  { id: "op-2", name: "Redespacho - Belém", status: "active" },
];

/** A rotina da fixture: a mesma resposta que o banco daria, com um pequeno atraso. */
const fixtureRunner: ReplicateRunner = async (input) => {
  await new Promise((resolve) => setTimeout(resolve, 120));
  if (!input.dryRun) return { ok: false, error: "Prévia de desenvolvimento: nada é gravado." };
  return { ok: true, data: replicationPreviewFor(input.from, input.to, input.dryRun) };
};

const STRIPS: { title: string; competence: Competence }[] = [
  { title: "Mês corrente, criado pela rotina automática", competence: { year: 2026, month: 10 } },
  { title: "Mês encerrado, vindo da importação de 2026", competence: { year: 2026, month: 9 } },
  { title: "Mês seguinte, ainda não criado", competence: { year: 2026, month: 11 } },
  { title: "Histórico consolidado (somente consulta)", competence: { year: 2024, month: 3 } },
];

export function PreviewCompetencia() {
  const [dialog, setDialog] = React.useState<"created" | "new" | null>(null);
  const [historyYear, setHistoryYear] = React.useState("2024");
  const [historyMonth, setHistoryMonth] = React.useState<Record<string, Competence>>({
    "2024": { year: 2024, month: 3 },
    "2025": { year: 2025, month: 5 },
  });

  return (
    <>
      <section aria-labelledby="faixa" className="flex flex-col gap-4">
        <h2 id="faixa" className="text-section-title font-semibold text-fg">Faixa da competência</h2>
        {STRIPS.map((s) => (
          <div key={s.title} className="flex flex-col gap-2">
            <p className="text-caption text-fg-muted">{s.title}</p>
            <CompetenceStrip summary={summaryFor(s.competence)} fallbackLabel="" />
          </div>
        ))}
      </section>

      <section aria-labelledby="replicar" className="flex flex-col gap-3">
        <h2 id="replicar" className="text-section-title font-semibold text-fg">Replicar competência</h2>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" leadingIcon={<CopyCheck />} onClick={() => setDialog("created")}>
            Setembro → Outubro (já criada)
          </Button>
          <Button variant="secondary" leadingIcon={<CopyCheck />} onClick={() => setDialog("new")}>
            Outubro → Novembro (nova)
          </Button>
        </div>
      </section>

      <section aria-labelledby="historico" className="flex flex-col gap-3">
        <h2 id="historico" className="text-section-title font-semibold text-fg">Histórico consolidado</h2>
        <Tabs value={historyYear} onValueChange={setHistoryYear}>
          <TabsList aria-label="Ano do histórico">
            <TabsTrigger value="2024">2024 (sem BR)</TabsTrigger>
            <TabsTrigger value="2025">2025 (com BR)</TabsTrigger>
          </TabsList>
          {(["2024", "2025"] as const).map((year) => (
            <TabsContent key={year} value={year} className="pt-3">
              <HistoryConsolidated
                competence={historyMonth[year]}
                rows={historyRowsFor(historyMonth[year])}
                evolution={historyEvolutionFor(Number(year))}
                onSelectMonth={(c) => setHistoryMonth((prev) => ({ ...prev, [year]: c }))}
              />
            </TabsContent>
          ))}
        </Tabs>
      </section>

      <ReplicateFidelizationDialog
        key={`dialog-${dialog}`}
        open={dialog !== null}
        onOpenChange={(open) => {
          if (!open) setDialog(null);
        }}
        competence={dialog === "new" ? { year: 2026, month: 11 } : CURRENT_COMPETENCE}
        currentCompetence="2026-10"
        operations={OPERATIONS}
        canChangeDriver
        canManageHistorical
        runner={fixtureRunner}
      />
    </>
  );
}
