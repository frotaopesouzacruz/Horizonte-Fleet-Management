"use client";

import * as React from "react";
import {
  AlertTriangle, ArrowLeft, ArrowRight, CheckCircle2, ClipboardCheck, Home, LayoutList, RotateCcw, Send,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/feedback/progress";
import { Alert, AlertDescription } from "@/components/feedback/alert";
import { Spinner } from "@/components/feedback/spinner";
import { useToast } from "@/components/feedback/toast";
import type { ChecklistForm, ChecklistType } from "@/lib/applications/queries";
import { submitChecklist, type SubmitChecklistResult } from "@/lib/applications/actions";
import {
  QuestionCard, conditionalPending, emptyAnswer, isNonConforming, type AnswerState,
} from "./question-card";

const number = new Intl.NumberFormat("pt-BR");
const dateTime = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" });

export interface RunnerStart {
  form: ChecklistForm;
  operationId: string;
  operationName: string;
  checklistType: ChecklistType;
  operationalDate: string;
  vehicleLabel: string;
  brCode: string | null;
  /** Nome do tipo de equipamento escolhido (§40: aparece no resumo). */
  equipmentName?: string | null;
  /** Quem responde, para o resumo e a confirmação. */
  actorName?: string | null;
  actorCode?: string | null;
  /** ISO. Quando o motorista tocou em "Iniciar" — o cronômetro corre desde aí (§39). */
  startedAt?: string | null;
}

type Answers = Record<string, AnswerState>;
type Phase = "clusters" | "questions" | "review" | "done";

/** §40: o rascunho vive no aparelho enquanto o envio não confirma. */
const draftKey = (key: string) => `hfm.checklist.draft.${key}`;

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m > 0 ? `${m} min ${String(s).padStart(2, "0")} s` : `${s} s`;
}

function formatClock(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function greeting(): string {
  const h = new Date().getHours();
  if (h >= 5 && h < 12) return "Bom dia";
  if (h >= 12 && h < 18) return "Boa tarde";
  return "Boa noite";
}

export type SubmitFn = (input: Parameters<typeof submitChecklist>[0]) => ReturnType<typeof submitChecklist>;

/**
 * O executor (§28, §36–§41), na sequência do aplicativo de referência:
 *
 *   clusters → perguntas de um cluster → (próximo cluster …) → revisão → envio.
 *
 * A tela de clusters mostra o andamento de cada um (respondidas, conformes,
 * inconformes) e só libera "Finalizar e revisar" quando não há pendência. As
 * perguntas de um cluster ficam numa tela própria, com SIM/NÃO grandes, e a
 * navegação entre clusters não perde resposta: o rascunho é gravado no próprio
 * aparelho a cada alteração — mas a tela nunca diz "enviado" por causa disso
 * (§40): enviado é o que o servidor confirmou.
 *
 * `preview` (editor administrativo, §45): nada é gravado no aparelho nem
 * enviado ao servidor; "Enviar" apenas encerra a simulação.
 */
export function ChecklistRunner({
  start,
  idempotencyKey,
  onFinished,
  onCancel,
  preview = false,
  submit = submitChecklist,
}: {
  start: RunnerStart;
  idempotencyKey: string;
  onFinished: () => void;
  onCancel: () => void;
  preview?: boolean;
  /** Injeção para a prévia sem sessão. */
  submit?: SubmitFn;
}) {
  const { toast } = useToast();
  const { form } = start;
  const [answers, setAnswers] = React.useState<Answers>(() => {
    if (!preview && typeof window !== "undefined") {
      try {
        const raw = window.localStorage.getItem(draftKey(idempotencyKey));
        if (raw) return JSON.parse(raw) as Answers;
      } catch {
        // Armazenamento bloqueado ou corrompido não pode impedir o checklist.
      }
    }
    return {};
  });
  const [phase, setPhase] = React.useState<Phase>("clusters");
  const [clusterIndex, setClusterIndex] = React.useState(0);
  const [highlight, setHighlight] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [sending, startSending] = React.useTransition();
  const [result, setResult] = React.useState<SubmitChecklistResult | null>(null);
  const [finishedAt, setFinishedAt] = React.useState<Date | null>(null);
  // Fixado na montagem: o instante do "Iniciar" (ou o da abertura do formulário).
  const [startedAtIso] = React.useState(() => start.startedAt ?? new Date().toISOString());
  const [elapsed, setElapsed] = React.useState(() =>
    Math.max(0, Math.floor((Date.now() - new Date(startedAtIso).getTime()) / 1000)),
  );

  // §39/§40: o cronômetro corre desde o "Iniciar", visível no topo como no app
  // de referência. Só informa; quem valida o tempo é o servidor.
  React.useEffect(() => {
    if (phase === "done") return;
    const id = window.setInterval(() => {
      setElapsed(Math.max(0, Math.floor((Date.now() - new Date(startedAtIso).getTime()) / 1000)));
    }, 1000);
    return () => window.clearInterval(id);
  }, [phase, startedAtIso]);

  const answerOf = React.useCallback(
    (id: string) => answers[id] ?? emptyAnswer(),
    [answers],
  );

  const setAnswer = (id: string, next: AnswerState) => {
    setAnswers((current) => {
      const updated = { ...current, [id]: next };
      if (!preview) {
        try {
          window.localStorage.setItem(draftKey(idempotencyKey), JSON.stringify(updated));
        } catch {
          // Sem armazenamento local o checklist continua: só perde a recuperação.
        }
      }
      return updated;
    });
  };

  const allQuestions = React.useMemo(
    () => form.clusters.flatMap((c) => c.questions),
    [form.clusters],
  );

  const stats = React.useMemo(() => {
    let answered = 0, conforming = 0, nonConforming = 0, critical = 0, pending = 0;
    for (const q of allQuestions) {
      const state = answerOf(q.id);
      if (state.answer === null) {
        if (q.isRequired) pending += 1;
        continue;
      }
      answered += 1;
      if (isNonConforming(q, state)) {
        nonConforming += 1;
        if (q.criticality === "critica") critical += 1;
      } else conforming += 1;
      if (conditionalPending(q, state)) pending += 1;
    }
    return { answered, conforming, nonConforming, critical, pending, total: allQuestions.length };
  }, [allQuestions, answerOf]);

  const clusterStats = React.useCallback((index: number) => {
    const questions = form.clusters[index]?.questions ?? [];
    let answered = 0, conforming = 0, nonConforming = 0, pending = 0;
    for (const q of questions) {
      const state = answerOf(q.id);
      if (state.answer === null) {
        if (q.isRequired) pending += 1;
        continue;
      }
      answered += 1;
      if (isNonConforming(q, state)) nonConforming += 1;
      else conforming += 1;
      if (conditionalPending(q, state)) pending += 1;
    }
    const status: "nao_iniciado" | "em_andamento" | "concluido" | "com_inconformidade" =
      answered === 0 ? "nao_iniciado"
        : pending > 0 || answered < questions.length ? "em_andamento"
          : nonConforming > 0 ? "com_inconformidade" : "concluido";
    return { answered, conforming, nonConforming, pending, total: questions.length, status };
  }, [form.clusters, answerOf]);

  const cluster = form.clusters[clusterIndex];
  const isLastCluster = clusterIndex === form.clusters.length - 1;
  const pct = stats.total === 0 ? 0 : Math.round((stats.answered / stats.total) * 100);

  const openCluster = (index: number) => {
    setClusterIndex(index);
    setHighlight(false);
    setPhase("questions");
    window.scrollTo({ top: 0 });
  };

  const goReview = () => {
    setHighlight(true);
    if (stats.pending > 0) {
      setError("Há perguntas obrigatórias ou campos condicionais sem resposta.");
      return;
    }
    setHighlight(false);
    setError(null);
    setPhase("review");
    window.scrollTo({ top: 0 });
  };

  const send = () => {
    setError(null);
    if (stats.pending > 0) {
      setHighlight(true);
      setError("Há perguntas obrigatórias ou campos condicionais sem resposta.");
      return;
    }

    if (preview) {
      setFinishedAt(new Date());
      setResult({
        executionId: "preview",
        duplicate: false,
        applicable: stats.total,
        conforming: stats.conforming,
        nonConforming: stats.nonConforming,
        criticalNonConforming: stats.critical,
        durationSeconds: elapsed,
        hasObligationContext: true,
      });
      setPhase("done");
      window.scrollTo({ top: 0 });
      toast({ title: "Pré-visualização: nada foi enviado.", variant: "info" });
      return;
    }

    startSending(async () => {
      const payload = allQuestions
        .filter((q) => answerOf(q.id).answer !== null)
        .map((q) => {
          const state = answerOf(q.id);
          return {
            questionId: q.id,
            answer: state.answer as "yes" | "no",
            conditionalValue:
              Object.keys(state.conditional).length > 0 ? state.conditional : null,
            note: state.note.trim() || null,
          };
        });

      const response = await submit({
        idempotencyKey,
        versionId: form.versionId,
        vehicleId: form.vehicle.id,
        operationId: start.operationId,
        checklistType: start.checklistType,
        operationalDate: start.operationalDate,
        startedAt: startedAtIso,
        answers: payload,
      });

      if (!response.ok || !response.data) {
        setError(response.error ?? "Não foi possível enviar o checklist.");
        return;
      }

      // Só agora o rascunho pode sair: o servidor confirmou o recebimento.
      try {
        window.localStorage.removeItem(draftKey(idempotencyKey));
      } catch {
        // Falhar ao limpar não invalida o envio já confirmado.
      }

      setFinishedAt(new Date());
      setResult(response.data);
      setPhase("done");
      window.scrollTo({ top: 0 });
      toast({
        title: response.data.duplicate
          ? "Este checklist já havia sido recebido."
          : "Checklist enviado.",
        variant: "success",
      });
    });
  };

  const typeLabel = start.checklistType === "saida" ? "Saída para rota" : "Retorno de rota";

  // ------------------------------------------------------------------ done
  if (phase === "done" && result) {
    const when = finishedAt ?? new Date();
    return (
      <div className="flex flex-col gap-4" data-testid="checklist-done">
        <div className="flex flex-col items-center gap-3 rounded-md border border-success bg-success-soft p-6 text-center">
          <span className="flex size-16 items-center justify-center rounded-full bg-success text-success-fg">
            <CheckCircle2 className="size-9" aria-hidden />
          </span>
          <div>
            <p className="text-h3 font-semibold text-fg">
              {greeting()}{start.actorName ? `, ${start.actorName}` : ""}!
            </p>
            <p className="text-body-sm text-fg-secondary">
              {preview ? "Pré-visualização concluída: nada foi enviado." : "Seu Check List de Frota foi registrado com sucesso."}
            </p>
            <p className="mt-1 text-body-sm text-fg-secondary">
              {start.vehicleLabel} · {typeLabel} · vistoria em{" "}
              <strong className="text-fg">{formatDuration(result.durationSeconds ?? elapsed)}</strong>
            </p>
          </div>
          <div className="grid w-full grid-cols-2 gap-2 sm:grid-cols-3">
            <KpiBox label="Conformes" value={result.conforming} tone="success" />
            <KpiBox label="Inconformes" value={result.nonConforming} tone={result.nonConforming > 0 ? "danger" : "neutral"} />
            <KpiBox label="Críticas" value={result.criticalNonConforming} tone={result.criticalNonConforming > 0 ? "danger" : "neutral"} className="col-span-2 sm:col-span-1" />
          </div>
          <p className="text-caption text-fg-muted">{dateTime.format(when)}</p>
          {result.nonConforming > 0 ? (
            <p className="text-caption text-fg-muted">
              O checklist está registrado como realizado. As inconformidades ficam
              disponíveis para tratamento.
            </p>
          ) : null}
          {!result.hasObligationContext ? (
            <p className="text-caption text-fg-muted">
              Este veículo não tinha BR planejado para hoje. A execução foi registrada e
              seguirá para conciliação.
            </p>
          ) : null}
          <p className="text-caption leading-relaxed text-fg-muted">
            Obrigado por contribuir com a segurança, a conservação e a qualidade da nossa operação.
            Em caso de dúvida, procure sua liderança ou o time de Frota.
          </p>
        </div>
        <Button size="lg" className="h-14" leadingIcon={<Home />} onClick={onFinished}>
          Voltar ao início
        </Button>
      </div>
    );
  }

  // ---------------------------------------------------------------- review
  if (phase === "review") {
    return (
      <div className="flex flex-col gap-4" data-testid="checklist-review">
        <TopBar
          label="Pré-resumo"
          answered={stats.answered}
          total={stats.total}
          elapsed={elapsed}
          onBack={() => setPhase("clusters")}
        />
        <header className="flex flex-col gap-1">
          <h2 className="text-h3 font-semibold text-fg">Revisão</h2>
          <p className="text-body-sm text-fg-secondary">
            Confira antes de enviar. Você ainda pode voltar e corrigir.
          </p>
        </header>

        {error ? (
          <Alert variant="danger">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}

        <dl className="grid grid-cols-2 gap-2 rounded-md border border-border bg-surface p-4">
          {start.actorName ? <Field label="Usuário" value={start.actorName} /> : null}
          {start.actorCode ? <Field label="Matrícula" value={start.actorCode} /> : null}
          <Field label="Tipo de Check List" value={typeLabel} />
          <Field label="Operação" value={start.operationName} />
          {start.equipmentName ? <Field label="Equipamento" value={start.equipmentName} /> : null}
          <Field label="Placa" value={start.vehicleLabel} />
          <Field label="BR" value={start.brCode ?? "sem BR planejado"} />
          <Field label="Início" value={dateTime.format(new Date(startedAtIso))} />
          <Field label="Duração" value={formatClock(elapsed)} />
          <Field label="Versão" value={form.versionLabel} />
        </dl>

        <div className="grid grid-cols-3 gap-2">
          <KpiBox label="Respondidas" value={stats.answered} tone="neutral" />
          <KpiBox label="Conformes" value={stats.conforming} tone="success" />
          <KpiBox label="Inconformes" value={stats.nonConforming} tone={stats.nonConforming > 0 ? "danger" : "neutral"} />
        </div>

        <div className="overflow-hidden rounded-md border border-border bg-surface">
          <p className="border-b border-border bg-surface-secondary px-4 py-2 text-caption font-semibold uppercase tracking-wide text-fg-muted">
            Resumo por cluster
          </p>
          <ul className="divide-y divide-border">
            {form.clusters.map((c, index) => {
              const s = clusterStats(index);
              return (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => openCluster(index)}
                    className="flex w-full items-center gap-3 px-4 py-2.5 text-left hfm-transition hover:bg-hover-overlay hfm-focus-ring"
                  >
                    <span className="flex-1 text-body-sm font-medium text-fg">{c.name}</span>
                    <span className="text-caption tabular-nums text-fg-muted">{s.total}</span>
                    <span className="text-caption tabular-nums text-success">✓ {s.conforming}</span>
                    <span className={cn("text-caption tabular-nums", s.nonConforming > 0 ? "text-danger" : "text-fg-muted")}>
                      ⚠ {s.nonConforming}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>

        <div className="grid grid-cols-2 gap-2 pb-2">
          <Button
            size="lg"
            variant="outline"
            className="h-14"
            leadingIcon={<RotateCcw />}
            onClick={() => setPhase("clusters")}
            disabled={sending}
          >
            Revisar
          </Button>
          <Button size="lg" className="h-14" onClick={send} loading={sending} leadingIcon={<Send />}>
            {preview ? "Encerrar prévia" : "Enviar checklist"}
          </Button>
        </div>
      </div>
    );
  }

  // ------------------------------------------------------------- questions
  if (phase === "questions" && cluster) {
    const current = clusterStats(clusterIndex);
    return (
      <div className="flex flex-col gap-4" data-testid="checklist-questions">
        <TopBar
          label={`Check List ${number.format(stats.answered)} de ${number.format(stats.total)} — ${pct}%`}
          answered={stats.answered}
          total={stats.total}
          elapsed={elapsed}
          onBack={() => {
            setHighlight(false);
            setPhase("clusters");
            window.scrollTo({ top: 0 });
          }}
        />
        <header className="flex flex-col gap-1">
          <span className="text-caption text-fg-muted">
            {start.vehicleLabel} · {start.checklistType === "saida" ? "Saída" : "Retorno"} · cluster {clusterIndex + 1} de {form.clusters.length}
          </span>
          <h2 className="text-h3 font-semibold text-fg">{cluster.name}</h2>
          <p className="text-caption text-fg-muted">
            {number.format(current.answered)} de {number.format(current.total)} respondidas
          </p>
        </header>

        {highlight && current.pending > 0 ? (
          <Alert variant="danger">
            <AlertDescription>
              Responda as perguntas destacadas para avançar.
            </AlertDescription>
          </Alert>
        ) : null}

        <ul className="flex flex-col gap-3">
          {cluster.questions.map((question, index) => (
            <QuestionCard
              key={question.id}
              question={question}
              index={index + 1}
              state={answerOf(question.id)}
              onChange={(next) => setAnswer(question.id, next)}
              highlightPending={highlight}
            />
          ))}
        </ul>

        <div className="sticky bottom-0 -mx-4 flex gap-2 border-t border-border bg-surface/95 px-4 py-3 backdrop-blur sm:mx-0 sm:rounded-md sm:border">
          <Button
            size="lg"
            variant="ghost"
            className="flex-1"
            leadingIcon={<LayoutList />}
            onClick={() => {
              setHighlight(false);
              setPhase("clusters");
              window.scrollTo({ top: 0 });
            }}
          >
            Clusters
          </Button>
          <Button
            size="lg"
            className="flex-1"
            trailingIcon={isLastCluster ? <ClipboardCheck /> : <ArrowRight />}
            onClick={() => {
              setHighlight(true);
              if (current.pending > 0) return;
              setHighlight(false);
              if (isLastCluster) return goReview();
              setClusterIndex((i) => i + 1);
              window.scrollTo({ top: 0 });
            }}
          >
            {isLastCluster ? "Revisar" : "Avançar"}
          </Button>
        </div>
      </div>
    );
  }

  // -------------------------------------------------------------- clusters
  return (
    <div className="flex flex-col gap-4" data-testid="checklist-clusters">
      <TopBar
        label={`Check List ${number.format(stats.answered)} de ${number.format(stats.total)} — ${pct}%`}
        answered={stats.answered}
        total={stats.total}
        elapsed={elapsed}
        onBack={onCancel}
      />
      <header className="flex flex-col gap-1">
        <span className="text-caption text-fg-muted">
          {start.vehicleLabel} · {typeLabel} · {start.operationName}
        </span>
        <h2 className="text-h3 font-semibold text-fg">Clusters do checklist</h2>
        <p className="text-body-sm text-fg-secondary">
          Abra cada cluster e responda. Você pode voltar a qualquer um antes de revisar.
        </p>
      </header>

      {error ? (
        <Alert variant="danger">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <ul className="flex flex-col gap-2">
        {form.clusters.map((c, index) => {
          const s = clusterStats(index);
          const cpct = s.total === 0 ? 0 : Math.round((s.answered / s.total) * 100);
          return (
            <li key={c.id}>
              <button
                type="button"
                onClick={() => openCluster(index)}
                className={cn(
                  "flex w-full flex-col gap-2 rounded-md border bg-surface p-4 text-left hfm-transition hover:border-border-strong hfm-focus-ring",
                  highlight && s.pending > 0 ? "border-danger" : "border-border",
                )}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-body font-semibold text-fg">{c.name}</p>
                    <p className="text-caption text-fg-muted">
                      {number.format(s.answered)} de {number.format(s.total)} perguntas — {cpct}%
                    </p>
                  </div>
                  <ClusterStatus status={s.status} />
                </div>
                <div className="flex items-center gap-3">
                  <Progress value={cpct} tone={s.nonConforming > 0 ? "warning" : "primary"} className="flex-1" srLabel={`Progresso de ${c.name}`} />
                  <span className="flex items-center gap-1 text-caption tabular-nums text-success">
                    <CheckCircle2 className="size-3.5" aria-hidden /> {s.conforming}
                  </span>
                  <span className={cn("flex items-center gap-1 text-caption tabular-nums", s.nonConforming > 0 ? "text-danger" : "text-fg-muted")}>
                    <AlertTriangle className="size-3.5" aria-hidden /> {s.nonConforming}
                  </span>
                </div>
              </button>
            </li>
          );
        })}
      </ul>

      <div className="flex flex-col gap-2 pb-2">
        <Button
          size="lg"
          className="h-14"
          trailingIcon={<ClipboardCheck />}
          onClick={goReview}
          disabled={stats.total === 0}
        >
          Finalizar e revisar
        </Button>
        <Button size="lg" variant="ghost" leadingIcon={<ArrowLeft />} onClick={onCancel} disabled={sending}>
          Sair
        </Button>
      </div>

      {sending ? (
        <p className="flex items-center gap-2 text-caption text-fg-muted">
          <Spinner size="xs" /> Enviando…
        </p>
      ) : null}
    </div>
  );
}

function ClusterStatus({ status }: { status: "nao_iniciado" | "em_andamento" | "concluido" | "com_inconformidade" }) {
  if (status === "concluido") return <Badge variant="success" appearance="soft" size="sm">Concluído</Badge>;
  if (status === "com_inconformidade") return <Badge variant="danger" appearance="soft" size="sm">Inconformidade</Badge>;
  if (status === "em_andamento") return <Badge variant="warning" appearance="soft" size="sm">Em andamento</Badge>;
  return <Badge variant="neutral" appearance="soft" size="sm">Não iniciado</Badge>;
}

/** A barra fixa do app de referência: voltar, andamento e cronômetro. */
export function TopBar({
  label, answered, total, elapsed, onBack,
}: {
  label: string;
  answered: number;
  total: number;
  elapsed: number;
  onBack: () => void;
}) {
  const pct = total > 0 ? Math.round((answered / total) * 100) : 0;
  return (
    <div className="sticky top-0 z-10 -mx-4 flex items-center gap-2 border-b border-border bg-surface/95 px-3 py-2 backdrop-blur sm:mx-0 sm:rounded-md sm:border">
      <button
        type="button"
        onClick={onBack}
        aria-label="Voltar"
        className="flex size-10 shrink-0 items-center justify-center rounded-md text-fg-secondary hfm-transition hover:bg-hover-overlay hfm-focus-ring"
      >
        <ArrowLeft className="size-5" aria-hidden />
      </button>
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2 text-caption">
          <span className="truncate font-semibold text-fg">{label}</span>
          <span className="shrink-0 font-mono tabular-nums text-primary" aria-label="Tempo decorrido">
            {formatClock(elapsed)}
          </span>
        </div>
        <Progress value={pct} className="mt-1" srLabel="Progresso do checklist" />
      </div>
    </div>
  );
}

function KpiBox({
  label, value, tone, className,
}: {
  label: string;
  value: number;
  tone: "success" | "danger" | "neutral";
  className?: string;
}) {
  return (
    <div className={cn("rounded-md border border-border bg-surface p-3 text-center", className)}>
      <p className={cn(
        "text-h2 font-bold tabular-nums",
        tone === "success" ? "text-success" : tone === "danger" ? "text-danger" : "text-fg",
      )}>
        {number.format(value)}
      </p>
      <p className="text-caption uppercase tracking-wide text-fg-muted">{label}</p>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col">
      <dt className="text-caption text-fg-muted">{label}</dt>
      <dd className="text-body-sm font-medium text-fg">{value}</dd>
    </div>
  );
}

export { formatDuration, formatClock, greeting };
