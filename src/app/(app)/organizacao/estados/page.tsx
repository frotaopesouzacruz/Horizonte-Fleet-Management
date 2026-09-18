import type { Metadata } from "next";
import { requireSession } from "@/lib/auth/session";
import {
  listStates,
  listWorkLocations,
  searchCities,
  CITY_PAGE_SIZE,
  type CityFilters,
} from "@/lib/organization/queries";
import { GeographyView } from "./geography-view";

export const metadata: Metadata = {
  title: "Estados e cidades",
  description: "Unidades federativas e municípios brasileiros com código IBGE.",
};

type SearchParams = Record<string, string | string[] | undefined>;

const first = (params: SearchParams, key: string): string | undefined => {
  const value = params[key];
  return Array.isArray(value) ? value[0] : value;
};

/**
 * Organização → Estados e cidades.
 *
 * The IBGE list, read-only. It is the reference every geographic field in the
 * product will point at, so what this screen owes the user is the ability to
 * find a municipality and read its code — not to edit anything.
 *
 * No permission gate: states and cities are platform reference data with a
 * policy that grants read to any signed-in user. requireSession is still the
 * door, and RLS is still the authority.
 */
export default async function GeographyPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams;
  const session = await requireSession();

  const rawState = Number(first(params, "uf"));
  const filters: CityFilters = {
    stateId: Number.isInteger(rawState) && rawState > 0 ? rawState : undefined,
    q: first(params, "q"),
    page: Number(first(params, "page") ?? 1) || 1,
    pageSize: CITY_PAGE_SIZE,
  };

  const organizationId = session.activeOrganization?.organizationId;

  const [states, cities, locations] = await Promise.all([
    listStates(),
    searchCities(filters),
    organizationId ? listWorkLocations(organizationId) : Promise.resolve([]),
  ]);

  // Which UFs the organization actually operates in, so the state list can say
  // so. Derived from the work locations the caller is allowed to see — never a
  // reason to show or hide a state, only a label on one.
  const operatingStates = new Set(locations.map((l) => l.uf).filter((uf): uf is string => Boolean(uf)));

  return (
    <GeographyView
      states={states}
      cities={cities}
      filters={filters}
      operatingStates={[...operatingStates]}
    />
  );
}
