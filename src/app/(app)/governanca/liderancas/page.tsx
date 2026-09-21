import type { Metadata } from "next";
import { requireOrganization } from "@/lib/auth/session";
import {
  getGovernanceOptions,
  getLeadershipIndicators,
  listLeadership,
  listOperationBrs,
  type LeadershipIndicators,
} from "@/lib/governance/queries";
import { parseCompetence } from "@/lib/governance/competence";
import { LeadershipView } from "./leadership-view";

export const metadata: Metadata = {
  title: "Lideranças",
  description: "Responsáveis por operação, cidade e BR, com vigência e planejamento por competência.",
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
  const filters = {
    operationId: first(params, "operacao"),
    stateId: first(params, "uf"),
    cityId: first(params, "cidade"),
    scope: first(params, "nivel"),
    status: first(params, "situacao"),
  };

  const [rows, options, brs, indicators] = await Promise.all([
    listLeadership(organization.organizationId, competence, filters),
    getGovernanceOptions(organization.organizationId),
    listOperationBrs(organization.organizationId),
    // Losing the four cards is not a reason to lose the list under them.
    getLeadershipIndicators(organization.organizationId, competence, filters.operationId).catch(
      () => null as LeadershipIndicators | null,
    ),
  ]);

  const has = (code: string) => session.isPlatformAdmin || session.permissions.includes(code);

  return (
    <LeadershipView
      rows={rows}
      indicators={indicators}
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
      canManage={has("leadership.manage")}
      canAssign={has("leadership.assign")}
      canReplicate={has("leadership.replicate")}
    />
  );
}
