"use client";

import * as React from "react";
import type { MtsrAppVehicle } from "@/lib/mtsr/types";

/**
 * Rascunho da vistoria no aparelho.
 *
 * A chave de idempotência (`clientSubmissionId`) nasce quando a pessoa INICIA
 * a vistoria e fica guardada aqui, junto com as respostas, as observações e os
 * caminhos das fotos já enviadas ao bucket, até o servidor devolver o
 * protocolo. Fechar o navegador no meio não perde o trabalho; reenviar depois
 * de uma falha usa a MESMA chave, e a rotina devolve o mesmo protocolo em vez
 * de criar uma segunda vistoria.
 *
 * O rascunho é por pessoa (`scope` = id do usuário): as fotos ficam numa área
 * de rascunho do próprio usuário e a rotina de envio recusa caminhos de outra.
 */
export interface EvidenceRef {
  storagePath: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string | null;
  capturedAt: string;
}

export interface ItemAnswer {
  status: "ok" | "nok" | null;
  observation: string;
  evidence: EvidenceRef[];
}

export interface InspectionDraft {
  clientSubmissionId: string;
  vehicle: MtsrAppVehicle;
  /** ISO — quando a pessoa tocou na frota; vai como `inspectedAt`. */
  startedAt: string;
  answers: Record<string, ItemAnswer>;
  generalObservation: string;
}

export const emptyAnswer = (): ItemAnswer => ({ status: null, observation: "", evidence: [] });

const PREFIX = "hfm.mtsr.draft.";
const storageKey = (scope: string) => `${PREFIX}${scope || "anon"}`;

const listeners = new Set<() => void>();
/** Snapshot por chave: a mesma string gravada devolve o mesmo objeto (exigência do useSyncExternalStore). */
const cache = new Map<string, { raw: string | null; value: InspectionDraft | null }>();

function isDraft(value: unknown): value is InspectionDraft {
  if (!value || typeof value !== "object") return false;
  const d = value as Record<string, unknown>;
  const vehicle = d.vehicle as { id?: unknown } | null | undefined;
  return (
    typeof d.clientSubmissionId === "string" &&
    typeof d.startedAt === "string" &&
    !!vehicle &&
    typeof vehicle.id === "string" &&
    !!d.answers &&
    typeof d.answers === "object"
  );
}

function readDraft(scope: string): InspectionDraft | null {
  if (typeof window === "undefined") return null;
  const key = storageKey(scope);
  const previous = cache.get(key);
  let raw: string | null;
  try {
    raw = window.localStorage.getItem(key);
  } catch {
    // Armazenamento bloqueado: fica com o que já se conhecia.
    return previous?.value ?? null;
  }
  if (previous && previous.raw === raw) return previous.value;
  let value: InspectionDraft | null = null;
  if (raw) {
    try {
      const parsed: unknown = JSON.parse(raw);
      value = isDraft(parsed) ? parsed : null;
    } catch {
      value = null;
    }
  }
  cache.set(key, { raw, value });
  return value;
}

function notify() {
  for (const listener of listeners) listener();
}

export function saveDraft(scope: string, draft: InspectionDraft) {
  try {
    window.localStorage.setItem(storageKey(scope), JSON.stringify(draft));
  } catch {
    // Sem armazenamento local a vistoria continua: só perde a recuperação.
  }
  notify();
}

export function clearDraft(scope: string) {
  try {
    window.localStorage.removeItem(storageKey(scope));
  } catch {
    // Falhar ao limpar não invalida o envio já confirmado.
  }
  notify();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key === null || event.key.startsWith(PREFIX)) listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

const getServerSnapshot = () => null;

/** O rascunho guardado para esta pessoa (null no servidor e quando não há). */
export function useStoredDraft(scope: string): InspectionDraft | null {
  const getSnapshot = React.useCallback(() => readDraft(scope), [scope]);
  return React.useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
