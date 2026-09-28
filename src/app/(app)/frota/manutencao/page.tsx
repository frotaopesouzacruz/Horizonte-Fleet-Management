import type { Metadata } from "next";
import { hasPermission, requireOrganization } from "@/lib/auth/session";
import {
  DEFAULT_PAGE_SIZE,
  getMaintenanceCatalog,
  getMaintenanceDashboard,
  getMaintenanceFilterOptions,
  getMaintenanceHierarchy,
  getMaintenanceImportHistory,
  getMaintenanceParameters,
  getPredictiveOverview,
  getPreventiveMatrix,
  getScheduleKpis,
  listMaintenances,
  type PredictiveFilters,
  type PreventiveFilters,
} from "@/lib/maintenance/queries";
import type { MaintenanceFilters, MaintenanceSortKey, MaintenanceTab } from "@/lib/maintenance/types";
import { firstParam, parseMaintenanceFilters, type SearchParamsLike } from "@/lib/maintenance/url";
import { MaintenanceView } from "./maintenance-view";
import {
  buildPerms,
  CATALOG_SECTIONS,
  visibleTabs,
  type CatalogSection,
  type ListState,
  type MaintenanceViewData,
} from "./shared";

export const metadata: Metadata = {
  title: "Manutenção",
  description: "Programação, execução, preventiva, preditiva e base geral das manutenções da frota.",
};

type SearchParams = SearchParamsLike;
const first = firstParam;

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
    data.dashboard = await safe(getMaintenanceDashboard(orgId, filters), "dashboard");
    data.today = data.dashboard?.period.today ?? "";
  } else if (tab === "programacao") {
    const list = parseList(params, { sort: "scheduled", dir: "asc" });
    // Sem situação escolhida, a fila mostra o que está em aberto; "concluídas hoje" é a exceção.
    const listFilters: MaintenanceFilters = {
      ...filters,
      openOnly: filters.status || filters.queue === "completed_today" ? filters.openOnly : true,
    };
    const [kpis, page] = await Promise.all([
      safe(getScheduleKpis(orgId, { ...filters, queue: undefined, status: undefined }), "schedule_kpis"),
      safe(listMaintenances(orgId, listFilters, list), "schedule_list"),
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
      br: filters.br,
      status: first(params, "mp_situacao"),
    };
    const matrix = await safe(getPreventiveMatrix(orgId, pf), "preventive_matrix");
    data.preventive = { matrix, filters: pf };
    data.today = matrix?.today ?? "";
  } else if (tab === "preditiva") {
    const pf: PredictiveFilters = {
      q: filters.q,
      operation: filters.operation,
      cluster: filters.cluster,
      status: first(params, "pd_situacao"),
      execution: first(params, "pd_execucao"),
      vehicle: filters.vehicle,
    };
    const overview = await safe(getPredictiveOverview(orgId, pf), "predictive_overview");
    data.predictive = { overview, filters: pf };
    data.today = overview?.today ?? "";
  } else if (tab === "base") {
    const view = first(params, "visao") === "hierarquia" ? "hierarquia" : "tabela";
    const list = parseList(params, { sort: "reference", dir: "desc" });
    const [page, hierarchy] = await Promise.all([
      view === "tabela" ? safe(listMaintenances(orgId, filters, list), "base_list") : Promise.resolve(null),
      view === "hierarquia" ? safe(getMaintenanceHierarchy(orgId, filters), "hierarchy") : Promise.resolve(null),
    ]);
    data.base = { view, page, hierarchy, list };
    data.today = page?.today ?? "";
  } else if (tab === "cadastros") {
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
