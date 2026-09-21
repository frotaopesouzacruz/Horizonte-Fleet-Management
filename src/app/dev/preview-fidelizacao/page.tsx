import { notFound } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
import { PageContent, PageHeader } from "@/components/layout/page-header";
import { PreviewPlanner } from "./preview-planner";

/**
 * Renders the Planner de Locais e BRs against fixed data.
 *
 * The real screen sits behind a session and an organisation, which makes it
 * impossible to look at from an environment that cannot reach Supabase. Same
 * gate as the design system: absent from a normal production build.
 *
 * The fixture is shaped like the real base on purpose — one position that
 * changed plates, one without a vehicle, one whose leader comes from the city
 * and one from a BR-level exception — because those are the four states the
 * screen has to tell apart.
 */
export const metadata = { title: "Preview · Fidelização", robots: { index: false, follow: false } };

export const dynamic = "force-dynamic";

const enabled =
  process.env.NODE_ENV !== "production" || process.env.NEXT_PUBLIC_ENABLE_DEV_PAGES === "1";

export default function PreviewPage() {
  if (!enabled) notFound();

  return (
    <AppShell permissions={["fidelization.view", "fidelization.manage_brs", "fidelization.plan"]}>
      <PageHeader
        title="Fidelização"
        description="Planner de Locais e BRs com dados fixos, para inspeção visual sem sessão."
      />
      <PageContent>
        <PreviewPlanner />
      </PageContent>
    </AppShell>
  );
}
