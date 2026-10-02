"use client";

import Link from "next/link";
import { ArrowRight, CheckCircle2, LayoutDashboard, ListTree } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { KmImportOutcome } from "@/lib/km/import-actions";
import { Stat } from "./shared";

/**
 * Resultado da consolidação: o que o banco devolveu ao concluir o lote
 * (`process_km_import`), mais o número de veículos cujo hodômetro foi
 * enviado à Manutenção (as chaves de `summary.km_before` do lote).
 */
export function KmOutcomeCard({
  outcome,
  fileName,
  syncedVehicles,
  batchHref,
  overviewHref,
  testId,
}: {
  outcome: KmImportOutcome;
  fileName: string | null;
  /** null enquanto o resumo do lote não foi recarregado (ou não é visível para o perfil). */
  syncedVehicles: number | null;
  batchHref: string;
  overviewHref: string;
  testId: string;
}) {
  return (
    <section
      aria-labelledby={`${testId}-titulo`}
      className="flex flex-col gap-3 rounded-lg border border-success/30 bg-success-soft p-4"
      data-testid={testId}
    >
      <div className="flex flex-wrap items-start gap-2">
        <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-success" aria-hidden />
        <div className="min-w-0 flex-1">
          <h3 id={`${testId}-titulo`} className="text-h4 font-semibold text-success-soft-fg">
            Importação concluída
          </h3>
          <p className="truncate text-body-sm text-success-soft-fg" title={fileName ?? undefined}>
            {fileName ?? "Lote de KM"} — leituras consolidadas no razão diário.
          </p>
        </div>
      </div>
      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-5">
        <Stat label="Criados" value={outcome.createdRows} tone="primary" testId={`${testId}-criados`} />
        <Stat label="Atualizados" value={outcome.updatedRows} tone="primary" testId={`${testId}-atualizados`} />
        <Stat label="Mantidos (sem gravação)" value={outcome.skippedRows} hint="Iguais, futuras, com erro ou corrigidas" />
        <Stat
          label="Hodômetros sincronizados"
          value={syncedVehicles ?? "—"}
          hint="Veículos enviados à Manutenção"
          testId={`${testId}-hodometros`}
        />
        <Stat label="Marcos preventivos alcançados" value={outcome.milestoneEvents} tone="info" hint="Aviso; nenhuma OS é criada" />
      </dl>
      <p className="text-caption text-success-soft-fg">
        Na gravação, cada leitura recebeu o contexto vigente na data (operação, liderança, BR) e o hodômetro final do dia foi
        sincronizado com o veículo (valor novo supera o anterior; igual não duplica). O Cadastro de Frotas não foi alterado.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button asChild size="sm" variant="outline">
          <Link href={batchHref} data-testid={`${testId}-lote`}>
            <ListTree aria-hidden />
            Abrir o lote
          </Link>
        </Button>
        <Button asChild size="sm" variant="primary">
          <Link href={overviewHref} data-testid={`${testId}-visao-geral`}>
            <LayoutDashboard aria-hidden />
            Ir para a Visão geral
            <ArrowRight aria-hidden />
          </Link>
        </Button>
      </div>
    </section>
  );
}
