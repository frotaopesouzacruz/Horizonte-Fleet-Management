"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireOrganization } from "@/lib/auth/session";
import { getEffectiveAccess, type EffectiveAccess } from "@/lib/admin/access-profiles";
import type { Result } from "@/lib/admin/actions";

const PROFILES_PATH = "/administracao/perfis";
const USERS_PATH = "/administracao/usuarios";

/** Database errors are for engineers; the ones we raise ourselves are already for people. */
function toMessage(error: { message?: string; code?: string } | null, fallback: string): string {
  const message = error?.message ?? "";
  if (!message) return fallback;
  if (/^[A-ZÀ-Ú]/.test(message) && !message.includes("violates") && !message.includes("relation")) return message;
  if (error?.code === "42501") return "Você não possui permissão para esta ação.";
  return fallback;
}

/**
 * Rewrites the permission matrix of one profile.
 *
 * Every guard lives in the database and is repeated nowhere: only a holder of
 * `roles.manage` gets through, nobody grants a permission they do not hold
 * themselves, the Administrador profile cannot be reduced, and the three
 * permissions that administer access itself cannot leave it. The reason is
 * mandatory and lands in an append-only trail.
 */
export async function setProfilePermissions(
  roleId: string,
  permissionCodes: string[],
  reason: string,
): Promise<Result> {
  await requireOrganization("roles.manage");
  const supabase = await createClient();

  const { error } = await supabase.rpc("set_role_permissions", {
    p_role_id: roleId,
    p_permission_codes: permissionCodes,
    p_reason: reason,
  });
  if (error) return { ok: false, error: toMessage(error, "Não foi possível salvar a matriz de permissões.") };

  revalidatePath(PROFILES_PATH);
  revalidatePath(USERS_PATH);
  return { ok: true };
}

/** Back to the official default matrix of that profile. */
export async function restoreProfileDefaults(roleId: string, reason: string): Promise<Result> {
  await requireOrganization("roles.manage");
  const supabase = await createClient();

  const { error } = await supabase.rpc("restore_role_defaults", {
    p_role_id: roleId,
    p_reason: reason,
  });
  if (error) return { ok: false, error: toMessage(error, "Não foi possível restaurar o padrão do perfil.") };

  revalidatePath(PROFILES_PATH);
  revalidatePath(USERS_PATH);
  return { ok: true };
}

/**
 * Loads what one account can actually do, for the simulation panel.
 *
 * It describes the account and never becomes it: no session is touched, nothing
 * is executed on anybody's behalf. The database refuses to answer at all unless
 * the caller may see profiles in that account's organization.
 */
export async function loadEffectiveAccess(membershipId: string): Promise<Result<EffectiveAccess>> {
  await requireOrganization("roles.view");

  try {
    const access = await getEffectiveAccess(membershipId);
    if (!access) return { ok: false, error: "Conta não encontrada ou fora do seu alcance." };
    return { ok: true, data: access };
  } catch {
    return { ok: false, error: "Não foi possível carregar o acesso efetivo desta conta." };
  }
}
