import type { Confidence, Deadline, ItemStatus, PlanStatus, Priority } from "./types";

/**
 * Rótulos e tons do Plano de Ação — um lugar só. Nenhum componente escreve o
 * nome de uma situação, prioridade ou prazo por conta própria: as chaves vêm do
 * banco e o texto vem daqui.
 */

export type Tone = "neutral" | "info" | "success" | "warning" | "danger" | "accent";

export const PLAN_STATUS_LABEL: Record<PlanStatus, string> = {
  new: "Novo",
  in_analysis: "Em análise",
  awaiting_maintenance: "Aguardando manutenção",
  maintenance_open: "Manutenção aberta",
  maintenance_scheduled: "Manutenção agendada",
  maintenance_in_progress: "Manutenção em execução",
  pending_new_action: "Pendente de nova tratativa",
  resolved_without_maintenance: "Resolvido sem manutenção",
  improper: "Improcedente",
  resolved: "Resolvido",
  cancelled: "Cancelado",
};

export const PLAN_STATUS_TONE: Record<PlanStatus, Tone> = {
  new: "info",
  in_analysis: "info",
  awaiting_maintenance: "warning",
  maintenance_open: "accent",
  maintenance_scheduled: "accent",
  maintenance_in_progress: "accent",
  pending_new_action: "danger",
  resolved_without_maintenance: "success",
  improper: "neutral",
  resolved: "success",
  cancelled: "neutral",
};

/** Ordem da máquina de estados (para filtros e legendas). */
export const PLAN_STATUS_ORDER: PlanStatus[] = [
  "new",
  "in_analysis",
  "awaiting_maintenance",
  "maintenance_open",
  "maintenance_scheduled",
  "maintenance_in_progress",
  "pending_new_action",
  "resolved",
  "resolved_without_maintenance",
  "improper",
  "cancelled",
];

export const OPEN_STATUSES: PlanStatus[] = PLAN_STATUS_ORDER.slice(0, 7);
export const isClosed = (s: PlanStatus) => !OPEN_STATUSES.includes(s);

export const ITEM_STATUS_LABEL: Record<ItemStatus, string> = {
  pending: "Pendente",
  in_maintenance: "Em manutenção",
  needs_action: "Pendente de nova tratativa",
  resolved: "Resolvido",
  resolved_without_maintenance: "Resolvido sem manutenção",
  improper: "Improcedente",
  cancelled: "Cancelado",
};

export const ITEM_STATUS_TONE: Record<ItemStatus, Tone> = {
  pending: "warning",
  in_maintenance: "accent",
  needs_action: "danger",
  resolved: "success",
  resolved_without_maintenance: "success",
  improper: "neutral",
  cancelled: "neutral",
};

export const OPEN_ITEM_STATUSES: ItemStatus[] = ["pending", "in_maintenance", "needs_action"];

export const PRIORITY_LABEL: Record<Priority, string> = {
  low: "Baixa",
  medium: "Média",
  high: "Alta",
  critical: "Crítica",
};

export const PRIORITY_TONE: Record<Priority, Tone> = {
  low: "neutral",
  medium: "info",
  high: "warning",
  critical: "danger",
};

export const PRIORITY_ORDER: Priority[] = ["critical", "high", "medium", "low"];

export const DEADLINE_LABEL: Record<Deadline, string> = {
  overdue: "Vencido",
  today: "Vence hoje",
  soon: "Vence em breve",
  upcoming: "Vence hoje ou em breve",
  on_time: "No prazo",
  no_due: "Sem prazo",
  treated_on_time: "Tratado no prazo",
  treated_late: "Tratado fora do prazo",
  cancelled: "Cancelado",
};

export const DEADLINE_TONE: Record<Deadline, Tone> = {
  overdue: "danger",
  today: "warning",
  soon: "warning",
  upcoming: "warning",
  on_time: "success",
  no_due: "neutral",
  treated_on_time: "success",
  treated_late: "danger",
  cancelled: "neutral",
};

export const CONFIDENCE_LABEL: Record<Confidence, string> = {
  high: "Alta confiança",
  medium: "Média confiança",
  manual_review: "Revisão manual",
  none: "Sem correspondência",
};

export const CONFIDENCE_TONE: Record<Confidence, Tone> = {
  high: "success",
  medium: "warning",
  manual_review: "info",
  none: "neutral",
};

export const RULE_LABEL: Record<string, string> = {
  service_mapping_specific: "Serviço mapeado, sem conflito",
  service_mapping_contested: "Serviço mapeado, disputado por outro plano do veículo",
  service_mapping_multiple_candidates: "Serviço mapeado em mais de uma manutenção",
  same_cluster: "Mesmo cluster técnico dos serviços mapeados",
  unmapped_action_key: "Item ainda sem serviço mapeado",
  same_vehicle_period: "Mesmo veículo e período, sem correspondência técnica",
  checklist_finding: "Apontamento vinculado na manutenção",
  checklist_finding_multi_option: "Apontamento com várias opções (validar)",
  opened_from_plan: "Aberta pelo plano",
  manual: "Vínculo manual",
};

export const LINK_ORIGIN_LABEL: Record<string, string> = {
  opened_from_plan: "Aberta pelo plano",
  linked_manual: "Vínculo manual",
  maintenance_module: "Vinculada na Manutenção",
  auto_reconciliation: "Conciliação automática",
  reconciliation_manual: "Conciliação manual",
};

export const MAINTENANCE_STATUS_LABEL: Record<string, string> = {
  to_schedule: "Há agendar",
  scheduled: "Agendado",
  in_progress: "Em execução",
  completed: "Concluído",
  cancelled: "Cancelado",
  not_performed: "Não realizada",
};

export const FINDING_RESOLUTION_LABEL: Record<string, string> = {
  pending: "Pendente",
  resolved: "Resolvido",
  partially_resolved: "Parcialmente resolvido",
  not_resolved: "Não resolvido",
};

export const RESOLUTION_TYPE_LABEL: Record<string, string> = {
  resolved_by_maintenance: "Resolvido pela manutenção",
  validated_by_maintenance: "Resolução validada",
  resolved_without_maintenance: "Resolvido sem manutenção",
  improper: "Improcedente",
  cancelled: "Cancelado",
  reopened: "Reaberto",
  returned_to_pending: "Voltou a pendente",
  maintenance_status: "Situação da manutenção",
};

export const SOURCE_LABEL: Record<string, string> = {
  user: "Usuário",
  system: "Sistema",
  checklist: "Check List",
  maintenance: "Manutenção",
  maintenance_auto: "Baixa automática",
  correction: "Correção do checklist",
  import: "Importação",
};

/** Motivos padronizados — a justificativa descreve o caso. */
export const REASONS = {
  resolved_without_maintenance: [
    { code: "ajuste_operacional", label: "Ajuste operacional simples (sem intervenção técnica)" },
    { code: "reposicao_item", label: "Reposição de item/acessório pela operação" },
    { code: "limpeza_organizacao", label: "Limpeza ou organização realizada" },
    { code: "resolvido_por_terceiro", label: "Resolvido por terceiro/locadora" },
    { code: "outro", label: "Outro (descrever)" },
  ],
  improper: [
    { code: "falha_nao_confirmada", label: "Falha não confirmada na verificação" },
    { code: "resposta_equivocada", label: "Resposta marcada por engano" },
    { code: "item_nao_aplicavel", label: "Item não se aplica ao veículo" },
    { code: "duplicidade", label: "Apontamento duplicado" },
    { code: "outro", label: "Outro (descrever)" },
  ],
  cancelled: [
    { code: "veiculo_desmobilizado", label: "Veículo desmobilizado/devolvido" },
    { code: "erro_cadastral", label: "Erro cadastral" },
    { code: "decisao_administrativa", label: "Decisão administrativa" },
    { code: "outro", label: "Outro (descrever)" },
  ],
} as const;

export const REASON_LABEL: Record<string, string> = Object.fromEntries(
  Object.values(REASONS).flatMap((list) => list.map((r) => [r.code, r.label])),
);

export const EVENT_LABEL: Record<string, string> = {
  created: "Plano criado",
  occurrence_added: "Nova ocorrência",
  recurrence_detected: "Possível reincidência",
  status_changed: "Situação alterada",
  auto_closed: "Encerrado automaticamente",
  closed: "Encerrado",
  reopened: "Reaberto",
  reopened_by_maintenance: "Reaberto pela manutenção",
  reopen_blocked: "Reabertura bloqueada",
  analysis_changed: "Tratativa definida",
  note_added: "Observação",
  due_changed: "Prazo alterado",
  assigned: "Responsável alterado",
  priority_changed: "Prioridade alterada",
  maintenance_linked: "Manutenção vinculada",
  maintenance_relinked: "Manutenção vinculada novamente",
  maintenance_unlinked: "Manutenção desvinculada",
  maintenance_opened: "Manutenção aberta pelo plano",
  candidate_discarded: "Candidata descartada",
  items_resolved_without_maintenance: "Resolvido sem manutenção",
  items_improper: "Improcedente",
  items_cancelled: "Cancelado",
  items_validated_by_maintenance: "Resolução validada",
  correction_conflict: "Correção do checklist em conflito",
};

export const QUALITY_LABEL: Record<string, { title: string; hint: string }> = {
  finding_without_item: { title: "Inconformidade sem apontamento", hint: "Resposta inconforme de manutenção que não virou apontamento. Reprocessar resolve." },
  plan_without_items: { title: "Plano sem apontamentos", hint: "Não deveria existir; revisar a origem." },
  closed_with_pending: { title: "Plano encerrado com pendência", hint: "Contradição entre situação e apontamentos." },
  open_without_pending: { title: "Plano aberto sem pendência", hint: "Recalcular a situação resolve." },
  stale_counters: { title: "Contadores desatualizados", hint: "Recalcular a situação resolve." },
  action_key_without_service: { title: "Item sem serviço mapeado", hint: "Sem mapeamento, não há baixa automática nem conciliação de alta confiança." },
  mapping_inactive_service: { title: "Mapeamento para serviço inativo", hint: "Revisar o mapeamento Pergunta × Serviço." },
  trigger_without_detail: { title: "Gatilho sem detalhe", hint: "A pergunta tem detalhe, mas o apontamento veio sem a opção marcada." },
  old_open_without_maintenance: { title: "Aberto há mais de 30 dias sem manutenção", hint: "Definir a tratativa." },
  link_cancelled_maintenance: { title: "Vínculo com manutenção cancelada", hint: "Nova tratativa necessária." },
  link_other_vehicle: { title: "Vínculo com manutenção de outro veículo", hint: "Bloqueado: correção manual auditada." },
  plan_without_context: { title: "Plano sem contexto histórico", hint: "Checklist de origem sem operação; não corrigir pela alocação atual." },
  correction_conflict: { title: "Correção do checklist em conflito", hint: "O checklist foi corrigido depois da tratativa." },
  ingestion_failed: { title: "Falhas de recebimento", hint: "Reprocessar tenta de novo." },
  multiple_candidates: { title: "Mais de uma candidata", hint: "Conciliação exige revisão manual." },
};

export const QUALITY_CLASS_LABEL: Record<string, string> = {
  safe: "Correção automática segura",
  review: "Revisão necessária",
  blocked: "Bloqueada",
};

export const ROUTE_LABEL: Record<string, string> = {
  maintenance: "Plano de manutenção",
  damage: "Fluxo de Avarias",
  not_eligible: "Não gera plano",
  conforming: "Conforme (corrigido)",
  not_submitted: "Checklist não enviado",
};

export const CHECKLIST_TYPE_LABEL: Record<string, string> = { saida: "Saída", retorno: "Retorno" };

export const GROUPING_LABEL: Record<string, string> = {
  operation: "Operação",
  cluster: "Cluster",
  vehicle: "Veículo",
  priority: "Prioridade",
  responsible: "Responsável",
};

export const FUNNEL_LABEL: Record<string, string> = {
  received: "Inconformidades recebidas",
  classified: "Classificadas (manutenção)",
  in_plan: "Em plano",
  treatment_defined: "Tratativa definida",
  maintenance_or_other: "Manutenção / outra resolução",
  resolved: "Resolvidas",
};

const df = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "numeric" });
const dtf = new Intl.DateTimeFormat("pt-BR", {
  timeZone: "America/Sao_Paulo",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});
const nf0 = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

/** aaaa-mm-dd → dd/mm/aaaa, sem passar por Date (sem fuso). */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : df.format(d);
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : dtf.format(d);
}

export const formatInt = (v: number | null | undefined) => (v == null ? "—" : nf0.format(v));
export const formatPct = (v: number | null | undefined) => (v == null ? "—" : `${nf1.format(v)}%`);
export const formatDays = (v: number | null | undefined) => (v == null ? "—" : `${nf1.format(v)} d`);

/** "Faróis com falha — Farol esquerdo" */
export const planTitle = (p: { title: string; detailLabel: string | null }) =>
  p.detailLabel ? `${p.title} — ${p.detailLabel}` : p.title;
