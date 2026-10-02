import type { ChecklistHistoryLayout, HistoryQuestion } from "./history-import-columns";

/**
 * Leitura do JSON de `checklist_history_import_layout` — sem `server-only`,
 * porque a prévia de desenvolvimento e os testes montam o mesmo objeto.
 */
type Raw = Record<string, unknown>;
const obj = (v: unknown): Raw => (v && typeof v === "object" && !Array.isArray(v) ? (v as Raw) : {});
const arr = (v: unknown): Raw[] => (Array.isArray(v) ? (v as Raw[]) : []);
const str = (v: unknown): string => (v == null ? "" : String(v));

export function parseChecklistHistoryLayout(data: unknown): ChecklistHistoryLayout {
  const r = obj(data);
  const version = obj(r.version);
  const questions: HistoryQuestion[] = arr(r.questions).map((q) => {
    const c = q.conditional == null ? null : obj(q.conditional);
    return {
      questionKey: str(q.question_key),
      clusterKey: str(q.cluster_key),
      clusterName: str(q.cluster_name),
      text: str(q.text),
      conformingAnswer: str(q.conforming_answer),
      criticality: str(q.criticality),
      conditional: c
        ? {
            fieldKey: str(c.field_key),
            label: str(c.label),
            fieldType: str(c.field_type),
            triggerAnswer: str(c.trigger_answer),
            options: arr(c.options).map((o) => ({ label: str(o.label), value: str(o.value) })),
          }
        : null,
    };
  });
  return {
    version: { id: str(version.id), label: str(version.label) },
    canOverride: r.can_override === true,
    statuses: arr(r.statuses).map((s) => ({ code: str(s.code), label: str(s.label), description: str(s.description) })),
    questions,
  };
}
