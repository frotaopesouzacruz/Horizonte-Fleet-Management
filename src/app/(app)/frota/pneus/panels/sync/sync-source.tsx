"use client";

import { CloudDownload, ExternalLink, FileClock, FileSpreadsheet, Loader2, Settings2 } from "lucide-react";
import { cn } from "@/lib/cn";
import { Alert, AlertDescription, AlertTitle } from "@/components/feedback/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  BATCH_STATUS_LABEL,
  BATCH_STATUS_TONE,
  fmtInt,
  formatDate,
  formatStamp,
  plural,
  SYNC_RUN_STATUS_TONE,
  SYNC_STEP_LABEL,
  type TiresSyncOverview,
} from "@/lib/tires/types";
import type { TiresPanelContext } from "../../shared";
import { Fact, useTiresLink } from "../tires-ui";
import { cleanMessage, SOURCE_KIND_LABEL, syncStatusLabel, TID } from "./sync-common";

/**
 * Estado da fonte oficial (planilha do SharePoint): onde está, se a agenda
 * está ativa, como foi a última execução, o último erro e a próxima
 * execução — com "Sincronizar agora" para quem importa dados.
 */
export function SyncSource({
  sync, ctx, busy, onSync,
}: {
  sync: TiresSyncOverview;
  ctx: TiresPanelContext;
  busy: boolean;
  onSync: () => void;
}) {
  const link = useTiresLink(ctx);
  const s = sync.source;
  const running = sync.running;
  const canSync = ctx.perms.import;
  const paramsNav = ctx.perms.parameters ? link({ aba: "parametros", execucoes: null, execucao: null, lote: null, secao: null, filtro: null }) : null;
  const lastError = cleanMessage(s?.lastError);

  return (
    <section
      aria-labelledby={`${TID}-source-title`}
      aria-busy={busy || Boolean(running)}
      className="flex flex-col gap-4 rounded-lg border border-border bg-surface-raised p-4 shadow-card"
      data-testid={`${TID}-source`}
      data-status={s?.lastStatus ?? undefined}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-surface-interactive text-fg-secondary" aria-hidden>
            <CloudDownload className="size-4" />
          </span>
          <div className="flex min-w-0 flex-col gap-0.5">
            <p className="text-caption font-semibold tracking-wide text-fg-muted uppercase">Fonte oficial</p>
            <h2 id={`${TID}-source-title`} className="flex flex-wrap items-center gap-2 text-h4 font-semibold text-fg">
              <span className="min-w-0 break-words">{s?.name ?? "Planilha oficial do SharePoint"}</span>
              {s ? (
                <StatusBadge status={s.isActive ? "success" : "neutral"} size="sm" withIcon data-testid={`${TID}-source-state`}>
                  {s.isActive ? "Agenda ativa" : "Agenda pausada"}
                </StatusBadge>
              ) : null}
            </h2>
            <p className="text-caption text-fg-muted">
              {s
                ? s.isActive
                  ? `Próxima execução: ${s.scheduleLabel}.`
                  : "A agenda automática está pausada: a planilha só é lida quando alguém pede a sincronização."
                : "A fonte oficial ainda não foi configurada."}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {paramsNav ? (
            <Button asChild variant="ghost" size="sm">
              <a href={paramsNav.href} onClick={paramsNav.onClick} data-testid={`${TID}-configure`}>
                <Settings2 aria-hidden />
                Configurar a fonte
              </a>
            </Button>
          ) : null}
          {canSync ? (
            <Button
              leadingIcon={<CloudDownload />}
              loading={busy}
              disabled={busy || Boolean(running) || !s || ctx.pending}
              onClick={onSync}
              aria-describedby={`${TID}-now-hint`}
              data-testid={`${TID}-now`}
            >
              {busy ? "Sincronizando…" : "Sincronizar agora"}
            </Button>
          ) : null}
        </div>
      </div>

      {canSync ? (
        <p id={`${TID}-now-hint`} className="-mt-2 text-caption text-fg-muted" aria-live="polite" data-testid={`${TID}-now-hint`}>
          {busy
            ? "Sincronizando… conectando ao SharePoint, baixando e validando a planilha pelo pipeline oficial. Pode levar alguns minutos; mantenha a página aberta."
            : running
              ? "Há uma execução em andamento: aguarde a conclusão para pedir outra."
              : !s
                ? "Configure a fonte oficial em Parâmetros para sincronizar."
                : "Busca a planilha oficial agora, sem esperar a agenda. Se a versão do arquivo não mudou, nada é aplicado."}
        </p>
      ) : null}

      {running ? (
        <div
          className="flex items-start gap-2 rounded-md border border-progress-border bg-progress-soft px-3 py-2 text-body-sm text-progress-soft-fg"
          role="status"
          data-testid={`${TID}-running`}
        >
          <Loader2 className="mt-0.5 size-4 shrink-0 animate-spin motion-reduce:animate-none" aria-hidden />
          <span>
            Sincronização em andamento — etapa: <strong className="font-semibold">{SYNC_STEP_LABEL[running.step] ?? running.step}</strong>. Iniciada em{" "}
            {formatStamp(running.startedAt)}
            {running.requestedByName ? ` por ${running.requestedByName}` : ""}.
          </span>
        </div>
      ) : null}

      {s ? (
        <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2 xl:grid-cols-4">
          <Fact label="Arquivo" className="sm:col-span-2">
            <span className="block break-all font-medium">{s.filePath}</span>
            <span className="block text-caption [overflow-wrap:anywhere] text-fg-muted">
              Biblioteca {s.driveName} · site {s.siteHostname}
              {s.sitePath}
            </span>
            {s.webUrl ? (
              <a
                href={s.webUrl}
                target="_blank"
                rel="noreferrer noopener"
                className="mt-0.5 inline-flex items-center gap-1 rounded-xs text-caption font-medium text-link underline-offset-2 hover:underline hfm-focus-ring"
                data-testid={`${TID}-source-link`}
              >
                Abrir no SharePoint
                <ExternalLink className="size-3" aria-hidden />
                <span className="sr-only"> (abre em nova aba)</span>
              </a>
            ) : null}
          </Fact>
          <Fact label="Última sincronização">
            <span className="block tabular-nums">{formatStamp(s.lastAttemptAt)}</span>
            {s.lastStatus ? (
              <StatusBadge status={SYNC_RUN_STATUS_TONE[s.lastStatus] ?? "neutral"} size="sm" className="mt-0.5">
                {syncStatusLabel(s.lastStatus)}
              </StatusBadge>
            ) : (
              <span className="block text-caption text-fg-muted">nenhuma execução ainda</span>
            )}
          </Fact>
          <Fact label="Falhas consecutivas">
            <span className={cn("font-semibold tabular-nums", s.consecutiveFailures > 0 ? "text-danger" : "text-fg")}>
              {fmtInt(s.consecutiveFailures)}
            </span>
            {s.consecutiveFailures > 0 ? <span className="sr-only"> (atenção)</span> : null}
          </Fact>
          <Fact label="Último sucesso">
            <span className="tabular-nums">{formatStamp(s.lastSuccessAt)}</span>
          </Fact>
          <Fact label="Última alteração aplicada">
            <span className="tabular-nums">{formatStamp(s.lastChangeAt)}</span>
          </Fact>
          <Fact label="Versão do arquivo lida">
            <span className="block tabular-nums">{s.lastFileModifiedAt ? `modificado em ${formatStamp(s.lastFileModifiedAt)}` : "—"}</span>
            {s.lastEtag ? (
              <span className="block truncate font-mono text-caption text-fg-muted" title={s.lastEtag}>
                eTag {s.lastEtag}
              </span>
            ) : null}
          </Fact>
          <Fact label="Próxima execução">{s.isActive ? s.scheduleLabel : "Agenda pausada"}</Fact>
        </dl>
      ) : (
        <p className="text-body-sm text-fg-secondary">
          Sem a fonte oficial configurada, a base é atualizada só pelo envio manual (contingência).
          {ctx.perms.parameters ? " Informe o site, a biblioteca e o caminho da planilha em Parâmetros." : " Peça a configuração a quem gere os Parâmetros."}
        </p>
      )}

      {lastError ? (
        <Alert variant={s?.lastStatus === "bloqueada" ? "warning" : "danger"} data-testid={`${TID}-last-error`}>
          <AlertTitle>{s?.lastStatus === "bloqueada" ? "Última execução bloqueada" : "Último erro da sincronização"}</AlertTitle>
          <AlertDescription>{lastError}</AlertDescription>
        </Alert>
      ) : null}
    </section>
  );
}

/** Dados vigentes: o lote confirmado que os números da tela usam. */
export function SyncCurrent({ sync, ctx }: { sync: TiresSyncOverview; ctx: TiresPanelContext }) {
  const link = useTiresLink(ctx);
  const b = sync.currentBatch;
  const nav = b && ctx.perms.import ? link({ lote: b.id, secao: "changes", filtro: null }) : null;
  return (
    <section
      aria-labelledby={`${TID}-current-title`}
      className="flex min-w-0 flex-col gap-3 rounded-lg border border-border bg-surface-raised p-4 shadow-card"
      data-testid={`${TID}-current`}
    >
      <div className="flex items-start justify-between gap-2">
        <h2 id={`${TID}-current-title`} className="flex items-center gap-2 text-h4 font-semibold text-fg">
          <FileSpreadsheet className="size-4 text-fg-muted" aria-hidden />
          Dados vigentes
        </h2>
        {b ? (
          <Badge variant={b.sourceKind === "sharepoint" ? "info" : "neutral"} appearance="outline" size="md">
            {SOURCE_KIND_LABEL[b.sourceKind] ?? b.sourceKind}
          </Badge>
        ) : null}
      </div>
      {b ? (
        <>
          <p className="text-body-sm text-fg-secondary">
            Dados de <strong className="text-h3 font-semibold text-fg tabular-nums">{formatDate(b.referenceDate)}</strong>
            {b.supersedesBatchId ? (
              <Badge variant="progress" appearance="outline" size="sm" className="ml-2 align-middle">
                Revisão do mesmo dia
              </Badge>
            ) : null}
          </p>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2">
            <Fact label="Confirmado em">
              <span className="tabular-nums">{formatStamp(b.confirmedAt)}</span>
            </Fact>
            <Fact label="Confirmado por">{b.confirmedByName ?? "—"}</Fact>
            <Fact label="Arquivo" className="col-span-2">
              <span className="break-all">{b.fileName}</span>
            </Fact>
          </dl>
          <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4" aria-label="Comparação com os dados anteriores">
            <Count label="Pneus" value={b.totalRows} />
            <Count label={plural(b.newTires, "Novo", "Novos")} value={b.newTires} />
            <Count label={plural(b.updatedTires, "Alterado", "Alterados")} value={b.updatedTires} />
            <Count label={plural(b.absentTires, "Ausente", "Ausentes")} value={b.absentTires} />
          </ul>
          <p className="text-caption text-fg-muted">
            {fmtInt(b.unchangedTires)} sem mudança
            {b.reappearedTires > 0 ? ` · ${fmtInt(b.reappearedTires)} ${plural(b.reappearedTires, "reaparecido", "reaparecidos")}` : ""} ·{" "}
            {fmtInt(b.warningRows)} {plural(b.warningRows, "linha com aviso", "linhas com aviso")}
            {b.supersedesBatchId ? " · substituiu a versão anterior do mesmo dia (arquivada)" : ""}.
          </p>
          {nav ? (
            <a
              href={nav.href}
              onClick={nav.onClick}
              className="self-start rounded-xs text-caption font-medium text-link underline-offset-2 hover:underline hfm-focus-ring"
              data-testid={`${TID}-current-open`}
            >
              Ver o lote aplicado
            </a>
          ) : null}
        </>
      ) : (
        <p className="text-body-sm text-fg-muted">Nenhum dado confirmado ainda. A primeira sincronização (ou envio manual) confirmada aparece aqui.</p>
      )}
    </section>
  );
}

function Count({ label, value }: { label: string; value: number | null | undefined }) {
  return (
    <li className="flex flex-col rounded-md border border-border-subtle bg-surface px-3 py-2">
      <span className="text-caption text-fg-muted">{label}</span>
      <span className="text-body font-semibold text-fg tabular-nums">{fmtInt(value)}</span>
    </li>
  );
}

/** Lote aberto (validado, bloqueado ou recebendo linhas): aguarda decisão na prévia. */
export function SyncOpenBatch({ sync, ctx }: { sync: TiresSyncOverview; ctx: TiresPanelContext }) {
  const link = useTiresLink(ctx);
  const b = sync.openBatch;
  if (!b) {
    return (
      <section
        aria-labelledby={`${TID}-open-title`}
        className="flex min-w-0 flex-col gap-2 rounded-lg border border-border bg-surface-raised p-4 shadow-card"
        data-testid={`${TID}-open-batch`}
      >
        <h2 id={`${TID}-open-title`} className="flex items-center gap-2 text-h4 font-semibold text-fg">
          <FileClock className="size-4 text-fg-muted" aria-hidden />
          Lote aberto
        </h2>
        <p className="text-body-sm text-fg-muted">Nenhum lote aguardando decisão.</p>
      </section>
    );
  }
  const nav = ctx.perms.import ? link({ lote: b.id, secao: "issues", filtro: null }) : null;
  return (
    <section
      aria-labelledby={`${TID}-open-title`}
      className="flex min-w-0 flex-col gap-3 rounded-lg border border-border bg-surface-raised p-4 shadow-card"
      data-testid={`${TID}-open-batch`}
      data-status={b.status}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h2 id={`${TID}-open-title`} className="flex items-center gap-2 text-h4 font-semibold text-fg">
          <FileClock className="size-4 text-fg-muted" aria-hidden />
          Lote aberto
        </h2>
        <StatusBadge status={BATCH_STATUS_TONE[b.status] ?? "neutral"} size="sm" withIcon>
          {BATCH_STATUS_LABEL[b.status] ?? b.status}
        </StatusBadge>
      </div>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2">
        <Fact label="Arquivo" className="col-span-2">
          <span className="break-all">{b.fileName}</span>
        </Fact>
        <Fact label="Data dos dados">
          <span className="tabular-nums">{formatDate(b.referenceDate)}</span>
        </Fact>
        <Fact label="Origem">{SOURCE_KIND_LABEL[b.sourceKind] ?? b.sourceKind}</Fact>
        <Fact label="Recebido em">
          <span className="tabular-nums">{formatStamp(b.createdAt)}</span>
        </Fact>
        <Fact label="Linhas">
          <span className="tabular-nums">
            {fmtInt(b.totalRows)} · {fmtInt(b.warningRows)} {plural(b.warningRows, "aviso", "avisos")} ·{" "}
            <span className={cn(b.errorRows > 0 && "font-semibold text-danger")}>
              {fmtInt(b.errorRows)} {plural(b.errorRows, "erro", "erros")}
            </span>
          </span>
        </Fact>
      </dl>
      {b.blockReason ? <p className="text-caption text-danger">{cleanMessage(b.blockReason)}</p> : null}
      <p className="text-caption text-fg-muted">Um lote aberto não altera nada até ser confirmado; fica no histórico até a decisão.</p>
      {nav ? (
        <a
          href={nav.href}
          onClick={nav.onClick}
          className="self-start rounded-xs text-body-sm font-medium text-link underline-offset-2 hover:underline hfm-focus-ring"
          data-testid={`${TID}-open-batch-link`}
        >
          Abrir a prévia do lote
        </a>
      ) : null}
    </section>
  );
}

/** Estatística discreta dos últimos 30 dias. */
export function SyncStats({ sync }: { sync: TiresSyncOverview }) {
  const st = sync.stats30d;
  if (!st) return null;
  return (
    <p className="text-caption text-fg-muted" data-testid={`${TID}-stats`}>
      Últimos 30 dias: {fmtInt(st.runs)} {plural(st.runs, "execução", "execuções")} · {fmtInt(st.succeeded)}{" "}
      {plural(st.succeeded, "com dados aplicados", "com dados aplicados")} · {fmtInt(st.unchanged)} sem alteração · {fmtInt(st.blocked)}{" "}
      {plural(st.blocked, "bloqueada", "bloqueadas")} · {fmtInt(st.failed)} com falha.
    </p>
  );
}
