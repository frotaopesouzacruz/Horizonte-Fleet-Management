import "server-only";

import { createClient } from "@/lib/supabase/server";

/**
 * The operations service.
 *
 * Everything the product knows about an operation is read and written through
 * here — components do not build their own queries. The operation is the axis
 * the rest of the system turns on, so there is exactly one place that decides
 * what an operation is and what its coverage means.
 *
 * Reads run under the caller's client, so RLS and the operation scopes decide
 * what comes back. Writes go through `save_operation`, which applies the
 * operation and its coverage in one transaction.
 */

/* ------------------------------------------------------------------- model */

export interface OperationSummary {
  id: string;
  code: string | null;
  name: string;
  description: string | null;
  status: string;
  updatedAt: string | null;
  /** People currently assigned to the operation. */
  employeeCount: number;
  /** How many of those hold an HFM account. */
  accessCount: number;
  /** Distinct work locations the operation spans. */
  locationCount: number;
  stateCount: number;
  cityCount: number;
}

export interface OperationDetail {
  id: string;
  code: string | null;
  name: string;
  description: string | null;
  status: string;
}

export interface CoverageCity {
  cityId: number;
  name: string;
  isCapital: boolean;
  ddd: number | null;
  /** People currently assigned to this operation whose work location is here. */
  employeeCount: number;
}

export interface CoverageState {
  stateId: number;
  uf: string;
  name: string;
  region: string;
  cities: CoverageCity[];
}

/* -------------------------------------------------------------------- read */

export async function listOperations(
  organizationId: string,
  options: { includeInactive?: boolean } = {},
): Promise<OperationSummary[]> {
  const supabase = await createClient();
  let query = supabase
    .from("operation_summary")
    .select("id, code, name, description, status, updated_at, employee_count, access_count, location_count, state_count, city_count")
    .eq("organization_id", organizationId);

  // An inactive operation keeps its history but stays out of the way until
  // someone asks for it.
  if (!options.includeInactive) query = query.eq("status", "active");

  const { data } = await query.order("code");

  return (data ?? []).flatMap((row) =>
    row.id === null
      ? []
      : [
          {
            id: row.id,
            code: row.code,
            name: row.name ?? "Operação sem nome",
            description: row.description,
            status: row.status ?? "active",
            updatedAt: row.updated_at,
            employeeCount: Number(row.employee_count ?? 0),
            accessCount: Number(row.access_count ?? 0),
            locationCount: Number(row.location_count ?? 0),
            stateCount: Number(row.state_count ?? 0),
            cityCount: Number(row.city_count ?? 0),
          },
        ],
  );
}

export async function getOperation(
  organizationId: string,
  operationId: string,
): Promise<OperationDetail | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("operations")
    .select("id, code, name, description, status")
    .eq("organization_id", organizationId)
    .eq("id", operationId)
    .is("deleted_at", null)
    .maybeSingle();

  return data
    ? { id: data.id, code: data.code, name: data.name, description: data.description, status: data.status }
    : null;
}

/**
 * The operation's footprint, states first and their municipalities nested.
 *
 * Both levels are read, not one derived from the other: while a coverage is
 * being edited a state legitimately has no cities yet, and that state has to
 * survive the round trip or the screen would silently drop it.
 */
export async function getOperationCoverage(
  organizationId: string,
  operationId: string,
): Promise<CoverageState[]> {
  const supabase = await createClient();

  const [{ data: states }, { data: cities }] = await Promise.all([
    supabase
      .from("operation_state_summary")
      .select("state_id, uf, state_name, region")
      .eq("organization_id", organizationId)
      .eq("operation_id", operationId),
    supabase
      .from("operation_geography")
      .select("state_id, city_id, city_name, is_capital, ddd, employee_count")
      .eq("organization_id", organizationId)
      .eq("operation_id", operationId),
  ]);

  const byState = new Map<number, CoverageCity[]>();
  for (const row of cities ?? []) {
    if (row.state_id === null || row.city_id === null) continue;
    const list = byState.get(row.state_id) ?? [];
    list.push({
      cityId: row.city_id,
      name: row.city_name ?? "—",
      isCapital: Boolean(row.is_capital),
      ddd: row.ddd ?? null,
      employeeCount: Number(row.employee_count ?? 0),
    });
    byState.set(row.state_id, list);
  }

  return (states ?? [])
    .flatMap((row) =>
      row.state_id === null || !row.uf
        ? []
        : [
            {
              stateId: row.state_id,
              uf: row.uf,
              name: row.state_name ?? row.uf,
              region: row.region ?? "—",
              cities: (byState.get(row.state_id) ?? []).sort(
                (a, b) => b.employeeCount - a.employeeCount || a.name.localeCompare(b.name, "pt-BR"),
              ),
            },
          ],
    )
    .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
}

/* ----------------------------------------------------- cascading filters --- */

/**
 * `listStatesByOperation` and `listCitiesByOperationAndState` are the contract
 * every future module filters through: an operation shows only the states it
 * covers, and a state shows only the municipalities that operation covers there.
 * Never the 27 UFs of Brazil, never the 853 municipalities of Minas Gerais.
 */

export interface StateOption {
  stateId: number;
  uf: string;
  name: string;
  cityCount: number;
}

export async function listStatesByOperation(
  organizationId: string,
  operationId: string,
): Promise<StateOption[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("operation_state_summary")
    .select("state_id, uf, state_name, city_count")
    .eq("organization_id", organizationId)
    .eq("operation_id", operationId)
    .order("state_name");

  return (data ?? []).flatMap((row) =>
    row.state_id === null || !row.uf
      ? []
      : [
          {
            stateId: row.state_id,
            uf: row.uf,
            name: row.state_name ?? row.uf,
            cityCount: Number(row.city_count ?? 0),
          },
        ],
  );
}

export interface CityOption {
  cityId: number;
  name: string;
  isCapital: boolean;
}

export async function listCitiesByOperationAndState(
  organizationId: string,
  operationId: string,
  stateId: number,
): Promise<CityOption[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("operation_geography")
    .select("city_id, city_name, is_capital")
    .eq("organization_id", organizationId)
    .eq("operation_id", operationId)
    .eq("state_id", stateId)
    .order("city_name");

  return (data ?? []).flatMap((row) =>
    row.city_id === null
      ? []
      : [{ cityId: row.city_id, name: row.city_name ?? "—", isCapital: Boolean(row.is_capital) }],
  );
}
