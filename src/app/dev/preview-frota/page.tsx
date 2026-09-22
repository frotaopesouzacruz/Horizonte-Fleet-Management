import { notFound } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
import { FleetView } from "@/app/(app)/frota/cadastro/fleet-view";
import { OverviewCards, OperationDistribution } from "@/app/(app)/frota/cadastro/overview";
import type { FleetOptions, VehiclePage, VehicleSummary } from "@/lib/fleet/queries";

/**
 * Renders Gestão de frota → Cadastro de frotas against fixed data.
 *
 * The real route needs a session, which makes it impossible to look at from an
 * environment that cannot reach Supabase. Same gate as the design system:
 * absent from a normal production build. The accessibility suite checks this
 * markup in light and dark without credentials — and this screen has sixteen
 * columns, nine filters, six indicators and three badge scales, which is
 * exactly the shape that fails contrast in one theme only and is never noticed.
 */
export const metadata = { title: "Preview · Cadastro de frotas", robots: { index: false, follow: false } };

export const dynamic = "force-dynamic";

const enabled =
  process.env.NODE_ENV !== "production" || process.env.NEXT_PUBLIC_ENABLE_DEV_PAGES === "1";

const OPTIONS: FleetOptions = {
  types: [
    { id: "t1", label: "Caminhão", isActive: true, requiresSubcategory: true },
    { id: "t2", label: "Van", isActive: true, requiresSubcategory: false },
    { id: "t3", label: "Utilitário", isActive: true, requiresSubcategory: false },
    { id: "t4", label: "Automóvel", isActive: true, requiresSubcategory: false },
    { id: "t5", label: "Motocicleta", isActive: false, requiresSubcategory: false },
  ],
  subcategories: [
    { id: "s1", label: "Baú", vehicleTypeId: "t1" },
    { id: "s2", label: "Sider", vehicleTypeId: "t1" },
    { id: "s3", label: "Refrigerado", vehicleTypeId: "t1" },
    { id: "s4", label: "Van de carga", vehicleTypeId: "t2" },
    { id: "s5", label: "Furgão", vehicleTypeId: "t3" },
  ],
  makes: [
    { id: "m1", label: "Mercedes-Benz" },
    { id: "m2", label: "Volkswagen" },
    { id: "m3", label: "Fiat" },
  ],
  models: [
    { id: "mo1", label: "Sprinter 417 CDI", vehicleMakeId: "m1" },
    { id: "mo2", label: "Delivery 11.180", vehicleMakeId: "m2" },
    { id: "mo3", label: "Fiorino", vehicleMakeId: "m3" },
  ],
  operations: [
    { id: "op1", label: "Last Mille MG" },
    { id: "op2", label: "Merchandising" },
    { id: "op3", label: "Redespacho" },
  ],
  units: [
    { id: "u1", label: "Matriz Contagem" },
    { id: "u2", label: "Filial Uberlândia" },
  ],
  costCenters: [
    { id: "cc1", label: "CC-100 · Distribuição" },
    { id: "cc2", label: "CC-200 · Merchandising" },
  ],
};

type Row = VehiclePage["rows"][number];

/** A row with every column filled in, so the widths are exercised honestly. */
function row(overrides: Partial<Row> & { id: string }): Row {
  return {
    organization_id: "org",
    fleet_code: null,
    license_plate: null,
    vin: null,
    renavam: null,
    status: "active",
    ownership_type: "owned",
    asset_value: null,
    antt_code: null,
    has_tachograph: false,
    tachograph_number: null,
    notes: null,
    manufacture_year: null,
    model_year: null,
    deleted_at: null,
    created_at: "2026-01-10T12:00:00Z",
    updated_at: "2026-09-01T12:00:00Z",
    vehicle_type_id: "t1",
    vehicle_type_name: "Caminhão",
    vehicle_type_code: "truck",
    vehicle_subcategory_id: null,
    vehicle_subcategory_name: null,
    vehicle_model_id: null,
    vehicle_model_name: null,
    vehicle_make_id: null,
    vehicle_make_name: null,
    organization_unit_id: null,
    organization_unit_name: null,
    cost_center_id: null,
    cost_center_name: null,
    assignment_id: null,
    operation_id: null,
    operation_name: null,
    state_id: null,
    state_uf: null,
    state_name: null,
    city_id: null,
    city_name: null,
    assigned_since: null,
    assigned_until: null,
    scheduled_assignment_id: null,
    scheduled_operation_id: null,
    scheduled_operation_name: null,
    scheduled_city_id: null,
    scheduled_city_name: null,
    scheduled_state_uf: null,
    scheduled_from: null,
    current_odometer_km: null,
    odometer_reading_date: null,
    odometer_source: null,
    search_text: null,
    ...overrides,
  } as Row;
}

const ROWS: Row[] = [
  row({
    id: "v1",
    fleet_code: "000123",
    license_plate: "RTA1B23",
    vin: "9BWZZZ377VT004251",
    renavam: "00123456789",
    vehicle_subcategory_id: "s1",
    vehicle_subcategory_name: "Baú",
    vehicle_model_name: "Delivery 11.180",
    vehicle_make_name: "Volkswagen",
    manufacture_year: 2021,
    model_year: 2022,
    asset_value: 289900,
    operation_id: "op1",
    operation_name: "Last Mille MG",
    state_uf: "MG",
    city_name: "Contagem",
    assigned_since: "2026-03-01",
    organization_unit_name: "Matriz Contagem",
    cost_center_name: "CC-100 · Distribuição",
    current_odometer_km: 118500,
    odometer_reading_date: "2026-09-18",
    odometer_source: "manual_correction",
  }),
  row({
    id: "v2",
    fleet_code: "000456",
    license_plate: "RTE5E55",
    vehicle_type_name: "Van",
    vehicle_subcategory_name: "Van de carga",
    vehicle_make_name: "Mercedes-Benz",
    vehicle_model_name: "Sprinter 417 CDI",
    ownership_type: "rented",
    manufacture_year: 2023,
    model_year: 2023,
    operation_id: "op2",
    operation_name: "Merchandising",
    state_uf: "MG",
    city_name: "Uberlândia",
    assigned_since: "2026-06-15",
    current_odometer_km: 42310,
    odometer_reading_date: "2026-09-19",
    odometer_source: "initial_registration",
  }),
  // Transferência já programada: a coluna Operação mostra a data, não a cidade
  // nova, porque a cidade nova só passa a valer depois.
  row({
    id: "v3",
    fleet_code: "0012",
    license_plate: "RTC3C33",
    vehicle_type_name: "Utilitário",
    vehicle_make_name: "Fiat",
    vehicle_model_name: "Fiorino",
    scheduled_operation_id: "op1",
    scheduled_operation_name: "Last Mille MG",
    scheduled_city_name: "Juiz de Fora",
    scheduled_state_uf: "MG",
    scheduled_from: "2026-10-01",
    current_odometer_km: 9870,
    odometer_reading_date: "2026-09-10",
    odometer_source: "import",
  }),
  // Sem alocação e sem leitura: o traço é o valor honesto, nunca um zero.
  row({
    id: "v4",
    fleet_code: "F-0099",
    license_plate: "RTD4D44",
    vehicle_type_name: "Motocicleta",
    vehicle_subcategory_name: "Motocicleta com baú",
    ownership_type: "leased",
    status: "inactive",
  }),
];

const SUMMARY: VehicleSummary = {
  total: 148,
  active: 131,
  inactive: 17,
  owned: 96,
  rented: 52,
  unassigned: 9,
  scheduledOnly: 3,
  operationCount: 4,
  assetValueTotal: 21483900,
  assetValueKnown: 112,
  assetValueUnknown: 36,
  byOperation: [
    { operationId: "op1", operationName: "Last Mille MG", count: 74 },
    { operationId: "op2", operationName: "Merchandising", count: 38 },
    { operationId: "op3", operationName: "Redespacho", count: 21 },
    { operationId: "op4", operationName: "Redespacho - Belém", count: 6 },
    { operationId: null, operationName: "Sem alocação", count: 9 },
  ],
};

export default function PreviewFleetPage() {
  if (!enabled) notFound();

  return (
    <AppShell
      topbar={{
        userName: "Pré-visualização",
        organizationName: "Horizonte Logística",
        organizations: [{ id: "org", name: "Horizonte Logística" }],
        activeOrganizationId: "org",
        unitName: "Todas as unidades",
      }}
      permissions={[
        "vehicles.view",
        "vehicles.create",
        "vehicles.update",
        "vehicles.archive",
        "vehicles.import",
        "vehicles.export",
        "vehicles.manage_assignment",
        "vehicles.correct_odometer",
        "fidelization.view",
      ]}
    >
      <FleetView
        page={{ rows: ROWS, total: 148, page: 1, pageSize: 25, pageCount: 6 }}
        options={OPTIONS}
        filters={{ sort: "fleet_code", dir: "asc", page: 1, pageSize: 25 }}
        permissions={[
          "vehicles.view",
          "vehicles.create",
          "vehicles.update",
          "vehicles.archive",
          "vehicles.import",
          "vehicles.export",
          "vehicles.manage_assignment",
          "vehicles.correct_odometer",
          // A aba "Fidelização" da ficha do veículo depende desta permissão.
          "fidelization.view",
        ]}
        isPlatformAdmin={false}
        overview={
          <div className="flex flex-col gap-2">
            <OverviewCards summary={SUMMARY} />
            <div className="flex">
              <OperationDistribution summary={SUMMARY} />
            </div>
          </div>
        }
      />
    </AppShell>
  );
}
