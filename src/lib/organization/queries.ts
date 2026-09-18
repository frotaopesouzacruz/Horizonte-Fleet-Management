import "server-only";

import { createClient } from "@/lib/supabase/server";

/**
 * Reads for the Organização group.
 *
 * Every query here runs under the caller's own client, so RLS and the operation
 * scopes are what decide which rows come back. Nothing in this file filters for
 * security — the organization_id predicates keep a query cheap and unambiguous
 * for someone who belongs to more than one organization, they do not keep anyone
 * out.
 *
 * The view columns arrive nullable because Postgres cannot promise otherwise
 * through a view, so each mapper states what it does with a missing value rather
 * than asserting it away.
 */

/* ------------------------------------------------------------------ operações */

export interface OperationSummary {
  id: string;
  name: string;
  status: string;
  /** People currently attached to the operation. */
  employeeCount: number;
  /** How many of those hold an HFM account. */
  accessCount: number;
  /** Distinct work locations the operation spans. */
  locationCount: number;
}

export async function listOperations(organizationId: string): Promise<OperationSummary[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("operation_summary")
    .select("id, name, status, employee_count, access_count, location_count")
    .eq("organization_id", organizationId)
    .order("employee_count", { ascending: false })
    .order("name");

  return (data ?? []).flatMap((row) =>
    row.id === null
      ? []
      : [
          {
            id: row.id,
            name: row.name ?? "Operação sem nome",
            status: row.status ?? "unknown",
            employeeCount: Number(row.employee_count ?? 0),
            accessCount: Number(row.access_count ?? 0),
            locationCount: Number(row.location_count ?? 0),
          },
        ],
  );
}

export interface WorkLocationRow {
  id: string;
  name: string;
  status: string;
  cityId: number | null;
  cityName: string | null;
  uf: string | null;
}

/**
 * Work locations with the municipality they resolved to.
 *
 * A null city stays null. The name is free text from the imported sheet and one
 * of them is genuinely ambiguous — there are two Campo Grandes — so the screen
 * says "a definir" instead of picking the bigger one.
 */
export async function listWorkLocations(organizationId: string): Promise<WorkLocationRow[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("work_locations")
    .select("id, name, status, cities(id, name, states(uf))")
    .eq("organization_id", organizationId)
    .is("deleted_at", null)
    .order("name");

  return (data ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    status: row.status,
    cityId: row.cities?.id ?? null,
    cityName: row.cities?.name ?? null,
    uf: row.cities?.states?.uf ?? null,
  }));
}

/* --------------------------------------------------------- estados e cidades */

export interface StateSummary {
  id: number;
  uf: string;
  name: string;
  region: string;
  cityCount: number;
  capitalName: string | null;
  capitalId: number | null;
}

export async function listStates(): Promise<StateSummary[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("state_summary")
    .select("id, uf, name, region, city_count, capital_name, capital_id")
    .order("name");

  // A state without an id or a UF is not a state; the view cannot produce one,
  // and skipping is better than rendering a row nobody can act on.
  return (data ?? []).flatMap((row) =>
    row.id === null || row.uf === null
      ? []
      : [
          {
            id: Number(row.id),
            uf: row.uf,
            name: row.name ?? row.uf,
            region: row.region ?? "—",
            cityCount: Number(row.city_count ?? 0),
            capitalName: row.capital_name,
            capitalId: row.capital_id === null ? null : Number(row.capital_id),
          },
        ],
  );
}

export interface CityRow {
  id: number;
  stateId: number;
  uf: string;
  stateName: string;
  name: string;
  isCapital: boolean;
  isMunicipality: boolean;
  ddd: number | null;
  timeZone: string | null;
  latitude: number | null;
  longitude: number | null;
}

export interface CityFilters {
  stateId?: number;
  q?: string;
  page: number;
  pageSize: number;
}

export interface CityPage {
  rows: CityRow[];
  total: number;
  page: number;
  pageSize: number;
}

export const CITY_PAGE_SIZE = 50;
/** Mirrors the clamp inside public.search_cities, so the URL cannot ask for more. */
export const CITY_PAGE_SIZE_MAX = 200;

/**
 * Municipality search.
 *
 * Goes through public.search_cities rather than PostgREST filters because the
 * match has to ignore accents — people type "goiania", not "Goiânia" — and the
 * only index that answers that is the trigram one built on the normalised name.
 * The total rides back on every row, so a page costs one round trip.
 */
export async function searchCities(filters: CityFilters): Promise<CityPage> {
  const supabase = await createClient();

  const pageSize = Math.min(Math.max(1, filters.pageSize || CITY_PAGE_SIZE), CITY_PAGE_SIZE_MAX);
  const page = Math.max(1, filters.page || 1);
  const trimmed = filters.q?.trim();
  const query = trimmed && trimmed.length > 0 ? trimmed : undefined;

  const { data } = await supabase.rpc("search_cities", {
    p_state_id: filters.stateId,
    p_query: query,
    p_limit: pageSize,
    p_offset: (page - 1) * pageSize,
  });

  const rows = data ?? [];

  // An empty page past the first carries no window count, and reporting zero
  // there would tell the screen the search found nothing when it found plenty.
  // Ask once for the cheapest row and take the total from it.
  let total = rows.length > 0 ? Number(rows[0].total) : 0;
  if (rows.length === 0 && page > 1) {
    const { data: probe } = await supabase.rpc("search_cities", {
      p_state_id: filters.stateId,
      p_query: query,
      p_limit: 1,
      p_offset: 0,
    });
    total = probe && probe.length > 0 ? Number(probe[0].total) : 0;
  }

  return {
    rows: rows.map((row) => ({
      id: row.id,
      stateId: row.state_id,
      uf: row.uf,
      stateName: row.state_name,
      name: row.name,
      isCapital: row.is_capital,
      isMunicipality: row.is_municipality,
      ddd: row.ddd ?? null,
      timeZone: row.time_zone ?? null,
      latitude: row.latitude ?? null,
      longitude: row.longitude ?? null,
    })),
    total,
    page,
    pageSize,
  };
}
