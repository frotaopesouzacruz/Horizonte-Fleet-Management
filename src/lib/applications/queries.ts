import "server-only";

import { createClient } from "@/lib/supabase/server";

/**
 * Leituras do Check List de Frota.
 *
 * Tudo passa por rotina do banco, `security invoker`: a RLS decide o que cada
 * pessoa enxerga, e a tela não recebe nada que ela não pudesse consultar
 * diretamente. É o mesmo desenho de Governança — e aqui importa mais, porque o
 * executor roda no celular de quem está em campo.
 */

export type ChecklistType = "saida" | "retorno";
export type Answer = "yes" | "no";
export type Criticality = "media" | "critica";

export interface ChecklistConditional {
  fieldKey: string;
  triggerAnswer: Answer;
  label: string;
  fieldType: "text" | "single_select" | "multi_select";
  isRequired: boolean;
  options: { value: string; label: string }[];
}

export interface ChecklistQuestion {
  id: string;
  questionKey: string;
  text: string;
  conformingAnswer: Answer;
  criticality: Criticality;
  isRequired: boolean;
  allowsNote: boolean;
  noteRequired: boolean;
  /** §16: orientação operacional aprovada, quando houver, para esta operação. */
  guidance: string | null;
  conditional: ChecklistConditional | null;
}

export interface ChecklistCluster {
  id: string;
  clusterKey: string;
  name: string;
  questions: ChecklistQuestion[];
}

export interface ChecklistForm {
  appId: string;
  appName: string;
  versionId: string;
  versionLabel: string;
  minDurationSeconds: number;
  maxDurationSeconds: number;
  vehicle: {
    id: string;
    licensePlate: string | null;
    fleetCode: string | null;
  };
  clusters: ChecklistCluster[];
}

const asAnswer = (v: unknown): Answer => (v === "no" ? "no" : "yes");
const asCriticality = (v: unknown): Criticality => (v === "critica" ? "critica" : "media");

function toConditional(raw: unknown): ChecklistConditional | null {
  if (!raw || typeof raw !== "object") return null;
  const c = raw as Record<string, unknown>;
  const type = c.field_type;
  return {
    fieldKey: String(c.field_key),
    triggerAnswer: asAnswer(c.trigger_answer),
    label: String(c.label),
    fieldType:
      type === "single_select" || type === "multi_select" ? type : "text",
    isRequired: c.is_required !== false,
    options: Array.isArray(c.options)
      ? (c.options as Record<string, unknown>[]).map((o) => ({
          value: String(o.value),
          label: String(o.label),
        }))
      : [],
  };
}

/**
 * O formulário que ESTE veículo deve responder.
 *
 * O filtro de aplicabilidade acontece no banco (§24): o que não se aplica não
 * chega ao cliente. Mandar as 34 perguntas e esconder algumas no navegador
 * deixaria a contagem de pendências à mercê do que o cliente decidisse ocultar.
 */
export async function getChecklistForm(
  organizationId: string,
  vehicleId: string,
  operationId: string,
): Promise<ChecklistForm> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("checklist_fleet_form", {
    p_organization_id: organizationId,
    p_vehicle_id: vehicleId,
    p_operation_id: operationId,
  });
  if (error) throw new Error(error.message);

  const raw = (data ?? {}) as Record<string, unknown>;
  const vehicle = (raw.vehicle ?? {}) as Record<string, unknown>;

  return {
    appId: String(raw.app_id),
    appName: String(raw.app_name ?? "Check List de Frota"),
    versionId: String(raw.version_id),
    versionLabel: String(raw.version_label ?? ""),
    minDurationSeconds: Number(raw.min_duration_seconds ?? 60),
    maxDurationSeconds: Number(raw.max_duration_seconds ?? 600),
    vehicle: {
      id: String(vehicle.id),
      licensePlate: (vehicle.license_plate as string) ?? null,
      fleetCode: (vehicle.fleet_code as string) ?? null,
    },
    clusters: (Array.isArray(raw.clusters) ? raw.clusters : []).map((c) => {
      const cl = c as Record<string, unknown>;
      return {
        id: String(cl.id),
        clusterKey: String(cl.cluster_key),
        name: String(cl.name),
        questions: (Array.isArray(cl.questions) ? cl.questions : []).map((q) => {
          const qu = q as Record<string, unknown>;
          return {
            id: String(qu.id),
            questionKey: String(qu.question_key),
            text: String(qu.text),
            conformingAnswer: asAnswer(qu.conforming_answer),
            criticality: asCriticality(qu.criticality),
            isRequired: qu.is_required !== false,
            allowsNote: qu.allows_note !== false,
            noteRequired: qu.note_required === true,
            guidance: (qu.guidance as string) ?? null,
            conditional: toConditional(qu.conditional),
          };
        }),
      };
    }),
  };
}

export interface ChecklistContext {
  available: boolean;
  reason: string | null;
  appName: string;
  allowsAttachments: boolean;
  version: { id: string; label: string; minDurationSeconds: number; maxDurationSeconds: number } | null;
  actor: { employeeId: string; name: string; employeeCode: string | null } | null;
  operations: { id: string; name: string }[];
}

export async function getChecklistContext(organizationId: string): Promise<ChecklistContext> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("checklist_fleet_context", {
    p_organization_id: organizationId,
  });
  if (error) throw new Error(error.message);

  const raw = (data ?? {}) as Record<string, unknown>;
  const app = (raw.app ?? {}) as Record<string, unknown>;
  const version = raw.version as Record<string, unknown> | null;
  const actor = raw.actor as Record<string, unknown> | null;

  return {
    available: raw.available === true,
    reason: (raw.reason as string) ?? null,
    appName: String(app.name ?? "Check List de Frota"),
    allowsAttachments: app.allows_attachments === true,
    version: version
      ? {
          id: String(version.id),
          label: String(version.label),
          minDurationSeconds: Number(version.min_duration_seconds ?? 60),
          maxDurationSeconds: Number(version.max_duration_seconds ?? 600),
        }
      : null,
    actor: actor
      ? {
          employeeId: String(actor.employee_id),
          name: String(actor.name),
          employeeCode: (actor.employee_code as string) ?? null,
        }
      : null,
    operations: (Array.isArray(raw.operations) ? raw.operations : []).map((o) => {
      const op = o as Record<string, unknown>;
      return { id: String(op.id), name: String(op.name) };
    }),
  };
}

export interface ExecutionSummary {
  id: string;
  operationalDate: string;
  checklistType: ChecklistType;
  licensePlate: string | null;
  fleetCode: string | null;
  operationName: string;
  brCode: string | null;
  submittedAt: string | null;
  durationSeconds: number | null;
  applicable: number;
  conforming: number;
  nonConforming: number;
  criticalNonConforming: number;
}

export async function listMyExecutions(
  organizationId: string,
  limit = 30,
): Promise<ExecutionSummary[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("checklist_my_executions", {
    p_organization_id: organizationId,
    p_limit: limit,
  });
  if (error) throw new Error(error.message);

  return (Array.isArray(data) ? data : []).map((row) => {
    const e = row as Record<string, unknown>;
    return {
      id: String(e.id),
      operationalDate: String(e.operational_date),
      checklistType: e.checklist_type === "retorno" ? "retorno" : "saida",
      licensePlate: (e.license_plate as string) ?? null,
      fleetCode: (e.fleet_code as string) ?? null,
      operationName: String(e.operation_name ?? "—"),
      brCode: (e.br_code as string) ?? null,
      submittedAt: (e.submitted_at as string) ?? null,
      durationSeconds: e.duration_seconds === null ? null : Number(e.duration_seconds),
      applicable: Number(e.applicable ?? 0),
      conforming: Number(e.conforming ?? 0),
      nonConforming: Number(e.non_conforming ?? 0),
      criticalNonConforming: Number(e.critical_non_conforming ?? 0),
    };
  });
}
