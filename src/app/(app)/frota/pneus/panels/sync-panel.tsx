"use client";

import * as React from "react";
import { ChevronRight, CloudOff, Upload } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/feedback/alert";
import { useToast } from "@/components/feedback/toast";
import { syncTiresNow } from "@/lib/tires/actions";
import type { TiresTabData } from "@/lib/tires/loaders";
import type { TiresPanelContext } from "../shared";
import { ImportPanel } from "./import-panel";
import { PanelEmpty, PanelError, useViewParam } from "./tires-ui";
import {
  cleanMessage, connectionLost, resultTitle, resultVariant, SyncResultAlert, TID, toSyncResult, type SyncResultState,
} from "./sync/sync-common";
import { SyncRuns } from "./sync/sync-runs";
import { SyncCurrent, SyncOpenBatch, SyncSource, SyncStats } from "./sync/sync-source";

type SyncData = TiresTabData["sincronizacao"];

/** Com uma execução em andamento, a tela se atualiza sozinha neste intervalo (só com a aba visível). */
const RUNNING_REFRESH_MS = 15_000;

/**
 * Gestão de Pneus → Sincronização Rodopar.
 *
 * A base oficial vem da planilha do SharePoint, lida pela Graph (agenda ou
 * "Sincronizar agora") e aplicada pelo MESMO pipeline da importação
 * (`tire_import_*`): o banco decide se aplica, bloqueia ou ignora. Aqui ficam
 * o estado da fonte, os dados vigentes, o histórico das execuções com o log
 * por etapa (`?execucoes=`, `?execucao=`) e, recolhido, o envio manual do
 * XLSX — a contingência para quando a sincronização estiver indisponível
 * (`?lote=&secao=&filtro=&pagina=` abrem a prévia de um lote).
 */
export function SyncPanel({ data, ctx }: { data: SyncData | null; ctx: TiresPanelContext }) {
  if (ctx.error) return <PanelError ctx={ctx} title="Não foi possível carregar a sincronização Rodopar." testId={`${TID}-error`} />;
  if (!data) {
    return (
      <PanelEmpty
        icon={<CloudOff />}
        title="Sem dados da sincronização"
        description="A leitura da sincronização e do histórico de lotes não trouxe resultado. Recarregue a página."
        testId={`${TID}-empty`}
      />
    );
  }
  return <SyncContent data={data} ctx={ctx} />;
}

function SyncContent({ data, ctx }: { data: SyncData; ctx: TiresPanelContext }) {
  const { toast } = useToast();
  const { sync, syncError } = data;
  const [busy, setBusy] = React.useState(false);
  const [result, setResult] = React.useState<SyncResultState | null>(null);
  const [, setOpenRun] = useViewParam("execucao");
  const refresh = ctx.refresh;
  const running = Boolean(sync?.running);

  // execução em andamento (agenda ou outra pessoa): acompanha a etapa sem recarregar a página
  React.useEffect(() => {
    if (!running || busy) return;
    const id = window.setInterval(() => {
      if (document.visibilityState === "visible") refresh();
    }, RUNNING_REFRESH_MS);
    return () => window.clearInterval(id);
  }, [running, busy, refresh]);

  const announce = (r: SyncResultState) => {
    setResult(r);
    toast({
      title: resultTitle(r),
      description: r.message,
      variant: resultVariant(r),
    });
  };

  const syncNow = async () => {
    setBusy(true);
    setResult(null);
    let r: SyncResultState;
    try {
      r = toSyncResult("sync", await syncTiresNow());
    } catch {
      r = connectionLost("sync");
    } finally {
      setBusy(false);
    }
    announce(r);
    refresh();
  };

  // a execução aberta pelo resultado está na primeira página do histórico
  const openRun = (runId: string) => {
    if (ctx.params.execucoes) ctx.navigate({ execucoes: null, execucao: runId });
    else setOpenRun(runId);
  };

  return (
    <div className="flex flex-col gap-6" data-testid={TID}>
      {syncError ? (
        <Alert variant="warning" data-testid={`${TID}-error`}>
          <AlertTitle>Não foi possível ler a situação da sincronização</AlertTitle>
          <AlertDescription>
            <p>{cleanMessage(syncError) ?? "Sem permissão de leitura da sincronização."}</p>
            <p className="mt-1">O histórico de lotes e o envio manual (contingência) continuam disponíveis abaixo.</p>
          </AlertDescription>
        </Alert>
      ) : null}

      {sync ? (
        <>
          <SyncSource sync={sync} ctx={ctx} busy={busy} onSync={() => void syncNow()} />
          {result ? <SyncResultAlert result={result} onOpenRun={openRun} onDismiss={() => setResult(null)} /> : null}
          <div className="grid gap-4 lg:grid-cols-2">
            <SyncCurrent sync={sync} ctx={ctx} />
            <SyncOpenBatch sync={sync} ctx={ctx} />
          </div>
          <SyncRuns sync={sync} ctx={ctx} onResult={announce} />
          <SyncStats sync={sync} />
        </>
      ) : null}

      <ManualSection data={data} ctx={ctx} />
    </div>
  );
}

/**
 * Envio manual (contingência), recolhido. Abre sozinho quando há uma prévia
 * pedida no endereço (`?lote=`), quando a sincronização está indisponível ou
 * quando um lote enviado à mão aguarda decisão.
 */
function ManualSection({ data, ctx }: { data: SyncData; ctx: TiresPanelContext }) {
  const ref = React.useRef<HTMLDetailsElement>(null);
  const lote = ctx.params.lote ?? null;
  const unavailable = !data.sync || !data.sync.source || Boolean(data.syncError);
  const manualWaiting = data.sync?.openBatch?.sourceKind === "upload";
  const [open, setOpen] = React.useState(Boolean(lote) || unavailable || manualWaiting);
  const [seenLote, setSeenLote] = React.useState(lote);
  if (lote !== seenLote) {
    setSeenLote(lote);
    if (lote) setOpen(true);
  }

  // prévia pedida (link do histórico, do lote aberto ou colado): leva a seção à vista
  React.useEffect(() => {
    if (!lote) return;
    const el = ref.current;
    if (!el) return;
    const top = el.getBoundingClientRect().top;
    if (top > window.innerHeight * 0.5 || top < 0) {
      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      el.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
    }
  }, [lote]);

  return (
    <details
      ref={ref}
      open={open}
      onToggle={(e) => setOpen(e.currentTarget.open)}
      className="group/manual scroll-mt-4 rounded-lg border border-border bg-surface-raised shadow-card"
      data-testid={`${TID}-manual`}
    >
      <summary className="flex cursor-pointer list-none items-center gap-3 rounded-lg px-4 py-3 hfm-focus-ring [&::-webkit-details-marker]:hidden">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-surface-interactive text-fg-secondary" aria-hidden>
          <Upload className="size-4" />
        </span>
        <span className="flex min-w-0 flex-col">
          <span className="text-h4 font-semibold text-fg">Envio manual (contingência)</span>
          <span className="text-caption text-fg-muted">
            Use só se a sincronização estiver indisponível. O fluxo normal é automático: a planilha oficial do SharePoint é lida e aplicada pelo mesmo
            pipeline, com as mesmas validações. Aqui ficam também a prévia e o histórico de lotes.
          </span>
        </span>
        <ChevronRight className="ml-auto size-4 shrink-0 text-fg-muted transition-transform group-open/manual:rotate-90" aria-hidden />
      </summary>
      <div className="border-t border-border p-4">
        <ImportPanel data={{ history: data.history, preview: data.preview, previewError: data.previewError }} ctx={ctx} />
      </div>
    </details>
  );
}
