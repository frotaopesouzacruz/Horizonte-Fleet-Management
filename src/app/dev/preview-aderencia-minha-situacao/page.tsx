import { notFound } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
import { MySituationView } from "@/app/(app)/checklist/aderencia/minha-situacao/my-situation-view";
import { parseCompetence } from "@/lib/governance/competence";
import { COMPETENCE, SCENARIOS, loadPreviewSituation, type PreviewScenario } from "./fixture";

/**
 * Renders "Minha situação" against fixed data.
 *
 * The real screen sits behind a session and an organisation, which makes it
 * impossible to look at from an environment that cannot reach Supabase. Same
 * gate as the design system: absent from a normal production build.
 *
 * The shell gets only `adherence.view_own` — the Operacional profile as the
 * matrix ships it — so the sidebar shows "Minha situação" and hides the
 * operation-wide Aderência. `cenario` picks the state; `ano`/`mes` drive the
 * competence exactly as on the real route, through an injected loader with the
 * same contract as the server one.
 */
export const metadata = { title: "Preview · Minha situação", robots: { index: false, follow: false } };

export const dynamic = "force-dynamic";

const enabled =
  process.env.NODE_ENV !== "production" || process.env.NEXT_PUBLIC_ENABLE_DEV_PAGES === "1";

type SearchParams = Record<string, string | string[] | undefined>;
const first = (params: SearchParams, key: string): string | undefined => {
  const value = params[key];
  return Array.isArray(value) ? value[0] : value;
};

export default async function PreviewPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  if (!enabled) notFound();
  const params = await searchParams;
  const scenarioParam = first(params, "cenario");
  const scenario = (SCENARIOS.includes(scenarioParam as PreviewScenario) ? scenarioParam : "situacao") as PreviewScenario;
  const competence = parseCompetence(first(params, "ano"), first(params, "mes"), COMPETENCE);
  const result = await loadPreviewSituation(scenario, competence);

  return (
    <AppShell permissions={["adherence.view_own"]}>
      <MySituationView
        basePath="/dev/preview-aderencia-minha-situacao"
        competence={competence}
        currentCompetence={COMPETENCE}
        result={result}
        operationViewHref={first(params, "operacao") === "1" ? "/dev/preview-aderencia" : null}
      />
    </AppShell>
  );
}
