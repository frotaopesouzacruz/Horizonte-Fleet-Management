"use client";

import { CheckCircle2, Circle, CircleDot, Loader2, XCircle } from "lucide-react";
import { Progress } from "@/components/feedback/progress";
import { cn } from "@/lib/cn";
import type { KmImportProgress, KmImportStage } from "@/lib/km/import-client";
import { fmtCount } from "./shared";

/**
 * O pipeline da importação de KM, etapa por etapa: leitura → envio em blocos
 * → validação → comparação e prévia → confirmação → consolidação (com
 * enriquecimento de contexto e sincronização do hodômetro) → finalização.
 * A barra mostra a etapa em curso com "X de Y linhas".
 */

export type KmPipelineStep = KmImportStage | "confirm" | "done";

const STEPS: { key: KmPipelineStep; label: string; hint: string }[] = [
  { key: "reading", label: "Leitura", hint: "Aba Controle KM Rodado, no navegador" },
  { key: "sending", label: "Envio em blocos", hint: "Staging, 2.000 linhas por bloco" },
  { key: "validating", label: "Validação", hint: "Placa, datas, números e situação" },
  { key: "finalizing", label: "Comparação e prévia", hint: "Duplicidades, continuidade e base atual" },
  { key: "confirm", label: "Confirmação", hint: "Sua decisão, com a prévia" },
  { key: "saving", label: "Consolidação", hint: "Razão diário, contexto e hodômetro" },
  { key: "done", label: "Finalização", hint: "Lote concluído e eventos" },
];

const PROGRESS_LABEL: Record<KmImportStage, string> = {
  reading: "Lendo a aba Controle KM Rodado",
  sending: "Enviando as linhas em blocos",
  validating: "Validando as linhas",
  finalizing: "Comparando com a base e montando a prévia",
  saving: "Gravando no razão diário",
};

const PROGRESS_UNIT: Record<KmImportStage, string> = {
  reading: "linhas",
  sending: "linhas enviadas",
  validating: "linhas validadas",
  finalizing: "linhas",
  saving: "linhas gravadas",
};

type StepState = "done" | "active" | "pending" | "error";

export function KmPipelineSteps({
  current,
  failed,
  progress,
  testId,
}: {
  /** Etapa em curso (ou a que espera a pessoa); null = nada começou. */
  current: KmPipelineStep | null;
  /** Etapa que falhou (a anterior fica concluída). */
  failed?: KmPipelineStep | null;
  progress: KmImportProgress | null;
  testId: string;
}) {
  const at = current ? STEPS.findIndex((s) => s.key === current) : -1;
  const failedAt = failed ? STEPS.findIndex((s) => s.key === failed) : -1;
  const stateOf = (i: number): StepState => {
    if (failedAt >= 0) return i < failedAt ? "done" : i === failedAt ? "error" : "pending";
    if (current === "done") return "done";
    if (i < at) return "done";
    if (i === at) return "active";
    return "pending";
  };

  const percent = progress && progress.total > 0 ? Math.min(100, Math.round((progress.done / progress.total) * 100)) : 0;

  return (
    <div className="flex flex-col gap-3" data-testid={testId}>
      <ol className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-7" aria-label="Etapas da importação">
        {STEPS.map((step, i) => {
          const state = stateOf(i);
          const running = state === "active" && step.key !== "confirm" && Boolean(progress);
          const Icon =
            state === "done" ? CheckCircle2 : state === "error" ? XCircle : state === "active" ? (running ? Loader2 : CircleDot) : Circle;
          const sr = state === "done" ? "concluída" : state === "error" ? "falhou" : state === "active" ? "em andamento" : "pendente";
          return (
            <li
              key={step.key}
              aria-current={state === "active" ? "step" : undefined}
              className={cn(
                "flex min-w-0 items-start gap-2 rounded-md border px-2.5 py-2",
                state === "active" && "border-primary bg-primary-soft",
                state === "done" && "border-border bg-surface",
                state === "pending" && "border-border-subtle bg-surface-sunken",
                state === "error" && "border-danger/40 bg-danger-soft",
              )}
              data-state={state}
            >
              <Icon
                aria-hidden
                className={cn(
                  "mt-0.5 size-4 shrink-0",
                  state === "done" && "text-success",
                  state === "active" && "text-primary-soft-fg",
                  running && "animate-spin motion-reduce:animate-none",
                  state === "pending" && "text-fg-muted",
                  state === "error" && "text-danger",
                )}
              />
              <span className="flex min-w-0 flex-col">
                <span className={cn("truncate text-label font-semibold", state === "pending" ? "text-fg-muted" : "text-fg")}>
                  <span className="tabular-nums">{i + 1}.</span> {step.label}
                  <span className="sr-only"> — {sr}</span>
                </span>
                <span className="truncate text-caption text-fg-muted" title={step.hint}>
                  {step.hint}
                </span>
              </span>
            </li>
          );
        })}
      </ol>

      {progress ? (
        <div aria-live="polite" className="flex flex-col gap-1" data-testid={`${testId}-barra`}>
          <Progress
            label={PROGRESS_LABEL[progress.stage]}
            value={percent}
            indeterminate={progress.total === 0}
            valueLabel={progress.total > 0 ? `${fmtCount(progress.done)} de ${fmtCount(progress.total)} ${PROGRESS_UNIT[progress.stage]}` : undefined}
            srLabel={PROGRESS_LABEL[progress.stage]}
          />
          <p className="text-caption text-fg-muted">Não feche esta janela até terminar.</p>
        </div>
      ) : null}
    </div>
  );
}
