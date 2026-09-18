import type { Metadata } from "next";
import { requireOrganization } from "@/lib/auth/session";
import { listOperations, listWorkLocations } from "@/lib/organization/queries";
import { OperationsView } from "./operations-view";

export const metadata: Metadata = {
  title: "Operações",
  description: "As operações da organização, seu efetivo e onde cada uma opera.",
};

/**
 * Organização → Operações.
 *
 * The operation is the unit this company is organised around: every employee,
 * every work location and eventually every vehicle belongs to one. This screen
 * is the list of them with the two numbers that matter today — how many people
 * are in each, and how many of those can actually sign in.
 *
 * The route re-checks operations.view; the sidebar entry is only a courtesy. A
 * person scoped to a subset of operations sees that subset, because the views
 * behind this run under their own policies.
 */
export default async function OperationsPage() {
  const { organization } = await requireOrganization("operations.view");

  const [operations, locations] = await Promise.all([
    listOperations(organization.organizationId),
    listWorkLocations(organization.organizationId),
  ]);

  return <OperationsView operations={operations} locations={locations} />;
}
