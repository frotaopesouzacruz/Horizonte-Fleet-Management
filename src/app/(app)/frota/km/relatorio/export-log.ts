import "server-only";

import { createClient } from "@/lib/supabase/server";
import type { Json } from "@/types/database.types";

/**
 * Registro das exportações do KM (`log_km_export`) e o carimbo de geração —
 * sem a biblioteca de planilhas, para a versão imprimível não carregá-la.
 */

/** "dd/mm/aaaa hh:mm" em São Paulo (para textos). */
export function stampText(iso: string | Date | null | undefined): string {
  if (!iso) return "—";
  const d = iso instanceof Date ? iso : new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
    .format(d)
    .replace(",", "");
}

type RpcVoid = (fn: string, args: Record<string, unknown>) => Promise<{ error: { message: string } | null }>;

/**
 * Exportar é tirar dados do sistema: o registro vai antes do arquivo. Se o
 * registro falhar, o arquivo não sai. Devolve a mensagem de erro, ou nulo.
 */
export async function logKmExport(
  organizationId: string,
  kind: "base" | "gerencial" | "qualidade" | "km_atual",
  format: "xlsx" | "csv" | "pdf",
  rowCount: number,
  filters: Record<string, Json>,
): Promise<string | null> {
  const supabase = await createClient();
  const { error } = await (supabase.rpc as unknown as RpcVoid)("log_km_export", {
    p_organization_id: organizationId,
    p_kind: kind,
    p_format: format,
    p_row_count: rowCount,
    p_filters: filters,
  });
  return error ? error.message : null;
}
