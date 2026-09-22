"use server";

import { revalidatePath } from "next/cache";
import { resolveOrganization } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import type { Json } from "@/types/database.types";
import type { ChecklistForm } from "./queries";
import {
  getChecklistAdminOverview,
  getChecklistVersionPreview,
  getChecklistVersionTree,
  validateChecklistVersion,
  type AdminResult,
  type ChecklistAdminOverview,
  type ChecklistVersionTree,
  type CreateVersionInput,
  type CreateVersionResult,
  type PreviewInput,
  type PublishResult,
  type SaveClusterInput,
  type SaveConditionalInput,
  type SaveConditionalResult,
  type SaveQuestionInput,
  type SaveQuestionResult,
  type SaveRuleInput,
  type UpdateVersionInput,
  type VersionValidation,
} from "./admin-queries";

/**
 * Escritas do editor administrativo (§45–§47).
 *
 * Cada ação chama UMA rotina do banco com o payload inteiro: permissão,
 * imutabilidade da versão publicada e integridade dos ids são verificadas lá,
 * na mesma transação da gravação. A ação só traduz o erro e revalida as telas
 * que leem a configuração.
 */

const CONFIG_PATH = "/aplicativos/check-list-frota/configuracao";
const APP_PATH = "/aplicativos/check-list-frota";

const PERM_CONFIGURE = "applications.checklist_fleet.configure";
const PERM_CREATE_VERSION = "applications.checklist_fleet.create_version";
const PERM_PUBLISH = "applications.checklist_fleet.publish";
const PERM_MANAGE_RULES = "applications.checklist_fleet.manage_rules";

const SESSION_LOST =
  "Sua sessão expirou ou o acesso mudou. Recarregue a página e tente de novo.";

/**
 * Traduz o erro do banco para uma frase de operação.
 *
 * As rotinas do editor levantam mensagens já escritas para quem configura
 * ("A versão 1.0 está publicada e é imutável…"). Essas passam intactas — a
 * tela as mostra literalmente; só os códigos crus do Postgres viram texto aqui.
 */
function toMessage(error: { code?: string; message?: string }, fallback: string): string {
  const message = error.message ?? "";
  if (message && /^[A-ZÀ-Ý]/.test(message.trim())) return message;
  switch (error.code) {
    case "42501":
      return "Você não possui permissão para esta ação.";
    case "23505":
      return "Já existe um registro igual nesta versão.";
    case "23503":
      return "Há um vínculo obrigatório ausente para esta gravação.";
    case "40001":
      return "Outra gravação aconteceu ao mesmo tempo. Tente de novo.";
    default:
      return fallback;
  }
}

type WriteRpc =
  | "create_checklist_version"
  | "update_checklist_version"
  | "discard_checklist_version"
  | "save_checklist_cluster"
  | "delete_checklist_cluster"
  | "reorder_checklist_clusters"
  | "save_checklist_question"
  | "delete_checklist_question"
  | "reorder_checklist_questions"
  | "save_checklist_conditional"
  | "delete_checklist_conditional"
  | "save_checklist_rule"
  | "delete_checklist_rule"
  | "publish_checklist_version";

type Raw = Record<string, unknown>;
const obj = (v: unknown): Raw => (v && typeof v === "object" && !Array.isArray(v) ? (v as Raw) : {});
const str = (v: unknown, fallback = ""): string => (v == null ? fallback : String(v));
const strOrNull = (v: unknown): string | null => (v == null ? null : String(v));
const num = (v: unknown): number => (typeof v === "number" ? v : v == null ? 0 : Number(v));

function revalidateScreens() {
  revalidatePath(CONFIG_PATH);
  revalidatePath(APP_PATH);
}

async function callRpc<T>(
  permission: string,
  fn: WriteRpc,
  payload: Record<string, Json | undefined>,
  fallback: string,
  map: (raw: Raw) => T,
): Promise<AdminResult<T>> {
  const context = await resolveOrganization(permission);
  if (!context) return { ok: false, error: SESSION_LOST };

  const supabase = await createClient();
  const clean: Record<string, Json> = {};
  for (const [k, v] of Object.entries(payload)) if (v !== undefined) clean[k] = v;

  const { data, error } = await supabase.rpc(fn, {
    p_organization_id: context.organization.organizationId,
    p_payload: clean,
  });
  if (error) return { ok: false, error: toMessage(error, fallback) };

  revalidateScreens();
  return { ok: true, data: map(obj(data)) };
}

async function callRead<T>(
  permission: string,
  fallback: string,
  read: (organizationId: string) => Promise<T>,
): Promise<AdminResult<T>> {
  const context = await resolveOrganization(permission);
  if (!context) return { ok: false, error: SESSION_LOST };
  try {
    return { ok: true, data: await read(context.organization.organizationId) };
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    return { ok: false, error: /^[A-ZÀ-Ý]/.test(message.trim()) ? message : fallback };
  }
}

// ---------------------------------------------------------------------------
// Leituras sob demanda (troca de versão, prévia, validação)
// ---------------------------------------------------------------------------
export async function loadAdminOverview(): Promise<AdminResult<ChecklistAdminOverview>> {
  return callRead(PERM_CONFIGURE, "Não foi possível carregar a configuração.", getChecklistAdminOverview);
}

export async function loadVersionTree(versionId: string): Promise<AdminResult<ChecklistVersionTree>> {
  return callRead(PERM_CONFIGURE, "Não foi possível carregar a versão.", async (organizationId) => {
    const tree = await getChecklistVersionTree(organizationId, versionId);
    if (!tree) throw new Error("Versão não encontrada nesta organização.");
    return tree;
  });
}

export async function loadVersionPreview(input: PreviewInput): Promise<AdminResult<ChecklistForm>> {
  return callRead(PERM_CONFIGURE, "Não foi possível montar a pré-visualização.", (organizationId) =>
    getChecklistVersionPreview(organizationId, input),
  );
}

export async function validateVersion(versionId: string): Promise<AdminResult<VersionValidation>> {
  return callRead(PERM_CONFIGURE, "Não foi possível validar a versão.", (organizationId) =>
    validateChecklistVersion(organizationId, versionId),
  );
}

// ---------------------------------------------------------------------------
// Versões (§43, §46)
// ---------------------------------------------------------------------------
export async function createVersion(input: CreateVersionInput): Promise<AdminResult<CreateVersionResult>> {
  return callRpc(
    PERM_CREATE_VERSION,
    "create_checklist_version",
    { bump: input.bump, notes: input.notes ?? null },
    "Não foi possível criar a versão de trabalho.",
    (raw) => ({
      id: str(raw.id),
      label: str(raw.label),
      baseLabel: strOrNull(raw.base_label),
      clusters: num(raw.clusters),
      questions: num(raw.questions),
    }),
  );
}

export async function updateVersion(
  input: UpdateVersionInput,
): Promise<AdminResult<{ id: string; label: string }>> {
  return callRpc(
    PERM_CONFIGURE,
    "update_checklist_version",
    {
      id: input.id,
      notes: input.notes ?? null,
      min_duration_seconds: input.minDurationSeconds,
      max_duration_seconds: input.maxDurationSeconds,
    },
    "Não foi possível salvar os dados da versão.",
    (raw) => ({ id: str(raw.id), label: str(raw.label) }),
  );
}

export async function discardVersion(id: string): Promise<AdminResult<{ id: string; label: string }>> {
  return callRpc(
    PERM_CREATE_VERSION,
    "discard_checklist_version",
    { id },
    "Não foi possível descartar a versão de trabalho.",
    (raw) => ({ id: str(raw.id, id), label: str(raw.label) }),
  );
}

export async function publishVersion(versionId: string): Promise<AdminResult<PublishResult>> {
  return callRpc(
    PERM_PUBLISH,
    "publish_checklist_version",
    { version_id: versionId },
    "Não foi possível publicar a versão.",
    (raw) => ({
      id: str(raw.id, versionId),
      label: str(raw.label),
      archivedId: strOrNull(raw.archived_id),
      archivedLabel: strOrNull(raw.archived_label),
      publishedAt: strOrNull(raw.published_at),
      warnings: (Array.isArray(raw.warnings) ? (raw.warnings as Raw[]) : []).map((w) => ({
        code: str(w.code),
        message: str(w.message),
        questionId: strOrNull(w.question_id),
        clusterId: strOrNull(w.cluster_id),
      })),
    }),
  );
}

// ---------------------------------------------------------------------------
// Clusters
// ---------------------------------------------------------------------------
export async function saveCluster(
  input: SaveClusterInput,
): Promise<AdminResult<{ id: string; clusterKey: string }>> {
  return callRpc(
    PERM_CONFIGURE,
    "save_checklist_cluster",
    { id: input.id ?? null, version_id: input.versionId, name: input.name, is_required: input.isRequired },
    "Não foi possível salvar o cluster.",
    (raw) => ({ id: str(raw.id), clusterKey: str(raw.cluster_key) }),
  );
}

export async function deleteCluster(id: string): Promise<AdminResult<{ id: string }>> {
  return callRpc(
    PERM_CONFIGURE,
    "delete_checklist_cluster",
    { id },
    "Não foi possível excluir o cluster.",
    (raw) => ({ id: str(raw.id, id) }),
  );
}

export async function reorderClusters(
  versionId: string,
  orderedIds: string[],
): Promise<AdminResult<{ count: number }>> {
  return callRpc(
    PERM_CONFIGURE,
    "reorder_checklist_clusters",
    { version_id: versionId, ordered_ids: orderedIds },
    "Não foi possível reordenar os clusters.",
    (raw) => ({ count: num(raw.count ?? orderedIds.length) }),
  );
}

// ---------------------------------------------------------------------------
// Perguntas (§47: a identidade só muda quando declarado)
// ---------------------------------------------------------------------------
export async function saveQuestion(input: SaveQuestionInput): Promise<AdminResult<SaveQuestionResult>> {
  return callRpc(
    PERM_CONFIGURE,
    "save_checklist_question",
    {
      id: input.id ?? null,
      version_id: input.versionId,
      cluster_id: input.clusterId,
      question_text: input.questionText,
      conforming_answer: input.conformingAnswer,
      criticality: input.criticality,
      is_required: input.isRequired,
      generates_action_plan: input.generatesActionPlan,
      allows_note: input.allowsNote,
      note_required: input.noteRequired,
      status: input.status,
      new_identity: input.newIdentity === true,
      question_key: input.questionKey?.trim() || null,
    },
    "Não foi possível salvar a pergunta.",
    (raw) => ({ id: str(raw.id), questionKey: str(raw.question_key), clusterId: str(raw.cluster_id) }),
  );
}

export async function deleteQuestion(id: string): Promise<AdminResult<{ id: string }>> {
  return callRpc(
    PERM_CONFIGURE,
    "delete_checklist_question",
    { id },
    "Não foi possível excluir a pergunta.",
    (raw) => ({ id: str(raw.id, id) }),
  );
}

export async function reorderQuestions(
  clusterId: string,
  orderedIds: string[],
): Promise<AdminResult<{ count: number }>> {
  return callRpc(
    PERM_CONFIGURE,
    "reorder_checklist_questions",
    { cluster_id: clusterId, ordered_ids: orderedIds },
    "Não foi possível reordenar as perguntas.",
    (raw) => ({ count: num(raw.count ?? orderedIds.length) }),
  );
}

// ---------------------------------------------------------------------------
// Campo condicional (um por pergunta: é o que o executor apresenta)
// ---------------------------------------------------------------------------
export async function saveConditional(
  input: SaveConditionalInput,
): Promise<AdminResult<SaveConditionalResult>> {
  return callRpc(
    PERM_CONFIGURE,
    "save_checklist_conditional",
    {
      id: input.id ?? null,
      question_id: input.questionId,
      trigger_answer: input.triggerAnswer,
      label: input.label,
      field_type: input.fieldType,
      is_required: input.isRequired,
      options: input.fieldType === "text" ? [] : input.options,
    },
    "Não foi possível salvar o campo condicional.",
    (raw) => ({
      id: str(raw.id),
      fieldKey: str(raw.field_key),
      options: (Array.isArray(raw.options) ? (raw.options as Raw[]) : []).map((o) => ({
        value: str(o.value),
        label: str(o.label),
      })),
    }),
  );
}

export async function deleteConditional(id: string): Promise<AdminResult<{ id: string }>> {
  return callRpc(
    PERM_CONFIGURE,
    "delete_checklist_conditional",
    { id },
    "Não foi possível remover o campo condicional.",
    (raw) => ({ id: str(raw.id, id) }),
  );
}

// ---------------------------------------------------------------------------
// Regras de aplicabilidade (§24)
// ---------------------------------------------------------------------------
export async function saveRule(
  input: SaveRuleInput,
): Promise<AdminResult<{ id: string; targetName: string }>> {
  return callRpc(
    PERM_MANAGE_RULES,
    "save_checklist_rule",
    {
      id: input.id ?? null,
      question_id: input.questionId,
      rule_kind: input.ruleKind,
      mode: input.mode,
      target_id: input.targetId,
      guidance: input.mode === "guidance" ? (input.guidance ?? null) : null,
    },
    "Não foi possível salvar a regra.",
    (raw) => ({ id: str(raw.id), targetName: str(raw.target_name) }),
  );
}

export async function deleteRule(id: string): Promise<AdminResult<{ id: string }>> {
  return callRpc(
    PERM_MANAGE_RULES,
    "delete_checklist_rule",
    { id },
    "Não foi possível excluir a regra.",
    (raw) => ({ id: str(raw.id, id) }),
  );
}
