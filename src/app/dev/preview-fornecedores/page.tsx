import { notFound } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
import { SuppliersView } from "@/app/(app)/administracao/fornecedores/suppliers-view";
import { PERMISSION_CODES } from "@/app/(app)/frota/manutencao/shared";
import { firstParam, type SearchParamsLike } from "@/lib/maintenance/url";
import { CATALOG, OPTIONS } from "../preview-manutencao/fixture";

/**
 * Renderiza Administração › Fornecedores contra dados fixos.
 *
 * A tela real fica atrás de sessão e organização; esta prévia permite olhar
 * (e testar no Playwright) o cadastro em light/dark e em qualquer largura.
 * Mesmo portão das demais prévias: ausente de um build de produção normal.
 * Os fornecedores são os da prévia da Manutenção — é o mesmo cadastro.
 *
 * `?perfil=leitura` renderiza só com `maintenance.view` (somente leitura).
 */
export const metadata = {
  title: "Preview · Fornecedores",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

const enabled =
  process.env.NODE_ENV !== "production" ||
  process.env.NEXT_PUBLIC_ENABLE_DEV_PAGES === "1";

export default async function PreviewPage({
  searchParams,
}: {
  searchParams: Promise<SearchParamsLike>;
}) {
  if (!enabled) notFound();
  const params = await searchParams;
  const readOnly = firstParam(params, "perfil") === "leitura";
  const granted = readOnly ? ["maintenance.view"] : Object.values(PERMISSION_CODES);

  return (
    <AppShell permissions={granted}>
      <SuppliersView
        catalog={CATALOG}
        options={OPTIONS}
        canManage={granted.includes("maintenance.manage_suppliers")}
        canImport={granted.includes("maintenance.import")}
      />
    </AppShell>
  );
}
