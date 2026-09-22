import type { Metadata } from "next";
import { requireOrganization } from "@/lib/auth/session";
import { BR_PAGE_SIZE, BR_SORTS, getBrDirectory, type BrSort } from "@/lib/governance/brs";
import {
  getBrPlannerIndicators,
  listLeadershipOptions,
  type BrPlannerFilters,
  type BrPlannerIndicators,
} from "@/lib/governance/br-planner";
import { getGovernanceOptions } from "@/lib/governance/queries";
import { parseCompetence } from "@/lib/governance/competence";
import { BrsView } from "./brs-view";

export const metadata: Metadata = {
  title: "BRs",
  description: "Cadastro e administração das posições operacionais (BRs) da organização.",
};

type SearchParams = Record<string, string | string[] | undefined>;

const first = (params: SearchParams, key: string): string | undefined => {
  const value = params[key];
  return Array.isArray(value) ? value[0] : value;
};

/**
 * Governança Operacional → BRs (Etapa 13.1).
 *
 * A casa administrativa da posição operacional. A rota reconfere
 * `fidelization.view` no servidor e toda consulta roda sob o cliente de quem
 * pede, então o escopo de operação decide quais posições voltam — não esta
 * página.
 *
 * A listagem é paginada e ordenada no servidor (§24): 50 posições por página,
 * cada uma já resolvida com liderança, veículo e motorista na data-âncora da
 * competência, em uma consulta só (§67).
 */
export default async function BrsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const { session, organization } = await requireOrganization("fidelization.view");

  const competence = parseCompetence(first(params, "ano"), first(params, "mes"));
  const filters: BrPlannerFilters = {
    q: first(params, "q"),
    operationId: first(params, "operacao"),
    stateId: first(params, "uf"),
    cityId: first(params, "cidade"),
    status: first(params, "situacao"),
    leaderEmployeeId: first(params, "lideranca"),
    vehicle: first(params, "veiculo"),
    driver: first(params, "motorista"),
    swapped: first(params, "substituicao"),
  };

  // Página 1-based na URL; qualquer valor inválido cai na primeira.
  const pageNumber = Math.max(1, Math.floor(Number(first(params, "page"))) || 1);
  const requestedSort = first(params, "ordem");
  const sort: BrSort = BR_SORTS.includes(requestedSort as BrSort) ? (requestedSort as BrSort) : "code";
  const dir: "asc" | "desc" = first(params, "dir") === "desc" ? "desc" : "asc";

  const orgId = organization.organizationId;

  const [directory, indicators, options, leaders] = await Promise.all([
    getBrDirectory(orgId, competence, filters, {
      limit: BR_PAGE_SIZE,
      offset: (pageNumber - 1) * BR_PAGE_SIZE,
      sort,
      dir,
    }),
    // Perder os indicadores nunca é motivo para perder a listagem.
    getBrPlannerIndicators(orgId, competence, filters).catch(
      () => null as BrPlannerIndicators | null,
    ),
    getGovernanceOptions(orgId),
    listLeadershipOptions(orgId).catch(() => [] as { id: string; name: string }[]),
  ]);

  const has = (code: string) => session.isPlatformAdmin || session.permissions.includes(code);

  return (
    <BrsView
      page={directory}
      indicators={indicators}
      competence={competence}
      operations={options.operations}
      coverage={options.coverage}
      leaders={leaders}
      filters={filters}
      sort={sort}
      dir={dir}
      pageNumber={pageNumber}
      canManageBrs={has("fidelization.manage_brs")}
      canImport={has("fidelization.import")}
      canExport={has("fidelization.export")}
      canPlan={has("fidelization.plan")}
      canAudit={has("fidelization.audit")}
    />
  );
}
