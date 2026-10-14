import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { hasPermission, requireOrganization } from "@/lib/auth/session";
import {
  DEFAULT_PAGE_SIZE,
  getMaintenanceCatalog,
  getMaintenanceDashboard,
  getMaintenanceFilterOptions,
  getMaintenanceHierarchy,
  getMaintenanceImportHistory,
  getMaintenanceParameters,
  getPredictiveEvents,
  getPredictiveIndicators,
  getPredictiveOverview,
  getPredictiveQuality,
  getPredictiveSummary,
  getPredictiveTrends,
  getPreventiveMatrix,
  getScheduleKpis,
  listMaintenances,
  searchPredictiveSubmissions,
  searchPredictiveVerifications,
  type PredictiveFilters,
  type PreventiveFilters,
} from "@/lib/maintenance/queries";
import {
  PREDICTIVE_VIEWS,
  type MaintenanceFilters,
  type MaintenanceSortKey,
  type MaintenanceTab,
  type PredictiveView,
} from "@/lib/maintenance/types";
import { firstParam, parseHierarchyLevels, parseMaintenanceFilters, type SearchParamsLike } from "@/lib/maintenance/url";
import { MaintenanceView } from "./maintenance-view";
import {
  buildPerms,
  CATALOG_SECTIONS,
  SUPPLIERS_PATH,
  visibleTabs,
  type CatalogSection,
  type ListState,
  type MaintenanceViewData,
  type PredictiveViewData,
} from "./shared";

export const metadata: Metadata = {
  title: "Manutenção",
  description: "Programação, execução, preventiva, preditiva e base geral das manutenções da frota.",
};

type SearchParams = SearchParamsLike;
const first = firstParam;

/** Teto da fila da Programação (abertas): acima disso a tela pede para refinar os filtros. */
const SCHEDULE_LIMIT = 1000;

const SORTS: MaintenanceSortKey[] = ["reference", "requested", "scheduled", "entry", "exit", "code", "plate", "status", "duration"];

function parseList(params: SearchParams, defaults: Pick<ListState, "sort" | "dir">): ListState {
  const sort = first(params, "ordenar");
  const dir = first(params, "dir");
  return {
    sort: (SORTS as string[]).includes(sort ?? "") ? (sort as MaintenanceSortKey) : defaults.sort,
    dir: dir === "asc" || dir === "desc" ? dir : defaults.dir,
    page: Math.max(1, Number(first(params, "pagina")) || 1),
    pageSize: [25, 50, 100, 200].includes(Number(first(params, "por_pagina"))) ? Number(first(params, "por_pagina")) : DEFAULT_PAGE_SIZE,
  };
}

/** Uma falha num painel não derruba a tela: o painel mostra o erro, o resto segue. */
async function safe<T>(promise: Promise<T>, label: string): Promise<T | null> {
  try {
    return await promise;
  } catch (error) {
    console.error(`manutencao: ${label}`, error instanceof Error ? error.message : error);
    return null;
  }
}

/**
 * Gestão de Frota → Manutenção.
 *
 * A rota confere `maintenance.view`; cada leitura roda sob o cliente da
 * própria pessoa, e a RLS mais o escopo por operação decidem as linhas. Só a
 * aba aberta é carregada — trocar de aba é uma ida ao servidor, nunca sete
 * consultas pesadas de uma vez.
 */
export default async function MaintenancePage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams;
  const { session, organization } = await requireOrganization("maintenance.view");
  const orgId = organization.organizationId;
  const perms = buildPerms((code) => hasPermission(session, code));
  const tabs = visibleTabs(perms);
  const requested = first(params, "aba") as MaintenanceTab | undefined;
  const tab: MaintenanceTab = requested && tabs.includes(requested) ? requested : tabs[0];
  const filters = parseMaintenanceFilters(params);

  const [catalog, options] = await Promise.all([getMaintenanceCatalog(orgId), getMaintenanceFilterOptions(orgId)]);

  const data: MaintenanceViewData = {
    basePath: "/frota/manutencao",
    tab,
    today: "",
    filters,
    catalog,
    options,
    perms,
  };

  if (tab === "visao-geral") {
    const [dashboard, predictiveSummary] = await Promise.all([
      safe(getMaintenanceDashboard(orgId, filters), "dashboard"),
      safe(getPredictiveSummary(orgId, { operation: filters.operation, vehicleType: filters.vehicleType, city: filters.city, state: filters.state }), "predictive_summary"),
    ]);
    data.dashboard = dashboard;
    data.predictiveSummary = predictiveSummary;
    data.today = dashboard?.period.today ?? "";
  } else if (tab === "programacao") {
    const list = parseList(params, { sort: "scheduled", dir: "asc" });
    // Sem situação escolhida, a fila mostra o que está em aberto; "concluídas hoje" é a exceção.
    const listFilters: MaintenanceFilters = {
      ...filters,
      openOnly: filters.status || filters.queue === "completed_today" ? filters.openOnly : true,
    };
    // A fila é dividida em quadros por situação e agrupada por operação/cidade
    // na tela: precisa do conjunto inteiro (as abertas cabem com folga), não de uma página.
    const [kpis, page] = await Promise.all([
      safe(getScheduleKpis(orgId, { ...filters, queue: undefined, status: undefined }), "schedule_kpis"),
      safe(listMaintenances(orgId, listFilters, { ...list, page: 1, pageSize: SCHEDULE_LIMIT }), "schedule_list"),
    ]);
    data.schedule = { kpis, page, list };
    data.today = kpis?.today ?? page?.today ?? "";
  } else if (tab === "preventiva") {
    const situation = first(params, "mp_frota") === "inactive" ? "inactive" : "active";
    const pf: PreventiveFilters = {
      situation,
      q: filters.q,
      vehicleType: filters.vehicleType,
      model: first(params, "modelo"),
      operation: filters.operation,
      city: filters.city,
      status: first(params, "mp_situacao"),
    };
    const matrix = await safe(getPreventiveMatrix(orgId, pf), "preventive_matrix");
    data.preventive = { matrix, filters: pf };
    data.today = matrix?.today ?? "";
  } else if (tab === "preditiva") {
    const requestedView = first(params, "pd_visao") as PredictiveView | undefined;
    const view: PredictiveView = requestedView && PREDICTIVE_VIEWS.includes(requestedView) ? requestedView : "painel";
    const list = parseList(params, { sort: "reference", dir: "desc" });
    const pf: PredictiveFilters = {
      q: filters.q,
      operation: filters.operation,
      cluster: filters.cluster,
      vehicle: filters.vehicle,
      vehicleType: filters.vehicleType,
      state: filters.state,
      city: filters.city,
      br: filters.br,
      leader: filters.leader,
      from: filters.from,
      to: filters.to,
      status: first(params, "pd_situacao"),
      execution: first(params, "pd_execucao"),
      subcategory: first(params, "subcategoria"),
      make: first(params, "marca"),
      model: first(params, "modelo"),
      plan: first(params, "plano"),
      criticality: first(params, "pd_criticidade"),
      conformity: first(params, "pd_conformidade"),
      reference: first(params, "pd_referencia"),
      monitoring: first(params, "pd_monitoramento") === "1" || undefined,
      kmStale: first(params, "pd_km") === "desatualizado" || undefined,
      includeInactive: filters.fleet === "all" || filters.fleet === "inactive" || undefined,
      // A matriz e os alertas são paginados no servidor; as demais visões só precisam do resumo.
      rowsPage: view === "matriz" ? list.page : 1,
      rowsPageSize: view === "matriz" ? list.pageSize : 25,
      alertsPage: view === "alertas" ? list.page : 1,
      alertsPageSize: view === "alertas" ? list.pageSize : 25,
    };
    const offset = (list.page - 1) * list.pageSize;
    const overviewPromise = safe(getPredictiveOverview(orgId, pf), "predictive_overview");
    const viewParams: Record<string, string> = {};
    for (const key of ["pd_inconsistencia", "pd_severidade", "pd_resolvidas", "pd_evento", "ciclo", "pd_lista", "pd_resultado", "pd_origem", "pd_so_nc", "responsavel"]) {
      const value = first(params, key);
      if (value) viewParams[key] = value;
    }
    const predictive: PredictiveViewData = { view, overview: null, filters: pf, page: list.page, pageSize: list.pageSize, params: viewParams };
    if (view === "painel" || view === "indicadores") {
      const [overview, indicators, trends] = await Promise.all([
        overviewPromise,
        safe(getPredictiveIndicators(orgId, pf), "predictive_indicators"),
        safe(getPredictiveTrends(orgId, { days: 90, operation: filters.operation?.split(",")[0] ?? null }), "predictive_trends"),
      ]);
      predictive.overview = overview;
      predictive.indicators = indicators;
      predictive.trends = trends;
    } else if (view === "qualidade") {
      const [overview, quality] = await Promise.all([
        overviewPromise,
        safe(getPredictiveQuality(orgId, {
          types: first(params, "pd_inconsistencia"),
          severity: first(params, "pd_severidade"),
          vehicle: filters.vehicle,
          includeResolved: first(params, "pd_resolvidas") === "1",
        }, list.pageSize, offset), "predictive_quality"),
      ]);
      predictive.overview = overview;
      predictive.quality = quality;
    } else if (view === "auditoria") {
      const [overview, events] = await Promise.all([
        overviewPromise,
        safe(getPredictiveEvents(orgId, {
          vehicle: filters.vehicle,
          cycle: first(params, "ciclo"),
          types: first(params, "pd_evento"),
          from: filters.from,
          to: filters.to,
        }, list.pageSize, offset), "predictive_events"),
      ]);
      predictive.overview = overview;
      predictive.events = events;
    } else if (view === "envios") {
      const [overview, submissions, verifications] = await Promise.all([
        overviewPromise,
        safe(searchPredictiveSubmissions(orgId, {
          q: filters.q, from: filters.from, to: filters.to, operation: filters.operation,
          onlyNonConforming: first(params, "pd_so_nc") === "1",
        }, list.pageSize, offset), "predictive_submissions"),
        safe(searchPredictiveVerifications(orgId, {
          q: filters.q, from: filters.from, to: filters.to, cluster: filters.cluster, vehicle: filters.vehicle,
          results: first(params, "pd_resultado"), sources: first(params, "pd_origem"), responsible: first(params, "responsavel"),
        }, list.pageSize, offset), "predictive_verifications"),
      ]);
      predictive.overview = overview;
      predictive.submissions = submissions;
      predictive.verifications = verifications;
    } else {
      predictive.overview = await overviewPromise;
    }
    data.predictive = predictive;
    data.today = predictive.overview?.today ?? "";
  } else if (tab === "base") {
    const view = first(params, "visao") === "hierarquia" ? "hierarquia" : "tabela";
    const list = parseList(params, { sort: "reference", dir: "desc" });
    const levels = parseHierarchyLevels(first(params, "niveis"));
    const [page, hierarchy] = await Promise.all([
      view === "tabela" ? safe(listMaintenances(orgId, filters, list), "base_list") : Promise.resolve(null),
      view === "hierarquia" ? safe(getMaintenanceHierarchy(orgId, filters, levels), "hierarchy") : Promise.resolve(null),
    ]);
    data.base = { view, page, hierarchy, list, levels };
    data.today = page?.today ?? "";
  } else if (tab === "cadastros") {
    // Fornecedores virou Administração › Fornecedores; o link antigo ainda chega lá.
    if (first(params, "secao") === "fornecedores") redirect(SUPPLIERS_PATH);
    const requestedSection = first(params, "secao") as CatalogSection | undefined;
    const section = requestedSection && CATALOG_SECTIONS.includes(requestedSection) ? requestedSection : "clusters";
    const parameters =
      section === "preventiva" || section === "preditiva" ? await safe(getMaintenanceParameters(orgId), "parameters") : null;
    data.cadastros = { section, parameters };
  } else if (tab === "importacoes") {
    data.importacoes = { history: await safe(getMaintenanceImportHistory(orgId, 50), "import_history") };
  }

  return <MaintenanceView data={data} />;
}
