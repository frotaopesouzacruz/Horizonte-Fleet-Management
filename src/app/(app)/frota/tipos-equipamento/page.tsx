import { Suspense } from "react";
import type { Metadata } from "next";
import { requireOrganization } from "@/lib/auth/session";
import {
  listEquipmentTypes,
  getEquipmentOptions,
  getEquipmentTypeSummary,
  type EquipmentTypeFilters,
  type EquipmentTypeSummary,
} from "@/lib/equipment/queries";
import { EquipmentTypesView } from "./equipment-types-view";
import { OverviewCards, OverviewError, OverviewSkeleton } from "./overview";

export const metadata: Metadata = {
  title: "Tipos de Equipamento",
  description: "Categorias, subcategorias e regras operacionais aplicáveis à frota.",
};

type SearchParams = Record<string, string | string[] | undefined>;

const first = (params: SearchParams, key: string): string | undefined => {
  const value = params[key];
  return Array.isArray(value) ? value[0] : value;
};

/**
 * Gestão de frota → Tipos de equipamento.
 *
 * The route re-checks equipment_types.view server-side. The list mixes the
 * platform's base catalogue with the organization's own types, and the
 * database decides which rows those are — the page never widens the scope.
 */
export default async function EquipmentTypesPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const { session, organization } = await requireOrganization("equipment_types.view");

  const filters: EquipmentTypeFilters = {
    q: first(params, "q"),
    status: first(params, "status"),
    scope: first(params, "scope"),
    operation: first(params, "operation"),
    app: first(params, "app"),
  };

  const [rows, options] = await Promise.all([
    listEquipmentTypes(organization.organizationId, filters),
    getEquipmentOptions(organization.organizationId),
  ]);

  return (
    <EquipmentTypesView
      rows={rows}
      options={options}
      filters={filters}
      permissions={session.permissions}
      isPlatformAdmin={session.isPlatformAdmin}
      overview={
        <Suspense fallback={<OverviewSkeleton />}>
          <Overview organizationId={organization.organizationId} />
        </Suspense>
      }
    />
  );
}

async function Overview({ organizationId }: { organizationId: string }) {
  // Only the fetch is guarded: losing the five cards is not a reason to lose
  // the list of types below them.
  let summary: EquipmentTypeSummary | null = null;
  try {
    summary = await getEquipmentTypeSummary(organizationId);
  } catch {
    summary = null;
  }

  if (!summary) return <OverviewError />;
  return <OverviewCards summary={summary} />;
}
