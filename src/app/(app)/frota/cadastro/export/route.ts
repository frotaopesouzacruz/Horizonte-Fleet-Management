import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getSessionContext, hasPermission } from "@/lib/auth/session";
import {
  listVehiclesForExport,
  type VehicleFilters,
  type VehicleSortKey,
} from "@/lib/fleet/queries";
import { buildWorkbook, buildCsv } from "@/lib/admin/spreadsheet";
import {
  FLEET_TEMPLATE_HEADERS,
  OWNERSHIP_LABELS,
  VEHICLE_STATUS_LABELS,
  ODOMETER_SOURCE_LABELS,
} from "@/lib/fleet/columns";

/**
 * Exports the fleet list currently on screen.
 *
 * The rows come from the same `security_invoker` read model the page uses, so
 * the file can only ever contain what the caller was already allowed to see —
 * the export is not a second, wider door into the data. Every export is
 * recorded (§61).
 */

const HEADERS = [
  "Frota",
  "Placa",
  "Situação",
  "Titularidade",
  "Tipo de Equipamento",
  "Subcategoria",
  "Marca",
  "Modelo",
  "Ano de Fabricação",
  "Ano do Modelo",
  "Operação",
  "Estado",
  "Cidade",
  "Alocado desde",
  "Filial",
  "Centro de Custo",
  "KM atual",
  "Data da leitura",
  "Origem da leitura",
  "Chassi",
  "RENAVAM",
  "ANTT",
  "Possui Tacógrafo",
  "Número do Tacógrafo",
  "Valor do Ativo",
  "Observações",
];

function formatDate(value: string | null | undefined): string {
  if (!value) return "";
  const [year, month, day] = value.split("-");
  return year && month && day ? `${day}/${month}/${year}` : value;
}

export async function GET(request: NextRequest) {
  const session = await getSessionContext();
  if (!session?.activeOrganization) {
    return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
  }
  if (!hasPermission(session, "vehicles.export")) {
    return NextResponse.json({ error: "Sem permissão para exportar." }, { status: 403 });
  }

  const organizationId = session.activeOrganization.organizationId;
  const params = request.nextUrl.searchParams;
  const requested = params.get("format");
  const format = requested === "csv" ? "csv" : "xlsx";
  const isTemplate = requested === "template";

  // The empty file with the supported columns: the import template.
  if (isTemplate) {
    const buffer = await buildWorkbook("Frotas", FLEET_TEMPLATE_HEADERS, []);
    return fileResponse(buffer, "modelo-importacao-frotas.xlsx", "xlsx");
  }

  const filters: VehicleFilters = {
    q: params.get("q") ?? undefined,
    status: params.get("status") ?? undefined,
    ownership: params.get("ownership") ?? undefined,
    type: params.get("type") ?? undefined,
    subcategory: params.get("subcategory") ?? undefined,
    operation: params.get("operation") ?? undefined,
    state: params.get("state") ?? undefined,
    city: params.get("city") ?? undefined,
    unit: params.get("unit") ?? undefined,
    archived: params.get("archived") === "1",
    sort: (params.get("sort") as VehicleSortKey | null) ?? undefined,
    dir: params.get("dir") === "desc" ? "desc" : "asc",
  };

  const rows = await listVehiclesForExport(organizationId, filters);

  const data = rows.map((row) => [
    row.fleet_code ?? "",
    row.license_plate ?? "",
    VEHICLE_STATUS_LABELS[row.status ?? ""] ?? row.status ?? "",
    OWNERSHIP_LABELS[row.ownership_type ?? ""] ?? row.ownership_type ?? "",
    row.vehicle_type_name ?? "",
    row.vehicle_subcategory_name ?? "",
    row.vehicle_make_name ?? "",
    row.vehicle_model_name ?? "",
    row.manufacture_year ?? "",
    row.model_year ?? "",
    row.operation_name ?? "",
    row.state_uf ?? "",
    row.city_name ?? "",
    formatDate(row.assigned_since),
    row.organization_unit_name ?? "",
    row.cost_center_name ?? "",
    // An empty cell, never a zero: a vehicle with no reading has no kilometres.
    row.current_odometer_km ?? "",
    formatDate(row.odometer_reading_date),
    row.odometer_source ? (ODOMETER_SOURCE_LABELS[row.odometer_source] ?? row.odometer_source) : "",
    row.vin ?? "",
    row.renavam ?? "",
    row.antt_code ?? "",
    row.has_tachograph ? "Sim" : "Não",
    row.tachograph_number ?? "",
    row.asset_value ?? "",
    row.notes ?? "",
  ]);

  const supabase = await createClient();
  await supabase.rpc("log_vehicle_export", {
    p_organization_id: organizationId,
    p_format: format,
    p_row_count: rows.length,
  });

  const stamp = new Date().toISOString().slice(0, 10);
  const name = `frotas-${stamp}.${format}`;
  const buffer =
    format === "csv" ? buildCsv(HEADERS, data) : await buildWorkbook("Frotas", HEADERS, data);

  return fileResponse(buffer, name, format);
}

function fileResponse(buffer: Buffer, fileName: string, format: "csv" | "xlsx") {
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "content-type":
        format === "csv"
          ? "text/csv; charset=utf-8"
          : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "content-disposition": `attachment; filename="${fileName}"`,
      "cache-control": "no-store",
    },
  });
}
