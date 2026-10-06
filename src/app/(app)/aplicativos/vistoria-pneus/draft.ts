"use client";

import * as React from "react";
import type { TireAppContext } from "@/lib/tires/types";

/**
 * Rascunho da Vistoria de Pneus no aparelho — um por veículo e por pessoa.
 *
 * Guarda as leituras digitadas, a observação geral, a posição em que a pessoa
 * parou e a chave de idempotência (`clientSubmissionId`), gerada UMA vez quando
 * o rascunho nasce. Fechar o navegador no meio não perde o trabalho; reenviar
 * depois de uma falha de rede usa a MESMA chave, e o banco devolve o mesmo
 * protocolo (`duplicate`) em vez de criar uma segunda vistoria.
 *
 * Só há aqui o que a própria pessoa digitou: a leitura é cega e nenhum valor
 * da fotografia oficial passa pelo aparelho.
 *
 * Também mora aqui a validação de UX das leituras (o banco é a autoridade:
 * os limites vêm de `context.limits` e o mesmo critério é reaplicado no envio).
 */

export const READING_FIELDS = ["fire", "t1", "t2", "t3", "t4", "psi", "obs"] as const;
export type ReadingField = (typeof READING_FIELDS)[number];
export const TREAD_FIELDS = ["t1", "t2", "t3", "t4"] as const;
export type TreadField = (typeof TREAD_FIELDS)[number];

/** Leituras de uma posição, exatamente como digitadas (texto). */
export type Reading = Record<ReadingField, string>;

export const emptyReading = (): Reading => ({ fire: "", t1: "", t2: "", t3: "", t4: "", psi: "", obs: "" });

export interface DraftVehicle {
  id: string;
  licensePlate: string;
  fleetCode: string | null;
  vehicleTypeName: string | null;
  operationName: string | null;
  cityName: string | null;
  stateUf: string | null;
}

export interface TireDraft {
  version: 1;
  clientSubmissionId: string;
  vehicle: DraftVehicle;
  parentInspectionId: string | null;
  /** ISO — quando a medição começou; vai como `startedAt`/`inspectedAt`. */
  startedAt: string;
  updatedAt: string;
  readings: Record<string, Reading>;
  generalObservation: string;
  /** Posição aberta por último. */
  current: string | null;
  /** ISO — última tentativa de envio (o envio pode ter chegado ao banco). */
  lastAttemptAt: string | null;
  /** Leituras alteradas depois da última tentativa de envio. */
  editedAfterAttempt: boolean;
}

/** UUID v4 — `crypto.randomUUID` só existe em contexto seguro; o resto cai no getRandomValues. */
export function newSubmissionId(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  const bytes = new Uint8Array(16);
  if (c && typeof c.getRandomValues === "function") c.getRandomValues(bytes);
  else for (let i = 0; i < 16; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function createDraft(vehicle: DraftVehicle, parentInspectionId: string | null): TireDraft {
  const now = new Date().toISOString();
  return {
    version: 1,
    clientSubmissionId: newSubmissionId(),
    vehicle,
    parentInspectionId,
    startedAt: now,
    updatedAt: now,
    readings: {},
    generalObservation: "",
    current: null,
    lastAttemptAt: null,
    editedAfterAttempt: false,
  };
}

// ---------------------------------------------------------------------------
// Leituras: normalização e validação de UX
// ---------------------------------------------------------------------------

/** Nº Fogo como o banco grava: maiúsculas, sem espaços, sem o ".0" de planilha. Nunca vira número. */
export function normalizeFire(value: string): string {
  return value.trim().toUpperCase().replace(/\s+/g, "").replace(/[.,]0+$/, "");
}

/** Enquanto digita: maiúsculas e sem espaços (o restante da regra é conferido na validação). */
export const typeFire = (value: string) => value.toUpperCase().replace(/\s+/g, "").slice(0, 30);

/** Enquanto digita um número: só dígitos, vírgula e ponto. */
export const typeDecimal = (value: string) => value.replace(/[^\d.,]/g, "").slice(0, 7);

/** "12,5" / "12.5" / "12" → número; vazio → null; qualquer outra coisa → NaN. */
export function parseDecimal(value: string): number | null {
  const s = value.replace(/\s/g, "");
  if (s === "") return null;
  if (!/^\d+([.,]\d+)?$/.test(s)) return Number.NaN;
  return Number(s.replace(",", "."));
}

export type ReadingState = "empty" | "partial" | "complete" | "invalid";

export interface ReadingCheck {
  state: ReadingState;
  /** Alguma leitura (Nº Fogo, sulco ou PSI) — o mesmo critério de "medida" do banco. */
  measured: boolean;
  /** Algo digitado, inclusive só a observação. */
  hasContent: boolean;
  errors: Partial<Record<ReadingField, string>>;
}

const fmtLimit = (n: number) => new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 }).format(n);

export function checkReading(reading: Reading | undefined, limits: TireAppContext["limits"]): ReadingCheck {
  const r = reading ?? emptyReading();
  const errors: Partial<Record<ReadingField, string>> = {};
  const fire = normalizeFire(r.fire);
  if (fire) {
    let pattern: RegExp | null = null;
    try {
      pattern = new RegExp(limits.fireNumberPattern);
    } catch {
      pattern = null;
    }
    if (pattern && !pattern.test(fire)) errors.fire = "Use letras, números e . / _ - (até 30 caracteres), começando por letra ou número.";
  }
  for (const f of TREAD_FIELDS) {
    const v = parseDecimal(r[f]);
    if (v === null) continue;
    if (Number.isNaN(v)) errors[f] = "Use só números (ex.: 12,5).";
    else if (v > limits.maxTreadMm) errors[f] = `Acima de ${fmtLimit(limits.maxTreadMm)} mm.`;
  }
  const psi = parseDecimal(r.psi);
  if (psi !== null) {
    if (Number.isNaN(psi)) errors.psi = "Use só números (ex.: 110).";
    else if (psi > limits.maxPsi) errors.psi = `Acima de ${fmtLimit(limits.maxPsi)} PSI.`;
  }
  if (r.obs.length > 500) errors.obs = "Até 500 caracteres.";

  const values = [r.fire, r.t1, r.t2, r.t3, r.t4, r.psi].map((v) => v.trim());
  const measured = values.some((v) => v !== "");
  const complete = values.every((v) => v !== "");
  const hasContent = measured || r.obs.trim() !== "";
  const state: ReadingState = Object.keys(errors).length > 0 ? "invalid" : complete ? "complete" : measured ? "partial" : "empty";
  return { state, measured, hasContent, errors };
}

export const draftHasContent = (draft: TireDraft) =>
  draft.generalObservation.trim() !== "" ||
  Object.values(draft.readings).some((r) => READING_FIELDS.some((f) => (r[f] ?? "").trim() !== ""));

export const measuredCount = (draft: TireDraft) =>
  Object.values(draft.readings).filter((r) => [r.fire, r.t1, r.t2, r.t3, r.t4, r.psi].some((v) => (v ?? "").trim() !== "")).length;

// ---------------------------------------------------------------------------
// Armazenamento (localStorage, sempre em try/catch)
// ---------------------------------------------------------------------------

const PREFIX = "hfm.tires.draft.";
const scopePrefix = (scope: string) => `${PREFIX}${scope || "anon"}.`;
const storageKey = (scope: string, vehicleId: string) => `${scopePrefix(scope)}${vehicleId}`;

function isReading(value: unknown): value is Reading {
  if (!value || typeof value !== "object") return false;
  const r = value as Record<string, unknown>;
  return READING_FIELDS.every((f) => typeof r[f] === "string");
}

function isDraft(value: unknown): value is TireDraft {
  if (!value || typeof value !== "object") return false;
  const d = value as Record<string, unknown>;
  const vehicle = d.vehicle as { id?: unknown; licensePlate?: unknown } | null | undefined;
  return (
    d.version === 1 &&
    typeof d.clientSubmissionId === "string" &&
    typeof d.startedAt === "string" &&
    !!vehicle &&
    typeof vehicle.id === "string" &&
    typeof vehicle.licensePlate === "string" &&
    !!d.readings &&
    typeof d.readings === "object" &&
    Object.values(d.readings as Record<string, unknown>).every(isReading) &&
    typeof d.generalObservation === "string"
  );
}

function parse(raw: string | null): TireDraft | null {
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    return isDraft(value) ? value : null;
  } catch {
    return null;
  }
}

export function readDraft(scope: string, vehicleId: string): TireDraft | null {
  if (typeof window === "undefined") return null;
  try {
    return parse(window.localStorage.getItem(storageKey(scope, vehicleId)));
  } catch {
    return null;
  }
}

const listeners = new Set<() => void>();
function notify() {
  for (const listener of listeners) listener();
}

export function saveDraft(scope: string, draft: TireDraft) {
  try {
    window.localStorage.setItem(storageKey(scope, draft.vehicle.id), JSON.stringify(draft));
  } catch {
    // Sem armazenamento local a vistoria continua: só perde a recuperação.
  }
  notify();
}

export function clearDraft(scope: string, vehicleId: string) {
  try {
    window.localStorage.removeItem(storageKey(scope, vehicleId));
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

const EMPTY: TireDraft[] = [];
/** Snapshot por pessoa: o mesmo conteúdo gravado devolve o mesmo array (exigência do useSyncExternalStore). */
const cache = new Map<string, { signature: string; value: TireDraft[] }>();

function readAll(scope: string): TireDraft[] {
  if (typeof window === "undefined") return EMPTY;
  const prefix = scopePrefix(scope);
  const previous = cache.get(prefix);
  const entries: [string, string][] = [];
  try {
    const storage = window.localStorage;
    for (let i = 0; i < storage.length; i += 1) {
      const key = storage.key(i);
      if (!key || !key.startsWith(prefix)) continue;
      const raw = storage.getItem(key);
      if (raw) entries.push([key, raw]);
    }
  } catch {
    return previous?.value ?? EMPTY;
  }
  entries.sort((a, b) => a[0].localeCompare(b[0]));
  const signature = entries.map(([k, v]) => `${k}\u0000${v}`).join("\u0001");
  if (previous && previous.signature === signature) return previous.value;
  const value = entries
    .map(([, raw]) => parse(raw))
    .filter((d): d is TireDraft => d !== null)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const stable = value.length ? value : EMPTY;
  cache.set(prefix, { signature, value: stable });
  return stable;
}

const getServerSnapshot = () => EMPTY;

/** Os rascunhos guardados para esta pessoa, do mais recente ao mais antigo (vazio no servidor). */
export function useStoredDrafts(scope: string): TireDraft[] {
  const getSnapshot = React.useCallback(() => readAll(scope), [scope]);
  return React.useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
