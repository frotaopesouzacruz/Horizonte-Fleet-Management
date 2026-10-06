import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { createGraphClient, graphConfigFromEnv } from "./graph";
import { runTireSync, type SyncOutcome, type SyncRpc, type SyncTrigger } from "./engine";

/**
 * As duas portas da sincronização com a fonte oficial:
 *
 *   * pessoa (Sincronizar agora / Reprocessar): o cliente da própria pessoa —
 *     permissão `tires.import` conferida no banco, autoria nos registros;
 *   * agenda (Vercel Cron → /api/tires/sync): o cliente de serviço, só no
 *     servidor, autor "Sincronização automática (SharePoint)".
 *
 * As credenciais da Graph ficam nas variáveis do servidor e nunca saem dele.
 */
type AnyRpcClient = { rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }> };

export function rpcOf(client: unknown): SyncRpc {
  const c = client as AnyRpcClient;
  return async (fn, args) => {
    const { data, error } = await c.rpc(fn, args);
    return { data, error: (error as { code?: string; message?: string; hint?: string } | null) ?? null };
  };
}

export function graphFromEnv() {
  const config = graphConfigFromEnv();
  return config ? createGraphClient(config) : null;
}

export function runSyncAs(client: unknown, organizationId: string, trigger: SyncTrigger, reprocessOf: string | null = null) {
  return runTireSync({ rpc: rpcOf(client), organizationId, graph: graphFromEnv() }, trigger, reprocessOf);
}

/** Agenda: todas as organizações com a fonte oficial ativa. */
export async function runScheduledSyncs(): Promise<{ organizationId: string; outcome: SyncOutcome }[]> {
  const admin = createAdminClient();
  const { data, error } = await admin.from("tire_sync_sources" as never).select("organization_id").eq("is_active", true);
  if (error) throw new Error(`Não foi possível listar as fontes oficiais: ${error.message}`);
  const out: { organizationId: string; outcome: SyncOutcome }[] = [];
  for (const row of (data ?? []) as { organization_id: string }[]) {
    out.push({ organizationId: row.organization_id, outcome: await runSyncAs(admin, row.organization_id, "agendada") });
  }
  return out;
}
