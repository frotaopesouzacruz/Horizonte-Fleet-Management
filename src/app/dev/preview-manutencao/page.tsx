import { notFound } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
import { MaintenanceView } from "@/app/(app)/frota/manutencao/maintenance-view";
import {
  buildPerms,
  CATALOG_SECTIONS,
  PERMISSION_CODES,
  visibleTabs,
  type CatalogSection,
  type MaintenanceViewData,
} from "@/app/(app)/frota/manutencao/shared";
import { PREDICTIVE_VIEWS, type MaintenanceTab, type PredictiveView } from "@/lib/maintenance/types";
import {
  firstParam,
  parseHierarchyLevels,
  parseMaintenanceFilters,
  type SearchParamsLike,
} from "@/lib/maintenance/url";
import {
  BASE_PAGE,
  CATALOG,
  DASHBOARD,
  hierarchyFixture,
  IMPORT_HISTORY,
  OPTIONS,
  PARAMETERS,
  PREDICTIVE,
  PREDICTIVE_EVENTS,
  PREDICTIVE_INDICATORS,
  PREDICTIVE_QUALITY,
  PREDICTIVE_SUBMISSIONS,
  PREDICTIVE_SUMMARY,
  PREDICTIVE_TRENDS,
  PREDICTIVE_VERIFICATIONS,
  PREVENTIVE,
  SCHEDULE_KPIS,
  SCHEDULE_PAGE,
  TODAY,
} from "./fixture";

/**
 * Renderiza a Manutenção contra dados fixos.
 *
 * A tela real fica atrás de sessão e organização; esta prévia permite olhar
 * (e testar no Playwright) as sete abas em light/dark e em qualquer largura.
 * Mesmo portão das demais prévias: ausente de um build de produção normal.
 * A URL ainda governa aba, visão e seção; os números nunca mudam.
 *
 * `?perfil=lideranca` renderiza com as permissões padrão da Liderança de
 * Operações (sem Cadastros de gestão, sem Importações, sem Exportar).
 */
export const metadata = {
  title: "Preview · Manutenção",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

const enabled =
  process.env.NODE_ENV !== "production" ||
  process.env.NEXT_PUBLIC_ENABLE_DEV_PAGES === "1";

const LEADERSHIP = [
  "maintenance.view",
  "maintenance.view_dashboard",
  "maintenance.view_base",
  "maintenance.create",
];

export default async function PreviewPage({
  searchParams,
}: {
  searchParams: Promise<SearchParamsLike>;
}) {
  if (!enabled) notFound();
  const params = await searchParams;
  const granted =
    firstParam(params, "perfil") === "lideranca"
      ? LEADERSHIP
      : Object.values(PERMISSION_CODES);
  const perms = buildPerms((code) => granted.includes(code));
  const tabs = visibleTabs(perms);
  const requested = firstParam(params, "aba") as MaintenanceTab | undefined;
  const tab = requested && tabs.includes(requested) ? requested : tabs[0];
  const section = firstParam(params, "secao") as CatalogSection | undefined;
  const requestedView = firstParam(params, "pd_visao") as PredictiveView | undefined;
  const predictiveView: PredictiveView = requestedView && PREDICTIVE_VIEWS.includes(requestedView) ? requestedView : "painel";
  const viewParams: Record<string, string> = {};
  for (const key of ["pd_inconsistencia", "pd_severidade", "pd_resolvidas", "pd_evento", "ciclo", "pd_lista", "pd_resultado", "pd_origem", "pd_so_nc"]) {
    const value = firstParam(params, key);
    if (value) viewParams[key] = value;
  }

  const data: MaintenanceViewData = {
    basePath: "/dev/preview-manutencao",
    tab,
    today: TODAY,
    filters: parseMaintenanceFilters(params),
    catalog: CATALOG,
    options: OPTIONS,
    perms,
    dashboard: DASHBOARD,
    predictiveSummary: PREDICTIVE_SUMMARY,
    schedule: {
      kpis: SCHEDULE_KPIS,
      page: SCHEDULE_PAGE,
      list: { sort: "scheduled", dir: "asc", page: 1, pageSize: 50 },
    },
    preventive: { matrix: PREVENTIVE, filters: { situation: "active" } },
    predictive: {
      view: predictiveView,
      overview: PREDICTIVE,
      filters: {},
      indicators: PREDICTIVE_INDICATORS,
      trends: PREDICTIVE_TRENDS,
      quality: PREDICTIVE_QUALITY,
      events: PREDICTIVE_EVENTS,
      submissions: PREDICTIVE_SUBMISSIONS,
      verifications: PREDICTIVE_VERIFICATIONS,
      page: 1,
      pageSize: 25,
      params: viewParams,
    },
    base: {
      view:
        firstParam(params, "visao") === "hierarquia" ? "hierarquia" : "tabela",
      page: BASE_PAGE,
      hierarchy: hierarchyFixture(
        BASE_PAGE.rows,
        parseHierarchyLevels(firstParam(params, "niveis")),
      ),
      list: { sort: "reference", dir: "desc", page: 1, pageSize: 50 },
      levels: parseHierarchyLevels(firstParam(params, "niveis")),
    },
    cadastros: {
      section:
        section && CATALOG_SECTIONS.includes(section) ? section : "clusters",
      parameters: PARAMETERS,
    },
    importacoes: { history: IMPORT_HISTORY },
  };

  return (
    <AppShell permissions={granted}>
      <MaintenanceView data={data} />
    </AppShell>
  );
}
