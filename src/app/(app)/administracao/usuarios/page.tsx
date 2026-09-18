import type { Metadata } from "next";
import { requireOrganization } from "@/lib/auth/session";
import {
  listEmployees,
  getDirectoryOptions,
  getDirectoryStats,
  DEFAULT_PAGE_SIZE,
  type DirectoryFilters,
  type SortKey,
} from "@/lib/admin/queries";
import { UsersView } from "./users-view";

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

  const [page, options, stats] = await Promise.all([
    listEmployees(organization.organizationId, filters),
    getDirectoryOptions(organization.organizationId),
    getDirectoryStats(organization.organizationId),
  ]);

  return (
    <UsersView
      page={page}
      options={options}
      stats={stats}
      filters={filters}
      permissions={session.permissions}
      isPlatformAdmin={session.isPlatformAdmin}
    />
  );
}
