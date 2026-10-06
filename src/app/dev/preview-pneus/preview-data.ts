import fixtures from "./fixtures.json";

/**
 * Fixtures da prévia da Gestão de Pneus: saídas das rotinas no formato do
 * banco, geradas numa base LOCAL de teste com duas fotografias (uma
 * sintética, derivada do Rodopar 10 real, e o próprio Rodopar 10), vistorias
 * enviadas pela rotina do aplicativo e um lote validado aguardando
 * confirmação. Os nomes de operação/liderança são fictícios (a base local
 * não tem operações) e os usuários do Rodopar foram anonimizados.
 */
const FX = fixtures as unknown as Record<string, unknown>;

const byPrefix = (prefix: string, id: unknown): unknown => {
  if (typeof id === "string" && FX[`${prefix}:${id}`]) return FX[`${prefix}:${id}`];
  const first = Object.keys(FX).find((k) => k.startsWith(`${prefix}:`));
  return first ? FX[first] : new Error(`sem fixture ${prefix}`);
};

/** Lista de vistorias recebidas filtrada pelas situações pedidas (como o banco faria). */
function received(args: Record<string, unknown>): unknown {
  const base = FX.received as { rows: { status: string }[]; total: number } & Record<string, unknown>;
  const filters = (args.p_filters ?? {}) as { statuses?: string[] };
  if (!filters.statuses?.length) return base;
  const rows = base.rows.filter((r) => filters.statuses!.includes(r.status));
  return { ...base, rows, total: rows.length };
}

export function tiresPreviewResolver(fn: string, args: Record<string, unknown>): unknown {
  switch (fn) {
    case "tires_filter_options": return FX.options;
    case "tires_overview": return FX.overview;
    case "tires_base": return FX[`base_${args.p_view === "fogo" || args.p_view === "fora" ? args.p_view : "frota"}`];
    case "tires_adherence": return FX[args.p_kind === "calibration" ? "adh_calibration" : "adh_measurement"];
    case "tires_schedule": return FX.schedule;
    case "tires_quality": return FX.quality;
    case "tires_events_list": return FX.events;
    case "tires_audit_list": return FX.audit;
    case "tires_catalog": return FX.catalog;
    case "tire_import_history": return FX.import_history;
    case "tire_import_preview": return FX[`preview_${typeof args.p_section === "string" ? args.p_section : "issues"}`] ?? FX.preview_issues;
    case "tire_inspections_received": return received(args);
    case "tire_inspection_detail": return byPrefix("inspection_detail", args.p_inspection_id);
    case "tire_sheet": return byPrefix("sheet", args.p_tire_id);
    case "tires_vehicle_summary": return byPrefix("vehicle_summary", args.p_vehicle_id);
    case "tire_repairs_list": return FX.repairs;
    case "tire_maintenance_services": return FX.maintenance;
    case "tire_repair_resolve": return FX.repair_resolve;
    case "tire_inspection_context": return FX.app_context;
    case "tire_inspection_vehicles": return FX.app_vehicles;
    case "tire_inspection_positions": return byPrefix("app_positions", args.p_vehicle_id);
    case "tire_my_inspections": return FX.my_inspections;
    case "tire_my_inspection_detail": return byPrefix("my_detail", args.p_inspection_id);
    default: return new Error(`rotina ${fn} sem fixture na prévia`);
  }
}

/** Ids presentes nos fixtures (para os links das prévias). */
export const previewIds = {
  sheets: Object.keys(FX).filter((k) => k.startsWith("sheet:")).map((k) => k.slice(6)),
  inspections: Object.keys(FX).filter((k) => k.startsWith("inspection_detail:")).map((k) => k.slice(18)),
  vehicles: Object.keys(FX).filter((k) => k.startsWith("app_positions:")).map((k) => k.slice(14)),
};
