"use client";

import * as React from "react";
import { ClipboardList, EyeOff, Play, Trash2, Truck, UserRound } from "lucide-react";
import { cn } from "@/lib/cn";
import { PageContent, PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { SearchField } from "@/components/ui/search-field";
import { StatusBadge } from "@/components/ui/status-badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/feedback/alert";
import { EmptyState } from "@/components/feedback/empty-state";
import { ErrorState } from "@/components/feedback/error-state";
import { LoadingState } from "@/components/feedback/loading-state";
import { useConfirm } from "@/components/feedback/confirm-dialog";
import {
  loadMyTireInspectionDetail,
  loadMyTireInspections,
  loadTireAppContext,
  loadTireAppPositions,
  loadTireAppVehicles,
  submitTireInspection,
  type Result,
  type TireAppSubmitInput,
} from "@/lib/tires/app-actions";
import {
  fmtInt,
  formatDate,
  formatStamp,
  plural,
  TIRES_PERMISSION_CODES,
  type TireAppContext,
  type TireAppPositions,
  type TireAppSubmitResult,
  type TireAppVehicle,
  type TireAppVehicles,
  type TireMyInspectionDetail,
  type TireMyInspections,
} from "@/lib/tires/types";
import { clearDraft, measuredCount, useStoredDrafts, type TireDraft } from "./draft";
import { AppBar, Screen, TireRunner, type RunnerStart } from "./tire-runner";
import { MyTireInspectionDetail, MyTireInspections, type RedoTarget } from "./my-tire-inspections";

/**
 * Aplicativos → Vistoria de Pneus, mobile-first, na sequência:
 *
 *   início → frota → medição (diagrama de eixos) → revisão → envio → protocolo
 *                                                         ↘ minhas vistorias → detalhe → refazer
 *
 * LEITURA CEGA: antes e durante a medição a pessoa vê só as posições do
 * veículo — nunca Nº Fogo esperado, sulco, PSI, datas ou situação da
 * fotografia oficial. A comparação é feita no banco no envio, e a vistoria não
 * altera a fotografia oficial: vai para revisão e é conciliada com o próximo
 * Rodopar. A busca de frotas roda no servidor (escopo e elegibilidade do app);
 * o rascunho e a chave de idempotência ficam no aparelho (`draft.ts`).
 */
export interface TiresAppLoaders {
  context: () => Promise<Result<TireAppContext>>;
  vehicles: (search: string | null) => Promise<Result<TireAppVehicles>>;
  positions: (vehicleId: string) => Promise<Result<TireAppPositions>>;
  submit: (input: TireAppSubmitInput) => Promise<Result<TireAppSubmitResult>>;
  myInspections: () => Promise<Result<TireMyInspections>>;
  myDetail: (id: string) => Promise<Result<TireMyInspectionDetail>>;
}

const DEFAULT_LOADERS: TiresAppLoaders = {
  context: () => loadTireAppContext(),
  vehicles: (search) => loadTireAppVehicles(search),
  positions: (vehicleId) => loadTireAppPositions(vehicleId),
  submit: (input) => submitTireInspection(input),
  myInspections: () => loadMyTireInspections(),
  myDetail: (id) => loadMyTireInspectionDetail(id),
};

export interface TiresAppProps {
  /** Injeção para a prévia sem sessão. Deve ser um objeto estável (módulo ou memo). */
  loaders?: TiresAppLoaders;
  canExecute: boolean;
}

type Origin = "home" | "vehicles" | "history" | "detail";
type ScreenState =
  | { name: "home" }
  | { name: "vehicles" }
  | { name: "history" }
  | { name: "detail"; id: string; from: "home" | "history" }
  | { name: "runner"; start: RunnerStart; from: Origin; detailId?: string; seq: number };

const CONNECTION_ERROR = "Não foi possível falar com o servidor. Verifique a conexão e tente de novo.";

function greeting(): string {
  const h = new Date().getHours();
  if (h >= 5 && h < 12) return "Bom dia";
  if (h >= 12 && h < 18) return "Boa tarde";
  return "Boa noite";
}
const noSubscription = () => () => {};
/** A saudação depende do relógio do aparelho: no servidor (outro fuso) fica neutra, sem divergir na hidratação. */
const useGreeting = () => React.useSyncExternalStore(noSubscription, greeting, () => "Olá");

export function TiresApp({ loaders = DEFAULT_LOADERS, canExecute }: TiresAppProps) {
  const confirm = useConfirm();
  const [screen, setScreen] = React.useState<ScreenState>({ name: "home" });
  const [ctxAttempt, setCtxAttempt] = React.useState(0);
  const [ctx, setCtx] = React.useState<{ key: number; data?: TireAppContext; error?: string } | null>(null);
  const runSeq = React.useRef(0);
  const transitioned = React.useRef(false);

  React.useEffect(() => {
    if (!canExecute) return;
    let active = true;
    loaders.context().then(
      (r) => {
        if (!active) return;
        setCtx((previous) =>
          r.ok && r.data
            ? { key: ctxAttempt, data: r.data }
            : { key: ctxAttempt, data: previous?.data, error: r.error ?? "Não foi possível abrir a Vistoria de Pneus." },
        );
      },
      () => {
        if (active) setCtx((previous) => ({ key: ctxAttempt, data: previous?.data, error: CONNECTION_ERROR }));
      },
    );
    return () => {
      active = false;
    };
  }, [canExecute, loaders, ctxAttempt]);

  // Foco no título de cada tela ao trocar de etapa (o executor cuida das suas).
  React.useEffect(() => {
    if (!transitioned.current || screen.name === "runner") return;
    const el = document.getElementById("tires-app-screen-heading");
    el?.focus({ preventScroll: true });
    window.scrollTo({ top: 0 });
  }, [screen]);

  const context = ctx?.data ?? null;
  const ctxLoading = canExecute && ctx?.key !== ctxAttempt && !context;
  const ctxError = canExecute && ctx?.key === ctxAttempt && !context ? (ctx?.error ?? null) : null;
  const scope = context?.actor.userId ?? "anon";
  const drafts = useStoredDrafts(scope);

  const blocker: { title: string; text: string } | null = !canExecute
    ? {
        title: "Sem autorização para vistoriar",
        text: `Você pode ver este aplicativo, mas não foi autorizado a executar vistorias. Peça à administração a permissão “Executar Vistoria de Pneus” (${TIRES_PERMISSION_CODES.appExecute}).`,
      }
    : !context
      ? null
      : !context.app
        ? { title: "Aplicativo não cadastrado", text: "O aplicativo Vistoria de Pneus não está cadastrado nesta organização. Fale com a administração." }
        : !context.app.isActive
          ? { title: "Aplicativo inativo", text: "O aplicativo Vistoria de Pneus está inativo nesta organização. Fale com a administração para reativá-lo." }
          : !context.hasOfficialPhoto
            ? {
                title: "Ainda sem fotografia oficial",
                text: "Nenhuma fotografia oficial do Rodopar foi importada ainda. A vistoria só pode ser registrada depois da primeira importação, porque é com ela que a equipe compara as leituras. Fale com a equipe de Gestão de Pneus.",
              }
            : null;
  const canStart = canExecute && !!context && blocker === null;

  const go = (next: ScreenState) => {
    transitioned.current = true;
    setScreen(next);
  };

  const startRunner = (start: RunnerStart, from: Origin, detailId?: string) => {
    runSeq.current += 1;
    go({ name: "runner", start, from, detailId, seq: runSeq.current });
  };

  const backFromRunner = (s: Extract<ScreenState, { name: "runner" }>) => {
    if (s.from === "detail" && s.detailId) go({ name: "detail", id: s.detailId, from: "history" });
    else if (s.from === "history") go({ name: "history" });
    else if (s.from === "home") go({ name: "home" });
    else go({ name: "vehicles" });
  };

  const continueDraft = (draft: TireDraft) => startRunner({ vehicleId: draft.vehicle.id, vehicle: draft.vehicle, resume: true }, "home");

  const discardDraft = async (draft: TireDraft) => {
    const n = measuredCount(draft);
    const ok = await confirm({
      title: "Descartar o rascunho?",
      description: draft.lastAttemptAt
        ? `As leituras de ${draft.vehicle.licensePlate} (${fmtInt(n)} ${plural(n, "posição", "posições")}) serão apagadas deste aparelho. Um envio deste rascunho já foi tentado: se ele chegou ao servidor, a vistoria aparece em “Minhas vistorias”.`
        : `As leituras de ${draft.vehicle.licensePlate} (${fmtInt(n)} ${plural(n, "posição", "posições")}) serão apagadas deste aparelho. Nada foi enviado.`,
      confirmLabel: "Descartar",
      cancelLabel: "Manter",
      destructive: true,
    });
    if (ok) clearDraft(scope, draft.vehicle.id);
  };

  const redo = (target: RedoTarget, from: "history" | "detail", detailId?: string) =>
    startRunner({ vehicleId: target.vehicleId, vehicle: target.vehicle, parent: target.parent }, from, detailId);

  const title = context?.app?.name ?? "Vistoria de Pneus";

  return (
    <div data-testid="tires-app" className="flex min-h-0 flex-1 flex-col">
      {/* Fora do início, no celular, a barra do aplicativo faz as vezes de cabeçalho:
          o título continua para leitores de tela e a tela ganha espaço para medir. */}
      <PageHeader
        eyebrow="Aplicativos"
        title={title}
        className={screen.name === "home" ? undefined : "max-sm:sr-only"}
        description={
          screen.name === "home"
            ? "Vistoria de campo dos pneus com leitura cega. O envio vai para revisão da equipe; a fotografia oficial só muda com o Rodopar."
            : undefined
        }
      />
      <PageContent className="flex w-full max-w-none flex-col gap-4">
        {screen.name === "home" ? (
          <HomeScreen
            context={context}
            loading={ctxLoading}
            error={ctxError}
            canExecute={canExecute}
            canStart={canStart}
            blocker={blocker}
            drafts={canStart ? drafts : []}
            onRetry={() => setCtxAttempt((n) => n + 1)}
            onNew={() => go({ name: "vehicles" })}
            onHistory={() => go({ name: "history" })}
            onContinue={continueDraft}
            onDiscard={(d) => void discardDraft(d)}
          />
        ) : null}

        {screen.name === "vehicles" && context ? (
          <VehicleScreen
            loadVehicles={loaders.vehicles}
            drafts={drafts}
            onBack={() => go({ name: "home" })}
            onPick={(v) =>
              startRunner(
                {
                  vehicleId: v.id,
                  vehicle: {
                    id: v.id,
                    licensePlate: v.licensePlate,
                    fleetCode: v.fleetCode,
                    vehicleTypeName: v.vehicleTypeName,
                    operationName: v.operationName,
                    cityName: v.cityName,
                    stateUf: v.stateUf,
                  },
                },
                "vehicles",
              )
            }
          />
        ) : null}

        {screen.name === "runner" && context ? (
          <TireRunner
            key={screen.seq}
            start={screen.start}
            context={context}
            scope={scope}
            loaders={loaders}
            onBack={() => backFromRunner(screen)}
            onDone={(to) => {
              setCtxAttempt((n) => n + 1);
              go({ name: to });
            }}
          />
        ) : null}

        {screen.name === "history" && canExecute ? (
          <MyTireInspections
            loaders={loaders}
            canRedo={canStart}
            onBack={() => go({ name: "home" })}
            onOpen={(id) => go({ name: "detail", id, from: "history" })}
            onRedo={(target) => redo(target, "history")}
          />
        ) : null}

        {screen.name === "detail" && canExecute ? (
          <MyTireInspectionDetail
            key={screen.id}
            inspectionId={screen.id}
            loaders={loaders}
            canRedo={canStart}
            onBack={() => go({ name: screen.from })}
            onRedo={(target) => redo(target, "detail", screen.id)}
          />
        ) : null}
      </PageContent>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function HomeScreen({
  context,
  loading,
  error,
  canExecute,
  canStart,
  blocker,
  drafts,
  onRetry,
  onNew,
  onHistory,
  onContinue,
  onDiscard,
}: {
  context: TireAppContext | null;
  loading: boolean;
  error: string | null;
  canExecute: boolean;
  canStart: boolean;
  blocker: { title: string; text: string } | null;
  drafts: TireDraft[];
  onRetry: () => void;
  onNew: () => void;
  onHistory: () => void;
  onContinue: (draft: TireDraft) => void;
  onDiscard: (draft: TireDraft) => void;
}) {
  const hello = useGreeting();
  const pending = context?.counts.minePending ?? null;
  const returned = context?.counts.mineReturned ?? null;
  return (
    <Screen>
      <div className="flex flex-col gap-4" data-testid="tires-app-home">
        <h2 id="tires-app-screen-heading" tabIndex={-1} className="sr-only">
          Início
        </h2>

        {/* Quem vistoria aparece antes de qualquer ação: é o que permite perceber,
            ainda na primeira tela, que se entrou com a conta errada. */}
        {canExecute ? (
          <section className="flex items-center gap-3 rounded-lg border border-border bg-surface-raised p-4 shadow-card" data-testid="tires-app-actor">
            <span className="flex size-12 shrink-0 items-center justify-center rounded-full bg-primary-soft text-primary-soft-fg">
              <UserRound className="size-6" aria-hidden />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-caption text-fg-muted">{hello}, vistoriador(a)</p>
              {loading ? (
                <p className="text-body font-semibold text-fg-muted">Carregando…</p>
              ) : (
                <p className="truncate text-h3 font-semibold text-fg">{context?.actor.name ?? "—"}</p>
              )}
              {context ? (
                <p className="text-caption text-fg-muted">{context.actor.code ? `Matrícula ${context.actor.code}` : "Sem matrícula vinculada ao seu usuário"}</p>
              ) : null}
            </div>
          </section>
        ) : null}

        <section className="flex items-start gap-3 rounded-lg border border-info-border bg-info-soft p-4" data-testid="tires-app-blind">
          <EyeOff className="mt-0.5 size-5 shrink-0 text-info" aria-hidden />
          <div className="min-w-0">
            <h3 className="text-body font-semibold text-fg">Leitura cega</h3>
            <p className="text-body-sm text-info-soft-fg">
              Você vê só as posições do veículo. Anote exatamente o que ler em cada pneu — Nº Fogo, sulcos e PSI. A equipe compara com a base oficial depois do
              envio; a vistoria não altera a fotografia oficial.
            </p>
          </div>
        </section>

        {error ? <ErrorState variant="inline" title="Não foi possível abrir a Vistoria de Pneus." description={error} onRetry={onRetry} /> : null}
        {loading ? <LoadingState variant="block" label="Abrindo a Vistoria de Pneus…" /> : null}

        {blocker ? (
          <Alert variant={canExecute ? "warning" : "info"} data-testid="tires-app-blocker">
            <AlertTitle>{blocker.title}</AlertTitle>
            <AlertDescription>{blocker.text}</AlertDescription>
          </Alert>
        ) : null}

        {canExecute && context ? (
          <div className="grid grid-cols-2 gap-2" data-testid="tires-app-counts">
            <CountTile label="Pendentes" hint="em revisão ou aguardando Rodopar" value={pending} tone="neutral" onClick={onHistory} />
            <CountTile
              label="Retornadas"
              hint={returned ? "refaça a medição" : "nada a refazer"}
              value={returned}
              tone={returned ? "danger" : "neutral"}
              onClick={onHistory}
            />
          </div>
        ) : null}

        {drafts.length > 0 ? (
          <section className="flex flex-col gap-2" aria-labelledby="tires-app-drafts-title" data-testid="tires-app-drafts">
            <h3 id="tires-app-drafts-title" className="text-h4 font-semibold text-fg">
              Em andamento neste aparelho
            </h3>
            <ul className="flex flex-col gap-2">
              {drafts.map((d) => {
                const n = measuredCount(d);
                return (
                  <li key={d.vehicle.id} className="flex flex-col gap-3 rounded-lg border border-warning-border bg-warning-soft p-4 shadow-card" data-testid="tires-app-draft">
                    <div className="min-w-0">
                      <p className="text-body font-semibold text-fg">
                        {d.vehicle.licensePlate}
                        {d.vehicle.fleetCode ? <span className="font-normal text-fg-secondary"> · Frota {d.vehicle.fleetCode}</span> : null}
                      </p>
                      <p className="text-caption text-warning-soft-fg">
                        {fmtInt(n)} {plural(n, "posição com leitura", "posições com leitura")} · alterado em {formatStamp(d.updatedAt)}
                        {d.parentInspectionId ? " · nova medição de vistoria retornada" : ""}
                        {d.lastAttemptAt ? " · envio já tentado" : ""}
                      </p>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <Button size="lg" className="h-11" leadingIcon={<Play />} onClick={() => onContinue(d)} data-testid="tires-app-draft-continue">
                        Continuar
                      </Button>
                      <Button size="lg" variant="outline" className="h-11" leadingIcon={<Trash2 />} onClick={() => onDiscard(d)}>
                        Descartar
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        ) : null}

        <div className="flex flex-col gap-2">
          <Button size="lg" className="h-14 text-body" leadingIcon={<Play />} disabled={!canStart} onClick={onNew} data-testid="tires-app-new">
            Nova vistoria
          </Button>
          <Button
            size="lg"
            variant="secondary"
            className="h-12"
            leadingIcon={<ClipboardList />}
            disabled={!canExecute}
            onClick={onHistory}
            data-testid="tires-app-open-history"
          >
            Minhas vistorias
          </Button>
          {!canExecute ? <p className="text-caption text-fg-muted">O histórico aparece para quem está autorizado a executar a vistoria.</p> : null}
        </div>
      </div>
    </Screen>
  );
}

function CountTile({
  label,
  hint,
  value,
  tone,
  onClick,
}: {
  label: string;
  hint: string;
  value: number | null;
  tone: "danger" | "neutral";
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex min-h-20 min-w-0 flex-col items-start justify-start rounded-lg border bg-surface-raised px-3 py-2.5 text-left shadow-card hfm-transition hover:shadow-card-hover hfm-focus-ring",
        tone === "danger" ? "border-danger-border" : "border-border hover:border-border-strong",
      )}
    >
      <span className={cn("text-h1 font-semibold tabular-nums", tone === "danger" ? "text-danger" : "text-fg")}>{value == null ? "—" : fmtInt(value)}</span>
      <span className="text-body-sm font-medium text-fg">{label}</span>
      <span className="text-caption text-fg-muted">{hint}</span>
    </button>
  );
}

/* -------------------------------------------------------------------------- */

function VehicleScreen({
  loadVehicles,
  drafts,
  onBack,
  onPick,
}: {
  loadVehicles: TiresAppLoaders["vehicles"];
  drafts: TireDraft[];
  onBack: () => void;
  onPick: (vehicle: TireAppVehicle) => void;
}) {
  const [search, setSearch] = React.useState("");
  const [query, setQuery] = React.useState("");
  const [reload, setReload] = React.useState(0);
  const [result, setResult] = React.useState<{ key: string; data?: TireAppVehicles; error?: string } | null>(null);
  const key = `${query}\u0000${reload}`;
  const draftByVehicle = React.useMemo(() => new Map(drafts.map((d) => [d.vehicle.id, d])), [drafts]);

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
        setResult(r.ok && r.data ? { key, data: r.data } : { key, error: r.error ?? "Não foi possível listar as frotas." });
      },
      () => {
        if (active) setResult({ key, error: CONNECTION_ERROR });
      },
    );
    return () => {
      active = false;
    };
  }, [loadVehicles, query, key]);

  const loading = result?.key !== key;
  const data = result?.data;
  const rows = data?.vehicles ?? [];

  return (
    <Screen>
      <div className="flex flex-col gap-4" data-testid="tires-app-vehicles">
        <AppBar label="Escolher veículo" onBack={onBack} />
        <header className="flex flex-col gap-1">
          <h2 id="tires-app-screen-heading" tabIndex={-1} className="text-h3 font-semibold text-fg outline-none">
            Qual veículo você vai vistoriar?
          </h2>
          <p className="text-body-sm text-fg-secondary">Só aparecem frotas ativas do seu escopo, habilitadas para a Vistoria de Pneus.</p>
        </header>

        <SearchField
          size="lg"
          className="text-h3"
          value={search}
          onValueChange={setSearch}
          placeholder="Placa ou frota"
          aria-label="Buscar por placa ou frota"
          inputMode="search"
          autoCapitalize="characters"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          data-testid="tires-app-search"
        />

        {!loading && result?.error ? (
          <ErrorState title="Não foi possível listar as frotas." description={result.error} onRetry={() => setReload((n) => n + 1)} />
        ) : null}

        {loading && !data ? <LoadingState variant="block" label="Carregando frotas…" /> : null}

        {data && !result?.error ? (
          !data.appAvailable ? (
            <EmptyState
              variant="panel"
              icon={<Truck />}
              title="Aplicativo indisponível"
              description="A Vistoria de Pneus não está ativa nesta organização. Fale com a administração."
            />
          ) : rows.length === 0 ? (
            <EmptyState
              variant="panel"
              icon={<Truck />}
              title={query ? "Nenhuma frota encontrada" : "Nenhuma frota disponível"}
              description={
                query
                  ? `Nenhuma placa ou frota corresponde a “${query}”. Confira a digitação ou limpe a busca.`
                  : "Nenhuma frota do seu escopo está habilitada para a Vistoria de Pneus (Operação e Tipo de equipamento). Fale com a equipe de Gestão de Pneus."
              }
            />
          ) : (
            <>
              <p className="text-caption text-fg-muted" aria-live="polite" data-testid="tires-app-vehicles-count">
                {data.total > rows.length
                  ? `Mostrando ${fmtInt(rows.length)} de ${fmtInt(data.total)} frotas — refine a busca por placa ou frota.`
                  : `${fmtInt(data.total)} ${plural(data.total, "frota", "frotas")}${query ? ` para “${query}”` : ""}.`}
              </p>
              <ul className={cn("flex flex-col gap-2 hfm-transition", loading && "opacity-60")} aria-busy={loading || undefined}>
                {rows.map((v) => (
                  <li key={v.id}>
                    <VehicleCard vehicle={v} draft={draftByVehicle.get(v.id) ?? null} busy={loading} onClick={() => onPick(v)} />
                  </li>
                ))}
              </ul>
            </>
          )
        ) : null}
      </div>
    </Screen>
  );
}

function VehicleCard({ vehicle: v, draft, busy, onClick }: { vehicle: TireAppVehicle; draft: TireDraft | null; busy: boolean; onClick: () => void }) {
  const place = [v.cityName, v.stateUf].filter(Boolean).join("/");
  const where = [v.operationName, place].filter(Boolean).join(" · ");
  const returned = !!v.returnedInspectionId;
  return (
    <button
      type="button"
      data-testid="tires-app-vehicle"
      data-returned={returned || undefined}
      disabled={busy}
      onClick={onClick}
      className={cn(
        "flex w-full flex-col gap-2 rounded-lg border bg-surface-raised p-4 text-left shadow-card hfm-transition hover:shadow-card-hover hfm-focus-ring disabled:opacity-60",
        returned ? "border-danger-border ring-1 ring-danger-border" : "border-border hover:border-border-strong",
      )}
    >
      <span className="flex w-full items-start gap-3">
        <Truck className="mt-0.5 size-5 shrink-0 text-fg-muted" aria-hidden />
        <span className="min-w-0 flex-1">
          <span className="block text-h3 font-semibold tracking-wide text-fg">{v.licensePlate}</span>
          <span className="block text-body-sm text-fg-secondary">
            {[v.fleetCode ? `Frota ${v.fleetCode}` : null, v.vehicleTypeName].filter(Boolean).join(" · ") || "—"}
          </span>
          {where ? <span className="block text-caption text-fg-muted">{where}</span> : null}
        </span>
        <span className="shrink-0 rounded-md bg-surface-secondary px-2 py-1 text-center text-caption text-fg-secondary">
          <span className="block text-body font-semibold tabular-nums text-fg">{fmtInt(v.positions)}</span>
          {plural(v.positions, "posição", "posições")}
        </span>
      </span>
      {returned || draft || v.lastInspectionDate ? (
        <span className="flex w-full flex-wrap items-center gap-1.5 pl-8 text-caption text-fg-muted">
          {returned ? (
            <StatusBadge status="danger" size="sm" withIcon>
              Retornada — refazer
            </StatusBadge>
          ) : null}
          {draft ? (
            <StatusBadge status="warning" size="sm">
              Rascunho salvo
            </StatusBadge>
          ) : null}
          {v.lastInspectionDate ? <span>Última vistoria em {formatDate(v.lastInspectionDate)}</span> : null}
        </span>
      ) : null}
    </button>
  );
}

