import { notFound } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
import { OperationsView } from "@/app/(app)/organizacao/operacoes/operations-view";
import { OperationDetailView } from "@/app/(app)/organizacao/operacoes/[id]/operation-detail-view";
import type { CoverageInput } from "@/lib/organization/actions";
import type { CoverageState, OperationSummary } from "@/lib/organization/operations";

/**
 * Renders the Operações screens against fixed data.
 *
 * Both sit behind a session, which makes them impossible to look at from an
 * environment that cannot reach Supabase. Same gate as the design system:
 * absent from a normal production build. The accessibility suite uses this
 * route to check them in light and dark without credentials.
 */
export const metadata = { title: "Preview · Operações", robots: { index: false, follow: false } };

export const dynamic = "force-dynamic";

const enabled =
  process.env.NODE_ENV !== "production" || process.env.NEXT_PUBLIC_ENABLE_DEV_PAGES === "1";

const STATES = [
  { stateId: 31, uf: "MG", name: "Minas Gerais", region: "Sudeste" },
  { stateId: 35, uf: "SP", name: "São Paulo", region: "Sudeste" },
  { stateId: 33, uf: "RJ", name: "Rio de Janeiro", region: "Sudeste" },
  { stateId: 52, uf: "GO", name: "Goiás", region: "Centro-Oeste" },
  { stateId: 51, uf: "MT", name: "Mato Grosso", region: "Centro-Oeste" },
  { stateId: 53, uf: "DF", name: "Distrito Federal", region: "Centro-Oeste" },
  { stateId: 15, uf: "PA", name: "Pará", region: "Norte" },
  { stateId: 29, uf: "BA", name: "Bahia", region: "Nordeste" },
];

const OPERATIONS: OperationSummary[] = [
  { id: "1", code: "OP-00004", name: "Last Mille MG", description: "Entrega urbana e last mile em Minas Gerais.", status: "active", updatedAt: "2026-09-19T10:00:00Z", employeeCount: 101, accessCount: 1, locationCount: 12, stateCount: 1, cityCount: 13 },
  { id: "2", code: "OP-00005", name: "Merchandising", description: "Cobertura multiestado de ponto de venda.", status: "active", updatedAt: "2026-09-18T14:30:00Z", employeeCount: 15, accessCount: 0, locationCount: 5, stateCount: 4, cityCount: 5 },
  { id: "3", code: "OP-00006", name: "Redespacho", description: null, status: "active", updatedAt: "2026-09-12T09:15:00Z", employeeCount: 9, accessCount: 0, locationCount: 3, stateCount: 1, cityCount: 1 },
  { id: "4", code: "OP-00007", name: "Redespacho - Belém", description: null, status: "active", updatedAt: "2026-09-12T09:15:00Z", employeeCount: 6, accessCount: 0, locationCount: 1, stateCount: 1, cityCount: 2 },
  { id: "5", code: "OP-00001", name: "Frota", description: null, status: "active", updatedAt: "2026-09-01T08:00:00Z", employeeCount: 5, accessCount: 0, locationCount: 2, stateCount: 1, cityCount: 1 },
  { id: "6", code: "OP-00008", name: "Segurança", description: null, status: "inactive", updatedAt: "2026-08-20T11:00:00Z", employeeCount: 1, accessCount: 0, locationCount: 1, stateCount: 1, cityCount: 1 },
];

const COVERAGE: CoverageState[] = [
  {
    stateId: 31,
    uf: "MG",
    name: "Minas Gerais",
    region: "Sudeste",
    cities: [
      { cityId: 3118601, name: "Contagem", isCapital: false, ddd: 31, employeeCount: 53 },
      { cityId: 3136702, name: "Juiz de Fora", isCapital: false, ddd: 32, employeeCount: 11 },
      { cityId: 3170206, name: "Uberlândia", isCapital: false, ddd: 34, employeeCount: 11 },
      { cityId: 3122306, name: "Divinópolis", isCapital: false, ddd: 37, employeeCount: 5 },
      { cityId: 3127701, name: "Governador Valadares", isCapital: false, ddd: 33, employeeCount: 2 },
    ],
  },
  {
    stateId: 52,
    uf: "GO",
    name: "Goiás",
    region: "Centro-Oeste",
    cities: [{ cityId: 5208707, name: "Goiânia", isCapital: true, ddd: 62, employeeCount: 3 }],
  },
];

const COVERAGE_BY_ID: Record<string, CoverageInput[]> = Object.fromEntries(
  OPERATIONS.map((operation) => [
    operation.id,
    COVERAGE.map((state) => ({ stateId: state.stateId, cityIds: state.cities.map((c) => c.cityId) })),
  ]),
);

export default function PreviewPage() {
  if (!enabled) notFound();

  return (
    <AppShell permissions={["operations.view", "operations.manage", "users.view"]}>
      <OperationsView
        operations={OPERATIONS}
        coverage={COVERAGE_BY_ID}
        states={STATES}
        includeInactive
        canCreate
        canUpdate
        canDeactivate
        canManageApps
        canViewAppHistory
      />
      <OperationDetailView
        operation={{
          id: "1",
          code: "OP-00004",
          name: "Last Mille MG",
          description: "Entrega urbana e last mile em Minas Gerais.",
          status: "active",
        }}
        coverage={COVERAGE}
        states={STATES}
        canUpdate
        canManageGeography
        links={{
          apps: [
            { id: "app-1", code: "checklist_frota", name: "Check List de Frota", slug: "check-list-frota", isActive: true },
          ],
          operations: [{ id: "1", code: "OP-00004", name: "Last Mille MG", status: "active" }],
          vehicleTypes: [],
          operationLinks: [
            {
              appId: "app-1", operationId: "1", isEnabled: true, effectiveFrom: null, effectiveTo: null,
              updatedAt: "2026-09-22T10:00:00Z", inForce: true,
            },
          ],
          typeLinks: [],
        }}
        canManageApps
        canViewAppHistory
        canViewBrs
      />
    </AppShell>
  );
}
