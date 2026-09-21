import "server-only";

import { createClient } from "@/lib/supabase/server";

/**
 * The equipment type service.
 *
 * "Tipo de Equipamento" is the module's name; `vehicle_types` is the table it
 * has always been. The Etapa 06 fleet registry already points at it, so
 * creating an `equipment_types` beside it would have been the competing
 * catalogue the spec forbids. One concept, one table, two vocabularies.
 *
 * Two scopes live in that table and the difference matters everywhere:
 *
 *   global        the platform's base catalogue, shared by every organization
 *   organization  a type this organization created and maintains
 *
 * Classification is shared; parametrisation never is. Which operations admit a
 * type, which apps use it and which modules count it are decisions of each
 * organization, including for the shared types.
 */

export interface EquipmentTypeRow {
  id: string;
  code: string;
  name: string;
  description: string | null;
  scope: "global" | "organization";
  isActive: boolean;
  isEnabled: boolean;
  effectiveStatus: "active" | "inactive";
  operationRestrictionEnabled: boolean;
  requiresSubcategory: boolean;
  subcategoryCount: number;
  vehicleCount: number;
  operationCount: number;
  appCount: number;
  moduleRuleCount: number;
  updatedAt: string | null;
}

export interface EquipmentTypeFilters {
  q?: string;
  status?: string;
  scope?: string;
  operation?: string;
  app?: string;
}

export async function listEquipmentTypes(
  organizationId: string,
  filters: EquipmentTypeFilters = {},
): Promise<EquipmentTypeRow[]> {
  const supabase = await createClient();

  const payload: Record<string, string> = {};
  if (filters.q) payload.q = filters.q;
  if (filters.status) payload.status = filters.status;
  if (filters.scope) payload.scope = filters.scope;
  if (filters.operation) payload.operation = filters.operation;
  if (filters.app) payload.app = filters.app;

  const { data, error } = await supabase.rpc("list_equipment_types", {
    p_organization_id: organizationId,
    p_filters: payload,
  });

  if (error) throw new Error(error.message);

  return (data ?? []).map((row) => ({
    id: row.id,
    code: row.code,
    name: row.name,
    description: row.description,
    scope: row.scope === "global" ? "global" : "organization",
    isActive: Boolean(row.is_active),
    isEnabled: Boolean(row.is_enabled),
    effectiveStatus: row.effective_status === "active" ? "active" : "inactive",
    operationRestrictionEnabled: Boolean(row.operation_restriction_enabled),
    requiresSubcategory: Boolean(row.requires_subcategory),
    subcategoryCount: Number(row.subcategory_count ?? 0),
    vehicleCount: Number(row.vehicle_count ?? 0),
    operationCount: Number(row.operation_count ?? 0),
    appCount: Number(row.app_count ?? 0),
    moduleRuleCount: Number(row.module_rule_count ?? 0),
    updatedAt: row.updated_at,
  }));
}

export interface EquipmentTypeSummary {
  total: number;
  active: number;
  inactive: number;
  subcategoriesActive: number;
  vehiclesLinked: number;
  vehiclesWithoutSubcategory: number;
}

export async function getEquipmentTypeSummary(
  organizationId: string,
): Promise<EquipmentTypeSummary> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("equipment_type_summary", {
    p_organization_id: organizationId,
  });
  if (error) throw new Error(error.message);

  const raw = (data ?? {}) as Record<string, unknown>;
  const num = (key: string) => Number(raw[key] ?? 0);
  return {
    total: num("total"),
    active: num("active"),
    inactive: num("inactive"),
    subcategoriesActive: num("subcategories_active"),
    vehiclesLinked: num("vehicles_linked"),
    vehiclesWithoutSubcategory: num("vehicles_without_subcategory"),
  };
}

/* ------------------------------------------------------------------ detail */

export interface EquipmentSubcategory {
  id: string;
  name: string;
  description: string | null;
  isActive: boolean;
  scope: "global" | "organization";
  vehicleCount: number;
}

export interface EquipmentTypeOperationLink {
  operationId: string;
  operationName: string;
  operationStatus: string;
}

export interface EquipmentTypeAppLink {
  appId: string;
  appName: string;
}

export interface ModuleRule {
  moduleCode: string;
  capability: "visibility" | "operation" | "indicator";
  isEligible: boolean;
  effectiveFrom: string;
  reason: string | null;
}

export interface EquipmentTypeDetail {
  id: string;
  code: string;
  name: string;
  description: string | null;
  scope: "global" | "organization";
  isActive: boolean;
  isEnabled: boolean;
  updatedAt: string;
  settings: {
    operationRestrictionEnabled: boolean;
    requiresSubcategory: boolean;
    notes: string | null;
  };
  subcategories: EquipmentSubcategory[];
  operations: EquipmentTypeOperationLink[];
  apps: EquipmentTypeAppLink[];
  moduleRules: ModuleRule[];
}

export async function getEquipmentType(
  organizationId: string,
  typeId: string,
): Promise<EquipmentTypeDetail | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_equipment_type", {
    p_organization_id: organizationId,
    p_vehicle_type_id: typeId,
  });
  if (error || !data) return null;

  const raw = data as Record<string, unknown>;
  const settings = (raw.settings ?? {}) as Record<string, unknown>;

  return {
    id: String(raw.id),
    code: String(raw.code),
    name: String(raw.name),
    description: (raw.description as string | null) ?? null,
    scope: raw.scope === "global" ? "global" : "organization",
    isActive: Boolean(raw.is_active),
    isEnabled: Boolean(raw.is_enabled),
    updatedAt: String(raw.updated_at),
    settings: {
      operationRestrictionEnabled: Boolean(settings.operation_restriction_enabled),
      requiresSubcategory: Boolean(settings.requires_subcategory),
      notes: (settings.notes as string | null) ?? null,
    },
    subcategories: (Array.isArray(raw.subcategories) ? raw.subcategories : []).map((entry) => {
      const item = entry as Record<string, unknown>;
      return {
        id: String(item.id),
        name: String(item.name),
        description: (item.description as string | null) ?? null,
        isActive: Boolean(item.is_active),
        scope: item.scope === "global" ? "global" : "organization",
        vehicleCount: Number(item.vehicle_count ?? 0),
      };
    }),
    operations: (Array.isArray(raw.operations) ? raw.operations : []).map((entry) => {
      const item = entry as Record<string, unknown>;
      return {
        operationId: String(item.operation_id),
        operationName: String(item.operation_name),
        operationStatus: String(item.operation_status ?? "active"),
      };
    }),
    apps: (Array.isArray(raw.apps) ? raw.apps : []).map((entry) => {
      const item = entry as Record<string, unknown>;
      return { appId: String(item.app_id), appName: String(item.app_name) };
    }),
    moduleRules: (Array.isArray(raw.module_rules) ? raw.module_rules : []).map((entry) => {
      const item = entry as Record<string, unknown>;
      return {
        moduleCode: String(item.module_code),
        capability: item.capability as ModuleRule["capability"],
        isEligible: Boolean(item.is_eligible),
        effectiveFrom: String(item.effective_from),
        reason: (item.reason as string | null) ?? null,
      };
    }),
  };
}

/* ------------------------------------------------------------------ impact */

export interface EquipmentTypeImpact {
  vehiclesTotal: number;
  vehiclesActive: number;
  vehiclesInactive: number;
  vehiclesArchived: number;
  vehiclesAllocated: number;
  subcategoriesTotal: number;
  subcategoriesActive: number;
  operationsLinked: number;
  operationsWithVehicles: { operationId: string; operationName: string; vehicleCount: number }[];
  appsLinked: number;
  moduleRules: number;
  /** Modules the HFM does not implement yet. Not zero — unknown. */
  pendingModules: { moduleCode: string; moduleName: string }[];
}

/**
 * The count the HFC never made.
 *
 * Its impact analysis returned an empty list whatever the data, so the screen
 * cheerfully reported that deactivating a category would affect nobody. Every
 * number here is a query, and a dependency the product does not have yet comes
 * back as "not available", never as zero.
 */
export async function getEquipmentTypeImpact(
  organizationId: string,
  typeId: string,
): Promise<EquipmentTypeImpact> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("equipment_type_impact", {
    p_organization_id: organizationId,
    p_vehicle_type_id: typeId,
  });
  if (error) throw new Error(error.message);

  const raw = (data ?? {}) as Record<string, unknown>;
  const num = (key: string) => Number(raw[key] ?? 0);

  return {
    vehiclesTotal: num("vehicles_total"),
    vehiclesActive: num("vehicles_active"),
    vehiclesInactive: num("vehicles_inactive"),
    vehiclesArchived: num("vehicles_archived"),
    vehiclesAllocated: num("vehicles_allocated"),
    subcategoriesTotal: num("subcategories_total"),
    subcategoriesActive: num("subcategories_active"),
    operationsLinked: num("operations_linked"),
    operationsWithVehicles: (Array.isArray(raw.operations_with_vehicles)
      ? raw.operations_with_vehicles
      : []
    ).map((entry) => {
      const item = entry as Record<string, unknown>;
      return {
        operationId: String(item.operation_id),
        operationName: String(item.operation_name),
        vehicleCount: Number(item.vehicle_count ?? 0),
      };
    }),
    appsLinked: num("apps_linked"),
    moduleRules: num("module_rules"),
    pendingModules: (Array.isArray(raw.pending_modules) ? raw.pending_modules : []).map((entry) => {
      const item = entry as Record<string, unknown>;
      return { moduleCode: String(item.module_code), moduleName: String(item.module_name) };
    }),
  };
}

/* ---------------------------------------------------------------- options */

export interface EquipmentOptions {
  operations: { id: string; label: string; status: string }[];
  /** Empty until the Gerenciador de Aplicativos exists. No fixtures. */
  apps: { id: string; label: string }[];
  modules: { code: string; name: string; description: string; isAvailable: boolean }[];
}

export async function getEquipmentOptions(organizationId: string): Promise<EquipmentOptions> {
  const supabase = await createClient();

  const [operations, apps, modules] = await Promise.all([
    supabase
      .from("operations")
      .select("id, name, status")
      .eq("organization_id", organizationId)
      .is("deleted_at", null)
      .order("name"),
    supabase
      .from("operational_apps")
      .select("id, name")
      .eq("organization_id", organizationId)
      .is("deleted_at", null)
      .eq("is_active", true)
      .order("name"),
    supabase
      .from("operational_modules")
      .select("code, name, description, is_available")
      .order("sort_order"),
  ]);

  return {
    operations: (operations.data ?? []).map((row) => ({
      id: row.id,
      label: row.name,
      status: row.status,
    })),
    apps: (apps.data ?? []).map((row) => ({ id: row.id, label: row.name })),
    modules: (modules.data ?? []).map((row) => ({
      code: row.code,
      name: row.name,
      description: row.description,
      isAvailable: Boolean(row.is_available),
    })),
  };
}
