"use client";

import * as React from "react";
import Link from "next/link";
import { Camera, CheckCheck, ImageOff, Link2, RotateCcw, Wrench, XCircle } from "lucide-react";
import { cn } from "@/lib/cn";
import { Alert, AlertDescription, AlertTitle } from "@/components/feedback/alert";
import { useConfirm } from "@/components/feedback/confirm-dialog";
import { ErrorState } from "@/components/feedback/error-state";
import { LoadingState } from "@/components/feedback/loading-state";
import { useToast } from "@/components/feedback/toast";
import { ComponentStatusBadge, InspectionStatusBadge } from "@/components/mtsr/badges";
import { LinkMaintenanceDialog, OpenMaintenanceDialog } from "@/components/mtsr/maintenance-dialogs";
import { Button } from "@/components/ui/button";
import { Drawer, DrawerBody, DrawerContent, DrawerDescription, DrawerFooter, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  loadEvidenceUrls, loadInspectionDetail, rejectInspection, returnInspection, validateInspection, type Result,
} from "@/lib/mtsr/actions";
import {
  eventTypeLabel, fmtDays, fmtInt, formatDate, formatStamp, sourceTypeLabel, type MtsrInspectionDetail, type MtsrInspectionItem,
} from "@/lib/mtsr/types";
import type { MtsrPanelContext } from "../shared";
import { Fact, ReasonDialog, vehicleName } from "./mtsr-ui";

/**
 * Gaveta de uma vistoria recebida.
 *
 * Abre pela URL (`?vistoria=<id>`), lê `mtsr_inspection_detail` e as URLs
 * assinadas das fotos. Validar, retornar e rejeitar são rotinas do banco: a
 * gaveta só mostra o que elas devolvem (itens aplicados, pulados, NOK) e
 * oferece abrir ou vincular manutenção para item NOK sem manutenção.
 */
export function InspectionDrawer({ inspectionId, onClose, ctx }: { inspectionId: string | null; onClose: () => void; ctx: MtsrPanelContext }) {
  const open = Boolean(inspectionId);
  return (
    <Drawer open={open} onOpenChange={(o) => (!o ? onClose() : undefined)}>
      <DrawerContent size="xl" data-testid="mtsr-inspection-drawer">
        {inspectionId ? <DrawerInner key={inspectionId} inspectionId={inspectionId} ctx={ctx} onClose={onClose} /> : null}
      </DrawerContent>
    </Drawer>
  );
}

const SKIPPED_REASON: Record<string, string> = {
  backoffice: "Item não aplicado ao estado oficial: este componente é de backoffice — seu estado vem da fonte do backoffice, não da vistoria de campo.",
  stale: "Item não aplicado ao estado oficial: já havia leitura mais recente para o componente quando a vistoria foi validada.",
};

function DrawerInner({ inspectionId, ctx, onClose }: { inspectionId: string; ctx: MtsrPanelContext; onClose: () => void }) {
  const { toast } = useToast();
  const confirm = useConfirm();
  const [detail, setDetail] = React.useState<MtsrInspectionDetail | null>(null);
  const [urls, setUrls] = React.useState<Record<string, string>>({});
  const [urlsError, setUrlsError] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [loading, startLoad] = React.useTransition();
  const [busy, setBusy] = React.useState<"validate" | null>(null);
  const [reason, setReason] = React.useState<"return" | "reject" | null>(null);
  const [maint, setMaint] = React.useState<{ kind: "open" | "link"; item: MtsrInspectionItem } | null>(null);

  const load = React.useCallback(() => {
    startLoad(async () => {
      const [d, u] = await Promise.all([loadInspectionDetail(inspectionId), loadEvidenceUrls(inspectionId)]);
      if (!d.ok || !d.data) {
        setError(d.error ?? "Não foi possível abrir a vistoria.");
        setDetail(null);
      } else {
        setError(null);
        setDetail(d.data);
      }
      if (u.ok && u.data) {
        setUrls(u.data);
        setUrlsError(null);
      } else {
        setUrls({});
        setUrlsError(u.error ?? null);
      }
    });
  }, [inspectionId]);

  React.useEffect(() => {
    load();
  }, [load]);

  const done = () => {
    ctx.refresh();
    load();
  };

  const validate = async () => {
    if (!detail) return;
    const ok = await confirm({
      title: `Validar a vistoria ${detail.protocol}?`,
      description:
        "Cada item OK/NOK de componente de campo vira o estado oficial do veículo (itens de backoffice e leituras mais antigas que a atual são pulados). A última vistoria válida do veículo avança para a data desta vistoria.",
      confirmLabel: "Validar",
    });
    if (!ok) return;
    setBusy("validate");
    const r = await validateInspection(detail.id);
    setBusy(null);
    if (!r.ok || !r.data) {
      toast({ title: "Não foi possível validar", description: r.error, variant: "danger" });
      return;
    }
    const o = r.data;
    const parts = [
      `${fmtInt(o.applied)} ${o.applied === 1 ? "item aplicado" : "itens aplicados"}`,
      o.skipped ? `${fmtInt(o.skipped)} pulados (backoffice)` : null,
      o.skippedStale ? `${fmtInt(o.skippedStale)} pulados (leitura mais recente já existia)` : null,
      o.nok != null ? `${fmtInt(o.nok)} NOK` : null,
    ].filter(Boolean);
    toast({
      title: o.alreadyValidated ? `Vistoria ${o.protocol} já estava validada` : `Vistoria ${o.protocol} validada`,
      description: parts.join(" · "),
      variant: "success",
    });
    done();
  };

  if (loading) {
    return (
      <>
        <DrawerHeader>
          <DrawerTitle>Vistoria</DrawerTitle>
          <DrawerDescription>Carregando a vistoria e as fotos…</DrawerDescription>
        </DrawerHeader>
        <DrawerBody>
          <LoadingState variant="block" label="Carregando a vistoria…" />
        </DrawerBody>
      </>
    );
  }
  if (error || !detail) {
    return (
      <>
        <DrawerHeader>
          <DrawerTitle>Vistoria</DrawerTitle>
        </DrawerHeader>
        <DrawerBody>
          <ErrorState variant="panel" title="Não foi possível abrir a vistoria." description={error ?? undefined} onRetry={() => void load()} />
        </DrawerBody>
      </>
    );
  }

  const d = detail;
  const canValidate = Boolean(d.canValidate) && ctx.perms.validate;
  const canReturn = Boolean(d.canReturn) && ctx.perms.return;
  const canReject = Boolean(d.canReject) && ctx.perms.reject;
  const canOpenMaint = Boolean(d.canOpenMaintenance) && ctx.perms.maintenanceOpen;
  const canLinkMaint = ctx.perms.maintenanceLink;
  const events = [...d.events].sort((a, b) => (a.occurredAt < b.occurredAt ? 1 : -1));

  return (
    <>
      <DrawerHeader>
        <div className="flex flex-wrap items-center gap-2">
          <DrawerTitle>Vistoria {d.protocol}</DrawerTitle>
          <InspectionStatusBadge value={d.status} size="sm" />
          {d.nokCount > 0 ? <StatusBadge status="danger" size="sm">{fmtInt(d.nokCount)} NOK</StatusBadge> : null}
        </div>
        <DrawerDescription>
          {vehicleName(d.fleetCodeSnapshot, d.licensePlateSnapshot)} · {fmtInt(d.itemCount)} itens · {fmtInt(d.evidenceCount)} fotos
          {d.daysWaiting != null && d.status === "pendente_validacao" ? ` · aguardando há ${fmtDays(d.daysWaiting)}` : ""}
        </DrawerDescription>
      </DrawerHeader>

      <DrawerBody className="flex flex-col gap-5">
        {/* Contexto */}
        <section aria-label="Contexto da vistoria">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
            <Fact label="Operação">{d.operationNameSnapshot}</Fact>
            <Fact label="Cidade/UF">{[d.cityNameSnapshot, d.stateUfSnapshot].filter(Boolean).join("/") || "—"}</Fact>
            <Fact label="BR">{d.brCodeSnapshot}</Fact>
            <Fact label="Liderança">{d.leaderNameSnapshot}</Fact>
            <Fact label="Filial">{d.unitNameSnapshot}</Fact>
            <Fact label="Inspetor">
              {d.inspectorNameSnapshot ?? "—"}
              {d.inspectorCodeSnapshot ? <span className="text-fg-muted"> ({d.inspectorCodeSnapshot})</span> : null}
            </Fact>
            <Fact label="Data da vistoria">{formatDate(d.inspectionDate)}</Fact>
            <Fact label="Realizada em">{formatStamp(d.inspectedAt)}</Fact>
            <Fact label="Enviada em">{formatStamp(d.submittedAt)}</Fact>
            {d.reviewedAt ? (
              <>
                <Fact label="Decidida em">{formatStamp(d.reviewedAt)}</Fact>
                <Fact label="Decidida por">{d.reviewerNameSnapshot}</Fact>
                <Fact label="Motivo da decisão">{d.reviewReason}</Fact>
              </>
            ) : null}
            {d.contextDate ? <Fact label="Contexto do veículo em">{formatDate(d.contextDate)}</Fact> : null}
          </dl>
          {d.generalObservation ? (
            <p className="mt-3 rounded-md bg-surface-secondary px-3 py-2 text-body-sm text-fg-secondary">
              <span className="font-medium text-fg">Observação geral: </span>
              {d.generalObservation}
            </p>
          ) : null}
        </section>

        {/* Itens */}
        <section aria-label="Itens da vistoria" className="flex flex-col gap-2">
          <h3 className="text-h4 font-semibold text-fg">Itens</h3>
          {urlsError ? (
            <Alert variant="warning">
              <AlertTitle>Fotos indisponíveis</AlertTitle>
              <AlertDescription>{urlsError}</AlertDescription>
            </Alert>
          ) : null}
          <ul className="flex flex-col gap-2">
            {d.items.map((item) => (
              <li key={item.id} className="rounded-lg border border-border bg-surface-raised p-3" data-testid="mtsr-inspection-item" data-status={item.status}>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="flex min-w-0 flex-col gap-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold text-fg">{item.componentName}</span>
                      <StatusBadge status={item.status === "nok" ? "danger" : "success"} size="sm" withIcon>
                        {item.status === "nok" ? "NOK na vistoria" : "OK na vistoria"}
                      </StatusBadge>
                      {item.appliedAt ? <span className="text-caption text-fg-muted">aplicado em {formatStamp(item.appliedAt)}</span> : null}
                    </div>
                    {item.observation ? <p className="text-body-sm text-fg-secondary">{item.observation}</p> : null}
                    <p className="flex flex-wrap items-center gap-1.5 text-caption text-fg-muted">
                      Estado oficial atual:
                      <ComponentStatusBadge value={item.officialStatus} awaiting={item.awaitingRevalidation} size="sm" />
                      {item.officialReferenceDate ? <span>ref. {formatDate(item.officialReferenceDate)}</span> : null}
                      {item.officialSourceType ? <span>· {sourceTypeLabel(item.officialSourceType)}</span> : null}
                    </p>
                    {item.skippedReason ? (
                      <p className="text-caption text-warning-soft-fg">{SKIPPED_REASON[item.skippedReason] ?? `Item não aplicado (${item.skippedReason}).`}</p>
                    ) : null}
                  </div>
                  {item.status === "nok" ? (
                    <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                      {item.maintenance ? (
                        <Button asChild size="sm" variant="secondary">
                          <Link href={`/frota/manutencao?m=${item.maintenance.id}`} data-testid="mtsr-item-maintenance">
                            <Wrench aria-hidden />
                            {item.maintenance.code} · {item.maintenance.label}
                          </Link>
                        </Button>
                      ) : (
                        <>
                          {canOpenMaint ? (
                            <Button size="sm" variant="primary" leadingIcon={<Wrench />} onClick={() => setMaint({ kind: "open", item })} data-testid="mtsr-item-open-maintenance">
                              Abrir manutenção
                            </Button>
                          ) : null}
                          {canLinkMaint ? (
                            <Button size="sm" variant="secondary" leadingIcon={<Link2 />} onClick={() => setMaint({ kind: "link", item })} data-testid="mtsr-item-link-maintenance">
                              Vincular manutenção existente
                            </Button>
                          ) : null}
                        </>
                      )}
                    </div>
                  ) : null}
                </div>
                {item.evidence.length > 0 ? (
                  <ul className="mt-2 flex flex-wrap gap-2" aria-label={`Fotos de ${item.componentName}`}>
                    {item.evidence.map((ev) => {
                      const url = ev.purgedAt ? null : urls[ev.storagePath];
                      return (
                        <li key={ev.id}>
                          {ev.purgedAt ? (
                            <span className="flex size-24 flex-col items-center justify-center gap-1 rounded-md border border-dashed border-border bg-surface-sunken p-1 text-center text-[11px] text-fg-muted">
                              <ImageOff className="size-4" aria-hidden />
                              foto expurgada pela retenção
                            </span>
                          ) : url ? (
                            <a href={url} target="_blank" rel="noreferrer" className="block rounded-md hfm-focus-ring" title={`Abrir foto (${formatStamp(ev.capturedAt)})`}>
                              {/* eslint-disable-next-line @next/next/no-img-element -- URL assinada, temporária, fora do otimizador */}
                              <img src={url} alt={`Foto de ${item.componentName}${ev.capturedAt ? ` em ${formatStamp(ev.capturedAt)}` : ""}`} className="size-24 rounded-md border border-border object-cover" loading="lazy" />
                            </a>
                          ) : (
                            <span className="flex size-24 flex-col items-center justify-center gap-1 rounded-md border border-dashed border-border bg-surface-sunken p-1 text-center text-[11px] text-fg-muted">
                              <Camera className="size-4" aria-hidden />
                              foto indisponível
                            </span>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                ) : item.evidenceCount > 0 ? (
                  <p className="mt-2 text-caption text-fg-muted">{fmtInt(item.evidenceCount)} fotos registradas.</p>
                ) : null}
              </li>
            ))}
          </ul>
        </section>

        {/* Linha do tempo */}
        <section aria-label="Linha do tempo" className="flex flex-col gap-2">
          <h3 className="text-h4 font-semibold text-fg">Linha do tempo</h3>
          {events.length === 0 ? (
            <p className="text-body-sm text-fg-muted">Nenhum evento registrado.</p>
          ) : (
            <ol className="flex flex-col gap-2 border-l border-border pl-4">
              {events.map((ev) => (
                <li key={ev.id} className="relative text-body-sm">
                  <span aria-hidden className="absolute -left-[1.3rem] top-1.5 size-2 rounded-full bg-primary" />
                  <span className="font-medium text-fg">{eventTypeLabel(ev.eventType)}</span>
                  <span className="text-fg-muted"> · {formatStamp(ev.occurredAt)}</span>
                  {ev.actorName ? <span className="text-fg-muted"> · {ev.actorName}</span> : null}
                  {ev.reason ? <p className="text-fg-secondary">{ev.reason}</p> : null}
                </li>
              ))}
            </ol>
          )}
        </section>
      </DrawerBody>

      {canValidate || canReturn || canReject ? (
        <DrawerFooter className="sm:justify-between">
          <div className="flex flex-wrap gap-2">
            {canReject ? (
              <Button variant="danger" leadingIcon={<XCircle />} onClick={() => setReason("reject")} disabled={busy != null} data-testid="mtsr-reject">
                Rejeitar
              </Button>
            ) : null}
            {canReturn ? (
              <Button variant="outline" leadingIcon={<RotateCcw />} onClick={() => setReason("return")} disabled={busy != null} data-testid="mtsr-return">
                Retornar ao inspetor
              </Button>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="ghost" onClick={onClose} disabled={busy != null}>
              Fechar
            </Button>
            {canValidate ? (
              <Button variant="primary" leadingIcon={<CheckCheck />} onClick={validate} loading={busy === "validate"} data-testid="mtsr-validate">
                Validar
              </Button>
            ) : null}
          </div>
        </DrawerFooter>
      ) : (
        <DrawerFooter>
          <Button variant="ghost" onClick={onClose}>Fechar</Button>
        </DrawerFooter>
      )}

      <ReasonDialog
        open={reason === "return"}
        onOpenChange={(o) => (!o ? setReason(null) : undefined)}
        title={`Retornar a vistoria ${d.protocol}?`}
        description="A vistoria volta ao inspetor com o motivo; nada muda no estado oficial dos componentes."
        confirmLabel="Retornar"
        successTitle="Vistoria retornada ao inspetor"
        onConfirm={(r) => returnInspection(d.id, r) as Promise<Result<unknown>>}
        onDone={done}
        testId="mtsr-return-dialog"
      />
      <ReasonDialog
        open={reason === "reject"}
        onOpenChange={(o) => (!o ? setReason(null) : undefined)}
        title={`Rejeitar a vistoria ${d.protocol}?`}
        description="A vistoria é descartada com o motivo e não entra no estado oficial. Esta decisão fica na trilha."
        confirmLabel="Rejeitar"
        destructive
        successTitle="Vistoria rejeitada"
        onConfirm={(r) => rejectInspection(d.id, r) as Promise<Result<unknown>>}
        onDone={done}
        testId="mtsr-reject-dialog"
      />

      {maint?.kind === "open" ? (
        <OpenMaintenanceDialog
          open
          onOpenChange={(o) => (!o ? setMaint(null) : undefined)}
          vehicleId={d.vehicleId}
          componentId={maint.item.componentId}
          componentName={maint.item.componentName}
          inspectionItemId={maint.item.id}
          onDone={() => {
            setMaint(null);
            done();
          }}
        />
      ) : null}
      {maint?.kind === "link" ? (
        <LinkMaintenanceDialog
          open
          onOpenChange={(o) => (!o ? setMaint(null) : undefined)}
          vehicleId={d.vehicleId}
          componentId={maint.item.componentId}
          componentName={maint.item.componentName}
          inspectionItemId={maint.item.id}
          onDone={() => {
            setMaint(null);
            done();
          }}
        />
      ) : null}
      <span className={cn("sr-only")} aria-live="polite">{busy === "validate" ? "Validando a vistoria…" : ""}</span>
    </>
  );
}
