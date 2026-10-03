import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Evidências da Vistoria MTSR — bucket PRIVADO `mtsr-evidence`.
 *
 * Nenhuma URL pública: o envio usa uma URL assinada de upload emitida pelo
 * servidor para um caminho que a rotina de envio confere
 * (`<org>/inspections/drafts/<usuário>/<envio>/…`); a leitura usa URLs
 * assinadas curtas, emitidas só depois de a RLS/rotina ter mostrado a linha
 * da evidência à pessoa. A exclusão física (retenção) também é do servidor.
 */
export const MTSR_EVIDENCE_BUCKET = "mtsr-evidence";
export const MTSR_EVIDENCE_MAX_BYTES = 10 * 1024 * 1024;
export const MTSR_EVIDENCE_MIME = ["image/jpeg", "image/png", "image/webp"] as const;
export const MTSR_EVIDENCE_READ_TTL = 300;

export function evidenceDraftPrefix(organizationId: string, userId: string, clientSubmissionId: string) {
  return `${organizationId}/inspections/drafts/${userId}/${clientSubmissionId}/`;
}

export function extensionFor(mime: string): string {
  return mime === "image/png" ? "png" : mime === "image/webp" ? "webp" : "jpg";
}

export async function signEvidenceUpload(path: string): Promise<{ signedUrl: string; token: string; path: string }> {
  const admin = createAdminClient();
  const { data, error } = await admin.storage.from(MTSR_EVIDENCE_BUCKET).createSignedUploadUrl(path);
  if (error || !data) throw new Error(error?.message ?? "Não foi possível preparar o envio da foto.");
  return { signedUrl: data.signedUrl, token: data.token, path: data.path };
}

export async function signEvidenceRead(paths: string[], ttl = MTSR_EVIDENCE_READ_TTL): Promise<Record<string, string>> {
  if (!paths.length) return {};
  const admin = createAdminClient();
  const { data, error } = await admin.storage.from(MTSR_EVIDENCE_BUCKET).createSignedUrls(paths, ttl);
  if (error || !data) throw new Error(error?.message ?? "Não foi possível abrir as fotos.");
  const out: Record<string, string> = {};
  for (const d of data) if (d.signedUrl && d.path) out[d.path] = d.signedUrl;
  return out;
}

/** Remove objetos do bucket; devolve os caminhos que não existem mais (removidos ou já ausentes). */
export async function removeEvidenceObjects(paths: string[]): Promise<string[]> {
  if (!paths.length) return [];
  const admin = createAdminClient();
  const { error } = await admin.storage.from(MTSR_EVIDENCE_BUCKET).remove(paths);
  if (error) throw new Error(error.message);
  return paths;
}
