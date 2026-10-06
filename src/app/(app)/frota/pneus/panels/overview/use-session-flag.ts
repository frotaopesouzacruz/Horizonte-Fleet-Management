"use client";

import * as React from "react";

/**
 * Preferência de exibição guardada só nesta sessão do navegador (seção
 * recolhida/expandida). O armazenamento pode faltar ou recusar (janela
 * privada, bloqueio de dados do site): a memória da página cobre a falha e a
 * tela funciona igual. O servidor sempre desenha o padrão.
 */
const EVENT = "hfm:tires-session-flag";
const memory = new Map<string, string>();

function read(key: string): string | null {
  try {
    const v = window.sessionStorage.getItem(key);
    if (v != null) return v;
  } catch {
    // sem acesso ao armazenamento: segue com a memória da página
  }
  return memory.get(key) ?? null;
}

function write(key: string, value: string) {
  memory.set(key, value);
  try {
    window.sessionStorage.setItem(key, value);
  } catch {
    // idem: a memória da página já guardou
  }
  window.dispatchEvent(new Event(EVENT));
}

function subscribe(callback: () => void) {
  window.addEventListener(EVENT, callback);
  window.addEventListener("storage", callback);
  return () => {
    window.removeEventListener(EVENT, callback);
    window.removeEventListener("storage", callback);
  };
}

export function useSessionFlag(key: string, fallback: boolean): [boolean, (value: boolean) => void] {
  const value = React.useSyncExternalStore(
    subscribe,
    () => {
      const v = read(key);
      return v == null ? fallback : v === "1";
    },
    () => fallback,
  );
  const set = React.useCallback((next: boolean) => write(key, next ? "1" : "0"), [key]);
  return [value, set];
}
