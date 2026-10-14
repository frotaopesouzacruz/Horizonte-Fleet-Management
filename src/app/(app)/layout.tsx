import { AppShell } from "@/components/layout/app-shell";
import { requireSession, type SessionContext } from "@/lib/auth/session";
import { signOut, switchOrganization } from "@/lib/auth/actions";
import { LOGIN_DOMAIN } from "@/lib/auth/login-identity";
import { PORTAL_KIND_LABEL } from "@/lib/auth/portal";
import { loadMyNotifications } from "@/lib/home/notifications";

/**
 * A linha da conta no cabeçalho. Quem entra por matrícula tem um "e-mail"
 * técnico (`…@horizonte-logistica.invalid`) que não é contato de ninguém e
 * não se mostra: no lugar dele vai a matrícula — e, nos portais, o perfil.
 */
function accountLine(session: SessionContext): string | undefined {
  const technical = session.email?.toLowerCase().endsWith(`@${LOGIN_DOMAIN}`) ?? false;
  const code = session.portal.employeeCode;
  const identity = code ? `Matrícula ${code}` : technical ? undefined : (session.email ?? undefined);
  if (session.portal.kind === "management") return identity;
  const profile = PORTAL_KIND_LABEL[session.portal.kind];
  return identity ? `${identity} · ${profile}` : profile;
}

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
      portal={session.portal.kind}
      topbar={{
        userName: session.displayName,
        userEmail: accountLine(session),
        organizationName: session.activeOrganization?.organizationName ?? "Sem organização",
        organizations: session.memberships.map((m) => ({ id: m.organizationId, name: m.organizationName })),
        activeOrganizationId: session.activeOrganization?.organizationId,
        unitName: "Todas as unidades",
        onSignOut: signOut,
        onSwitchOrganization: switchOrganization,
        profileHref: "/perfil",
        loadNotifications: loadMyNotifications,
      }}
    >
      {children}
    </AppShell>
  );
}
