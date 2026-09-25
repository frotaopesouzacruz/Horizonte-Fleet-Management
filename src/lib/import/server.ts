import "server-only";

import type { StepResult } from "./client";

/**
 * O lado do servidor das importações em partes: a tradução de um erro do
 * banco para quem está na tela. O tempo esgotado de uma chamada (57014) não é
 * um erro do arquivo — a parte era grande demais para aquele momento — e volta
 * marcado para ser repetido em partes menores.
 */
export function stepError<T>(
  error: { code?: string; message?: string },
  toMessage: (error: { code?: string; message?: string }) => string,
): StepResult<T> {
  if (error.code === "57014") {
    return { ok: false, retry: true, error: "O banco demorou além do limite para esta parte; ela será reenviada menor." };
  }
  return { ok: false, error: toMessage(error) };
}

/** Uma parte do protocolo que só pode avançar: limite inteiro entre 1 e 5.000. */
export function clampLimit(limit: number): number {
  return Math.min(5000, Math.max(1, Math.floor(Number.isFinite(limit) ? limit : 200)));
}
