import "server-only";

import { createClient } from "@/lib/supabase/server";

/**
 * Vínculos Aplicativo × Operação e Aplicativo × Tipo de Equipamento.
 *
 * UMA fonte, três telas (Operações, Tipos de Equipamento, Gerenciador de
 * Aplicativos): tudo lê `application_links_overview` e grava pelas rotinas
 * `set_application_*_link`. Nenhuma tela guarda lista própria de vínculos —
 * é isso que impede duas configurações independentes de divergirem.
 */

export interface LinkApp {
  id: string;
  code: string;
  name: string;
  slug: string | null;
  isActive: boolean;
}

export interface LinkOperation {
  id: string;
  code: string | null;
  name: string;
  status: string;
}

export interface LinkVehicleType {
  id: string;
  code: string;
  name: string;
  isActive: boolean;
  scope: "global" | "organization";
}

export interface OperationLink {
  appId: string;
  operationId: string;
  isEnabled: boolean;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  updatedAt: string | null;
  /** Habilitado E dentro da vigência hoje. */
  inForce: boolean;
}

export interface VehicleTypeLink {
  appId: string;
  vehicleTypeId: string;
  isEnabled: boolean;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  updatedAt: string | null;
  inForce: boolean;
}

export interface ApplicationLinks {
  apps: LinkApp[];
  operations: LinkOperation[];
  vehicleTypes: LinkVehicleType[];
  operationLinks: OperationLink[];
  typeLinks: VehicleTypeLink[];
}

export interface LinkFilters {
  appId?: string | null;
  operationId?: string | null;
  vehicleTypeId?: string | null;
}

const str = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));

export async function getApplicationLinks(
  organizationId: string,
  filters: LinkFilters = {},
): Promise<ApplicationLinks> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("application_links_overview", {
    p_organization_id: organizationId,
    p_app_id: filters.appId ?? undefined,
    p_operation_id: filters.operationId ?? undefined,
    p_vehicle_type_id: filters.vehicleTypeId ?? undefined,
  });
  if (error) throw new Error(error.message);

  const raw = (data ?? {}) as Record<string, unknown>;
  const arr = (key: string) => (Array.isArray(raw[key]) ? (raw[key] as Record<string, unknown>[]) : []);

  return {
    apps: arr("apps").map((a) => ({
      id: String(a.id),
      code: String(a.code),
      name: String(a.name),
      slug: str(a.slug),
      isActive: a.is_active === true,
    })),
    operations: arr("operations").map((o) => ({
      id: String(o.id),
      code: str(o.code),
      name: String(o.name),
      status: String(o.status ?? "active"),
    })),
    vehicleTypes: arr("vehicle_types").map((t) => ({
      id: String(t.id),
      code: String(t.code),
      name: String(t.name),
      isActive: t.is_active === true,
      scope: t.scope === "global" ? "global" : "organization",
    })),
    operationLinks: arr("operation_links").map((l) => ({
      appId: String(l.app_id),
      operationId: String(l.operation_id),
      isEnabled: l.is_enabled === true,
      effectiveFrom: str(l.effective_from),
      effectiveTo: str(l.effective_to),
      updatedAt: str(l.updated_at),
      inForce: l.in_force === true,
    })),
    typeLinks: arr("type_links").map((l) => ({
      appId: String(l.app_id),
      vehicleTypeId: String(l.vehicle_type_id),
      isEnabled: l.is_enabled === true,
      effectiveFrom: str(l.effective_from),
      effectiveTo: str(l.effective_to),
      updatedAt: str(l.updated_at),
      inForce: l.in_force === true,
    })),
  };
}

export interface LinkHistoryEntry {
  id: string;
  createdAt: string;
  action: "INSERT" | "UPDATE" | "DELETE";
  kind: "operation" | "vehicle_type";
  appId: string | null;
  operationId: string | null;
  vehicleTypeId: string | null;
  before: { isEnabled: boolean; effectiveFrom: string | null; effectiveTo: string | null } | null;
  after: { isEnabled: boolean; effectiveFrom: string | null; effectiveTo: string | null } | null;
  changedFields: string[];
  userName: string | null;
}

/** §9 "consultar histórico de alterações" — a trilha oficial de auditoria. */
export async function getApplicationLinkHistory(
  organizationId: string,
  filters: LinkFilters & { limit?: number } = {},
): Promise<LinkHistoryEntry[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("application_link_history", {
    p_organization_id: organizationId,
    p_filters: {
      app_id: filters.appId ?? null,
      operation_id: filters.operationId ?? null,
      vehicle_type_id: filters.vehicleTypeId ?? null,
      limit: filters.limit ?? 50,
    },
  });
  if (error) throw new Error(error.message);

  const state = (v: unknown) => {
    if (!v || typeof v !== "object") return null;
    const s = v as Record<string, unknown>;
    return {
      isEnabled: s.is_enabled === true,
      effectiveFrom: str(s.effective_from),
      effectiveTo: str(s.effective_to),
    };
  };

  return (Array.isArray(data) ? data : []).map((row) => {
    const e = row as Record<string, unknown>;
    return {
      id: String(e.id),
      createdAt: String(e.created_at),
      action: (e.action === "DELETE" ? "DELETE" : e.action === "INSERT" ? "INSERT" : "UPDATE") as LinkHistoryEntry["action"],
      kind: e.kind === "vehicle_type" ? "vehicle_type" : "operation",
      appId: str(e.app_id),
      operationId: str(e.operation_id),
      vehicleTypeId: str(e.vehicle_type_id),
      before: state(e.before),
      after: state(e.after),
      changedFields: Array.isArray(e.changed_fields) ? (e.changed_fields as unknown[]).map(String) : [],
      userName: str(e.user_name),
    };
  });
}
