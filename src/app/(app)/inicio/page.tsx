import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { hasPermission, requireOrganization } from "@/lib/auth/session";
import { MANAGEMENT_HOME } from "@/lib/auth/portal";
import { parseCompetence, type Competence } from "@/lib/governance/competence";
import { getMySituation } from "@/lib/adherence/my-situation";
import { getLeadershipHome, getOperationalHome, settle } from "@/lib/portal/queries";
import { loadLeadershipBlocks } from "@/lib/portal/leadership-data";
import { OperationalHomeView } from "./operational-home";
import { LeadershipHomeView, type LeadershipScope } from "./leadership-home";
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

/** O dia operacional em São Paulo — o relógio do servidor, nunca o do navegador. */
function operationalToday(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
}

function competenceOf(iso: string): Competence {
  return { year: Number(iso.slice(0, 4)), month: Number(iso.slice(5, 7)) };
}

function mondayOf(iso: string): string {
  const d = new Date(`${iso}T12:00:00Z`);
  const offset = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - offset);
  return d.toISOString().slice(0, 10);
}

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

  const can = (permission: string) => hasPermission(session, permission);
  const today = operationalToday();

  if (kind === "operational") {
    const current = competenceOf(today);
    const competence = parseCompetence(first(params, "ano"), first(params, "mes"), current);
    const canSituation = can("adherence.view_own");

    const [home, situation] = await Promise.all([
      can("applications.checklist_fleet.view_own")
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
        can={{
          viewApps: can("applications.view"),
          viewOwnChecklists: can("applications.checklist_fleet.view_own"),
          viewReports: can("action_plans.view_own"),
          viewSituation: canSituation,
        }}
      />
    );
  }

  // Liderança de Operações
  const home = await settle(getLeadershipHome(organization.organizationId), "my_leadership_home");
  const leaderId =
    home.ok && home.data.employee && home.data.scope.responsibilities.length > 0 ? home.data.employee.id : null;
  const scope: LeadershipScope = leaderId && first(params, "escopo") !== "operacoes" ? "leadership" : "operations";
  const homeToday = home.ok ? home.data.today : today;
  const blocks = await loadLeadershipBlocks(organization.organizationId, can, {
    today: homeToday,
    weekFrom: home.ok ? home.data.weekFrom : mondayOf(homeToday),
    leaderId: scope === "leadership" ? leaderId : null,
  });

  return (
    <LeadershipHomeView
      displayName={session.displayName}
      home={home}
      blocks={blocks}
      scope={scope}
      canToggleScope={Boolean(leaderId)}
      leaderId={leaderId}
      permissions={session.permissions}
      isPlatformAdmin={session.isPlatformAdmin}
    />
  );
}
