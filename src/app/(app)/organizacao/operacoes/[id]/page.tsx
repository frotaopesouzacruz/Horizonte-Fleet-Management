import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireOrganization, hasPermission } from "@/lib/auth/session";
import { getOperation, getOperationGeography, listStates } from "@/lib/organization/queries";
import { OperationGeographyView } from "./operation-geography-view";

export const metadata: Metadata = {
  title: "Abrangência da operação",
  description: "Estados e municípios cobertos por uma operação.",
};

/**
 * Organização → Operações → uma operação.
 *
 * Where the operation actually runs. The list screen says how many people an
 * operation has; this says where they are, which is the question that every
 * later module — checklist, manutenção, abastecimento — will need answered
 * before it can be scoped to anything.
 */
export default async function OperationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { session, organization } = await requireOrganization("operations.view");

  const [operation, geography, states] = await Promise.all([
    getOperation(organization.organizationId, id),
    getOperationGeography(organization.organizationId, id),
    listStates(),
  ]);

  // Not found and not permitted are the same answer on purpose: confirming that
  // an operation exists is itself information about the organization.
  if (!operation) notFound();

  return (
    <OperationGeographyView
      operation={operation}
      geography={geography}
      allStates={states.map((state) => ({ id: state.id, uf: state.uf, name: state.name, region: state.region }))}
      canManage={hasPermission(session, "operations.manage")}
    />
  );
}
