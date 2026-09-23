"use server";

import { resolveOrganization } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import type { Json } from "@/types/database.types";
import {
  toCorrectionForm, toCorrectionPayload, toCorrectionResult,
  type CorrectionForm, type CorrectionInput, type CorrectionResult,
} from "./correction-model";

/**
 * Correção administrativa de um checklist enviado (§60, §62).
 *
 * Duas actions, as duas atrás de `applications.checklist_fleet.correct`: o
 * formulário (o que pode ser corrigido, com a definição de cada campo
 * condicional) e a rotina — em prévia (`dryRun`) ou para valer. A permissão,
 * a organização, o escopo, o motivo e cada regra da resposta são conferidos de
 * novo no banco; a action só entrega o pedido e traduz a recusa.
 */

interface Result<T = undefined> {
  ok: boolean;
  error?: string;
  data?: T;
}

const PERMISSION = "applications.checklist_fleet.correct";

const SESSION_LOST =
  "Sua sessão expirou ou o acesso mudou. Recarregue a página e tente de novo.";

/** Mensagens das rotinas passam intactas; só códigos crus do Postgres viram texto aqui. */
function toMessage(error: { code?: string; message?: string }, fallback: string): string {
  const message = error.message ?? "";
  if (message && /^[A-ZÀ-Ý"]/.test(message.trim())) return message;
  switch (error.code) {
    case "42501":
      return "Você não possui permissão para esta ação.";
    case "40001":
      return "Outra gravação aconteceu ao mesmo tempo. Tente de novo.";
    case "22P02":
      return "Identificador inválido.";
    default:
      return fallback;
  }
}

/** O que pode ser corrigido nesta execução. */
export async function loadCorrectionForm(executionId: string): Promise<Result<CorrectionForm>> {
  const context = await resolveOrganization(PERMISSION);
  if (!context) return { ok: false, error: SESSION_LOST };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("checklist_execution_correction_form", {
    p_organization_id: context.organization.organizationId,
    p_execution_id: executionId,
  });
  if (error) return { ok: false, error: toMessage(error, "Não foi possível abrir a correção.") };
  return { ok: true, data: toCorrectionForm(data) };
}

/**
 * A correção: `dryRun` devolve o antes/depois e o resumo recalculado sem
 * gravar; sem ele, grava na mesma transação a resposta, o resumo e o registro.
 */
export async function runExecutionCorrection(input: CorrectionInput): Promise<Result<CorrectionResult>> {
  const context = await resolveOrganization(PERMISSION);
  if (!context) return { ok: false, error: SESSION_LOST };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("correct_checklist_execution", {
    p_organization_id: context.organization.organizationId,
    p_payload: toCorrectionPayload(input) as Json,
  });
  if (error) {
    return {
      ok: false,
      error: toMessage(error, input.dryRun ? "Não foi possível preparar a prévia." : "Não foi possível registrar a correção."),
    };
  }
  return { ok: true, data: toCorrectionResult(data) };
}
