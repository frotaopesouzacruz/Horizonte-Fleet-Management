"use client";

import Link from "next/link";
import { History, Upload } from "lucide-react";
import { EmptyState } from "@/components/feedback/empty-state";
import { ErrorState } from "@/components/feedback/error-state";
import { SectionHeader } from "@/components/layout/section-header";
import { Button } from "@/components/ui/button";
import { Pagination } from "@/components/ui/pagination";
import type { KmBatchesData } from "@/lib/km/batches";
import type { KmPanelContext } from "../shared";
import { KmBatchDetailView } from "./batches/batch-detail";
import { KmBatchTable } from "./batches/batch-table";
import { fmtCount } from "./import/shared";

/**
 * Gestão de KM → Lotes.
 *
 * Todo lote da importação de KM (pipeline oficial de lotes), mais recente
 * primeiro, paginado no banco (`km_import_batches`). Clicar abre o detalhe
 * (`lote` na URL): o resumo completo — os mesmos blocos da prévia — e os
 * achados por código.
 */

const TID = "km-lotes";

export function BatchesPanel({ data, ctx }: { data: KmBatchesData | null; ctx: KmPanelContext }) {
  if (ctx.error) {
    return (
      <ErrorState
        variant="panel"
        title="Não foi possível carregar os lotes de KM."
        description={ctx.error}
        onRetry={ctx.refresh}
        retryLabel="Tentar de novo"
        retrying={ctx.pending}
        data-testid={`${TID}-erro`}
      />
    );
  }

  const importHref = `${ctx.basePath}?aba=importacao`;

  if (!data || (data.total === 0 && !data.detail)) {
    return (
      <EmptyState
        variant="panel"
        icon={<History />}
        title="Nenhuma importação registrada"
        description="Os lotes da Base Geral KM Rodado aparecem aqui com o resultado: período, linhas, criados, atualizados, ignorados, avisos e erros."
        action={
          ctx.perms.import ? (
            <Button asChild>
              <Link href={importHref}>
                <Upload aria-hidden />
                Importar KM
              </Link>
            </Button>
          ) : undefined
        }
        data-testid={`${TID}-vazio`}
      />
    );
  }

  const selectedId = data.detail?.id ?? null;
  const open = (id: string) => ctx.navigate({ lote: id === selectedId ? null : id });

  return (
    <div className="flex flex-col gap-5" data-testid={TID}>
      {data.detail ? <KmBatchDetailView key={data.detail.id} detail={data.detail} ctx={ctx} testId={`${TID}-detalhe`} /> : null}

      <section aria-labelledby={`${TID}-titulo`} className="flex flex-col gap-3">
        <SectionHeader
          headingLevel={2}
          icon={<History />}
          title={<span id={`${TID}-titulo`}>Lotes de importação</span>}
          description={`${fmtCount(data.total)} lote(s), mais recentes primeiro. Ignorados são linhas sem gravação: iguais à base, futuras sem leitura, com erro ou com correção manual preservada.`}
          actions={
            ctx.perms.import ? (
              <Button asChild size="sm" variant="outline">
                <Link href={importHref} data-testid={`${TID}-importar`}>
                  <Upload aria-hidden />
                  Nova importação
                </Link>
              </Button>
            ) : undefined
          }
        />
        <KmBatchTable rows={data.rows} selectedId={selectedId} onOpen={open} testId={`${TID}-tabela`} />
        <Pagination
          page={data.page}
          pageSize={data.pageSize}
          total={data.total}
          onPageChange={(p) => ctx.navigate({ pagina: p > 1 ? String(p) : null })}
          disabled={ctx.pending}
          label="Paginação dos lotes"
          data-testid={`${TID}-paginacao`}
        />
      </section>
    </div>
  );
}
