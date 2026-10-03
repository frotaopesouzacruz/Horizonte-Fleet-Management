import type { MtsrFilterOptions } from "@/lib/mtsr/queries";
import fixtures from "./fixtures.json";

/** Fixtures da prévia do MTSR: saídas das rotinas no formato do banco e opções de filtro derivadas. */
type Fx = typeof fixtures;
const FX = fixtures as Fx & Record<string, unknown>;

export function mtsrPreviewResolver(fn: string): unknown {
  switch (fn) {
    case "mtsr_catalog": return FX.catalog;
    case "mtsr_dashboard": return FX.dashboard;
    case "mtsr_fleet_status": return FX.fleet;
    case "mtsr_inspections_received": return FX.received;
    case "mtsr_inspection_detail": return FX.inspection_detail;
    case "mtsr_maintenance_links": return FX.maintenance_links;
    case "mtsr_ingestion_events": return FX.ingestion_events;
    case "mtsr_import_history": return FX.imports;
    case "mtsr_events_list": return FX.events;
    case "mtsr_health": return FX.health;
    case "mtsr_vehicle_sheet": return FX.vehicle_sheet;
    case "mtsr_vehicle_summary": return FX.vehicle_summary;
    default: return new Error(`rotina ${fn} sem fixture na prévia`);
  }
}

/** Opções de filtro derivadas dos próprios fixtures. */
export function mtsrPreviewOptions(): MtsrFilterOptions {
  const o = FX.options;
  return {
    operations: o.operations,
    coverage: o.coverage,
    brs: [],
    leaders: o.leaders,
    vehicleTypes: o.vehicle_types,
    subcategories: [],
    makes: [],
    models: [],
    units: [],
    apps: [],
    vehicles: o.vehicles,
  };
}

