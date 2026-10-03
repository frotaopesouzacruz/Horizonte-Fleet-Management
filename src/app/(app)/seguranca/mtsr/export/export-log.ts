import "server-only";

import { createClient } from "@/lib/supabase/server";
import type { Json } from "@/types/database.types";

/**
 * Registro das exportações do MTSR (`log_mtsr_export`), no mesmo molde da
 * Gestão de KM: exportar é tirar dados do sistema, então o registro vai ANTES
 * do arquivo — se o registro falhar, o arquivo não sai. A rotina confere a
 * permissão `mtsr.export`, grava em `audit_logs` (entidade `mtsr_export`) e
 * emite o evento de domínio `EXPORTACAO` em `mtsr_events`.
 */
export type MtsrExportKind = "conformidade" | "vistorias" | "auditoria";
export type MtsrExportFormat = "xlsx" | "csv" | "pdf";

type RpcVoid = (fn: string, args: Record<string, unknown>) => Promise<{ error: { message: string } | null }>;

/** Devolve a mensagem de erro do banco, ou nulo quando o registro foi gravado. */
export async function logMtsrExport(
  organizationId: string,
  kind: MtsrExportKind,
  format: MtsrExportFormat,
  rowCount: number,
  filters: Record<string, Json>,
): Promise<string | null> {
  const supabase = await createClient();
  const { error } = await (supabase.rpc as unknown as RpcVoid)("log_mtsr_export", {
    p_organization_id: organizationId,
    p_kind: kind,
    p_format: format,
    p_row_count: rowCount,
    p_filters: filters,
  });
  return error ? error.message : null;
}
