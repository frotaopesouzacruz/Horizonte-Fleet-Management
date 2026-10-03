"use client";

import * as React from "react";
import { ChevronRight, History, ImageOff } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/ui/status-badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/feedback/alert";
import { EmptyState } from "@/components/feedback/empty-state";
import { ErrorState } from "@/components/feedback/error-state";
import { LoadingState } from "@/components/feedback/loading-state";
import { ComponentStatusBadge, InspectionStatusBadge } from "@/components/mtsr/badges";
import type { loadOwnEvidenceUrls, loadOwnInspection } from "@/lib/mtsr/app-actions";
import { fmtDays, fmtInt, formatDate, formatStamp, sourceTypeLabel, type MtsrInspectionDetail } from "@/lib/mtsr/types";
import { AppTopBar } from "./inspection-runner";

/**
 * "Minhas vistorias": a lista do que a pessoa enviou e o detalhe de cada uma.
 *
 * O detalhe mostra o que a rotina decide mostrar — itens com o status que a
 * pessoa registrou, o estado OFICIAL do componente (que só muda depois da
 * validação), a situação da vistoria e o motivo quando foi retornada ou
 * rejeitada. As fotos vêm por URL assinada curta; as já expurgadas pela
 * retenção aparecem como texto.
 */
export interface DetailLoaders {
  loadOwnInspection: typeof loadOwnInspection;
  loadOwnEvidenceUrls: typeof loadOwnEvidenceUrls;
}

export function MyInspectionsList({
  history,
  onOpen,
  limit,
}: {
  history: MtsrInspectionDetail[];
  onOpen: (id: string) => void;
  limit?: number;
}) {
  const rows = limit ? history.slice(0, limit) : history;
  if (rows.length === 0) {
    return (
      <EmptyState
        size="sm"
        variant="panel"
        icon={<History />}
        title="Nenhuma vistoria enviada ainda"
        description="As vistorias que você enviar aparecem aqui com o protocolo e a situação da validação."
        data-testid="mtsr-app-history"
      />
    );
  }
  return (
    <ul className="flex flex-col gap-2" data-testid="mtsr-app-history">
      {rows.map((item) => (
        <li key={item.id}>
          <button
            type="button"
            data-testid="mtsr-app-history-item"
            onClick={() => onOpen(item.id)}
            className="flex min-h-16 w-full items-center gap-3 rounded-lg border border-border bg-surface-raised p-4 text-left shadow-card hfm-transition hover:border-border-strong hover:shadow-card-hover hfm-focus-ring"
          >
            <span className="min-w-0 flex-1">
              <span className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-body-sm font-semibold text-fg">{item.protocol}</span>
                <InspectionStatusBadge value={item.status} size="sm" />
              </span>
              <span className="mt-1 block text-body font-semibold text-fg">
                {item.licensePlateSnapshot}
                {item.fleetCodeSnapshot ? <span className="font-normal text-fg-muted"> · Frota {item.fleetCodeSnapshot}</span> : null}
              </span>
              <span className="block text-caption text-fg-muted">
                {formatDate(item.inspectionDate)} · {fmtInt(item.itemCount)} {item.itemCount === 1 ? "item" : "itens"}
                {item.evidenceCount > 0 ? ` · ${fmtInt(item.evidenceCount)} ${item.evidenceCount === 1 ? "foto" : "fotos"}` : ""}
              </span>
            </span>
            {item.nokCount > 0 ? (
              <Badge variant="danger" appearance="soft">
                {fmtInt(item.nokCount)} NOK
              </Badge>
            ) : (
              <Badge variant="success" appearance="soft">
                Sem NOK
              </Badge>
            )}
            <ChevronRight className="size-5 shrink-0 text-fg-muted" aria-hidden />
          </button>
        </li>
      ))}
    </ul>
  );
}

/* -------------------------------------------------------------------------- */

type DetailState =
  | { status: "loading" }
  | { status: "error"; error: string }
  | { status: "ready"; detail: MtsrInspectionDetail; urls: Record<string, string>; urlsError: string | null };

export function InspectionDetailScreen({
  inspectionId,
  loaders,
  onBack,
}: {
  inspectionId: string;
  loaders: DetailLoaders;
  onBack: () => void;
}) {
  const [state, setState] = React.useState<DetailState>({ status: "loading" });
  const [attempt, setAttempt] = React.useState(0);

  React.useEffect(() => {
    let active = true;
    loaders
      .loadOwnInspection(inspectionId)
      .then((detail) => {
        if (!active) return;
        if (!detail.ok || !detail.data) {
          setState({ status: "error", error: detail.error ?? "Não foi possível abrir a vistoria." });
          return;
        }
        const ready = detail.data;
        return loaders.loadOwnEvidenceUrls(inspectionId).then((urls) => {
          if (!active) return;
          setState({
            status: "ready",
            detail: ready,
            urls: urls.ok && urls.data ? urls.data : {},
            urlsError: urls.ok ? null : (urls.error ?? "Não foi possível abrir as fotos."),
          });
        });
      })
      .catch((error: unknown) => {
        if (active) setState({ status: "error", error: error instanceof Error ? error.message : "Não foi possível abrir a vistoria." });
      });
    return () => {
      active = false;
    };
  }, [inspectionId, loaders, attempt]);

  const retry = () => {
    setState({ status: "loading" });
    setAttempt((n) => n + 1);
  };

  return (
    <div className="flex flex-col gap-4" data-testid="mtsr-app-detail">
      <AppTopBar label="Detalhe da vistoria" onBack={onBack} />
      {state.status === "loading" ? (
        <LoadingState variant="block" label="Abrindo a vistoria…" />
      ) : state.status === "error" ? (
        <ErrorState title="Não foi possível abrir a vistoria." description={state.error} onRetry={retry} />
      ) : (
        <DetailBody detail={state.detail} urls={state.urls} urlsError={state.urlsError} />
      )}
    </div>
  );
}

function DetailBody({ detail: d, urls, urlsError }: { detail: MtsrInspectionDetail; urls: Record<string, string>; urlsError: string | null }) {
  const place = [d.cityNameSnapshot, d.stateUfSnapshot].filter(Boolean).join("/");
  const reviewer = [d.reviewerNameSnapshot, d.reviewedAt ? formatStamp(d.reviewedAt) : null].filter(Boolean).join(" · ");
  return (
    <>
      <header className="flex flex-col gap-3 rounded-lg border border-border bg-surface-raised p-4 shadow-card">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-caption uppercase tracking-wide text-fg-muted">Protocolo</p>
            <h2 className="font-mono text-h3 font-semibold text-fg">{d.protocol}</h2>
          </div>
          <InspectionStatusBadge value={d.status} />
        </div>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
          <Field label="Placa" value={d.licensePlateSnapshot} />
          <Field label="Frota" value={d.fleetCodeSnapshot ?? "—"} />
          <Field label="Data da vistoria" value={formatDate(d.inspectionDate)} />
          <Field label="Enviada em" value={formatStamp(d.submittedAt)} />
          <Field label="Operação" value={[d.operationNameSnapshot, place].filter(Boolean).join(" · ") || "—"} />
          <Field label="Vistoriador" value={d.inspectorNameSnapshot ?? "—"} />
        </dl>
      </header>

      {d.status === "pendente_validacao" ? (
        <Alert variant="info">
          <AlertDescription>
            Aguardando validação da Segurança{d.daysWaiting != null ? ` há ${fmtDays(d.daysWaiting)}` : ""}. O estado oficial dos componentes só muda após a validação.
          </AlertDescription>
        </Alert>
      ) : null}
      {d.status === "retornada" || d.status === "rejeitada" ? (
        <Alert variant={d.status === "rejeitada" ? "danger" : "warning"} data-testid="mtsr-app-detail-reason">
          <AlertTitle>{d.status === "rejeitada" ? "Motivo da rejeição" : "Motivo do retorno"}</AlertTitle>
          <AlertDescription>
            <p>{d.reviewReason?.trim() || "Sem motivo registrado."}</p>
            {reviewer ? <p className="mt-1 text-caption">{reviewer}</p> : null}
            {d.status === "retornada" ? <p className="mt-1 text-caption">Faça uma nova vistoria desta frota corrigindo o que foi apontado.</p> : null}
          </AlertDescription>
        </Alert>
      ) : null}
      {d.status === "validada" ? (
        <Alert variant="success">
          <AlertDescription>Validada{reviewer ? ` (${reviewer})` : ""}. Os itens desta vistoria passaram a valer como estado oficial dos componentes.</AlertDescription>
        </Alert>
      ) : null}

      {d.generalObservation?.trim() ? (
        <p className="rounded-lg border border-border bg-surface-raised p-4 text-body-sm text-fg-secondary shadow-card">
          <span className="block text-caption font-semibold uppercase tracking-wide text-fg-muted">Observação geral</span>
          {d.generalObservation}
        </p>
      ) : null}

      {urlsError ? (
        <Alert variant="warning">
          <AlertDescription>{urlsError}</AlertDescription>
        </Alert>
      ) : null}

      <section className="flex flex-col gap-2">
        <h3 className="text-h4 font-semibold text-fg">
          Itens ({fmtInt(d.itemCount)}){d.nokCount > 0 ? ` · ${fmtInt(d.nokCount)} NOK` : ""}
        </h3>
        <ul className="flex flex-col gap-2">
          {d.items.map((item) => (
            <li key={item.id} className="flex flex-col gap-2 rounded-lg border border-border bg-surface-raised p-4 shadow-card" data-testid="mtsr-app-detail-item">
              <div className="flex items-start justify-between gap-2">
                <p className="min-w-0 flex-1 text-body font-semibold text-fg">{item.componentName}</p>
                <StatusBadge status={item.status === "nok" ? "danger" : "success"}>{item.status === "nok" ? "NOK" : "OK"}</StatusBadge>
              </div>
              {item.observation?.trim() ? <p className="text-body-sm text-fg-secondary">{item.observation}</p> : null}
              <p className="flex flex-wrap items-center gap-1.5 text-caption text-fg-muted">
                Estado oficial:
                <ComponentStatusBadge value={item.officialStatus} awaiting={item.awaitingRevalidation} size="sm" />
                {item.officialReferenceDate ? <span>em {formatDate(item.officialReferenceDate)}</span> : null}
                {item.officialSourceType ? <span>· {sourceTypeLabel(item.officialSourceType)}</span> : null}
              </p>
              {item.maintenance ? (
                <p className="text-caption text-fg-muted">
                  Manutenção {item.maintenance.code} · {item.maintenance.label}
                </p>
              ) : null}
              {item.evidence.length > 0 ? (
                <ul className="grid grid-cols-3 gap-2" aria-label={`Fotos de ${item.componentName}`}>
                  {item.evidence.map((e, index) => {
                    const url = e.purgedAt ? null : urls[e.storagePath];
                    return (
                      <li key={e.id} className="aspect-square overflow-hidden rounded-md border border-border bg-surface-secondary" data-testid="mtsr-app-detail-photo">
                        {url ? (
                          <a href={url} target="_blank" rel="noreferrer" className="block size-full hfm-focus-ring">
                            {/* eslint-disable-next-line @next/next/no-img-element -- URL assinada e curta do bucket privado, fora do otimizador */}
                            <img src={url} alt={`Foto ${index + 1} de ${item.componentName}`} className="size-full object-cover" />
                          </a>
                        ) : (
                          <span className="flex size-full flex-col items-center justify-center gap-1 p-2 text-center text-caption text-fg-muted">
                            <ImageOff className="size-4" aria-hidden />
                            {e.purgedAt ? "Foto expurgada pela retenção" : "Foto indisponível"}
                          </span>
                        )}
                      </li>
                    );
                  })}
                </ul>
              ) : null}
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 flex-col">
      <dt className="text-caption text-fg-muted">{label}</dt>
      <dd className="truncate text-body-sm font-medium text-fg">{value}</dd>
    </div>
  );
}
