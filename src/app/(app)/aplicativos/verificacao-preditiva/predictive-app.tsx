"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Activity, ArrowRight, Clock, Play, Trash2, Truck, UserRound } from "lucide-react";
import { cn } from "@/lib/cn";
import { PageContent, PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { SearchField } from "@/components/ui/search-field";
import { Alert, AlertDescription } from "@/components/feedback/alert";
import { EmptyState } from "@/components/feedback/empty-state";
import { ErrorState } from "@/components/feedback/error-state";
import { LoadingState } from "@/components/feedback/loading-state";
import { Spinner } from "@/components/feedback/spinner";
import { useConfirm } from "@/components/feedback/confirm-dialog";
import { PredictiveStatusBadge } from "@/components/maintenance/badges";
import {
  loadOwnPredictiveSubmission,
  loadPredictiveAppRoadmap,
  loadPredictiveAppVehicles,
  submitPredictiveVerification,
  type Result,
} from "@/lib/maintenance/predictive-app-actions";
import {
  formatDate,
  formatInt,
  formatKm,
  formatStamp,
  PREDICTIVE_APP_PERMISSION,
  type PredictiveAppContext,
  type PredictiveAppVehicle,
  type PredictiveMySubmission,
} from "@/lib/maintenance/predictive-app";
import { RoadmapRunner, type RunnerExit, type RunnerLoaders } from "./roadmap-runner";
import { MySubmissionsList, SubmissionDetailScreen, type DetailLoaders } from "./my-submissions";
import { clearDraft, saveDraft, useStoredDraft, type PredictiveDraft } from "./draft";

/**
 * Verificação Preditiva de Frota — o aplicativo, na sequência:
 *
 *   início → escolher frota → identificação (KM) → roteiro por cluster →
 *   revisão → envio → protocolo ↘ meus envios → detalhe
 *
 * A lista de frotas vem do servidor já filtrada por escopo e elegibilidade,
 * com a situação resumida de cada uma (pior item, críticos, KM). A chave de
 * idempotência nasce ao escolher a frota e vive no rascunho do aparelho até o
 * protocolo (`draft.ts`). O responsável é a própria conta — nunca digitado.
 */
export interface PredictiveAppLoaders extends RunnerLoaders, DetailLoaders {
  loadVehicles: (search?: string | null) => Promise<Result<PredictiveAppVehicle[]>>;
}

const DEFAULT_LOADERS: PredictiveAppLoaders = {
  loadVehicles: loadPredictiveAppVehicles,
  loadRoadmap: loadPredictiveAppRoadmap,
  submit: submitPredictiveVerification,
  loadOwnSubmission: loadOwnPredictiveSubmission,
};

export interface PredictiveAppProps {
  /** null quando o contexto não pôde ser carregado (ou a pessoa não executa). */
  context: PredictiveAppContext | null;
  contextError?: string | null;
  history: PredictiveMySubmission[];
  canExecute: boolean;
  /** Injeção para a prévia sem sessão. Deve ser um objeto estável (módulo). */
  loaders?: PredictiveAppLoaders;
}

type Screen = "home" | "vehicle" | "running" | "history" | "detail";
const HOME_HISTORY_LIMIT = 5;

function greeting(): string {
  const h = new Date().getHours();
  if (h >= 5 && h < 12) return "Bom dia";
  if (h >= 12 && h < 18) return "Boa tarde";
  return "Boa noite";
}

export function PredictiveApp({ context, contextError = null, history, canExecute, loaders = DEFAULT_LOADERS }: PredictiveAppProps) {
  const router = useRouter();
  const confirm = useConfirm();
  const [screen, setScreen] = React.useState<Screen>("home");
  const [detail, setDetail] = React.useState<{ id: string; from: Screen } | null>(null);
  const [activeDraft, setActiveDraft] = React.useState<PredictiveDraft | null>(null);
  const scope = context?.actor.userId ?? "anon";
  const storedDraft = useStoredDraft(scope);

  const title = context?.app?.name ?? "Verificação Preditiva de Frota";
  const blocker: string | null = !canExecute
    ? `Você pode consultar este aplicativo, mas não foi autorizado a executar verificações. Peça à administração a permissão “Executar Verificação Preditiva” (${PREDICTIVE_APP_PERMISSION}).`
    : context === null
      ? null
      : !context.available
        ? context.reason === "inativo"
          ? "O aplicativo Verificação Preditiva está inativo nesta organização. Fale com a administração para reativá-lo."
          : "O aplicativo Verificação Preditiva não está cadastrado nesta organização. Fale com a administração."
        : null;
  const canStart = canExecute && context !== null && context.available;

  const go = (next: Screen) => {
    setScreen(next);
    window.scrollTo({ top: 0 });
  };

  const startVerification = async (vehicle: PredictiveAppVehicle) => {
    if (storedDraft && storedDraft.vehicle.id !== vehicle.id) {
      const ok = await confirm({
        title: "Descartar a verificação em andamento?",
        description: `Há uma verificação de ${storedDraft.vehicle.licensePlate ?? storedDraft.vehicle.fleetCode} iniciada e ainda não enviada. Iniciar outra descarta as respostas dela.`,
        confirmLabel: "Descartar e iniciar",
        cancelLabel: "Manter",
        destructive: true,
      });
      if (!ok) return;
    }
    // A chave de idempotência nasce aqui e acompanha todas as tentativas desta verificação.
    const draft: PredictiveDraft =
      storedDraft && storedDraft.vehicle.id === vehicle.id
        ? storedDraft
        : { clientSubmissionId: crypto.randomUUID(), vehicle, startedAt: new Date().toISOString(), kmInformed: "", kmJustification: "", generalObservation: "", items: {} };
    saveDraft(scope, draft);
    setActiveDraft(draft);
    go("running");
  };

  const continueDraft = () => {
    if (!storedDraft) return;
    setActiveDraft(storedDraft);
    go("running");
  };

  const discardDraft = async () => {
    if (!storedDraft) return;
    const ok = await confirm({
      title: "Descartar a verificação em andamento?",
      description: `As respostas da verificação de ${storedDraft.vehicle.licensePlate ?? storedDraft.vehicle.fleetCode} serão descartadas. Nada foi enviado.`,
      confirmLabel: "Descartar",
      cancelLabel: "Manter",
      destructive: true,
    });
    if (ok) clearDraft(scope);
  };

  const finish = (exit: RunnerExit) => {
    setActiveDraft(null);
    router.refresh();
    go(exit === "history" ? "history" : "vehicle");
  };

  const openDetail = (id: string, from: Screen) => {
    setDetail({ id, from });
    go("detail");
  };

  return (
    <div data-testid="predictive-app" className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        eyebrow="Aplicativos"
        title={title}
        description="Roteiro técnico por cluster do plano preditivo. Cada item verificado reinicia o ciclo, reduz o alvo (monitoramento) ou abre a corretiva — decisão do servidor, com protocolo."
      />
      <PageContent className="mx-auto flex w-full max-w-md flex-col gap-4">
        {screen === "home" ? (
          <HomeScreen
            context={context}
            history={history}
            canExecute={canExecute}
            canStart={canStart}
            blocker={blocker}
            contextError={contextError}
            storedDraft={storedDraft}
            onNew={() => go("vehicle")}
            onContinue={continueDraft}
            onDiscard={() => void discardDraft()}
            onHistory={() => go("history")}
            onOpen={(id) => openDetail(id, "home")}
            onRetry={() => router.refresh()}
          />
        ) : null}
        {screen === "vehicle" && context ? <VehicleScreen loadVehicles={loaders.loadVehicles} onBack={() => go("home")} onPick={startVerification} /> : null}
        {screen === "running" && context && activeDraft ? (
          <RoadmapRunner key={activeDraft.clientSubmissionId} context={context} draft={activeDraft} scope={scope} loaders={loaders} onCancel={() => go("vehicle")} onFinished={finish} />
        ) : null}
        {screen === "history" ? <HistoryScreen history={history} onBack={() => go("home")} onOpen={(id) => openDetail(id, "history")} /> : null}
        {screen === "detail" && detail ? <SubmissionDetailScreen submissionId={detail.id} loaders={loaders} onBack={() => go(detail.from)} /> : null}
      </PageContent>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function HomeScreen({
  context, history, canExecute, canStart, blocker, contextError, storedDraft, onNew, onContinue, onDiscard, onHistory, onOpen, onRetry,
}: {
  context: PredictiveAppContext | null;
  history: PredictiveMySubmission[];
  canExecute: boolean;
  canStart: boolean;
  blocker: string | null;
  contextError: string | null;
  storedDraft: PredictiveDraft | null;
  onNew: () => void;
  onContinue: () => void;
  onDiscard: () => void;
  onHistory: () => void;
  onOpen: (id: string) => void;
  onRetry: () => void;
}) {
  return (
    <div className="flex flex-col gap-4" data-testid="predictive-app-home">
      <section className="flex flex-col items-center gap-3 rounded-lg border border-border bg-surface-raised p-6 text-center shadow-card">
        <span className="flex size-16 items-center justify-center rounded-full bg-primary-soft text-primary-soft-fg">
          <UserRound className="size-8" aria-hidden />
        </span>
        <div>
          <p className="text-caption uppercase tracking-[0.2em] text-fg-muted">{greeting()},</p>
          <p className="text-h2 font-semibold text-fg">{context?.actor.name ?? "Colaborador não identificado"}</p>
          <p className="text-body-sm text-fg-muted">{context?.actor.employeeCode ? `Matrícula ${context.actor.employeeCode}` : "Sem matrícula vinculada"}</p>
        </div>
      </section>

      {storedDraft && canStart ? (
        <section className="flex flex-col gap-3 rounded-lg border border-warning-border bg-warning-soft p-4 shadow-card" data-testid="predictive-app-continue">
          <div>
            <h2 className="text-body font-semibold text-fg">Verificação em andamento</h2>
            <p className="text-body-sm text-warning-soft-fg">
              {storedDraft.vehicle.licensePlate ?? storedDraft.vehicle.fleetCode}
              {storedDraft.vehicle.fleetCode && storedDraft.vehicle.licensePlate ? ` · Frota ${storedDraft.vehicle.fleetCode}` : ""} · iniciada em {formatStamp(storedDraft.startedAt)}. As respostas ficaram salvas neste aparelho e ainda não foram enviadas.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Button size="lg" className="h-12" leadingIcon={<Play />} onClick={onContinue}>
              Continuar
            </Button>
            <Button size="lg" variant="outline" className="h-12" leadingIcon={<Trash2 />} onClick={onDiscard}>
              Descartar
            </Button>
          </div>
        </section>
      ) : null}

      <section className="flex flex-col gap-3 rounded-lg border border-border bg-surface-raised p-4 shadow-card">
        <div className="flex items-start gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-md bg-primary-soft text-primary-soft-fg">
            <Activity className="size-5" aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-h4 font-semibold text-fg">Nova verificação</h2>
            <p className="text-body-sm text-fg-secondary">Escolha a frota, confira o KM, percorra o roteiro técnico por cluster e envie. O desfecho de cada item é decidido pelo servidor.</p>
          </div>
        </div>
        {contextError ? <ErrorState variant="inline" title="Não foi possível abrir a Verificação Preditiva." description={contextError} onRetry={onRetry} /> : null}
        {blocker ? (
          <Alert variant={canExecute ? "warning" : "info"} data-testid="predictive-app-blocker">
            <AlertDescription>{blocker}</AlertDescription>
          </Alert>
        ) : null}
        <Button size="lg" className="h-14 text-body" leadingIcon={<Play />} data-testid="predictive-app-new" disabled={!canStart} onClick={onNew}>
          Nova verificação
        </Button>
      </section>

      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-h4 font-semibold text-fg">Meus envios</h2>
          {history.length > HOME_HISTORY_LIMIT ? (
            <Button variant="ghost" size="sm" trailingIcon={<ArrowRight />} onClick={onHistory}>
              Ver todos ({formatInt(history.length)})
            </Button>
          ) : null}
        </div>
        {canExecute ? <MySubmissionsList history={history} limit={HOME_HISTORY_LIMIT} onOpen={onOpen} /> : <p className="text-body-sm text-fg-muted">O histórico de envios aparece para quem está autorizado a executar verificações.</p>}
      </section>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function VehicleScreen({ loadVehicles, onBack, onPick }: { loadVehicles: PredictiveAppLoaders["loadVehicles"]; onBack: () => void; onPick: (vehicle: PredictiveAppVehicle) => Promise<void> }) {
  const [search, setSearch] = React.useState("");
  const [query, setQuery] = React.useState("");
  const [reload, setReload] = React.useState(0);
  const [result, setResult] = React.useState<{ key: string; rows?: PredictiveAppVehicle[]; error?: string } | null>(null);
  const [picking, setPicking] = React.useState<string | null>(null);
  const key = `${query}\u0000${reload}`;

  // 300 ms depois da última tecla a busca vai ao servidor — nunca à frota inteira no navegador.
  React.useEffect(() => {
    const timer = window.setTimeout(() => setQuery(search.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [search]);

  React.useEffect(() => {
    let active = true;
    loadVehicles(query || null).then(
      (r) => {
        if (!active) return;
        setResult(r.ok ? { key, rows: r.data ?? [] } : { key, error: r.error ?? "Não foi possível listar as frotas." });
      },
      (error: unknown) => {
        if (active) setResult({ key, error: error instanceof Error ? error.message : "Não foi possível listar as frotas." });
      },
    );
    return () => {
      active = false;
    };
  }, [loadVehicles, query, key]);

  const loading = result?.key !== key;
  const rows = result?.rows ?? [];

  const pick = async (vehicle: PredictiveAppVehicle) => {
    setPicking(vehicle.id);
    try {
      await onPick(vehicle);
    } finally {
      setPicking(null);
    }
  };

  return (
    <div className="flex flex-col gap-4" data-testid="predictive-app-vehicles">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" onClick={onBack}>
          Voltar
        </Button>
      </div>
      <header className="flex flex-col gap-1">
        <h2 className="text-h3 font-semibold text-fg">Qual frota você vai verificar?</h2>
        <p className="text-body-sm text-fg-secondary">Só aparecem frotas do seu escopo habilitadas para a Verificação Preditiva. As piores situações vêm primeiro.</p>
      </header>
      <SearchField size="lg" value={search} onValueChange={setSearch} placeholder="Buscar por placa ou frota" aria-label="Buscar por placa ou frota" inputMode="search" autoComplete="off" data-testid="predictive-app-search" />

      {!loading && result?.error ? <ErrorState title="Não foi possível listar as frotas." description={result.error} onRetry={() => setReload((n) => n + 1)} /> : null}
      {loading && !result?.rows ? <LoadingState variant="block" label="Carregando frotas…" /> : null}
      {result?.rows && !result.error ? (
        rows.length === 0 ? (
          <EmptyState
            variant="panel"
            icon={<Truck />}
            title={query ? "Nenhuma frota encontrada" : "Nenhuma frota disponível"}
            description={query ? `Nenhuma placa ou frota corresponde a “${query}”.` : "Nenhuma frota do seu escopo está habilitada para a Verificação Preditiva. Fale com a administração."}
          />
        ) : (
          <ul className={cn("flex flex-col gap-2 hfm-transition", loading && "opacity-60")} aria-busy={loading || undefined}>
            {rows.map((vehicle) => (
              <li key={vehicle.id}>
                <VehicleButton vehicle={vehicle} busy={picking === vehicle.id} disabled={picking !== null} onClick={() => void pick(vehicle)} />
              </li>
            ))}
          </ul>
        )
      ) : null}
    </div>
  );
}

function VehicleButton({ vehicle: v, busy, disabled, onClick }: { vehicle: PredictiveAppVehicle; busy: boolean; disabled: boolean; onClick: () => void }) {
  const place = [v.cityName, v.stateUf].filter(Boolean).join("/");
  const where = [v.vehicleTypeName, v.operationName, place].filter(Boolean).join(" · ");
  const alerts = v.critical + v.due;
  return (
    <button
      type="button"
      data-testid="predictive-app-vehicle"
      data-worst={v.worstStatus}
      disabled={disabled}
      onClick={onClick}
      className="flex w-full flex-col gap-2 rounded-lg border border-border bg-surface-raised p-4 text-left shadow-card hfm-transition hover:border-border-strong hover:shadow-card-hover hfm-focus-ring disabled:opacity-60"
    >
      <span className="flex w-full items-start gap-3">
        {busy ? <Spinner size="md" className="mt-0.5" label="Abrindo a verificação" /> : <Truck className="mt-0.5 size-5 shrink-0 text-fg-muted" aria-hidden />}
        <span className="min-w-0 flex-1">
          <span className="block text-body font-semibold text-fg">
            {v.licensePlate ?? v.fleetCode}
            {v.fleetCode && v.licensePlate ? <span className="font-normal text-fg-muted"> · Frota {v.fleetCode}</span> : null}
          </span>
          <span className="block text-caption text-fg-muted">{where || "—"}</span>
        </span>
        {v.worstStatus === "no_plan" ? (
          <Badge variant="neutral" appearance="soft" size="sm">
            Sem plano
          </Badge>
        ) : (
          <PredictiveStatusBadge status={v.worstStatus} size="sm" />
        )}
      </span>
      <span className="flex w-full flex-wrap items-center gap-1.5 pl-8 text-caption text-fg-muted">
        <span>
          {formatInt(v.items)} {v.items === 1 ? "item" : "itens"} · KM {v.currentKm != null ? formatKm(v.currentKm) : "—"}
          {v.currentKmDate ? ` (${formatDate(v.currentKmDate)})` : ""}
        </span>
        {alerts > 0 ? (
          <Badge variant="danger" appearance="soft" size="sm">
            {formatInt(alerts)} crít./venc.
          </Badge>
        ) : null}
        {v.toSchedule > 0 ? (
          <Badge variant="info" appearance="soft" size="sm">
            {formatInt(v.toSchedule)} a programar
          </Badge>
        ) : null}
        {v.awaitingCorrective > 0 ? (
          <Badge variant="warning" appearance="soft" size="sm">
            {formatInt(v.awaitingCorrective)} aguard. corretiva
          </Badge>
        ) : null}
        {v.kmStale ? (
          <Badge variant="warning" appearance="outline" size="sm" icon={<Clock />}>
            KM desatualizado
          </Badge>
        ) : null}
        {v.lastSubmissionOn ? <span>· último envio {formatDate(v.lastSubmissionOn)}</span> : null}
      </span>
    </button>
  );
}

/* -------------------------------------------------------------------------- */

function HistoryScreen({ history, onBack, onOpen }: { history: PredictiveMySubmission[]; onBack: () => void; onOpen: (id: string) => void }) {
  return (
    <div className="flex flex-col gap-4" data-testid="predictive-app-history-screen">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" onClick={onBack}>
          Voltar
        </Button>
      </div>
      <header className="flex flex-col gap-1">
        <h2 className="text-h3 font-semibold text-fg">Meus envios</h2>
        <p className="text-body-sm text-fg-secondary">{history.length === 0 ? "Nada enviado ainda." : `Os últimos ${formatInt(history.length)} envios feitos por você, com protocolo e desfecho.`}</p>
      </header>
      <MySubmissionsList history={history} onOpen={onOpen} />
    </div>
  );
}
