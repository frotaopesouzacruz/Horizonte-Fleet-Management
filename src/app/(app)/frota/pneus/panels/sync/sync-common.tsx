"use client";

import { Alert, AlertDescription, AlertTitle, type AlertVariant } from "@/components/feedback/alert";
import { Button } from "@/components/ui/button";
import type { Result, SyncNowOutcome } from "@/lib/tires/actions";
import { formatDate, formatStamp, modernTerms, SYNC_RUN_STATUS_LABEL, type SyncRunStatus } from "@/lib/tires/types";

/**
 * Vocabulário comum da aba Sincronização Rodopar: rótulos, durações e o
 * resultado de "Sincronizar agora"/"Reprocessar". Quem decide se a planilha
 * é aplicada, bloqueada ou ignorada é o banco (pipeline oficial); a tela só
 * relata o que a execução devolveu.
 */
export const TID = "tires-sync";

export const SOURCE_KIND_LABEL: Record<"upload" | "sharepoint", string> = { sharepoint: "SharePoint", upload: "Envio manual" };

/** Código de erro do servidor quando as credenciais da Graph não estão configuradas. */
export const CREDENTIALS_MISSING = "credenciais_ausentes";

const isRunStatus = (v: string | null | undefined): v is SyncRunStatus => !!v && v in SYNC_RUN_STATUS_LABEL;

/** Rótulo da situação, incluindo os desfechos que não viram execução (ignorada). */
export function syncStatusLabel(status: string | null | undefined): string {
  if (isRunStatus(status)) return SYNC_RUN_STATUS_LABEL[status];
  if (status === "ignorada") return "Não executada";
  return status ?? "—";
}

/** Mensagem gravada pelo banco/servidor, sem o prefixo técnico da rotina e com a linguagem atual. */
export const cleanMessage = (v: string | null | undefined) => modernTerms((v ?? "").replace(/^tires?_[a-z_]+:\s*/, "")) || null;

const timeFmt = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit", second: "2-digit" });
/** Hora (com segundos) em São Paulo, para o log por etapa. */
export function fmtClock(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : timeFmt.format(d);
}

/** "45 s", "2 min 10 s" — duração entre início e fim; "—" sem fim. */
export function fmtDuration(start: string | null | undefined, end: string | null | undefined): string {
  if (!start || !end) return "—";
  const ms = new Date(end).getTime() - new Date(start).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "—";
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  const rest = s % 60;
  if (m < 60) return rest ? `${m} min ${rest} s` : `${m} min`;
  return `${Math.floor(m / 60)} h ${m % 60} min`;
}

const sizeFmt = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 });
export function fmtBytes(bytes: number | null | undefined): string {
  if (bytes == null || !Number.isFinite(bytes)) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${sizeFmt.format(bytes / 1024)} KB`;
  return `${sizeFmt.format(bytes / (1024 * 1024))} MB`;
}

// ---------------------------------------------------------------------------
// Resultado de "Sincronizar agora" / "Reprocessar"
// ---------------------------------------------------------------------------
export interface SyncResultState {
  action: "sync" | "reprocess";
  ok: boolean;
  status: string | null;
  message: string;
  code: string | null;
  runId: string | null;
  referenceDate: string | null;
  sameDayRevision: boolean;
  at: string;
}

export function toSyncResult(action: SyncResultState["action"], r: Result<SyncNowOutcome>): SyncResultState {
  const d = r.data;
  return {
    action,
    ok: r.ok,
    status: d?.status ?? null,
    message: cleanMessage(d?.message ?? r.error) ?? "Não foi possível sincronizar agora.",
    code: d?.errorCode ?? r.code ?? null,
    runId: d?.runId ?? null,
    referenceDate: d?.referenceDate ?? null,
    sameDayRevision: d?.sameDayRevision ?? false,
    at: new Date().toISOString(),
  };
}

export const connectionLost = (action: SyncResultState["action"]): SyncResultState => ({
  action,
  ok: false,
  status: null,
  message: "A conexão com o servidor caiu antes da resposta. A execução pode ter continuado no servidor: confira o histórico abaixo em instantes.",
  code: null,
  runId: null,
  referenceDate: null,
  sameDayRevision: false,
  at: new Date().toISOString(),
});

const RESULT_VARIANT: Record<string, AlertVariant> = {
  concluida: "success",
  concluida_com_avisos: "warning",
  sem_alteracao: "info",
  bloqueada: "warning",
  falhou: "danger",
  em_andamento: "info",
  ignorada: "neutral",
};

export function resultVariant(r: SyncResultState): AlertVariant {
  if (r.code === CREDENTIALS_MISSING) return "danger";
  return (r.status && RESULT_VARIANT[r.status]) || (r.ok ? "success" : "danger");
}

export function resultTitle(r: SyncResultState): string {
  const what = r.action === "reprocess" ? "Reprocessamento" : "Sincronização";
  if (r.code === CREDENTIALS_MISSING) return "A integração com o SharePoint não está configurada no servidor";
  switch (r.status) {
    case "concluida":
      return `${what} concluída: dados aplicados`;
    case "concluida_com_avisos":
      return `${what} concluída com avisos: dados aplicados`;
    case "sem_alteracao":
      return `${what} sem alteração: a planilha oficial não mudou`;
    case "bloqueada":
      return `${what} bloqueada: nada foi aplicado`;
    case "falhou":
      return `${what} falhou: nada foi aplicado`;
    case "em_andamento":
      return "Já existe uma sincronização em andamento";
    case "ignorada":
      return `${what} não executada`;
    default:
      return r.ok ? `${what} concluída` : `Não foi possível concluir a ${what.toLowerCase()}`;
  }
}

/** O desfecho da última ação, com a mensagem do servidor e o caminho para o registro. */
export function SyncResultAlert({
  result, onOpenRun, onDismiss,
}: {
  result: SyncResultState;
  onOpenRun?: (runId: string) => void;
  onDismiss?: () => void;
}) {
  const credentials = result.code === CREDENTIALS_MISSING;
  return (
    <Alert
      variant={resultVariant(result)}
      onDismiss={onDismiss}
      dismissLabel="Dispensar o resultado"
      data-testid={`${TID}-result`}
      data-status={result.status ?? (result.ok ? "ok" : "erro")}
      data-code={result.code ?? undefined}
      action={
        result.runId && onOpenRun ? (
          <Button size="sm" variant="outline" onClick={() => onOpenRun(result.runId as string)} data-testid={`${TID}-result-open`}>
            Ver o registro da execução
          </Button>
        ) : undefined
      }
    >
      <AlertTitle>{resultTitle(result)}</AlertTitle>
      <AlertDescription>
        {credentials ? (
          <>
            <p>
              A sincronização precisa das variáveis do servidor <code className="font-mono text-caption">MS_GRAPH_TENANT_ID</code>,{" "}
              <code className="font-mono text-caption">MS_GRAPH_CLIENT_ID</code> e <code className="font-mono text-caption">MS_GRAPH_CLIENT_SECRET</code>{" "}
              (aplicativo do Microsoft Entra ID com leitura no site do SharePoint). Peça ao administrador da plataforma para configurá-las na hospedagem.
            </p>
            <p className="mt-1">Enquanto isso, use o envio manual (contingência), no fim desta página.</p>
          </>
        ) : (
          <p>{result.message}</p>
        )}
        <p className="mt-1 text-caption">
          {result.referenceDate ? `Dados de ${formatDate(result.referenceDate)}${result.sameDayRevision ? " · revisão do mesmo dia" : ""} · ` : ""}
          {formatStamp(result.at)}
        </p>
      </AlertDescription>
    </Alert>
  );
}
