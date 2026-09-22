"use client";

import * as React from "react";
import { ScopeHistory } from "@/app/(app)/aplicativos/check-list-frota/scope-history";
import { ExecutionDetailDrawer } from "@/app/(app)/aplicativos/check-list-frota/execution-detail-drawer";
import { OPERATIONS, loadDetail, loadRows } from "./fixture";

/**
 * Liga a lista ao drawer, como o aplicativo fará: a linha escolhida vira o id
 * aberto, fechar zera. Os carregadores são os da amostra — nada aqui toca o
 * Supabase.
 */
export function PreviewHistorico() {
  const [selected, setSelected] = React.useState<string | null>(null);

  return (
    <>
      <ScopeHistory operations={OPERATIONS} loader={loadRows} onOpenDetail={setSelected} />
      <ExecutionDetailDrawer
        executionId={selected}
        loader={loadDetail}
        onOpenChange={(open) => {
          if (!open) setSelected(null);
        }}
      />
    </>
  );
}
