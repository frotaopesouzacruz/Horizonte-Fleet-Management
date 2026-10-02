"use client";

import * as React from "react";
import Link from "next/link";
import { FileCheck2, History, Play, RotateCcw, ShieldCheck, Trash2, Upload } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/feedback/alert";
import { useConfirm } from "@/components/feedback/confirm-dialog";
import { EmptyState } from "@/components/feedback/empty-state";
import { ErrorState } from "@/components/feedback/error-state";
import { useToast } from "@/components/feedback/toast";
import { SectionHeader } from "@/components/layout/section-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import type { KmBatchesData, KmImportBatch } from "@/lib/km/batches";
import { cancelKmImport, type KmImportOutcome, type KmImportPreview } from "@/lib/km/import-actions";
import {
  confirmKmImport, resumeKmImport, uploadKmImport, type KmImportProgress, type KmImportStage,
} from "@/lib/km/import-client";
import { kmFiltersQuery } from "@/lib/km/url";
import { formatStamp } from "@/lib/maintenance/types";
import type { KmPanelContext } from "../shared";
import { KmFindingsList } from "./import/findings-list";
import { KmOpenBatches } from "./import/open-batches";
import { KmOutcomeCard } from "./import/outcome-card";
import { KmPipelineSteps, type KmPipelineStep } from "./import/pipeline-steps";
import { fmtCount, isCancellableBatch, isOpenBatch, kmBatchStatus } from "./import/shared";
import { KmDropzone, KmSourceInfo } from "./import/source-card";
import { KmImportSummaryView, type KmSummarySource } from "./import/summary-view";

/**
 * Gestão de KM → Importação.
 *
 * Fonte oficial: Base Geral KM Rodado.xlsx → aba Controle KM Rodado. O
 * arquivo é lido no navegador e vai ao banco em blocos; o banco valida,
 * compara com a base e devolve a prévia. Nada é gravado sem a confirmação —
 * e linhas com erro bloqueiam a confirmação. A tela não decide KM, status
 * nem ação de linha: mostra o que a rotina disse e pede a decisão.
 */

type Phase = "idle" | "running" | "preview" | "saving" | "done";

interface Flow {
  phase: Phase;
  step: KmPipelineStep | null;
  failed: KmPipelineStep | null;
  source: KmSummarySource | null;
  preview: KmImportPreview | null;
  outcome: KmImportOutcome | null;
  /** A consolidação começou: o lote já não pode ser cancelado, só continuado. */
  saveStarted: boolean;
  error: string | null;
  sheetNames: string[] | null;
  /** Lote que ficou aberto após uma falha (retomar ou cancelar). */
  strandedBatchId: string | null;
}

const IDLE: Flow = {
  phase: "idle",
  step: null,
  failed: null,
  source: null,
  preview: null,
  outcome: null,
  saveStarted: false,
  error: null,
  sheetNames: null,
  strandedBatchId: null,
};

const TID = "km-importacao";

export function ImportPanel({ data, ctx }: { data: KmBatchesData | null; ctx: KmPanelContext }) {
  if (!ctx.perms.import) {
    return (
      <EmptyState
        variant="panel"
        icon={<ShieldCheck />}
        title="Sem acesso à importação de KM"
        description="Importar a Base Geral KM Rodado exige a permissão km.import. Peça ao administrador da organização."
        data-testid={`${TID}-sem-acesso`}
      />
    );
  }
  return <ImportWorkspace data={data} ctx={ctx} />;
}

function ImportWorkspace({ data, ctx }: { data: KmBatchesData | null; ctx: KmPanelContext }) {
  const { toast } = useToast();
  const confirm = useConfirm();
  const [file, setFile] = React.useState<File | null>(null);
  const [flow, setFlow] = React.useState<Flow>(IDLE);
  const [progress, setProgress] = React.useState<KmImportProgress | null>(null);
  const [busy, setBusy] = React.useState(false);

  // Última etapa informada pelo pipeline (para dizer onde uma queda de conexão parou).
  const stageRef = React.useRef<KmImportStage>("reading");
  const onProgress = React.useCallback((p: KmImportProgress | null) => {
    setProgress(p);
    if (p) {
      stageRef.current = p.stage;
      setFlow((f) => (f.step === p.stage ? f : { ...f, step: p.stage }));
    }
  }, []);

  const batchHref = (id: string) => `${ctx.basePath}?${new URLSearchParams({ aba: "lotes", lote: id }).toString()}`;
  const overviewHref = `${ctx.basePath}?${kmFiltersQuery(ctx.filters, { aba: "visao-geral" })}`;

  const currentBatchId = flow.preview?.batchId ?? flow.outcome?.batchId ?? null;
  const locked = busy || flow.phase === "preview" || flow.phase === "saving";

  // ------------------------------------------------------------------ fluxo
  const fail = (stage: KmPipelineStep, error: string, extra: Partial<Flow> = {}) => {
    setFlow((f) => ({ ...f, phase: extra.phase ?? "idle", failed: stage, step: stage, error, ...extra }));
    toast({ title: error, variant: "danger" });
  };

  const validate = async () => {
    if (!file || busy) return;
    setBusy(true);
    stageRef.current = "reading";
    setFlow({ ...IDLE, phase: "running", step: "reading" });
    try {
      const result = await uploadKmImport(file, onProgress);
      if (result.ok) {
        const { sheet, preview } = result;
        setFlow({
          ...IDLE,
          phase: "preview",
          step: "confirm",
          preview,
          source: {
            fileName: sheet.fileName,
            fileSize: sheet.fileSize,
            fileHash: sheet.fileHash,
            sheetName: sheet.sheetName,
            headerRow: sheet.headerRow,
          },
        });
        toast({
          title: `Planilha validada: aba "${sheet.sheetName}", cabeçalho na linha ${sheet.headerRow}.`,
          description: `${fmtCount(sheet.rowsRead)} linha(s) lidas. Confira a prévia antes de confirmar.`,
          variant: "success",
        });
      } else {
        fail(result.stage, result.error, {
          sheetNames: result.sheetNames ?? null,
          strandedBatchId: result.batchId ?? null,
        });
      }
    } catch {
      fail(stageRef.current, "A conexão com o servidor caiu. Verifique a internet e tente de novo.");
    } finally {
      setProgress(null);
      setBusy(false);
    }
  };

  const save = async () => {
    const preview = flow.preview;
    if (!preview || busy) return;
    const s = preview.summary;
    const writable = (s.createRows ?? 0) + (s.updateRows ?? 0);
    const ok = await confirm({
      title: "Confirmar a importação de KM?",
      description:
        writable > 0
          ? `${fmtCount(s.createRows)} leitura(s) nova(s) e ${fmtCount(s.updateRows)} atualização(ões) serão gravadas no razão diário, com o contexto da data e o hodômetro do veículo sincronizado. ${fmtCount(
              s.unchangedRows,
            )} igual(is) e ${fmtCount(s.manualKeptRows)} correção(ões) manual(is) ficam como estão. O Cadastro de Frotas não é alterado.`
          : "Nenhuma leitura nova ou alterada: o lote será concluído sem gravar no razão diário (fica registrado em Lotes).",
      confirmLabel: "Confirmar importação",
      cancelLabel: "Voltar à prévia",
    });
    if (!ok) return;
    await runSave(preview.batchId, writable);
  };

  const runSave = async (batchId: string, expected: number) => {
    setBusy(true);
    setFlow((f) => ({ ...f, phase: "saving", step: "saving", failed: null, error: null, saveStarted: true }));
    try {
      const result = await confirmKmImport(batchId, expected, onProgress);
      if (result.ok && result.data) {
        const outcome = result.data;
        setFlow((f) => ({ ...f, phase: "done", step: "done", outcome }));
        toast({
          title: `Importação concluída: ${fmtCount(outcome.createdRows)} criada(s), ${fmtCount(outcome.updatedRows)} atualizada(s).`,
          variant: "success",
        });
        setFile(null);
        // Recarrega o lote (resumo com o hodômetro de antes, para a contagem de sincronizados).
        ctx.navigate({ lote: outcome.batchId });
      } else {
        fail("saving", result.error ?? "Não foi possível gravar a importação.", {
          phase: flow.preview ? "preview" : "idle",
          strandedBatchId: batchId,
        });
      }
    } catch {
      fail("saving", "A conexão caiu durante a gravação. O que já foi gravado continua gravado; confirme de novo para continuar.", {
        phase: flow.preview ? "preview" : "idle",
        strandedBatchId: batchId,
      });
    } finally {
      setProgress(null);
      setBusy(false);
    }
  };

  const cancelBatch = async (batchId: string, fileName?: string | null) => {
    const ok = await confirm({
      title: "Cancelar este lote?",
      description: `${fileName ? `${fileName}: ` : ""}as linhas do staging ficam fora da base; nada foi gravado no razão diário. O lote continua listado em Lotes como cancelado.`,
      confirmLabel: "Cancelar lote",
      cancelLabel: "Voltar",
      destructive: true,
    });
    if (!ok) return;
    setBusy(true);
    try {
      const res = await cancelKmImport(batchId);
      if (res.ok) {
        toast({ title: "Lote cancelado. Nada foi gravado.", variant: "neutral" });
        if (currentBatchId === batchId || flow.strandedBatchId === batchId) setFlow(IDLE);
        if (ctx.params.lote === batchId) ctx.navigate({ lote: null });
        else ctx.refresh();
      } else {
        toast({ title: res.error ?? "Não foi possível cancelar o lote.", variant: "danger" });
      }
    } catch {
      toast({ title: "Não foi possível cancelar o lote.", variant: "danger" });
    } finally {
      setBusy(false);
    }
  };

  const resume = async (batch: KmImportBatch) => {
    if (busy) return;
    const source: KmSummarySource = {
      fileName: batch.fileName,
      fileSize: batch.fileSize ?? null,
      fileHash: batch.fileHash,
      sheetName: batch.sheetName,
      headerRow: batch.headerRow,
    };
    if (batch.status === "processing") {
      setFlow({ ...IDLE, phase: "saving", step: "saving", source, saveStarted: true });
      await runSave(batch.id, 0);
      return;
    }
    setBusy(true);
    setFlow({ ...IDLE, phase: "running", step: batch.status === "draft" ? "validating" : "finalizing", source });
    try {
      const res = await resumeKmImport(batch.id, batch.status, onProgress);
      if (res.ok && res.data) {
        setFlow({ ...IDLE, phase: "preview", step: "confirm", preview: res.data, source });
        toast({ title: "Prévia refeita com a base de agora. Confira antes de confirmar.", variant: "success" });
      } else {
        fail(batch.status === "draft" ? "validating" : "finalizing", res.error ?? "Não foi possível retomar o lote.", {
          source,
          strandedBatchId: batch.id,
        });
      }
    } catch {
      fail("finalizing", "A conexão com o servidor caiu. Tente de novo.", { source, strandedBatchId: batch.id });
    } finally {
      setProgress(null);
      setBusy(false);
    }
  };

  const reset = () => {
    setFlow(IDLE);
    setFile(null);
    if (ctx.params.lote) ctx.navigate({ lote: null });
  };

  // ------------------------------------------------------------------ dados
  const selected = data?.detail?.batch ?? null;
  const selectedIsCurrent = Boolean(selected && selected.id === currentBatchId);
  const openBatches = (data?.rows ?? []).filter((b) => isOpenBatch(b.status) && b.id !== currentBatchId);
  const syncedVehicles =
    flow.outcome && data?.detail?.id === flow.outcome.batchId && data.detail.summary?.kmBefore
      ? Object.keys(data.detail.summary.kmBefore).length
      : null;

  const preview = flow.preview;
  const errorRows = preview ? Math.max(preview.errorRows, preview.summary.errorRows ?? 0) : 0;
  const pipelineVisible = flow.phase !== "idle" || flow.failed !== null;

  return (
    <div className="flex flex-col gap-5" data-testid={`${TID}`}>
      {ctx.error ? (
        <ErrorState
          variant="inline"
          title="Não foi possível carregar os lotes de KM."
          description={ctx.error}
          onRetry={ctx.refresh}
          retrying={ctx.pending}
          data-testid={`${TID}-erro`}
        />
      ) : null}

      <section
        aria-labelledby={`${TID}-titulo`}
        aria-busy={busy}
        className="flex flex-col gap-4 rounded-lg border border-border bg-surface-raised p-4 shadow-card"
      >
        <SectionHeader
          headingLevel={2}
          icon={<Upload />}
          title={<span id={`${TID}-titulo`}>Importar KM rodado</span>}
          description="Upload → leitura → validação → comparação → prévia → confirmação → consolidação. Sem limite de linhas."
        />
        <KmSourceInfo testId={`${TID}-fonte`} />
        <div className="flex flex-col gap-2">
          <KmDropzone
            file={file}
            onFile={(f) => {
              setFile(f);
              if (flow.phase === "idle" || flow.phase === "done") setFlow(IDLE);
            }}
            disabled={locked}
            testId={`${TID}-arquivo`}
          />
          <div className="flex flex-wrap items-center gap-2">
            <Button
              leadingIcon={<FileCheck2 />}
              onClick={() => void validate()}
              disabled={!file || locked}
              loading={busy && flow.phase === "running"}
              data-testid={`${TID}-validar`}
            >
              Ler e validar arquivo
            </Button>
            {locked && flow.phase === "preview" ? (
              <span className="text-caption text-fg-muted">Confirme ou cancele a prévia aberta para enviar outro arquivo.</span>
            ) : null}
          </div>
        </div>

        {pipelineVisible ? (
          <KmPipelineSteps current={flow.step} failed={flow.failed} progress={progress} testId={`${TID}-etapas`} />
        ) : null}

        {flow.error ? (
          <Alert variant="danger" data-testid={`${TID}-falha`}>
            <AlertTitle>{flow.sheetNames ? "Importação bloqueada" : "Não foi possível concluir"}</AlertTitle>
            <AlertDescription>
              <p>{flow.error}</p>
              {flow.sheetNames ? (
                <div className="mt-1.5">
                  <p>Abas encontradas no arquivo ({fmtCount(flow.sheetNames.length)}):</p>
                  <ul className="mt-1 flex flex-wrap gap-1.5" aria-label="Abas encontradas" data-testid={`${TID}-abas`}>
                    {flow.sheetNames.map((name) => (
                      <li key={name}>
                        <Badge variant="neutral" appearance="outline" size="md">
                          {name}
                        </Badge>
                      </li>
                    ))}
                  </ul>
                  <p className="mt-1.5">
                    Nenhuma outra aba é usada no lugar da oficial. Renomeie a aba de leituras para &ldquo;Controle KM
                    Rodado&rdquo; ou envie a Base Geral KM Rodado.xlsx.
                  </p>
                </div>
              ) : null}
              {flow.strandedBatchId && !flow.preview ? (
                <p className="mt-1.5">
                  O lote ficou aberto.{" "}
                  <Link className="font-medium underline underline-offset-4" href={batchHref(flow.strandedBatchId)}>
                    Abrir em Lotes
                  </Link>{" "}
                  para retomar ou cancelar.
                </p>
              ) : null}
            </AlertDescription>
          </Alert>
        ) : null}
      </section>

      {flow.outcome ? (
        <KmOutcomeCard
          outcome={flow.outcome}
          fileName={flow.source?.fileName ?? flow.preview?.fileName ?? null}
          syncedVehicles={syncedVehicles}
          batchHref={batchHref(flow.outcome.batchId)}
          overviewHref={overviewHref}
          testId={`${TID}-resultado`}
        />
      ) : null}

      {preview && flow.phase !== "done" ? (
        <section
          aria-labelledby={`${TID}-previa-titulo`}
          className="flex flex-col gap-4 rounded-lg border border-border bg-surface-raised p-4 shadow-card"
          data-testid={`${TID}-previa`}
        >
          <SectionHeader
            headingLevel={2}
            title={<span id={`${TID}-previa-titulo`}>Prévia da importação</span>}
            description="Nada foi gravado no razão diário ainda. Confira e confirme — ou cancele o lote."
            actions={
              <StatusBadge status={flow.phase === "saving" ? "progress" : "info"} size="md">
                {flow.phase === "saving" ? "Gravando" : "Aguardando confirmação"}
              </StatusBadge>
            }
          />
          <KmImportSummaryView
            summary={preview.summary}
            categories={preview.categories}
            source={{ ...flow.source, fileName: flow.source?.fileName ?? preview.fileName }}
            testId={`${TID}-previa-resumo`}
          />
          <KmFindingsList
            key={preview.batchId}
            batchId={preview.batchId}
            categories={preview.categories}
            testId={`${TID}-achados`}
          />
          <div className="flex flex-col gap-3 border-t border-border pt-4 sm:flex-row sm:items-center sm:justify-end">
            <p className="text-caption text-fg-muted sm:mr-auto" data-testid={`${TID}-bloqueio`}>
              {errorRows > 0
                ? `${fmtCount(errorRows)} linha(s) com erro bloqueiam a confirmação. Corrija a planilha e envie de novo, ou cancele o lote.`
                : (preview.summary.createRows ?? 0) + (preview.summary.updateRows ?? 0) > 0
                  ? `${fmtCount((preview.summary.createRows ?? 0) + (preview.summary.updateRows ?? 0))} linha(s) serão gravadas (novas + atualizações). Avisos não bloqueiam.`
                  : "Nenhuma linha nova ou alterada. Confirmar conclui o lote sem gravar leituras."}
            </p>
            {!flow.saveStarted ? (
              <Button
                variant="outline"
                leadingIcon={<Trash2 />}
                onClick={() => void cancelBatch(preview.batchId, preview.fileName)}
                disabled={busy}
                data-testid={`${TID}-cancelar`}
              >
                Cancelar lote
              </Button>
            ) : null}
            <Button
              leadingIcon={flow.saveStarted ? <Play /> : <FileCheck2 />}
              onClick={() => void (flow.saveStarted ? runSave(preview.batchId, 0) : save())}
              loading={busy && flow.phase === "saving"}
              disabled={busy || errorRows > 0}
              data-testid={`${TID}-confirmar`}
            >
              {flow.saveStarted ? "Continuar gravação" : "Confirmar importação"}
            </Button>
          </div>
        </section>
      ) : null}

      {flow.phase === "done" ? (
        <div className="flex justify-end">
          <Button variant="ghost" leadingIcon={<Upload />} onClick={reset} data-testid={`${TID}-nova`}>
            Importar outro arquivo
          </Button>
        </div>
      ) : null}

      {selected && !selectedIsCurrent ? (
        <SelectedBatch
          batch={selected}
          busy={busy || flow.phase === "preview" || flow.phase === "saving"}
          onResume={() => void resume(selected)}
          onCancel={() => void cancelBatch(selected.id, selected.fileName)}
          batchHref={batchHref(selected.id)}
        />
      ) : null}

      <section aria-labelledby={`${TID}-abertos-titulo`} className="flex flex-col gap-3" data-testid={`${TID}-abertos`}>
        <SectionHeader
          headingLevel={2}
          icon={<History />}
          title={<span id={`${TID}-abertos-titulo`}>Lotes em aberto</span>}
          description="Rascunhos, prévias aguardando confirmação e gravações interrompidas entre os lotes mais recentes."
          actions={
            <Button asChild size="sm" variant="outline">
              <Link href={`${ctx.basePath}?aba=lotes`} data-testid={`${TID}-ver-lotes`}>
                Ver todos os lotes
              </Link>
            </Button>
          }
        />
        {openBatches.length ? (
          <KmOpenBatches
            batches={openBatches}
            busy={busy || flow.phase === "preview" || flow.phase === "saving"}
            canAct={ctx.perms.import}
            onResume={(b) => void resume(b)}
            onCancel={(b) => void cancelBatch(b.id, b.fileName)}
            testId={`${TID}-abertos-tabela`}
          />
        ) : (
          <p className="rounded-md border border-dashed border-border px-3 py-4 text-center text-body-sm text-fg-muted">
            Nenhum lote em aberto entre os {fmtCount(data?.rows.length ?? 0)} mais recentes.
          </p>
        )}
      </section>
    </div>
  );
}

/** O lote indicado na URL (`lote`): retomar, continuar ou cancelar daqui. */
function SelectedBatch({
  batch,
  busy,
  onResume,
  onCancel,
  batchHref,
}: {
  batch: KmImportBatch;
  busy: boolean;
  onResume: () => void;
  onCancel: () => void;
  batchHref: string;
}) {
  const st = kmBatchStatus(batch.status);
  const open = isOpenBatch(batch.status);
  return (
    <section
      aria-label="Lote selecionado"
      className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-surface-raised p-4 shadow-card"
      data-testid={`${TID}-lote`}
    >
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="truncate text-body font-semibold text-fg" title={batch.fileName ?? undefined}>
            {batch.fileName ?? "Lote de KM"}
          </span>
          <StatusBadge status={st.tone} size="sm">
            {st.label}
          </StatusBadge>
        </div>
        <span className="text-caption text-fg-muted">
          Criado em {formatStamp(batch.createdAt)} · {fmtCount(batch.totalRows)} linha(s) · {st.hint}
        </span>
      </div>
      <div className="flex flex-wrap gap-2">
        {open ? (
          <Button
            size="sm"
            leadingIcon={batch.status === "processing" ? <Play /> : <RotateCcw />}
            onClick={onResume}
            disabled={busy}
            data-testid={`${TID}-lote-retomar`}
          >
            {batch.status === "processing" ? "Continuar gravação" : batch.status === "draft" ? "Validar e gerar prévia" : "Refazer prévia"}
          </Button>
        ) : null}
        {isCancellableBatch(batch.status) ? (
          <Button size="sm" variant="outline" leadingIcon={<Trash2 />} onClick={onCancel} disabled={busy} data-testid={`${TID}-lote-cancelar`}>
            Cancelar lote
          </Button>
        ) : null}
        <Button asChild size="sm" variant="ghost">
          <Link href={batchHref}>Ver detalhes em Lotes</Link>
        </Button>
      </div>
    </section>
  );
}
