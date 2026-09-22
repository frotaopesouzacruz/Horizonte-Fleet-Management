import { notFound } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
import { BrsView } from "@/app/(app)/governanca/brs/brs-view";
import { COVERAGE, INDICATORS, LEADERS, OPERATIONS, PAGE } from "./fixture";

/**
 * Renders Governança Operacional → BRs against fixed data.
 *
 * The real route sits behind a session and an organisation, which makes it
 * impossible to look at from an environment that cannot reach Supabase. Same
 * gate as the design system: absent from a normal production build.
 *
 * The view only navigates (router.push on the current pathname) and calls
 * server actions on clicks, so it renders without a session; the detail
 * drawer answers those clicks with an error alert instead of a crash.
 */
export const metadata = { title: "Preview · BRs", robots: { index: false, follow: false } };

export const dynamic = "force-dynamic";

const enabled =
  process.env.NODE_ENV !== "production" || process.env.NEXT_PUBLIC_ENABLE_DEV_PAGES === "1";

const PERMISSIONS = [
  "fidelization.view",
  "fidelization.manage_brs",
  "fidelization.import",
  "fidelization.export",
  "fidelization.plan",
];

export default function PreviewPage() {
  if (!enabled) notFound();

  return (
    <AppShell permissions={PERMISSIONS}>
      <BrsView
        page={PAGE}
        indicators={INDICATORS}
        competence={{ year: 2026, month: 9 }}
        operations={OPERATIONS}
        coverage={COVERAGE}
        leaders={LEADERS}
        filters={{}}
        sort="code"
        dir="asc"
        pageNumber={1}
        canManageBrs
        canImport
        canExport
        canPlan
        canAudit={false}
      />
    </AppShell>
  );
}
