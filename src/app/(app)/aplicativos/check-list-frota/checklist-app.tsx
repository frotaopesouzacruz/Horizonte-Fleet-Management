"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  ClipboardCheck, History, LogOut, Search, Settings2, Truck, UserRound,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { PageContent, PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { FormField } from "@/components/ui/form-field";
import { NativeSelect } from "@/components/governance/selects";
import { Alert, AlertDescription, AlertTitle } from "@/components/feedback/alert";
import { EmptyState } from "@/components/feedback/empty-state";
import { Spinner } from "@/components/feedback/spinner";
import type { ChecklistContext, ChecklistForm, ChecklistType, ExecutionSummary } from "@/lib/applications/queries";
import { loadChecklistForm, loadVehicleOptions, type VehicleOption } from "@/lib/applications/actions";
import { ChecklistRunner, formatDuration, type RunnerStart } from "./checklist-runner";

const number = new Intl.NumberFormat("pt-BR");

function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function formatDate(value: string): string {
  const [y, m, d] = value.split("-");
  return d ? `${d}/${m}/${y}` : value;
}

type Screen = "home" | "setup" | "running" | "history";

/**
 * Check List de Frota.
 *
 * Um aplicativo, não uma tela de cadastro: o caminho do motorista é tocar em
 * "Iniciar checklist", escolher saída ou retorno, confirmar o veículo e
 * responder. Tudo o que é administração fica atrás de permissão e fora desse
 * caminho.
 */
export function ChecklistApp({
  context,
  history,
  canExecute,
  canViewOwn,
  canConfigure,
}: {
  context: ChecklistContext;
  history: ExecutionSummary[];
  canExecute: boolean;
  canViewOwn: boolean;
  canConfigure: boolean;
}) {
  const router = useRouter();
  const [screen, setScreen] = React.useState<Screen>("home");
  const [checklistType, setChecklistType] = React.useState<ChecklistType | null>(null);
  const [operationId, setOperationId] = React.useState(
    () => (context.operations.length === 1 ? context.operations[0].id : ""),
  );
  const [search, setSearch] = React.useState("");
  const [vehicles, setVehicles] = React.useState<VehicleOption[] | null>(null);
  const [loading, startLoading] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);
  const [runnerStart, setRunnerStart] = React.useState<RunnerStart | null>(null);
  const [idempotencyKey, setIdempotencyKey] = React.useState("");

  const operationName =
    context.operations.find((o) => o.id === operationId)?.name ?? "—";

  const fetchVehicles = (term: string) => {
    if (!operationId) return;
    setError(null);
    startLoading(async () => {
      const result = await loadVehicleOptions(operationId, term, today());
      if (!result.ok) {
        setError(result.error ?? "Não foi possível carregar os veículos.");
        return;
      }
      setVehicles(result.data ?? []);
    });
  };

  const chooseVehicle = (vehicle: VehicleOption) => {
    setError(null);
    startLoading(async () => {
      const result = await loadChecklistForm(vehicle.id, operationId);
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
    setVehicles(null);
    setSearch("");
    setRunnerStart(null);
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

      <PageContent className="mx-auto flex w-full max-w-2xl flex-col gap-4">
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
            onStart={() => {
              setScreen("setup");
              setVehicles(null);
              if (context.operations.length === 1) fetchVehicles("");
            }}
            onHistory={() => setScreen("history")}
          />
        ) : null}

        {screen === "setup" ? (
          <SetupScreen
            context={context}
            checklistType={checklistType}
            onType={setChecklistType}
            operationId={operationId}
            onOperation={(id) => {
              setOperationId(id);
              setVehicles(null);
            }}
            search={search}
            onSearch={setSearch}
            onFetch={fetchVehicles}
            vehicles={vehicles}
            loading={loading}
            onChoose={chooseVehicle}
            onBack={() => setScreen("home")}
          />
        ) : null}

        {screen === "running" && runnerStart ? (
          <ChecklistRunner
            start={runnerStart}
            idempotencyKey={idempotencyKey}
            onFinished={reset}
            onCancel={() => setScreen("setup")}
          />
        ) : null}

        {screen === "history" ? (
          <HistoryScreen history={history} onBack={() => setScreen("home")} />
        ) : null}
      </PageContent>
    </>
  );
}

function HomeScreen({
  context, history, canExecute, canViewOwn, onStart, onHistory,
}: {
  context: ChecklistContext;
  history: ExecutionSummary[];
  canExecute: boolean;
  canViewOwn: boolean;
  onStart: () => void;
  onHistory: () => void;
}) {
  return (
    <div className="flex flex-col gap-4">
      {/* §29: quem está executando aparece antes de qualquer ação. É o que
          permite perceber, ainda na primeira tela, que se entrou com a conta
          errada — depois de 34 respostas seria tarde. */}
      <div className="flex items-center gap-3 rounded-md border border-border bg-surface p-4">
        <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-primary-soft text-primary-soft-fg">
          <UserRound className="size-5" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-body font-semibold text-fg">
            {context.actor?.name ?? "Colaborador não vinculado"}
          </p>
          <p className="text-caption text-fg-muted">
            {context.actor?.employeeCode
              ? `Matrícula ${context.actor.employeeCode}`
              : "Sem matrícula vinculada"}
          </p>
        </div>
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
        <Button size="lg" className="h-16 text-body" leadingIcon={<ClipboardCheck />} onClick={onStart}>
          Iniciar checklist
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
          className="flex items-center gap-3 rounded-md border border-border bg-surface p-4 text-left hfm-transition hover:border-border-strong hfm-focus-ring"
        >
          <History className="size-5 shrink-0 text-fg-muted" aria-hidden />
          <span className="flex-1 text-body-sm font-medium text-fg">Meus checklists</span>
          <Badge variant="neutral">{number.format(history.length)}</Badge>
        </button>
      ) : null}
    </div>
  );
}

function SetupScreen({
  context, checklistType, onType, operationId, onOperation, search, onSearch,
  onFetch, vehicles, loading, onChoose, onBack,
}: {
  context: ChecklistContext;
  checklistType: ChecklistType | null;
  onType: (t: ChecklistType) => void;
  operationId: string;
  onOperation: (id: string) => void;
  search: string;
  onSearch: (v: string) => void;
  onFetch: (term: string) => void;
  vehicles: VehicleOption[] | null;
  loading: boolean;
  onChoose: (v: VehicleOption) => void;
  onBack: () => void;
}) {
  return (
    <div className="flex flex-col gap-4">
      {/* §30: os dois contextos têm códigos técnicos estáveis (saida/retorno) e
          o escolhido acompanha a execução inteira. */}
      <fieldset className="flex flex-col gap-2">
        <legend className="pb-2 text-label font-medium text-fg">Tipo de checklist</legend>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {([
            { value: "saida", label: "Saída para rota" },
            { value: "retorno", label: "Retorno de rota" },
          ] as const).map((option) => (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={checklistType === option.value}
              onClick={() => onType(option.value)}
              className={cn(
                "flex h-14 items-center justify-center rounded-md border text-body font-semibold hfm-transition hfm-focus-ring",
                checklistType === option.value
                  ? "border-primary bg-primary-soft text-primary-soft-fg"
                  : "border-border bg-surface text-fg-secondary hover:border-border-strong",
              )}
            >
              {option.label}
            </button>
          ))}
        </div>
      </fieldset>

      {context.operations.length > 1 ? (
        <FormField label="Operação" required id="checklist-operation">
          <NativeSelect
            id="checklist-operation"
            fieldSize="lg"
            value={operationId}
            onChange={(e) => onOperation(e.target.value)}
          >
            <option value="">Escolha a operação</option>
            {context.operations.map((o) => (
              <option key={o.id} value={o.id}>{o.name}</option>
            ))}
          </NativeSelect>
        </FormField>
      ) : null}

      {checklistType && operationId ? (
        <div className="flex flex-col gap-3">
          <FormField
            label="Veículo"
            required
            id="checklist-vehicle-search"
            helperText="Busque pela placa ou pelo código de frota."
          >
            <Input
              id="checklist-vehicle-search"
              size="lg"
              inputMode="search"
              autoComplete="off"
              value={search}
              leadingIcon={<Search className="size-4" aria-hidden />}
              placeholder="ABC1D23"
              onChange={(e) => onSearch(e.target.value)}
              onKeyDown={(e) => {
                if (e.key !== "Enter") return;
                e.preventDefault();
                onFetch(search);
              }}
            />
          </FormField>

          <Button size="lg" variant="secondary" onClick={() => onFetch(search)} loading={loading}>
            Buscar veículos
          </Button>

          {loading && vehicles === null ? (
            <p className="flex items-center gap-2 py-4 text-body-sm text-fg-muted">
              <Spinner size="sm" /> Carregando veículos…
            </p>
          ) : null}

          {vehicles && vehicles.length === 0 ? (
            <EmptyState
              icon={<Truck />}
              title="Nenhum veículo encontrado"
              description="Confira a placa ou refaça a busca sem filtro."
            />
          ) : null}

          {vehicles && vehicles.length > 0 ? (
            <ul className="flex flex-col gap-2">
              {vehicles.map((vehicle) => (
                <li key={vehicle.id}>
                  <button
                    type="button"
                    onClick={() => onChoose(vehicle)}
                    disabled={loading}
                    className="flex w-full items-center gap-3 rounded-md border border-border bg-surface p-4 text-left hfm-transition hover:border-border-strong hfm-focus-ring disabled:opacity-60"
                  >
                    <Truck className="size-5 shrink-0 text-fg-muted" aria-hidden />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-body font-semibold text-fg">
                        {vehicle.licensePlate ?? vehicle.fleetCode ?? "—"}
                      </span>
                      <span className="block truncate text-caption text-fg-muted">
                        {vehicle.vehicleTypeName}
                        {vehicle.brCode ? ` · ${vehicle.brCode}` : ""}
                      </span>
                    </span>
                    {/* §33: o previsto pela fidelização vem marcado, mas não é
                        o único selecionável — planejamento incompleto não pode
                        impedir um checklist legítimo. */}
                    {vehicle.expected ? <Badge variant="primary" appearance="soft">Previsto</Badge> : null}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      <Button size="lg" variant="ghost" leadingIcon={<LogOut />} onClick={onBack}>
        Voltar
      </Button>
    </div>
  );
}

function HistoryScreen({
  history, onBack,
}: {
  history: ExecutionSummary[];
  onBack: () => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      <h2 className="text-h3 font-semibold text-fg">Meus checklists</h2>

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
              <div className="flex flex-wrap gap-2">
                <Badge variant="success">{number.format(item.conforming)} conformes</Badge>
                {item.nonConforming > 0 ? (
                  <Badge variant="warning">{number.format(item.nonConforming)} inconformes</Badge>
                ) : null}
                {item.criticalNonConforming > 0 ? (
                  <Badge variant="danger">{number.format(item.criticalNonConforming)} críticas</Badge>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}

      <Button size="lg" variant="ghost" onClick={onBack}>
        Voltar
      </Button>
    </div>
  );
}
