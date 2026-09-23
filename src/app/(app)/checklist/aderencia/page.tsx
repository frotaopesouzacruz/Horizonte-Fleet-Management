import type { Metadata } from "next";
import { requireOrganization } from "@/lib/auth/session";
import { getGovernanceOptions } from "@/lib/governance/queries";
import { listLeadershipOptions } from "@/lib/governance/br-planner";
import { monthEnd, monthStart, parseCompetence } from "@/lib/governance/competence";
import {
  getAdherenceHeatmap,
  getAdherenceInsights,
  getAdherenceMatrix,
  getAdherenceMonthly,
  getAdherenceOptions,
  getAdherenceSummary,
  getChecklistJourney,
  getReturnTracking,
  listAdherenceFilterOptions,
  listAdherenceImportHistory,
  listAdherenceRequests,
  type AdherenceGroupBy,
  type AdherenceInsights,
  type AdherenceMonthly,
  type ChecklistContext,
  type ImportHistoryRow,
  type JourneyRow,
  type RequestsPage,
  type ReturnTracking,
} from "@/lib/adherence/queries";
import { AdherenceView, type AdherenceTab } from "./adherence-view";

export const metadata: Metadata = {
  title: "Aderência",
  description:
    "Acompanhe a execução dos checklists obrigatórios, identifique pendências e gerencie justificativas operacionais.",
};

type SearchParams = Record<string, string | string[] | undefined>;

const first = (params: SearchParams, key: string): string | undefined => {
  const value = params[key];
  return Array.isArray(value) ? value[0] : value;
};

const TABS: AdherenceTab[] = ["consolidada", "heatmap", "matriz", "jornada", "expurgos", "solicitacoes", "governanca"];
const GROUPS: AdherenceGroupBy[] = ["operation", "state", "city", "branch", "leader", "br", "vehicle_type", "vehicle"];

const parseTab = (v: string | undefined): AdherenceTab =>
  (TABS as string[]).includes(v ?? "") ? (v as AdherenceTab) : "consolidada";
const parseGroup = (v: string | undefined): AdherenceGroupBy =>
  (GROUPS as string[]).includes(v ?? "") ? (v as AdherenceGroupBy) : "operation";

/** O dia detalhado fica dentro da competência; por padrão é hoje (ou o fim do mês visitado). */
function clampDay(value: string | undefined, from: string, to: string, today: string): string {
  const candidate = value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : today;
  if (candidate < from) return from;
  if (candidate > to) return today >= from && today <= to ? today : to;
  return candidate;
}

/**
 * Gestão de Checklist → Aderência.
 *
 * A rota re-verifica `adherence.view`; cada consulta roda sob o cliente da
 * própria pessoa, e a RLS das obrigações decide o escopo. Tudo que a tela
 * mostra já veio calculado do servidor: numerador, denominador, status — o
 * navegador só apresenta (§57, §58).
 */
export default async function AdherencePage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams;
  const { session, organization } = await requireOrganization("adherence.view");
  const orgId = organization.organizationId;

  const options = await getAdherenceOptions(orgId);
  const todayCompetence = { year: Number(options.today.slice(0, 4)), month: Number(options.today.slice(5, 7)) };
  const competence = parseCompetence(first(params, "ano"), first(params, "mes"), todayCompetence);
  const context: ChecklistContext = first(params, "contexto") === "retorno" ? "retorno" : "saida";
  const tab = parseTab(first(params, "aba"));
  const from = monthStart(competence);
  const to = monthEnd(competence);
  const day = clampDay(first(params, "dia"), from, to, options.today);
  const groupBy = parseGroup(first(params, "agrupar"));
  const page = Math.max(1, Number(first(params, "pagina")) || 1);

  const filters = {
    operationId: first(params, "operacao"),
    stateId: first(params, "uf"),
    cityId: first(params, "cidade"),
    branchId: first(params, "filial"),
    leaderEmployeeId: first(params, "lideranca"),
    brId: first(params, "br"),
    vehicleTypeId: first(params, "tipo"),
    status: first(params, "situacao"),
    q: first(params, "q"),
    justification: first(params, "justificativa"),
  };
  // O dashboard mensal olha o ano da competência (§25); o heatmap, três meses (§28).
  const dashboardYear = Math.max(2000, Number(first(params, "ano_dash")) || competence.year);
  const prevCompetence = competence.month === 1 ? { year: competence.year - 1, month: 12 } : { year: competence.year, month: competence.month - 1 };
  const nextCompetence = competence.month === 12 ? { year: competence.year + 1, month: 1 } : { year: competence.year, month: competence.month + 1 };
  const requestFilters = {
    status: first(params, "sol_status"),
    reasonCode: first(params, "sol_motivo"),
    q: first(params, "sol_q"),
    operationId: filters.operationId,
    cityId: filters.cityId,
    leaderEmployeeId: filters.leaderEmployeeId,
    dateFrom: from,
    dateTo: to,
  };

  const [
    summary, heatmap, matrix, journey, requests, governance, leaders, filterOptions,
    monthly, insights, returnTracking, importHistory, heatmapPrev, heatmapNext,
  ] = await Promise.all([
    getAdherenceSummary(orgId, from, to, context, filters, groupBy),
    getAdherenceHeatmap(orgId, competence, context, filters),
    getAdherenceMatrix(orgId, competence, context, filters, page, 50),
    // Perder um painel nunca é motivo para perder a matriz.
    getChecklistJourney(orgId, day, filters).catch(() => [] as JourneyRow[]),
    listAdherenceRequests(orgId, requestFilters, 1, 100).catch(() => null as RequestsPage | null),
    getGovernanceOptions(orgId),
    listLeadershipOptions(orgId).catch(() => [] as { id: string; name: string }[]),
    listAdherenceFilterOptions(orgId).catch(() => ({ branches: [], vehicleTypes: [] })),
    getAdherenceMonthly(orgId, dashboardYear, context, filters).catch(() => null as AdherenceMonthly | null),
    getAdherenceInsights(orgId, competence, context, filters).catch(() => null as AdherenceInsights | null),
    getReturnTracking(orgId, from, to, filters).catch(() => null as ReturnTracking | null),
    (session.isPlatformAdmin || session.permissions.includes("adherence.import") || session.permissions.includes("adherence.view_audit")
      ? listAdherenceImportHistory(orgId) : Promise.resolve([] as ImportHistoryRow[])).catch(() => [] as ImportHistoryRow[]),
    getAdherenceHeatmap(orgId, prevCompetence, context, filters).catch(() => []),
    getAdherenceHeatmap(orgId, nextCompetence, context, filters).catch(() => []),
  ]);

  const has = (code: string) => session.isPlatformAdmin || session.permissions.includes(code);

  return (
    <AdherenceView
      context={context}
      competence={competence}
      today={options.today}
      day={day}
      tab={tab}
      groupBy={groupBy}
      summary={summary}
      heatmap={heatmap}
      heatmapPrev={heatmapPrev}
      heatmapNext={heatmapNext}
      monthly={monthly}
      dashboardYear={dashboardYear}
      insights={insights}
      returnTracking={returnTracking}
      importHistory={importHistory}
      matrix={matrix}
      journey={journey}
      requests={requests}
      options={options}
      operations={governance.operations}
      coverage={governance.coverage}
      leaders={leaders}
      branches={filterOptions.branches}
      vehicleTypes={filterOptions.vehicleTypes}
      filters={filters}
      requestFilters={{ status: requestFilters.status, reasonCode: requestFilters.reasonCode, q: requestFilters.q }}
      perms={{
        request: has("adherence.request"),
        approve: has("adherence.approve"),
        override: has("adherence.override"),
        bulk: has("adherence.bulk_update"),
        reconcile: has("adherence.reconcile"),
        import: has("adherence.import"),
        export: has("adherence.export"),
        manageTargets: has("adherence.manage_targets"),
        manageRules: has("adherence.manage_rules"),
        viewAudit: has("adherence.view_audit"),
      }}
    />
  );
}
