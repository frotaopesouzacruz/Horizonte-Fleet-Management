import type { Metadata } from "next";
import { hasPermission, requireOrganization } from "@/lib/auth/session";
import { parseCompetence, type Competence } from "@/lib/governance/competence";
import { getMySituation } from "@/lib/adherence/my-situation";
import { MySituationView } from "./my-situation-view";

export const metadata: Metadata = {
  title: "Minha situação · Aderência",
  description:
    "Sua aderência aos checklists obrigatórios: saídas e retornos da BR em que você é motorista fidelizado e os checklists que você enviou.",
};

type SearchParams = Record<string, string | string[] | undefined>;

const first = (params: SearchParams, key: string): string | undefined => {
  const value = params[key];
  return Array.isArray(value) ? value[0] : value;
};

/** Competência do dia operacional em São Paulo (§5) — o relógio do servidor, nunca o do navegador. */
function operationalCompetence(): Competence {
  const iso = new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
  return { year: Number(iso.slice(0, 4)), month: Number(iso.slice(5, 7)) };
}

/**
 * Gestão de Checklist → Aderência → Minha situação (§63).
 *
 * Entrada por `adherence.view_own`, independente de `adherence.view`: o perfil
 * Operacional consulta a própria situação sem enxergar a operação. A rotina do
 * banco confere a permissão de novo e resolve a pessoa pela sessão — a URL só
 * carrega a competência.
 */
export default async function MySituationPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams;
  const { session, organization } = await requireOrganization("adherence.view_own");
  const current = operationalCompetence();
  const competence = parseCompetence(first(params, "ano"), first(params, "mes"), current);
  const result = await getMySituation(organization.organizationId, competence);

  return (
    <MySituationView
      competence={competence}
      currentCompetence={current}
      result={result}
      operationViewHref={hasPermission(session, "adherence.view") ? "/checklist/aderencia" : null}
    />
  );
}
