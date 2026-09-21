"use server";

import { requireOrganization } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import {
  getEquipmentType,
  getEquipmentTypeImpact,
  type EquipmentTypeDetail,
  type EquipmentTypeImpact,
} from "./queries";
import type { Result } from "./actions";

/**
 * Reads the drawers need, as server actions. Apart from the mutations so a
 * component can open a type without importing the module that deactivates one.
 */

export async function loadEquipmentType(typeId: string): Promise<Result<EquipmentTypeDetail>> {
  const { organization } = await requireOrganization("equipment_types.view");
  const detail = await getEquipmentType(organization.organizationId, typeId);
  if (!detail) return { ok: false, error: "Tipo de equipamento não encontrado." };
  return { ok: true, data: detail };
}

/**
 * The impact of a change, counted now rather than guessed. Called before the
 * confirmation dialog so the person decides knowing the size of what follows.
 */
export async function loadEquipmentTypeImpact(
  typeId: string,
): Promise<Result<EquipmentTypeImpact>> {
  const { organization } = await requireOrganization("equipment_types.view");
  try {
    const impact = await getEquipmentTypeImpact(organization.organizationId, typeId);
    return { ok: true, data: impact };
  } catch {
    return { ok: false, error: "Não foi possível calcular o impacto." };
  }
}

export interface HistoryEntry {
  id: string;
  occurredAt: string;
  entity: string;
  action: string;
  fields: string[];
  actorName: string | null;
}

/**
 * The audit trail is its own permission: seeing the catalogue is not the same
 * as seeing who changed what. The RLS on audit_logs still applies on top.
 */
export async function loadEquipmentTypeHistory(typeId: string): Promise<Result<HistoryEntry[]>> {
  const { organization } = await requireOrganization("equipment_types.view_audit");
  const supabase = await createClient();

  const { data, error } = await supabase.rpc("equipment_type_history", {
    p_organization_id: organization.organizationId,
    p_vehicle_type_id: typeId,
  });

  if (error) return { ok: false, error: "Não foi possível carregar o histórico." };

  return {
    ok: true,
    data: (data ?? []).map((row) => ({
      id: row.id ?? "",
      occurredAt: row.occurred_at ?? "",
      entity: row.entity ?? "",
      action: row.action ?? "",
      fields: (row.fields as string[] | null) ?? [],
      actorName: row.actor_name,
    })),
  };
}
