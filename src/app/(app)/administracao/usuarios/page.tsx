import { Suspense } from "react";
import type { Metadata } from "next";
import { requireOrganization } from "@/lib/auth/session";
import {
  listEmployees,
  getDirectoryOptions,
  getEmployeeSummary,
  DEFAULT_PAGE_SIZE,
  type DirectoryFilters,
  type EmployeeSummary,
  type SortKey,
} from "@/lib/admin/queries";
import { UsersView } from "./users-view";
import { OverviewCards, OverviewError, OverviewSkeleton } from "./overview";

export const metadata: Metadata = {
  title: "Usuários",
  description: "Colaboradores, acessos, perfis e operações.",
};

type SearchParams = Record<string, string | string[] | undefined>;

const first = (params: SearchParams, key: string): string | undefined => {
  const value = params[key];
  return Array.isArray(value) ? value[0] : value;
};

/**
 * Administration → Users.
 *
 * The route re-checks users.view server-side: hiding the sidebar entry is a
 * courtesy, this is the gate. Filtering, sorting and pagination all happen in
 * the database, driven by the URL, so a page is shareable and the browser never
 * holds more than one page of people.
 */
export default async function UsersPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams;
  const { session, organization } = await requireOrganization("users.view");

  const filters: DirectoryFilters = {
    q: first(params, "q"),
    status: first(params, "status"),
    area: first(params, "area"),
    operation: first(params, "operation"),
    profile: first(params, "profile"),
    location: first(params, "location"),
    unit: first(params, "unit"),
    manager: first(params, "manager"),
    access: first(params, "access"),
    archived: first(params, "archived") === "1",
    sort: (first(params, "sort") as SortKey | undefined) ?? "full_name",
    dir: first(params, "dir") === "desc" ? "desc" : "asc",
    page: Number(first(params, "page") ?? 1) || 1,
    pageSize: Number(first(params, "pageSize") ?? DEFAULT_PAGE_SIZE) || DEFAULT_PAGE_SIZE,
  };

  const [page, options] = await Promise.all([
    listEmployees(organization.organizationId, filters),
    getDirectoryOptions(organization.organizationId),
  ]);

  return (
    <UsersView
      page={page}
      options={options}
      overview={
        // Streamed, not awaited: the table is rendered and usable while the
        // aggregate is still running, and a failure costs the reader the five
        // cards rather than the whole page.
        <Suspense fallback={<OverviewSkeleton />}>
          <Overview organizationId={organization.organizationId} filters={filters} />
        </Suspense>
      }
      filters={filters}
      permissions={session.permissions}
      isPlatformAdmin={session.isPlatformAdmin}
    />
  );
}

/**
 * The indicator row.
 *
 * The cards follow the structural filters and deliberately ignore `q`: the
 * table answers "who matches what I typed", the cards answer "what does this
 * slice of the organization look like". Recounting the organization on every
 * keystroke would only make them flicker.
 */
async function Overview({
  organizationId,
  filters,
}: {
  organizationId: string;
  filters: DirectoryFilters;
}) {
  // Only the fetch is guarded: a failure here is not a reason for the person to
  // lose the list of colaboradores below it. Rendering stays outside the catch,
  // where an error belongs to an error boundary and not to this handler.
  let summary: EmployeeSummary | null = null;
  try {
    summary = await getEmployeeSummary(organizationId, filters);
  } catch {
    summary = null;
  }

  if (!summary) return <OverviewError />;
  return <OverviewCards summary={summary} operationId={filters.operation} />;
}
