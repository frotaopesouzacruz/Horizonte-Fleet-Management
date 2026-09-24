import type { Metadata } from "next";
import { requireOrganization } from "@/lib/auth/session";
import {
  getGovernanceOptions,
  getLeadershipIndicators,
  listOperationBrs,
  type LeadershipIndicators,
} from "@/lib/governance/queries";
import { parseCompetence } from "@/lib/governance/competence";
import { loadLeadershipScreen, readLeadershipFilters } from "@/lib/governance/leadership-export";
import { getLeadershipCityPlanner } from "@/lib/governance/leadership-planner";
import type { LeadershipPlanner } from "@/lib/governance/leadership-planner-types";
import { LeadershipView } from "./leadership-view";

export const metadata: Metadata = {
  title: "Lideranças",
  description: "Planejamento de lideranças por tipo de operação e cidade, por competência.",
};

type SearchParams = Record<string, string | string[] | undefined>;

const first = (params: SearchParams, key: string): string | undefined => {
  const value = params[key];
  return Array.isArray(value) ? value[0] : value;
};

/**
 * Governança Operacional → Lideranças.
 *
 * The route re-checks `leadership.view` server-side, and every query below
 * runs under the caller's own client — so the operation scope, not this page,
 * decides which responsibilities come back.
 */
export default async function LeadershipPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const { session, organization } = await requireOrganization("leadership.view");

  const competence = parseCompetence(first(params, "ano"), first(params, "mes"));
  // Os mesmos filtros que a exportação lê (Etapa 08 §20): o arquivo é a tela.
  const filters = readLeadershipFilters((key) => first(params, key));

  const orgId = organization.organizationId;
  const [{ rows, leaders }, options, brs, indicators, planner] = await Promise.all([
    loadLeadershipScreen(orgId, competence, filters),
    getGovernanceOptions(orgId),
    listOperationBrs(orgId),
    // Losing the cards is not a reason to lose the list under them.
    getLeadershipIndicators(orgId, competence, filters.operationId).catch(
      () => null as LeadershipIndicators | null,
    ),
    // Nem o planejamento: sem ele a aba "Por liderança" continua de pé.
    getLeadershipCityPlanner(orgId, competence).catch((error: unknown) => {
      console.error("leadership_city_planner", error);
      return null as LeadershipPlanner | null;
    }),
  ]);

  const has = (code: string) => session.isPlatformAdmin || session.permissions.includes(code);

  return (
    <LeadershipView
      rows={rows}
      indicators={indicators}
      planner={planner}
      competence={competence}
      operations={options.operations}
      coverage={options.coverage}
      brs={brs.map((br) => ({
        id: br.id,
        code: br.code,
        operationId: br.operationId,
        operationCityId: br.operationCityId,
        status: br.status,
      }))}
      filters={filters}
      leaders={leaders}
      canManage={has("leadership.manage")}
      canAssign={has("leadership.assign")}
      canReplicate={has("leadership.replicate")}
      canExport={has("leadership.export")}
      canManageHistorical={has("leadership.manage_historical_data")}
    />
  );
}
