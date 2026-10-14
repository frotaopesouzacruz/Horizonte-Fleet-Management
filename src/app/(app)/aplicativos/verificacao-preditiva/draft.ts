"use client";

import * as React from "react";
import type { PredictiveAppVehicle } from "@/lib/maintenance/predictive-app";
import type { VerificationResult } from "@/lib/maintenance/types";

/**
 * Rascunho da verificação preditiva no aparelho.
 *
 * A chave de idempotência (`clientSubmissionId`) nasce quando a pessoa escolhe
 * a frota e fica guardada aqui com o KM informado, as respostas do roteiro e
 * as observações até o servidor devolver o protocolo. Fechar o navegador no
 * meio não perde o trabalho; reenviar depois de uma falha usa a MESMA chave e
 * a rotina devolve o mesmo protocolo em vez de registrar duas vezes.
 */
export interface ItemDraft {
  result: VerificationResult | null;
  notes: string;
  answers: Record<string, string>;
  monitorKm: string;
  monitorDays: string;
  openMaintenance: boolean;
}

export interface PredictiveDraft {
  clientSubmissionId: string;
  vehicle: PredictiveAppVehicle;
  /** ISO — quando a pessoa escolheu a frota. */
  startedAt: string;
  kmInformed: string;
  kmJustification: string;
  generalObservation: string;
  items: Record<string, ItemDraft>;
}

export const emptyItem = (): ItemDraft => ({ result: null, notes: "", answers: {}, monitorKm: "", monitorDays: "", openMaintenance: true });

const PREFIX = "hfm.predictive.draft.";
const storageKey = (scope: string) => `${PREFIX}${scope || "anon"}`;

const listeners = new Set<() => void>();
const cache = new Map<string, { raw: string | null; value: PredictiveDraft | null }>();

function isDraft(value: unknown): value is PredictiveDraft {
  if (!value || typeof value !== "object") return false;
  const d = value as Record<string, unknown>;
  const vehicle = d.vehicle as { id?: unknown } | null | undefined;
  return typeof d.clientSubmissionId === "string" && typeof d.startedAt === "string" && !!vehicle && typeof vehicle.id === "string" && !!d.items && typeof d.items === "object";
}

function readDraft(scope: string): PredictiveDraft | null {
  if (typeof window === "undefined") return null;
  const key = storageKey(scope);
  const previous = cache.get(key);
  let raw: string | null;
  try {
    raw = window.localStorage.getItem(key);
  } catch {
    return previous?.value ?? null;
  }
  if (previous && previous.raw === raw) return previous.value;
  let value: PredictiveDraft | null = null;
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

export function saveDraft(scope: string, draft: PredictiveDraft) {
  try {
    window.localStorage.setItem(storageKey(scope), JSON.stringify(draft));
  } catch {
    // Sem armazenamento local a verificação continua: só perde a recuperação.
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
export function useStoredDraft(scope: string): PredictiveDraft | null {
  const getSnapshot = React.useCallback(() => readDraft(scope), [scope]);
  return React.useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
