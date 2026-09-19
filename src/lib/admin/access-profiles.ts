import "server-only";

import { createClient } from "@/lib/supabase/server";

/**
 * Administração → Perfis e Permissões: the read side.
 *
 * Three things are called "perfil" around this product and only one of them
 * decides what somebody may do:
 *
 *   • o perfil organizacional (`business_profiles`) vem da base QLP e descreve
 *     o cargo da pessoa na empresa;
 *   • o perfil de acesso (este módulo) descreve o que a conta pode fazer no HFM;
 *   • o escopo de operações descreve sobre quais operações ela pode fazê-lo.
 *
 * A planilha que diz "Administrador" na coluna Perfil está falando do primeiro.
 * Nada aqui é derivado dela.
 */

/** The seven official codes. Stable identity — never a route, never a screen name. */
export type AccessProfileCode =
  | "operacional"
  | "seguranca"
  | "lideranca_operacoes"
  | "gestor_frota"
  | "gente"
  | "administrador"
  | "gestao";

export interface AccessProfile {
  roleId: string;
  code: string;
  name: string;
  description: string;
  sortOrder: number;
  isAdministrator: boolean;
  permissionCount: number;
  memberCount: number;
  /** Granted here but not in the official default. */
  addedPermissions: string[];
  /** In the official default but not granted here. */
  removedPermissions: string[];
}

export interface PermissionRow {
  code: string;
  name: string;
  module: string;
  description: string | null;
  /** Administers access itself: only the administrator profile may hold it. */
  reserved: boolean;
  /** Profile codes that currently hold it in this organization. */
  grantedCodes: string[];
  /** Profile codes that hold it in the official default matrix. */
  defaultCodes: string[];
}

export interface AccessInconsistency {
  kind: string;
  severity: "high" | "medium" | "low";
  subjectId: string | null;
  subject: string;
  detail: string;
}

export interface AccessProfileChange {
  id: string;
  membershipId: string | null;
  actorUserId: string | null;
  actorName: string | null;
  targetName: string | null;
  previousCodes: string[];
  newCodes: string[];
  reason: string;
  createdAt: string;
}

/** The seven profiles of one organization, with size and drift from the default. */
export async function listAccessProfiles(organizationId: string): Promise<AccessProfile[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("access_profile_overview")
    .select("*")
    .eq("organization_id", organizationId)
    .order("sort_order");

  if (error) throw new Error(error.message);

  return (data ?? []).map((row) => ({
    roleId: row.role_id as string,
    code: row.code as string,
    name: (row.role_name ?? row.catalog_name) as string,
    description: (row.description ?? "") as string,
    sortOrder: Number(row.sort_order ?? 0),
    isAdministrator: Boolean(row.is_administrator),
    permissionCount: Number(row.permission_count ?? 0),
    memberCount: Number(row.member_count ?? 0),
    addedPermissions: (row.added_permissions ?? []) as string[],
    removedPermissions: (row.removed_permissions ?? []) as string[],
  }));
}

/** The whole matrix in one round trip: one row per permission of the catalogue. */
export async function getPermissionMatrix(organizationId: string): Promise<PermissionRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("access_profile_matrix", {
    p_organization_id: organizationId,
  });

  if (error) throw new Error(error.message);

  return (data ?? []).map((row) => ({
    code: row.permission_code as string,
    name: row.permission_name as string,
    module: row.module as string,
    description: row.description as string | null,
    reserved: Boolean(row.reserved),
    grantedCodes: (row.granted_codes ?? []) as string[],
    defaultCodes: (row.default_codes ?? []) as string[],
  }));
}

/** The audit panel: questions somebody should answer, never automatic corrections. */
export async function listAccessInconsistencies(organizationId: string): Promise<AccessInconsistency[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("access_inconsistencies", {
    p_organization_id: organizationId,
  });

  if (error) throw new Error(error.message);

  const weight: Record<string, number> = { high: 0, medium: 1, low: 2 };
  return (data ?? [])
    .map((row) => ({
      kind: row.kind as string,
      severity: (row.severity ?? "low") as AccessInconsistency["severity"],
      subjectId: (row.subject_id as string | null) ?? null,
      subject: (row.subject ?? "—") as string,
      detail: (row.detail ?? "") as string,
    }))
    .sort((a, b) => (weight[a.severity] ?? 3) - (weight[b.severity] ?? 3));
}

/** Who changed whose profile, and why. Append-only, newest first. */
export async function listProfileChanges(organizationId: string, limit = 50): Promise<AccessProfileChange[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("access_profile_changes")
    .select("id, membership_id, actor_user_id, target_user_id, previous_codes, new_codes, reason, created_at")
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) throw new Error(error.message);

  const rows = data ?? [];
  const userIds = [
    ...new Set(rows.flatMap((row) => [row.actor_user_id, row.target_user_id]).filter((id): id is string => Boolean(id))),
  ];

  // One lookup for every name on the page rather than one per row.
  const names = new Map<string, string>();
  if (userIds.length > 0) {
    const { data: profiles } = await supabase
      .from("profiles")
      .select("user_id, full_name")
      .in("user_id", userIds);
    for (const profile of profiles ?? []) {
      if (profile.full_name) names.set(profile.user_id, profile.full_name);
    }
  }

  return rows.map((row) => ({
    id: row.id,
    membershipId: row.membership_id,
    actorUserId: row.actor_user_id,
    actorName: row.actor_user_id ? (names.get(row.actor_user_id) ?? null) : null,
    targetName: row.target_user_id ? (names.get(row.target_user_id) ?? null) : null,
    previousCodes: row.previous_codes ?? [],
    newCodes: row.new_codes ?? [],
    reason: row.reason,
    createdAt: row.created_at,
  }));
}
