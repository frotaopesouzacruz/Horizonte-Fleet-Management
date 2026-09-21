import { notFound } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
import { EquipmentTypesView } from "@/app/(app)/frota/tipos-equipamento/equipment-types-view";
import { OverviewCards } from "@/app/(app)/frota/tipos-equipamento/overview";
import type { EquipmentOptions, EquipmentTypeRow, EquipmentTypeSummary } from "@/lib/equipment/queries";

/**
 * Renders Gestão de frota → Tipos de equipamento against fixed data.
 *
 * The real route needs a session. Same gate as the design system: absent from
 * a normal production build. The accessibility suite checks this markup in
 * light and dark without credentials — this screen mixes three badge scales
 * (situação, origem, avisos) in one table, which is the shape that fails
 * contrast in a single theme and goes unnoticed.
 */
export const metadata = {
  title: "Preview · Tipos de equipamento",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

const enabled =
  process.env.NODE_ENV !== "production" || process.env.NEXT_PUBLIC_ENABLE_DEV_PAGES === "1";

const OPTIONS: EquipmentOptions = {
  operations: [
    { id: "op1", label: "Last Mille MG", status: "active" },
    { id: "op2", label: "Merchandising", status: "active" },
    { id: "op3", label: "Redespacho", status: "active" },
    { id: "op4", label: "Redespacho - Belém", status: "inactive" },
  ],
  // Vazio de propósito: o Gerenciador de Aplicativos ainda não existe.
  apps: [],
  modules: [
    { code: "checklist", name: "Checklist de Frota", description: "Inspeções periódicas.", isAvailable: false },
    { code: "adherence", name: "Motor de Aderência", description: "Indicador de cumprimento.", isAvailable: false },
  ],
};

function row(overrides: Partial<EquipmentTypeRow> & { id: string; code: string; name: string }): EquipmentTypeRow {
  return {
    description: null,
    scope: "organization",
    isActive: true,
    isEnabled: true,
    effectiveStatus: "active",
    operationRestrictionEnabled: false,
    requiresSubcategory: false,
    subcategoryCount: 0,
    vehicleCount: 0,
    operationCount: 0,
    appCount: 0,
    moduleRuleCount: 0,
    updatedAt: "2026-09-18T14:20:00Z",
    ...overrides,
  };
}

const ROWS: EquipmentTypeRow[] = [
  row({
    id: "t1",
    code: "truck",
    name: "Caminhão",
    description: "Transporte de carga em rota interestadual",
    scope: "global",
    subcategoryCount: 6,
    vehicleCount: 61,
    operationRestrictionEnabled: true,
    operationCount: 2,
    requiresSubcategory: true,
  }),
  row({
    id: "t2",
    code: "van",
    name: "Van",
    scope: "global",
    subcategoryCount: 3,
    vehicleCount: 38,
    operationRestrictionEnabled: true,
    operationCount: 3,
  }),
  // Restrição ligada e nenhuma operação: o caso que a tabela precisa nomear
  // em vez de mostrar "0".
  row({
    id: "t3",
    code: "EQ-00001",
    name: "Frota leve administrativa",
    description: "Veículos de apoio, fora da operação de rota",
    subcategoryCount: 2,
    vehicleCount: 12,
    operationRestrictionEnabled: true,
    operationCount: 0,
  }),
  row({
    id: "t4",
    code: "EQ-00002",
    name: "Implemento rebocado",
    effectiveStatus: "inactive",
    isActive: false,
    vehicleCount: 4,
  }),
];

const SUMMARY: EquipmentTypeSummary = {
  total: 8,
  active: 7,
  inactive: 1,
  subcategoriesActive: 19,
  vehiclesLinked: 148,
  vehiclesWithoutSubcategory: 23,
};

export default function PreviewEquipmentTypesPage() {
  if (!enabled) notFound();

  const permissions = [
    "equipment_types.view",
    "equipment_types.create",
    "equipment_types.update",
    "equipment_types.deactivate",
    "equipment_types.manage_subcategories",
    "equipment_types.manage_operations",
    "equipment_types.manage_apps",
    "equipment_types.manage_eligibility",
  ];

  return (
    <AppShell
      permissions={permissions}
      topbar={{
        userName: "Pré-visualização",
        organizationName: "Horizonte Logística",
        organizations: [{ id: "org", name: "Horizonte Logística" }],
        activeOrganizationId: "org",
        unitName: "Todas as unidades",
      }}
    >
      <EquipmentTypesView
        rows={ROWS}
        options={OPTIONS}
        filters={{}}
        permissions={permissions}
        isPlatformAdmin={false}
        overview={<OverviewCards summary={SUMMARY} />}
      />
    </AppShell>
  );
}
