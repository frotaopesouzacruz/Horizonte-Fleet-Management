import { notFound } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
import { PreviewFiliais } from "./preview-client";

/**
 * Estrutura → Filiais com dados fixos: importação com prévia e diferenças,
 * exportação e centros de custo, para inspeção sem sessão.
 *
 * A rota real depende de sessão e organização, o que a torna impossível de
 * abrir num ambiente que não alcança o Supabase. Mesmo portão do design
 * system: ausente de um build de produção normal.
 *
 * `?perfil=leitura` mostra a tela para quem só tem `branches.view`;
 * `?centros=vazio` mostra a organização sem nenhum centro de custo.
 */
export const metadata = { title: "Preview · Filiais", robots: { index: false, follow: false } };

export const dynamic = "force-dynamic";

const enabled =
  process.env.NODE_ENV !== "production" || process.env.NEXT_PUBLIC_ENABLE_DEV_PAGES === "1";

type SearchParams = Record<string, string | string[] | undefined>;

export default async function PreviewPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  if (!enabled) notFound();
  const params = await searchParams;
  const profile = params.perfil === "leitura" ? "leitura" : "admin";
  const costCenters = params.centros === "vazio" ? "vazio" : "fixture";

  const permissions =
    profile === "leitura"
      ? ["branches.view", "branches.update", "cost_centers.view"]
      : [
          "branches.view", "branches.create", "branches.update", "branches.deactivate",
          "branches.manage_operations", "branches.import", "branches.export",
          "cost_centers.view", "cost_centers.manage",
        ];

  return (
    <AppShell permissions={permissions}>
      <PreviewFiliais profile={profile} costCenters={costCenters} />
    </AppShell>
  );
}
