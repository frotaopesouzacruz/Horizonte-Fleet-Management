import "server-only";

import { createClient } from "@/lib/supabase/server";
import { getMaintenanceFilterOptions, type MaintenanceFilterOptions } from "@/lib/maintenance/queries";

/**
 * Opções dos filtros do KM — das fontes oficiais (operações e cobertura, BRs,
 * lideranças, tipos, subcategorias, modelos, filiais) mais a lista de
 * veículos visíveis para a pessoa (RLS), usada na busca por placa e no
 * Histórico por frota. Nenhuma lista paralela.
 */
export interface KmVehicleOption {
  id: string;
  plate: string;
  fleetCode: string | null;
  status: string;
  vehicleTypeId: string | null;
  subcategoryId: string | null;
  modelId: string | null;
}

export type KmFilterOptions = MaintenanceFilterOptions & { vehicles: KmVehicleOption[] };

export async function getKmFilterOptions(organizationId: string): Promise<KmFilterOptions> {
  const supabase = await createClient();
  const [base, vehicles] = await Promise.all([
    getMaintenanceFilterOptions(organizationId),
    supabase
      .from("vehicles")
      .select("id, license_plate, fleet_code, status, vehicle_type_id, vehicle_subcategory_id, vehicle_model_id")
      .eq("organization_id", organizationId)
      .is("deleted_at", null)
      .order("license_plate"),
  ]);
  return {
    ...base,
    vehicles: (vehicles.data ?? []).map((v) => ({
      id: v.id,
      plate: v.license_plate ?? v.fleet_code ?? "—",
      fleetCode: v.fleet_code,
      status: v.status,
      vehicleTypeId: v.vehicle_type_id,
      subcategoryId: v.vehicle_subcategory_id,
      modelId: v.vehicle_model_id,
    })),
  };
}
