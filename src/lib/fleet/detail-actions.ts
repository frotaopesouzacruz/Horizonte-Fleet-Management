"use server";

import { resolveOrganization } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { getVehicleDetail, type VehicleDetail } from "./queries";
import type { Result } from "./actions";

/** Uma leitura não redireciona: ela diz o que houve e deixa a tela de pé. */
const SESSION_LOST =
  "Sua sessão expirou ou o acesso mudou. Recarregue a página e tente de novo.";

/**
 * Reads the drawers need, as server actions.
 *
 * They live apart from the mutations so a component can open a vehicle without
 * importing the module that archives one, and every read goes through
 * `requireOrganization` before it reaches a query that RLS will check again.
 */

export async function loadVehicleDetail(vehicleId: string): Promise<Result<VehicleDetail>> {
  const ctx = await resolveOrganization("vehicles.view");
  if (!ctx) return { ok: false, error: SESSION_LOST };
  const { organization } = ctx;
  const detail = await getVehicleDetail(organization.organizationId, vehicleId);
  if (!detail) return { ok: false, error: "Veículo não encontrado ou fora do seu escopo de acesso." };
  return { ok: true, data: detail };
}

export interface TimelineEntry {
  id: string;
  occurredAt: string;
  eventType: string;
  fields: string[];
  previousValue: Record<string, unknown> | null;
  newValue: Record<string, unknown> | null;
  reason: string | null;
  actorName: string | null;
}

/**
 * The vehicle's timeline (§41).
 *
 * `vehicle_timeline` is a `security_invoker` view over the four sources that
 * already record history. Somebody without `vehicles.audit` simply sees fewer
 * rows — the view does not widen anything, which is why it can be a view.
 */
export async function loadVehicleTimeline(vehicleId: string): Promise<Result<TimelineEntry[]>> {
  const ctx = await resolveOrganization("vehicles.view");
  if (!ctx) return { ok: false, error: SESSION_LOST };
  const { organization } = ctx;
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("vehicle_timeline")
    .select("id, occurred_at, event_type, fields, previous_value, new_value, reason, actor_name")
    .eq("organization_id", organization.organizationId)
    .eq("vehicle_id", vehicleId)
    .order("occurred_at", { ascending: false })
    .limit(200);

  if (error) return { ok: false, error: "Não foi possível carregar o histórico." };

  return {
    ok: true,
    data: (data ?? []).map((row) => ({
      id: row.id ?? "",
      occurredAt: row.occurred_at ?? "",
      eventType: row.event_type ?? "vehicle.updated",
      fields: (row.fields as string[] | null) ?? [],
      previousValue: (row.previous_value as Record<string, unknown> | null) ?? null,
      newValue: (row.new_value as Record<string, unknown> | null) ?? null,
      reason: row.reason,
      actorName: row.actor_name,
    })),
  };
}
