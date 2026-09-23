"use client";

import * as React from "react";
import { ScopeHistory } from "@/app/(app)/aplicativos/check-list-frota/scope-history";
import { ExecutionDetailDrawer } from "@/app/(app)/aplicativos/check-list-frota/execution-detail-drawer";
import { OPERATIONS, createCorrectionStore } from "./fixture";

/**
 * A lista do escopo ligada ao detalhe, como no aplicativo, com a "rotina" de
 * correção em memória. `canCorrect` vem da URL (`?sem_permissao=1`).
 */
export function PreviewCorrecao({ canCorrect }: { canCorrect: boolean }) {
  const [store] = React.useState(createCorrectionStore);
  const [selected, setSelected] = React.useState<string | null>(null);
  const correctionLoaders = React.useMemo(() => ({ loadForm: store.loadForm, run: store.run }), [store]);

  return (
    <>
      <ScopeHistory operations={OPERATIONS} loader={store.loadRows} onOpenDetail={setSelected} />
      <ExecutionDetailDrawer
        executionId={selected}
        loader={store.loadDetail}
        canCorrect={canCorrect}
        correctionLoaders={correctionLoaders}
        onOpenChange={(open) => {
          if (!open) setSelected(null);
        }}
      />
    </>
  );
}
