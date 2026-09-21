import { Suspense } from "react";
import type { Metadata } from "next";
import { requireOrganization } from "@/lib/auth/session";
import {
  listVehicles,
  getFleetOptions,
  getVehicleSummary,
  DEFAULT_PAGE_SIZE,
  type VehicleFilters,
  type VehicleSortKey,
  type VehicleSummary,
} from "@/lib/fleet/queries";
import { FleetView } from "./fleet-view";
import { OverviewCards, OverviewError, OverviewSkeleton, OperationDistribution } from "./overview";

export const metadata: Metadata = {
  title: "Cadastro de Frotas",
  description: "Veículos, vínculos operacionais e informações cadastrais da frota.",
};

type SearchParams = Record<string, string | string[] | undefined>;

const first = (params: SearchParams, key: string): string | undefined => {
  const value = params[key];
  return Array.isArray(value) ? value[0] : value;
};

/**
 * Gestão de frota → Cadastro de frotas.
 *
 * The route re-checks vehicles.view server-side: hiding the sidebar entry is a
 * courtesy, this is the gate, and RLS plus the operation scope decide the rows
 * underneath both. Filtering, sorting and pagination all happen in the
 * database, driven by the URL, so a page is shareable and the browser never
 * holds more than one page of vehicles.
 */
export default async function FleetRegistryPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const { session, organization } = await requireOrganization("vehicles.view");

  const filters: VehicleFilters = {
    q: first(params, "q"),
    status: first(params, "status"),
    ownership: first(params, "ownership"),
    type: first(params, "type"),
    subcategory: first(params, "subcategory"),
    operation: first(params, "operation"),
    state: first(params, "state"),
    city: first(params, "city"),
    unit: first(params, "unit"),
    archived: first(params, "archived") === "1",
    sort: (first(params, "sort") as VehicleSortKey | undefined) ?? "fleet_code",
    dir: first(params, "dir") === "desc" ? "desc" : "asc",
    page: Number(first(params, "page") ?? 1) || 1,
    pageSize: Number(first(params, "pageSize") ?? DEFAULT_PAGE_SIZE) || DEFAULT_PAGE_SIZE,
  };

  const [page, options] = await Promise.all([
    listVehicles(organization.organizationId, filters),
    getFleetOptions(organization.organizationId),
  ]);

  return (
    <FleetView
      page={page}
      options={options}
      filters={filters}
      permissions={session.permissions}
      isPlatformAdmin={session.isPlatformAdmin}
      overview={
        // Streamed, not awaited: the table is rendered and usable while the
        // aggregate is still running, and a failure costs the reader the six
        // cards rather than the whole page.
        <Suspense fallback={<OverviewSkeleton />}>
          <Overview organizationId={organization.organizationId} filters={filters} />
        </Suspense>
      }
    />
  );
}

/**
 * The indicator row.
 *
 * The cards follow the structural filters and deliberately ignore `q`: the
 * table answers "which vehicle matches what I typed", the cards answer "what
 * does this slice of the fleet look like".
 */
async function Overview({
  organizationId,
  filters,
}: {
  organizationId: string;
  filters: VehicleFilters;
}) {
  // Only the fetch is guarded: a failure here is not a reason for the person to
  // lose the list below it. Rendering stays outside the catch, where an error
  // belongs to an error boundary and not to this handler.
  let summary: VehicleSummary | null = null;
  try {
    summary = await getVehicleSummary(organizationId, filters);
  } catch {
    summary = null;
  }

  if (!summary) return <OverviewError />;

  return (
    <div className="flex flex-col gap-2">
      <OverviewCards summary={summary} operationId={filters.operation} />
      <div className="flex">
        <OperationDistribution summary={summary} />
      </div>
    </div>
  );
}
