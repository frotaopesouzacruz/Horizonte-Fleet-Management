import { notFound } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
import { PageContent, PageHeader } from "@/components/layout/page-header";
import { Card, CardContent } from "@/components/ui/card";

/**
 * Renders the shell chrome — Sidebar and Topbar — against a fixed permission
 * set.
 *
 * The real shell only exists behind a session, so light/dark, expanded/collapsed
 * and the mobile drawer could not be looked at without credentials. This gives
 * the UI suite something to screenshot and the accessibility suite something to
 * audit, with every module visible at once.
 *
 * Same gate as the other previews: absent from a normal production build.
 */
export const metadata = {
  title: "Preview · Navegação",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

const enabled =
  process.env.NODE_ENV !== "production" || process.env.NEXT_PUBLIC_ENABLE_DEV_PAGES === "1";

/** Every module the navigation knows, so nothing is hidden by RBAC here. */
const ALL_PERMISSIONS = [
  "users.view",
  "roles.view",
  "operations.view",
  "branches.view",
  "equipment_types.view",
  "leadership.view",
  "fidelization.view",
  "vehicles.view",
  "applications.view",
];

export default function NavigationPreviewPage() {
  if (!enabled) notFound();

  return (
    <AppShell
      permissions={ALL_PERMISSIONS}
      topbar={{ userName: "Preview", organizationName: "Horizonte Logística" }}
    >
      <PageHeader
        title="Navegação"
        description="Prévia do App Shell: Sidebar expandida e recolhida, grupos, estado ativo e Topbar."
      />
      <PageContent className="flex flex-col gap-4">
        <Card>
          <CardContent className="flex flex-col gap-2">
            <p className="text-body-sm text-fg-secondary">
              Quatro estruturas oficiais, na ordem: Administração, Estrutura operacional,
              Governança operacional e Gestão de frota. Módulos futuros ficam visivelmente
              separados no fim.
            </p>
            <p className="text-caption text-fg-muted">
              Recolha e expanda pelo controle no rodapé da Sidebar. Recolhida, ela mostra o
              símbolo oficial e cada ícone ganha tooltip.
            </p>
          </CardContent>
        </Card>
      </PageContent>
    </AppShell>
  );
}
