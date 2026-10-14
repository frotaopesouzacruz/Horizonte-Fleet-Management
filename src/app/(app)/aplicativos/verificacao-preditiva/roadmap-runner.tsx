"use client";

import * as React from "react";
import { AlertTriangle, ArrowLeft, CheckCircle2, ClipboardCheck, Clock, Eye, History, Plus, Send, Wrench } from "lucide-react";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CheckboxField } from "@/components/ui/checkbox";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/feedback/progress";
import { Alert, AlertDescription, AlertTitle } from "@/components/feedback/alert";
import { EmptyState } from "@/components/feedback/empty-state";
import { ErrorState } from "@/components/feedback/error-state";
import { LoadingState } from "@/components/feedback/loading-state";
import { useToast } from "@/components/feedback/toast";
import { NativeSelect } from "@/components/governance/selects";
import { CriticalityBadge, PredictiveStatusBadge, VerificationResultBadge } from "@/components/maintenance/badges";
import type { loadPredictiveAppRoadmap, submitPredictiveVerification } from "@/lib/maintenance/predictive-app-actions";
import {
  APP_RESPONSE_HINT,
  formatDate,
  formatInt,
  formatKm,
  formatStamp,
  kmDivergent,
  type PredictiveAppContext,
  type PredictiveAppRoadmap,
  type PredictiveAppRoadmapItem,
  type PredictiveAppSubmitItem,
  type PredictiveAppSubmitResult,
} from "@/lib/maintenance/predictive-app";
import {
  CONFORMITY_LABEL,
  DECISION_LABEL,
  EXECUTION_LABEL,
  REFERENCE_TYPE_LABEL,
  VERIFICATION_RESULT_LABEL,
  type PredictiveChecklistStep,
  type VerificationResult,
} from "@/lib/maintenance/types";
import { clearDraft, emptyItem, saveDraft, type ItemDraft, type PredictiveDraft } from "./draft";

/**
 * O executor da Verificação Preditiva: identificação (KM) → roteiro por cluster
 * → revisão → envio → protocolo.
 *
 * Um cartão por item do plano, agrupados pelo cluster, com a situação técnica,
 * o marco e a referência que o servidor calculou. Para cada item verificado a
 * pessoa registra o resultado (Conforme, Monitoramento, Não conforme ou Não
 * realizada), responde ao roteiro conforme o tipo de cada passo e, quando
 * cabe, o alvo do monitoramento ou a descrição da não conformidade. Itens sem
 * resultado não são enviados. O rascunho fica no aparelho até o protocolo; o
 * desfecho de cada item (reiniciar, monitorar, abrir corretiva) é do banco.
 */
export type SubmitFn = typeof submitPredictiveVerification;
export type RoadmapFn = typeof loadPredictiveAppRoadmap;

export interface RunnerLoaders {
  loadRoadmap: RoadmapFn;
  submit: SubmitFn;
}

export type RunnerExit = "new" | "history";
type Phase = "km" | "items" | "review" | "done";

const RESULTS: VerificationResult[] = ["conforming", "monitor", "non_conforming", "not_performed"];
const RESULT_TONE: Record<VerificationResult, string> = {
  conforming: "border-success bg-success-soft text-success-soft-fg",
  monitor: "border-warning bg-warning-soft text-warning-soft-fg",
  non_conforming: "border-danger bg-danger-soft text-danger-soft-fg",
  not_performed: "border-border-strong bg-surface-secondary text-fg",
};
const RESULT_SHORT: Record<VerificationResult, string> = {
  conforming: "Conforme",
  monitor: "Monitorar",
  non_conforming: "Não conforme",
  not_performed: "Não realizada",
};

const activeSteps = (item: PredictiveAppRoadmapItem) => item.checklist.filter((s) => s.active !== false);
const isNumber = (v: string) => !Number.isNaN(Number(v.replace(",", ".")));

/** Pendências de um item respondido, nas palavras que a tela mostra. */
export function itemIssues(item: PredictiveAppRoadmapItem, draft: ItemDraft, notesMin: number): string[] {
  if (!draft.result) return [];
  const issues: string[] = [];
  if ((draft.result === "non_conforming" || draft.result === "not_performed") && draft.notes.trim().length < notesMin) {
    issues.push(draft.result === "non_conforming" ? "descreva a não conformidade" : "informe o motivo da não realização");
  }
  if (draft.result === "monitor") {
    const km = draft.monitorKm.trim();
    const days = draft.monitorDays.trim();
    if (!km && !days) issues.push("informe o alvo do monitoramento (KM e/ou dias)");
    if ((km && (!/^\d+$/.test(km) || Number(km) <= 0)) || (days && (!/^\d+$/.test(days) || Number(days) <= 0))) issues.push("alvo do monitoramento em números inteiros maiores que zero");
  }
  if (draft.result !== "not_performed") {
    for (const step of activeSteps(item)) {
      const answer = (draft.answers[step.key] ?? "").trim();
      if (step.required !== false && !answer) issues.push(`responda “${step.description}”`);
      else if (answer && (step.responseType ?? "conformity") === "number" && !isNumber(answer)) issues.push(`“${step.description}”: use um número`);
    }
  }
  return issues;
}

export function vehicleLine(draft: PredictiveDraft): string {
  const v = draft.vehicle;
  return [v.licensePlate, v.fleetCode ? `Frota ${v.fleetCode}` : null, v.vehicleTypeName].filter(Boolean).join(" · ");
}

export interface RoadmapRunnerProps {
  context: PredictiveAppContext;
  draft: PredictiveDraft;
  scope: string;
  loaders: RunnerLoaders;
  onCancel: () => void;
  onFinished: (exit: RunnerExit) => void;
}

export function RoadmapRunner({ context, draft, scope, loaders, onCancel, onFinished }: RoadmapRunnerProps) {
  const { toast } = useToast();
  const [roadmap, setRoadmap] = React.useState<{ key: string; data?: PredictiveAppRoadmap; error?: string } | null>(null);
  const [reload, setReload] = React.useState(0);
  const key = `${draft.vehicle.id}#${reload}`;
  const [phase, setPhase] = React.useState<Phase>("km");
  const [items, setItems] = React.useState<Record<string, ItemDraft>>(draft.items);
  const [kmInformed, setKmInformed] = React.useState(draft.kmInformed ?? "");
  const [kmJustification, setKmJustification] = React.useState(draft.kmJustification ?? "");
  const [generalObservation, setGeneralObservation] = React.useState(draft.generalObservation ?? "");
  const [highlight, setHighlight] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [sending, startSending] = React.useTransition();
  const [result, setResult] = React.useState<PredictiveAppSubmitResult | null>(null);

  React.useEffect(() => {
    let active = true;
    loaders.loadRoadmap(draft.vehicle.id).then(
      (r) => {
        if (!active) return;
        setRoadmap(r.ok && r.data ? { key, data: r.data } : { key, error: r.error ?? "Não foi possível carregar o roteiro técnico." });
      },
      (e: unknown) => {
        if (active) setRoadmap({ key, error: e instanceof Error ? e.message : "Não foi possível carregar o roteiro técnico." });
      },
    );
    return () => {
      active = false;
    };
  }, [loaders, draft.vehicle.id, key]);

  // O rascunho acompanha cada alteração até o protocolo chegar.
  React.useEffect(() => {
    if (phase === "done") return;
    saveDraft(scope, { ...draft, items, kmInformed, kmJustification, generalObservation });
  }, [scope, draft, items, kmInformed, kmJustification, generalObservation, phase]);

  const data = roadmap?.key === key ? roadmap.data : undefined;
  const loading = roadmap?.key !== key;
  const rules = context.rules;

  const updateItem = React.useCallback((cycleId: string, patch: Partial<ItemDraft>) => {
    setItems((current) => ({ ...current, [cycleId]: { ...(current[cycleId] ?? emptyItem()), ...patch } }));
  }, []);

  const groups = React.useMemo(() => {
    const out: { clusterId: string; cluster: string; items: PredictiveAppRoadmapItem[] }[] = [];
    for (const item of data?.items ?? []) {
      const last = out.find((g) => g.clusterId === item.clusterId);
      if (last) last.items.push(item);
      else out.push({ clusterId: item.clusterId, cluster: item.clusterName, items: [item] });
    }
    return out;
  }, [data]);

  const kmInformedNum = kmInformed.trim() === "" ? null : Number(kmInformed);
  const kmInvalid = kmInformed.trim() !== "" && (!/^\d+$/.test(kmInformed.trim()) || kmInformedNum! > 9_999_999);
  const official = data?.km.official ?? null;
  const divergent = data ? kmDivergent(kmInformedNum, official, data.km.tolerance) : false;
  const kmRequired = Boolean(data) && official == null && kmInformedNum == null;
  const justificationMissing = divergent && kmJustification.trim().length < rules.justificationMinLength;
  const kmIssues: string[] = [];
  if (kmInvalid) kmIssues.push("Informe o KM do hodômetro só com dígitos.");
  if (kmRequired) kmIssues.push("Sem KM oficial para hoje: informe o KM do hodômetro.");
  if (justificationMissing) kmIssues.push(`O KM informado diverge do oficial em mais de ${formatKm(data?.km.tolerance ?? 0)}: justifique.`);

  const stats = React.useMemo(() => {
    const all = data?.items ?? [];
    let answered = 0;
    let nc = 0;
    let monitor = 0;
    const pending: { item: PredictiveAppRoadmapItem; issues: string[] }[] = [];
    for (const item of all) {
      const d = items[item.cycleId] ?? emptyItem();
      if (d.result) answered += 1;
      if (d.result === "non_conforming") nc += 1;
      if (d.result === "monitor") monitor += 1;
      const issues = itemIssues(item, d, rules.notesMinLength);
      if (issues.length) pending.push({ item, issues });
    }
    return { answered, nc, monitor, pending, total: all.length };
  }, [data, items, rules.notesMinLength]);

  const scrollToItem = (cycleId: string) => {
    document.querySelector(`[data-testid="predictive-app-item-${cycleId}"]`)?.scrollIntoView({ block: "center", behavior: "smooth" });
  };

  const goItems = () => {
    setHighlight(true);
    if (kmIssues.length) return;
    setHighlight(false);
    setPhase("items");
    window.scrollTo({ top: 0 });
  };

  const goReview = () => {
    setHighlight(true);
    if (stats.answered === 0) {
      setError("Registre o resultado de pelo menos um item do roteiro.");
      return;
    }
    if (stats.pending.length > 0) {
      setError(null);
      scrollToItem(stats.pending[0].item.cycleId);
      return;
    }
    setHighlight(false);
    setError(null);
    setPhase("review");
    window.scrollTo({ top: 0 });
  };

  const send = () => {
    setError(null);
    if (!data || stats.pending.length > 0 || stats.answered === 0 || kmIssues.length) {
      setHighlight(true);
      setPhase(kmIssues.length ? "km" : "items");
      return;
    }
    const payloadItems: PredictiveAppSubmitItem[] = data.items
      .filter((item) => items[item.cycleId]?.result)
      .map((item) => {
        const d = items[item.cycleId];
        const steps = activeSteps(item);
        return {
          cycleId: item.cycleId,
          result: d.result!,
          notes: d.notes.trim() || null,
          checklist: d.result === "not_performed" ? [] : steps.filter((s) => (d.answers[s.key] ?? "").trim()).map((s) => ({ key: s.key, answer: d.answers[s.key].trim() })),
          monitorKm: d.result === "monitor" && d.monitorKm.trim() ? Number(d.monitorKm) : null,
          monitorDays: d.result === "monitor" && d.monitorDays.trim() ? Number(d.monitorDays) : null,
          openMaintenance: d.result === "non_conforming" ? d.openMaintenance : undefined,
        };
      });
    startSending(async () => {
      const response = await loaders.submit({
        clientSubmissionId: draft.clientSubmissionId,
        vehicleId: draft.vehicle.id,
        verifiedOn: data.today,
        kmInformed: kmInformedNum,
        kmJustification: kmJustification.trim() || null,
        generalObservation: generalObservation.trim() || null,
        items: payloadItems,
      });
      if (!response.ok || !response.data) {
        setError(response.error ?? "Não foi possível enviar a verificação.");
        return;
      }
      // Só agora o rascunho pode sair: o servidor confirmou com protocolo.
      clearDraft(scope);
      setResult(response.data);
      setPhase("done");
      window.scrollTo({ top: 0 });
      toast({
        title: response.data.duplicate ? "Esta verificação já havia sido recebida." : `Verificação enviada — protocolo ${response.data.protocol}.`,
        variant: "success",
      });
    });
  };

  const plate = draft.vehicle.licensePlate ?? draft.vehicle.fleetCode ?? "frota";

  // ------------------------------------------------------------------ done
  if (phase === "done" && result) {
    return (
      <div className="flex flex-col gap-4" data-testid="predictive-app-done">
        <div className="flex flex-col items-center gap-3 rounded-lg border border-success-border bg-success-soft px-4 py-6 text-center shadow-card sm:p-6">
          <span className="flex size-16 items-center justify-center rounded-full bg-success text-success-fg">
            <CheckCircle2 className="size-9" aria-hidden />
          </span>
          <div className="flex flex-col gap-1">
            <h2 className="text-h3 font-semibold text-fg">{result.duplicate ? "Verificação já recebida" : "Verificação enviada"}</h2>
            <p className="text-caption uppercase tracking-wide text-fg-muted">Protocolo</p>
            <p className="font-mono text-h2 font-semibold tracking-wide text-fg" data-testid="predictive-app-protocol">
              {result.protocol}
            </p>
            <p className="text-caption text-fg-muted">
              {plate} · {formatStamp(result.submittedAt)}
            </p>
          </div>
          <div className="grid w-full grid-cols-4 gap-2">
            <Stat label="Itens" value={result.totalItems} tone="neutral" />
            <Stat label="Conf." value={result.totalConforming} tone="success" />
            <Stat label="Monit." value={result.totalMonitoring} tone="neutral" />
            <Stat label="NC" value={result.totalNonConforming} tone={result.totalNonConforming > 0 ? "danger" : "neutral"} />
          </div>
          {result.maintenances.length > 0 ? (
            <div className="w-full rounded-md border border-border bg-surface-raised p-3 text-left" data-testid="predictive-app-maintenances">
              <p className="text-caption font-semibold uppercase tracking-wide text-fg-muted">Corretivas</p>
              <ul className="mt-1 flex flex-col gap-1 text-body-sm">
                {result.maintenances.map((m) => (
                  <li key={m.id} className="flex items-center gap-2">
                    <Wrench className="size-4 shrink-0 text-fg-muted" aria-hidden />
                    <span className="font-semibold text-fg">{m.code}</span>
                    <span className="text-fg-muted">{m.created ? "aberta agora" : "já existia — reaproveitada"}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {result.km?.divergent ? (
            <p className="text-caption text-warning-soft-fg">
              KM informado ({formatKm(result.km.informed)}) divergente do oficial ({formatKm(result.km.official)}); a justificativa ficou no envio. O KM oficial não foi alterado.
            </p>
          ) : null}
          {result.duplicate ? <p className="text-caption text-fg-secondary">Este envio já havia chegado antes; o protocolo é o mesmo e nada foi registrado em duplicidade.</p> : null}
          <p className="flex items-start gap-2 text-left text-body-sm text-fg-secondary">
            <ClipboardCheck className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
            Cada item virou uma verificação formal: conforme reinicia o ciclo, monitoramento reduz o alvo e não conforme abre a corretiva.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Button size="lg" className="h-14" leadingIcon={<Plus />} onClick={() => onFinished("new")}>
            Nova verificação
          </Button>
          <Button size="lg" variant="secondary" className="h-14" leadingIcon={<History />} onClick={() => onFinished("history")}>
            Meus envios
          </Button>
        </div>
      </div>
    );
  }

  // --------------------------------------------------------------- loading
  if (loading && !data) {
    return (
      <div className="flex flex-col gap-4" data-testid="predictive-app-roadmap-loading">
        <AppTopBar label={`Verificação · ${plate}`} onBack={onCancel} />
        <LoadingState variant="block" label="Carregando o roteiro técnico…" />
      </div>
    );
  }
  if (!data) {
    return (
      <div className="flex flex-col gap-4">
        <AppTopBar label={`Verificação · ${plate}`} onBack={onCancel} />
        <ErrorState title="Não foi possível carregar o roteiro técnico." description={roadmap?.error} onRetry={() => setReload((n) => n + 1)} />
      </div>
    );
  }

  // ------------------------------------------------------------------- km
  if (phase === "km") {
    const v = data.vehicle;
    const c = data.context;
    return (
      <div className="flex flex-col gap-4" data-testid="predictive-app-identification">
        <AppTopBar label={`Verificação · ${plate}`} onBack={onCancel} />
        <header className="flex flex-col gap-1">
          <h2 className="text-h3 font-semibold text-fg">Identificação</h2>
          <p className="text-body-sm text-fg-secondary">Confira a frota e o KM. O KM oficial vem da Gestão de KM Rodado e não é alterado pelo aplicativo.</p>
        </header>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 rounded-lg border border-border bg-surface-raised p-4 shadow-card">
          <Field label="Placa" value={v.licensePlate ?? "—"} />
          <Field label="Frota" value={v.fleetCode ?? "—"} />
          <Field label="Tipo · modelo" value={[v.vehicleTypeName, v.modelName].filter(Boolean).join(" · ") || "—"} />
          <Field label="Operação" value={[c.operationName, c.cityName && c.stateUf ? `${c.cityName}/${c.stateUf}` : c.cityName].filter(Boolean).join(" · ") || "—"} />
          <Field label="Responsável" value={context.actor.name ?? "—"} />
          <Field label="Data" value={formatDate(data.today)} />
          <Field label="Plano técnico" value={data.plan ? `${data.plan.name} · v${data.plan.version}` : "Sem plano aplicável"} />
          <Field label="Itens do roteiro" value={formatInt(data.items.length)} />
        </dl>

        {!data.eligible ? (
          <Alert variant="warning" data-testid="predictive-app-not-eligible">
            <AlertTitle>Frota não elegível</AlertTitle>
            <AlertDescription>Esta frota está fora da sua operação ou o aplicativo não está habilitado para a operação/tipo dela. O envio será recusado.</AlertDescription>
          </Alert>
        ) : null}
        {data.planAmbiguous ? (
          <Alert variant="warning">
            <AlertTitle>Mais de um plano técnico empata para esta frota</AlertTitle>
            <AlertDescription>A verificação segue pelo plano vigente, mas a ambiguidade está sinalizada na Qualidade dos dados para a gestão resolver.</AlertDescription>
          </Alert>
        ) : null}

        <section className="flex flex-col gap-3 rounded-lg border border-border bg-surface-raised p-4 shadow-card" data-testid="predictive-app-km">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-h4 font-semibold text-fg">KM</h3>
            {data.km.stale ? (
              <Badge variant="warning" appearance="soft" size="sm" icon={<Clock />}>
                KM oficial desatualizado{data.km.ageDays != null ? ` · ${formatInt(data.km.ageDays)} d` : ""}
              </Badge>
            ) : null}
          </div>
          <p className="text-body-sm text-fg-secondary">
            KM oficial: <span className="font-semibold text-fg">{data.km.official != null ? formatKm(data.km.official) : "sem leitura"}</span>
            {data.km.readingDate ? <span className="text-fg-muted"> · {formatDate(data.km.readingDate)}</span> : null}
          </p>
          <FormField
            label="KM do hodômetro agora"
            labelHint={data.km.official == null ? "Obrigatório" : "Opcional"}
            helperText={`Tolerância de ${formatKm(data.km.tolerance)} em relação ao oficial; além disso, justifique. O KM oficial não é alterado.`}
            error={highlight && (kmInvalid || kmRequired) ? kmIssues[0] : undefined}
          >
            <Input inputMode="numeric" value={kmInformed} onChange={(e) => setKmInformed(e.target.value.replace(/\D/g, ""))} trailingAddon="km" placeholder={data.km.official != null ? String(data.km.official) : "Ex.: 105200"} data-testid="predictive-app-km-input" className="h-12 text-body" />
          </FormField>
          {divergent ? (
            <FormField label="Justificativa da divergência" required error={highlight && justificationMissing ? `Mínimo de ${rules.justificationMinLength} caracteres.` : undefined}>
              <Textarea autoResize minRows={2} maxLength={500} value={kmJustification} onChange={(e) => setKmJustification(e.target.value)} placeholder="Ex.: hodômetro substituído; leitura oficial atrasada." data-testid="predictive-app-km-justification" />
            </FormField>
          ) : null}
        </section>

        <div className="grid grid-cols-2 gap-2 pb-2">
          <Button size="lg" variant="secondary" className="h-14" leadingIcon={<ArrowLeft />} onClick={onCancel}>
            Trocar frota
          </Button>
          <Button size="lg" className="h-14" trailingIcon={<ClipboardCheck />} onClick={goItems} disabled={data.items.length === 0} data-testid="predictive-app-start">
            Roteiro ({formatInt(data.items.length)})
          </Button>
        </div>
        {data.items.length === 0 ? (
          <EmptyState variant="panel" icon={<ClipboardCheck />} title="Sem roteiro técnico" description="Nenhum plano aprovado se aplica a esta frota, então não há itens a verificar. Fale com a gestão da manutenção." />
        ) : null}
      </div>
    );
  }

  // ---------------------------------------------------------------- review
  if (phase === "review") {
    const answeredItems = data.items.filter((i) => items[i.cycleId]?.result);
    return (
      <div className="flex flex-col gap-4" data-testid="predictive-app-review">
        <AppTopBar label="Revisão" answered={stats.answered} total={stats.total} onBack={() => setPhase("items")} />
        <header className="flex flex-col gap-1">
          <h2 className="text-h3 font-semibold text-fg">Revisão</h2>
          <p className="text-body-sm text-fg-secondary">Confira antes de enviar. Você ainda pode voltar e corrigir.</p>
        </header>
        {error ? (
          <Alert variant="danger">
            <AlertTitle>Não foi possível enviar</AlertTitle>
            <AlertDescription>{error} Suas respostas continuam salvas neste aparelho — tente de novo quando a conexão voltar.</AlertDescription>
          </Alert>
        ) : null}
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 rounded-lg border border-border bg-surface-raised p-4 shadow-card">
          <Field label="Placa" value={data.vehicle.licensePlate ?? "—"} />
          <Field label="Frota" value={data.vehicle.fleetCode ?? "—"} />
          <Field label="Responsável" value={context.actor.name ?? "—"} />
          <Field label="Data" value={formatDate(data.today)} />
          <Field label="KM informado" value={kmInformedNum != null ? formatKm(kmInformedNum) : "não informado (usa o oficial)"} />
          <Field label="KM oficial" value={official != null ? formatKm(official) : "sem leitura"} />
        </dl>
        <div className="grid grid-cols-3 gap-2">
          <Stat label="Verificados" value={stats.answered} tone="neutral" />
          <Stat label="Monitorar" value={stats.monitor} tone="neutral" />
          <Stat label="NC" value={stats.nc} tone={stats.nc > 0 ? "danger" : "neutral"} />
        </div>
        <div className="overflow-hidden rounded-lg border border-border bg-surface-raised shadow-card">
          <p className="border-b border-border bg-surface-secondary px-4 py-2 text-caption font-semibold uppercase tracking-wide text-fg-muted">Itens verificados</p>
          <ul className="divide-y divide-border">
            {answeredItems.map((item) => {
              const d = items[item.cycleId];
              return (
                <li key={item.cycleId} className="flex flex-col gap-1 px-4 py-2.5" data-testid={`predictive-app-review-item-${item.cycleId}`}>
                  <div className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-body-sm font-medium text-fg">{item.itemName}</span>
                    <span className="text-caption text-fg-muted">{item.clusterName}</span>
                    {d.result ? <VerificationResultBadge result={d.result} /> : null}
                  </div>
                  {d.result === "monitor" ? (
                    <p className="text-caption text-fg-secondary">
                      Monitorar por {[d.monitorKm.trim() ? `${formatInt(Number(d.monitorKm))} km` : null, d.monitorDays.trim() ? `${formatInt(Number(d.monitorDays))} dias` : null].filter(Boolean).join(" ou ")}
                    </p>
                  ) : null}
                  {d.result === "non_conforming" ? <p className="text-caption text-fg-secondary">{d.openMaintenance ? "Abre corretiva" : "Sem corretiva agora (fica aguardando)"}</p> : null}
                  {d.notes.trim() ? <p className="text-caption text-fg-secondary">{d.notes.trim()}</p> : null}
                </li>
              );
            })}
          </ul>
        </div>
        <FormField id="predictive-general-observation" label="Observação geral" labelHint="Opcional">
          <Textarea id="predictive-general-observation" autoResize minRows={2} maxLength={2000} value={generalObservation} disabled={sending} placeholder="Algo sobre a verificação como um todo." onChange={(e) => setGeneralObservation(e.target.value)} />
        </FormField>
        <Alert variant="info">
          <AlertDescription>
            Cada item vira uma verificação formal do motor preditivo. Não conforme com corretiva abre a manutenção na hora; o KM oficial da frota não é alterado.
          </AlertDescription>
        </Alert>
        <div className="grid grid-cols-2 gap-2 pb-2">
          <Button size="lg" variant="secondary" className="h-14" leadingIcon={<ArrowLeft />} onClick={() => setPhase("items")} disabled={sending}>
            Voltar
          </Button>
          <Button size="lg" className="h-14" leadingIcon={<Send />} onClick={send} loading={sending} data-testid="predictive-app-submit">
            Enviar verificação
          </Button>
        </div>
      </div>
    );
  }

  // ----------------------------------------------------------------- items
  return (
    <div className="flex flex-col gap-4" data-testid="predictive-app-items">
      <AppTopBar label={`Verificação · ${plate}`} answered={stats.answered} total={stats.total} onBack={() => setPhase("km")} />
      <header className="flex flex-col gap-1">
        <span className="text-caption text-fg-muted">{vehicleLine(draft)}</span>
        <h2 className="text-h3 font-semibold text-fg">Roteiro técnico</h2>
        <p className="text-body-sm text-fg-secondary">
          Registre o resultado dos itens verificados. Itens sem resultado não são enviados e continuam como estão no motor.
        </p>
      </header>

      {highlight && stats.pending.length > 0 ? (
        <Alert variant="danger" data-testid="predictive-app-pending">
          <AlertTitle>{stats.pending.length === 1 ? "1 item pendente" : `${formatInt(stats.pending.length)} itens pendentes`}</AlertTitle>
          <AlertDescription>
            <ul className="list-disc pl-4">
              {stats.pending.map((p) => (
                <li key={p.item.cycleId}>
                  {p.item.itemName}: {p.issues.join("; ")}
                </li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      ) : null}
      {error ? (
        <Alert variant="warning">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {groups.map((group) => (
        <section key={group.clusterId} className="flex flex-col gap-3" aria-label={`Cluster ${group.cluster}`} data-testid={`predictive-app-cluster-${group.clusterId}`}>
          <h3 className="text-caption font-semibold uppercase tracking-wide text-fg-muted">{group.cluster}</h3>
          <ol className="flex flex-col gap-3">
            {group.items.map((item) => (
              <ItemCard
                key={item.cycleId}
                item={item}
                draft={items[item.cycleId] ?? emptyItem()}
                highlight={highlight}
                disabled={sending}
                rules={rules}
                onChange={(patch) => updateItem(item.cycleId, patch)}
              />
            ))}
          </ol>
        </section>
      ))}

      <div className="sticky bottom-0 -mx-4 flex gap-2 border-t border-border bg-surface-raised/95 px-4 py-3 backdrop-blur sm:mx-0 sm:rounded-lg sm:border sm:shadow-card">
        <Button size="lg" variant="ghost" className="h-14" leadingIcon={<ArrowLeft />} onClick={() => setPhase("km")} disabled={sending}>
          KM
        </Button>
        <Button size="lg" className="h-14 flex-1" trailingIcon={<ClipboardCheck />} onClick={goReview} data-testid="predictive-app-review-button">
          Revisar ({formatInt(stats.answered)} de {formatInt(stats.total)})
        </Button>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function ItemCard({
  item, draft, highlight, disabled, rules, onChange,
}: {
  item: PredictiveAppRoadmapItem;
  draft: ItemDraft;
  highlight: boolean;
  disabled: boolean;
  rules: PredictiveAppContext["rules"];
  onChange: (patch: Partial<ItemDraft>) => void;
}) {
  const issues = highlight ? itemIssues(item, draft, rules.notesMinLength) : [];
  const steps = activeSteps(item);
  const showSteps = draft.result && draft.result !== "not_performed";
  return (
    <li
      className={cn("flex flex-col gap-3 rounded-lg border bg-surface-raised p-4 shadow-card", issues.length ? "border-danger" : "border-border")}
      data-testid={`predictive-app-item-${item.cycleId}`}
      data-result={draft.result ?? ""}
    >
      <div className="flex flex-col gap-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <h4 className="min-w-0 flex-1 text-body font-semibold text-fg">{item.itemName}</h4>
          <CriticalityBadge value={item.criticality} />
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <PredictiveStatusBadge status={item.technicalStatus} />
          {item.monitoringActive ? (
            <Badge size="sm" variant="neutral" appearance="outline" icon={<Eye />}>
              Monitorando
            </Badge>
          ) : null}
          {item.executionStatus !== "not_programmed" ? (
            <Badge size="sm" variant="neutral" appearance="outline" icon={<Wrench />}>
              {EXECUTION_LABEL[item.executionStatus]}
              {item.openMaintenanceCode ? ` · ${item.openMaintenanceCode}` : ""}
            </Badge>
          ) : null}
          {item.conformity === "non_conforming" ? (
            <Badge size="sm" variant="danger" appearance="soft" icon={<AlertTriangle />}>
              {CONFORMITY_LABEL.non_conforming}
            </Badge>
          ) : null}
        </div>
        <p className="text-caption text-fg-muted">
          {item.nextKm != null ? `Marco ${formatKm(item.nextKm)}` : "Sem marco em KM"}
          {item.kmRemaining != null ? ` (${item.kmRemaining < 0 ? `${formatInt(-item.kmRemaining)} km excedidos` : `faltam ${formatInt(item.kmRemaining)} km`})` : ""}
          {item.nextDate ? ` · até ${formatDate(item.nextDate)}` : ""}
          {` · referência: ${REFERENCE_TYPE_LABEL[item.referenceType] ?? item.referenceType}`}
          {item.lastVerificationOn ? ` · última verificação ${formatDate(item.lastVerificationOn)}` : ""}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-2" role="group" aria-label={`Resultado de ${item.itemName}`}>
        {RESULTS.map((code) => {
          const pressed = draft.result === code;
          return (
            <button
              key={code}
              type="button"
              aria-pressed={pressed}
              disabled={disabled}
              onClick={() => onChange({ result: pressed ? null : code })}
              data-testid={`predictive-app-result-${item.cycleId}-${code}`}
              className={cn(
                "flex h-12 items-center justify-center rounded-md border px-2 text-body-sm font-semibold hfm-transition hfm-focus-ring disabled:pointer-events-none disabled:opacity-55",
                pressed ? RESULT_TONE[code] : "border-border bg-surface text-fg-secondary shadow-xs hover:border-border-strong",
              )}
              title={VERIFICATION_RESULT_LABEL[code]}
            >
              {RESULT_SHORT[code]}
            </button>
          );
        })}
      </div>

      {showSteps && steps.length > 0 ? (
        <ol className="flex flex-col gap-2 border-t border-border-subtle pt-3" aria-label={`Roteiro de ${item.itemName}`}>
          {steps.map((step, index) => (
            <li key={step.key} className="flex flex-col gap-1.5">
              <p className="text-body-sm text-fg">
                <span className="mr-1 tabular-nums text-fg-muted">{index + 1}.</span>
                {step.description}
                {step.required !== false ? <span className="text-danger" aria-hidden> *</span> : <span className="ml-1 text-caption text-fg-muted">(opcional)</span>}
              </p>
              {step.approvalCriteria ? <p className="text-caption text-fg-muted">Critério: {step.approvalCriteria}</p> : null}
              <StepControl step={step} value={draft.answers[step.key] ?? ""} disabled={disabled} testId={`predictive-app-step-${item.cycleId}-${step.key}`} onChange={(v) => onChange({ answers: { ...draft.answers, [step.key]: v } })} />
            </li>
          ))}
        </ol>
      ) : null}

      {draft.result === "monitor" ? (
        <div className="grid grid-cols-2 gap-2 border-t border-border-subtle pt-3">
          <FormField label="Monitorar por (km)" helperText="Alvo reduzido">
            <Input inputMode="numeric" value={draft.monitorKm} disabled={disabled} onChange={(e) => onChange({ monitorKm: e.target.value.replace(/\D/g, "") })} trailingAddon="km" data-testid={`predictive-app-monitor-km-${item.cycleId}`} />
          </FormField>
          <FormField label="Monitorar por (dias)">
            <Input inputMode="numeric" value={draft.monitorDays} disabled={disabled} onChange={(e) => onChange({ monitorDays: e.target.value.replace(/\D/g, "") })} trailingAddon="dias" />
          </FormField>
        </div>
      ) : null}

      {draft.result === "non_conforming" ? (
        <div className="border-t border-border-subtle pt-3">
          <CheckboxField
            label="Abrir manutenção corretiva agora"
            description="Se já houver manutenção aberta para o item, ela é reaproveitada."
            checked={draft.openMaintenance}
            disabled={disabled}
            onCheckedChange={(v) => onChange({ openMaintenance: v === true })}
          />
        </div>
      ) : null}

      {draft.result ? (
        <FormField
          label={draft.result === "non_conforming" ? "Descrição da não conformidade" : draft.result === "not_performed" ? "Motivo da não realização" : "Observação"}
          labelHint={draft.result === "non_conforming" || draft.result === "not_performed" ? "Obrigatório" : "Opcional"}
          error={issues.find((i) => i.startsWith("descreva") || i.startsWith("informe o motivo")) ? `Mínimo de ${rules.notesMinLength} caracteres.` : undefined}
        >
          <Textarea autoResize minRows={2} maxLength={1000} value={draft.notes} disabled={disabled} onChange={(e) => onChange({ notes: e.target.value })} data-testid={`predictive-app-notes-${item.cycleId}`} />
        </FormField>
      ) : null}

      {draft.result ? (
        <p className="text-caption text-fg-muted">
          Desfecho esperado: {DECISION_LABEL[draft.result === "conforming" ? (item.monitoringActive ? "close_monitoring" : "restart_cycle") : draft.result === "monitor" ? (item.monitoringActive ? "continue_monitoring" : "reduce_interval") : draft.result === "non_conforming" ? "open_maintenance" : "none"]} — decidido e gravado pelo servidor.
        </p>
      ) : null}
      {issues.length ? (
        <p role="alert" className="text-helper text-danger">
          {issues.join("; ")}.
        </p>
      ) : null}
    </li>
  );
}

function StepControl({ step, value, disabled, testId, onChange }: { step: PredictiveChecklistStep; value: string; disabled: boolean; testId: string; onChange: (v: string) => void }) {
  const type = step.responseType ?? "conformity";
  if (type === "conformity" || type === "yes_no") {
    const options = type === "conformity" ? [["ok", "OK"], ["out", "Fora"], ["na", "N/A"]] : [["yes", "Sim"], ["no", "Não"]];
    return (
      <div className="grid grid-cols-3 gap-2" role="group" aria-label={step.description} data-testid={testId}>
        {options.map(([code, label]) => (
          <button
            key={code}
            type="button"
            aria-pressed={value === code}
            disabled={disabled}
            onClick={() => onChange(value === code ? "" : code)}
            className={cn(
              "flex h-11 items-center justify-center rounded-md border text-body-sm font-semibold hfm-transition hfm-focus-ring disabled:pointer-events-none disabled:opacity-55",
              value === code ? (code === "out" || code === "no" ? "border-danger bg-danger-soft text-danger-soft-fg" : "border-primary bg-primary-soft text-primary-soft-fg") : "border-border bg-surface text-fg-secondary",
            )}
          >
            {label}
          </button>
        ))}
      </div>
    );
  }
  if (type === "choice") {
    return (
      <NativeSelect aria-label={step.description} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)} data-testid={testId}>
        <option value="">Escolha…</option>
        {(step.options ?? []).map((opt) => (
          <option key={opt} value={opt}>{opt}</option>
        ))}
      </NativeSelect>
    );
  }
  return (
    <Input
      inputMode={type === "number" ? "decimal" : "text"}
      aria-label={step.description}
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      maxLength={300}
      placeholder={APP_RESPONSE_HINT[type]}
      data-testid={testId}
      className="h-11"
    />
  );
}

/* -------------------------------------------------------------------------- */

export function AppTopBar({ label, onBack, answered, total }: { label: string; onBack: () => void; answered?: number; total?: number }) {
  const pct = total ? Math.round(((answered ?? 0) / total) * 100) : null;
  return (
    <div className="sticky top-(--topbar-height) z-10 -mx-4 flex items-center gap-2 border-b border-border bg-surface-raised/95 px-3 py-2 backdrop-blur sm:mx-0 sm:rounded-lg sm:border sm:shadow-card">
      <button type="button" onClick={onBack} aria-label="Voltar" className="flex size-11 shrink-0 items-center justify-center rounded-md text-fg-secondary hfm-transition hover:bg-hover-overlay hfm-focus-ring">
        <ArrowLeft className="size-5" aria-hidden />
      </button>
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2 text-caption">
          <span className="truncate font-semibold text-fg">{label}</span>
          {pct !== null ? (
            <span className="shrink-0 tabular-nums text-fg-muted">
              {formatInt(answered ?? 0)} de {formatInt(total ?? 0)}
            </span>
          ) : null}
        </div>
        {pct !== null ? <Progress value={pct} className="mt-1" srLabel="Progresso da verificação" /> : null}
      </div>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone: "success" | "danger" | "neutral" }) {
  return (
    <div className="min-w-0 rounded-lg border border-border bg-surface-raised px-2 py-3 text-center shadow-card sm:px-3">
      <p className={cn("text-h2 font-semibold tabular-nums", tone === "success" ? "text-success" : tone === "danger" ? "text-danger" : "text-fg")}>{formatInt(value)}</p>
      <p className="text-caption font-medium text-fg-muted">{label}</p>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 flex-col">
      <dt className="text-caption text-fg-muted">{label}</dt>
      <dd className="truncate text-body-sm font-medium text-fg">{value}</dd>
    </div>
  );
}
