"use server";

import { revalidatePath } from "next/cache";
import { getSessionContext, hasPermission } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import type { Json } from "@/types/database.types";
import { evidenceDraftPrefix, extensionFor, MTSR_EVIDENCE_BUCKET, MTSR_EVIDENCE_MAX_BYTES, MTSR_EVIDENCE_MIME, signEvidenceRead, signEvidenceUpload } from "./evidence";
import { camelize, MTSR_APP_PATH, MTSR_BASE_PATH, type MtsrAppContext, type MtsrAppVehicle, type MtsrInspectionDetail, type MtsrSubmitResult } from "./types";

/**
 * App Vistoria MTSR — o lado do servidor.
 *
 * Permissão `applications.mtsr.execute` (Perfis & Permissões). O envio é
 * idempotente pela chave gerada no aparelho antes do envio; as fotos vão
 * direto ao bucket privado por URL assinada de upload, para um caminho que a
 * rotina de envio confere. A vistoria enviada NÃO altera o estado oficial.
 */
export interface Result<T = undefined> {
  ok: boolean;
  error?: string;
  data?: T;
}

const PERMISSION = "applications.mtsr.execute";
type Rpc = (fn: string, args: Record<string, Json>) => Promise<{ data: unknown; error: { code?: string; message?: string } | null }>;

function toMessage(error: { code?: string; message?: string }, fallback: string): string {
  const message = error.message ?? "";
  if (message && /^[A-ZÀ-Ý]/.test(message.trim())) return message;
  if (error.code === "42501") return "Você não possui permissão para executar a Vistoria MTSR.";
  return fallback;
}

async function session() {
  const s = await getSessionContext();
  if (!s?.activeOrganization || !hasPermission(s, PERMISSION)) return null;
  return { session: s, organizationId: s.activeOrganization.organizationId, userId: s.userId };
}

async function call<T>(fn: string, args: Record<string, Json>, fallback: string): Promise<Result<T>> {
  const ctx = await session();
  if (!ctx) return { ok: false, error: "Sem permissão para executar a Vistoria MTSR ou a sessão expirou." };
  const supabase = await createClient();
  const { data, error } = await (supabase.rpc as unknown as Rpc)(fn, { p_organization_id: ctx.organizationId, ...args });
  if (error) return { ok: false, error: toMessage(error, fallback) };
  return { ok: true, data: camelize<T>(data) };
}

export async function loadAppContext(): Promise<Result<MtsrAppContext>> {
  return call("mtsr_inspection_context", {}, "Não foi possível abrir a Vistoria MTSR.");
}

export async function loadAppVehicles(search?: string | null): Promise<Result<MtsrAppVehicle[]>> {
  const r = await call<{ vehicles: MtsrAppVehicle[]; today: string }>("mtsr_inspection_vehicles", { p_search: search ?? null }, "Não foi possível listar as frotas.");
  return r.ok ? { ok: true, data: r.data?.vehicles ?? [] } : { ok: false, error: r.error };
}

export async function loadMyInspections(limit = 30): Promise<Result<MtsrInspectionDetail[]>> {
  return call("mtsr_my_inspections", { p_limit: limit }, "Não foi possível listar as suas vistorias.");
}

export async function loadOwnInspection(inspectionId: string): Promise<Result<MtsrInspectionDetail>> {
  return call("mtsr_inspection_detail", { p_inspection_id: inspectionId }, "Não foi possível abrir a vistoria.");
}

export interface EvidenceUploadTicket {
  path: string;
  token: string;
  signedUrl: string;
  bucket: string;
}

/**
 * Prepara o envio de uma foto: o caminho é sempre dentro da área de rascunho
 * desta pessoa e deste envio — a rotina de envio recusa qualquer outro.
 */
export async function createEvidenceUpload(input: { clientSubmissionId: string; componentId: string; mimeType: string; sizeBytes: number }): Promise<Result<EvidenceUploadTicket>> {
  const ctx = await session();
  if (!ctx) return { ok: false, error: "Sem permissão para executar a Vistoria MTSR ou a sessão expirou." };
  if (!/^[0-9a-f-]{36}$/i.test(input.clientSubmissionId) || !/^[0-9a-f-]{36}$/i.test(input.componentId)) {
    return { ok: false, error: "Identificadores inválidos." };
  }
  if (!(MTSR_EVIDENCE_MIME as readonly string[]).includes(input.mimeType)) {
    return { ok: false, error: "Formato de foto não aceito (use JPEG, PNG ou WebP)." };
  }
  if (!Number.isFinite(input.sizeBytes) || input.sizeBytes <= 0 || input.sizeBytes > MTSR_EVIDENCE_MAX_BYTES) {
    return { ok: false, error: "A foto deve ter até 10 MB." };
  }
  const path = `${evidenceDraftPrefix(ctx.organizationId, ctx.userId, input.clientSubmissionId)}${input.componentId}/${crypto.randomUUID()}.${extensionFor(input.mimeType)}`;
  try {
    const t = await signEvidenceUpload(path);
    return { ok: true, data: { ...t, bucket: MTSR_EVIDENCE_BUCKET } };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Não foi possível preparar o envio da foto." };
  }
}

export interface SubmitInspectionInput {
  clientSubmissionId: string;
  vehicleId: string;
  inspectedAt?: string | null;
  generalObservation?: string | null;
  items: {
    componentId: string;
    status: "ok" | "nok";
    observation?: string | null;
    evidence: { storagePath: string; mimeType: string; sizeBytes?: number | null; sha256?: string | null; capturedAt?: string | null }[];
  }[];
}

export async function submitInspection(input: SubmitInspectionInput): Promise<Result<MtsrSubmitResult>> {
  const r = await call<MtsrSubmitResult>(
    "mtsr_inspection_submit",
    {
      p_payload: {
        client_submission_id: input.clientSubmissionId,
        vehicle_id: input.vehicleId,
        inspected_at: input.inspectedAt ?? null,
        general_observation: input.generalObservation ?? null,
        items: input.items.map((i) => ({
          component_id: i.componentId,
          status: i.status,
          observation: i.observation ?? null,
          evidence: i.evidence.map((e) => ({
            storage_path: e.storagePath,
            mime_type: e.mimeType,
            size_bytes: e.sizeBytes ?? null,
            sha256: e.sha256 ?? null,
            captured_at: e.capturedAt ?? null,
          })),
        })),
      } as unknown as Json,
    },
    "Não foi possível enviar a vistoria.",
  );
  if (r.ok) {
    revalidatePath(MTSR_APP_PATH);
    revalidatePath(MTSR_BASE_PATH);
  }
  return r;
}

/** Fotos das próprias vistorias (a rotina de detalhe decide o acesso). */
export async function loadOwnEvidenceUrls(inspectionId: string): Promise<Result<Record<string, string>>> {
  const detail = await loadOwnInspection(inspectionId);
  if (!detail.ok || !detail.data) return { ok: false, error: detail.error };
  const paths = detail.data.items.flatMap((it) => it.evidence.filter((e) => !e.purgedAt).map((e) => e.storagePath));
  try {
    return { ok: true, data: await signEvidenceRead(paths) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Não foi possível abrir as fotos." };
  }
}
