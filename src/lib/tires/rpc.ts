import "server-only";

import { AsyncLocalStorage } from "node:async_hooks";
import { createClient } from "@/lib/supabase/server";
import { camelize } from "@/lib/maintenance/types";

/**
 * Chamada às rotinas `tires_*` / `tire_*` sob o cliente da própria pessoa
 * (RLS, escopo e permissão decididos no banco). Devolve o JSON já em
 * camelCase.
 *
 * As prévias de desenvolvimento (`/dev/preview-pneus*`) rodam os mesmos
 * carregadores contra dados fixos: dentro de `tiresFixtureStore.run(resolver,
 * …)` a rotina é respondida pelo resolver em vez do banco.
 */
type Rpc = (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>;
export type TiresFixtureResolver = (fn: string, args: Record<string, unknown>) => unknown;

export const tiresFixtureStore = new AsyncLocalStorage<TiresFixtureResolver>();
export const tiresPreviewActive = () => tiresFixtureStore.getStore() !== undefined;

async function call(fn: string, args: Record<string, unknown>): Promise<unknown> {
  const fixture = tiresFixtureStore.getStore();
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

export async function tiresRpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  return camelize<T>(await call(fn, args));
}

/** O mesmo, sem converter as chaves (para quem repassa o JSON ao banco). */
export async function tiresRpcRaw<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  return (await call(fn, args)) as T;
}
