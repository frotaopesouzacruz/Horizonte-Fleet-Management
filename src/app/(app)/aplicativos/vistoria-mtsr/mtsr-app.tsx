"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, ClipboardCheck, Play, Trash2, Truck, UserRound } from "lucide-react";
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
import { DeadlineBadge } from "@/components/mtsr/badges";
import {
  createEvidenceUpload,
  loadAppVehicles,
  loadOwnEvidenceUrls,
  loadOwnInspection,
  submitInspection,
  type Result,
} from "@/lib/mtsr/app-actions";
import { fmtDays, fmtInt, formatDate, formatStamp, MTSR_PERMISSION_CODES, type MtsrAppContext, type MtsrAppVehicle, type MtsrInspectionDetail } from "@/lib/mtsr/types";
import { uploadToSignedUrl, type UploadFn } from "./evidence-capture";
import { AppTopBar, InspectionRunner, type RunnerExit, type SubmitFn } from "./inspection-runner";
import { InspectionDetailScreen, MyInspectionsList, type DetailLoaders } from "./my-inspections";
import { clearDraft, saveDraft, useStoredDraft, type InspectionDraft } from "./draft";

/**
 * Vistoria MTSR — o aplicativo, na sequência:
 *
 *   início → escolher frota → itens → revisão → envio → protocolo
 *                                                       ↘ minhas vistorias → detalhe
 *
 * A lista de frotas vem do servidor já filtrada por escopo e elegibilidade
 * (Operação e Tipo de equipamento habilitados para o app); a busca por placa
 * ou frota também roda lá. A chave de idempotência nasce ao escolher a frota e
 * vive no rascunho do aparelho até o protocolo (`draft.ts`).
 *
 * O envio NÃO altera o estado oficial dos componentes: vai para validação da
 * Segurança, e é isso que a tela diz em todo lugar em que poderia haver
 * dúvida.
 */
export interface MtsrAppLoaders {
  loadVehicles: (search?: string | null) => Promise<Result<MtsrAppVehicle[]>>;
  createEvidenceUpload: typeof createEvidenceUpload;
  upload: UploadFn;
  submit: SubmitFn;
  loadOwnInspection: DetailLoaders["loadOwnInspection"];
  loadOwnEvidenceUrls: DetailLoaders["loadOwnEvidenceUrls"];
}

const DEFAULT_LOADERS: MtsrAppLoaders = {
  loadVehicles: loadAppVehicles,
  createEvidenceUpload,
  upload: uploadToSignedUrl,
  submit: submitInspection,
  loadOwnInspection,
  loadOwnEvidenceUrls,
};

export interface MtsrAppProps {
  /** null quando o contexto não pôde ser carregado (ou a pessoa não executa). */
  context: MtsrAppContext | null;
  /** Erro ao carregar o contexto, para quem PODE executar. */
  contextError?: string | null;
  history: MtsrInspectionDetail[];
  canExecute: boolean;
  /** Injeção para a prévia sem sessão. Deve ser um objeto estável (módulo). */
  loaders?: MtsrAppLoaders;
  /** Prévia: "Simular foto" nos itens. */
  preview?: boolean;
}

type Screen = "home" | "vehicle" | "running" | "history" | "detail";

const HOME_HISTORY_LIMIT = 5;

function greeting(): string {
  const h = new Date().getHours();
  if (h >= 5 && h < 12) return "Bom dia";
  if (h >= 12 && h < 18) return "Boa tarde";
  return "Boa noite";
}

export function MtsrApp({ context, contextError = null, history, canExecute, loaders = DEFAULT_LOADERS, preview = false }: MtsrAppProps) {
  const router = useRouter();
  const confirm = useConfirm();
  const [screen, setScreen] = React.useState<Screen>("home");
  const [detail, setDetail] = React.useState<{ id: string; from: Screen } | null>(null);
  const [activeDraft, setActiveDraft] = React.useState<InspectionDraft | null>(null);
  const scope = context?.actor.userId ?? "anon";
  const storedDraft = useStoredDraft(scope);

  const title = context?.app?.name ?? "Vistoria MTSR";
  const fieldComponents = context?.components ?? [];

  const blocker: string | null = !canExecute
    ? `Você pode consultar este aplicativo, mas não foi autorizado a executar vistorias. Peça à administração a permissão “Executar Vistoria MTSR” (${MTSR_PERMISSION_CODES.appExecute}).`
    : context === null
      ? null
      : !context.available
        ? context.reason === "inativo"
          ? "O aplicativo Vistoria MTSR está inativo nesta organização. Fale com a administração para reativá-lo."
          : "O aplicativo Vistoria MTSR não está cadastrado nesta organização. Fale com a administração."
        : fieldComponents.length === 0
          ? "Nenhum componente de campo ativo foi cadastrado para a vistoria. Fale com a Segurança."
          : null;
  const canStart = canExecute && context !== null && context.available && fieldComponents.length > 0;

  const go = (next: Screen) => {
    setScreen(next);
    window.scrollTo({ top: 0 });
  };

  const startInspection = async (vehicle: MtsrAppVehicle) => {
    if (storedDraft && storedDraft.vehicle.id !== vehicle.id) {
      const ok = await confirm({
        title: "Descartar a vistoria em andamento?",
        description: `Há uma vistoria de ${storedDraft.vehicle.licensePlate} iniciada e ainda não enviada. Iniciar outra descarta as respostas e fotos dela.`,
        confirmLabel: "Descartar e iniciar",
        cancelLabel: "Manter",
        destructive: true,
      });
      if (!ok) return;
    }
    // A chave de idempotência nasce aqui, antes de qualquer foto ou envio, e
    // acompanha todas as tentativas desta mesma vistoria.
    const draft: InspectionDraft =
      storedDraft && storedDraft.vehicle.id === vehicle.id
        ? storedDraft
        : { clientSubmissionId: crypto.randomUUID(), vehicle, startedAt: new Date().toISOString(), answers: {}, generalObservation: "" };
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
      title: "Descartar a vistoria em andamento?",
      description: `As respostas e fotos da vistoria de ${storedDraft.vehicle.licensePlate} serão descartadas. Nada foi enviado à Segurança.`,
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
    <div data-testid="mtsr-app" className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        eyebrow="Aplicativos"
        title={title}
        description="Vistoria de campo dos componentes MTSR. O envio vai para validação da Segurança; o estado oficial dos componentes só muda depois dela."
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

        {screen === "vehicle" && context ? (
          <VehicleScreen loadVehicles={loaders.loadVehicles} onBack={() => go("home")} onPick={startInspection} />
        ) : null}

        {screen === "running" && context && activeDraft ? (
          <InspectionRunner
            key={activeDraft.clientSubmissionId}
            context={context}
            draft={activeDraft}
            scope={scope}
            loaders={loaders}
            preview={preview}
            onCancel={() => go("vehicle")}
            onFinished={finish}
          />
        ) : null}

        {screen === "history" ? (
          <HistoryScreen history={history} onBack={() => go("home")} onOpen={(id) => openDetail(id, "history")} />
        ) : null}

        {screen === "detail" && detail ? (
          <InspectionDetailScreen inspectionId={detail.id} loaders={loaders} onBack={() => go(detail.from)} />
        ) : null}
      </PageContent>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function HomeScreen({
  context,
  history,
  canExecute,
  canStart,
  blocker,
  contextError,
  storedDraft,
  onNew,
  onContinue,
  onDiscard,
  onHistory,
  onOpen,
  onRetry,
}: {
  context: MtsrAppContext | null;
  history: MtsrInspectionDetail[];
  canExecute: boolean;
  canStart: boolean;
  blocker: string | null;
  contextError: string | null;
  storedDraft: InspectionDraft | null;
  onNew: () => void;
  onContinue: () => void;
  onDiscard: () => void;
  onHistory: () => void;
  onOpen: (id: string) => void;
  onRetry: () => void;
}) {
  return (
    <div className="flex flex-col gap-4" data-testid="mtsr-app-home">
      {/* Quem está vistoriando aparece antes de qualquer ação: é o que permite
          perceber, ainda na primeira tela, que se entrou com a conta errada. */}
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
        <section className="flex flex-col gap-3 rounded-lg border border-warning-border bg-warning-soft p-4 shadow-card" data-testid="mtsr-app-continue">
          <div>
            <h2 className="text-body font-semibold text-fg">Vistoria em andamento</h2>
            <p className="text-body-sm text-warning-soft-fg">
              {storedDraft.vehicle.licensePlate}
              {storedDraft.vehicle.fleetCode ? ` · Frota ${storedDraft.vehicle.fleetCode}` : ""} · iniciada em {formatStamp(storedDraft.startedAt)}. As respostas e fotos
              ficaram salvas neste aparelho e ainda não foram enviadas.
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
            <ClipboardCheck className="size-5" aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-h4 font-semibold text-fg">Nova vistoria</h2>
            <p className="text-body-sm text-fg-secondary">Escolha a frota, registre OK ou NOK em cada componente de campo e envie para validação da Segurança.</p>
          </div>
        </div>
        {contextError ? (
          <ErrorState variant="inline" title="Não foi possível abrir a Vistoria MTSR." description={contextError} onRetry={onRetry} />
        ) : null}
        {blocker ? (
          <Alert variant={canExecute ? "warning" : "info"} data-testid="mtsr-app-blocker">
            <AlertDescription>{blocker}</AlertDescription>
          </Alert>
        ) : null}
        <Button size="lg" className="h-14 text-body" leadingIcon={<Play />} data-testid="mtsr-app-new" disabled={!canStart} onClick={onNew}>
          Nova vistoria
        </Button>
      </section>

      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-h4 font-semibold text-fg">Minhas vistorias</h2>
          {history.length > HOME_HISTORY_LIMIT ? (
            <Button variant="ghost" size="sm" trailingIcon={<ArrowRight />} onClick={onHistory}>
              Ver todas ({fmtInt(history.length)})
            </Button>
          ) : null}
        </div>
        {canExecute ? (
          <MyInspectionsList history={history} limit={HOME_HISTORY_LIMIT} onOpen={onOpen} />
        ) : (
          <p className="text-body-sm text-fg-muted">O histórico de vistorias aparece para quem está autorizado a executá-las.</p>
        )}
      </section>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function VehicleScreen({
  loadVehicles,
  onBack,
  onPick,
}: {
  loadVehicles: MtsrAppLoaders["loadVehicles"];
  onBack: () => void;
  onPick: (vehicle: MtsrAppVehicle) => Promise<void>;
}) {
  const [search, setSearch] = React.useState("");
  const [query, setQuery] = React.useState("");
  const [reload, setReload] = React.useState(0);
  const [result, setResult] = React.useState<{ key: string; rows?: MtsrAppVehicle[]; error?: string } | null>(null);
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

  const pick = async (vehicle: MtsrAppVehicle) => {
    setPicking(vehicle.id);
    try {
      await onPick(vehicle);
    } finally {
      setPicking(null);
    }
  };

  return (
    <div className="flex flex-col gap-4" data-testid="mtsr-app-vehicles">
      <AppTopBar label="Escolher frota" onBack={onBack} />
      <header className="flex flex-col gap-1">
        <h2 className="text-h3 font-semibold text-fg">Qual frota você vai vistoriar?</h2>
        <p className="text-body-sm text-fg-secondary">Só aparecem frotas do seu escopo habilitadas para a Vistoria MTSR (Operação e Tipo de equipamento).</p>
      </header>

      <SearchField
        size="lg"
        value={search}
        onValueChange={setSearch}
        placeholder="Buscar por placa ou frota"
        aria-label="Buscar por placa ou frota"
        inputMode="search"
        autoComplete="off"
        data-testid="mtsr-app-search"
      />

      {!loading && result?.error ? (
        <ErrorState title="Não foi possível listar as frotas." description={result.error} onRetry={() => setReload((n) => n + 1)} />
      ) : null}

      {loading && !result?.rows ? <LoadingState variant="block" label="Carregando frotas…" /> : null}

      {result?.rows && !result.error ? (
        rows.length === 0 ? (
          <EmptyState
            variant="panel"
            icon={<Truck />}
            title={query ? "Nenhuma frota encontrada" : "Nenhuma frota disponível"}
            description={
              query
                ? `Nenhuma placa ou frota corresponde a “${query}”. Confira a digitação ou limpe a busca.`
                : "Nenhuma frota do seu escopo está habilitada para a Vistoria MTSR. Fale com a Segurança ou com a administração."
            }
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

function VehicleButton({ vehicle: v, busy, disabled, onClick }: { vehicle: MtsrAppVehicle; busy: boolean; disabled: boolean; onClick: () => void }) {
  const place = [v.cityName, v.stateUf].filter(Boolean).join("/");
  const where = [v.vehicleTypeName, v.operationName, place].filter(Boolean).join(" · ");
  return (
    <button
      type="button"
      data-testid="mtsr-app-vehicle"
      data-deadline={v.deadlineStatus}
      disabled={disabled}
      onClick={onClick}
      className="flex w-full flex-col gap-2 rounded-lg border border-border bg-surface-raised p-4 text-left shadow-card hfm-transition hover:border-border-strong hover:shadow-card-hover hfm-focus-ring disabled:opacity-60"
    >
      <span className="flex w-full items-start gap-3">
        {busy ? <Spinner size="md" className="mt-0.5" label="Abrindo a vistoria" /> : <Truck className="mt-0.5 size-5 shrink-0 text-fg-muted" aria-hidden />}
        <span className="min-w-0 flex-1">
          <span className="block text-body font-semibold text-fg">
            {v.licensePlate}
            {v.fleetCode ? <span className="font-normal text-fg-muted"> · Frota {v.fleetCode}</span> : null}
          </span>
          <span className="block text-caption text-fg-muted">{where || "—"}</span>
        </span>
        <DeadlineBadge value={v.deadlineStatus} size="sm" />
      </span>
      <span className="flex w-full flex-wrap items-center gap-1.5 pl-8 text-caption text-fg-muted">
        <span>
          {v.lastValidInspectionDate
            ? `Última vistoria válida ${formatDate(v.lastValidInspectionDate)}${v.daysSince != null ? ` (há ${fmtDays(v.daysSince)})` : ""}`
            : "Sem vistoria válida"}
        </span>
        {v.nokCount > 0 ? (
          <Badge variant="danger" appearance="soft" size="sm">
            {fmtInt(v.nokCount)} NOK
          </Badge>
        ) : null}
        {v.pendingInspection ? (
          <Badge variant="warning" appearance="soft" size="sm">
            Vistoria pendente de validação
          </Badge>
        ) : null}
      </span>
    </button>
  );
}

/* -------------------------------------------------------------------------- */

function HistoryScreen({ history, onBack, onOpen }: { history: MtsrInspectionDetail[]; onBack: () => void; onOpen: (id: string) => void }) {
  return (
    <div className="flex flex-col gap-4" data-testid="mtsr-app-history-screen">
      <AppTopBar label="Minhas vistorias" onBack={onBack} />
      <header className="flex flex-col gap-1">
        <h2 className="text-h3 font-semibold text-fg">Minhas vistorias</h2>
        <p className="text-body-sm text-fg-secondary">
          {history.length === 0 ? "Nada enviado ainda." : `As últimas ${fmtInt(history.length)} vistorias enviadas por você, com a situação da validação.`}
        </p>
      </header>
      <MyInspectionsList history={history} onOpen={onOpen} />
    </div>
  );
}
