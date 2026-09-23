import { Suspense } from "react";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
import { PageContent, PageHeader } from "@/components/layout/page-header";
import { PreviewAreas } from "./preview-areas";

/**
 * As quatro áreas da Central de Fidelização (Etapa 15) com dados fixos:
 * Dashboard de Estabilidade, Planner de Motoristas, Histórico de
 * Movimentações e Importação.
 *
 * A tela real fica atrás de sessão e organização, o que a torna impossível de
 * olhar num ambiente que não alcança o Supabase. Mesmo portão do design
 * system: ausente de um build de produção normal.
 *
 * Os componentes recebem callbacks (navegar, abrir a BR, substituir), e
 * callback não atravessa a fronteira servidor → cliente; por isso os dados e
 * os manipuladores vivem em `preview-areas.tsx`, e esta rota é só a casca.
 */
export const metadata = { title: "Preview · Central de Fidelização", robots: { index: false, follow: false } };

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
        title="Central de Fidelização"
        description="Dashboard de estabilidade, planner de motoristas, histórico de mobilizações e importação com dados fixos de Setembro/2026, para inspeção visual sem sessão."
      />
      <PageContent className="flex flex-col gap-10">
        <Suspense fallback={null}>
          <PreviewAreas />
        </Suspense>
      </PageContent>
    </AppShell>
  );
}
