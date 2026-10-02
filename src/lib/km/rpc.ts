import "server-only";

import { createClient } from "@/lib/supabase/server";
import { camelize } from "@/lib/maintenance/types";

/**
 * Chamada às rotinas `km_*` sob o cliente da própria pessoa (RLS, escopo e
 * permissão decididos no banco). Devolve o JSON já em camelCase.
 */
type Rpc = (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>;

export async function kmRpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const supabase = await createClient();
  const { data, error } = await (supabase.rpc as unknown as Rpc)(fn, args);
  if (error) throw new Error(`${fn}: ${error.message}`);
  return camelize<T>(data);
}

/** O mesmo, sem converter as chaves (para quem repassa o JSON ao banco). */
export async function kmRpcRaw<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const supabase = await createClient();
  const { data, error } = await (supabase.rpc as unknown as Rpc)(fn, args);
  if (error) throw new Error(`${fn}: ${error.message}`);
  return data as T;
}
