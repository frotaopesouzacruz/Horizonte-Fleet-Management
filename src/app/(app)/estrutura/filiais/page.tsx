import type { Metadata } from "next";
import { requireOrganization } from "@/lib/auth/session";
import {
  getBranchOperations,
  getBranchOptions,
  getBranchSummary,
  listBranches,
  type BranchFilters,
  type BranchSummary,
} from "@/lib/branches/queries";
import { listStates } from "@/lib/organization/queries";
import { BranchesView } from "./branches-view";

export const metadata: Metadata = {
  title: "Filiais",
  description: "Unidades organizacionais e seus vínculos com operações, colaboradores e frotas.",
};

type SearchParams = Record<string, string | string[] | undefined>;

const first = (params: SearchParams, key: string): string | undefined => {
  const value = params[key];
  return Array.isArray(value) ? value[0] : value;
};

/**
 * Estrutura Operacional → Filiais.
 *
 * A rota reconfere `branches.view` no servidor, e cada consulta roda com o
 * cliente de quem pediu — a RLS decide quais filiais voltam, não esta página.
 */
export default async function BranchesPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const { session, organization } = await requireOrganization("branches.view");

  const filters: BranchFilters = {
    q: first(params, "q"),
    status: first(params, "situacao"),
    operationId: first(params, "operacao"),
    stateId: first(params, "uf"),
    cityId: first(params, "cidade"),
    withVehicles: first(params, "frota"),
    withEmployees: first(params, "colaboradores"),
  };

  const orgId = organization.organizationId;

  const [rows, links, options, states, summary] = await Promise.all([
    listBranches(orgId, filters),
    getBranchOperations(orgId),
    getBranchOptions(orgId),
    listStates(),
    // Perder os seis cartões não é motivo para perder a lista embaixo deles.
    getBranchSummary(orgId).catch(() => null as BranchSummary | null),
  ]);

  const has = (code: string) => session.isPlatformAdmin || session.permissions.includes(code);

  return (
    <BranchesView
      rows={rows}
      links={links}
      summary={summary}
      filters={filters}
      operations={options.operations}
      locations={options.locations}
      states={states.map((s) => ({ id: s.id, uf: s.uf, name: s.name }))}
      canCreate={has("branches.create")}
      canUpdate={has("branches.update")}
      canDeactivate={has("branches.deactivate")}
      canManageOperations={has("branches.manage_operations")}
      canViewEmployees={has("branches.view_employees")}
      canViewVehicles={has("branches.view_vehicles")}
      canViewAudit={has("branches.view_audit")}
    />
  );
}
