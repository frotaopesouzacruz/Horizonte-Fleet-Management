"use client";

import * as React from "react";
import { AlertTriangle, ChevronRight, ExternalLink, History, Info, RotateCcw, XCircle } from "lucide-react";
import { cn } from "@/lib/cn";
import { ConfirmDialog } from "@/components/feedback/confirm-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Drawer, DrawerBody, DrawerContent, DrawerDescription, DrawerFooter, DrawerHeader, DrawerTitle,
} from "@/components/ui/drawer";
import { Pagination } from "@/components/ui/pagination";
import { StatusBadge } from "@/components/ui/status-badge";
import { Table, TableBody, TableCell, TableContainer, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { reprocessTireSync } from "@/lib/tires/actions";
import { RODOPAR_FIELD_LABEL } from "@/lib/tires/rodopar-sheet";
import {
  fmtInt,
  formatDate,
  formatStamp,
  plural,
  SYNC_RUN_STATUS_TONE,
  SYNC_STEP_LABEL,
  SYNC_TRIGGER_LABEL,
  type TireSyncLogEntry,
  type TireSyncRun,
  type TiresSyncOverview,
} from "@/lib/tires/types";
import type { TiresPanelContext } from "../../shared";
import { currentPage, Fact, PanelEmpty, Section, useTiresLink, useViewParam } from "../tires-ui";
import {
  cleanMessage, connectionLost, CREDENTIALS_MISSING, fmtBytes, fmtClock, fmtDuration, syncStatusLabel, TID, toSyncResult, type SyncResultState,
} from "./sync-common";

const COUNTER_LABEL: [keyof TireSyncRun["counters"], string][] = [
  ["rows", "Linhas lidas"],
  ["valid", "Válidas"],
  ["warnings", "Com aviso"],
  ["errors", "Com erro"],
  ["new", "Novos"],
  ["updated", "Alterados"],
  ["unchanged", "Sem mudança"],
  ["absent", "Ausentes"],
  ["reappeared", "Reaparecidos"],
  ["snapshots", "Pneus nos dados"],
  ["events", "Eventos gerados"],
  ["removedInRevision", "Retirados na revisão"],
];

const FAILED = new Set(["bloqueada", "falhou"]);
const isError = (r: TireSyncRun) => FAILED.has(r.status);
const n = (v: number | null | undefined) => (v == null ? "—" : fmtInt(v));

/**
 * Histórico de sincronizações (`?execucoes=` pagina no servidor) e o detalhe
 * de uma execução numa gaveta (`?execucao=`): log por etapa, estrutura da
 * planilha, arquivo e hash. Execuções bloqueadas ou com falha podem ser
 * reprocessadas por quem importa dados (`tire_sync` com reprocessamento).
 */
export function SyncRuns({
  sync, ctx, onResult,
}: {
  sync: TiresSyncOverview;
  ctx: TiresPanelContext;
  onResult: (r: SyncResultState) => void;
}) {
  const [openId, setOpenId] = useViewParam("execucao");
  const page = currentPage(ctx, "execucoes");
  const all = sync.running && !sync.runs.some((r) => r.id === sync.running?.id) ? [sync.running, ...sync.runs] : sync.runs;
  const selected = openId ? (all.find((r) => r.id === openId) ?? null) : null;

  return (
    <Section
      title="Histórico de sincronizações"
      testId={`${TID}-runs-section`}
      description={
        <>
          {fmtInt(sync.total)} {plural(sync.total, "execução registrada", "execuções registradas")}, da mais recente para a mais antiga. Clique numa
          execução para ver o log por etapa, a estrutura da planilha e o arquivo lido.
        </>
      }
    >
      {all.length === 0 ? (
        <PanelEmpty
          icon={<History />}
          title="Nenhuma sincronização registrada"
          description="A primeira execução (agendada ou pedida em Sincronizar agora) aparece aqui, com o arquivo lido, os contadores e o log."
          testId={`${TID}-runs-empty`}
        />
      ) : (
        <TableContainer data-testid={`${TID}-runs`}>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Início</TableHead>
                <TableHead>Gatilho</TableHead>
                <TableHead>Situação</TableHead>
                <TableHead className="min-w-[13rem]">Arquivo</TableHead>
                <TableHead>Data dos dados</TableHead>
                <TableHead className="min-w-[12rem]">Linhas · pneus</TableHead>
                <TableHead className="min-w-[16rem]">Resultado</TableHead>
                <TableHead>
                  <span className="sr-only">Detalhe</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {all.map((r) => (
                <RunRow key={r.id} run={r} selected={r.id === openId} onOpen={() => setOpenId(r.id)} />
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      {sync.total > sync.limit ? (
        <Pagination
          page={page}
          pageSize={sync.limit}
          total={sync.total}
          disabled={ctx.pending}
          label="Paginação do histórico de sincronizações"
          onPageChange={(p) => ctx.navigate({ execucoes: p > 1 ? String(p) : null, execucao: null })}
          data-testid={`${TID}-runs-pagination`}
        />
      ) : null}

      <RunDetail
        run={selected}
        requestedId={openId}
        ctx={ctx}
        onClose={() => setOpenId(null)}
        onOpenRun={setOpenId}
        onResult={onResult}
      />
    </Section>
  );
}

function RunRow({ run: r, selected, onOpen }: { run: TireSyncRun; selected: boolean; onOpen: () => void }) {
  const c = r.counters ?? {};
  const message = cleanMessage(r.errorMessage);
  return (
    <TableRow
      selected={selected}
      className="cursor-pointer align-top"
      onClick={onOpen}
      data-testid={`${TID}-run`}
      data-status={r.status}
      data-trigger={r.trigger}
    >
      <TableCell className="py-2 whitespace-nowrap tabular-nums">
        <span className="block font-medium text-fg">{formatStamp(r.startedAt)}</span>
        <span className="block text-caption text-fg-muted">
          {r.status === "em_andamento" ? (SYNC_STEP_LABEL[r.step] ?? r.step) : `duração ${fmtDuration(r.startedAt, r.finishedAt)}`}
        </span>
      </TableCell>
      <TableCell className="py-2">
        <span className="block whitespace-nowrap text-fg">{SYNC_TRIGGER_LABEL[r.trigger] ?? r.trigger}</span>
        <span className="block max-w-[11rem] truncate text-caption text-fg-muted" title={r.requestedByName ?? undefined}>
          {r.requestedByName ?? (r.trigger === "agendada" ? "Sincronização automática" : "—")}
        </span>
      </TableCell>
      <TableCell className="py-2 whitespace-nowrap">
        <StatusBadge status={SYNC_RUN_STATUS_TONE[r.status] ?? "neutral"} size="sm" withIcon>
          {syncStatusLabel(r.status)}
        </StatusBadge>
        {r.reprocessOf ? <span className="mt-0.5 block text-caption text-fg-muted">reprocessamento</span> : null}
      </TableCell>
      <TableCell className="py-2">
        {r.fileName ? (
          <>
            <span className="block max-w-[16rem] truncate font-medium text-fg" title={r.fileName}>{r.fileName}</span>
            <span className="block text-caption text-fg-muted tabular-nums">
              {r.fileLastModified ? `modificado em ${formatStamp(r.fileLastModified)}` : "—"}
            </span>
            {r.fileEtag ? (
              <span className="block max-w-[16rem] truncate font-mono text-caption text-fg-muted" title={r.fileEtag}>eTag {r.fileEtag}</span>
            ) : null}
          </>
        ) : (
          <span className="text-fg-muted">arquivo não lido</span>
        )}
      </TableCell>
      <TableCell className="py-2 whitespace-nowrap tabular-nums">
        <span className="block text-fg">{formatDate(r.referenceDate)}</span>
        {r.sameDayRevision ? (
          <Badge variant="progress" appearance="outline" size="sm" className="mt-0.5">Revisão do mesmo dia</Badge>
        ) : null}
      </TableCell>
      <TableCell className="py-2 text-caption tabular-nums">
        {c.rows == null && c.new == null ? (
          <span className="text-fg-muted">—</span>
        ) : (
          <>
            <span className="block text-fg">
              {n(c.rows)} linhas · {n(c.new)} {plural(c.new, "novo", "novos")} · {n(c.updated)} {plural(c.updated, "alterado", "alterados")}
            </span>
            <span className="block text-fg-muted">
              {n(c.absent)} {plural(c.absent, "ausente", "ausentes")} · {n(c.warnings)} {plural(c.warnings, "aviso", "avisos")} ·{" "}
              <span className={cn((c.errors ?? 0) > 0 && "font-semibold text-danger")}>
                {n(c.errors)} {plural(c.errors, "erro", "erros")}
              </span>
            </span>
          </>
        )}
      </TableCell>
      <TableCell className="py-2">
        {message ? (
          <span
            className={cn("line-clamp-2 block max-w-[24rem] text-caption", isError(r) ? "text-danger" : "text-fg-secondary")}
            title={message}
          >
            {isError(r) ? <span className="sr-only">Erro: </span> : null}
            {message}
          </span>
        ) : (
          <span className="text-fg-muted">—</span>
        )}
      </TableCell>
      <TableCell className="py-2 text-right">
        <Button
          size="sm"
          variant="ghost"
          trailingIcon={<ChevronRight />}
          onClick={(e) => {
            e.stopPropagation();
            onOpen();
          }}
          aria-label={`Ver o detalhe da execução de ${formatStamp(r.startedAt)}`}
        >
          Detalhe
        </Button>
      </TableCell>
    </TableRow>
  );
}

// ---------------------------------------------------------------------------
// Detalhe da execução (gaveta)
// ---------------------------------------------------------------------------
const LEVEL: Record<TireSyncLogEntry["level"], { label: string; icon: React.ReactNode; className: string }> = {
  info: { label: "Info", icon: <Info className="size-3.5" aria-hidden />, className: "text-fg-muted" },
  warning: { label: "Aviso", icon: <AlertTriangle className="size-3.5" aria-hidden />, className: "text-warning-soft-fg" },
  error: { label: "Erro", icon: <XCircle className="size-3.5" aria-hidden />, className: "text-danger" },
};

const fieldLabel = (key: string) => RODOPAR_FIELD_LABEL[key] ?? key;

function RunDetail({
  run, requestedId, ctx, onClose, onOpenRun, onResult,
}: {
  run: TireSyncRun | null;
  requestedId: string | null;
  ctx: TiresPanelContext;
  onClose: () => void;
  onOpenRun: (id: string) => void;
  onResult: (r: SyncResultState) => void;
}) {
  const link = useTiresLink(ctx);
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const canReprocess = Boolean(run && ctx.perms.import && isError(run));

  const reprocess = async () => {
    if (!run) return;
    let result: SyncResultState;
    try {
      result = toSyncResult("reprocess", await reprocessTireSync(run.id));
    } catch {
      result = connectionLost("reprocess");
    }
    setConfirmOpen(false);
    onResult(result);
    onClose();
    ctx.refresh();
  };

  const st = run?.structure ?? {};
  const c = run?.counters ?? {};
  const log = run?.log ?? [];
  const batchNav = run?.batchId && ctx.perms.import ? link({ lote: run.batchId, secao: "issues", filtro: null, execucao: null }) : null;
  const message = cleanMessage(run?.errorMessage);

  return (
    <Drawer open={Boolean(requestedId)} onOpenChange={(o) => (!o ? onClose() : undefined)}>
      <DrawerContent size="lg" data-testid={`${TID}-run-detail`} data-status={run?.status}>
        <DrawerHeader>
          <DrawerTitle className="flex flex-wrap items-center gap-2">
            {run ? `Execução de ${formatStamp(run.startedAt)}` : "Execução não encontrada"}
            {run ? (
              <StatusBadge status={SYNC_RUN_STATUS_TONE[run.status] ?? "neutral"} size="sm" withIcon>
                {syncStatusLabel(run.status)}
              </StatusBadge>
            ) : null}
          </DrawerTitle>
          <DrawerDescription>
            {run
              ? `${SYNC_TRIGGER_LABEL[run.trigger] ?? run.trigger}${run.requestedByName ? ` · ${run.requestedByName}` : ""} · duração ${fmtDuration(run.startedAt, run.finishedAt)}`
              : "A execução indicada no endereço não está nesta página do histórico. Volte à primeira página ou escolha outra execução."}
          </DrawerDescription>
        </DrawerHeader>

        {run ? (
          <DrawerBody className="flex flex-col gap-5">
            {message ? (
              <div
                className={cn(
                  "rounded-md border px-3 py-2 text-body-sm",
                  isError(run) ? "border-danger-border bg-danger-soft text-danger-soft-fg" : "border-border bg-surface text-fg-secondary",
                )}
                role={isError(run) ? "alert" : undefined}
              >
                <p className="font-semibold">{isError(run) ? "Erro" : "Resultado"}</p>
                <p>{message}</p>
                {run.errorCode === CREDENTIALS_MISSING ? (
                  <p className="mt-1">
                    A integração precisa das variáveis do servidor (credenciais do aplicativo no Microsoft Entra ID). Peça a configuração ao
                    administrador da plataforma; enquanto isso, use o envio manual (contingência).
                  </p>
                ) : null}
                {run.errorCode ? <p className="mt-0.5 font-mono text-caption">código {run.errorCode}</p> : null}
              </div>
            ) : null}

            <DetailBlock title="Execução">
              <dl className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3">
                <Fact label="Início"><span className="tabular-nums">{formatStamp(run.startedAt)}</span></Fact>
                <Fact label="Fim"><span className="tabular-nums">{formatStamp(run.finishedAt)}</span></Fact>
                <Fact label="Etapa">{SYNC_STEP_LABEL[run.step] ?? run.step}</Fact>
                <Fact label="Data dos dados"><span className="tabular-nums">{formatDate(run.referenceDate)}</span></Fact>
                <Fact label="Revisão do mesmo dia">{run.sameDayRevision ? "Sim (a versão anterior do dia fica arquivada)" : "Não"}</Fact>
                <Fact label="Lote">
                  {batchNav ? (
                    <a href={batchNav.href} onClick={batchNav.onClick} className="rounded-xs text-link underline-offset-2 hover:underline hfm-focus-ring">
                      Abrir a prévia do lote
                    </a>
                  ) : run.batchId ? (
                    "registrado"
                  ) : (
                    "—"
                  )}
                </Fact>
                {run.reprocessOf ? (
                  <Fact label="Reprocessa">
                    <button
                      type="button"
                      onClick={() => onOpenRun(run.reprocessOf as string)}
                      className="rounded-xs text-left text-link underline-offset-2 hover:underline hfm-focus-ring"
                    >
                      a execução original
                    </button>
                  </Fact>
                ) : null}
              </dl>
            </DetailBlock>

            <DetailBlock title="Arquivo lido">
              <dl className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3">
                <Fact label="Nome" className="col-span-2 sm:col-span-3">
                  <span className="break-all">{run.fileName ?? "—"}</span>
                  {run.fileWebUrl ? (
                    <a
                      href={run.fileWebUrl}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="mt-0.5 flex w-fit items-center gap-1 rounded-xs text-caption font-medium text-link underline-offset-2 hover:underline hfm-focus-ring"
                    >
                      Abrir no SharePoint
                      <ExternalLink className="size-3" aria-hidden />
                      <span className="sr-only"> (abre em nova aba)</span>
                    </a>
                  ) : null}
                </Fact>
                <Fact label="Modificado em"><span className="tabular-nums">{formatStamp(run.fileLastModified)}</span></Fact>
                <Fact label="Tamanho"><span className="tabular-nums">{fmtBytes(run.fileSize)}</span></Fact>
                <Fact label="eTag"><span className="break-all font-mono text-caption">{run.fileEtag ?? "—"}</span></Fact>
                <Fact label="Assinatura (SHA-256)" className="col-span-2 sm:col-span-3">
                  <span className="break-all font-mono text-caption" data-testid={`${TID}-run-hash`}>{run.fileHash ?? "—"}</span>
                </Fact>
              </dl>
            </DetailBlock>

            <DetailBlock title="Contadores">
              <dl className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
                {COUNTER_LABEL.map(([key, label]) => (
                  <Fact key={key} label={label}>
                    <span className={cn("tabular-nums", key === "errors" && (c.errors ?? 0) > 0 && "font-semibold text-danger")}>{n(c[key])}</span>
                  </Fact>
                ))}
              </dl>
            </DetailBlock>

            <DetailBlock title="Estrutura da planilha" testId={`${TID}-run-structure`}>
              {st.error ? <p className="text-body-sm text-danger">{cleanMessage(st.error)}</p> : null}
              <dl className="grid grid-cols-2 gap-x-4 gap-y-2">
                <Fact label="Aba">{st.sheetName ?? "—"}</Fact>
                <Fact label="Linhas de pneus"><span className="tabular-nums">{n(st.rows)}</span></Fact>
              </dl>
              <ColumnList title="Colunas oficiais ausentes" items={(st.missingColumns ?? []).map(fieldLabel)} variant="danger" empty="nenhuma" />
              <ColumnList title="Colunas não reconhecidas (ignoradas)" items={st.unrecognizedColumns ?? []} variant="warning" empty="nenhuma" />
              <ColumnList title="Colunas reconhecidas" items={(st.recognizedColumns ?? []).map(fieldLabel)} variant="info" empty="—" />
            </DetailBlock>

            <DetailBlock title="Log por etapa" testId={`${TID}-run-log`}>
              {log.length === 0 ? (
                <p className="text-body-sm text-fg-muted">Sem registros de etapa.</p>
              ) : (
                <ol className="flex flex-col divide-y divide-border-subtle rounded-md border border-border bg-surface">
                  {log.map((e, i) => {
                    const lv = LEVEL[e.level] ?? LEVEL.info;
                    return (
                      <li key={`${e.at}-${i}`} className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 px-3 py-2" data-level={e.level}>
                        <span className="pt-0.5 font-mono text-caption text-fg-muted tabular-nums">{fmtClock(e.at)}</span>
                        <span className="flex min-w-0 flex-col gap-0.5">
                          <span className="flex flex-wrap items-center gap-2 text-caption">
                            <span className="font-semibold text-fg-secondary">{SYNC_STEP_LABEL[e.step] ?? e.step}</span>
                            <span className={cn("inline-flex items-center gap-1 font-medium", lv.className)}>
                              {lv.icon}
                              {lv.label}
                            </span>
                          </span>
                          <span className="text-body-sm text-fg">{cleanMessage(e.message) ?? "—"}</span>
                        </span>
                      </li>
                    );
                  })}
                </ol>
              )}
            </DetailBlock>
          </DrawerBody>
        ) : (
          <DrawerBody>
            <p className="text-body-sm text-fg-muted">Nada a mostrar.</p>
          </DrawerBody>
        )}

        {canReprocess && run ? (
          <DrawerFooter>
            <p className="text-caption text-fg-muted sm:mr-auto sm:self-center">
              Baixa e revalida a planilha de novo, mesmo sem mudança de versão. Fica registrado como reprocessamento.
            </p>
            <Button
              variant="secondary"
              leadingIcon={<RotateCcw />}
              onClick={() => setConfirmOpen(true)}
              disabled={ctx.pending}
              data-testid={`${TID}-reprocess`}
            >
              Reprocessar
            </Button>
          </DrawerFooter>
        ) : null}
      </DrawerContent>

      {run ? (
        <ConfirmDialog
          open={confirmOpen}
          onOpenChange={setConfirmOpen}
          title="Reprocessar esta execução?"
          description={`A planilha oficial é baixada e validada de novo pelo pipeline oficial, mesmo que a versão do arquivo não tenha mudado. A execução de ${formatStamp(run.startedAt)} (${syncStatusLabel(run.status).toLowerCase()}) continua no histórico; a nova fica registrada como reprocessamento.`}
          confirmLabel="Reprocessar agora"
          cancelLabel="Cancelar"
          icon={<RotateCcw />}
          onConfirm={reprocess}
        >
          <p className="text-caption text-fg-muted" data-testid={`${TID}-reprocess-note`}>
            Se a causa do bloqueio ou da falha ainda existir (coluna ausente, credenciais, arquivo indisponível), o resultado será o mesmo. Corrija a
            origem antes de reprocessar.
          </p>
        </ConfirmDialog>
      ) : null}
    </Drawer>
  );
}

function DetailBlock({ title, children, testId }: { title: string; children: React.ReactNode; testId?: string }) {
  return (
    <section className="flex flex-col gap-2" data-testid={testId}>
      <h3 className="text-label font-semibold text-fg">{title}</h3>
      {children}
    </section>
  );
}

function ColumnList({ title, items, variant, empty }: { title: string; items: string[]; variant: "danger" | "warning" | "info"; empty: string }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-caption font-semibold text-fg-secondary">
        {title} ({fmtInt(items.length)})
      </span>
      {items.length ? (
        <ul className="flex flex-wrap gap-1.5" aria-label={title}>
          {items.map((h, i) => (
            <li key={`${h}-${i}`}>
              <Badge variant={variant} size="sm">{h}</Badge>
            </li>
          ))}
        </ul>
      ) : (
        <span className="text-caption text-fg-muted">{empty}</span>
      )}
    </div>
  );
}
