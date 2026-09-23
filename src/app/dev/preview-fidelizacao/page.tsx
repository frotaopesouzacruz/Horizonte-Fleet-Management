import { notFound } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
import { PageContent, PageHeader } from "@/components/layout/page-header";
import { BrsModuleNotice } from "@/app/(app)/governanca/fidelizacao/brs-module-notice";
import { PreviewPlanner } from "./preview-planner";
import { PreviewImport } from "./preview-import";
import { PreviewAssignment } from "./preview-assignment";
import { PreviewStability } from "./preview-stability";

/**
 * Renders the Planner de Locais e BRs and the Dashboard de Estabilidade
 * against fixed data.
 *
 * The real screen sits behind a session and an organisation, which makes it
 * impossible to look at from an environment that cannot reach Supabase. Same
 * gate as the design system: absent from a normal production build.
 *
 * The fixture is shaped like the real base on purpose — one position that
 * changed plates, one without a vehicle, one whose leader comes from the city
 * and one from a BR-level exception — because those are the four states the
 * screen has to tell apart. The stability dashboard sits below the planner so
 * the planner keeps being the first table on the page, which is what the
 * existing specs address.
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
        description="Planner de Locais e BRs e Dashboard de Estabilidade com dados fixos, para inspeção visual sem sessão."
        secondaryActions={
          <>
            <PreviewImport />
            <PreviewImport withMapping />
            <PreviewAssignment />
          </>
        }
      />
      <PageContent className="flex flex-col gap-5">
        {/* §38: o mesmo aviso da aba "Planner de locais e BRs" da tela real. */}
        <BrsModuleNotice href="/governanca/brs" />
        <PreviewPlanner />
        <PreviewStability />
      </PageContent>
    </AppShell>
  );
}
