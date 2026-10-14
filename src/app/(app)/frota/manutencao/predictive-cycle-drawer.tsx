"use client";

import * as React from "react";
import { ClipboardCheck, Clock, Eye, RotateCcw, RotateCw } from "lucide-react";
import {
  Drawer, DrawerBody, DrawerContent, DrawerDescription, DrawerFooter, DrawerHeader, DrawerTitle,
} from "@/components/ui/drawer";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DateInput } from "@/components/ui/date-input";
import { FormField, FormGrid } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { StatusBadge, type StatusTone } from "@/components/ui/status-badge";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription, AlertTitle } from "@/components/feedback/alert";
import { Skeleton } from "@/components/feedback/skeleton";
import { useToast } from "@/components/feedback/toast";
import {
  CriticalityBadge, MaintenanceStatusBadge, MaintenanceTypeBadge, PredictiveStatusBadge, VerificationResultBadge,
} from "@/components/maintenance/badges";
import { loadPredictiveCycleHistory, resetPredictiveCycle } from "@/lib/maintenance/actions";
import {
  CONFORMITY_LABEL,
  DECISION_LABEL,
  EXECUTION_LABEL,
  formatDate,
  formatInt,
  formatKm,
  formatStamp,
  PREDICTIVE_EVENT_LABEL,
  PREDICTIVE_EVENT_SOURCE_LABEL,
  REFERENCE_FORMAL,
  REFERENCE_TYPE_LABEL,
  RESPONSE_TYPE_LABEL,
  VERIFICATION_SOURCE_LABEL,
  type MaintenanceService,
  type PredictiveCell,
  type PredictiveChecklistStep,
  type PredictiveCycleHistory,
  type PredictiveExecution,
} from "@/lib/maintenance/types";
import { KmStaleBadge, pctText, ReferenceBadge } from "./predictive-shared";
import type { MaintenancePerms } from "./shared";

/**
 * Preditiva — gaveta do ciclo (veículo × item do plano técnico).
 *
 * Mostra a situação completa (técnica, execução, conformidade, referência e a
 * sua natureza formal ou histórica, KM e a sua idade, monitoramento), o
 * contexto operacional (operação, local, BR, liderança), a última manutenção
 * e a última verificação, o item com bandas, cobertura e roteiro, as
 * verificações, as manutenções e a linha do tempo imutável de eventos. A baixa
 * manual é a exceção auditada: data, KM e justificativa obrigatórios. Nada é
 * recalculado aqui — tudo chega do servidor.
 */

// ---------------------------------------------------------------------------
// Vocabulário compartilhado pelos arquivos da Preditiva
// ---------------------------------------------------------------------------

/** Tom da situação de execução (a manutenção), separado do tom técnico. */
export const EXECUTION_TONE: Record<PredictiveExecution, StatusTone> = {
  to_schedule: "warning",
  scheduled: "info",
  in_progress: "progress",
  awaiting_corrective: "danger",
  not_programmed: "neutral",
};

export function ExecutionBadge({ execution, size = "sm" }: { execution: PredictiveExecution; size?: "sm" | "md" }) {
  return (
    <StatusBadge status={EXECUTION_TONE[execution] ?? "neutral"} size={size} appearance="outline">
      {EXECUTION_LABEL[execution] ?? execution}
    </StatusBadge>
  );
}

/** Respostas do roteiro técnico de conformidade. O código vai para o banco; o rótulo, para a tela. */
export type ChecklistAnswer = "ok" | "out" | "na";
export const CHECKLIST_ANSWERS: ChecklistAnswer[] = ["ok", "out", "na"];
export const CHECKLIST_ANSWER_LABEL: Record<string, string> = {
  ok: "OK",
  out: "Fora",
  na: "N/A",
  yes: "Sim",
  no: "Não",
};

/** Como escrever a resposta de um passo, pelo tipo de resposta do passo. */
export function answerLabel(step: PredictiveChecklistStep | undefined, answer: string): string {
  const type = step?.responseType ?? "conformity";
  if (type === "conformity" || type === "yes_no") return CHECKLIST_ANSWER_LABEL[answer] ?? answer;
  return answer;
}

/** O que a tela já sabe do ciclo, vindo da matriz ou dos alertas. */
export interface PredictiveCycleContext extends PredictiveCell {
  vehicleLabel: string;
  cluster: string | null;
  item: string | null;
  planName: string | null;
  currentKm: number | null;
}

export function remainingKmText(km: number | null | undefined): string {
  if (km == null) return "—";
  if (km < 0) return `${formatInt(-km)} km excedidos`;
  return `faltam ${formatInt(km)} km`;
}

export function remainingDaysText(days: number | null | undefined): string {
  if (days == null) return "—";
  if (days < 0) return `${formatInt(-days)} ${days === -1 ? "dia" : "dias"} em atraso`;
  if (days === 0) return "vence hoje";
  return `${days === 1 ? "falta" : "faltam"} ${formatInt(days)} ${days === 1 ? "dia" : "dias"}`;
}

export function referenceText(type: string, date: string | null, km: number | null): string {
  const parts = [REFERENCE_TYPE_LABEL[type] ?? type];
  if (date) parts.push(formatDate(date));
  if (km != null) parts.push(formatKm(km));
  return parts.join(" · ");
}

/** Serviços ativos para abrir a manutenção do item: os do cluster primeiro; sem eles, todos. */
export function servicesForCluster(services: MaintenanceService[], cluster: string | null): MaintenanceService[] {
  const active = services.filter((s) => s.status === "active");
  const inCluster = cluster ? active.filter((s) => s.clusterName === cluster) : [];
  return (inCluster.length ? inCluster : active).slice().sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
}

const HISTORY_ERROR = "Não foi possível carregar o histórico do item.";

/**
 * Lê o histórico do ciclo sob demanda. Sem estado síncrono no efeito: o
 * resultado carrega a chave da leitura, e "carregando" é só a chave atual
 * ainda sem resposta. `reload` pede uma nova leitura do mesmo ciclo.
 */
export function useCycleHistory(cycleId: string | null) {
  const [nonce, setNonce] = React.useState(0);
  const [state, setState] = React.useState<{ key: string; data: PredictiveCycleHistory | null; error: string | null } | null>(null);
  const key = cycleId ? `${cycleId}#${nonce}` : null;

  React.useEffect(() => {
    if (!cycleId) return;
    const current = `${cycleId}#${nonce}`;
    let alive = true;
    loadPredictiveCycleHistory(cycleId)
      .then((result) => {
        if (!alive) return;
        if (!result.ok) setState({ key: current, data: null, error: result.error ?? HISTORY_ERROR });
        else if (!result.data) setState({ key: current, data: null, error: "Ciclo não encontrado ou fora do seu acesso." });
        else setState({ key: current, data: result.data, error: null });
      })
      .catch(() => {
        if (alive) setState({ key: current, data: null, error: HISTORY_ERROR });
      });
    return () => {
      alive = false;
    };
  }, [cycleId, nonce]);

  const ready = state !== null && state.key === key;
  const sameCycle = state !== null && cycleId !== null && state.key.startsWith(`${cycleId}#`);
  const reload = React.useCallback(() => setNonce((n) => n + 1), []);
  return {
    history: sameCycle ? state.data : null,
    error: ready ? state.error : null,
    loading: !ready,
    reload,
  };
}

// ---------------------------------------------------------------------------
// Gaveta
// ---------------------------------------------------------------------------

export interface PredictiveCycleDrawerProps {
  cycleId: string | null;
  /** Situação atual do ciclo, como a matriz/alertas a mostram (pode faltar quando se chega pela auditoria). */
  context: PredictiveCycleContext | null;
  today: string;
  perms: MaintenancePerms;
  onOpenChange: (open: boolean) => void;
  onOpenMaintenance: (id: string) => void;
  /** Depois de uma escrita (baixa manual): o painel relê a página. */
  onChanged: () => void;
  /** Abre o diálogo de verificação técnica para o ciclo. */
  onRegisterVerification?: (cycleId: string) => void;
  /** Abre o diálogo de geração de manutenção para o ciclo. */
  onGenerate?: (cycleId: string) => void;
}

export function PredictiveCycleDrawer(props: PredictiveCycleDrawerProps) {
  return (
    <Drawer open={Boolean(props.cycleId)} onOpenChange={props.onOpenChange}>
      <DrawerContent size="lg" data-testid="maintenance-predictive-drawer">
        {props.cycleId ? <CycleBody key={props.cycleId} {...props} cycleId={props.cycleId} /> : null}
      </DrawerContent>
    </Drawer>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <span className="text-caption text-fg-muted">{label}</span>
      <span className="text-body-sm text-fg">{children ?? "—"}</span>
    </div>
  );
}

function Section({ title, meta, children, testId }: { title: string; meta?: React.ReactNode; children: React.ReactNode; testId?: string }) {
  return (
    <section className="flex flex-col gap-2 rounded-md border border-border p-3" data-testid={testId}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-2">
        <h4 className="text-label font-semibold text-fg">{title}</h4>
        {meta != null ? <span className="text-caption text-fg-muted">{meta}</span> : null}
      </div>
      {children}
    </section>
  );
}

type Mode = "idle" | "reset";

function CycleBody({
  cycleId, context, today, perms, onOpenChange, onOpenMaintenance, onChanged, onRegisterVerification, onGenerate,
}: PredictiveCycleDrawerProps & { cycleId: string }) {
  const { toast } = useToast();
  const { history, error, loading, reload } = useCycleHistory(cycleId);
  const [busy, startTransition] = React.useTransition();
  const [mode, setMode] = React.useState<Mode>("idle");
  const [resetDate, setResetDate] = React.useState(today);
  const [resetKm, setResetKm] = React.useState("");
  const [reason, setReason] = React.useState("");
  const [tried, setTried] = React.useState(false);

  const item = history?.item ?? null;
  const state = history?.state ?? null;
  const ctx = history?.context ?? null;
  const steps = (item?.checklist ?? []).filter((s) => s.active !== false);
  const stepByKey = new Map(steps.map((s) => [s.key, s]));

  // A situação vem do que a tela já sabia OU do estado recalculado do histórico (quem chega pela auditoria não tem contexto).
  const status = state?.technicalStatus ?? context?.status ?? null;
  const execution = state?.executionStatus ?? context?.execution ?? null;
  const conformity = state?.conformity ?? context?.conformity ?? null;
  const nextKm = state?.nextKm ?? context?.nextKm ?? null;
  const nextDate = state?.nextDate ?? context?.nextDate ?? null;
  const currentKm = state?.currentKm ?? context?.currentKm ?? null;
  const kmRemaining = state?.kmRemaining ?? context?.kmRemaining ?? null;
  const daysRemaining = state?.daysRemaining ?? context?.daysRemaining ?? null;
  const pctConsumed = state?.pctConsumed ?? context?.pctConsumed ?? null;
  const referenceType = state?.referenceType ?? context?.referenceType ?? null;
  const referenceDate = state?.referenceDate ?? context?.referenceDate ?? null;
  const referenceKm = state?.referenceKm ?? context?.referenceKm ?? null;
  const monitoring = state?.monitoringActive ?? context?.monitoring ?? false;
  const kmStale = state?.kmStale ?? context?.kmStale ?? false;
  const openMaintenanceId = state?.openMaintenanceId ?? context?.openMaintenanceId ?? null;
  const openMaintenanceCode = state?.openMaintenanceCode ?? context?.openMaintenanceCode ?? null;
  const lastVerificationOn = state?.lastVerificationOn ?? context?.lastVerificationOn ?? null;

  const openMaintenance = (id: string) => {
    onOpenChange(false);
    onOpenMaintenance(id);
  };

  // Baixa manual: data até hoje, KM obrigatório, justificativa de 10+ caracteres.
  const kmValue = resetKm.trim() === "" ? null : Number(resetKm);
  const kmInvalid = kmValue === null || !Number.isInteger(kmValue) || kmValue < 0;
  const dateInvalid = !resetDate || (today !== "" && resetDate > today);
  const reasonInvalid = reason.trim().length < 10;

  const submitReset = () => {
    setTried(true);
    if (kmInvalid || dateInvalid || reasonInvalid) return;
    startTransition(async () => {
      const result = await resetPredictiveCycle(cycleId, resetDate, kmValue, reason.trim());
      if (result.ok) {
        toast({
          title: "Baixa manual registrada.",
          description: "A referência do cálculo passou a ser a baixa; quem registrou, o motivo e a referência anterior ficaram na auditoria.",
          variant: "success",
        });
        setMode("idle");
        setReason("");
        setResetKm("");
        setTried(false);
        reload();
        onChanged();
      } else {
        toast({ title: result.error ?? "Não foi possível registrar a baixa manual.", variant: "danger" });
      }
    });
  };

  const title = item?.name ?? context?.item ?? "Item técnico";
  const vehicle = context?.vehicleLabel ?? (ctx ? [ctx.fleetCode, ctx.licensePlate].filter(Boolean).join(" · ") : null);
  const subtitle = [vehicle, item?.cluster ?? context?.cluster, history?.plan?.name ?? context?.planName].filter(Boolean).join(" · ") || (loading ? "Carregando…" : "Ciclo preditivo");

  return (
    <>
      <DrawerHeader>
        <DrawerTitle>{title}</DrawerTitle>
        <DrawerDescription>{subtitle}</DrawerDescription>
      </DrawerHeader>

      <DrawerBody className="flex flex-col gap-4" aria-busy={loading || busy}>
        {status && execution && conformity ? (
          <>
            <section aria-label="Situação do item" className="grid grid-cols-1 gap-3 rounded-md border border-border p-3 sm:grid-cols-3">
              <Fact label="Situação técnica (KM/dias)">
                <span className="flex flex-wrap items-center gap-1.5">
                  <PredictiveStatusBadge status={status} />
                  {monitoring ? <Badge size="sm" variant="neutral" appearance="outline" icon={<Eye />}>Monitorando</Badge> : null}
                  {kmStale ? <KmStaleBadge ageDays={state?.kmAgeDays} /> : null}
                </span>
              </Fact>
              <Fact label="Execução (manutenção)">
                <ExecutionBadge execution={execution} />
              </Fact>
              <Fact label="Conformidade">{CONFORMITY_LABEL[conformity] ?? conformity}</Fact>
            </section>
            <p className="-mt-2 text-caption text-fg-muted">
              A situação técnica mede a distância até o próximo marco de KM ou data (vale o pior caso). A execução diz se há manutenção aberta
              para o item. A conformidade é o resultado da última verificação formal. São independentes.
            </p>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
              <Fact label="Próximo marco (KM)">{nextKm != null ? formatKm(nextKm) : "—"}</Fact>
              <Fact label="Próxima data">{formatDate(nextDate)}</Fact>
              <Fact label="KM atual (oficial)">
                {formatKm(currentKm)}
                {state?.currentKmDate ? <span className="text-fg-muted"> · {formatDate(state.currentKmDate)}</span> : null}
              </Fact>
              <Fact label="Saldo em KM">{remainingKmText(kmRemaining)}</Fact>
              <Fact label="Saldo em dias">{remainingDaysText(daysRemaining)}</Fact>
              <Fact label="Consumo do intervalo">{pctConsumed != null ? pctText(pctConsumed) : "—"}</Fact>
              <Fact label="Referência do cálculo">
                <span className="flex flex-wrap items-center gap-1.5">
                  {referenceType ? <ReferenceBadge type={referenceType} /> : null}
                  <span>{[referenceDate ? formatDate(referenceDate) : null, referenceKm != null ? formatKm(referenceKm) : null].filter(Boolean).join(" · ") || "—"}</span>
                </span>
              </Fact>
              <Fact label="Monitoramento">
                {monitoring ? (
                  <span className="inline-flex items-center gap-1">
                    <Eye className="size-3.5 text-fg-muted" aria-hidden />
                    Alvo reduzido
                    {state?.monitoringKm != null ? ` · ${formatKm(state.monitoringKm)}` : ""}
                    {state?.monitoringDays != null ? ` · ${formatInt(state.monitoringDays)} dias` : ""}
                  </span>
                ) : (
                  "Não"
                )}
              </Fact>
              <Fact label="Manutenção aberta">
                {openMaintenanceId ? (
                  <button type="button" className="rounded-xs font-medium text-link underline-offset-2 hover:underline hfm-focus-ring" onClick={() => openMaintenance(openMaintenanceId)}>
                    {openMaintenanceCode ?? "Abrir manutenção"}
                  </button>
                ) : (
                  "Nenhuma"
                )}
              </Fact>
              <Fact label="Última verificação">{formatDate(lastVerificationOn)}</Fact>
            </div>
            {referenceType && REFERENCE_FORMAL[referenceType] === false && referenceType !== "none" ? (
              <Alert variant="warning">
                <AlertDescription>
                  A referência atual vem do histórico do cluster (manutenção real anterior), não de verificação formal. Uma verificação
                  conforme ou uma manutenção com cobertura total passa a valer como referência formal.
                </AlertDescription>
              </Alert>
            ) : null}
          </>
        ) : null}

        {loading && !history ? (
          <div className="flex flex-col gap-3" role="status" aria-label="Carregando o histórico do item">
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-32 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
        ) : null}

        {error ? (
          <Alert variant="danger" action={<Button size="sm" variant="outline" leadingIcon={<RotateCw />} onClick={reload}>Tentar de novo</Button>}>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}

        {ctx ? (
          <Section title="Contexto operacional" testId="maintenance-predictive-drawer-context">
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
              <Fact label="Veículo">{[ctx.fleetCode, ctx.licensePlate].filter(Boolean).join(" · ") || "—"}</Fact>
              <Fact label="Tipo · modelo">{[ctx.typeName, ctx.modelName].filter(Boolean).join(" · ") || "—"}</Fact>
              <Fact label="Operação">{ctx.operationName ?? "—"}</Fact>
              <Fact label="Local">{[ctx.cityName, ctx.stateUf].filter(Boolean).join("/") || "—"}</Fact>
              <Fact label="BR">{ctx.brCode ?? "—"}</Fact>
              <Fact label="Liderança">{ctx.leaderName ?? "—"}</Fact>
            </div>
          </Section>
        ) : null}

        {history ? (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <Section title="Última manutenção">
              {history.lastMaintenance ? (
                <div className="flex flex-col gap-1 text-body-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <button type="button" className="rounded-xs font-semibold text-link underline-offset-2 hover:underline hfm-focus-ring" onClick={() => openMaintenance(history.lastMaintenance!.id)}>
                      {history.lastMaintenance.code}
                    </button>
                    <MaintenanceTypeBadge type={history.lastMaintenance.type} />
                    <MaintenanceStatusBadge status={history.lastMaintenance.status} />
                  </div>
                  {history.lastMaintenance.services ? <p className="text-fg">{history.lastMaintenance.services}</p> : null}
                  <p className="text-caption text-fg-muted">
                    Saída {formatDate(history.lastMaintenance.exitDate)}
                    {history.lastMaintenance.entryKm != null ? ` · ${formatKm(history.lastMaintenance.entryKm)}` : ""}
                    {history.lastMaintenance.supplier ? ` · ${history.lastMaintenance.supplier}` : ""}
                  </p>
                </div>
              ) : (
                <p className="text-body-sm text-fg-muted">Nenhuma manutenção deste item ou do cluster no veículo.</p>
              )}
            </Section>
            <Section title="Última verificação">
              {history.lastVerification ? (
                <div className="flex flex-col gap-1 text-body-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <VerificationResultBadge result={history.lastVerification.result} />
                    <span className="font-medium text-fg">{DECISION_LABEL[history.lastVerification.decision] ?? history.lastVerification.decision}</span>
                  </div>
                  <p className="text-caption text-fg-muted">
                    {formatDate(history.lastVerification.verifiedOn)} · {history.lastVerification.km != null ? formatKm(history.lastVerification.km) : "KM não resolvido"} ·{" "}
                    {history.lastVerification.responsible ?? "Responsável não informado"}
                    {history.lastVerification.source ? ` · ${VERIFICATION_SOURCE_LABEL[history.lastVerification.source] ?? history.lastVerification.source}` : ""}
                  </p>
                  {history.lastVerification.notes ? <p className="whitespace-pre-line text-fg">{history.lastVerification.notes}</p> : null}
                </div>
              ) : (
                <p className="text-body-sm text-fg-muted">Nenhuma verificação formal registrada.</p>
              )}
            </Section>
          </div>
        ) : null}

        {item ? (
          <Section title="Item técnico" meta={history?.plan ? `${history.plan.code} · v${history.plan.version}` : undefined}>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
              <Fact label="Intervalo em KM">{item.intervalKm != null ? formatKm(item.intervalKm) : "—"}</Fact>
              <Fact label="Intervalo em dias">{item.intervalDays != null ? `${formatInt(item.intervalDays)} dias` : "—"}</Fact>
              <Fact label="Criticidade">{item.criticality ? <CriticalityBadge value={item.criticality} /> : "—"}</Fact>
              <Fact label="Bandas (alerta · programar · tolerância)">
                {item.alertPct != null ? `${formatInt(item.alertPct)}% · ${formatInt(item.schedulePct ?? 0)}% · ${formatInt(item.tolerancePct ?? 0)}%` : "—"}
              </Fact>
              <Fact label="Horas de motor">{item.intervalEngineHours != null ? `${formatInt(item.intervalEngineHours)} h (fora do cálculo)` : "—"}</Fact>
              <Fact label="Cobertura técnica">
                {item.coverage && item.coverage.length ? (
                  <span className="flex flex-wrap gap-1">
                    {item.coverage.map((c) => (
                      <Badge key={c.serviceId} size="sm" variant={c.coverage === "full" ? "success" : "neutral"} appearance="outline">
                        {c.service} · {c.coverage === "full" ? "total" : "parcial"}
                      </Badge>
                    ))}
                  </span>
                ) : (
                  "Nenhum serviço reinicia este item"
                )}
              </Fact>
            </div>
            {item.technicalDescription ? (
              <Fact label="Descrição técnica">
                <span className="whitespace-pre-line">{item.technicalDescription}</span>
              </Fact>
            ) : null}
            <div className="flex flex-col gap-1">
              <span className="text-caption text-fg-muted">Roteiro técnico</span>
              {steps.length === 0 ? (
                <p className="text-body-sm text-fg-muted">Este item não tem roteiro cadastrado.</p>
              ) : (
                <ol className="flex flex-col gap-1">
                  {steps.map((step, index) => (
                    <li key={step.key} className="flex items-start gap-2 text-body-sm text-fg">
                      <span className="w-5 shrink-0 text-right tabular-nums text-fg-muted">{index + 1}.</span>
                      <span className="min-w-0 flex-1">
                        {step.description}
                        {step.approvalCriteria ? <span className="block text-caption text-fg-muted">Critério: {step.approvalCriteria}</span> : null}
                        {step.applicability ? <span className="block text-caption text-fg-muted">Aplica-se a: {step.applicability}</span> : null}
                      </span>
                      <span className="flex shrink-0 gap-1">
                        <Badge size="sm" variant="neutral" appearance="outline">{RESPONSE_TYPE_LABEL[step.responseType ?? "conformity"]}</Badge>
                        {step.required !== false ? (
                          <Badge size="sm" variant="warning" appearance="outline">Obrigatório</Badge>
                        ) : (
                          <Badge size="sm" variant="neutral" appearance="outline">Opcional</Badge>
                        )}
                      </span>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          </Section>
        ) : null}

        {history ? (
          <Section title="Verificações" meta={`${formatInt(history.verifications.length)} registro(s)`}>
            {history.verifications.length === 0 ? (
              <p className="text-body-sm text-fg-muted">Nenhuma verificação formal registrada para este item.</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {history.verifications.map((v) => (
                  <li key={v.id} className="flex flex-col gap-1.5 rounded-sm border border-border bg-surface-secondary p-2.5 text-body-sm">
                    <div className="flex flex-wrap items-center gap-2">
                      <VerificationResultBadge result={v.result} />
                      <span className="font-medium text-fg">{DECISION_LABEL[v.decision] ?? v.decision}</span>
                      {v.source ? <Badge size="sm" variant="neutral" appearance="outline">{VERIFICATION_SOURCE_LABEL[v.source] ?? v.source}</Badge> : null}
                    </div>
                    <p className="text-caption text-fg-secondary">
                      {formatDate(v.verifiedOn)} · {v.km != null ? formatKm(v.km) : "KM não resolvido"} · {v.responsible ?? "Responsável não informado"}
                    </p>
                    {v.monitorKm != null || v.monitorDays != null ? (
                      <p className="text-caption text-fg-secondary">
                        Monitorar por {[v.monitorKm != null ? formatKm(v.monitorKm) : null, v.monitorDays != null ? `${formatInt(v.monitorDays)} dias` : null].filter(Boolean).join(" ou ")}
                      </p>
                    ) : null}
                    {v.notes ? <p className="whitespace-pre-line text-fg">{v.notes}</p> : null}
                    {v.checklist.length > 0 ? (
                      <ul className="flex flex-col gap-0.5 border-t border-border-subtle pt-1.5">
                        {v.checklist.map((answer) => (
                          <li key={answer.key} className="flex items-start justify-between gap-3 text-caption">
                            <span className="min-w-0 text-fg-secondary">{stepByKey.get(answer.key)?.description ?? answer.key}</span>
                            <span className="shrink-0 font-medium text-fg">{answerLabel(stepByKey.get(answer.key), answer.answer)}</span>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-caption text-fg-muted">
                      <span>Registrada em {formatStamp(v.createdAt)}</span>
                      {v.maintenanceId ? (
                        <button type="button" className="rounded-xs font-medium text-link underline-offset-2 hover:underline hfm-focus-ring" onClick={() => openMaintenance(v.maintenanceId!)}>
                          Ver manutenção gerada
                        </button>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        ) : null}

        {history ? (
          <Section title="Manutenções do item e do cluster" meta={`${formatInt(history.maintenances.length)} registro(s)`}>
            {history.maintenances.length === 0 ? (
              <p className="text-body-sm text-fg-muted">Nenhuma manutenção deste item ou do mesmo cluster no veículo.</p>
            ) : (
              <ul className="flex flex-col divide-y divide-border-subtle">
                {history.maintenances.map((m) => (
                  <li key={m.id} className="flex flex-col gap-1 py-2 first:pt-0 last:pb-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <button type="button" className="rounded-xs text-body-sm font-semibold text-link underline-offset-2 hover:underline hfm-focus-ring" onClick={() => openMaintenance(m.id)} aria-label={`Abrir a manutenção ${m.code}`}>
                        {m.code}
                      </button>
                      <MaintenanceTypeBadge type={m.type} />
                      <MaintenanceStatusBadge status={m.status} />
                    </div>
                    {m.services ? <p className="text-body-sm text-fg">{m.services}</p> : null}
                    <p className="text-caption text-fg-muted">
                      Entrada {formatDate(m.entryDate)} · saída {formatDate(m.exitDate)}
                      {m.entryKm != null ? ` · ${formatKm(m.entryKm)}` : ""}
                      {m.serviceOrderNumber ? ` · OS ${m.serviceOrderNumber}` : ""}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        ) : null}

        {history?.events ? (
          <Section title="Linha do tempo" meta={`${formatInt(history.events.length)} evento(s) · imutável`} testId="maintenance-predictive-drawer-events">
            {history.events.length === 0 ? (
              <p className="text-body-sm text-fg-muted">Nenhum evento registrado.</p>
            ) : (
              <ol className="flex flex-col gap-1.5">
                {history.events.slice().reverse().map((e) => (
                  <li key={e.id} className="flex items-start gap-2 text-body-sm">
                    <Clock className="mt-1 size-3.5 shrink-0 text-fg-muted" aria-hidden />
                    <div className="min-w-0 flex-1">
                      <p className="text-fg">
                        <span className="font-medium">{PREDICTIVE_EVENT_LABEL[e.eventType] ?? e.eventType}</span>
                        {e.result ? <span className="text-fg-secondary"> · {CONFORMITY_LABEL[e.result] ?? e.result}</span> : null}
                        {e.fromStatus || e.toStatus ? <span className="text-fg-secondary"> · {e.fromStatus ?? "—"} → {e.toStatus ?? "—"}</span> : null}
                        {e.km != null ? <span className="text-fg-secondary"> · {formatKm(e.km)}</span> : null}
                      </p>
                      <p className="text-caption text-fg-muted">
                        {formatStamp(e.occurredAt)} · {e.actorName ?? "—"} · {PREDICTIVE_EVENT_SOURCE_LABEL[e.source] ?? e.source}
                        {e.referenceType ? ` · referência: ${REFERENCE_TYPE_LABEL[e.referenceType] ?? e.referenceType}` : ""}
                        {typeof e.details?.reason === "string" ? ` · ${e.details.reason}` : ""}
                        {typeof e.details?.code === "string" ? ` · ${e.details.code}` : ""}
                      </p>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </Section>
        ) : null}

        {mode === "reset" ? (
          <section className="flex flex-col gap-3 rounded-md border border-warning/40 p-3" aria-labelledby="predictive-reset-title" data-testid="maintenance-predictive-reset">
            <h4 id="predictive-reset-title" className="text-label font-semibold text-fg">Baixa manual do ciclo</h4>
            <Alert variant="warning">
              <AlertTitle>Exceção auditada</AlertTitle>
              <AlertDescription>
                O ciclo passa a contar desta data e deste KM, sem verificação nem manutenção. Data, KM, motivo e quem registrou ficam na
                auditoria e na linha do tempo do ciclo.
              </AlertDescription>
            </Alert>
            <FormGrid columns={2}>
              <FormField label="Data da baixa" required error={tried && dateInvalid ? "Informe uma data até hoje." : undefined}>
                <DateInput value={resetDate} max={today || undefined} onChange={(e) => setResetDate(e.target.value)} />
              </FormField>
              <FormField label="KM da baixa" required error={tried && kmInvalid ? "Informe um KM inteiro, maior ou igual a zero." : undefined}>
                <Input type="number" inputMode="numeric" min={0} step={1} value={resetKm} onChange={(e) => setResetKm(e.target.value)} trailingAddon="km" />
              </FormField>
            </FormGrid>
            <FormField label="Motivo" required helperText="Mínimo de 10 caracteres. Fica registrado na auditoria." error={tried && reasonInvalid ? "Descreva o motivo em pelo menos 10 caracteres." : undefined}>
              <Textarea rows={3} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Ex.: troca do conjunto registrada fora do sistema, OS 4521 da oficina parceira." />
            </FormField>
          </section>
        ) : null}
      </DrawerBody>

      <DrawerFooter className="flex-wrap">
        {mode === "idle" ? (
          <>
            {perms.predictiveReset ? (
              <Button variant="outline" leadingIcon={<RotateCcw />} onClick={() => { setMode("reset"); setResetDate(today); setTried(false); }} disabled={loading && !history}>
                Baixa manual
              </Button>
            ) : null}
            {perms.predictiveGenerate && onGenerate && !openMaintenanceId ? (
              <Button variant="outline" onClick={() => onGenerate(cycleId)}>
                Gerar manutenção
              </Button>
            ) : null}
            {perms.predictiveVerify && onRegisterVerification ? (
              <Button leadingIcon={<ClipboardCheck />} onClick={() => onRegisterVerification(cycleId)}>
                Registrar verificação
              </Button>
            ) : null}
            <Button variant="secondary" onClick={() => onOpenChange(false)}>
              Fechar
            </Button>
          </>
        ) : (
          <>
            <Button variant="secondary" onClick={() => setMode("idle")} disabled={busy}>
              Voltar
            </Button>
            <Button leadingIcon={<RotateCcw />} onClick={submitReset} loading={busy}>
              Confirmar baixa
            </Button>
          </>
        )}
      </DrawerFooter>
    </>
  );
}
