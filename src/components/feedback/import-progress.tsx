"use client";

import { Progress } from "./progress";
import { describeProgress, type ImportProgressState } from "@/lib/import/client";

/**
 * O andamento de uma importação em partes: ler, enviar, validar, gravar —
 * com "X de Y linhas". Sem teto de linhas, um arquivo grande leva o tempo que
 * leva; o que a tela deve é mostrar que está andando.
 */
export function ImportProgress({ progress }: { progress: ImportProgressState | null }) {
  if (!progress) return null;
  const { label, detail, percent } = describeProgress(progress);
  const indeterminate = progress.total === 0;
  return (
    <div data-testid="import-progress" aria-live="polite" className="flex flex-col gap-1">
      <Progress
        label={label}
        value={percent}
        indeterminate={indeterminate}
        valueLabel={indeterminate ? undefined : detail}
        srLabel={label}
      />
      <p className="text-caption text-fg-muted">Não feche esta janela até terminar.</p>
    </div>
  );
}
