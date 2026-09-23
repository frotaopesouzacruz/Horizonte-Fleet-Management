import { notFound } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
import { AdherenceView, type AdherenceTab } from "@/app/(app)/checklist/aderencia/adherence-view";
import type { ChecklistContext } from "@/lib/adherence/queries";
import {
  COMPETENCE, COVERAGE, HEATMAP, HEATMAP_NEXT, HEATMAP_PREV, IMPORT_HISTORY, INSIGHTS, JOURNEY, LEADERS,
  MATRIX, MONTHLY, OPERATIONS, OPTIONS, REQUESTS, RETURN_TRACKING, SUMMARY, TODAY,
} from "./fixture";

/**
 * Renders the Aderência screen against fixed data.
 *
 * The real screen sits behind a session and an organisation, which makes it
 * impossible to look at from an environment that cannot reach Supabase. Same
 * gate as the design system: absent from a normal production build.
 *
 * The URL still drives tab, context and day, so the tests can exercise the
 * navigation; the numbers never change — they are the §68 example.
 */
export const metadata = { title: "Preview · Aderência", robots: { index: false, follow: false } };

export const dynamic = "force-dynamic";

const enabled =
  process.env.NODE_ENV !== "production" || process.env.NEXT_PUBLIC_ENABLE_DEV_PAGES === "1";

type SearchParams = Record<string, string | string[] | undefined>;
const first = (params: SearchParams, key: string): string | undefined => {
  const value = params[key];
  return Array.isArray(value) ? value[0] : value;
};
const TABS = ["consolidada", "heatmap", "matriz", "jornada", "expurgos", "solicitacoes", "governanca"];

export default async function PreviewPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  if (!enabled) notFound();
  const params = await searchParams;
  const tabParam = first(params, "aba");
  const tab = (TABS.includes(tabParam ?? "") ? tabParam : "consolidada") as AdherenceTab;
  const context: ChecklistContext = first(params, "contexto") === "retorno" ? "retorno" : "saida";
  const day = first(params, "dia") ?? TODAY;

  return (
    <AppShell permissions={["adherence.view", "adherence.request", "adherence.approve", "adherence.override", "adherence.reconcile", "adherence.manage_targets", "adherence.manage_rules", "adherence.view_audit"]}>
      <AdherenceView
        basePath="/dev/preview-aderencia"
        context={context}
        competence={COMPETENCE}
        today={TODAY}
        day={day}
        tab={tab}
        groupBy="operation"
        summary={SUMMARY}
        heatmap={HEATMAP}
        heatmapPrev={HEATMAP_PREV}
        heatmapNext={HEATMAP_NEXT}
        monthly={MONTHLY}
        dashboardYear={2026}
        insights={INSIGHTS}
        matrix={MATRIX}
        journey={JOURNEY}
        requests={REQUESTS}
        options={OPTIONS}
        operations={OPERATIONS}
        coverage={COVERAGE}
        leaders={LEADERS}
        branches={[{ id: "b1", name: "87 · Horizonte MG" }, { id: "b2", name: "124 · Horizonte Belém" }]}
        vehicleTypes={[{ id: "t-van", name: "Van" }, { id: "t-car", name: "Frota Leve ADM" }]}
        filters={{}}
        requestFilters={{}}
        returnTracking={RETURN_TRACKING}
        importHistory={IMPORT_HISTORY}
        perms={{ request: true, approve: true, override: true, bulk: true, reconcile: true, import: true, export: true, manageTargets: true, manageRules: true, viewAudit: true }}
      />
    </AppShell>
  );
}
