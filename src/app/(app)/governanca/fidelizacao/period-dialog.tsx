"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle, ArrowLeftRight, Ban, Check, CircleSlash, Eye, Loader2, LogIn, LogOut, Search, Truck,
  Undo2, UserRound,
} from "lucide-react";
import {
  Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge, type BadgeVariant } from "@/components/ui/badge";
import { FormField } from "@/components/ui/form-field";
import { DateInput } from "@/components/ui/date-input";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { CheckboxField } from "@/components/ui/checkbox";
import { RadioField, RadioGroup } from "@/components/ui/radio-group";
import { Alert, AlertDescription, AlertTitle } from "@/components/feedback/alert";
import { useToast } from "@/components/feedback/toast";
import { cn } from "@/lib/cn";
import {
  applyFidelizationPeriod, searchEligibleVehicles,
  type ApplyPeriodInput, type EligibleVehicle, type PeriodAction, type PeriodMode, type PeriodResult, type Result,
} from "@/lib/governance/actions";
import { monthEnd, type Competence } from "@/lib/governance/competence";
import type { PlannerRow, PlannerSegment } from "@/lib/governance/fidelization-central";

/* ------------------------------------------------------------------ helpers */

const OPEN_END = "9999-12-31";

/** dd/mm/aaaa — a data como a pessoa escreve. */
export function formatDateBr(iso: string | null | undefined): string {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-");
  return d ? `${d}/${m}/${y}` : iso;
}

/** dd/mm dentro do ano da competência; dd/mm/aaaa quando o ano é outro. */
function formatDayMonth(iso: string | null | undefined, year: number): string {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-");
  if (!d) return iso;
  return Number(y) === year ? `${d}/${m}` : `${d}/${m}/${y}`;
}

function daysBetween(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  return Math.round((b - a) / 86_400_000) + 1;
}

/** O vínculo toca o intervalo [from, to] (to nulo = em diante). */
export function segmentOverlaps(segment: PlannerSegment, from: string, to: string | null): boolean {
  return segment.startDate <= (to ?? OPEN_END) && (segment.endDate ?? OPEN_END) >= from;
}

export function vehicleLabel(fleetCode: string | null, plate: string | null): string {
  return fleetCode ?? plate ?? "Sem identificação";
}

const STATUS_LABEL: Record<PlannerSegment["status"], string> = {
  planned: "Planejado",
  confirmed: "Confirmado",
  executed: "Executado",
  cancelled: "Cancelado",
};

const STATUS_TONE: Record<PlannerSegment["status"], BadgeVariant> = {
  planned: "info",
  confirmed: "primary",
  executed: "success",
  cancelled: "neutral",
};

/** O modo, escrito — a pessoa lê "Substituição", não `substitute`. */
export const PERIOD_MODE_LABEL: Record<PeriodMode, string> = {
  allocate: "Primeira alocação",
  substitute: "Substituição",
  remove: "Remoção",
  invert: "Inversão de placas",
  transfer: "Transferência entre BRs",
  conflict: "Veículo ocupado em outra BR",
};

const MODE_TONE: Record<PeriodMode, BadgeVariant> = {
  allocate: "success",
  substitute: "info",
  remove: "warning",
  invert: "primary",
  transfer: "primary",
  conflict: "warning",
};

const MODE_EXPLANATION: Record<PeriodMode, string> = {
  allocate: "A BR não tem veículo neste período; o veículo escolhido entra nela.",
  substitute: "O veículo atual sai da BR no período e o escolhido entra no lugar; o que vem antes e depois é preservado.",
  remove: "A BR fica sem veículo no período; o que vem antes e depois é preservado.",
  invert: "As duas BRs trocam de placa no período, numa única transação.",
  transfer: "O veículo sai da outra BR no período e entra nesta, que estava sem veículo.",
  conflict: "O veículo escolhido já ocupa outra BR neste período.",
};

/** Ordem de leitura: a BR editada primeiro, e dentro de cada BR a ordem dos dias. */
const KIND_ORDER: Record<PeriodAction["kind"], number> = { trim: 0, cancel: 1, create: 2, continue: 3 };

function actionDate(action: PeriodAction): string {
  return action.kind === "trim" ? action.endDate ?? action.startDate : action.startDate;
}

function sortActions(actions: PeriodAction[], operationBrId: string): PeriodAction[] {
  return [...actions].sort((a, b) => {
    const brA = a.operationBrId === operationBrId ? 0 : 1;
    const brB = b.operationBrId === operationBrId ? 0 : 1;
    if (brA !== brB) return brA - brB;
    if (a.operationBrId !== b.operationBrId) return a.operationBrId.localeCompare(b.operationBrId);
    const byDate = actionDate(a).localeCompare(actionDate(b));
    return byDate !== 0 ? byDate : KIND_ORDER[a.kind] - KIND_ORDER[b.kind];
  });
}

/** Uma ação da prévia em português: "BR0024 · VA116: encerra em 24/09". */
function describeAction(action: PeriodAction, year: number): { text: string; detail: string | null } {
  const who = `${action.brCode ?? "BR"} · ${action.vehicleLabel ?? "veículo"}`;
  const d = (iso: string | null) => formatDayMonth(iso, year);
  switch (action.kind) {
    case "trim":
      return {
        text: `${who}: encerra em ${d(action.endDate)}`,
        detail: action.previousEndDate ? `antes ia até ${d(action.previousEndDate)}` : "antes estava em aberto",
      };
    case "cancel":
      return {
        text: `${who}: planejamento de ${d(action.startDate)} a ${action.endDate ? d(action.endDate) : "em aberto"} é cancelado`,
        detail: "estava inteiro dentro do período",
      };
    case "continue": {
      const until = action.endDate ? `segue até ${d(action.endDate)}` : "segue em aberto";
      const drivers = action.drivers
        ? ` · ${action.drivers} ${action.drivers === 1 ? "motorista segue" : "motoristas seguem"} com o veículo`
        : "";
      return { text: `${who}: volta em ${d(action.startDate)}`, detail: `${until}${drivers}` };
    }
    case "create":
    default: {
      if (!action.endDate) return { text: `${who}: entra em ${d(action.startDate)}, em diante`, detail: null };
      if (action.endDate === action.startDate) {
        return { text: `${who}: entra em ${d(action.startDate)} (só este dia)`, detail: null };
      }
      return { text: `${who}: entra de ${d(action.startDate)} a ${d(action.endDate)}`, detail: null };
    }
  }
}

const ACTION_ICON: Record<PeriodAction["kind"], React.ElementType> = {
  trim: LogOut,
  cancel: Ban,
  create: LogIn,
  continue: Undo2,
};

/* ------------------------------------------------------------ vehicle search */

export type SearchVehicles = (input: {
  operationBrId: string;
  startDate: string;
  endDate?: string | null;
  search?: string | null;
  excludeAssignmentId?: string | null;
}) => Promise<Result<EligibleVehicle[]>>;

interface PeriodVehiclePickerProps {
  id: string;
  operationBrId: string;
  brCode: string;
  startDate: string;
  endDate: string | null;
  /** Veículos que já ocupam esta BR no período: escolhê-los não muda nada. */
  ownVehicleIds: Set<string>;
  value: EligibleVehicle | null;
  onChange: (value: EligibleVehicle | null) => void;
  search: SearchVehicles;
  disabled?: boolean;
}

/**
 * A busca de placa do diálogo.
 *
 * Mesma consulta do `VehiclePicker` (`searchEligibleVehicles`, no servidor), com
 * uma diferença que é a razão de existir: aqui o veículo que ocupa OUTRA BR no
 * período pode ser escolhido. É assim que a pessoa chega à inversão — a prévia
 * nomeia o conflito e oferece trocar as placas. O `VehiclePicker` desabilita
 * esses veículos, o que é certo para a gaveta de planejamento e fecharia a
 * porta da inversão aqui.
 */
function PeriodVehiclePicker({
  id, operationBrId, brCode, startDate, endDate, ownVehicleIds, value, onChange, search, disabled,
}: PeriodVehiclePickerProps) {
  const [term, setTerm] = React.useState("");
  const requestKey = JSON.stringify([operationBrId, startDate, endDate, term]);
  const [fetched, setFetched] = React.useState<{ key: string; options: EligibleVehicle[]; error: string | null } | null>(null);
  const loading = fetched?.key !== requestKey;
  const options = fetched?.options ?? [];
  const error = loading ? null : fetched?.error ?? null;

  React.useEffect(() => {
    if (!operationBrId || !startDate) return;
    let cancelled = false;
    const handle = window.setTimeout(() => {
      search({ operationBrId, startDate, endDate, search: term.trim() || null, excludeAssignmentId: null })
        .then((result) => {
          if (cancelled) return;
          setFetched(
            result.ok
              ? { key: requestKey, options: result.data ?? [], error: null }
              : { key: requestKey, options: [], error: result.error ?? "Não foi possível buscar veículos." },
          );
        })
        .catch(() => {
          if (!cancelled) setFetched({ key: requestKey, options: [], error: "Não foi possível buscar veículos." });
        });
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(handle);
    };
  }, [search, operationBrId, startDate, endDate, term, requestKey]);

  const describe = (v: EligibleVehicle) =>
    [[v.makeName, v.modelName].filter(Boolean).join(" "), v.vehicleType].filter(Boolean).join(" · ") ||
    "Sem modelo cadastrado";

  return (
    <div className="flex flex-col gap-2">
      <Input
        id={id}
        value={term}
        disabled={disabled}
        autoComplete="off"
        size="sm"
        leadingIcon={<Search />}
        placeholder="Buscar por frota, placa, marca ou modelo"
        onChange={(e) => setTerm(e.target.value)}
      />

      {value ? (
        <p className="flex flex-wrap items-center gap-1.5 text-caption text-fg-secondary" aria-live="polite">
          <Check aria-hidden className="size-3.5 text-success" />
          Escolhido:
          <span className="font-medium text-fg">
            {vehicleLabel(value.fleetCode, value.licensePlate)}
            {value.fleetCode && value.licensePlate ? ` (${value.licensePlate})` : ""}
          </span>
          {value.hasConflict && value.conflictBr ? (
            <span className="text-warning-soft-fg">· ocupa {value.conflictBr} no período</span>
          ) : null}
        </p>
      ) : null}

      <div className="max-h-56 overflow-auto rounded-md border border-border" aria-busy={loading || undefined}>
        {loading ? (
          <p className="flex items-center gap-2 px-3 py-3 text-body-sm text-fg-muted" role="status">
            <Loader2 aria-hidden className="size-4 animate-spin" />
            Buscando veículos elegíveis…
          </p>
        ) : error ? (
          <p className="px-3 py-3 text-body-sm text-danger" role="alert">{error}</p>
        ) : options.length === 0 ? (
          <p className="px-3 py-3 text-body-sm text-fg-muted">Nenhum veículo elegível encontrado para este período.</p>
        ) : (
          <ul className="divide-y divide-border" aria-label="Veículos elegíveis">
            {options.map((option) => {
              const selected = value?.vehicleId === option.vehicleId;
              const own = ownVehicleIds.has(option.vehicleId) || (option.hasConflict && option.conflictBr === brCode);
              return (
                <li key={option.vehicleId}>
                  <button
                    type="button"
                    disabled={disabled || own}
                    aria-pressed={selected}
                    onClick={() => onChange(selected ? null : option)}
                    className={cn(
                      "flex w-full min-w-0 items-center gap-2 px-3 py-2 text-left hfm-focus-ring",
                      own ? "cursor-not-allowed opacity-60" : "hover:bg-surface-secondary",
                      selected && "bg-primary-soft",
                    )}
                  >
                    <Truck aria-hidden className="size-4 shrink-0 text-fg-muted" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-body-sm font-medium text-fg">
                        {vehicleLabel(option.fleetCode, option.licensePlate)}
                        {option.fleetCode && option.licensePlate ? (
                          <span className="font-normal text-fg-muted"> · {option.licensePlate}</span>
                        ) : null}
                      </span>
                      <span className="block truncate text-caption text-fg-muted">{describe(option)}</span>
                    </span>
                    {own ? (
                      <Badge variant="neutral" size="sm">Já nesta BR</Badge>
                    ) : option.hasConflict ? (
                      <Badge variant="warning" size="sm" icon={<AlertTriangle />}>
                        {option.conflictBr ? `Em ${option.conflictBr}` : "Em outra BR"}
                      </Badge>
                    ) : selected ? (
                      <Check aria-hidden className="size-4 shrink-0 text-primary" />
                    ) : null}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <p className="text-caption text-fg-muted">
        A lista considera situação cadastral, escopo e os tipos de equipamento admitidos na operação.
        Um veículo que está em outra BR pode ser escolhido: a prévia mostra o conflito e oferece a inversão.
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------- dialog */

export interface PeriodDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  row: PlannerRow | null;
  /** Dia clicado, YYYY-MM-DD. */
  date: string | null;
  competence: Competence;
  /** Hoje, YYYY-MM-DD (o do servidor: a matriz traz). */
  today: string;
  canManageHistorical: boolean;
  /** Padrão: a server action `applyFidelizationPeriod`. A prévia de desenvolvimento injeta uma falsa. */
  applyPeriod?: (input: ApplyPeriodInput) => Promise<Result<PeriodResult>>;
  /** Padrão: a server action `searchEligibleVehicles`. */
  searchVehicles?: SearchVehicles;
}

/**
 * "Editar fidelização do dia" — a célula do Planner de Frotas (§23–§28).
 *
 * Um dia clicado vira um período: início, fim (ou "em diante") e o que fazer
 * nele — vincular/substituir um veículo ou deixar a BR sem veículo. Nada é
 * gravado sem prévia: a prévia é a própria rotina do servidor, desfeita, e o
 * "Confirmar" só liga para os parâmetros exatos que a produziram (a chave
 * serializada, como na alteração em massa da Aderência). Mudar o veículo, as
 * datas, a inversão ou os motoristas invalida a prévia.
 */
export function PeriodDialog({
  open,
  onOpenChange,
  row,
  date,
  competence,
  today,
  canManageHistorical,
  applyPeriod = applyFidelizationPeriod,
  searchVehicles = searchEligibleVehicles,
}: PeriodDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg">
        {row && date ? (
          // A chave zera o formulário quando a BR ou o dia mudam sem fechar o diálogo.
          <PeriodForm
            key={`${row.operationBrId}|${date}`}
            row={row}
            date={date}
            competence={competence}
            today={today}
            canManageHistorical={canManageHistorical}
            applyPeriod={applyPeriod}
            searchVehicles={searchVehicles}
            onClose={() => onOpenChange(false)}
          />
        ) : (
          <DialogHeader>
            <DialogTitle>Editar fidelização do dia</DialogTitle>
            <DialogDescription>Escolha uma BR e um dia no planner.</DialogDescription>
          </DialogHeader>
        )}
      </DialogContent>
    </Dialog>
  );
}

type Choice = "assign" | "remove";

interface PeriodFormProps {
  row: PlannerRow;
  date: string;
  competence: Competence;
  today: string;
  canManageHistorical: boolean;
  applyPeriod: (input: ApplyPeriodInput) => Promise<Result<PeriodResult>>;
  searchVehicles: SearchVehicles;
  onClose: () => void;
}

function PeriodForm({
  row, date, competence, today, canManageHistorical, applyPeriod, searchVehicles, onClose,
}: PeriodFormProps) {
  const router = useRouter();
  const { toast } = useToast();
  const [busy, startTransition] = React.useTransition();
  const uid = React.useId();

  const [choice, setChoice] = React.useState<Choice>("assign");
  const [vehicle, setVehicle] = React.useState<EligibleVehicle | null>(null);
  const [dateFrom, setDateFrom] = React.useState(date);
  // "" = em diante. O padrão é o dia clicado: o menor efeito possível.
  const [dateTo, setDateTo] = React.useState(date);
  const [reason, setReason] = React.useState("");
  const [notes, setNotes] = React.useState("");
  const [keepDrivers, setKeepDrivers] = React.useState(true);
  const [invert, setInvert] = React.useState(false);
  const [attempted, setAttempted] = React.useState(false);

  const segments = React.useMemo(() => row.segments.filter((s) => s.status !== "cancelled"), [row.segments]);
  const atDate = segments.find((s) => segmentOverlaps(s, date, date)) ?? null;

  const to = dateTo || null;
  const periodError = !dateFrom
    ? "Informe o início do período."
    : to && to < dateFrom
      ? "O fim não pode ser anterior ao início."
      : null;
  const occupying = React.useMemo(
    () => (periodError ? [] : segments.filter((s) => segmentOverlaps(s, dateFrom, to))),
    [segments, dateFrom, to, periodError],
  );
  const removable = occupying.length > 0;
  const effective: Choice = choice === "remove" && !removable ? "assign" : choice;
  const vehicleId = effective === "remove" ? null : vehicle?.vehicleId ?? null;
  const effectiveInvert = effective === "assign" && invert;

  /* A chave da prévia: tudo o que muda o resultado. Motivo e observações não
     mudam o que acontece — só o que fica registrado —, então editá-los depois
     da prévia não obriga a refazê-la; a exigência do motivo é conferida à parte. */
  const baseKey = JSON.stringify([row.operationBrId, vehicleId, dateFrom, to, keepDrivers]);
  const key = `${baseKey}|${effectiveInvert ? 1 : 0}`;

  const [computed, setComputed] = React.useState<{ key: string; baseKey: string; data: PeriodResult } | null>(null);
  const [failure, setFailure] = React.useState<{ key: string; message: string } | null>(null);
  const preview = computed?.key === key ? computed.data : null;
  // O conflito continua à vista enquanto a inversão é refeita (a chave muda com ela).
  const conflictView =
    computed && computed.baseKey === baseKey && computed.data.conflicts.length > 0 ? computed.data : null;
  const error = failure?.key === key ? failure.message : null;

  const predictedAllocate = effective === "assign" && occupying.length === 0 && !effectiveInvert;
  const reasonRequired = preview ? preview.mode !== "allocate" : !predictedAllocate;
  const reasonMissing = reasonRequired && !reason.trim();

  const historical = (!!dateFrom && dateFrom < today) || Boolean(preview?.historical);
  const historicalBlocked = historical && !canManageHistorical;

  const input: Omit<ApplyPeriodInput, "dryRun"> = {
    operationBrId: row.operationBrId,
    vehicleId,
    dateFrom,
    dateTo: to,
    reason: reason.trim() || null,
    notes: notes.trim() || null,
    invert: effectiveInvert,
    keepDrivers,
  };

  const monthLast = monthEnd(competence);
  const toMonthEnd = dateFrom && dateFrom > monthLast ? monthEnd({
    year: Number(dateFrom.slice(0, 4)),
    month: Number(dateFrom.slice(5, 7)),
  }) : monthLast;

  const invalidate = () => {
    setInvert(false);
  };

  const runPreview = (withInvert: boolean = effectiveInvert) => {
    setAttempted(true);
    if (periodError) return;
    if (effective === "assign" && !vehicle) return;
    // A mesma previsão de `predictedAllocate`, mas com a inversão pedida agora
    // (o estado de `invert` ainda não mudou quando o checkbox chama).
    const allocateLikely = effective === "assign" && occupying.length === 0 && !withInvert;
    if (!allocateLikely && !reason.trim()) return;

    const payload = { ...input, invert: effective === "assign" && withInvert };
    const runKey = `${baseKey}|${payload.invert ? 1 : 0}`;
    startTransition(async () => {
      try {
        const result = await applyPeriod({ ...payload, dryRun: true });
        if (result.ok && result.data) {
          setComputed({ key: runKey, baseKey, data: result.data });
          setFailure(null);
        } else {
          setFailure({ key: runKey, message: result.error ?? "Não foi possível calcular a prévia." });
        }
      } catch {
        setFailure({ key: runKey, message: "Não foi possível calcular a prévia. Verifique a conexão e tente de novo." });
      }
    });
  };

  const canConfirm =
    !!preview && preview.mode !== "conflict" && !reasonMissing && !historicalBlocked && !periodError && !busy;

  const confirm = () => {
    if (!preview || !canConfirm) return;
    const mode = preview.mode;
    startTransition(async () => {
      try {
        const result = await applyPeriod({ ...input, dryRun: false });
        if (!result.ok || !result.data) {
          setFailure({ key, message: result.error ?? "Não foi possível aplicar a alteração no período." });
          return;
        }
        const done = result.data;
        toast({
          title: `${PERIOD_MODE_LABEL[done.mode] ?? PERIOD_MODE_LABEL[mode]} registrada na ${row.brCode}.`,
          description: [
            periodSentence(done.dateFrom, done.dateTo),
            ...(result.warnings ?? []),
          ].join(" "),
          variant: "success",
        });
        onClose();
        router.refresh();
      } catch {
        setFailure({ key, message: "Não foi possível aplicar a alteração. Verifique a conexão e tente de novo." });
      }
    });
  };

  const ownVehicleIds = React.useMemo(() => new Set(occupying.map((s) => s.vehicleId)), [occupying]);
  const actions = preview ? sortActions(preview.actions, row.operationBrId) : [];

  const vehicleError = attempted && effective === "assign" && !vehicle ? "Escolha o veículo que entra na BR." : undefined;
  const reasonError =
    attempted && (reasonMissing || (effectiveInvert && !reason.trim()))
      ? "Informe o motivo da alteração."
      : undefined;

  return (
    <>
      <DialogHeader>
        <DialogTitle>Editar fidelização do dia</DialogTitle>
        <DialogDescription>
          <span className="font-medium text-fg">{row.brCode}</span>
          {" · "}
          {row.operationName}
          {" · "}
          {row.cityName}/{row.stateUf}
          {" · "}
          <span className="font-medium text-fg">{formatDateBr(date)}</span>
        </DialogDescription>
        {row.brDescription ? <p className="text-caption text-fg-muted">{row.brDescription}</p> : null}
      </DialogHeader>

      <DialogBody className="flex flex-col gap-5">
        {/* ------------------------------------------------ veículo nesta data */}
        <section aria-labelledby={`${uid}-current`} className="rounded-md border border-border bg-surface p-3">
          <h3 id={`${uid}-current`} className="text-caption font-medium uppercase tracking-wide text-fg-muted">
            Veículo nesta data
          </h3>
          {atDate ? (
            <div className="mt-2 flex items-start gap-2.5">
              <Truck aria-hidden className="mt-0.5 size-4 shrink-0 text-fg-muted" />
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-body-sm font-medium text-fg">
                  <span>
                    {vehicleLabel(atDate.fleetCode, atDate.licensePlate)}
                    {atDate.fleetCode && atDate.licensePlate ? (
                      <span className="font-normal text-fg-muted"> · {atDate.licensePlate}</span>
                    ) : null}
                  </span>
                  <Badge variant={STATUS_TONE[atDate.status]} size="sm">{STATUS_LABEL[atDate.status]}</Badge>
                  {atDate.source === "substitution" || atDate.source === "inversion" ? (
                    <Badge variant="neutral" size="sm" icon={<ArrowLeftRight />}>
                      {atDate.source === "inversion" ? "Entrou por inversão" : "Entrou por substituição"}
                    </Badge>
                  ) : null}
                </p>
                <p className="text-caption text-fg-secondary">
                  {atDate.vehicleTypeName ? `${atDate.vehicleTypeName} · ` : ""}
                  Vínculo de {formatDateBr(atDate.startDate)} a{" "}
                  {atDate.endDate ? formatDateBr(atDate.endDate) : "em aberto"}
                </p>
                {atDate.drivers.length > 0 ? (
                  <p className="mt-1 flex items-start gap-1.5 text-caption text-fg-secondary">
                    <UserRound aria-hidden className="mt-px size-3.5 shrink-0 text-fg-muted" />
                    <span>
                      {atDate.drivers
                        .map((d) => `${d.name} (${d.driverRole === "primary" ? "principal" : "secundário"})`)
                        .join(", ")}
                    </span>
                  </p>
                ) : (
                  <p className="mt-1 text-caption text-fg-muted">Sem motorista planejado.</p>
                )}
              </div>
            </div>
          ) : (
            <p className="mt-2 flex items-center gap-2 text-body-sm text-fg-secondary">
              <CircleSlash aria-hidden className="size-4 shrink-0 text-fg-muted" />
              Sem veículo nesta data.
            </p>
          )}
        </section>

        {/* ---------------------------------------------------------- período */}
        <fieldset className="flex flex-col gap-3">
          <legend className="mb-2 text-label font-semibold text-fg">Período</legend>
          <div className="grid gap-3 sm:grid-cols-2">
            <FormField label="Início" required id={`${uid}-from`}>
              <DateInput
                value={dateFrom}
                disabled={busy}
                onChange={(e) => {
                  setDateFrom(e.target.value);
                  invalidate();
                }}
              />
            </FormField>
            <FormField
              label="Fim"
              labelHint="Opcional"
              id={`${uid}-to`}
              helperText={to ? undefined : "Em branco: em diante, sem data de fim."}
              error={dateFrom && to && to < dateFrom ? periodError : undefined}
            >
              <DateInput
                value={dateTo}
                min={dateFrom || undefined}
                disabled={busy}
                onChange={(e) => {
                  setDateTo(e.target.value);
                  invalidate();
                }}
              />
            </FormField>
          </div>
          <div className="flex flex-wrap gap-2" role="group" aria-label="Atalhos de período">
            <Button
              size="sm"
              variant="outline"
              aria-pressed={!!dateFrom && dateTo === dateFrom}
              disabled={busy || !dateFrom}
              onClick={() => {
                setDateTo(dateFrom);
                invalidate();
              }}
            >
              Só este dia
            </Button>
            <Button
              size="sm"
              variant="outline"
              aria-pressed={!!dateFrom && dateTo === toMonthEnd}
              disabled={busy || !dateFrom}
              onClick={() => {
                setDateTo(toMonthEnd);
                invalidate();
              }}
            >
              Até o fim do mês
            </Button>
            <Button
              size="sm"
              variant="outline"
              aria-pressed={dateTo === ""}
              disabled={busy}
              onClick={() => {
                setDateTo("");
                invalidate();
              }}
            >
              Em diante
            </Button>
          </div>
          {/* O campo de data segue o idioma do navegador; o período fica dito
              também em dd/mm/aaaa, que é como a operação lê. */}
          {!periodError ? (
            <p className="text-body-sm text-fg-secondary" aria-live="polite">
              <span className="font-medium text-fg">Período:</span>{" "}
              {to
                ? to === dateFrom
                  ? `somente ${formatDateBr(dateFrom)} (1 dia)`
                  : `${formatDateBr(dateFrom)} a ${formatDateBr(to)} (${daysBetween(dateFrom, to)} dias)`
                : `a partir de ${formatDateBr(dateFrom)}, em diante`}
            </p>
          ) : !dateFrom && attempted ? (
            <p className="text-helper text-danger" role="alert">Informe o início do período.</p>
          ) : null}
        </fieldset>

        {/* --------------------------------------------------------- o que fazer */}
        <FormField label="O que fazer no período" id={`${uid}-choice`}>
          <RadioGroup
            value={effective}
            onValueChange={(value) => {
              setChoice(value as Choice);
              setInvert(false);
            }}
            className="gap-1"
          >
            <RadioField
              value="assign"
              disabled={busy}
              label="Vincular ou substituir veículo"
              description="Escolha a placa que ocupa a BR no período. Se houver veículo, ele sai só neste intervalo."
            />
            <RadioField
              value="remove"
              disabled={busy || !removable}
              label="Remover veículo neste período"
              description={
                removable
                  ? `Sai ${occupying.map((s) => vehicleLabel(s.fleetCode, s.licensePlate)).join(", ")} e a BR fica sem veículo no período.`
                  : "Não há veículo nesta BR no período escolhido."
              }
            />
          </RadioGroup>
        </FormField>

        {effective === "assign" ? (
          <FormField label="Veículo" required id={`${uid}-vehicle`} error={vehicleError}>
            <PeriodVehiclePicker
              id={`${uid}-vehicle`}
              operationBrId={row.operationBrId}
              brCode={row.brCode}
              startDate={dateFrom || date}
              endDate={periodError ? null : to}
              ownVehicleIds={ownVehicleIds}
              value={vehicle}
              onChange={(v) => {
                setVehicle(v);
                setInvert(false);
              }}
              search={searchVehicles}
              disabled={busy}
            />
          </FormField>
        ) : null}

        <FormField
          label="Motivo"
          required={reasonRequired || effectiveInvert}
          labelHint={reasonRequired || effectiveInvert ? undefined : "Opcional na primeira alocação"}
          id={`${uid}-reason`}
          error={reasonError}
        >
          <Textarea
            rows={2}
            value={reason}
            disabled={busy}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Por que a BR muda de veículo neste período?"
          />
        </FormField>

        <FormField label="Observações" labelHint="Opcional" id={`${uid}-notes`}>
          <Textarea
            rows={2}
            value={notes}
            disabled={busy}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Informação complementar para o histórico"
          />
        </FormField>

        {effective === "assign" ? (
          <CheckboxField
            label="Manter os motoristas da BR no novo veículo"
            description="Os motoristas planejados na BR no período seguem com o veículo que entra."
            checked={keepDrivers}
            disabled={busy}
            onCheckedChange={(v) => setKeepDrivers(v === true)}
          />
        ) : null}

        {historical ? (
          <Alert variant="warning">
            <div className="flex flex-col gap-1">
              <AlertTitle>Correção histórica</AlertTitle>
              <AlertDescription>
                O período começa antes de hoje ({formatDateBr(today)}). Alterar dias que já passaram muda o
                registro de quem ocupou a BR e fica auditado como correção histórica.
              </AlertDescription>
              {!canManageHistorical ? (
                <AlertDescription className="font-medium">
                  Esta alteração exige a permissão “Corrigir dados históricos da fidelização”, que o seu perfil
                  não possui. A confirmação fica bloqueada; ajuste o início para hoje ou uma data futura.
                </AlertDescription>
              ) : null}
            </div>
          </Alert>
        ) : null}

        {error ? (
          <Alert variant="danger">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}

        {/* ------------------------------------------------------------ conflito */}
        {conflictView ? (
          <div className="flex flex-col gap-2">
            <Alert variant="warning">
              <div className="flex min-w-0 flex-col gap-1.5">
                <AlertTitle>
                  {conflictView.vehicleLabel ?? "O veículo"} já está fidelizado em outra BR neste período
                </AlertTitle>
                <ul className="flex flex-col gap-0.5 text-body-sm" aria-label="BRs em conflito">
                  {conflictView.conflicts.map((c) => (
                    <li key={c.assignmentId} className="break-words">
                      <span className="font-medium">{c.brCode}</span>
                      {c.operationName ? ` · ${c.operationName}` : ""}
                      {c.cityName ? ` · ${c.cityName}` : ""}
                      {` · ${formatDateBr(c.startDate)} – ${c.endDate ? formatDateBr(c.endDate) : "em aberto"}`}
                    </li>
                  ))}
                </ul>
                <AlertDescription>
                  {conflictView.canInvert
                    ? "Marque a inversão para trocar as placas entre as BRs neste período. Se esta BR estiver sem veículo, o veículo é transferido e a outra BR fica sem veículo no período."
                    : "A inversão não é possível neste período: o veículo precisa estar numa única outra BR durante todo o período, e esta BR pode ter no máximo um titular. Ajuste o período ou escolha outro veículo."}
                </AlertDescription>
              </div>
            </Alert>
            {conflictView.canInvert ? (
              <CheckboxField
                label="Inverter as placas entre as BRs"
                description="A prévia é refeita com a inversão; nada é gravado antes de confirmar."
                checked={invert}
                disabled={busy}
                onCheckedChange={(v) => {
                  const next = v === true;
                  setInvert(next);
                  if (!next || reason.trim()) runPreview(next);
                  else setAttempted(true);
                }}
              />
            ) : null}
          </div>
        ) : null}

        {/* --------------------------------------------------------------- prévia */}
        {preview && preview.mode !== "conflict" ? (
          <section
            aria-label="Prévia da alteração"
            className="flex flex-col gap-3 rounded-md border border-border bg-surface-secondary p-3"
          >
            <div className="flex flex-wrap items-center gap-2">
              <Eye aria-hidden className="size-4 text-fg-muted" />
              <span className="text-label font-semibold text-fg">Prévia</span>
              <Badge variant={MODE_TONE[preview.mode]}>{PERIOD_MODE_LABEL[preview.mode]}</Badge>
              <span className="text-caption text-fg-secondary">{periodSentence(preview.dateFrom, preview.dateTo)}</span>
            </div>
            <p className="text-caption text-fg-secondary">{MODE_EXPLANATION[preview.mode]}</p>
            {actions.length > 0 ? (
              <ul className="flex flex-col gap-1.5" aria-label="O que será feito">
                {actions.map((action, i) => {
                  const { text, detail } = describeAction(action, competence.year);
                  const Icon = ACTION_ICON[action.kind] ?? LogIn;
                  return (
                    <li key={`${action.assignmentId}-${action.kind}-${i}`} className="flex items-start gap-2">
                      <Icon aria-hidden className="mt-0.5 size-4 shrink-0 text-fg-muted" />
                      <span className="min-w-0 break-words text-body-sm text-fg">
                        {text}
                        {detail ? <span className="text-fg-muted"> ({detail})</span> : null}
                      </span>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="text-body-sm text-fg-muted">Nenhuma alteração de vínculo.</p>
            )}
            {preview.vehicleId && preview.mode !== "allocate" && preview.mode !== "transfer" ? (
              <p className="flex items-center gap-1.5 text-caption text-fg-secondary">
                <UserRound aria-hidden className="size-3.5" />
                {keepDrivers
                  ? preview.driversKept > 0
                    ? `${preview.driversKept} ${preview.driversKept === 1 ? "motorista segue" : "motoristas seguem"} com a BR no novo veículo.`
                    : "Nenhum motorista planejado para levar ao novo veículo."
                  : "Os motoristas não acompanham o novo veículo."}
              </p>
            ) : null}
          </section>
        ) : null}
      </DialogBody>

      <DialogFooter>
        <Button variant="ghost" onClick={onClose} disabled={busy}>
          Cancelar
        </Button>
        <Button variant="secondary" leadingIcon={<Eye />} onClick={() => runPreview()} loading={busy}>
          Pré-visualizar
        </Button>
        <Button leadingIcon={<Check />} onClick={confirm} disabled={!canConfirm}>
          Confirmar
        </Button>
      </DialogFooter>
    </>
  );
}

function periodSentence(from: string, to: string | null): string {
  if (!to) return `A partir de ${formatDateBr(from)}, em diante.`;
  if (to === from) return `Somente ${formatDateBr(from)}.`;
  return `De ${formatDateBr(from)} a ${formatDateBr(to)}.`;
}
