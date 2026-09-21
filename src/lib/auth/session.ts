import "server-only";

import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export const ACTIVE_ORG_COOKIE = "hfm.org";

export interface MembershipSummary {
  membershipId: string;
  organizationId: string;
  organizationName: string;
  organizationSlug: string;
  status: string;
}

export interface SessionContext {
  userId: string;
  email: string | null;
  fullName: string;
  displayName: string;
  memberships: MembershipSummary[];
  /** Null when the account exists but belongs to no active organization yet. */
  activeOrganization: MembershipSummary | null;
  permissions: string[];
  isPlatformAdmin: boolean;
}

/**
 * Everything the shell needs about the caller, resolved once per request.
 *
 * Tenancy is never taken from the user: the active organization has to be one
 * of the caller's own active memberships, and permissions come from the
 * database (RBAC), not from a role name or a client-supplied value.
 */
export const getSessionContext = cache(async (): Promise<SessionContext | null> => {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const [{ data: profile }, { data: memberships }, { data: platformAdmin }] = await Promise.all([
    supabase.from("profiles").select("full_name, display_name").eq("user_id", user.id).maybeSingle(),
    supabase
      .from("organization_memberships")
      .select("id, status, organization_id, organizations(name, slug)")
      .eq("user_id", user.id)
      .eq("status", "active"),
    supabase.from("platform_admins").select("user_id").eq("user_id", user.id).maybeSingle(),
  ]);

  const list: MembershipSummary[] = (memberships ?? [])
    .map((row) => ({
      membershipId: row.id,
      organizationId: row.organization_id,
      organizationName: row.organizations?.name ?? "Organização",
      organizationSlug: row.organizations?.slug ?? "",
      status: row.status,
    }))
    .sort((a, b) => a.organizationName.localeCompare(b.organizationName, "pt-BR"));

  const cookieStore = await cookies();
  const preferred = cookieStore.get(ACTIVE_ORG_COOKIE)?.value;
  const activeOrganization = list.find((m) => m.organizationId === preferred) ?? list[0] ?? null;

  let permissions: string[] = [];
  if (activeOrganization) {
    const { data } = await supabase.rpc("current_user_permissions", {
      p_organization_id: activeOrganization.organizationId,
    });
    permissions = (data as string[] | null) ?? [];
  }

  const fullName = profile?.full_name?.trim() || user.email?.split("@")[0] || "Usuário";

  return {
    userId: user.id,
    email: user.email ?? null,
    fullName,
    displayName: profile?.display_name?.trim() || fullName,
    memberships: list,
    activeOrganization,
    permissions,
    isPlatformAdmin: Boolean(platformAdmin),
  };
});

/** Session context or a redirect to the login screen. */
export async function requireSession(): Promise<SessionContext> {
  const session = await getSessionContext();
  if (!session) redirect("/login");
  return session;
}

/**
 * Session context plus a guaranteed active organization and, optionally, a
 * permission check. Hiding a menu entry is not security; this is the gate every
 * administrative page goes through, on top of RLS.
 */
export async function requireOrganization(permission?: string) {
  const session = await requireSession();
  if (!session.activeOrganization) redirect("/sem-organizacao");
  if (permission && !hasPermission(session, permission)) redirect("/sem-permissao");
  return { session, organization: session.activeOrganization };
}

/**
 * A mesma verificação de `requireOrganization`, sem redirecionar.
 *
 * `requireOrganization` responde com um redirect, que é o certo para uma
 * página: quem não pode entrar vai para o login ou para "sem permissão". Numa
 * ação de servidor chamada de dentro de uma tela já aberta, porém, o redirect
 * não vira erro — vira navegação. A pessoa perde o que estava preenchendo e a
 * tela "simplesmente para de funcionar", sem mensagem nenhuma.
 *
 * Leituras acionadas por clique usam esta aqui e devolvem um Result com o
 * motivo, que a interface já sabe mostrar.
 */
export async function resolveOrganization(permission?: string) {
  const session = await getSessionContext();
  if (!session?.activeOrganization) return null;
  if (permission && !hasPermission(session, permission)) return null;
  return { session, organization: session.activeOrganization };
}

export function hasPermission(session: SessionContext, permission: string) {
  return session.isPlatformAdmin || session.permissions.includes(permission);
}

export function hasAnyPermission(session: SessionContext, permissions: string[]) {
  return session.isPlatformAdmin || permissions.some((p) => session.permissions.includes(p));
}
