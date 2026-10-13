"use client";

import * as React from "react";
import Link from "next/link";
import { ClipboardCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/feedback/error-state";
import { PageContent, PageHeader } from "@/components/layout/page-header";
import type { ExecutionSummary } from "@/lib/applications/queries";
import { HistoryScreen } from "../checklist-app";
import { ExecutionDetailDrawer } from "../execution-detail-drawer";

export type MyChecklistsResult = { ok: true; rows: ExecutionSummary[]; limit: number } | { ok: false; error: string };

/**
 * Meus checklists (HFC: "Meus checklists realizados") — a mesma lista do
 * aplicativo, numa tela própria para o Operacional chegar pelo Início e pelo
 * menu. Só os checklists do colaborador da própria conta (RLS + rotina); o
 * detalhe abre o checklist completo, só leitura.
 */
export function MyChecklistsView({
  result,
  canExecute,
  loader,
}: {
  result: MyChecklistsResult;
  canExecute: boolean;
  loader?: React.ComponentProps<typeof ExecutionDetailDrawer>["loader"];
}) {
  const [detailId, setDetailId] = React.useState<string | null>(null);

  return (
    <>
      <PageHeader
        eyebrow="Minha rotina"
        title="Meus checklists"
        description="Os checklists de saída e de retorno que você enviou, do mais recente para o mais antigo."
        primaryAction={
          canExecute ? (
            <Button asChild leadingIcon={<ClipboardCheck />}>
              <Link href="/aplicativos/check-list-frota">Fazer um checklist</Link>
            </Button>
          ) : undefined
        }
      />
      <PageContent>
        <div className="flex w-full max-w-3xl flex-col gap-3">
          {!result.ok ? (
            <ErrorState variant="panel" headingLevel={2} title="Não foi possível carregar os seus checklists." description={result.error} />
          ) : (
            <>
              {result.rows.length >= result.limit ? (
                <p className="text-caption text-fg-muted">Mostrando os {result.limit} mais recentes.</p>
              ) : null}
              <HistoryScreen history={result.rows} onOpen={setDetailId} />
            </>
          )}
        </div>
      </PageContent>
      <ExecutionDetailDrawer
        executionId={detailId}
        onOpenChange={(open: boolean) => {
          if (!open) setDetailId(null);
        }}
        loader={loader}
      />
    </>
  );
}
