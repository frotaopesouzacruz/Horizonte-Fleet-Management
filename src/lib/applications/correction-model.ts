import type { Answer, ChecklistConditional, Criticality } from "./queries";
import type { ConditionalValue } from "./history-queries";

/**
 * Correção administrativa de um checklist enviado (§60, §62) — o modelo.
 *
 * Tipos, leitura das respostas das rotinas e as regras que a tela confere
 * ANTES de pedir a prévia ao servidor. Nenhuma regra aqui substitui a do
 * banco: `correct_checklist_execution` refaz cada uma e é a única que grava.
 * Este arquivo não importa nada de servidor, para servir à tela, às actions e
 * à prévia de desenvolvimento.
 *
 * Fora do escopo, de propósito: veículo, data, tipo (saída/retorno),
 * operação, BR e colaborador. São a identidade da execução e alimentam a
 * conciliação da Aderência; o banco os sela e a rotina os recusa.
 */

export type CorrectionField = "answer" | "conditional_value" | "note";

/** Uma resposta que pode ser corrigida, com o que a pergunta exige. */
export interface CorrectableAnswer {
  answerId: string;
  questionId: string;
  questionKey: string;
  text: string;
  answer: Answer;
  isConforming: boolean;
  /** A resposta conforme DA PERGUNTA (§11): SIM pode ser inconformidade. */
  conformingAnswer: Answer;
  criticality: Criticality;
  allowsNote: boolean;
  conditionalValue: ConditionalValue | null;
  note: string | null;
  conditional: ChecklistConditional | null;
}

export interface CorrectionFormCluster {
  clusterKey: string;
  name: string;
  answers: CorrectableAnswer[];
}

export interface CorrectionForm {
  executionId: string;
  clusters: CorrectionFormCluster[];
}

export interface CorrectionItemInput {
  questionId: string;
  answer: Answer;
  conditionalValue: ConditionalValue | null;
  note: string | null;
}

export interface CorrectionInput {
  executionId: string;
  reason: string;
  items: CorrectionItemInput[];
  /** Prévia exata: a mesma rotina, sem gravar. */
  dryRun: boolean;
}

export interface CorrectionSummary {
  applicable: number;
  answered: number;
  conforming: number;
  nonConforming: number;
  criticalNonConforming: number;
}

export interface CorrectionSnapshot {
  answer: Answer;
  isConforming: boolean;
  conditionalValue: ConditionalValue | null;
  note: string | null;
}

export interface CorrectionConditionalInfo {
  label: string;
  options: { value: string; label: string }[];
}

/** Antes e depois de UMA pergunta — na prévia e no histórico. */
export interface CorrectionItem {
  questionId: string;
  questionKey: string;
  clusterKey: string;
  questionText: string;
  criticality: Criticality;
  changedFields: CorrectionField[];
  before: CorrectionSnapshot;
  after: CorrectionSnapshot;
  /** Rótulo e opções do campo condicional, para mostrar "Esquerdo" e não "esquerdo". */
  conditional: CorrectionConditionalInfo | null;
}

export interface CorrectionResult {
  dryRun: boolean;
  executionId: string;
  correctionId: string | null;
  sequence: number | null;
  correctedAt: string | null;
  correctedByName: string | null;
  items: CorrectionItem[];
  summaryBefore: CorrectionSummary;
  summaryAfter: CorrectionSummary;
}

/** Uma correção registrada, como o detalhe da execução a devolve. */
export interface ExecutionCorrection {
  id: string;
  sequence: number;
  reason: string;
  correctedByName: string | null;
  correctedAt: string;
  summaryBefore: CorrectionSummary;
  summaryAfter: CorrectionSummary;
  items: CorrectionItem[];
}

export const REASON_MIN = 10;
export const REASON_MAX = 1000;
export const NOTE_MAX = 2000;

// ---------------------------------------------------------------------------
// Leitura (jsonb das rotinas → tipos da tela)
// ---------------------------------------------------------------------------

type Raw = Record<string, unknown>;
const obj = (v: unknown): Raw => (v && typeof v === "object" && !Array.isArray(v) ? (v as Raw) : {});
const arr = (v: unknown): Raw[] => (Array.isArray(v) ? (v as Raw[]) : []);
const num = (v: unknown): number => (typeof v === "number" ? v : v == null ? 0 : Number(v));
const str = (v: unknown): string => (v == null ? "" : String(v));
const strOrNull = (v: unknown): string | null => (v == null || v === "" ? null : String(v));
const asAnswer = (v: unknown): Answer => (v === "no" ? "no" : "yes");
const asCriticality = (v: unknown): Criticality => (v === "critica" ? "critica" : "media");
const FIELDS: CorrectionField[] = ["answer", "conditional_value", "note"];

export function toConditionalValue(raw: unknown): ConditionalValue | null {
  const out: ConditionalValue = {};
  for (const [key, value] of Object.entries(obj(raw))) {
    if (Array.isArray(value)) out[key] = value.map(String);
    else if (value != null && value !== "") out[key] = String(value);
  }
  return Object.keys(out).length > 0 ? out : null;
}

function toOptions(raw: unknown): { value: string; label: string }[] {
  return arr(raw).map((o) => ({ value: str(o.value), label: str(o.label) || str(o.value) }));
}

export function toConditionalDefinition(raw: unknown): ChecklistConditional | null {
  const c = obj(raw);
  if (!c.field_key) return null;
  const type = c.field_type;
  return {
    fieldKey: str(c.field_key),
    triggerAnswer: asAnswer(c.trigger_answer),
    label: str(c.label),
    fieldType: type === "single_select" || type === "multi_select" ? type : "text",
    isRequired: c.is_required !== false,
    options: toOptions(c.options),
  };
}

export function toCorrectionSummary(raw: unknown): CorrectionSummary {
  const s = obj(raw);
  return {
    applicable: num(s.applicable),
    answered: num(s.answered),
    conforming: num(s.conforming),
    nonConforming: num(s.non_conforming),
    criticalNonConforming: num(s.critical_non_conforming),
  };
}

function toSnapshot(raw: unknown): CorrectionSnapshot {
  const s = obj(raw);
  return {
    answer: asAnswer(s.answer),
    isConforming: s.is_conforming === true,
    conditionalValue: toConditionalValue(s.conditional_value),
    note: strOrNull(s.note),
  };
}

function toFields(raw: unknown): CorrectionField[] {
  return (Array.isArray(raw) ? raw : []).filter((f): f is CorrectionField => FIELDS.includes(f as CorrectionField));
}

function toConditionalInfo(raw: unknown): CorrectionConditionalInfo | null {
  const c = obj(raw);
  if (!c.label) return null;
  return { label: str(c.label), options: toOptions(c.options) };
}

/** Item da prévia/resultado da rotina (`before`/`after` aninhados). */
export function toPlanItem(raw: unknown, conditional: CorrectionConditionalInfo | null = null): CorrectionItem {
  const i = obj(raw);
  return {
    questionId: str(i.question_id),
    questionKey: str(i.question_key),
    clusterKey: str(i.cluster_key),
    questionText: str(i.question_text),
    criticality: asCriticality(i.criticality),
    changedFields: toFields(i.changed_fields),
    before: toSnapshot(i.before),
    after: toSnapshot(i.after),
    conditional,
  };
}

/** Item do histórico (`*_before`/`*_after` achatados, como a tabela guarda). */
export function toHistoryItem(raw: unknown): CorrectionItem {
  const i = obj(raw);
  return {
    questionId: str(i.question_id),
    questionKey: str(i.question_key),
    clusterKey: str(i.cluster_key),
    questionText: str(i.question_text),
    criticality: asCriticality(i.criticality),
    changedFields: toFields(i.changed_fields),
    before: {
      answer: asAnswer(i.answer_before),
      isConforming: i.is_conforming_before === true,
      conditionalValue: toConditionalValue(i.conditional_value_before),
      note: strOrNull(i.note_before),
    },
    after: {
      answer: asAnswer(i.answer_after),
      isConforming: i.is_conforming_after === true,
      conditionalValue: toConditionalValue(i.conditional_value_after),
      note: strOrNull(i.note_after),
    },
    conditional: toConditionalInfo(i.conditional),
  };
}

export function toExecutionCorrection(raw: unknown): ExecutionCorrection {
  const c = obj(raw);
  return {
    id: str(c.id),
    sequence: num(c.sequence),
    reason: str(c.reason),
    correctedByName: strOrNull(c.corrected_by_name),
    correctedAt: str(c.corrected_at),
    summaryBefore: toCorrectionSummary(c.summary_before),
    summaryAfter: toCorrectionSummary(c.summary_after),
    items: arr(c.items).map(toHistoryItem),
  };
}

export function toCorrectionForm(raw: unknown): CorrectionForm {
  const f = obj(raw);
  return {
    executionId: str(f.execution_id),
    clusters: arr(f.clusters).map((c) => ({
      clusterKey: str(c.cluster_key),
      name: str(c.name) || str(c.cluster_key),
      answers: arr(c.answers).map((a) => ({
        answerId: str(a.answer_id),
        questionId: str(a.question_id),
        questionKey: str(a.question_key),
        text: str(a.text),
        answer: asAnswer(a.answer),
        isConforming: a.is_conforming === true,
        conformingAnswer: asAnswer(a.conforming_answer),
        criticality: asCriticality(a.criticality),
        allowsNote: a.allows_note !== false,
        conditionalValue: toConditionalValue(a.conditional_value),
        note: strOrNull(a.note),
        conditional: toConditionalDefinition(a.conditional),
      })),
    })),
  };
}

/**
 * O resultado da rotina. Os itens da rotina não trazem a definição do
 * condicional; a tela a conhece pelo formulário e a devolve aqui.
 */
export function toCorrectionResult(
  raw: unknown,
  conditionalFor: (questionId: string) => CorrectionConditionalInfo | null = () => null,
): CorrectionResult {
  const r = obj(raw);
  return {
    dryRun: r.dry_run === true,
    executionId: str(r.execution_id),
    correctionId: strOrNull(r.correction_id),
    sequence: r.sequence == null ? null : num(r.sequence),
    correctedAt: strOrNull(r.corrected_at),
    correctedByName: strOrNull(r.corrected_by_name),
    items: arr(r.items).map((i) => toPlanItem(i, conditionalFor(str(i.question_id)))),
    summaryBefore: toCorrectionSummary(r.summary_before),
    summaryAfter: toCorrectionSummary(r.summary_after),
  };
}

export interface CorrectionPayloadItem {
  [key: string]: string | null | ConditionalValue;
  question_id: string;
  answer: Answer;
  conditional_value: ConditionalValue | null;
  note: string | null;
}

/** O payload da rotina: só as chaves que ela aceita. */
export function toCorrectionPayload(input: CorrectionInput): { [key: string]: string | boolean | null | CorrectionPayloadItem[] } {
  return {
    execution_id: input.executionId,
    reason: input.reason,
    dry_run: input.dryRun,
    items: input.items.map((i) => ({
      question_id: i.questionId,
      answer: i.answer,
      conditional_value: i.conditionalValue,
      note: i.note,
    })),
  };
}

// ---------------------------------------------------------------------------
// As regras que a tela confere antes de pedir a prévia (espelho do banco)
// ---------------------------------------------------------------------------

/** O rascunho de uma pergunta marcada para correção. */
export interface CorrectionDraft {
  answer: Answer;
  conditional: ConditionalValue;
  note: string;
}

export function draftFrom(a: CorrectableAnswer): CorrectionDraft {
  return { answer: a.answer, conditional: { ...(a.conditionalValue ?? {}) }, note: a.note ?? "" };
}

function sameValue(a: ConditionalValue | null, b: ConditionalValue | null): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

/**
 * O condicional que vale DEPOIS da correção: só quando a resposta o aciona
 * (§25), só a chave do campo, texto aparado, escolhas na ordem das opções.
 */
export function effectiveConditional(a: CorrectableAnswer, d: CorrectionDraft): ConditionalValue | null {
  const c = a.conditional;
  if (!c || d.answer !== c.triggerAnswer) return null;
  const raw = d.conditional[c.fieldKey];
  if (c.fieldType === "multi_select") {
    const chosen = Array.isArray(raw) ? raw : typeof raw === "string" && raw ? [raw] : [];
    const ordered = c.options.map((o) => o.value).filter((v) => chosen.includes(v));
    // As mesmas escolhas em outra ordem não são correção: devolve o gravado.
    const original = a.conditionalValue?.[c.fieldKey];
    if (
      d.answer === a.answer && Array.isArray(original) && original.length === ordered.length &&
      ordered.every((v) => original.includes(v))
    ) {
      return a.conditionalValue;
    }
    return ordered.length > 0 ? { [c.fieldKey]: ordered } : null;
  }
  const text = typeof raw === "string" ? (c.fieldType === "text" ? raw.trim() : raw) : "";
  return text ? { [c.fieldKey]: text } : null;
}

export function effectiveNote(d: CorrectionDraft): string | null {
  const text = d.note.trim();
  return text ? text : null;
}

export interface DraftCheck {
  item: CorrectionItemInput;
  changed: CorrectionField[];
  /** Mensagem da recusa, na mesma língua da rotina; `null` quando está em ordem. */
  error: string | null;
}

export function checkDraft(a: CorrectableAnswer, d: CorrectionDraft): DraftCheck {
  const conditional = effectiveConditional(a, d);
  const note = effectiveNote(d);
  const item: CorrectionItemInput = { questionId: a.questionId, answer: d.answer, conditionalValue: conditional, note };

  const changed: CorrectionField[] = [];
  if (d.answer !== a.answer) changed.push("answer");
  if (!sameValue(conditional, a.conditionalValue)) changed.push("conditional_value");
  if ((note ?? null) !== (a.note ?? null)) changed.push("note");

  let error: string | null = null;
  const c = a.conditional;
  if (c && c.isRequired && d.answer === c.triggerAnswer && !conditional) {
    error = `Preencha "${c.label}": o campo é obrigatório quando a resposta é ${c.triggerAnswer === "yes" ? "SIM" : "NÃO"}.`;
  } else if (note && note.length > NOTE_MAX) {
    error = `A observação deve ter no máximo ${NOTE_MAX} caracteres.`;
  } else if (note && !a.allowsNote && note !== (a.note ?? null)) {
    error = "Esta pergunta não aceita observação.";
  } else if (changed.length === 0) {
    error = "Nada muda nesta pergunta: altere a resposta, o campo condicional ou a observação, ou desmarque o item.";
  }
  return { item, changed, error };
}

export function checkReason(reason: string): string | null {
  const text = reason.trim();
  if (text.length < REASON_MIN) {
    return `Informe o motivo da correção administrativa (pelo menos ${REASON_MIN} caracteres).`;
  }
  if (text.length > REASON_MAX) return `O motivo da correção deve ter no máximo ${REASON_MAX} caracteres.`;
  return null;
}

// ---------------------------------------------------------------------------
// Apresentação
// ---------------------------------------------------------------------------

export const ANSWER_TEXT: Record<Answer, string> = { yes: "SIM", no: "NÃO" };

export const FIELD_LABEL: Record<CorrectionField, string> = {
  answer: "Resposta",
  conditional_value: "Campo condicional",
  note: "Observação",
};

function humanize(value: string): string {
  const text = value.replace(/_/g, " ").trim();
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : text;
}

/** "Esquerdo", "Farol esquerdo, Milha direito", o texto livre — ou `null`. */
export function conditionalText(
  value: ConditionalValue | null,
  info: CorrectionConditionalInfo | null,
): string | null {
  if (!value) return null;
  const labelOf = (v: string) => info?.options.find((o) => o.value === v)?.label ?? humanize(v);
  const parts = Object.values(value).flatMap((v) => (Array.isArray(v) ? v.map(labelOf) : [info?.options.length ? labelOf(v) : v]));
  const text = parts.filter(Boolean).join(", ");
  return text || null;
}

export function situationText(isConforming: boolean, criticality: Criticality): string {
  if (isConforming) return "Conforme";
  return criticality === "critica" ? "Inconforme · crítica" : "Inconforme";
}
