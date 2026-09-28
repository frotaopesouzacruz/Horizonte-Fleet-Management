"use client";

import * as React from "react";
import { ClipboardCheck, Eye, RotateCcw, RotateCw } from "lucide-react";
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
  MaintenanceStatusBadge, MaintenanceTypeBadge, PredictiveStatusBadge, VerificationResultBadge,
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
  REFERENCE_TYPE_LABEL,
  type MaintenanceService,
  type PredictiveCell,
  type PredictiveCycleHistory,
  type PredictiveExecution,
} from "@/lib/maintenance/types";
import type { MaintenancePerms } from "./shared";

/**
 * Preditiva — gaveta do ciclo (veículo × item do plano técnico).
 *
 * Mostra o item (intervalos, descrição, roteiro), as verificações formais com
 * a decisão que cada uma produziu, e as manutenções do item e do cluster no
 * veículo. O reinício manual do ciclo é a exceção auditada: data, KM opcional
 * e justificativa. Nada é recalculado aqui — a banda e a execução chegam do
 * servidor; a gaveta só apresenta e chama a rotina.
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

/** Respostas do roteiro técnico. O código vai para o banco; o rótulo, para a tela. */
export type ChecklistAnswer = "ok" | "out" | "na";
export const CHECKLIST_ANSWERS: ChecklistAnswer[] = ["ok", "out", "na"];
export const CHECKLIST_ANSWER_LABEL: Record<string, string> = {
  ok: "OK",
  out: "Fora",
  na: "N/A",
};

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
  // Ao recarregar o mesmo ciclo, o dado anterior fica na tela até a resposta.
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
  /** Situação atual do ciclo, como a matriz/alertas a mostram. */
  context: PredictiveCycleContext | null;
  today: string;
  perms: MaintenancePerms;
  onOpenChange: (open: boolean) => void;
  onOpenMaintenance: (id: string) => void;
  /** Depois de uma escrita (reinício): o painel relê a página. */
  onChanged: () => void;
  /** Abre o diálogo de verificação técnica para o ciclo. */
  onRegisterVerification?: (cycleId: string) => void;
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

function Section({ title, meta, children }: { title: string; meta?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2 rounded-md border border-border p-3">
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
  cycleId, context, today, perms, onOpenChange, onOpenMaintenance, onChanged, onRegisterVerification,
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
  const steps = item?.checklist ?? [];
  const stepLabel = new Map(steps.map((s) => [s.key, s.description]));

  const openMaintenance = (id: string) => {
    onOpenChange(false);
    onOpenMaintenance(id);
  };

  // Reinício manual: data até hoje, KM opcional, justificativa de 10+ caracteres.
  const kmValue = resetKm.trim() === "" ? null : Number(resetKm);
  const kmInvalid = kmValue !== null && (!Number.isInteger(kmValue) || kmValue < 0);
  const dateInvalid = !resetDate || (today !== "" && resetDate > today);
  const reasonInvalid = reason.trim().length < 10;

  const submitReset = () => {
    setTried(true);
    if (kmInvalid || dateInvalid || reasonInvalid) return;
    startTransition(async () => {
      const result = await resetPredictiveCycle(cycleId, resetDate, kmValue, reason.trim());
      if (result.ok) {
        toast({
          title: "Ciclo reiniciado.",
          description: "A referência do cálculo passou a ser o reinício manual; a alteração ficou na auditoria.",
          variant: "success",
        });
        setMode("idle");
        setReason("");
        setResetKm("");
        setTried(false);
        reload();
        onChanged();
      } else {
        toast({ title: result.error ?? "Não foi possível reiniciar o ciclo.", variant: "danger" });
      }
    });
  };

  const title = item?.name ?? context?.item ?? "Item técnico";
  const subtitle = context
    ? [context.vehicleLabel, context.cluster, context.planName].filter(Boolean).join(" · ")
    : loading
      ? "Carregando…"
      : "Ciclo preditivo";

  return (
    <>
      <DrawerHeader>
        <DrawerTitle>{title}</DrawerTitle>
        <DrawerDescription>{subtitle}</DrawerDescription>
      </DrawerHeader>

      <DrawerBody className="flex flex-col gap-4" aria-busy={loading || busy}>
        {context ? (
          <>
            <section aria-label="Situação do item" className="grid grid-cols-1 gap-3 rounded-md border border-border p-3 sm:grid-cols-3">
              <Fact label="Situação técnica (KM/dias)">
                <PredictiveStatusBadge status={context.status} />
              </Fact>
              <Fact label="Execução (manutenção)">
                <ExecutionBadge execution={context.execution} />
              </Fact>
              <Fact label="Conformidade">{CONFORMITY_LABEL[context.conformity] ?? context.conformity}</Fact>
            </section>
            <p className="-mt-2 text-caption text-fg-muted">
              A situação técnica mede a distância até o próximo marco de KM ou data. A execução diz se há manutenção
              aberta para o item. São independentes: um item pode estar crítico e já agendado.
            </p>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
              <Fact label="Próximo marco (KM)">{context.nextKm != null ? formatKm(context.nextKm) : "—"}</Fact>
              <Fact label="Próxima data">{formatDate(context.nextDate)}</Fact>
              <Fact label="KM atual">{formatKm(context.currentKm)}</Fact>
              <Fact label="Saldo em KM">{remainingKmText(context.kmRemaining)}</Fact>
              <Fact label="Saldo em dias">{remainingDaysText(context.daysRemaining)}</Fact>
              <Fact label="Última verificação">{formatDate(context.lastVerificationOn)}</Fact>
              <Fact label="Referência do cálculo">
                {referenceText(context.referenceType, context.referenceDate, context.referenceKm)}
              </Fact>
              <Fact label="Monitoramento">
                {context.monitoring ? (
                  <span className="inline-flex items-center gap-1">
                    <Eye className="size-3.5 text-fg-muted" aria-hidden />
                    Ativo · alvo reduzido
                  </span>
                ) : (
                  "Não"
                )}
              </Fact>
              <Fact label="Manutenção aberta">
                {context.openMaintenanceId ? (
                  <button
                    type="button"
                    className="rounded-xs font-medium text-link underline-offset-2 hover:underline hfm-focus-ring"
                    onClick={() => openMaintenance(context.openMaintenanceId!)}
                  >
                    {context.openMaintenanceCode ?? "Abrir manutenção"}
                  </button>
                ) : (
                  "Nenhuma"
                )}
              </Fact>
            </div>
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
          <Alert
            variant="danger"
            action={
              <Button size="sm" variant="outline" leadingIcon={<RotateCw />} onClick={reload}>
                Tentar de novo
              </Button>
            }
          >
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}

        {item ? (
          <Section title="Item técnico">
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
              <Fact label="Intervalo em KM">{item.intervalKm != null ? formatKm(item.intervalKm) : "—"}</Fact>
              <Fact label="Intervalo em dias">{item.intervalDays != null ? `${formatInt(item.intervalDays)} dias` : "—"}</Fact>
              <Fact label="Horas de motor">Ainda fora do cálculo</Fact>
            </div>
            <p className="text-caption text-fg-muted">
              Vale o que vencer primeiro, KM ou dias. Intervalos por horas de motor ficam registrados no plano, mas
              ainda não entram na situação técnica.
            </p>
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
                      <span className="min-w-0 flex-1">{step.description}</span>
                      {step.required !== false ? (
                        <Badge size="sm" variant="warning" appearance="outline">Obrigatório</Badge>
                      ) : (
                        <Badge size="sm" variant="neutral" appearance="outline">Opcional</Badge>
                      )}
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
              <p className="text-body-sm text-fg-muted">
                Nenhuma verificação formal registrada para este item.
              </p>
            ) : (
              <ul className="flex flex-col gap-2">
                {history.verifications.map((v) => (
                  <li key={v.id} className="flex flex-col gap-1.5 rounded-sm border border-border bg-surface-secondary p-2.5 text-body-sm">
                    <div className="flex flex-wrap items-center gap-2">
                      <VerificationResultBadge result={v.result} />
                      <span className="font-medium text-fg">{DECISION_LABEL[v.decision] ?? v.decision}</span>
                    </div>
                    <p className="text-caption text-fg-secondary">
                      {formatDate(v.verifiedOn)} · {v.km != null ? formatKm(v.km) : "KM não resolvido"} ·{" "}
                      {v.responsible ?? "Responsável não informado"}
                    </p>
                    {v.monitorKm != null || v.monitorDays != null ? (
                      <p className="text-caption text-fg-secondary">
                        Monitorar por{" "}
                        {[v.monitorKm != null ? formatKm(v.monitorKm) : null, v.monitorDays != null ? `${formatInt(v.monitorDays)} dias` : null]
                          .filter(Boolean)
                          .join(" ou ")}
                      </p>
                    ) : null}
                    {v.notes ? <p className="whitespace-pre-line text-fg">{v.notes}</p> : null}
                    {v.checklist.length > 0 ? (
                      <ul className="flex flex-col gap-0.5 border-t border-border-subtle pt-1.5">
                        {v.checklist.map((answer) => (
                          <li key={answer.key} className="flex items-start justify-between gap-3 text-caption">
                            <span className="min-w-0 text-fg-secondary">{stepLabel.get(answer.key) ?? answer.key}</span>
                            <span className="shrink-0 font-medium text-fg">
                              {CHECKLIST_ANSWER_LABEL[answer.answer] ?? answer.answer}
                            </span>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-caption text-fg-muted">
                      <span>Registrada em {formatStamp(v.createdAt)}</span>
                      {v.maintenanceId ? (
                        <button
                          type="button"
                          className="rounded-xs font-medium text-link underline-offset-2 hover:underline hfm-focus-ring"
                          onClick={() => openMaintenance(v.maintenanceId!)}
                        >
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
                      <button
                        type="button"
                        className="rounded-xs text-body-sm font-semibold text-link underline-offset-2 hover:underline hfm-focus-ring"
                        onClick={() => openMaintenance(m.id)}
                        aria-label={`Abrir a manutenção ${m.code}`}
                      >
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

        {mode === "reset" ? (
          <section
            className="flex flex-col gap-3 rounded-md border border-warning/40 p-3"
            aria-labelledby="predictive-reset-title"
            data-testid="maintenance-predictive-reset"
          >
            <h4 id="predictive-reset-title" className="text-label font-semibold text-fg">Reiniciar ciclo</h4>
            <Alert variant="warning">
              <AlertTitle>Exceção auditada</AlertTitle>
              <AlertDescription>
                O ciclo passa a contar desta data (e deste KM), sem verificação nem manutenção. A justificativa, quem
                reiniciou e a referência anterior ficam na auditoria.
              </AlertDescription>
            </Alert>
            <FormGrid columns={2}>
              <FormField
                label="Data de referência"
                required
                error={tried && dateInvalid ? "Informe uma data até hoje." : undefined}
              >
                <DateInput value={resetDate} max={today || undefined} onChange={(e) => setResetDate(e.target.value)} />
              </FormField>
              <FormField
                label="KM de referência"
                labelHint="Opcional"
                helperText="Vazio: o ciclo recomeça só pela data."
                error={tried && kmInvalid ? "Informe um KM inteiro, maior ou igual a zero." : undefined}
              >
                <Input
                  type="number"
                  inputMode="numeric"
                  min={0}
                  step={1}
                  value={resetKm}
                  onChange={(e) => setResetKm(e.target.value)}
                  trailingAddon="km"
                />
              </FormField>
            </FormGrid>
            <FormField
              label="Justificativa"
              required
              helperText="Mínimo de 10 caracteres. Fica registrada na auditoria."
              error={tried && reasonInvalid ? "Descreva o motivo em pelo menos 10 caracteres." : undefined}
            >
              <Textarea
                rows={3}
                maxLength={500}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Ex.: troca do conjunto registrada fora do sistema, OS 4521 da oficina parceira."
              />
            </FormField>
          </section>
        ) : null}
      </DrawerBody>

      <DrawerFooter className="flex-wrap">
        {mode === "idle" ? (
          <>
            {perms.managePredictive ? (
              <Button
                variant="outline"
                leadingIcon={<RotateCcw />}
                onClick={() => {
                  setMode("reset");
                  setResetDate(today);
                  setTried(false);
                }}
                disabled={loading && !history}
              >
                Reiniciar ciclo
              </Button>
            ) : null}
            {perms.managePredictive && onRegisterVerification ? (
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
              Confirmar reinício
            </Button>
          </>
        )}
      </DrawerFooter>
    </>
  );
}
