import "server-only";

import { AsyncLocalStorage } from "node:async_hooks";
import { createClient } from "@/lib/supabase/server";
import { camelize } from "@/lib/maintenance/types";

/**
 * Chamada às rotinas `km_*` sob o cliente da própria pessoa (RLS, escopo e
 * permissão decididos no banco). Devolve o JSON já em camelCase.
 *
 * A prévia de desenvolvimento (`/dev/preview-km`) roda os mesmos carregadores
 * contra dados fixos: dentro de `kmFixtureStore.run(resolver, …)` a rotina é
 * respondida pelo resolver em vez do banco. Fora dela, nada muda.
 */
type Rpc = (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>;
export type KmFixtureResolver = (fn: string, args: Record<string, unknown>) => unknown;

export const kmFixtureStore = new AsyncLocalStorage<KmFixtureResolver>();
export const kmPreviewActive = () => kmFixtureStore.getStore() !== undefined;

async function call(fn: string, args: Record<string, unknown>): Promise<unknown> {
  const fixture = kmFixtureStore.getStore();
  if (fixture) {
    const data = fixture(fn, args);
    if (data instanceof Error) throw new Error(`${fn}: ${data.message}`);
    return data;
  }
  const supabase = await createClient();
  const { data, error } = await (supabase.rpc as unknown as Rpc)(fn, args);
  if (error) throw new Error(`${fn}: ${error.message}`);
  return data;
}

export async function kmRpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  return camelize<T>(await call(fn, args));
}

/** O mesmo, sem converter as chaves (para quem repassa o JSON ao banco). */
export async function kmRpcRaw<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  return (await call(fn, args)) as T;
}
