import type { Metadata } from "next";
import { requireOrganization } from "@/lib/auth/session";
import {
  getFidelizationCalendar,
  getFidelizationIndicators,
  getGovernanceOptions,
  getOperationalHierarchy,
  listDriverPlans,
  listFidelizationHistory,
  listOperationBrs,
  type FidelizationIndicators,
  type HierarchyOperation,
} from "@/lib/governance/queries";
import { parseCompetence } from "@/lib/governance/competence";
import { FidelizationView } from "./fidelization-view";

export const metadata: Metadata = {
  title: "Fidelização",
  description: "Planejamento das posições operacionais por veículo e motorista, por competência.",
};

type SearchParams = Record<string, string | string[] | undefined>;

const first = (params: SearchParams, key: string): string | undefined => {
  const value = params[key];
  return Array.isArray(value) ? value[0] : value;
};

/**
 * Governança Operacional → Fidelização.
 *
 * The route re-checks `fidelization.view` server-side, and every query runs
 * under the caller's own client — so the operation scope decides which
 * positions, vehicles and drivers come back, not this page.
 */
export default async function FidelizationPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const { session, organization } = await requireOrganization("fidelization.view");

  const competence = parseCompetence(first(params, "ano"), first(params, "mes"));
  const filters = {
    operationId: first(params, "operacao"),
    stateId: first(params, "uf"),
    cityId: first(params, "cidade"),
    brId: first(params, "br"),
  };

  const orgId = organization.organizationId;

  const [calendar, brs, history, driverPlans, options, hierarchy, indicators] = await Promise.all([
    getFidelizationCalendar(orgId, competence, filters),
    listOperationBrs(orgId, {
      operationId: filters.operationId,
      stateId: filters.stateId,
      cityId: filters.cityId,
    }),
    listFidelizationHistory(orgId, competence, filters),
    listDriverPlans(orgId, competence, filters),
    getGovernanceOptions(orgId),
    // Losing a panel is never a reason to lose the calendar.
    getOperationalHierarchy(orgId, filters.operationId).catch(() => [] as HierarchyOperation[]),
    getFidelizationIndicators(orgId, competence, filters).catch(
      () => null as FidelizationIndicators | null,
    ),
  ]);

  const has = (code: string) => session.isPlatformAdmin || session.permissions.includes(code);

  return (
    <FidelizationView
      calendar={calendar}
      brs={brs}
      history={history}
      driverPlans={driverPlans}
      hierarchy={hierarchy}
      indicators={indicators}
      competence={competence}
      operations={options.operations}
      coverage={options.coverage}
      filters={filters}
      canManageBrs={has("fidelization.manage_brs")}
      canPlan={has("fidelization.plan")}
      canChangeVehicle={has("fidelization.change_vehicle")}
      canChangeDriver={has("fidelization.change_driver")}
    />
  );
}
