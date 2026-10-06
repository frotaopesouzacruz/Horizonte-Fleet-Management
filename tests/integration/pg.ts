import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { SyncRpc } from "../../src/lib/tires/sync/engine";

/**
 * Acesso ao banco LOCAL de teste por `psql` (socket local). Cada chamada é uma
 * transação própria, como no PostgREST. Nunca use contra produção.
 */
const HOST = process.env.HFM_TEST_PG_HOST ?? "/tmp";
const PORT = process.env.HFM_TEST_PG_PORT ?? "54329";
const USER = process.env.HFM_TEST_PG_USER ?? "postgres";

export function psql(db: string, sql: string): string {
  return execFileSync("psql", ["-h", HOST, "-p", PORT, "-U", USER, "-d", db, "-v", "ON_ERROR_STOP=1", "-Atq", "-f", "-"], {
    input: sql,
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
  }).trim();
}

export function cloneDatabase(template: string, name: string) {
  const base = ["-h", HOST, "-p", PORT, "-U", USER];
  execFileSync("dropdb", [...base, "--if-exists", name]);
  execFileSync("createdb", [...base, "-T", template, name]);
  psql(name, readFileSync(join(__dirname, "rpc-helper.sql"), "utf8"));
}

export function dropDatabase(name: string) {
  execFileSync("dropdb", ["-h", HOST, "-p", PORT, "-U", USER, "--if-exists", name]);
}

const TAG = "$hfmq$";
const quote = (s: string) => {
  if (s.includes(TAG)) throw new Error("conteúdo com o delimitador de teste");
  return `${TAG}${s}${TAG}`;
};

/** Cliente "RPC" com o mesmo contrato do supabase-js ({ data, error }). */
export function pgRpc(db: string, claims: Record<string, unknown>): SyncRpc {
  return async (fn, args) => {
    const out = psql(db, `select hfm_test.rpc(${quote(fn)}, ${quote(JSON.stringify(args))}::jsonb, ${quote(JSON.stringify(claims))}::jsonb);`);
    const r = JSON.parse(out) as { data?: unknown; error?: { code?: string; message?: string; hint?: string } };
    return { data: r.data ?? null, error: r.error ?? null };
  };
}

export const jsonOf = <T>(db: string, sql: string): T => JSON.parse(psql(db, sql) || "null") as T;
