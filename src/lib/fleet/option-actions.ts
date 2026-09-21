"use server";

import { requireOrganization } from "@/lib/auth/session";
import { listOperations } from "@/lib/organization/operations";
import type { Result } from "./actions";

/**
 * Operations the caller may allocate a vehicle to.
 *
 * A server action rather than a prop because the transfer form lives inside a
 * drawer that is mounted long after the page was rendered, and re-rendering the
 * whole list to hand it an array would be the wrong trade.
 */
export async function listOperationsForFleet(): Promise<Result<{ id: string; label: string }[]>> {
  const { organization } = await requireOrganization("vehicles.view");
  try {
    const operations = await listOperations(organization.organizationId);
    return { ok: true, data: operations.map((operation) => ({ id: operation.id, label: operation.name })) };
  } catch {
    return { ok: false, error: "Não foi possível carregar as operações." };
  }
}
