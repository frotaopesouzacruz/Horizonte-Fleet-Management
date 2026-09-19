import type { Metadata } from "next";
import { requireOrganization, hasPermission } from "@/lib/auth/session";
import { listOperations, getOperationCoverage } from "@/lib/organization/operations";
import { listStates } from "@/lib/organization/queries";
import { OperationsView } from "./operations-view";
import type { CoverageInput } from "@/lib/organization/actions";

export const metadata: Metadata = {
  title: "Operações",
  description: "As operações da organização, seu efetivo e a área geográfica onde atuam.",
};

type SearchParams = Record<string, string | string[] | undefined>;

/**
 * Administração → Operações.
 *
 * The route re-checks operations.view; the sidebar entry is a courtesy. A person
 * scoped to a subset of operations sees that subset, because every view behind
 * this runs under their own policies.
 */
export default async function OperationsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams;
  const includeInactive = params.inativas === "1";
  const { session, organization } = await requireOrganization("operations.view");

  const [operations, states] = await Promise.all([
    listOperations(organization.organizationId, { includeInactive }),
    listStates(),
  ]);

  // The edit form opens already filled, so the coverage of every listed
  // operation is fetched with the list rather than on the click. Eight
  // operations with a couple of dozen municipalities is one cheap round trip.
  const coverages = await Promise.all(
    operations.map((operation) => getOperationCoverage(organization.organizationId, operation.id)),
  );

  const coverage: Record<string, CoverageInput[]> = {};
  operations.forEach((operation, index) => {
    coverage[operation.id] = coverages[index].map((state) => ({
      stateId: state.stateId,
      cityIds: state.cities.map((city) => city.cityId),
    }));
  });

  const canManage = hasPermission(session, "operations.manage");

  return (
    <OperationsView
      operations={operations}
      coverage={coverage}
      states={states.map((state) => ({
        stateId: state.id,
        uf: state.uf,
        name: state.name,
        region: state.region,
      }))}
      includeInactive={includeInactive}
      canCreate={canManage || hasPermission(session, "operations.create")}
      canUpdate={canManage || hasPermission(session, "operations.update")}
      canDeactivate={canManage || hasPermission(session, "operations.deactivate")}
    />
  );
}
