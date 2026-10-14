"use client";

import * as React from "react";
import { AlertTriangle, ChevronRight, History } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/feedback/empty-state";
import { ErrorState } from "@/components/feedback/error-state";
import { LoadingState } from "@/components/feedback/loading-state";
import { CriticalityBadge, MaintenanceStatusBadge, VerificationResultBadge } from "@/components/maintenance/badges";
import type { loadOwnPredictiveSubmission } from "@/lib/maintenance/predictive-app-actions";
import { formatDate, formatInt, formatKm, formatStamp, type PredictiveMySubmission } from "@/lib/maintenance/predictive-app";
import { DECISION_LABEL, type PredictiveSubmissionDetail } from "@/lib/maintenance/types";
import { AppTopBar } from "./roadmap-runner";

/**
 * "Meus envios": o que a pessoa enviou (protocolo, placa, totais) e o detalhe
 * item a item com o resultado registrado, a decisão que o servidor tomou e a
 * corretiva aberta quando houve não conformidade.
 */
export interface DetailLoaders {
  loadOwnSubmission: typeof loadOwnPredictiveSubmission;
}

export function MySubmissionsList({ history, onOpen, limit }: { history: PredictiveMySubmission[]; onOpen: (id: string) => void; limit?: number }) {
  const rows = limit ? history.slice(0, limit) : history;
  if (rows.length === 0) {
    return (
      <EmptyState
        size="sm"
        variant="panel"
        icon={<History />}
        title="Nenhuma verificação enviada ainda"
        description="As verificações que você enviar aparecem aqui com o protocolo e o desfecho de cada item."
        data-testid="predictive-app-history"
      />
    );
  }
  return (
    <ul className="flex flex-col gap-2" data-testid="predictive-app-history">
      {rows.map((item) => (
        <li key={item.id}>
          <button
            type="button"
            data-testid="predictive-app-history-item"
            onClick={() => onOpen(item.id)}
            className="flex min-h-16 w-full items-center gap-3 rounded-lg border border-border bg-surface-raised p-4 text-left shadow-card hfm-transition hover:border-border-strong hover:shadow-card-hover hfm-focus-ring"
          >
            <span className="min-w-0 flex-1">
              <span className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-body-sm font-semibold text-fg">{item.protocol}</span>
                {item.kmDivergent ? (
                  <Badge variant="warning" appearance="soft" size="sm" icon={<AlertTriangle />}>
                    KM divergente
                  </Badge>
                ) : null}
              </span>
              <span className="mt-1 block text-body font-semibold text-fg">
                {item.licensePlate}
                {item.fleetCode ? <span className="font-normal text-fg-muted"> · Frota {item.fleetCode}</span> : null}
              </span>
              <span className="block text-caption text-fg-muted">
                {formatDate(item.verifiedOn)} · {formatInt(item.totalItems)} {item.totalItems === 1 ? "item" : "itens"}
                {item.maintenancesOpened > 0 ? ` · ${formatInt(item.maintenancesOpened)} corretiva(s)` : ""}
              </span>
            </span>
            {item.totalNonConforming > 0 ? (
              <Badge variant="danger" appearance="soft">
                {formatInt(item.totalNonConforming)} NC
              </Badge>
            ) : item.totalMonitoring > 0 ? (
              <Badge variant="warning" appearance="soft">
                {formatInt(item.totalMonitoring)} monit.
              </Badge>
            ) : (
              <Badge variant="success" appearance="soft">
                Conforme
              </Badge>
            )}
            <ChevronRight className="size-5 shrink-0 text-fg-muted" aria-hidden />
          </button>
        </li>
      ))}
    </ul>
  );
}

export function SubmissionDetailScreen({ submissionId, loaders, onBack }: { submissionId: string; loaders: DetailLoaders; onBack: () => void }) {
  const [state, setState] = React.useState<{ key: string; data?: PredictiveSubmissionDetail; error?: string } | null>(null);
  const [reload, setReload] = React.useState(0);
  const key = `${submissionId}#${reload}`;

  React.useEffect(() => {
    let active = true;
    loaders.loadOwnSubmission(submissionId).then(
      (r) => {
        if (!active) return;
        setState(r.ok && r.data ? { key, data: r.data } : { key, error: r.error ?? "Não foi possível abrir o envio." });
      },
      (error: unknown) => {
        if (active) setState({ key, error: error instanceof Error ? error.message : "Não foi possível abrir o envio." });
      },
    );
    return () => {
      active = false;
    };
  }, [loaders, submissionId, key]);

  const loading = state?.key !== key;
  const d = state?.data;

  return (
    <div className="flex flex-col gap-4" data-testid="predictive-app-detail">
      <AppTopBar label={d ? `Envio ${d.protocol}` : "Envio"} onBack={onBack} />
      {loading ? <LoadingState variant="block" label="Carregando o envio…" /> : null}
      {!loading && state?.error ? <ErrorState title="Não foi possível abrir o envio." description={state.error} onRetry={() => setReload((n) => n + 1)} /> : null}
      {d ? (
        <>
          <header className="flex flex-col gap-1">
            <p className="font-mono text-caption uppercase tracking-wide text-fg-muted">{d.protocol}</p>
            <h2 className="text-h3 font-semibold text-fg">
              {d.licensePlate}
              {d.fleetCode ? <span className="font-normal text-fg-muted"> · Frota {d.fleetCode}</span> : null}
            </h2>
            <p className="text-body-sm text-fg-secondary">
              {formatDate(d.verifiedOn)} · {d.inspector.name} · {[d.operationName, d.cityName].filter(Boolean).join(" · ") || "Sem operação"}
            </p>
          </header>

          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 rounded-lg border border-border bg-surface-raised p-4 shadow-card">
            <Field label="KM informado" value={d.km.informed != null ? formatKm(d.km.informed) : "não informado"} />
            <Field label="KM oficial" value={d.km.official != null ? formatKm(d.km.official) : "sem leitura"} />
            <Field label="Divergência" value={d.km.divergent ? "justificada" : "dentro da tolerância"} />
            <Field label="Enviado em" value={formatStamp(d.createdAt)} />
            {d.km.justification ? <Field label="Justificativa do KM" value={d.km.justification} wide /> : null}
            {d.generalObservation ? <Field label="Observação geral" value={d.generalObservation} wide /> : null}
          </dl>

          <div className="grid grid-cols-4 gap-2">
            <Stat label="Itens" value={d.totals.items} tone="neutral" />
            <Stat label="Conf." value={d.totals.conforming} tone="success" />
            <Stat label="Monit." value={d.totals.monitoring} tone="neutral" />
            <Stat label="NC" value={d.totals.nonConforming} tone={d.totals.nonConforming > 0 ? "danger" : "neutral"} />
          </div>

          <ul className="flex flex-col gap-2">
            {d.items.map((item) => (
              <li key={item.verificationId} className="flex flex-col gap-2 rounded-lg border border-border bg-surface-raised p-4 shadow-card" data-testid="predictive-app-detail-item">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="min-w-0 flex-1 text-body font-semibold text-fg">{item.itemName}</span>
                  <VerificationResultBadge result={item.result} />
                </div>
                <p className="flex flex-wrap items-center gap-2 text-caption text-fg-muted">
                  <span>{item.clusterName}</span>
                  <CriticalityBadge value={item.criticality} />
                  <span>· {DECISION_LABEL[item.decision] ?? item.decision}</span>
                </p>
                {item.notes ? <p className="text-body-sm text-fg">{item.notes}</p> : null}
                {item.monitorKm != null || item.monitorDays != null ? (
                  <p className="text-caption text-fg-secondary">
                    Monitorar por {[item.monitorKm != null ? formatKm(item.monitorKm) : null, item.monitorDays != null ? `${formatInt(item.monitorDays)} dias` : null].filter(Boolean).join(" ou ")}
                  </p>
                ) : null}
                {item.checklist.length > 0 ? (
                  <ul className="flex flex-col gap-0.5 border-t border-border-subtle pt-2">
                    {item.checklist.map((a) => (
                      <li key={a.key} className="flex items-start justify-between gap-3 text-caption">
                        <span className="min-w-0 text-fg-secondary">{a.key}</span>
                        <span className="shrink-0 font-medium text-fg">{a.answer}</span>
                      </li>
                    ))}
                  </ul>
                ) : null}
                {item.maintenance ? (
                  <p className="flex flex-wrap items-center gap-2 text-caption">
                    <span className="text-fg-muted">Corretiva</span>
                    <span className="font-semibold text-fg">{item.maintenance.code}</span>
                    <MaintenanceStatusBadge status={item.maintenance.status} />
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </div>
  );
}

function Field({ label, value, wide = false }: { label: string; value: string; wide?: boolean }) {
  return (
    <div className={wide ? "col-span-2 flex min-w-0 flex-col" : "flex min-w-0 flex-col"}>
      <dt className="text-caption text-fg-muted">{label}</dt>
      <dd className="text-body-sm font-medium text-fg">{value}</dd>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone: "success" | "danger" | "neutral" }) {
  return (
    <div className="min-w-0 rounded-lg border border-border bg-surface-raised px-2 py-3 text-center shadow-card">
      <p className={tone === "success" ? "text-h2 font-semibold tabular-nums text-success" : tone === "danger" ? "text-h2 font-semibold tabular-nums text-danger" : "text-h2 font-semibold tabular-nums text-fg"}>{formatInt(value)}</p>
      <p className="text-caption font-medium text-fg-muted">{label}</p>
    </div>
  );
}
