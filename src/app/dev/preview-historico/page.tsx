import { notFound } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
import { PageContent, PageHeader } from "@/components/layout/page-header";
import { PreviewHistorico } from "./preview-historico";

export const metadata = {
  title: "Preview · Histórico do Check List",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

const enabled =
  process.env.NODE_ENV !== "production" || process.env.NEXT_PUBLIC_ENABLE_DEV_PAGES === "1";

/**
 * O histórico do escopo e o detalhe da execução (§60, §64) com dados fixos.
 *
 * A tela real depende de sessão, escopo e execuções gravadas — nada disso
 * existe num ambiente sem Supabase. Esta rota renderiza os mesmos componentes
 * com carregadores de amostra, que é o que permite provar num navegador de
 * verdade que o detalhe é só leitura e que a inconformidade invertida aparece
 * como tal.
 */
export default function HistoryPreviewPage() {
  if (!enabled) notFound();

  return (
    <AppShell
      permissions={[
        "applications.view",
        "applications.checklist_fleet.view_own",
        "applications.checklist_fleet.view_details",
      ]}
    >
      <PageHeader
        title="Histórico do Check List"
        description="Execuções do escopo com filtros e detalhe só leitura, sobre dados fixos."
      />
      <PageContent className="flex flex-col gap-4">
        <PreviewHistorico />
      </PageContent>
    </AppShell>
  );
}
