import { cellToText, normalizeHeader, toIsoDate } from "./import-columns";

/**
 * Histórico de Check List — a planilha modelo e a leitura do arquivo.
 *
 * Sem `"use server"` de propósito: a tela monta o modelo e explica o layout
 * com estas mesmas definições, e a action usa o mesmo mapeamento para ler o
 * arquivo — uma definição, dois leitores. O catálogo de perguntas vem do
 * banco (`checklist_history_import_layout`): nenhuma pergunta é fixada aqui.
 */

export interface HistoryConditional {
  fieldKey: string;
  label: string;
  fieldType: "text" | "single_select" | "multi_select" | string;
  triggerAnswer: "yes" | "no" | string;
  options: { label: string; value: string }[];
}

export interface HistoryQuestion {
  questionKey: string;
  clusterKey: string;
  clusterName: string;
  text: string;
  conformingAnswer: "yes" | "no" | string;
  criticality: string;
  conditional: HistoryConditional | null;
}

export interface HistoryStatus {
  code: string;
  label: string;
  description: string;
}

export interface ChecklistHistoryLayout {
  version: { id: string; label: string };
  canOverride: boolean;
  statuses: HistoryStatus[];
  questions: HistoryQuestion[];
}

export type HistoryFixedField =
  | "license_plate" | "fleet_code" | "operational_date" | "context" | "status"
  | "employee_code" | "employee_name" | "justification";

export interface HistoryFixedColumn {
  field: HistoryFixedField;
  label: string;
  required: boolean;
  aliases: string[];
  hint: string;
}

export const HISTORY_FIXED_COLUMNS: HistoryFixedColumn[] = [
  { field: "license_plate", label: "Placa", required: true, hint: "placa do veículo (ou informe a frota)",
    aliases: ["placa", "plate", "license plate"] },
  { field: "fleet_code", label: "Frota", required: false, hint: "código da frota (opcional)",
    aliases: ["frota", "codigo da frota", "cod frota", "fleet", "fleet code"] },
  { field: "operational_date", label: "Data", required: true, hint: "dia operacional (dd/mm/aaaa)",
    aliases: ["data", "data operacional", "dia", "date", "operational date"] },
  { field: "context", label: "Contexto", required: false, hint: "Saída ou Retorno; vazio = Saída",
    aliases: ["contexto", "tipo de checklist", "context", "momento", "saida retorno"] },
  { field: "status", label: "Status", required: true, hint: "Fez Check List, Não Fez Check List, Sem Rota, Manutenção, Em Viagem, Frota Reserva, Frota não ativa, Outros",
    aliases: ["status", "situacao", "status do dia", "status diario", "aderencia"] },
  { field: "employee_code", label: "Matrícula", required: false, hint: "matrícula do motorista que fez o checklist",
    aliases: ["matricula", "matricula motorista", "codigo colaborador", "employee code", "re"] },
  { field: "employee_name", label: "Motorista", required: false, hint: "nome do motorista (usado se a matrícula não for encontrada)",
    aliases: ["usuario", "motorista", "nome", "colaborador", "executor", "employee", "driver"] },
  { field: "justification", label: "Justificativa", required: false, hint: "texto livre; entra na solicitação ou no expurgo",
    aliases: ["justificativa", "observacao", "observacoes", "obs", "motivo"] },
];

export type HistoryColumnTarget =
  | { kind: "fixed"; field: HistoryFixedField }
  | { kind: "answer"; questionKey: string }
  | { kind: "conditional"; questionKey: string; fieldKey: string }
  | { kind: "note"; questionKey: string };

export interface HistoryColumnMapping {
  mapping: Record<number, HistoryColumnTarget>;
  mapped: { header: string; label: string }[];
  unmapped: string[];
  duplicated: string[];
  missing: string[];
  /** Perguntas do catálogo sem coluna no arquivo (ficam sem resposta). */
  unansweredQuestions: string[];
}

const norm = (s: string) => normalizeHeader(s);

/** Cabeçalho do campo condicional no modelo: o rótulo, e a pergunta quando o rótulo se repete. */
export function conditionalHeader(question: HistoryQuestion, layout: ChecklistHistoryLayout): string {
  const label = question.conditional?.label ?? "";
  const dup = layout.questions.filter((q) => q.conditional && norm(q.conditional.label) === norm(label)).length > 1;
  return dup ? `${label} — ${question.text}` : label;
}

export const NOTE_PREFIX = "Observação — ";

/**
 * Mapeia os cabeçalhos do arquivo para campos fixos, perguntas e condicionais.
 * Perguntas casam pelo texto; um condicional casa pelo rótulo e pertence à
 * pergunta mais próxima à esquerda que o possui (é assim que a planilha de
 * origem organiza as colunas). Cabeçalhos repetidos são apontados.
 */
export function mapHistoryColumns(headers: string[], layout: ChecklistHistoryLayout): HistoryColumnMapping {
  const mapping: Record<number, HistoryColumnTarget> = {};
  const mapped: HistoryColumnMapping["mapped"] = [];
  const unmapped: string[] = [];
  const duplicated: string[] = [];
  const takenFixed = new Set<HistoryFixedField>();
  const takenQuestion = new Set<string>();
  const takenConditional = new Set<string>();
  const byText = new Map<string, HistoryQuestion>();
  for (const q of layout.questions) byText.set(norm(q.text), q);

  // 1ª passada: fixos e perguntas
  headers.forEach((header, index) => {
    const key = norm(header ?? "");
    if (!key) return;
    const fixed = HISTORY_FIXED_COLUMNS.find((c) => c.aliases.includes(key));
    if (fixed && !takenFixed.has(fixed.field)) {
      mapping[index] = { kind: "fixed", field: fixed.field };
      takenFixed.add(fixed.field);
      mapped.push({ header, label: fixed.label });
      return;
    }
    const q = byText.get(key);
    if (q) {
      if (takenQuestion.has(q.questionKey)) { duplicated.push(header); return; }
      mapping[index] = { kind: "answer", questionKey: q.questionKey };
      takenQuestion.add(q.questionKey);
      mapped.push({ header, label: `Pergunta · ${q.text.slice(0, 48)}${q.text.length > 48 ? "…" : ""}` });
    }
  });

  // 2ª passada: condicionais (rótulo, com ou sem o sufixo da pergunta) e observações
  headers.forEach((header, index) => {
    if (mapping[index]) return;
    const key = norm(header ?? "");
    if (!key) return;
    if (key.startsWith(norm(NOTE_PREFIX))) {
      const rest = key.slice(norm(NOTE_PREFIX).length).trim();
      const q = byText.get(rest);
      if (q) { mapping[index] = { kind: "note", questionKey: q.questionKey }; mapped.push({ header, label: `Observação · ${q.text.slice(0, 40)}…` }); return; }
    }
    // rótulo com sufixo " — pergunta"
    const suffixed = layout.questions.find((q) => q.conditional && norm(conditionalHeader(q, layout)) === key);
    if (suffixed?.conditional && !takenConditional.has(suffixed.questionKey)) {
      mapping[index] = { kind: "conditional", questionKey: suffixed.questionKey, fieldKey: suffixed.conditional.fieldKey };
      takenConditional.add(suffixed.questionKey);
      mapped.push({ header, label: `Condicional · ${suffixed.conditional.label}` });
      return;
    }
    // rótulo puro: a pergunta mais próxima à esquerda que possui esse condicional
    const candidates = layout.questions.filter((q) => q.conditional && norm(q.conditional.label) === key);
    if (candidates.length) {
      let owner: HistoryQuestion | undefined;
      for (let i = index - 1; i >= 0; i--) {
        const t = mapping[i];
        if (t?.kind === "answer") {
          const q = candidates.find((c) => c.questionKey === t.questionKey);
          if (q && !takenConditional.has(q.questionKey)) { owner = q; break; }
        }
      }
      owner ??= candidates.find((c) => !takenConditional.has(c.questionKey));
      if (owner?.conditional) {
        mapping[index] = { kind: "conditional", questionKey: owner.questionKey, fieldKey: owner.conditional.fieldKey };
        takenConditional.add(owner.questionKey);
        mapped.push({ header, label: `Condicional · ${owner.conditional.label} (${owner.text.slice(0, 30)}…)` });
        return;
      }
      duplicated.push(header);
      return;
    }
    unmapped.push(header);
  });

  const missing: string[] = [];
  if (!takenFixed.has("license_plate") && !takenFixed.has("fleet_code")) missing.push("Placa (ou Frota)");
  if (!takenFixed.has("operational_date")) missing.push("Data");
  if (!takenFixed.has("status")) missing.push("Status");
  const unansweredQuestions = layout.questions.filter((q) => !takenQuestion.has(q.questionKey)).map((q) => q.text);
  return { mapping, mapped, unmapped, duplicated, missing, unansweredQuestions };
}

/** Sim/Não/N/A em qualquer grafia → yes | no | na; vazio ou "0" → nulo. */
export function normalizeAnswer(value: unknown): "yes" | "no" | "na" | null {
  const text = cellToText(value);
  if (text == null) return null;
  const k = norm(text);
  if (!k || k === "0" || k === "-") return null;
  if (["sim", "s", "yes", "y", "ok", "true", "1", "conforme"].includes(k)) return "yes";
  if (["nao", "n", "no", "false", "nok", "nao conforme", "inconforme"].includes(k)) return "no";
  if (["na", "n a", "nao se aplica", "nao aplicavel", "nd", "sem informacao"].includes(k)) return "na";
  return null;
}

/** Sinônimos das opções de campo condicional vistos nos arquivos da operação. */
const OPTION_SYNONYMS: Record<string, string[]> = {
  esquerdo: ["esquerda", "lado esquerdo", "esq"],
  direito: ["direita", "lado direito", "dir"],
  farol_esquerdo: ["esquerda", "farol esquerda", "esquerdo"],
  farol_direito: ["direita", "farol direita", "direito"],
  milha_esquerdo: ["milha esquerda", "farol de milha esquerdo", "milha esq"],
  milha_direito: ["milha direita", "farol de milha direito", "milha dir"],
  dianteira_esquerda: ["dianteira esquerda", "seta dianteira esquerda"],
  dianteira_direita: ["dianteira direita", "seta dianteira direita"],
  traseira_esquerda: ["traseira esquerda", "seta traseira esquerda"],
  traseira_direita: ["traseira direita", "seta traseira direita"],
  bau_lateral: ["bau lateral", "lateral"],
  bau_traseiro: ["bau traseiro", "traseiro"],
};

export function optionValueFor(label: string, conditional: HistoryConditional): string {
  const k = norm(label);
  const direct = conditional.options.find((o) => norm(o.label) === k || norm(o.value) === k);
  if (direct) return direct.value;
  const bySyn = conditional.options.find((o) => (OPTION_SYNONYMS[o.value] ?? []).includes(k));
  if (bySyn) return bySyn.value;
  // opção não prevista no formulário atual: mantida como texto estável, sem perder o dado
  return k.replace(/\s+/g, "_");
}

/** O valor do condicional no formato que o Check List grava (`conditional_value`). */
export function normalizeConditional(value: unknown, conditional: HistoryConditional): unknown {
  const text = cellToText(value);
  if (text == null) return null;
  const k = norm(text);
  if (!k || k === "0" || k === "-") return null;
  if (conditional.fieldType === "text") return { [conditional.fieldKey]: text.trim() };
  const parts = text.split(/[;|,/]+/).map((p) => p.trim()).filter(Boolean);
  const values = Array.from(new Set(parts.map((p) => optionValueFor(p, conditional))));
  if (values.length === 0) return null;
  if (conditional.fieldType === "single_select" && values.length === 1) return { [conditional.fieldKey]: values[0] };
  return { [conditional.fieldKey]: values };
}

export interface HistoryRowPayload {
  row_number: number;
  raw: Record<string, string | number | boolean | null>;
  license_plate: string | null;
  fleet_code: string | null;
  operational_date: string | null;
  context: string | null;
  status: string | null;
  employee_code: string | null;
  employee_name: string | null;
  justification: string | null;
  answers: Record<string, "yes" | "no" | "na">;
  conditionals: Record<string, unknown>;
  notes: Record<string, string>;
}

/** Uma linha do arquivo no formato que a rotina do banco espera. */
export function buildHistoryRow(
  rowNumber: number,
  headers: string[],
  values: unknown[],
  columns: HistoryColumnMapping,
  layout: ChecklistHistoryLayout,
  raw: Record<string, string | number | boolean | null>,
): HistoryRowPayload {
  const row: HistoryRowPayload = {
    row_number: rowNumber, raw,
    license_plate: null, fleet_code: null, operational_date: null, context: null, status: null,
    employee_code: null, employee_name: null, justification: null,
    answers: {}, conditionals: {}, notes: {},
  };
  const byKey = new Map(layout.questions.map((q) => [q.questionKey, q] as const));
  headers.forEach((_, index) => {
    const target = columns.mapping[index];
    if (!target) return;
    const value = values[index];
    if (target.kind === "fixed") {
      if (target.field === "operational_date") row.operational_date = toIsoDate(value);
      else if (target.field === "employee_code") {
        const text = cellToText(value);
        row.employee_code = text == null ? null : text.replace(/\.0$/, "");
      } else row[target.field] = cellToText(value);
      return;
    }
    if (target.kind === "answer") {
      const a = normalizeAnswer(value);
      if (a) row.answers[target.questionKey] = a;
      return;
    }
    if (target.kind === "conditional") {
      const q = byKey.get(target.questionKey);
      if (!q?.conditional) return;
      const v = normalizeConditional(value, q.conditional);
      if (v != null) row.conditionals[target.questionKey] = v;
      return;
    }
    const note = cellToText(value);
    if (note && note !== "0") row.notes[target.questionKey] = note.slice(0, 2000);
  });
  return row;
}

/** Cabeçalhos do modelo, na ordem oficial: fixos, depois cada pergunta seguida do seu condicional. */
export function historyTemplateHeaders(layout: ChecklistHistoryLayout): { header: string; target: HistoryColumnTarget; width: number }[] {
  const out: { header: string; target: HistoryColumnTarget; width: number }[] = HISTORY_FIXED_COLUMNS.map((c) => ({
    header: c.label, target: { kind: "fixed", field: c.field }, width: c.field === "justification" ? 36 : c.field === "employee_name" ? 30 : 14,
  }));
  for (const q of layout.questions) {
    out.push({ header: q.text, target: { kind: "answer", questionKey: q.questionKey }, width: Math.min(60, Math.max(18, Math.ceil(q.text.length * 0.7))) });
    if (q.conditional) {
      out.push({ header: conditionalHeader(q, layout), target: { kind: "conditional", questionKey: q.questionKey, fieldKey: q.conditional.fieldKey }, width: 32 });
    }
  }
  return out;
}
