import { AppShell } from "@/components/layout/app-shell";
import { requireSession } from "@/lib/auth/session";
import { signOut, switchOrganization } from "@/lib/auth/actions";

/**
 * Authenticated area. The middleware already redirects anonymous requests; this
 * re-checks server-side so a page is never rendered without a session, and
 * feeds the shell the real identity, organizations and permissions.
 */
export default async function AuthenticatedLayout({ children }: { children: React.ReactNode }) {
  const session = await requireSession();

  return (
    <AppShell
      permissions={session.permissions}
      isPlatformAdmin={session.isPlatformAdmin}
      topbar={{
        userName: session.displayName,
        userEmail: session.email ?? undefined,
        organizationName: session.activeOrganization?.organizationName ?? "Sem organização",
        organizations: session.memberships.map((m) => ({ id: m.organizationId, name: m.organizationName })),
        activeOrganizationId: session.activeOrganization?.organizationId,
        unitName: "Todas as unidades",
        onSignOut: signOut,
        onSwitchOrganization: switchOrganization,
      }}
    >
      {children}
    </AppShell>
  );
}
