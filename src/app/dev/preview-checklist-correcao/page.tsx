import { notFound } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
import { PageContent, PageHeader } from "@/components/layout/page-header";
import { PreviewCorrecao } from "./preview-correcao";

export const metadata = {
  title: "Preview · Correção do Check List",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

const enabled =
  process.env.NODE_ENV !== "production" || process.env.NEXT_PUBLIC_ENABLE_DEV_PAGES === "1";

type SearchParams = Record<string, string | string[] | undefined>;

/**
 * Correção administrativa de checklist enviado (§60, §62) com dados fixos.
 *
 * O detalhe real depende de sessão, escopo e execução gravada. Esta rota
 * renderiza os mesmos componentes (lista do escopo, detalhe, correção) com a
 * rotina em memória do `fixture.ts`, que repete as recusas do banco. Mesmo
 * portão das outras prévias: fora de um build de produção normal.
 *
 * `?sem_permissao=1` mostra o detalhe de quem NÃO tem
 * `applications.checklist_fleet.correct`: nada editável.
 */
export default async function ChecklistCorrectionPreviewPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  if (!enabled) notFound();
  const params = await searchParams;
  const canCorrect = params.sem_permissao !== "1";

  return (
    <AppShell
      permissions={[
        "applications.view",
        "applications.checklist_fleet.view_own",
        "applications.checklist_fleet.view_details",
        ...(canCorrect ? ["applications.checklist_fleet.correct"] : []),
      ]}
    >
      <PageHeader
        title="Correção do Check List"
        description="Checklists enviados do escopo, com correção administrativa auditável sobre dados fixos."
      />
      <PageContent className="flex flex-col gap-4">
        <PreviewCorrecao canCorrect={canCorrect} />
      </PageContent>
    </AppShell>
  );
}
