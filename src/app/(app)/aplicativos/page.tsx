import type { Metadata } from "next";
import { LayoutGrid } from "lucide-react";
import { requireOrganization } from "@/lib/auth/session";
import { homeCapabilities } from "@/lib/home/resolver";
import { visibleApps } from "@/lib/portal/home-status";
import { getMyApps, settle } from "@/lib/portal/queries";
import { EmptyState } from "@/components/feedback/empty-state";
import { PageContent, PageHeader } from "@/components/layout/page-header";
import { AppGrid } from "@/app/(app)/inicio/app-grid";

export const metadata: Metadata = {
  title: "Aplicativos",
  description: "Os aplicativos de campo liberados para você.",
};

/**
 * Aplicativos — o índice dos apps de campo.
 *
 * Mostra só o que a pessoa pode executar E o que está habilitado para a
 * operação do seu vínculo (Gerenciador de Aplicativos). Se o catálogo não
 * carregar, vale a permissão sozinha e a tela diz isso: nunca um app a mais.
 */
export default async function ApplicationsIndexPage() {
  const { session, organization } = await requireOrganization("applications.view");
  const can = homeCapabilities({
    portal: session.portal.kind,
    permissions: session.permissions,
    isPlatformAdmin: session.isPlatformAdmin,
  });
  const catalog = await settle(getMyApps(organization.organizationId), "my_apps");
  const apps = visibleApps(catalog.ok ? catalog.data : null, can);

  return (
    <>
      <PageHeader
        eyebrow="Aplicativos"
        title="Aplicativos"
        description="Os aplicativos de campo liberados para você e para a sua operação."
      />
      <PageContent>
        <div className="flex w-full max-w-5xl flex-col gap-4" data-testid="aplicativos-indice">
          {!catalog.ok ? (
            <p className="text-body-sm text-fg-muted" role="status">
              Não foi possível conferir os aplicativos habilitados para a sua operação; mostrando pelos seus acessos.
            </p>
          ) : null}
          {apps.length === 0 ? (
            <EmptyState
              variant="panel"
              headingLevel={2}
              icon={<LayoutGrid />}
              title="Nenhum aplicativo liberado"
              description="Sua conta não tem aplicativos para executar, ou nenhum está habilitado para a sua operação. Fale com o seu gestor."
            />
          ) : (
            <AppGrid apps={apps} />
          )}
        </div>
      </PageContent>
    </>
  );
}
