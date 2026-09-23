"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft, ArrowRight, ClipboardCheck, Eye, History, ListChecks, Play, Search, Settings2, Truck, UserRound,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { PageContent, PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription, AlertTitle } from "@/components/feedback/alert";
import { EmptyState } from "@/components/feedback/empty-state";
import { Spinner } from "@/components/feedback/spinner";
import type { ChecklistContext, ChecklistForm, ChecklistType, ExecutionSummary } from "@/lib/applications/queries";
import {
  loadChecklistForm, loadEquipmentOptions, loadVehicleOptions,
  type EquipmentOption, type VehicleOption,
} from "@/lib/applications/actions";
import { ChecklistRunner, TopBar, formatDuration, greeting, type RunnerStart, type SubmitFn } from "./checklist-runner";
import { ExecutionDetailDrawer } from "./execution-detail-drawer";
import { ScopeHistory } from "./scope-history";

const number = new Intl.NumberFormat("pt-BR");

function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function formatDate(value: string): string {
  const [y, m, d] = value.split("-");
  return d ? `${d}/${m}/${y}` : value;
}

type Screen = "home" | "tipo" | "operacao" | "equipamento" | "placa" | "running" | "history" | "scope";

/** Tudo o que o aplicativo pede ao servidor, injetável para a prévia sem sessão. */
export interface ChecklistLoaders {
  loadEquipmentOptions: typeof loadEquipmentOptions;
  loadVehicleOptions: typeof loadVehicleOptions;
  loadChecklistForm: typeof loadChecklistForm;
  submit?: SubmitFn;
  loadExecutionDetail?: React.ComponentProps<typeof ExecutionDetailDrawer>["loader"];
  loadScopeExecutions?: React.ComponentProps<typeof ScopeHistory>["loader"];
  /** Correção administrativa (§60): formulário e rotina. */
  correction?: React.ComponentProps<typeof ExecutionDetailDrawer>["correctionLoaders"];
}

const DEFAULT_LOADERS: ChecklistLoaders = { loadEquipmentOptions, loadVehicleOptions, loadChecklistForm };

export interface ChecklistAppProps {
  context: ChecklistContext;
  history: ExecutionSummary[];
  canExecute: boolean;
  canViewOwn: boolean;
  canViewScope?: boolean;
  canConfigure: boolean;
  /** `applications.checklist_fleet.correct`: "Corrigir execução" no detalhe (§60). */
  canCorrect?: boolean;
  loaders?: ChecklistLoaders;
}

/**
 * Check List de Frota — a sequência do aplicativo de referência (§28):
 *
 *   início → tipo → operação → tipo de equipamento → frota/placa → execução
 *
 * Cada seleção filtra a seguinte NO SERVIDOR: a tela só conhece o resultado.
 * Trocar a operação descarta tipo e placa (§32); trocar o tipo descarta a placa
 * (§35). Tudo o que é administração fica atrás de permissão e fora do caminho
 * de quem está saindo para rota.
 */
export function ChecklistApp({
  context,
  history,
  canExecute,
  canViewOwn,
  canViewScope = false,
  canConfigure,
  canCorrect = false,
  loaders = DEFAULT_LOADERS,
}: ChecklistAppProps) {
  const router = useRouter();
  const [screen, setScreen] = React.useState<Screen>("home");
  const [checklistType, setChecklistType] = React.useState<ChecklistType | null>(null);
  const [operationId, setOperationId] = React.useState<string>("");
  const [equipment, setEquipment] = React.useState<EquipmentOption | null>(null);
  const [equipmentOptions, setEquipmentOptions] = React.useState<EquipmentOption[] | null>(null);
  const [vehicles, setVehicles] = React.useState<VehicleOption[] | null>(null);
  const [search, setSearch] = React.useState("");
  const [loading, startLoading] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);
  const [runnerStart, setRunnerStart] = React.useState<RunnerStart | null>(null);
  const [idempotencyKey, setIdempotencyKey] = React.useState("");
  const [startedAt, setStartedAt] = React.useState<string | null>(null);
  const [elapsed, setElapsed] = React.useState(0);
  const [detailId, setDetailId] = React.useState<string | null>(null);

  const selecting = screen === "tipo" || screen === "operacao" || screen === "equipamento" || screen === "placa";

  // §39: o cronômetro começa no "Iniciar", como no app de referência, e é só
  // informativo — quem valida o tempo é o servidor.
  React.useEffect(() => {
    if (!startedAt || !selecting) return;
    const id = window.setInterval(() => {
      setElapsed(Math.max(0, Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000)));
    }, 1000);
    return () => window.clearInterval(id);
  }, [startedAt, selecting]);

  const operationName = context.operations.find((o) => o.id === operationId)?.name ?? "—";

  const start = () => {
    setError(null);
    setChecklistType(null);
    setOperationId("");
    setEquipment(null);
    setEquipmentOptions(null);
    setVehicles(null);
    setSearch("");
    setStartedAt(new Date().toISOString());
    setElapsed(0);
    setScreen("tipo");
  };

  const pickType = (type: ChecklistType) => {
    setChecklistType(type);
    setScreen("operacao");
  };

  const pickOperation = (id: string) => {
    setError(null);
    // §32: outra operação invalida o tipo e a placa escolhidos antes.
    if (id !== operationId) {
      setOperationId(id);
      setEquipment(null);
      setEquipmentOptions(null);
      setVehicles(null);
      setSearch("");
      startLoading(async () => {
        const result = await loaders.loadEquipmentOptions(id, today());
        if (!result.ok) {
          setError(result.error ?? "Não foi possível carregar os tipos de equipamento.");
          setEquipmentOptions([]);
          return;
        }
        setEquipmentOptions(result.data ?? []);
      });
    }
    setScreen("equipamento");
  };

  const pickEquipment = (option: EquipmentOption) => {
    setError(null);
    // §35: outro tipo invalida a placa escolhida antes.
    if (option.id !== equipment?.id) {
      setEquipment(option);
      setVehicles(null);
      setSearch("");
      startLoading(async () => {
        const result = await loaders.loadVehicleOptions(operationId, option.id, "", today());
        if (!result.ok) {
          setError(result.error ?? "Não foi possível carregar os veículos.");
          setVehicles([]);
          return;
        }
        setVehicles(result.data ?? []);
      });
    }
    setScreen("placa");
  };

  const pickVehicle = (vehicle: VehicleOption) => {
    setError(null);
    startLoading(async () => {
      // §38: o servidor confere a combinação de novo antes de abrir as perguntas.
      const result = await loaders.loadChecklistForm(vehicle.id, operationId);
      if (!result.ok || !result.data) {
        setError(result.error ?? "Não foi possível carregar o formulário.");
        return;
      }
      const form: ChecklistForm = result.data;
      setRunnerStart({
        form,
        operationId,
        operationName,
        checklistType: checklistType ?? "saida",
        operationalDate: today(),
        vehicleLabel: vehicle.licensePlate ?? vehicle.fleetCode ?? "veículo",
        brCode: vehicle.brCode,
        equipmentName: equipment?.name ?? vehicle.vehicleTypeName,
        actorName: context.actor?.name ?? null,
        actorCode: context.actor?.employeeCode ?? null,
        startedAt,
      });
      // §52: a chave nasce aqui, antes de qualquer envio, e acompanha todas as
      // tentativas desta mesma execução.
      setIdempotencyKey(crypto.randomUUID());
      setScreen("running");
    });
  };

  const reset = () => {
    setScreen("home");
    setChecklistType(null);
    setOperationId("");
    setEquipment(null);
    setEquipmentOptions(null);
    setVehicles(null);
    setSearch("");
    setRunnerStart(null);
    setStartedAt(null);
    setError(null);
    router.refresh();
  };

  if (!context.available) {
    return (
      <>
        <PageHeader title="Check List de Frota" />
        <PageContent>
          <Alert variant="warning">
            <AlertTitle>O aplicativo ainda não está disponível</AlertTitle>
            <AlertDescription>
              {context.reason === "sem_versao"
                ? "Nenhuma versão do formulário foi publicada para esta organização."
                : context.reason === "inativo"
                  ? "O aplicativo está inativo para esta organização."
                  : "O aplicativo não está cadastrado nesta organização."}
            </AlertDescription>
          </Alert>
        </PageContent>
      </>
    );
  }

  const stepBack = () => {
    if (screen === "tipo") return setScreen("home");
    if (screen === "operacao") return setScreen("tipo");
    if (screen === "equipamento") return setScreen("operacao");
    if (screen === "placa") return setScreen("equipamento");
  };

  const stepLabel =
    screen === "tipo" ? "Tipo de Check List"
      : screen === "operacao" ? "Tipo de Operação"
        : screen === "equipamento" ? "Tipo de Equipamento"
          : "Frota / Placa";

  const filteredVehicles = (vehicles ?? []).filter((v) => {
    const term = search.trim().toUpperCase();
    if (!term) return true;
    return (v.licensePlate ?? "").toUpperCase().includes(term) || (v.fleetCode ?? "").toUpperCase().includes(term);
  });

  return (
    <>
      <PageHeader
        title={context.appName}
        description={
          context.version
            ? `Formulário versão ${context.version.label}. Inspeção de saída e retorno de rota.`
            : undefined
        }
        secondaryActions={
          canConfigure ? (
            <Button
              variant="secondary"
              leadingIcon={<Settings2 />}
              onClick={() => router.push("/aplicativos/check-list-frota/configuracao")}
            >
              Configurar
            </Button>
          ) : undefined
        }
      />

      <PageContent className={cn("mx-auto flex w-full flex-col gap-4", screen === "scope" ? "max-w-6xl" : "max-w-2xl")}>
        {error ? (
          <Alert variant="danger">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}

        {screen === "home" ? (
          <HomeScreen
            context={context}
            history={history}
            canExecute={canExecute}
            canViewOwn={canViewOwn}
            canViewScope={canViewScope}
            onStart={start}
            onHistory={() => setScreen("history")}
            onScope={() => setScreen("scope")}
          />
        ) : null}

        {selecting ? (
          <div className="flex flex-col gap-4" data-testid={`step-${screen}`}>
            <TopBar label={stepLabel} answered={0} total={0} elapsed={elapsed} onBack={stepBack} />

            {screen === "tipo" ? (
              <PickerScreen
                title="Tipo de Check List"
                description="Escolha o momento da inspeção."
                options={[
                  { id: "saida", label: "Saída para rota", icon: <ArrowRight className="size-5 text-primary" aria-hidden /> },
                  { id: "retorno", label: "Retorno de rota", icon: <ArrowLeft className="size-5 text-primary" aria-hidden /> },
                ]}
                selectedId={checklistType}
                onPick={(id) => pickType(id as ChecklistType)}
              />
            ) : null}

            {screen === "operacao" ? (
              <PickerScreen
                title="Tipo de Operação"
                description="Só aparecem operações habilitadas para o aplicativo e dentro do seu escopo."
                options={context.operations.map((o) => ({ id: o.id, label: o.name }))}
                selectedId={operationId || null}
                onPick={pickOperation}
                emptyTitle="Nenhuma operação disponível"
                emptyDescription="Nenhuma operação do seu escopo está habilitada para o Check List de Frota. Fale com a administração."
              />
            ) : null}

            {screen === "equipamento" ? (
              equipmentOptions === null ? (
                <LoadingLine label="Carregando tipos de equipamento…" />
              ) : (
                <PickerScreen
                  title="Tipo de Equipamento"
                  description={`Tipos habilitados e com frota disponível em ${operationName}.`}
                  options={equipmentOptions.map((t) => ({
                    id: t.id,
                    label: t.name,
                    hint: `${number.format(t.vehicles)} ${t.vehicles === 1 ? "veículo" : "veículos"}`,
                  }))}
                  selectedId={equipment?.id ?? null}
                  onPick={(id) => {
                    const option = equipmentOptions.find((t) => t.id === id);
                    if (option) pickEquipment(option);
                  }}
                  emptyTitle="Nenhum tipo de equipamento disponível"
                  emptyDescription="Só aparecem tipos habilitados para o aplicativo e com veículos elegíveis nesta operação."
                />
              )
            ) : null}

            {screen === "placa" ? (
              vehicles === null ? (
                <LoadingLine label="Carregando veículos…" />
              ) : (
                <div className="flex flex-col gap-3">
                  <header className="flex flex-col gap-1">
                    <h2 className="text-h2 font-semibold text-fg">Frota / Placa</h2>
                    <p className="text-body-sm text-fg-secondary">
                      {equipment?.name ?? "Tipo"} em {operationName}. Só veículos vinculados à operação e elegíveis.
                    </p>
                  </header>

                  {vehicles.length === 0 ? (
                    <EmptyState
                      icon={<Truck />}
                      title="Nenhuma frota disponível"
                      description="Nenhuma frota disponível para a operação e o tipo de equipamento selecionados."
                    />
                  ) : (
                    <>
                      <Input
                        id="checklist-vehicle-search"
                        size="lg"
                        inputMode="search"
                        autoComplete="off"
                        value={search}
                        leadingIcon={<Search className="size-4" aria-hidden />}
                        placeholder="Filtrar por placa ou código de frota"
                        aria-label="Filtrar por placa ou código de frota"
                        onChange={(e) => setSearch(e.target.value)}
                      />
                      {filteredVehicles.length === 0 ? (
                        <p className="py-4 text-center text-body-sm text-fg-muted">
                          Nenhuma placa corresponde ao filtro.
                        </p>
                      ) : (
                        <ul className="flex flex-col gap-2">
                          {filteredVehicles.map((vehicle) => (
                            <li key={vehicle.id}>
                              <button
                                type="button"
                                onClick={() => pickVehicle(vehicle)}
                                disabled={loading}
                                className="flex min-h-16 w-full items-center gap-3 rounded-md border border-border bg-surface p-4 text-left hfm-transition hover:border-border-strong hfm-focus-ring disabled:opacity-60"
                              >
                                <Truck className="size-5 shrink-0 text-fg-muted" aria-hidden />
                                <span className="min-w-0 flex-1">
                                  <span className="block truncate text-body font-semibold text-fg">
                                    {vehicle.licensePlate ?? vehicle.fleetCode ?? "—"}
                                  </span>
                                  <span className="block truncate text-caption text-fg-muted">
                                    {vehicle.fleetCode && vehicle.licensePlate ? `Frota ${vehicle.fleetCode}` : vehicle.vehicleTypeName}
                                    {vehicle.brCode ? ` · ${vehicle.brCode}` : ""}
                                  </span>
                                </span>
                                {/* §33: o previsto pela fidelização vem marcado. */}
                                {vehicle.expected ? <Badge variant="primary" appearance="soft">Previsto</Badge> : null}
                                <ArrowRight className="size-5 shrink-0 text-fg-muted" aria-hidden />
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}
                    </>
                  )}
                </div>
              )
            ) : null}

            {loading && screen !== "equipamento" && screen !== "placa" ? (
              <LoadingLine label="Carregando…" />
            ) : null}
            {loading && screen === "placa" && vehicles !== null ? (
              <LoadingLine label="Abrindo o formulário…" />
            ) : null}
          </div>
        ) : null}

        {screen === "running" && runnerStart ? (
          <ChecklistRunner
            start={runnerStart}
            idempotencyKey={idempotencyKey}
            onFinished={reset}
            onCancel={() => setScreen("placa")}
            submit={loaders.submit}
          />
        ) : null}

        {screen === "history" ? (
          <HistoryScreen history={history} onBack={() => setScreen("home")} onOpen={setDetailId} />
        ) : null}

        {screen === "scope" ? (
          <div className="flex flex-col gap-4" data-testid="scope-history">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-h3 font-semibold text-fg">Checklists do escopo</h2>
              <Button variant="ghost" leadingIcon={<ArrowLeft />} onClick={() => setScreen("home")}>
                Voltar
              </Button>
            </div>
            <ScopeHistory
              operations={context.operations}
              loader={loaders.loadScopeExecutions}
              onOpenDetail={setDetailId}
            />
          </div>
        ) : null}
      </PageContent>

      <ExecutionDetailDrawer
        executionId={detailId}
        onOpenChange={(open: boolean) => {
          if (!open) setDetailId(null);
        }}
        loader={loaders.loadExecutionDetail}
        canCorrect={canCorrect}
        correctionLoaders={loaders.correction}
      />
    </>
  );
}

function LoadingLine({ label }: { label: string }) {
  return (
    <p className="flex items-center gap-2 py-4 text-body-sm text-fg-muted">
      <Spinner size="sm" /> {label}
    </p>
  );
}

function HomeScreen({
  context, history, canExecute, canViewOwn, canViewScope, onStart, onHistory, onScope,
}: {
  context: ChecklistContext;
  history: ExecutionSummary[];
  canExecute: boolean;
  canViewOwn: boolean;
  canViewScope: boolean;
  onStart: () => void;
  onHistory: () => void;
  onScope: () => void;
}) {
  return (
    <div className="flex flex-col gap-4" data-testid="checklist-home">
      {/* §29: quem está executando aparece antes de qualquer ação. É o que
          permite perceber, ainda na primeira tela, que se entrou com a conta
          errada — depois de 34 respostas seria tarde. */}
      <div className="flex flex-col items-center gap-3 rounded-md border border-border bg-surface p-6 text-center">
        <span className="flex size-16 items-center justify-center rounded-full bg-primary-soft text-primary-soft-fg">
          <UserRound className="size-8" aria-hidden />
        </span>
        <div>
          <p className="text-caption uppercase tracking-[0.2em] text-fg-muted">{greeting()},</p>
          <p className="text-h2 font-semibold text-fg">
            {context.actor?.name ?? "Colaborador não vinculado"}
          </p>
          <p className="text-body-sm text-fg-muted">
            {context.actor?.employeeCode
              ? `Matrícula ${context.actor.employeeCode}`
              : "Sem matrícula vinculada"}
          </p>
        </div>
        <span className="flex items-center gap-2 text-caption text-success">
          <span className="size-2 animate-pulse rounded-full bg-success" aria-hidden />
          Conectado
          {context.version ? <span className="text-fg-muted">· formulário {context.version.label}</span> : null}
        </span>
      </div>

      {!context.actor ? (
        <Alert variant="warning">
          <AlertTitle>Conta sem colaborador vinculado</AlertTitle>
          <AlertDescription>
            O checklist é registrado no nome de um colaborador. Peça à administração
            para vincular a sua conta antes de executar.
          </AlertDescription>
        </Alert>
      ) : null}

      {canExecute && context.actor ? (
        <Button size="lg" className="h-16 text-body" leadingIcon={<Play />} onClick={onStart}>
          Iniciar Check List
        </Button>
      ) : (
        <Alert variant="info">
          <AlertDescription>
            Você pode consultar este aplicativo, mas não foi autorizado a executá-lo.
          </AlertDescription>
        </Alert>
      )}

      {canViewOwn ? (
        <button
          type="button"
          onClick={onHistory}
          className="flex min-h-14 items-center gap-3 rounded-md border border-border bg-surface p-4 text-left hfm-transition hover:border-border-strong hfm-focus-ring"
        >
          <History className="size-5 shrink-0 text-fg-muted" aria-hidden />
          <span className="flex-1 text-body-sm font-medium text-fg">Meus checklists</span>
          <Badge variant="neutral">{number.format(history.length)}</Badge>
        </button>
      ) : null}

      {canViewScope ? (
        <button
          type="button"
          onClick={onScope}
          className="flex min-h-14 items-center gap-3 rounded-md border border-border bg-surface p-4 text-left hfm-transition hover:border-border-strong hfm-focus-ring"
        >
          <ListChecks className="size-5 shrink-0 text-fg-muted" aria-hidden />
          <span className="flex-1 text-body-sm font-medium text-fg">Checklists do escopo</span>
          <ArrowRight className="size-4 text-fg-muted" aria-hidden />
        </button>
      ) : null}
    </div>
  );
}

function PickerScreen({
  title, description, options, selectedId, onPick, emptyTitle, emptyDescription,
}: {
  title: string;
  description?: string;
  options: { id: string; label: string; hint?: string; icon?: React.ReactNode }[];
  selectedId: string | null;
  onPick: (id: string) => void;
  emptyTitle?: string;
  emptyDescription?: string;
}) {
  return (
    <div className="flex flex-col gap-3">
      <header className="flex flex-col gap-1">
        <h2 className="text-h2 font-semibold text-fg">{title}</h2>
        {description ? <p className="text-body-sm text-fg-secondary">{description}</p> : null}
      </header>
      {options.length === 0 ? (
        <EmptyState
          icon={<ClipboardCheck />}
          title={emptyTitle ?? "Nenhuma opção disponível"}
          description={emptyDescription}
        />
      ) : (
        <ul className="flex flex-col gap-2" role="list">
          {options.map((option) => {
            const active = option.id === selectedId;
            return (
              <li key={option.id}>
                <button
                  type="button"
                  onClick={() => onPick(option.id)}
                  aria-pressed={active}
                  className={cn(
                    "flex min-h-16 w-full items-center gap-3 rounded-md border bg-surface p-4 text-left hfm-transition hover:border-border-strong hfm-focus-ring active:scale-[0.99]",
                    active ? "border-primary bg-primary-soft" : "border-border",
                  )}
                >
                  {option.icon}
                  <span className="min-w-0 flex-1">
                    <span className={cn("block truncate text-body font-semibold", active ? "text-primary-soft-fg" : "text-fg")}>
                      {option.label}
                    </span>
                    {option.hint ? <span className="block text-caption text-fg-muted">{option.hint}</span> : null}
                  </span>
                  <ArrowRight className="size-5 shrink-0 text-fg-muted" aria-hidden />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function HistoryScreen({
  history, onBack, onOpen,
}: {
  history: ExecutionSummary[];
  onBack: () => void;
  onOpen: (id: string) => void;
}) {
  return (
    <div className="flex flex-col gap-3" data-testid="my-history">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-h3 font-semibold text-fg">Meus checklists</h2>
        <Button variant="ghost" leadingIcon={<ArrowLeft />} onClick={onBack}>
          Voltar
        </Button>
      </div>

      {history.length === 0 ? (
        <EmptyState
          icon={<History />}
          title="Nenhum checklist enviado ainda"
          description="O que você enviar aparece aqui, com o resultado da inspeção."
        />
      ) : (
        <ul className="flex flex-col gap-2">
          {history.map((item) => (
            <li
              key={item.id}
              className="flex flex-col gap-2 rounded-md border border-border bg-surface p-4"
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-body font-semibold text-fg">
                  {item.licensePlate ?? item.fleetCode ?? "—"}
                </span>
                <Badge variant={item.checklistType === "saida" ? "info" : "neutral"} appearance="soft">
                  {item.checklistType === "saida" ? "Saída" : "Retorno"}
                </Badge>
                <span className="ml-auto text-caption tabular-nums text-fg-muted">
                  {formatDate(item.operationalDate)}
                </span>
              </div>
              <p className="text-caption text-fg-muted">
                {item.operationName}
                {item.brCode ? ` · ${item.brCode}` : ""}
                {item.durationSeconds !== null ? ` · ${formatDuration(item.durationSeconds)}` : ""}
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="success">{number.format(item.conforming)} conformes</Badge>
                {item.nonConforming > 0 ? (
                  <Badge variant="warning">{number.format(item.nonConforming)} inconformes</Badge>
                ) : null}
                {item.criticalNonConforming > 0 ? (
                  <Badge variant="danger">{number.format(item.criticalNonConforming)} críticas</Badge>
                ) : null}
                <Button
                  variant="outline"
                  size="sm"
                  className="ml-auto"
                  leadingIcon={<Eye />}
                  onClick={() => onOpen(item.id)}
                >
                  Ver
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
