import "server-only";

import { createClient } from "@/lib/supabase/server";
import type { Answer, ChecklistForm, Criticality } from "./queries";

/**
 * Leituras do editor administrativo do Check List de Frota (Etapa 12, §45–§47).
 *
 * Tudo passa por rotina do banco, `security invoker`: a RLS decide o que a
 * administração enxerga, e o cliente recebe a árvore da versão pronta — clusters,
 * perguntas, condicionais e regras — sem remontar nada. Os tipos abaixo são
 * também o contrato das ações e da prévia sem sessão, por isso vivem aqui e
 * não no módulo `"use server"`, que só pode exportar funções.
 */

export type VersionStatus = "draft" | "published" | "archived";
export type QuestionStatus = "active" | "inactive";
export type ConditionalFieldType = "text" | "single_select" | "multi_select";
export type RuleKind = "vehicle_type" | "vehicle_subcategory" | "operation";
export type RuleMode = "include" | "exclude" | "guidance";
export type VersionBump = "minor" | "major";

export interface AdminResult<T = undefined> {
  ok: boolean;
  error?: string;
  data?: T;
}

// ---------------------------------------------------------------------------
// Visão geral (checklist_admin_overview)
// ---------------------------------------------------------------------------
export interface AdminApp {
  id: string;
  name: string;
  isActive: boolean;
  allowsAttachments: boolean;
}

export interface AdminVersionSummary {
  id: string;
  major: number;
  minor: number;
  label: string;
  status: VersionStatus;
  notes: string | null;
  sourceNote: string | null;
  publishedAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  minDurationSeconds: number;
  maxDurationSeconds: number;
  clusters: number;
  questions: number;
  executions: number;
}

export interface AdminOperation {
  id: string;
  name: string;
  code: string | null;
  status: string;
  isEnabled: boolean;
}

export interface AdminSubcategory {
  id: string;
  name: string;
  isActive: boolean;
}

export interface AdminVehicleType {
  id: string;
  code: string;
  name: string;
  subcategories: AdminSubcategory[];
}

export interface ChecklistAdminOverview {
  app: AdminApp | null;
  versions: AdminVersionSummary[];
  operations: AdminOperation[];
  vehicleTypes: AdminVehicleType[];
}

// ---------------------------------------------------------------------------
// Árvore da versão (checklist_version_tree)
// ---------------------------------------------------------------------------
export interface AdminConditional {
  id: string;
  fieldKey: string;
  triggerAnswer: Answer;
  label: string;
  fieldType: ConditionalFieldType;
  isRequired: boolean;
  options: { value: string; label: string }[];
  sortOrder: number;
}

export interface AdminRule {
  id: string;
  ruleKind: RuleKind;
  mode: RuleMode;
  vehicleTypeId: string | null;
  vehicleSubcategoryId: string | null;
  operationId: string | null;
  targetName: string;
  guidance: string | null;
}

export interface AdminQuestion {
  id: string;
  questionKey: string;
  sortOrder: number;
  questionText: string;
  answerType: string;
  conformingAnswer: Answer;
  criticality: Criticality;
  isRequired: boolean;
  generatesActionPlan: boolean;
  allowsNote: boolean;
  noteRequired: boolean;
  status: QuestionStatus;
  conditionals: AdminConditional[];
  rules: AdminRule[];
}

export interface AdminCluster {
  id: string;
  clusterKey: string;
  name: string;
  sortOrder: number;
  isRequired: boolean;
  questions: AdminQuestion[];
}

export interface AdminVersionDetail {
  id: string;
  major: number;
  minor: number;
  label: string;
  status: VersionStatus;
  notes: string | null;
  sourceNote: string | null;
  publishedAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  minDurationSeconds: number;
  maxDurationSeconds: number;
}

export interface ChecklistVersionTree {
  version: AdminVersionDetail;
  clusters: AdminCluster[];
}

// ---------------------------------------------------------------------------
// Validação (validate_checklist_version)
// ---------------------------------------------------------------------------
export interface ValidationIssue {
  code: string;
  message: string;
  questionId: string | null;
  clusterId: string | null;
}

export interface VersionValidation {
  ok: boolean;
  versionId: string;
  label: string;
  status: VersionStatus;
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
  summary: {
    clusters: number;
    questionsActive: number;
    questionsInactive: number;
    conditionals: number;
    rules: number;
    operationsEnabled: number;
    answerTypes: string[];
    allowsAttachments: boolean;
  };
}

// ---------------------------------------------------------------------------
// Entradas das escritas — o contrato que a tela, as ações reais e as ações da
// prévia compartilham.
// ---------------------------------------------------------------------------
export interface CreateVersionInput {
  bump: VersionBump;
  notes?: string | null;
}

export interface CreateVersionResult {
  id: string;
  label: string;
  baseLabel: string | null;
  clusters: number;
  questions: number;
}

export interface UpdateVersionInput {
  id: string;
  notes: string | null;
  minDurationSeconds: number;
  maxDurationSeconds: number;
}

export interface SaveClusterInput {
  id?: string;
  versionId: string;
  name: string;
  isRequired: boolean;
}

export interface SaveQuestionInput {
  id?: string;
  versionId: string;
  clusterId: string;
  questionText: string;
  conformingAnswer: Answer;
  criticality: Criticality;
  isRequired: boolean;
  generatesActionPlan: boolean;
  allowsNote: boolean;
  noteRequired: boolean;
  status: QuestionStatus;
  /** §47: só com `true` a identidade técnica muda — e exige `questionKey`. */
  newIdentity?: boolean;
  questionKey?: string | null;
}

export interface SaveQuestionResult {
  id: string;
  questionKey: string;
  clusterId: string;
}

export interface SaveConditionalInput {
  id?: string;
  questionId: string;
  triggerAnswer: Answer;
  label: string;
  fieldType: ConditionalFieldType;
  isRequired: boolean;
  options: string[];
}

export interface SaveConditionalResult {
  id: string;
  fieldKey: string;
  options: { value: string; label: string }[];
}

export interface SaveRuleInput {
  id?: string;
  questionId: string;
  ruleKind: RuleKind;
  mode: RuleMode;
  targetId: string;
  guidance?: string | null;
}

export interface PreviewInput {
  versionId: string;
  operationId?: string | null;
  vehicleTypeId?: string | null;
  vehicleSubcategoryId?: string | null;
}

export interface PublishResult {
  id: string;
  label: string;
  archivedId: string | null;
  archivedLabel: string | null;
  publishedAt: string | null;
  warnings: ValidationIssue[];
}

/**
 * As ações que a tela usa, com a mesma assinatura das ações de servidor. A
 * prévia sem sessão injeta uma implementação em memória; a tela real recebe as
 * funções de `admin-actions.ts`.
 */
export interface ChecklistAdminActions {
  loadOverview: () => Promise<AdminResult<ChecklistAdminOverview>>;
  loadVersionTree: (versionId: string) => Promise<AdminResult<ChecklistVersionTree>>;
  loadVersionPreview: (input: PreviewInput) => Promise<AdminResult<ChecklistForm>>;
  validateVersion: (versionId: string) => Promise<AdminResult<VersionValidation>>;
  createVersion: (input: CreateVersionInput) => Promise<AdminResult<CreateVersionResult>>;
  updateVersion: (input: UpdateVersionInput) => Promise<AdminResult<{ id: string; label: string }>>;
  discardVersion: (id: string) => Promise<AdminResult<{ id: string; label: string }>>;
  publishVersion: (versionId: string) => Promise<AdminResult<PublishResult>>;
  saveCluster: (input: SaveClusterInput) => Promise<AdminResult<{ id: string; clusterKey: string }>>;
  deleteCluster: (id: string) => Promise<AdminResult<{ id: string }>>;
  reorderClusters: (versionId: string, orderedIds: string[]) => Promise<AdminResult<{ count: number }>>;
  saveQuestion: (input: SaveQuestionInput) => Promise<AdminResult<SaveQuestionResult>>;
  deleteQuestion: (id: string) => Promise<AdminResult<{ id: string }>>;
  reorderQuestions: (clusterId: string, orderedIds: string[]) => Promise<AdminResult<{ count: number }>>;
  saveConditional: (input: SaveConditionalInput) => Promise<AdminResult<SaveConditionalResult>>;
  deleteConditional: (id: string) => Promise<AdminResult<{ id: string }>>;
  saveRule: (input: SaveRuleInput) => Promise<AdminResult<{ id: string; targetName: string }>>;
  deleteRule: (id: string) => Promise<AdminResult<{ id: string }>>;
}

// ---------------------------------------------------------------------------
// Conversores
// ---------------------------------------------------------------------------
type Raw = Record<string, unknown>;
const obj = (v: unknown): Raw => (v && typeof v === "object" && !Array.isArray(v) ? (v as Raw) : {});
const arr = (v: unknown): Raw[] => (Array.isArray(v) ? (v as Raw[]) : []);
const num = (v: unknown, fallback = 0): number => (typeof v === "number" ? v : v == null ? fallback : Number(v));
const str = (v: unknown, fallback = ""): string => (v == null ? fallback : String(v));
const strOrNull = (v: unknown): string | null => (v == null ? null : String(v));
const bool = (v: unknown, fallback = false): boolean => (typeof v === "boolean" ? v : fallback);

const asAnswer = (v: unknown): Answer => (v === "no" ? "no" : "yes");
const asCriticality = (v: unknown): Criticality => (v === "critica" ? "critica" : "media");
const asVersionStatus = (v: unknown): VersionStatus =>
  v === "published" ? "published" : v === "archived" ? "archived" : "draft";
const asQuestionStatus = (v: unknown): QuestionStatus => (v === "inactive" ? "inactive" : "active");
const asFieldType = (v: unknown): ConditionalFieldType =>
  v === "single_select" || v === "multi_select" ? v : "text";
const asRuleKind = (v: unknown): RuleKind =>
  v === "vehicle_subcategory" || v === "operation" ? v : "vehicle_type";
const asRuleMode = (v: unknown): RuleMode => (v === "exclude" || v === "guidance" ? v : "include");

const toOptions = (v: unknown): { value: string; label: string }[] =>
  arr(v).map((o) => ({ value: str(o.value), label: str(o.label) }));

function toVersionSummary(raw: Raw): AdminVersionSummary {
  return {
    id: str(raw.id),
    major: num(raw.major),
    minor: num(raw.minor),
    label: str(raw.label),
    status: asVersionStatus(raw.status),
    notes: strOrNull(raw.notes),
    sourceNote: strOrNull(raw.source_note),
    publishedAt: strOrNull(raw.published_at),
    createdAt: strOrNull(raw.created_at),
    updatedAt: strOrNull(raw.updated_at),
    minDurationSeconds: num(raw.min_duration_seconds, 60),
    maxDurationSeconds: num(raw.max_duration_seconds, 600),
    clusters: num(raw.clusters),
    questions: num(raw.questions),
    executions: num(raw.executions),
  };
}

export function toAdminOverview(data: unknown): ChecklistAdminOverview {
  const raw = obj(data);
  const app = raw.app ? obj(raw.app) : null;
  return {
    app: app && app.id
      ? {
          id: str(app.id),
          name: str(app.name, "Check List de Frota"),
          isActive: bool(app.is_active),
          allowsAttachments: bool(app.allows_attachments),
        }
      : null,
    versions: arr(raw.versions).map(toVersionSummary),
    operations: arr(raw.operations).map((o) => ({
      id: str(o.id),
      name: str(o.name),
      code: strOrNull(o.code),
      status: str(o.status, "active"),
      isEnabled: bool(o.is_enabled),
    })),
    vehicleTypes: arr(raw.vehicle_types).map((t) => ({
      id: str(t.id),
      code: str(t.code),
      name: str(t.name),
      subcategories: arr(t.subcategories).map((s) => ({
        id: str(s.id),
        name: str(s.name),
        isActive: bool(s.is_active, true),
      })),
    })),
  };
}

function toQuestion(raw: Raw): AdminQuestion {
  return {
    id: str(raw.id),
    questionKey: str(raw.question_key),
    sortOrder: num(raw.sort_order),
    questionText: str(raw.question_text),
    answerType: str(raw.answer_type, "yes_no"),
    conformingAnswer: asAnswer(raw.conforming_answer),
    criticality: asCriticality(raw.criticality),
    isRequired: bool(raw.is_required, true),
    generatesActionPlan: bool(raw.generates_action_plan, true),
    allowsNote: bool(raw.allows_note, true),
    noteRequired: bool(raw.note_required),
    status: asQuestionStatus(raw.status),
    conditionals: arr(raw.conditionals).map((c) => ({
      id: str(c.id),
      fieldKey: str(c.field_key),
      triggerAnswer: asAnswer(c.trigger_answer),
      label: str(c.label),
      fieldType: asFieldType(c.field_type),
      isRequired: bool(c.is_required, true),
      options: toOptions(c.options),
      sortOrder: num(c.sort_order, 1),
    })),
    rules: arr(raw.rules).map((r) => ({
      id: str(r.id),
      ruleKind: asRuleKind(r.rule_kind),
      mode: asRuleMode(r.mode),
      vehicleTypeId: strOrNull(r.vehicle_type_id),
      vehicleSubcategoryId: strOrNull(r.vehicle_subcategory_id),
      operationId: strOrNull(r.operation_id),
      targetName: str(r.target_name, "—"),
      guidance: strOrNull(r.guidance),
    })),
  };
}

export function toVersionTree(data: unknown): ChecklistVersionTree | null {
  const raw = obj(data);
  const version = obj(raw.version);
  if (!version.id) return null;
  return {
    version: {
      id: str(version.id),
      major: num(version.major),
      minor: num(version.minor),
      label: str(version.label),
      status: asVersionStatus(version.status),
      notes: strOrNull(version.notes),
      sourceNote: strOrNull(version.source_note),
      publishedAt: strOrNull(version.published_at),
      createdAt: strOrNull(version.created_at),
      updatedAt: strOrNull(version.updated_at),
      minDurationSeconds: num(version.min_duration_seconds, 60),
      maxDurationSeconds: num(version.max_duration_seconds, 600),
    },
    clusters: arr(raw.clusters).map((c) => ({
      id: str(c.id),
      clusterKey: str(c.cluster_key),
      name: str(c.name),
      sortOrder: num(c.sort_order),
      isRequired: bool(c.is_required, true),
      questions: arr(c.questions).map(toQuestion),
    })),
  };
}

const toIssue = (raw: Raw): ValidationIssue => ({
  code: str(raw.code),
  message: str(raw.message),
  questionId: strOrNull(raw.question_id),
  clusterId: strOrNull(raw.cluster_id),
});

export function toValidation(data: unknown): VersionValidation {
  const raw = obj(data);
  const summary = obj(raw.summary);
  return {
    ok: raw.ok === true,
    versionId: str(raw.version_id),
    label: str(raw.label),
    status: asVersionStatus(raw.status),
    errors: arr(raw.errors).map(toIssue),
    warnings: arr(raw.warnings).map(toIssue),
    summary: {
      clusters: num(summary.clusters),
      questionsActive: num(summary.questions_active),
      questionsInactive: num(summary.questions_inactive),
      conditionals: num(summary.conditionals),
      rules: num(summary.rules),
      operationsEnabled: num(summary.operations_enabled),
      answerTypes: arr(summary.answer_types).map((t) => String(t)),
      allowsAttachments: bool(summary.allows_attachments),
    },
  };
}

/** A prévia devolve o mesmo desenho do executor; o mapeamento é o de `getChecklistForm`. */
export function toPreviewForm(data: unknown): ChecklistForm {
  const raw = obj(data);
  const vehicle = obj(raw.vehicle);
  return {
    appId: str(raw.app_id),
    appName: str(raw.app_name, "Check List de Frota"),
    versionId: str(raw.version_id),
    versionLabel: str(raw.version_label),
    minDurationSeconds: num(raw.min_duration_seconds, 60),
    maxDurationSeconds: num(raw.max_duration_seconds, 600),
    vehicle: {
      id: str(vehicle.id, "preview"),
      licensePlate: strOrNull(vehicle.license_plate) ?? "PRÉVIA",
      fleetCode: strOrNull(vehicle.fleet_code),
    },
    clusters: arr(raw.clusters).map((c) => ({
      id: str(c.id),
      clusterKey: str(c.cluster_key),
      name: str(c.name),
      questions: arr(c.questions).map((q) => {
        const conditional = q.conditional ? obj(q.conditional) : null;
        return {
          id: str(q.id),
          questionKey: str(q.question_key),
          text: str(q.text),
          conformingAnswer: asAnswer(q.conforming_answer),
          criticality: asCriticality(q.criticality),
          isRequired: bool(q.is_required, true),
          allowsNote: bool(q.allows_note, true),
          noteRequired: bool(q.note_required),
          guidance: strOrNull(q.guidance),
          conditional:
            conditional && conditional.field_key
              ? {
                  fieldKey: str(conditional.field_key),
                  triggerAnswer: asAnswer(conditional.trigger_answer),
                  label: str(conditional.label),
                  fieldType: asFieldType(conditional.field_type),
                  isRequired: bool(conditional.is_required, true),
                  options: toOptions(conditional.options),
                }
              : null,
        };
      }),
    })),
  };
}

// ---------------------------------------------------------------------------
// Leituras
// ---------------------------------------------------------------------------
export async function getChecklistAdminOverview(organizationId: string): Promise<ChecklistAdminOverview> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("checklist_admin_overview", {
    p_organization_id: organizationId,
  });
  if (error) throw new Error(error.message);
  return toAdminOverview(data);
}

export async function getChecklistVersionTree(
  organizationId: string,
  versionId: string,
): Promise<ChecklistVersionTree | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("checklist_version_tree", {
    p_organization_id: organizationId,
    p_version_id: versionId,
  });
  if (error) throw new Error(error.message);
  return toVersionTree(data);
}

export async function getChecklistVersionPreview(
  organizationId: string,
  input: PreviewInput,
): Promise<ChecklistForm> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("checklist_version_preview", {
    p_organization_id: organizationId,
    p_version_id: input.versionId,
    p_operation_id: input.operationId || undefined,
    p_vehicle_type_id: input.vehicleTypeId || undefined,
    p_vehicle_subcategory_id: input.vehicleSubcategoryId || undefined,
  });
  if (error) throw new Error(error.message);
  return toPreviewForm(data);
}

export async function validateChecklistVersion(
  organizationId: string,
  versionId: string,
): Promise<VersionValidation> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("validate_checklist_version", {
    p_organization_id: organizationId,
    p_version_id: versionId,
  });
  if (error) throw new Error(error.message);
  return toValidation(data);
}
