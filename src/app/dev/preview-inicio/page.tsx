import { notFound } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
import { parseCompetence } from "@/lib/governance/competence";
import { homeCapabilities } from "@/lib/home/resolver";
import { LeadershipHomeView, type LeadershipMode, type LeadershipScope } from "@/app/(app)/inicio/leadership-home";
import { LeadershipSecondaryBlocks } from "@/app/(app)/inicio/leadership-secondary";
import {
  COMPETENCE, LEADERSHIP_PERMISSIONS, LEADERSHIP_SCENARIOS, OPERATIONAL_PERMISSIONS, OPERATIONAL_SCENARIOS, PREVIEW_NOW,
  leadershipFixture, leadershipSecondaryFixture, operationalFixture, type LeadershipScenario, type OperationalScenario,
} from "./fixture";
import { PreviewOperationalHome } from "./preview-client";

/**
 * O Início (pós-login) com dados fixos: `perfil=operacional|lideranca`,
 * `cenario=…` e, no Operacional, `ano`/`mes` como na rota real.
 *
 * A tela real depende de sessão, vínculo e das rotinas do banco; aqui o shell
 * recebe o portal e as permissões oficiais do perfil (as da produção), então
 * o menu é exatamente o que a pessoa veria. Mesmo portão do design system:
 * ausente de um build normal de produção.
 */
export const metadata = { title: "Preview · Início", robots: { index: false, follow: false } };

export const dynamic = "force-dynamic";

const enabled =
  process.env.NODE_ENV !== "production" || process.env.NEXT_PUBLIC_ENABLE_DEV_PAGES === "1";

type SearchParams = Record<string, string | string[] | undefined>;
const first = (params: SearchParams, key: string): string | undefined => {
  const value = params[key];
  return Array.isArray(value) ? value[0] : value;
};

const BASE = "/dev/preview-inicio";

export default async function PreviewHomePage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  if (!enabled) notFound();
  const params = await searchParams;
  const profile = first(params, "perfil") === "lideranca" ? "lideranca" : "operacional";
  const scenarioParam = first(params, "cenario");

  if (profile === "operacional") {
    const scenario = (OPERATIONAL_SCENARIOS.includes(scenarioParam as OperationalScenario) ? scenarioParam : "completo") as OperationalScenario;
    const competence = parseCompetence(first(params, "ano"), first(params, "mes"), COMPETENCE);
    const { home, obligations } = operationalFixture(scenario, competence);
    return (
      <AppShell
        portal="operational"
        permissions={OPERATIONAL_PERMISSIONS}
        topbar={{ userName: "Carlos Eduardo Nogueira Silva", userEmail: "Matrícula 140349 · Operacional", organizationName: "Horizonte Logística" }}
      >
        <PreviewOperationalHome
          displayName="Carlos Eduardo Nogueira Silva"
          home={home}
          obligations={obligations}
          competence={competence}
          currentCompetence={COMPETENCE}
          can={homeCapabilities({ portal: "operational", permissions: OPERATIONAL_PERMISSIONS })}
          now={PREVIEW_NOW}
          basePath={`${BASE}?perfil=operacional&cenario=${scenario}`}
        />
      </AppShell>
    );
  }

  const scenario = (LEADERSHIP_SCENARIOS.includes(scenarioParam as LeadershipScenario) ? scenarioParam : "completo") as LeadershipScenario;
  const { home, blocks, leaderId } = leadershipFixture(scenario);
  const scope: LeadershipScope = leaderId && first(params, "escopo") !== "operacoes" ? "leadership" : "operations";
  const mode: LeadershipMode = first(params, "modo") === "compacto" ? "compacto" : "padrao";
  const query = scope === "leadership" && leaderId ? `?lideranca=${leaderId}` : "";
  return (
    <AppShell
      portal="leadership"
      permissions={LEADERSHIP_PERMISSIONS}
      topbar={{ userName: "Juliana Ferreira Costa", userEmail: "Matrícula 120788 · Liderança de Operações", organizationName: "Horizonte Logística" }}
    >
      <LeadershipHomeView
        displayName="Juliana Ferreira Costa"
        home={home}
        blocks={blocks}
        scope={scope}
        canToggleScope={Boolean(leaderId)}
        leaderId={leaderId}
        can={homeCapabilities({ portal: "leadership", permissions: LEADERSHIP_PERMISSIONS })}
        mode={mode}
        secondary={mode === "padrao" ? <LeadershipSecondaryBlocks data={leadershipSecondaryFixture(scenario)} query={query} /> : null}
        basePath={`${BASE}?perfil=lideranca&cenario=${scenario}`}
      />
    </AppShell>
  );
}
