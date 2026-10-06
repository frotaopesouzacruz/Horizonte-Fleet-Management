"use client";

import * as React from "react";
import { ChevronRight, ClipboardList, RotateCcw } from "lucide-react";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/feedback/alert";
import { EmptyState } from "@/components/feedback/empty-state";
import { ErrorState } from "@/components/feedback/error-state";
import { LoadingState } from "@/components/feedback/loading-state";
import type { Result } from "@/lib/tires/app-actions";
import {
  fmtInt,
  fmtNum,
  formatDate,
  formatStamp,
  INSPECTION_STATUS_LABEL,
  INSPECTION_STATUS_SHORT,
  INSPECTION_STATUS_TONE,
  plural,
  type InspectionStatus,
  type TireMyInspectionDetail,
  type TireMyInspectionRow,
  type TireMyInspections,
} from "@/lib/tires/types";
import type { DraftVehicle } from "./draft";
import { AppBar, Screen, type RunnerParent } from "./tire-runner";

/**
 * "Minhas vistorias": o que a pessoa enviou, a situação de cada envio e as
 * PRÓPRIAS leituras. Nada da fotografia oficial aparece aqui — nem a
 * comparação: a rotina `tire_my_inspection_detail` devolve os tipos de
 * divergência quando a vistoria volta para o campo, mas a tela mostra apenas a
 * nota do revisor, para não viciar a nova medição (leitura cega).
 */
export interface HistoryLoaders {
  myInspections: () => Promise<Result<TireMyInspections>>;
  myDetail: (id: string) => Promise<Result<TireMyInspectionDetail>>;
}

export interface RedoTarget {
  vehicleId: string;
  vehicle: DraftVehicle;
  parent: RunnerParent;
}

const statusTone = (s: InspectionStatus) => INSPECTION_STATUS_TONE[s] ?? "neutral";
const statusShort = (s: InspectionStatus) => INSPECTION_STATUS_SHORT[s] ?? s;
const statusLabel = (s: InspectionStatus) => INSPECTION_STATUS_LABEL[s] ?? s;

function redoFromRow(row: TireMyInspectionRow): RedoTarget {
  return {
    vehicleId: row.vehicleId,
    vehicle: { id: row.vehicleId, licensePlate: row.licensePlate, fleetCode: row.fleetCode, vehicleTypeName: null, operationName: null, cityName: null, stateUf: null },
    parent: { id: row.id, protocol: row.protocol, reviewNote: row.reviewNote, reviewedAt: row.reviewedAt },
  };
}

function redoFromDetail(d: TireMyInspectionDetail): RedoTarget {
  return {
    vehicleId: d.vehicleId,
    vehicle: { id: d.vehicleId, licensePlate: d.licensePlate, fleetCode: d.fleetCode, vehicleTypeName: null, operationName: d.operationName, cityName: d.cityName, stateUf: null },
    parent: { id: d.id, protocol: d.protocol, reviewNote: d.reviewNote, reviewedAt: d.reviewedAt },
  };
}

/* -------------------------------------------------------------------------- */

export function MyTireInspections({
  loaders,
  canRedo,
  onBack,
  onOpen,
  onRedo,
}: {
  loaders: HistoryLoaders;
  /** Refazer exige o aplicativo disponível (ativo e com fotografia oficial). */
  canRedo: boolean;
  onBack: () => void;
  onOpen: (id: string) => void;
  onRedo: (target: RedoTarget) => void;
}) {
  const [attempt, setAttempt] = React.useState(0);
  const [state, setState] = React.useState<{ key: number; data?: TireMyInspections; error?: string } | null>(null);

  React.useEffect(() => {
    let active = true;
    loaders.myInspections().then(
      (r) => {
        if (!active) return;
        setState(r.ok && r.data ? { key: attempt, data: r.data } : { key: attempt, error: r.error ?? "Não foi possível listar as suas vistorias." });
      },
      () => {
        if (active) setState({ key: attempt, error: "Não foi possível falar com o servidor. Verifique a conexão e tente de novo." });
      },
    );
    return () => {
      active = false;
    };
  }, [loaders, attempt]);

  const loading = state?.key !== attempt;
  const data = !loading ? state?.data : undefined;
  const rows = data?.rows ?? [];

  return (
    <Screen>
      <AppBar label="Minhas vistorias" onBack={onBack} />
      <header className="flex flex-col gap-1">
        <h2 id="tires-app-screen-heading" tabIndex={-1} className="text-h3 font-semibold text-fg outline-none">
          Minhas vistorias
        </h2>
        <p className="text-body-sm text-fg-secondary">
          {data && data.total > rows.length
            ? `As ${fmtInt(rows.length)} mais recentes de ${fmtInt(data.total)} vistorias enviadas por você.`
            : "As vistorias enviadas por você, com a situação de cada uma. A comparação com a base oficial é feita pela equipe."}
        </p>
      </header>

      {loading ? <LoadingState variant="block" label="Carregando as suas vistorias…" /> : null}
      {!loading && state?.error ? (
        <ErrorState title="Não foi possível listar as suas vistorias." description={state.error} onRetry={() => setAttempt((n) => n + 1)} />
      ) : null}
      {data && rows.length === 0 ? (
        <EmptyState
          variant="panel"
          size="sm"
          icon={<ClipboardList />}
          title="Nenhuma vistoria enviada ainda"
          description="As vistorias que você enviar aparecem aqui com o protocolo e a situação da revisão."
        />
      ) : null}
      {rows.length > 0 ? (
        <ul className="flex flex-col gap-2" data-testid="tires-app-history">
          {rows.map((row) => {
            const returned = row.status === "retornar_divergencia";
            return (
              <li
                key={row.id}
                className={cn(
                  "overflow-hidden rounded-lg border bg-surface-raised shadow-card",
                  returned ? "border-danger-border" : "border-border",
                )}
                data-testid="tires-app-history-item"
                data-status={row.status}
              >
                <button
                  type="button"
                  onClick={() => onOpen(row.id)}
                  className="flex min-h-16 w-full items-center gap-3 p-4 text-left hfm-transition hover:bg-hover-overlay hfm-focus-ring"
                >
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-body-sm font-semibold text-fg">{row.protocol}</span>
                      <StatusBadge status={statusTone(row.status)} size="sm">
                        {statusShort(row.status)}
                      </StatusBadge>
                    </span>
                    <span className="mt-1 block text-body font-semibold text-fg">
                      {row.licensePlate}
                      {row.fleetCode ? <span className="font-normal text-fg-muted"> · Frota {row.fleetCode}</span> : null}
                    </span>
                    <span className="block text-caption text-fg-muted">
                      Vistoria de {formatDate(row.inspectionDate)} · {fmtInt(row.positionsMeasured)} de {fmtInt(row.positionsExpected)}{" "}
                      {plural(row.positionsExpected, "posição medida", "posições medidas")}
                    </span>
                  </span>
                  <ChevronRight className="size-5 shrink-0 text-fg-muted" aria-hidden />
                </button>
                {returned ? (
                  <div className="flex flex-col gap-2 border-t border-danger-border bg-danger-soft px-4 py-3" data-testid="tires-app-history-returned">
                    <p className="text-body-sm text-danger-soft-fg">
                      <span className="font-semibold">Nota do revisor:</span> {row.reviewNote?.trim() || "sem nota registrada."}
                    </p>
                    {canRedo ? (
                      <Button size="lg" variant="danger" className="h-11 self-start" leadingIcon={<RotateCcw />} onClick={() => onRedo(redoFromRow(row))}>
                        Refazer medição
                      </Button>
                    ) : null}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}
    </Screen>
  );
}

/* -------------------------------------------------------------------------- */

const STATUS_NOTE: Partial<Record<InspectionStatus, { variant: "info" | "success" | "neutral"; text: string }>> = {
  pendente_revisao: {
    variant: "info",
    text: "Aguardando revisão da equipe. As leituras serão comparadas com a base oficial; você não verá a comparação.",
  },
  pendente_rodopar: {
    variant: "info",
    text: "Revisada pela equipe e aguardando lançamento no Rodopar. A base oficial só muda com a próxima importação.",
  },
  sincronizado_rodopar: {
    variant: "success",
    text: "As leituras desta vistoria chegaram ao Rodopar na importação mais recente.",
  },
  substituida: {
    variant: "neutral",
    text: "Substituída por uma nova medição deste veículo.",
  },
};

export function MyTireInspectionDetail({
  inspectionId,
  loaders,
  canRedo,
  onBack,
  onRedo,
}: {
  inspectionId: string;
  loaders: HistoryLoaders;
  canRedo: boolean;
  onBack: () => void;
  onRedo: (target: RedoTarget) => void;
}) {
  const [attempt, setAttempt] = React.useState(0);
  const key = `${inspectionId}\u0000${attempt}`;
  const [state, setState] = React.useState<{ key: string; data?: TireMyInspectionDetail; error?: string } | null>(null);

  React.useEffect(() => {
    let active = true;
    loaders.myDetail(inspectionId).then(
      (r) => {
        if (!active) return;
        if (!r.ok) setState({ key, error: r.error ?? "Não foi possível abrir a vistoria." });
        else if (!r.data) setState({ key, error: "Vistoria não encontrada entre as suas." });
        else setState({ key, data: r.data });
      },
      () => {
        if (active) setState({ key, error: "Não foi possível falar com o servidor. Verifique a conexão e tente de novo." });
      },
    );
    return () => {
      active = false;
    };
  }, [loaders, inspectionId, key]);

  const loading = state?.key !== key;
  const d = !loading ? state?.data : undefined;

  return (
    <Screen>
      <AppBar label={d ? `Vistoria ${d.protocol}` : "Detalhe da vistoria"} onBack={onBack} />
      <h2 id="tires-app-screen-heading" tabIndex={-1} className="sr-only">
        Detalhe da vistoria
      </h2>
      {loading ? <LoadingState variant="block" label="Abrindo a vistoria…" /> : null}
      {!loading && state?.error ? (
        <ErrorState title="Não foi possível abrir a vistoria." description={state.error} onRetry={() => setAttempt((n) => n + 1)} />
      ) : null}
      {d ? <DetailBody detail={d} canRedo={canRedo} onRedo={() => onRedo(redoFromDetail(d))} /> : null}
    </Screen>
  );
}

function DetailBody({ detail: d, canRedo, onRedo }: { detail: TireMyInspectionDetail; canRedo: boolean; onRedo: () => void }) {
  const returned = d.status === "retornar_divergencia";
  const note = STATUS_NOTE[d.status];
  return (
    <div className="flex flex-col gap-4" data-testid="tires-app-detail" data-status={d.status}>
      <section className="flex flex-col gap-3 rounded-lg border border-border bg-surface-raised p-4 shadow-card">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-caption uppercase tracking-wide text-fg-muted">Protocolo</p>
            <p className="break-all font-mono text-h3 font-semibold text-fg">{d.protocol}</p>
          </div>
          <StatusBadge status={statusTone(d.status)}>{statusLabel(d.status)}</StatusBadge>
        </div>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
          <Field label="Placa" value={d.licensePlate} />
          <Field label="Frota" value={d.fleetCode ?? "—"} />
          <Field label="Data da vistoria" value={formatDate(d.inspectionDate)} />
          <Field label="Enviada em" value={formatStamp(d.submittedAt)} />
          <Field label="Posições medidas" value={`${fmtInt(d.positionsMeasured)} de ${fmtInt(d.positionsExpected)}`} />
          <Field label="Operação" value={[d.operationName, d.cityName].filter(Boolean).join(" · ") || "—"} wrap className="col-span-2" />
        </dl>
      </section>

      {returned ? (
        <Alert variant="warning" data-testid="tires-app-detail-returned">
          <AlertTitle>Retornada para nova medição</AlertTitle>
          <AlertDescription>
            <p>
              <span className="font-semibold">Nota do revisor:</span> {d.reviewNote?.trim() || "sem nota registrada."}
            </p>
            {d.reviewedAt ? <p className="mt-1 text-caption">Retornada em {formatStamp(d.reviewedAt)}.</p> : null}
            <p className="mt-1">Meça o veículo de novo; a nova medição substitui esta vistoria.</p>
          </AlertDescription>
        </Alert>
      ) : note ? (
        <Alert variant={note.variant}>
          <AlertDescription>{note.text}</AlertDescription>
        </Alert>
      ) : null}

      {returned && canRedo ? (
        <Button size="lg" className="h-14" leadingIcon={<RotateCcw />} onClick={onRedo} data-testid="tires-app-redo">
          Refazer medição
        </Button>
      ) : null}

      {d.generalObservation?.trim() ? (
        <p className="rounded-lg border border-border bg-surface-raised p-4 text-body-sm text-fg-secondary shadow-card">
          <span className="block text-caption font-semibold uppercase tracking-wide text-fg-muted">Observação geral</span>
          {d.generalObservation}
        </p>
      ) : null}

      <section className="flex flex-col gap-2" aria-labelledby="tires-app-detail-readings">
        <h3 id="tires-app-detail-readings" className="text-h4 font-semibold text-fg">
          Suas leituras
        </h3>
        <ul className="flex flex-col gap-2">
          {/* Só as leituras próprias: `divergenceTypes` nunca é exibido ao vistoriador. */}
          {d.items.map((item) => (
            <li
              key={item.positionCode}
              className="flex flex-col gap-2 rounded-lg border border-border bg-surface-raised p-3 shadow-card"
              data-testid="tires-app-detail-item"
            >
              <div className="flex items-center gap-2">
                <span className="flex h-7 min-w-12 shrink-0 items-center justify-center rounded-md bg-surface-secondary px-1.5 font-mono text-caption font-semibold text-fg">
                  {item.positionCode}
                </span>
                <span className="min-w-0 flex-1 text-body-sm font-medium text-fg">{item.positionLabel ?? item.positionCode}</span>
                {!item.measured ? (
                  <StatusBadge status="neutral" size="sm">
                    Não medida
                  </StatusBadge>
                ) : null}
              </div>
              {item.measured ? (
                <dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-2">
                  <Field label="Nº Fogo lido" value={item.fireNumberRead ?? "—"} mono />
                  <Field label="PSI" value={fmtNum(item.psiRead)} align="end" />
                  <div className="col-span-2 flex min-w-0 flex-col">
                    <dt className="text-caption text-fg-muted">Sulcos (mm)</dt>
                    <dd className="grid grid-cols-4 gap-1 text-body-sm font-medium tabular-nums text-fg">
                      {[item.tread1, item.tread2, item.tread3, item.tread4].map((t, i) => (
                        <span key={i} className="rounded-sm bg-surface-secondary px-1.5 py-1 text-center">
                          <span className="mr-1 text-caption font-normal text-fg-muted">S{i + 1}</span>
                          {fmtNum(t)}
                        </span>
                      ))}
                    </dd>
                  </div>
                </dl>
              ) : null}
              {item.observation?.trim() ? <p className="text-caption text-fg-secondary">Obs.: {item.observation}</p> : null}
            </li>
          ))}
        </ul>
      </section>

      {d.history.length > 0 ? (
        <section className="flex flex-col gap-2" aria-labelledby="tires-app-detail-history">
          <h3 id="tires-app-detail-history" className="text-h4 font-semibold text-fg">
            Andamento
          </h3>
          <ol className="flex flex-col gap-0 rounded-lg border border-border bg-surface-raised p-4 shadow-card">
            {d.history.map((h, i) => (
              <li key={`${h.createdAt}-${i}`} className="relative flex gap-3 pb-4 last:pb-0">
                <span aria-hidden className="relative flex w-3 shrink-0 justify-center">
                  <span className="mt-1.5 size-2.5 rounded-full bg-border-strong" />
                  {i < d.history.length - 1 ? <span className="absolute top-4 bottom-[-0.25rem] w-px bg-border" /> : null}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-body-sm font-medium text-fg">{statusLabel(h.toStatus)}</span>
                  <span className="block text-caption text-fg-muted">{formatStamp(h.createdAt)}</span>
                  {h.reason?.trim() ? <span className="mt-0.5 block text-caption text-fg-secondary">{h.reason}</span> : null}
                </span>
              </li>
            ))}
          </ol>
        </section>
      ) : null}
    </div>
  );
}

function Field({
  label,
  value,
  mono = false,
  align = "start",
  wrap = false,
  className,
}: {
  label: string;
  value: string;
  mono?: boolean;
  align?: "start" | "end";
  wrap?: boolean;
  className?: string;
}) {
  return (
    <div className={cn("flex min-w-0 flex-col", align === "end" && "items-end text-right", className)}>
      <dt className="text-caption text-fg-muted">{label}</dt>
      <dd className={cn("text-body-sm font-medium text-fg", !wrap && "truncate", mono && "font-mono")}>{value}</dd>
    </div>
  );
}
