"use client";

import * as React from "react";
import { CheckCircle2, RotateCw } from "lucide-react";
import {
  Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CheckboxField } from "@/components/ui/checkbox";
import { DateInput } from "@/components/ui/date-input";
import { FormField, FormGrid } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { RadioField, RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription, AlertTitle } from "@/components/feedback/alert";
import { Skeleton } from "@/components/feedback/skeleton";
import { useToast } from "@/components/feedback/toast";
import { NativeSelect } from "@/components/governance/selects";
import { PredictiveStatusBadge, VerificationResultBadge } from "@/components/maintenance/badges";
import { cn } from "@/lib/cn";
import { registerPredictiveVerification } from "@/lib/maintenance/actions";
import {
  DECISION_LABEL,
  formatKm,
  KM_STATUS_LABEL,
  VERIFICATION_RESULT_LABEL,
  type KmStatus,
  type MaintenanceCatalog,
  type VerificationResult,
} from "@/lib/maintenance/types";
import {
  CHECKLIST_ANSWER_LABEL,
  CHECKLIST_ANSWERS,
  ExecutionBadge,
  servicesForCluster,
  useCycleHistory,
  type ChecklistAnswer,
  type PredictiveCycleContext,
} from "./predictive-cycle-drawer";

/**
 * Preditiva — registro de verificação técnica de um ciclo.
 *
 * O formulário coleta o fato (resultado, data, KM, responsável, respostas do
 * roteiro); a decisão — reiniciar, monitorar, abrir manutenção — é do banco,
 * que a devolve e a grava junto com a verificação. A tela mostra essa decisão
 * como veio, para que fique claro o que aconteceu com o ciclo.
 */

export interface PredictiveVerificationDialogProps {
  cycleId: string | null;
  context: PredictiveCycleContext | null;
  /** Data de hoje no fuso da organização (limite da verificação). */
  today: string;
  catalog: MaintenanceCatalog;
  onOpenChange: (open: boolean) => void;
  /** Chamado após o registro: o painel relê a página. */
  onDone: () => void;
  onOpenMaintenance?: (id: string) => void;
}

export function PredictiveVerificationDialog(props: PredictiveVerificationDialogProps) {
  return (
    <Dialog open={Boolean(props.cycleId)} onOpenChange={props.onOpenChange}>
      <DialogContent size="lg" data-testid="maintenance-predictive-verification">
        {props.cycleId ? <VerificationForm key={props.cycleId} {...props} cycleId={props.cycleId} /> : null}
      </DialogContent>
    </Dialog>
  );
}

const RESULTS: VerificationResult[] = ["conforming", "monitor", "non_conforming", "not_performed"];

/** O que cada resultado costuma provocar — a decisão final é a que o banco devolve. */
const RESULT_HINT: Record<VerificationResult, string> = {
  conforming: "Item conforme. O ciclo recomeça a partir desta verificação.",
  monitor: "Conforme, mas sob observação: o ciclo recomeça com alvo reduzido de KM e/ou dias.",
  non_conforming: "Requer intervenção. O ciclo não recomeça e a manutenção preditiva é aberta.",
  not_performed: "A verificação não pôde ser feita. Só registra a tentativa; o ciclo não muda.",
};

const KM_SOURCE_LABEL: Record<string, string> = { informed: "Informado na verificação" };

interface Outcome {
  decision: string;
  km: number | null;
  kmSource: string | null;
  maintenance: { id: string; code: string; created: boolean } | null;
}

const toInt = (text: string): number | null => {
  const t = text.trim();
  if (t === "") return null;
  const n = Number(t);
  return Number.isInteger(n) ? n : NaN;
};

function VerificationForm({
  cycleId, context, today, catalog, onOpenChange, onDone, onOpenMaintenance,
}: PredictiveVerificationDialogProps & { cycleId: string }) {
  const { toast } = useToast();
  const baseId = React.useId();
  const { history, error, loading, reload } = useCycleHistory(cycleId);
  const [busy, startTransition] = React.useTransition();
  const [outcome, setOutcome] = React.useState<Outcome | null>(null);
  const [tried, setTried] = React.useState(false);

  const [result, setResult] = React.useState<VerificationResult | "">("");
  const [verifiedOn, setVerifiedOn] = React.useState(today);
  const [km, setKm] = React.useState("");
  const [responsible, setResponsible] = React.useState("");
  const [answers, setAnswers] = React.useState<Record<string, ChecklistAnswer>>({});
  const [notes, setNotes] = React.useState("");
  const [monitorKm, setMonitorKm] = React.useState("");
  const [monitorDays, setMonitorDays] = React.useState("");
  const [openMaintenance, setOpenMaintenance] = React.useState(true);
  const [scheduledDate, setScheduledDate] = React.useState("");
  const [serviceId, setServiceId] = React.useState("");

  const item = history?.item ?? null;
  const steps = item?.checklist ?? [];
  const isRequired = (required: boolean | undefined) => required !== false;

  // Sem serviço padrão no item, a manutenção precisa de um serviço escolhido.
  const needsService = Boolean(item) && !item?.serviceId;
  const cluster = context?.cluster ?? null;
  const services = React.useMemo(() => servicesForCluster(catalog.services, cluster), [catalog.services, cluster]);

  // Validação de conveniência — o banco confere tudo de novo.
  const kmNum = toInt(km);
  const monitorKmNum = toInt(monitorKm);
  const monitorDaysNum = toInt(monitorDays);
  const opensMaintenance = result === "non_conforming" && openMaintenance;
  const missingSteps =
    result && result !== "not_performed"
      ? steps.filter((s) => isRequired(s.required) && !answers[s.key]).map((s) => s.key)
      : [];
  const errors = {
    result: !result ? "Escolha o resultado da verificação." : null,
    date: !verifiedOn ? "Informe a data da verificação." : today && verifiedOn > today ? "A verificação não pode estar no futuro." : null,
    km: kmNum !== null && (Number.isNaN(kmNum) || kmNum < 0) ? "Informe um KM inteiro, maior ou igual a zero." : null,
    responsible: responsible.trim().length < 2 ? "Informe o responsável pela verificação." : null,
    notes:
      (result === "non_conforming" || result === "not_performed") && notes.trim().length < 5
        ? result === "non_conforming"
          ? "Descreva a não conformidade (mínimo de 5 caracteres)."
          : "Explique por que a verificação não foi realizada (mínimo de 5 caracteres)."
        : null,
    monitor:
      result === "monitor"
        ? (monitorKmNum === null && monitorDaysNum === null)
          ? "Informe o alvo reduzido: KM, dias ou os dois."
          : [monitorKmNum, monitorDaysNum].some((n) => n !== null && (Number.isNaN(n) || n <= 0))
            ? "Use números inteiros maiores que zero."
            : null
        : null,
    steps: missingSteps.length ? `Responda os ${missingSteps.length} passo(s) obrigatório(s) do roteiro.` : null,
    service: opensMaintenance && needsService && !serviceId ? "Escolha o serviço da manutenção." : null,
  };
  const invalid = Object.values(errors).some(Boolean);
  const show = (message: string | null) => (tried && message ? message : undefined);

  const submit = () => {
    setTried(true);
    if (invalid || !result || !history) return;
    startTransition(async () => {
      const response = await registerPredictiveVerification(cycleId, {
        result,
        verifiedOn,
        km: kmNum,
        responsibleName: responsible.trim(),
        checklist: steps.filter((s) => answers[s.key]).map((s) => ({ key: s.key, answer: answers[s.key] })),
        notes: notes.trim() || null,
        monitorKm: result === "monitor" ? monitorKmNum : null,
        monitorDays: result === "monitor" ? monitorDaysNum : null,
        openMaintenance: result === "non_conforming" ? openMaintenance : undefined,
        serviceIds: opensMaintenance && serviceId ? [serviceId] : undefined,
        scheduledDate: opensMaintenance ? scheduledDate || null : null,
      });
      if (!response.ok || !response.data) {
        toast({ title: response.error ?? "Não foi possível registrar a verificação.", variant: "danger" });
        return;
      }
      const data = response.data;
      setOutcome({
        decision: data.decision,
        km: data.km ?? null,
        kmSource: data.kmSource ?? null,
        maintenance: data.maintenance ?? null,
      });
      toast({
        title: "Verificação registrada.",
        description: DECISION_LABEL[data.decision] ?? data.decision,
        variant: "success",
      });
      onDone();
    });
  };

  const header = (
    <DialogHeader>
      <DialogTitle>Registrar verificação técnica</DialogTitle>
      <DialogDescription>
        {[context?.vehicleLabel, context?.cluster, item?.name ?? context?.item].filter(Boolean).join(" · ") || "Ciclo preditivo"}
      </DialogDescription>
    </DialogHeader>
  );

  // ------------------------------------------------------------ resultado
  if (outcome) {
    const kmSourceLabel = outcome.kmSource
      ? KM_SOURCE_LABEL[outcome.kmSource] ?? KM_STATUS_LABEL[outcome.kmSource as KmStatus] ?? outcome.kmSource
      : null;
    return (
      <>
        {header}
        <DialogBody className="flex flex-col gap-3" data-testid="maintenance-predictive-verification-outcome">
          <Alert variant="success" icon={<CheckCircle2 aria-hidden />}>
            <AlertTitle>Decisão registrada: {DECISION_LABEL[outcome.decision] ?? outcome.decision}</AlertTitle>
            <AlertDescription>
              A decisão foi tomada pelo servidor a partir do resultado e do estado do ciclo, e fica gravada com a
              verificação.
            </AlertDescription>
          </Alert>
          <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-0.5">
              <dt className="text-caption text-fg-muted">Resultado</dt>
              <dd>{result ? <VerificationResultBadge result={result} /> : "—"}</dd>
            </div>
            <div className="flex flex-col gap-0.5">
              <dt className="text-caption text-fg-muted">KM considerado</dt>
              <dd className="text-body-sm text-fg">
                {outcome.km != null ? formatKm(outcome.km) : "Não resolvido"}
                {kmSourceLabel ? <span className="text-fg-muted"> · {kmSourceLabel}</span> : null}
              </dd>
            </div>
            <div className="flex flex-col gap-0.5 sm:col-span-2">
              <dt className="text-caption text-fg-muted">Manutenção</dt>
              <dd className="text-body-sm text-fg">
                {outcome.maintenance ? (
                  <span className="inline-flex flex-wrap items-center gap-2">
                    <span className="font-semibold">{outcome.maintenance.code}</span>
                    <Badge size="sm" variant={outcome.maintenance.created ? "success" : "info"}>
                      {outcome.maintenance.created ? "Aberta agora" : "Já existia (nenhuma nova foi criada)"}
                    </Badge>
                  </span>
                ) : (
                  "Nenhuma manutenção aberta por esta verificação."
                )}
              </dd>
            </div>
          </dl>
        </DialogBody>
        <DialogFooter>
          {outcome.maintenance && onOpenMaintenance ? (
            <Button
              variant="secondary"
              onClick={() => {
                const id = outcome.maintenance!.id;
                onOpenChange(false);
                onOpenMaintenance(id);
              }}
            >
              Abrir manutenção
            </Button>
          ) : null}
          <Button onClick={() => onOpenChange(false)}>Concluir</Button>
        </DialogFooter>
      </>
    );
  }

  // ------------------------------------------------------------ formulário
  return (
    <>
      {header}
      <DialogBody className="flex flex-col gap-4" aria-busy={loading || busy}>
        {context ? (
          <div className="flex flex-wrap items-center gap-2 text-caption text-fg-muted">
            <span>Situação técnica</span>
            <PredictiveStatusBadge status={context.status} />
            <span className="ml-1">Execução</span>
            <ExecutionBadge execution={context.execution} />
          </div>
        ) : null}

        {loading && !history ? (
          <div className="flex flex-col gap-3" role="status" aria-label="Carregando o roteiro do item">
            <Skeleton className="h-28 w-full" />
            <Skeleton className="h-20 w-full" />
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

        {history ? (
          <>
            <FormField label="Resultado" required error={show(errors.result)}>
              <RadioGroup
                value={result}
                onValueChange={(v) => setResult(v as VerificationResult)}
                className="grid grid-cols-1 gap-1 sm:grid-cols-2"
              >
                {RESULTS.map((code) => (
                  <RadioField
                    key={code}
                    value={code}
                    label={VERIFICATION_RESULT_LABEL[code]}
                    description={RESULT_HINT[code]}
                    className={cn("rounded-sm border", result === code ? "border-primary" : "border-border")}
                  />
                ))}
              </RadioGroup>
            </FormField>

            <FormGrid columns={3}>
              <FormField label="Data da verificação" required error={show(errors.date)}>
                <DateInput value={verifiedOn} max={today || undefined} onChange={(e) => setVerifiedOn(e.target.value)} />
              </FormField>
              <FormField
                label="KM"
                labelHint="Opcional"
                helperText="Vazio: KM oficial da data."
                error={show(errors.km)}
              >
                <Input
                  type="number"
                  inputMode="numeric"
                  min={0}
                  step={1}
                  value={km}
                  onChange={(e) => setKm(e.target.value)}
                  trailingAddon="km"
                />
              </FormField>
              <FormField label="Responsável" required error={show(errors.responsible)}>
                <Input
                  value={responsible}
                  onChange={(e) => setResponsible(e.target.value)}
                  maxLength={120}
                  autoComplete="name"
                  placeholder="Nome de quem verificou"
                />
              </FormField>
            </FormGrid>

            <fieldset className="flex flex-col gap-2">
              <legend className="mb-1 text-label font-medium text-fg">
                Roteiro técnico
                {result === "not_performed" ? (
                  <span className="ml-2 text-caption font-normal text-fg-muted">
                    dispensado quando a verificação não foi realizada
                  </span>
                ) : null}
              </legend>
              {steps.length === 0 ? (
                <p className="text-body-sm text-fg-muted">Este item não tem roteiro cadastrado.</p>
              ) : (
                <ol className="flex flex-col gap-1.5">
                  {steps.map((step, index) => {
                    const missing = tried && missingSteps.includes(step.key);
                    return (
                      <li
                        key={step.key}
                        className={cn(
                          "flex flex-col gap-1.5 rounded-sm border px-2.5 py-2 sm:flex-row sm:items-center sm:justify-between",
                          missing ? "border-danger/60 bg-danger-soft/40" : "border-border",
                        )}
                      >
                        <div className="flex min-w-0 items-start gap-2 text-body-sm text-fg">
                          <span className="w-5 shrink-0 text-right tabular-nums text-fg-muted">{index + 1}.</span>
                          <span className="min-w-0">
                            {step.description}
                            {isRequired(step.required) ? (
                              <>
                                <span className="text-danger" aria-hidden> *</span>
                                <span className="sr-only"> (obrigatório)</span>
                              </>
                            ) : (
                              <span className="ml-1 text-caption text-fg-muted">(opcional)</span>
                            )}
                          </span>
                        </div>
                        <RadioGroup
                          orientation="horizontal"
                          value={answers[step.key] ?? ""}
                          onValueChange={(v) => setAnswers((prev) => ({ ...prev, [step.key]: v as ChecklistAnswer }))}
                          aria-label={`Resposta do passo ${index + 1}: ${step.description}`}
                          aria-invalid={missing || undefined}
                          className="shrink-0 gap-3 pl-7 sm:pl-0"
                        >
                          {CHECKLIST_ANSWERS.map((answer) => {
                            const id = `${baseId}-step-${index}-${answer}`;
                            return (
                              <span key={answer} className="inline-flex items-center gap-1.5">
                                <RadioGroupItem id={id} value={answer} />
                                <label htmlFor={id} className="cursor-pointer text-body-sm text-fg select-none">
                                  {CHECKLIST_ANSWER_LABEL[answer]}
                                </label>
                              </span>
                            );
                          })}
                        </RadioGroup>
                      </li>
                    );
                  })}
                </ol>
              )}
              {tried && errors.steps ? (
                <p role="alert" className="text-helper text-danger">{errors.steps}</p>
              ) : null}
            </fieldset>

            {result === "monitor" ? (
              <fieldset className="flex flex-col gap-2 rounded-md border border-border p-3">
                <legend className="px-1 text-label font-medium text-fg">Monitoramento</legend>
                <p className="text-caption text-fg-muted">
                  O item volta a vencer no alvo reduzido que chegar primeiro. Informe pelo menos um.
                </p>
                <FormGrid columns={2}>
                  <FormField label="Monitorar por (KM)">
                    <Input
                      type="number"
                      inputMode="numeric"
                      min={1}
                      step={1}
                      value={monitorKm}
                      onChange={(e) => setMonitorKm(e.target.value)}
                      trailingAddon="km"
                    />
                  </FormField>
                  <FormField label="Monitorar por (dias)">
                    <Input
                      type="number"
                      inputMode="numeric"
                      min={1}
                      step={1}
                      value={monitorDays}
                      onChange={(e) => setMonitorDays(e.target.value)}
                      trailingAddon="dias"
                    />
                  </FormField>
                </FormGrid>
                {tried && errors.monitor ? <p role="alert" className="text-helper text-danger">{errors.monitor}</p> : null}
              </fieldset>
            ) : null}

            <FormField
              label="Observações"
              required={result === "non_conforming" || result === "not_performed"}
              error={show(errors.notes)}
            >
              <Textarea rows={3} maxLength={1000} value={notes} onChange={(e) => setNotes(e.target.value)} />
            </FormField>

            {result === "non_conforming" ? (
              <fieldset className="flex flex-col gap-2 rounded-md border border-border p-3">
                <legend className="px-1 text-label font-medium text-fg">Manutenção</legend>
                <CheckboxField
                  label="Abrir manutenção preditiva"
                  description="Se já houver manutenção aberta para o item, ela é reaproveitada — nenhuma nova é criada."
                  checked={openMaintenance}
                  onCheckedChange={(v) => setOpenMaintenance(v === true)}
                />
                {openMaintenance ? (
                  <FormGrid columns={2}>
                    <FormField
                      label="Data de agendamento"
                      labelHint="Opcional"
                      helperText="Sem data, a manutenção nasce como Há agendar."
                    >
                      <DateInput
                        value={scheduledDate}
                        min={today || undefined}
                        onChange={(e) => setScheduledDate(e.target.value)}
                      />
                    </FormField>
                    {needsService ? (
                      <FormField
                        label="Serviço"
                        required
                        helperText="O item do plano não tem serviço padrão."
                        error={show(errors.service)}
                      >
                        <NativeSelect value={serviceId} onChange={(e) => setServiceId(e.target.value)}>
                          <option value="">Escolha…</option>
                          {services.map((s) => (
                            <option key={s.id} value={s.id}>
                              {s.name} · {s.clusterName}
                            </option>
                          ))}
                        </NativeSelect>
                      </FormField>
                    ) : null}
                  </FormGrid>
                ) : (
                  <p className="text-caption text-fg-muted">
                    Sem manutenção, o item segue como aguardando corretiva até que uma seja aberta.
                  </p>
                )}
              </fieldset>
            ) : null}
          </>
        ) : null}
      </DialogBody>
      <DialogFooter>
        <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={busy}>
          Cancelar
        </Button>
        <Button onClick={submit} loading={busy} disabled={!history} data-testid="maintenance-predictive-verification-submit">
          Registrar verificação
        </Button>
      </DialogFooter>
    </>
  );
}
