import type { Metadata } from "next";
import { hasPermission, requireOrganization } from "@/lib/auth/session";
import { getMyReports } from "@/lib/action-plans/queries";
import { MyReportsView, type MyReportsResult } from "./my-reports-view";

export const metadata: Metadata = {
  title: "Meus apontamentos · Planos de Ação",
  description: "O andamento das inconformidades de manutenção que você apontou no Check List de Frota.",
};

/** Janela do retorno ao motorista (§65): o que ele apontou nos últimos 90 dias. */
const DAYS = 90;

function todayInSaoPaulo(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
}

/** A rotina levanta mensagens já escritas para quem opera; só o prefixo técnico sai. */
function friendlyError(error: unknown): string {
  const tail = error instanceof Error ? (error.message.split(": ").pop() ?? "") : "";
  return /^[A-ZÀ-Ý]/.test(tail.trim()) ? tail : "Tente novamente em instantes.";
}

/**
 * Gestão de Checklist → Planos de Ação → Meus apontamentos (§65).
 *
 * Entrada por `action_plans.view_own`, independente de `action_plans.view`: o
 * motorista acompanha o que ELE apontou sem enxergar o portal de planos. A
 * rotina do banco confere a permissão de novo e resolve a pessoa pela sessão
 * (colaborador da conta ou usuário que enviou o checklist) — a URL não carrega
 * ninguém. Só leitura: nenhuma tratativa nasce aqui.
 */
export default async function MyReportsPage() {
  const { session, organization } = await requireOrganization("action_plans.view_own");

  let result: MyReportsResult;
  try {
    result = { ok: true, data: await getMyReports(organization.organizationId, DAYS) };
  } catch (error) {
    console.error("planos-acao/meus-apontamentos", error instanceof Error ? error.message : error);
    result = { ok: false, error: friendlyError(error) };
  }

  return (
    <MyReportsView
      result={result}
      days={DAYS}
      today={todayInSaoPaulo()}
      portalHref={hasPermission(session, "action_plans.view") ? "/checklist/planos-acao" : null}
    />
  );
}
