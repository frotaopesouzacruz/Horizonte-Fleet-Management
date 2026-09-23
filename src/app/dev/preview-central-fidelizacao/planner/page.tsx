import { notFound } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
import { PageContent, PageHeader } from "@/components/layout/page-header";
import { PreviewPlannerClient } from "./preview-planner-client";

/**
 * Renders the Planner de Frotas of the Central de Fidelização against fixed
 * data (Setembro/2026, "hoje" em 23/09/2026).
 *
 * The real screen sits behind a session and an organisation, which makes it
 * impossible to look at from an environment that cannot reach Supabase. Same
 * gate as the other previews: absent from a normal production build.
 *
 * Two switches in the URL show the states that depend on permissions:
 * `?sem_historico=1` (without `fidelization.manage_historical_data`) and
 * `?leitura=1` (view only, no editing).
 */
export const metadata = { title: "Preview · Planner de Frotas", robots: { index: false, follow: false } };

export const dynamic = "force-dynamic";

const enabled =
  process.env.NODE_ENV !== "production" || process.env.NEXT_PUBLIC_ENABLE_DEV_PAGES === "1";

type SearchParams = Record<string, string | string[] | undefined>;

export default async function PreviewPlannerPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  if (!enabled) notFound();
  const params = await searchParams;
  const readOnly = params.leitura === "1";
  const withoutHistorical = params.sem_historico === "1";

  return (
    <AppShell
      permissions={[
        "fidelization.view",
        "fidelization.plan",
        "fidelization.change_vehicle",
        "fidelization.change_driver",
        "fidelization.import",
        "fidelization.export",
        ...(withoutHistorical ? [] : ["fidelization.manage_historical_data"]),
      ]}
    >
      <PageHeader
        title="Planner de Frotas"
        description="Grid mensal de placas da Central de Fidelização com dados fixos, para inspeção visual sem sessão."
      />
      <PageContent className="flex flex-col gap-5">
        <PreviewPlannerClient canEdit={!readOnly} canManageHistorical={!withoutHistorical} />
      </PageContent>
    </AppShell>
  );
}
