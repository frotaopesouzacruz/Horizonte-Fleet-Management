import { Suspense } from "react";
import { notFound } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
import { FidelizationView } from "@/app/(app)/governanca/fidelizacao/fidelization-view";
import type { CoverageEntry } from "@/components/governance/scope-picker";
import type { Competence } from "@/lib/governance/competence";
import {
  COMPETENCE,
  DRIVER_PLANS,
  IMPORT_HISTORY,
  MATRIX,
  STABILITY,
  movementsPageFor,
} from "./fixture-central";
import { PLANNER_LEADERS, PLANNER_VEHICLE_TYPES } from "./fixture-planner";

/**
 * A Central de Fidelização inteira (Etapa 15) — a mesma `FidelizationView` da
 * rota real — com dados fixos de Setembro/2026. As prévias `planner` e `areas`
 * exercitam cada área isolada; esta confere o que só existe junto: as seis
 * abas, a aba guardada na URL e a competência preservada ao trocar de área.
 *
 * Mesmo portão das outras prévias: ausente de um build de produção normal. As
 * ações de gravação continuam as reais e, sem sessão, não gravam nada.
 */
export const metadata = {
  title: "Preview · Central de Fidelização (tela inteira)",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

const enabled =
  process.env.NODE_ENV !== "production" || process.env.NEXT_PUBLIC_ENABLE_DEV_PAGES === "1";

type SearchParams = Record<string, string | string[] | undefined>;

const first = (params: SearchParams, key: string): string | undefined => {
  const value = params[key];
  return Array.isArray(value) ? value[0] : value;
};

const OPERATIONS = [...new Map(MATRIX.rows.map((r) => [r.operationId, r.operationName])).entries()].map(
  ([id, name]) => ({ id, name, status: "active" }),
);

const COVERAGE: CoverageEntry[] = [
  ...new Map(
    MATRIX.rows.map((r) => [
      `${r.operationId}:${r.cityId}`,
      {
        operationId: r.operationId,
        operationCityId: `${r.operationId}:${r.cityId}`,
        stateId: r.stateId,
        uf: r.stateUf,
        cityId: r.cityId,
        cityName: r.cityName,
      },
    ]),
  ).values(),
];

export default async function PreviewCentralPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  if (!enabled) notFound();
  const params = await searchParams;

  // A competência muda na URL como na tela real; os dados fixos são de 09/2026.
  const year = Number(first(params, "ano")) || COMPETENCE.year;
  const month = Number(first(params, "mes")) || COMPETENCE.month;
  const competence: Competence = { year, month };
  const isFixtureMonth = year === COMPETENCE.year && month === COMPETENCE.month;

  const movementFilters = {
    dateFrom: first(params, "mov_de"),
    dateTo: first(params, "mov_ate"),
    movementType: first(params, "mov_tipo"),
    subject: first(params, "mov_assunto"),
    vehicle: first(params, "mov_veiculo"),
    driver: first(params, "mov_motorista"),
  };
  const page = Number(first(params, "mov_pagina") ?? "1") || 1;

  const matrix = isFixtureMonth
    ? MATRIX
    : { ...MATRIX, competence: `${year}-${String(month).padStart(2, "0")}`, total: 0, rows: [] };

  return (
    <AppShell
      permissions={[
        "fidelization.view",
        "fidelization.plan",
        "fidelization.change_vehicle",
        "fidelization.change_driver",
        "fidelization.import",
        "fidelization.export",
        "fidelization.audit",
      ]}
    >
      <Suspense fallback={null}>
        <FidelizationView
          brs={[]}
          history={[]}
          driverPlans={isFixtureMonth ? DRIVER_PLANS : []}
          hierarchy={[]}
          indicators={null}
          stability={isFixtureMonth ? STABILITY : null}
          plannerRows={[]}
          plannerIndicators={null}
          leaders={PLANNER_LEADERS}
          competence={competence}
          operations={OPERATIONS}
          coverage={COVERAGE}
          filters={{}}
          matrix={matrix}
          fleetFilters={{
            q: first(params, "q"),
            leaderEmployeeId: first(params, "lideranca"),
            vehicle: first(params, "placa"),
            vehicleTypeId: first(params, "tipo_equipamento"),
            situation: first(params, "alocacao"),
          }}
          vehicleTypes={PLANNER_VEHICLE_TYPES}
          movements={
            isFixtureMonth
              ? movementsPageFor(movementFilters, page, 50)
              : { total: 0, page: 1, pageSize: 50, counts: {}, reconstructed: 0, rows: [] }
          }
          movementFilters={movementFilters}
          importHistory={IMPORT_HISTORY}
          canPlan
          canChangeVehicle
          canChangeDriver
          canImport
          canAudit
          canExport
          canManageHistorical={first(params, "sem_historico") !== "1"}
        />
      </Suspense>
    </AppShell>
  );
}
