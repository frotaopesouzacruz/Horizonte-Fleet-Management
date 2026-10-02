"use client";

import * as React from "react";
import { FileSpreadsheet, Play, RotateCcw, Trash2, X } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/feedback/alert";
import { useConfirm } from "@/components/feedback/confirm-dialog";
import { useToast } from "@/components/feedback/toast";
import { SectionHeader } from "@/components/layout/section-header";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import type { KmBatchDetail } from "@/lib/km/batches";
import { cancelKmImport } from "@/lib/km/import-actions";
import { formatStamp } from "@/lib/maintenance/types";
import type { KmPanelContext } from "../../shared";
import { KmFindingsList } from "../import/findings-list";
import { FactList, Stat, isCancellableBatch, isOpenBatch, kmBatchStatus, kmSourceLabel } from "../import/shared";
import { KmImportSummaryView } from "../import/summary-view";

/**
 * Detalhe de um lote de KM: cabeçalho, contadores do lote, o resumo completo
 * (os mesmos blocos da prévia) e os achados por código, paginados. Lote em
 * rascunho, validado ou gravando pode ser retomado na Importação; os dois
 * primeiros podem ser cancelados (km.import).
 */
export function KmBatchDetailView({ detail, ctx, testId }: { detail: KmBatchDetail; ctx: KmPanelContext; testId: string }) {
  const { toast } = useToast();
  const confirm = useConfirm();
  const [busy, setBusy] = React.useState(false);
  const { batch, summary } = detail;
  const st = kmBatchStatus(batch?.status);
  const hasPreview = Boolean(summary && summary.rows != null);
  const close = () => ctx.navigate({ lote: null });

  const cancel = async () => {
    if (!batch) return;
    const ok = await confirm({
      title: "Cancelar este lote?",
      description: `${batch.fileName ?? "Lote"}: as linhas do staging ficam fora da base; nada foi gravado no razão diário. O lote continua listado como cancelado.`,
      confirmLabel: "Cancelar lote",
      cancelLabel: "Voltar",
      destructive: true,
    });
    if (!ok) return;
    setBusy(true);
    try {
      const res = await cancelKmImport(batch.id);
      if (res.ok) {
        toast({ title: "Lote cancelado. Nada foi gravado.", variant: "neutral" });
        ctx.refresh();
      } else {
        toast({ title: res.error ?? "Não foi possível cancelar o lote.", variant: "danger" });
      }
    } catch {
      toast({ title: "Não foi possível cancelar o lote.", variant: "danger" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section
      aria-labelledby={`${testId}-titulo`}
      className="flex flex-col gap-4 rounded-lg border border-border bg-surface-raised p-4 shadow-card"
      data-testid={testId}
    >
      <SectionHeader
        headingLevel={2}
        icon={<FileSpreadsheet />}
        title={
          <span id={`${testId}-titulo`} className="break-all">
            {batch?.fileName ?? "Lote de importação"}
          </span>
        }
        description={batch ? `Criado em ${formatStamp(batch.createdAt)}${batch.createdBy ? ` por ${batch.createdBy}` : ""}.` : undefined}
        actions={
          <>
            {batch ? (
              <StatusBadge status={st.tone} size="md" title={st.hint}>
                {st.label}
              </StatusBadge>
            ) : null}
            {batch && ctx.perms.import && isOpenBatch(batch.status) ? (
              <Button
                size="sm"
                leadingIcon={batch.status === "processing" ? <Play /> : <RotateCcw />}
                onClick={() => ctx.navigate({ aba: "importacao", lote: batch.id, pagina: null })}
                disabled={busy}
                data-testid={`${testId}-retomar`}
              >
                {batch.status === "processing" ? "Continuar gravação" : "Retomar na Importação"}
              </Button>
            ) : null}
            {batch && ctx.perms.import && isCancellableBatch(batch.status) ? (
              <Button
                size="sm"
                variant="outline"
                leadingIcon={<Trash2 />}
                onClick={() => void cancel()}
                loading={busy}
                data-testid={`${testId}-cancelar`}
              >
                Cancelar lote
              </Button>
            ) : null}
            <Button size="sm" variant="ghost" leadingIcon={<X />} onClick={close} data-testid={`${testId}-fechar`}>
              Fechar
            </Button>
          </>
        }
      />

      {!batch ? (
        <Alert variant="warning">
          <AlertTitle>Lote não encontrado ou fora do seu acesso</AlertTitle>
          <AlertDescription>Confira o link ou escolha um lote na lista abaixo.</AlertDescription>
        </Alert>
      ) : (
        <>
          <FactList
            items={[
              { label: "Situação", value: `${st.label}${st.hint ? ` — ${st.hint}` : ""}` },
              { label: "Fonte", value: kmSourceLabel(batch.sourceType) },
              { label: "Processado em", value: formatStamp(batch.processedAt) },
              ...(batch.errorMessage ? [{ label: "Mensagem do lote", value: batch.errorMessage, title: batch.errorMessage }] : []),
            ]}
          />
          <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-7" data-testid={`${testId}-contadores`}>
            <Stat label="Linhas" value={batch.totalRows ?? 0} />
            <Stat label="Válidas" value={batch.validRows ?? 0} tone="success" />
            <Stat label="Com aviso" value={batch.warningRows ?? 0} tone="warning" />
            <Stat label="Com erro" value={batch.errorRows ?? 0} tone="danger" />
            <Stat label="Criados" value={batch.createdRows ?? 0} tone="primary" />
            <Stat label="Atualizados" value={batch.updatedRows ?? 0} tone="primary" />
            <Stat label="Ignorados" value={batch.skippedRows ?? 0} hint="Sem gravação" />
          </dl>
        </>
      )}

      {batch && summary && hasPreview ? (
        <KmImportSummaryView
          summary={summary}
          categories={detail.categories}
          source={{
            fileName: batch.fileName,
            fileSize: batch.fileSize ?? null,
            fileHash: batch.fileHash,
            sheetName: batch.sheetName,
            headerRow: batch.headerRow,
          }}
          testId={`${testId}-resumo`}
        />
      ) : batch && batch.status === "draft" ? (
        <Alert variant="info">
          <AlertTitle>Lote em rascunho</AlertTitle>
          <AlertDescription>
            As linhas estão no staging, mas a prévia (comparação com a base, duplicidades e continuidade) ainda não foi montada.
            {ctx.perms.import ? " Use “Retomar na Importação” para validar e gerar a prévia, ou cancele o lote." : ""}
          </AlertDescription>
        </Alert>
      ) : batch && !summary ? (
        <Alert variant="neutral">
          <AlertTitle>Resumo completo indisponível</AlertTitle>
          <AlertDescription>
            O seu perfil não lê o resumo deste lote. Os contadores acima e os achados abaixo continuam disponíveis.
          </AlertDescription>
        </Alert>
      ) : null}

      {detail.findingsError ? (
        <Alert variant="danger">
          <AlertTitle>Não foi possível carregar os achados</AlertTitle>
          <AlertDescription>{detail.findingsError}</AlertDescription>
        </Alert>
      ) : detail.findings ? (
        <KmFindingsList
          key={detail.id}
          batchId={detail.id}
          categories={detail.categories}
          initial={detail.findings}
          testId={`${testId}-achados`}
        />
      ) : null}
    </section>
  );
}
