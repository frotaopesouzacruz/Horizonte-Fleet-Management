"use server";

import { resolveOrganization } from "@/lib/auth/session";
import {
  getExecutionDetail, listScopeExecutions,
  type ExecutionDetail, type ScopeExecution, type ScopeFilters,
} from "./history-queries";

/**
 * Leituras sob demanda do histórico (§59, §60, §64).
 *
 * São disparadas por clique numa tela já aberta, então usam
 * `resolveOrganization` e devolvem um `Result`: um redirect no meio da lista
 * apagaria os filtros e deixaria a pessoa sem saber por quê.
 */

interface Result<T = undefined> {
  ok: boolean;
  error?: string;
  data?: T;
}

const SESSION_LOST =
  "Sua sessão expirou ou o acesso mudou. Recarregue a página e tente de novo.";

/**
 * Traduz o erro do banco para uma frase de operação.
 *
 * Mensagens já escritas pelas rotinas passam intactas; só os códigos crus do
 * Postgres viram texto aqui.
 */
function toMessage(error: { code?: string; message?: string }, fallback: string): string {
  const message = error.message ?? "";
  if (message && /^[A-ZÀ-Ý]/.test(message.trim())) return message;
  switch (error.code) {
    case "42501":
      return "Você não possui permissão para esta ação.";
    case "40001":
      return "Outra gravação aconteceu ao mesmo tempo. Tente de novo.";
    default:
      return fallback;
  }
}

/**
 * O detalhe de uma execução (§60).
 *
 * Pede só `applications.view`: a rotina serve tanto ao executor que abre o
 * próprio checklist (`view_own`) quanto à liderança que abre um do escopo
 * (`view_details`), e é a RLS do banco quem decide qual dos dois casos vale —
 * a action não repete a regra.
 */
export async function loadExecutionDetail(executionId: string): Promise<Result<ExecutionDetail | null>> {
  const context = await resolveOrganization("applications.view");
  if (!context) return { ok: false, error: SESSION_LOST };

  try {
    const detail = await getExecutionDetail(executionId);
    if (!detail) return { ok: false, error: "Checklist não encontrado no seu escopo." };
    return { ok: true, data: detail };
  } catch (error) {
    return {
      ok: false,
      error: toMessage(error instanceof Error ? error : {}, "Não foi possível carregar o checklist."),
    };
  }
}

/** O histórico do escopo com filtros (§64). */
export async function loadScopeExecutions(filters: ScopeFilters): Promise<Result<ScopeExecution[]>> {
  const context = await resolveOrganization("applications.checklist_fleet.view_details");
  if (!context) return { ok: false, error: SESSION_LOST };

  try {
    const rows = await listScopeExecutions(context.organization.organizationId, filters);
    return { ok: true, data: rows };
  } catch (error) {
    return {
      ok: false,
      error: toMessage(error instanceof Error ? error : {}, "Não foi possível carregar o histórico do escopo."),
    };
  }
}
