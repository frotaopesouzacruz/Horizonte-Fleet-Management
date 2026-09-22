import { notFound } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
import { PageContent, PageHeader } from "@/components/layout/page-header";
import { PreviewRunner } from "./preview-runner";

export const metadata = {
  title: "Preview · Check List de Frota",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

const enabled =
  process.env.NODE_ENV !== "production" || process.env.NEXT_PUBLIC_ENABLE_DEV_PAGES === "1";

/**
 * O executor do Check List de Frota com dados fixos.
 *
 * O aplicativo real depende de sessão, colaborador vinculado e versão
 * publicada — nada disso existe num ambiente sem Supabase. Esta rota renderiza
 * o mesmo componente com um formulário de amostra, que é o que permite testar
 * conformidade invertida, condicionais e ausência de anexo num navegador de
 * verdade.
 */
export default function ChecklistPreviewPage() {
  if (!enabled) notFound();

  return (
    <AppShell permissions={["applications.view", "applications.checklist_fleet.execute"]}>
      <PageHeader
        title="Check List de Frota"
        description="Executor com formulário fixo, para inspeção visual sem sessão."
      />
      <PageContent className="mx-auto flex w-full max-w-2xl flex-col gap-4">
        <PreviewRunner />
      </PageContent>
    </AppShell>
  );
}
