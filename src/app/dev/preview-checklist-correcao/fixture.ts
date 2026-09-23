import type { ChecklistConditional, ChecklistType, Criticality, Answer } from "@/lib/applications/queries";
import type {
  ConditionalValue, ExecutionDetail, ScopeExecution, ScopeFilters,
} from "@/lib/applications/history-queries";
import {
  REASON_MAX, REASON_MIN,
  type CorrectionField, type CorrectionForm, type CorrectionInput, type CorrectionItem, type CorrectionResult,
  type CorrectionSummary, type ExecutionCorrection,
} from "@/lib/applications/correction-model";

/**
 * Prévia da correção administrativa (§60, §62) — dados fixos, em memória.
 *
 * O mesmo que a tela real recebe das rotinas, com uma diferença: aqui a
 * "rotina" é este arquivo. Ele repete, com as mesmas palavras, as recusas de
 * `correct_checklist_execution` (motivo, condicional obrigatório, item sem
 * mudança, escopo) e o mesmo cálculo — conformidade pela resposta conforme DA
 * PERGUNTA, resumo recalculado, antes/depois preservado —, para que o
 * navegador prove o fluxo sem Supabase. Quem garante a regra é o banco: a
 * suíte `supabase/tests/remote/16c_checklist_correction.sql`.
 *
 * Um motivo que contenha "fora do escopo" faz a rotina recusar como o banco
 * recusaria uma execução fora do escopo: é como o teste confere que a mensagem
 * do servidor chega intacta à tela.
 */

export const TODAY = "2026-09-23";
export const CORRECTOR = "Marina Costa";

export const OPERATIONS = [
  { id: "op1", name: "Last Mille MG" },
  { id: "op2", name: "Redespacho - Belém/Pa" },
];

interface QuestionDef {
  id: string;
  key: string;
  clusterKey: string;
  text: string;
  conformingAnswer: Answer;
  criticality: Criticality;
  allowsNote: boolean;
  conditional: ChecklistConditional | null;
}

const CLUSTERS = [
  { key: "5s", name: "5S" },
  { key: "funilaria", name: "Funilaria" },
  { key: "luzes", name: "Luzes e Sinalização" },
];

const QUESTIONS: QuestionDef[] = [
  { id: "q-limpeza", key: "5s.limpeza_externa", clusterKey: "5s", text: "A frota está limpa externamente?", conformingAnswer: "yes", criticality: "media", allowsNote: true, conditional: null },
  { id: "q-cabine", key: "5s.cabine", clusterKey: "5s", text: "A cabine está organizada, sem objetos soltos?", conformingAnswer: "yes", criticality: "media", allowsNote: true, conditional: null },
  {
    id: "q-avaria", key: "funilaria.avaria", clusterKey: "funilaria",
    text: "Possui alguma avaria? Exemplo: amassado, arranhão, quebra ou dano aparente.",
    conformingAnswer: "no", criticality: "media", allowsNote: true,
    conditional: { fieldKey: "descricao_avaria", triggerAnswer: "yes", label: "Descreva a avaria identificada.", fieldType: "text", isRequired: true, options: [] },
  },
  {
    id: "q-freio", key: "luzes.freio", clusterKey: "luzes", text: "As luzes de freio estão funcionando?",
    conformingAnswer: "yes", criticality: "critica", allowsNote: true,
    conditional: {
      fieldKey: "lado_falha", triggerAnswer: "no", label: "Qual lado apresenta falha?", fieldType: "single_select", isRequired: true,
      options: [{ value: "esquerdo", label: "Esquerdo" }, { value: "direito", label: "Direito" }],
    },
  },
  {
    id: "q-farois", key: "luzes.farois", clusterKey: "luzes", text: "Os faróis estão funcionando?",
    conformingAnswer: "yes", criticality: "media", allowsNote: true,
    conditional: {
      fieldKey: "itens_falha", triggerAnswer: "no", label: "Qual item apresenta falha?", fieldType: "multi_select", isRequired: true,
      options: [
        { value: "farol_esquerdo", label: "Farol esquerdo" }, { value: "farol_direito", label: "Farol direito" },
        { value: "milha_esquerdo", label: "Milha esquerdo" }, { value: "milha_direito", label: "Milha direito" },
      ],
    },
  },
];

const QUESTION = new Map(QUESTIONS.map((q) => [q.id, q]));

interface AnswerState {
  answer: Answer;
  conditionalValue: ConditionalValue | null;
  note: string | null;
}

interface ExecutionState {
  meta: Omit<ExecutionDetail, "clusters" | "corrections" | "applicable" | "conforming" | "nonConforming" | "criticalNonConforming">;
  answers: Record<string, AnswerState>;
  corrections: ExecutionCorrection[];
}

const conformity = (q: QuestionDef, a: AnswerState) => a.answer === q.conformingAnswer;

function summaryOf(answers: Record<string, AnswerState>): CorrectionSummary {
  let conforming = 0;
  let nonConforming = 0;
  let critical = 0;
  for (const q of QUESTIONS) {
    const a = answers[q.id];
    if (!a) continue;
    if (conformity(q, a)) conforming += 1;
    else {
      nonConforming += 1;
      if (q.criticality === "critica") critical += 1;
    }
  }
  return {
    applicable: QUESTIONS.length, answered: Object.keys(answers).length,
    conforming, nonConforming, criticalNonConforming: critical,
  };
}

function conditionalInfo(q: QuestionDef) {
  return q.conditional ? { label: q.conditional.label, options: q.conditional.options } : null;
}

function initialState(): Record<string, ExecutionState> {
  const base = {
    operationalDate: TODAY, versionLabel: "1.0", startedAt: "2026-09-23T10:02:10.000Z",
    submittedAt: "2026-09-23T10:06:42.000Z", durationSeconds: 272,
  };
  const pendente: ExecutionState = {
    meta: {
      ...base, id: "ex-corrigir", checklistType: "saida", licensePlate: "SNT8E16", fleetCode: "VA116",
      operationName: "Last Mille MG", brCode: "BR0024107", cityName: "Divinópolis", stateUf: "MG",
      employeeName: "Walace Rocha De Souza", employeeCode: "10234", leaderName: "Flaviano Lucio Dos Santos",
    },
    answers: {
      "q-limpeza": { answer: "yes", conditionalValue: null, note: null },
      "q-cabine": { answer: "yes", conditionalValue: null, note: null },
      "q-avaria": { answer: "no", conditionalValue: null, note: null },
      "q-freio": { answer: "yes", conditionalValue: null, note: null },
      "q-farois": { answer: "no", conditionalValue: { itens_falha: ["farol_esquerdo"] }, note: "Lâmpada queimada." },
    },
    corrections: [],
  };
  const corrigida: ExecutionState = {
    meta: {
      ...base, id: "ex-corrigida", checklistType: "retorno", operationalDate: "2026-09-22",
      licensePlate: "SNT1A73", fleetCode: "VA163", operationName: "Redespacho - Belém/Pa",
      brCode: "Redespacho Belem/Pa_1", cityName: "Belém", stateUf: "PA",
      employeeName: "Flaviano Lucio Dos Santos", employeeCode: "09915", leaderName: "Leandro Carvalho Silva",
      startedAt: "2026-09-22T21:31:07.000Z", submittedAt: "2026-09-22T21:32:55.000Z", durationSeconds: 108,
    },
    answers: {
      "q-limpeza": { answer: "yes", conditionalValue: null, note: null },
      "q-cabine": { answer: "yes", conditionalValue: null, note: null },
      "q-avaria": { answer: "no", conditionalValue: null, note: null },
      "q-freio": { answer: "yes", conditionalValue: null, note: null },
      "q-farois": { answer: "yes", conditionalValue: null, note: null },
    },
    corrections: [],
  };
  const freio = QUESTION.get("q-freio")!;
  corrigida.corrections.push({
    id: "corr-historica",
    sequence: 1,
    reason: "Lâmpada de freio trocada no pátio antes da saída; o motorista marcou a falha por engano.",
    correctedByName: "Leandro Carvalho Silva",
    correctedAt: "2026-09-23T12:15:00.000Z",
    summaryBefore: { applicable: 5, answered: 5, conforming: 4, nonConforming: 1, criticalNonConforming: 1 },
    summaryAfter: { applicable: 5, answered: 5, conforming: 5, nonConforming: 0, criticalNonConforming: 0 },
    items: [{
      questionId: freio.id, questionKey: freio.key, clusterKey: freio.clusterKey, questionText: freio.text,
      criticality: freio.criticality, changedFields: ["answer", "conditional_value"],
      before: { answer: "no", isConforming: false, conditionalValue: { lado_falha: "esquerdo" }, note: null },
      after: { answer: "yes", isConforming: true, conditionalValue: null, note: null },
      conditional: conditionalInfo(freio),
    }],
  });
  return { [pendente.meta.id]: pendente, [corrigida.meta.id]: corrigida };
}

type Result<T> = { ok: boolean; error?: string; data?: T };

function same(a: unknown, b: unknown) {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

/** A "rotina" em memória, com o mesmo contrato das actions. */
export function createCorrectionStore() {
  const state = initialState();
  const correctedIds = (e: ExecutionState) => new Set(e.corrections.flatMap((c) => c.items.map((i) => i.questionId)));

  function detailOf(e: ExecutionState): ExecutionDetail {
    const s = summaryOf(e.answers);
    const corrected = correctedIds(e);
    return {
      ...e.meta,
      applicable: s.applicable,
      conforming: s.conforming,
      nonConforming: s.nonConforming,
      criticalNonConforming: s.criticalNonConforming,
      clusters: CLUSTERS.map((c) => {
        const qs = QUESTIONS.filter((q) => q.clusterKey === c.key);
        return {
          clusterKey: c.key,
          name: c.name,
          applicable: qs.length,
          nonConforming: qs.filter((q) => !conformity(q, e.answers[q.id])).length,
          answers: qs.map((q) => ({
            questionKey: q.key, text: q.text, answer: e.answers[q.id].answer,
            isConforming: conformity(q, e.answers[q.id]), criticality: q.criticality,
            conditionalValue: e.answers[q.id].conditionalValue, note: e.answers[q.id].note,
            questionId: q.id, corrected: corrected.has(q.id),
          })),
        };
      }),
      corrections: [...e.corrections].sort((a, b) => b.sequence - a.sequence),
    };
  }

  async function loadRows(filters: ScopeFilters): Promise<Result<ScopeExecution[]>> {
    const rows = Object.values(state).map((e) => {
      const s = summaryOf(e.answers);
      return {
        id: e.meta.id, operationalDate: e.meta.operationalDate, checklistType: e.meta.checklistType as ChecklistType,
        licensePlate: e.meta.licensePlate, fleetCode: e.meta.fleetCode, operationName: e.meta.operationName,
        brCode: e.meta.brCode, employeeName: e.meta.employeeName, employeeCode: e.meta.employeeCode,
        submittedAt: e.meta.submittedAt, durationSeconds: e.meta.durationSeconds,
        applicable: s.applicable, conforming: s.conforming, nonConforming: s.nonConforming,
        criticalNonConforming: s.criticalNonConforming, status: "submitted",
      } satisfies ScopeExecution;
    });
    const term = filters.search?.trim().toLowerCase();
    return {
      ok: true,
      data: rows.filter((r) => !term || [r.licensePlate, r.fleetCode].join(" ").toLowerCase().includes(term)),
    };
  }

  async function loadDetail(id: string): Promise<Result<ExecutionDetail | null>> {
    const e = state[id];
    return e ? { ok: true, data: detailOf(e) } : { ok: false, error: "Checklist não encontrado no seu escopo." };
  }

  async function loadForm(id: string): Promise<Result<CorrectionForm>> {
    const e = state[id];
    if (!e) return { ok: false, error: "Execução não encontrada nesta organização." };
    return {
      ok: true,
      data: {
        executionId: id,
        clusters: CLUSTERS.map((c) => ({
          clusterKey: c.key,
          name: c.name,
          answers: QUESTIONS.filter((q) => q.clusterKey === c.key).map((q) => ({
            answerId: `${id}-${q.id}`, questionId: q.id, questionKey: q.key, text: q.text,
            answer: e.answers[q.id].answer, isConforming: conformity(q, e.answers[q.id]),
            conformingAnswer: q.conformingAnswer, criticality: q.criticality, allowsNote: q.allowsNote,
            conditionalValue: e.answers[q.id].conditionalValue, note: e.answers[q.id].note,
            conditional: q.conditional,
          })),
        })),
      },
    };
  }

  async function run(input: CorrectionInput): Promise<Result<CorrectionResult>> {
    const e = state[input.executionId];
    if (!e) return { ok: false, error: "Execução não encontrada nesta organização." };
    const reason = input.reason.trim();
    if (reason.length < REASON_MIN) {
      return { ok: false, error: "Informe o motivo da correção administrativa (pelo menos 10 caracteres)." };
    }
    if (reason.length > REASON_MAX) return { ok: false, error: "O motivo da correção deve ter no máximo 1000 caracteres." };
    if (/fora do escopo/i.test(reason)) return { ok: false, error: "Esta execução não faz parte do seu escopo de acesso." };
    if (input.items.length === 0) return { ok: false, error: "Escolha ao menos um item para corrigir." };

    const plan: CorrectionItem[] = [];
    const next: Record<string, AnswerState> = { ...e.answers };
    for (const item of input.items) {
      const q = QUESTION.get(item.questionId);
      const before = e.answers[item.questionId];
      if (!q || !before) {
        return { ok: false, error: "Esta pergunta não foi respondida nesta execução; a correção altera respostas existentes." };
      }
      const c = q.conditional;
      const conditionalValue = c && item.answer === c.triggerAnswer ? item.conditionalValue : null;
      if (c && c.isRequired && item.answer === c.triggerAnswer && !conditionalValue) {
        return {
          ok: false,
          error: `Preencha "${c.label}": o campo é obrigatório quando a resposta de "${q.text}" é ${c.triggerAnswer === "yes" ? "SIM" : "NÃO"}.`,
        };
      }
      const note = item.note?.trim() ? item.note.trim() : null;
      const after: AnswerState = { answer: item.answer, conditionalValue, note };
      const changed: CorrectionField[] = [];
      if (after.answer !== before.answer) changed.push("answer");
      if (!same(after.conditionalValue, before.conditionalValue)) changed.push("conditional_value");
      if (after.note !== before.note) changed.push("note");
      if (changed.length === 0) {
        return {
          ok: false,
          error: `Nada muda em "${q.text}": altere a resposta, o campo condicional ou a observação, ou retire o item da correção.`,
        };
      }
      next[q.id] = after;
      plan.push({
        questionId: q.id, questionKey: q.key, clusterKey: q.clusterKey, questionText: q.text,
        criticality: q.criticality, changedFields: changed,
        before: { ...before, isConforming: conformity(q, before) },
        after: { ...after, isConforming: conformity(q, after) },
        conditional: conditionalInfo(q),
      });
    }

    const summaryBefore = summaryOf(e.answers);
    const summaryAfter = summaryOf(next);
    if (input.dryRun) {
      return {
        ok: true,
        data: {
          dryRun: true, executionId: e.meta.id, correctionId: null, sequence: null, correctedAt: null,
          correctedByName: null, items: plan, summaryBefore, summaryAfter,
        },
      };
    }

    const sequence = e.corrections.length + 1;
    const correctedAt = new Date().toISOString();
    const correction: ExecutionCorrection = {
      id: `corr-${e.meta.id}-${sequence}`, sequence, reason, correctedByName: CORRECTOR, correctedAt,
      summaryBefore, summaryAfter, items: plan,
    };
    e.answers = next;
    e.corrections.push(correction);
    return {
      ok: true,
      data: {
        dryRun: false, executionId: e.meta.id, correctionId: correction.id, sequence, correctedAt,
        correctedByName: CORRECTOR, items: plan, summaryBefore, summaryAfter,
      },
    };
  }

  return { loadRows, loadDetail, loadForm, run };
}
