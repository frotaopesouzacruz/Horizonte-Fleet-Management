import type { Metadata } from "next";
import { requireOrganization } from "@/lib/auth/session";
import {
  listAccessProfiles,
  getPermissionMatrix,
  listAccessInconsistencies,
  listProfileChanges,
  listSimulatableMemberships,
} from "@/lib/admin/access-profiles";
import { AccessProfilesView } from "./access-profiles-view";

export const metadata: Metadata = {
  title: "Perfis e permissões",
  description: "Os perfis de acesso oficiais do HFM e o que cada um pode fazer.",
};

/**
 * Administração → Perfis e permissões.
 *
 * `roles.view` is re-checked here and not only in the sidebar: hiding a link is
 * a courtesy, this is the gate. Everything below is read through the caller's
 * own RLS, so the page can only ever describe the organization they belong to.
 */
export default async function AccessProfilesPage() {
  const { session, organization } = await requireOrganization("roles.view");

  const [profiles, matrix, inconsistencies, changes, memberships] = await Promise.all([
    listAccessProfiles(organization.organizationId),
    getPermissionMatrix(organization.organizationId),
    listAccessInconsistencies(organization.organizationId),
    listProfileChanges(organization.organizationId),
    listSimulatableMemberships(organization.organizationId),
  ]);

  return (
    <AccessProfilesView
      profiles={profiles}
      matrix={matrix}
      inconsistencies={inconsistencies}
      changes={changes}
      memberships={memberships}
      canManage={session.permissions.includes("roles.manage")}
    />
  );
}
