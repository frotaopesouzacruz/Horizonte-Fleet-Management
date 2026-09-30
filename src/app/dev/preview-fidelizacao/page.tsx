import { notFound } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
import { PageContent, PageHeader } from "@/components/layout/page-header";
import { PreviewImport } from "./preview-import";
import { PreviewAssignment } from "./preview-assignment";
import { PreviewStability } from "./preview-stability";

/**
 * Renders the Dashboard de Estabilidade and the fidelization import and
 * assignment drawers against fixed data.
 *
 * The real screen sits behind a session and an organisation, which makes it
 * impossible to look at from an environment that cannot reach Supabase. Same
 * gate as the design system: absent from a normal production build. The
 * Planner de Locais e BRs that used to open this page left the Central de
 * Fidelização — the position belongs to the BRs module (`/dev/preview-brs`).
 */
export const metadata = { title: "Preview · Fidelização", robots: { index: false, follow: false } };

export const dynamic = "force-dynamic";

const enabled =
  process.env.NODE_ENV !== "production" || process.env.NEXT_PUBLIC_ENABLE_DEV_PAGES === "1";

export default function PreviewPage() {
  if (!enabled) notFound();

  return (
    <AppShell
      permissions={[
        "fidelization.view",
        "fidelization.plan",
        "fidelization.change_vehicle",
        "fidelization.change_driver",
        "fidelization.import",
        "fidelization.export",
      ]}
    >
      <PageHeader
        title="Fidelização"
        description="Dashboard de Estabilidade, importação e vínculo com dados fixos, para inspeção visual sem sessão."
        secondaryActions={
          <>
            <PreviewImport />
            <PreviewImport withMapping />
            <PreviewAssignment />
          </>
        }
      />
      <PageContent className="flex flex-col gap-5">
        <PreviewStability />
      </PageContent>
    </AppShell>
  );
}
