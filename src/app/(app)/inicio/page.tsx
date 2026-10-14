import type { Metadata } from "next";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { requireOrganization } from "@/lib/auth/session";
import { MANAGEMENT_HOME } from "@/lib/auth/portal";
import { resolveHome } from "@/lib/home/resolver";
import { parseCompetence } from "@/lib/governance/competence";
import { competenceOf, mondayOf, operationalToday } from "@/lib/portal/clock";
import { getMySituation } from "@/lib/adherence/my-situation";
import { getLeadershipHome, getOperationalHome, settle } from "@/lib/portal/queries";
import { loadLeadershipBlocks } from "@/lib/portal/leadership-data";
import { OperationalHomeView } from "./operational-home";
import { LeadershipHomeView, type LeadershipMode, type LeadershipScope } from "./leadership-home";
import { LeadershipSecondary } from "./leadership-secondary-loader";
import { LeadershipSecondarySkeleton } from "./leadership-secondary";
import type { ObligationsSource } from "./checklist-calendar";

export const metadata: Metadata = {
  title: "Início",
  description: "O início de cada perfil: Meu resumo do Operacional e Portal da Liderança.",
};

type SearchParams = Record<string, string | string[] | undefined>;

const first = (params: SearchParams, key: string): string | undefined => {
  const value = params[key];
  return Array.isArray(value) ? value[0] : value;
};


/**
 * Início (pós-login).
 *
 * A casa sai do portal da conta, decidido no banco pelos perfis do vínculo
 * ativo (`current_user_portal`): o Operacional recebe o "Meu resumo", a
 * Liderança de Operações o "Portal da Liderança", e quem não tem portal segue
 * para o Dashboard de sempre. Cada leitura resolve a pessoa pela sessão.
 */
export default async function HomePage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams;
  const { session, organization } = await requireOrganization();
  const kind = session.portal.kind;
  if (kind === "management") redirect(MANAGEMENT_HOME);

  const today = operationalToday();
  // A casa e o que ela mostra saem de um lugar só: o portal (banco) e a matriz de permissões.
  const resolved = resolveHome({ portal: kind, permissions: session.permissions, isPlatformAdmin: session.isPlatformAdmin });

  if (kind === "operational") {
    const current = competenceOf(today);
    const competence = parseCompetence(first(params, "ano"), first(params, "mes"), current);
    const canSituation = resolved.can.ownSituation;

    const [home, situation] = await Promise.all([
      resolved.can.ownChecklists
        ? settle(getOperationalHome(organization.organizationId, competence), "my_operational_home")
        : Promise.resolve({ ok: false as const, error: "Seu perfil não consulta os próprios checklists." }),
      canSituation ? getMySituation(organization.organizationId, competence) : Promise.resolve(null),
    ]);

    const obligations: ObligationsSource = !situation
      ? { state: "no_permission" }
      : !situation.ok
        ? { state: "error", error: situation.error }
        : situation.data.state === "ok"
          ? { state: "ok", days: situation.data.days, summary: situation.data.summary?.total ?? null }
          : { state: situation.data.state };

    return (
      <OperationalHomeView
        displayName={session.displayName}
        home={home}
        obligations={obligations}
        competence={competence}
        currentCompetence={current}
        can={resolved.can}
        now={new Date().toISOString()}
      />
    );
  }

  // Liderança de Operações
  const home = await settle(getLeadershipHome(organization.organizationId), "my_leadership_home");
  const leaderId =
    home.ok && home.data.employee && home.data.scope.responsibilities.length > 0 ? home.data.employee.id : null;
  const scope: LeadershipScope = leaderId && first(params, "escopo") !== "operacoes" ? "leadership" : "operations";
  const mode: LeadershipMode = first(params, "modo") === "compacto" ? "compacto" : "padrao";
  const homeToday = home.ok ? home.data.today : today;
  const scopedLeader = scope === "leadership" ? leaderId : null;
  // Rotinas sem filtro de líder (frota, preditiva) recebem a operação quando o recorte é uma só.
  const operationId =
    scopedLeader && home.ok ? singleOperation(home.data.scope.responsibilities.map((r) => r.operationId)) : null;
  const blocks = await loadLeadershipBlocks(organization.organizationId, resolved.can, {
    today: homeToday,
    weekFrom: home.ok ? home.data.weekFrom : mondayOf(homeToday),
    leaderId: scopedLeader,
    operationId,
  });
  const query = scopedLeader ? `?lideranca=${scopedLeader}` : "";

  return (
    <LeadershipHomeView
      displayName={session.displayName}
      home={home}
      blocks={blocks}
      scope={scope}
      canToggleScope={Boolean(leaderId)}
      leaderId={leaderId}
      can={resolved.can}
      mode={mode}
      secondary={
        mode === "padrao" ? (
          <Suspense fallback={<LeadershipSecondarySkeleton />}>
            <LeadershipSecondary
              organizationId={organization.organizationId}
              can={resolved.can}
              leaderId={scopedLeader}
              operationId={operationId}
              today={homeToday}
              query={query}
            />
          </Suspense>
        ) : null
      }
    />
  );
}

/** A única operação de uma lista, ou null quando há mais de uma (ou nenhuma). */
function singleOperation(ids: (string | null)[]): string | null {
  const distinct = Array.from(new Set(ids.filter((id): id is string => Boolean(id))));
  return distinct.length === 1 ? distinct[0] : null;
}
