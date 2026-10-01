import { Suspense } from "react";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
import { PageContent, PageHeader } from "@/components/layout/page-header";
import { PreviewCompetencia } from "./preview-competencia";

/**
 * Competência mensal contínua (Frota × BR × Local) com dados fixos: a faixa da
 * competência em cada situação, o diálogo "Replicar competência" (destino já
 * criado e destino novo) e o histórico consolidado de 2024 (sem BR) e 2025
 * (com BR).
 *
 * O diálogo recebe a rotina por parâmetro; aqui ela devolve a prévia da
 * fixture — callback não atravessa a fronteira servidor → cliente, por isso os
 * dados e os manipuladores vivem em `preview-competencia.tsx`. Mesmo portão
 * das outras prévias: ausente de um build de produção normal.
 */
export const metadata = {
  title: "Preview · Competência da fidelização",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

const enabled =
  process.env.NODE_ENV !== "production" || process.env.NEXT_PUBLIC_ENABLE_DEV_PAGES === "1";

export default function PreviewCompetenciaPage() {
  if (!enabled) notFound();
  return (
    <AppShell permissions={["fidelization.view", "fidelization.plan", "fidelization.change_driver"]}>
      <PageHeader
        eyebrow="Governança operacional"
        title="Competência da fidelização"
        description="Faixa da competência, replicação mensal (origem → destino) e histórico consolidado 2024/2025, com dados fixos para inspeção sem sessão."
      />
      <PageContent className="flex flex-col gap-10">
        <Suspense fallback={null}>
          <PreviewCompetencia />
        </Suspense>
      </PageContent>
    </AppShell>
  );
}
