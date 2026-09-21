import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireOrganization, hasPermission } from "@/lib/auth/session";
import { getOperation, getOperationCoverage } from "@/lib/organization/operations";
import { listStates } from "@/lib/organization/queries";
import { OperationDetailView } from "./operation-detail-view";

export const metadata: Metadata = {
  title: "Operação",
  description: "Dados gerais e cobertura geográfica de uma operação.",
};

export default async function OperationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { session, organization } = await requireOrganization("operations.view");

  const [operation, coverage, states] = await Promise.all([
    getOperation(organization.organizationId, id),
    getOperationCoverage(organization.organizationId, id),
    listStates(),
  ]);

  // Not found and not permitted give the same answer on purpose: confirming an
  // operation exists is itself information about the organization.
  if (!operation) notFound();

  const canManage = hasPermission(session, "operations.manage");

  return (
    <OperationDetailView
      operation={operation}
      coverage={coverage}
      states={states.map((state) => ({
        stateId: state.id,
        uf: state.uf,
        name: state.name,
        region: state.region,
      }))}
      canUpdate={canManage || hasPermission(session, "operations.update")}
      canManageGeography={canManage || hasPermission(session, "operations.manage_geography")}
    />
  );
}
