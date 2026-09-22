"use client";

import * as React from "react";
import { ArrowLeft, ArrowRight, CheckCircle2, ClipboardCheck, Send } from "lucide-react";
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

export interface RunnerStart {
  form: ChecklistForm;
  operationId: string;
  operationName: string;
  checklistType: ChecklistType;
  operationalDate: string;
  vehicleLabel: string;
  brCode: string | null;
}

type Answers = Record<string, AnswerState>;

/** §40: o rascunho vive no aparelho enquanto o envio não confirma. */
const draftKey = (key: string) => `hfm.checklist.draft.${key}`;

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m > 0 ? `${m} min ${String(s).padStart(2, "0")} s` : `${s} s`;
}

/**
 * O executor (§28, §36-§41).
 *
 * Um cluster por vez, na ordem da versão publicada. A navegação entre clusters
 * não perde resposta, e o rascunho é gravado no próprio aparelho a cada
 * alteração — mas a tela nunca diz "enviado" por causa disso (§40): enviado é
 * o que o servidor confirmou.
 */
export function ChecklistRunner({
  start,
  idempotencyKey,
  onFinished,
  onCancel,
}: {
  start: RunnerStart;
  idempotencyKey: string;
  onFinished: () => void;
  onCancel: () => void;
}) {
  const { toast } = useToast();
  const { form } = start;
  const [answers, setAnswers] = React.useState<Answers>(() => {
    if (typeof window !== "undefined") {
      try {
        const raw = window.localStorage.getItem(draftKey(idempotencyKey));
        if (raw) return JSON.parse(raw) as Answers;
      } catch {
        // Armazenamento bloqueado ou corrompido não pode impedir o checklist.
      }
    }
    return {};
  });
  const [clusterIndex, setClusterIndex] = React.useState(0);
  const [phase, setPhase] = React.useState<"running" | "review" | "done">("running");
  const [highlight, setHighlight] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [sending, startSending] = React.useTransition();
  const [result, setResult] = React.useState<SubmitChecklistResult | null>(null);
  const startedAtRef = React.useRef(new Date().toISOString());

  const answerOf = React.useCallback(
    (id: string) => answers[id] ?? emptyAnswer(),
    [answers],
  );

  const setAnswer = (id: string, next: AnswerState) => {
    setAnswers((current) => {
      const updated = { ...current, [id]: next };
      try {
        window.localStorage.setItem(draftKey(idempotencyKey), JSON.stringify(updated));
      } catch {
        // Sem armazenamento local o checklist continua: só perde a recuperação.
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

  const clusterStats = (index: number) => {
    const questions = form.clusters[index]?.questions ?? [];
    let answered = 0, nonConforming = 0, pending = 0;
    for (const q of questions) {
      const state = answerOf(q.id);
      if (state.answer === null) {
        if (q.isRequired) pending += 1;
        continue;
      }
      answered += 1;
      if (isNonConforming(q, state)) nonConforming += 1;
      if (conditionalPending(q, state)) pending += 1;
    }
    return { answered, nonConforming, pending, total: questions.length };
  };

  const cluster = form.clusters[clusterIndex];
  const isLastCluster = clusterIndex === form.clusters.length - 1;

  const goReview = () => {
    setHighlight(true);
    const current = clusterStats(clusterIndex);
    if (current.pending > 0) return;
    setHighlight(false);
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

      const response = await submitChecklist({
        idempotencyKey,
        vehicleId: form.vehicle.id,
        operationId: start.operationId,
        checklistType: start.checklistType,
        operationalDate: start.operationalDate,
        startedAt: startedAtRef.current,
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

  if (phase === "done" && result) {
    return (
      <div className="flex flex-col gap-4">
        <div className="flex flex-col items-center gap-3 rounded-md border border-success bg-success-soft p-6 text-center">
          <CheckCircle2 className="size-10 text-success" aria-hidden />
          <div>
            <p className="text-h3 font-semibold text-fg">Checklist enviado</p>
            <p className="text-body-sm text-fg-secondary">
              {start.vehicleLabel} · {start.checklistType === "saida" ? "Saída para rota" : "Retorno de rota"}
            </p>
          </div>
          <div className="flex flex-wrap justify-center gap-2">
            <Badge variant="success">{number.format(result.conforming)} conformes</Badge>
            {result.nonConforming > 0 ? (
              <Badge variant="warning">{number.format(result.nonConforming)} inconformes</Badge>
            ) : null}
            {result.criticalNonConforming > 0 ? (
              <Badge variant="danger">{number.format(result.criticalNonConforming)} críticas</Badge>
            ) : null}
          </div>
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
        </div>
        <Button size="lg" onClick={onFinished}>
          Concluir
        </Button>
      </div>
    );
  }

  if (phase === "review") {
    return (
      <div className="flex flex-col gap-4">
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
          <Field label="Tipo" value={start.checklistType === "saida" ? "Saída para rota" : "Retorno de rota"} />
          <Field label="Veículo" value={start.vehicleLabel} />
          <Field label="Operação" value={start.operationName} />
          <Field label="BR" value={start.brCode ?? "sem BR planejado"} />
          <Field label="Perguntas aplicáveis" value={number.format(stats.total)} />
          <Field label="Versão" value={form.versionLabel} />
        </dl>

        <ul className="flex flex-col gap-2">
          {form.clusters.map((c, index) => {
            const s = clusterStats(index);
            return (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => {
                    setClusterIndex(index);
                    setPhase("running");
                    window.scrollTo({ top: 0 });
                  }}
                  className="flex w-full items-center gap-3 rounded-md border border-border bg-surface p-3 text-left hfm-transition hover:border-border-strong hfm-focus-ring"
                >
                  <span className="flex-1 text-body-sm font-medium text-fg">{c.name}</span>
                  {s.pending > 0 ? (
                    <Badge variant="danger">{s.pending} pendente{s.pending > 1 ? "s" : ""}</Badge>
                  ) : s.nonConforming > 0 ? (
                    <Badge variant="warning">{s.nonConforming} inconforme{s.nonConforming > 1 ? "s" : ""}</Badge>
                  ) : (
                    <Badge variant="success">Concluído</Badge>
                  )}
                </button>
              </li>
            );
          })}
        </ul>

        <div className="flex flex-col gap-2 pb-2">
          <Button size="lg" onClick={send} loading={sending} leadingIcon={<Send />}>
            Enviar checklist
          </Button>
          <Button
            size="lg"
            variant="ghost"
            onClick={() => setPhase("running")}
            disabled={sending}
          >
            Voltar às perguntas
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <span className="text-caption text-fg-muted">
            {start.vehicleLabel} · {start.checklistType === "saida" ? "Saída" : "Retorno"}
          </span>
          <span className="text-caption tabular-nums text-fg-muted">
            {clusterIndex + 1} de {form.clusters.length}
          </span>
        </div>
        <h2 className="text-h3 font-semibold text-fg">{cluster?.name}</h2>
        <Progress
          value={stats.total === 0 ? 0 : Math.round((stats.answered / stats.total) * 100)}
          tone={stats.critical > 0 ? "danger" : stats.nonConforming > 0 ? "warning" : "primary"}
          valueLabel={`${number.format(stats.answered)} de ${number.format(stats.total)}`}
          showValue
          srLabel="Progresso do checklist"
        />
      </header>

      {highlight && clusterStats(clusterIndex).pending > 0 ? (
        <Alert variant="danger">
          <AlertDescription>
            Responda as perguntas destacadas para avançar.
          </AlertDescription>
        </Alert>
      ) : null}

      <ul className="flex flex-col gap-3">
        {cluster?.questions.map((question, index) => (
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
          leadingIcon={<ArrowLeft />}
          onClick={() => {
            if (clusterIndex === 0) return onCancel();
            setHighlight(false);
            setClusterIndex((i) => i - 1);
            window.scrollTo({ top: 0 });
          }}
        >
          {clusterIndex === 0 ? "Sair" : "Anterior"}
        </Button>
        <Button
          size="lg"
          className="flex-1"
          trailingIcon={isLastCluster ? <ClipboardCheck /> : <ArrowRight />}
          onClick={() => {
            if (isLastCluster) return goReview();
            setHighlight(true);
            if (clusterStats(clusterIndex).pending > 0) return;
            setHighlight(false);
            setClusterIndex((i) => i + 1);
            window.scrollTo({ top: 0 });
          }}
        >
          {isLastCluster ? "Revisar" : "Avançar"}
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

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col">
      <dt className="text-caption text-fg-muted">{label}</dt>
      <dd className="text-body-sm font-medium text-fg">{value}</dd>
    </div>
  );
}

export { formatDuration };
