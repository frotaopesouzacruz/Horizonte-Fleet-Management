import { notFound } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
import { ActionPlansView } from "@/app/(app)/checklist/planos-acao/action-plans-view";
import {
  buildPerms,
  PAGE_SIZES,
  PERMISSION_CODES,
  visibleTabs,
  type ActionPlansViewData,
  type ListState,
} from "@/app/(app)/checklist/planos-acao/shared";
import type { ActionPlansTab, ActionPlanSortKey, Grouping } from "@/lib/action-plans/types";
import { firstParam, parseActionPlanFilters, type SearchParamsLike } from "@/lib/action-plans/url";
import {
  CATALOG, DASHBOARD, FIXTURES, groupsFor, healthFor, historyFor, MAPPING, MY_VIEW, pageFor, QUALITY, reconciliationFor, TODAY,
} from "./fixture";

/**
 * Renderiza Gestão de Checklist › Planos de Ação contra dados fixos.
 *
 * A tela real fica atrás de sessão e organização; esta prévia permite olhar
 * (e testar no Playwright) as sete abas em light/dark e em qualquer largura.
 * Mesmo portão das demais prévias: ausente de um build de produção normal.
 * A URL ainda governa aba, agrupamento, seção e período; as gavetas abrem
 * pelos `fixtures`, sem servidor. Ações que gravam não têm efeito aqui.
 *
 * `?perfil=lideranca` renderiza só com ver, ver indicadores e exportar —
 * nenhuma tratativa.
 */
export const metadata = { title: "Preview · Planos de Ação", robots: { index: false, follow: false } };

export const dynamic = "force-dynamic";

const enabled =
  process.env.NODE_ENV !== "production" || process.env.NEXT_PUBLIC_ENABLE_DEV_PAGES === "1";

const BASE_PATH = "/dev/preview-planos-acao";
const LEADERSHIP = ["action_plans.view", "action_plans.view_dashboard", "action_plans.export"];
const SORTS: ActionPlanSortKey[] = ["priority", "due", "first", "last", "occurrences", "open_items", "code", "plate", "status", "age"];
const GROUPINGS: (Grouping | "list")[] = ["operation", "cluster", "vehicle", "priority", "responsible", "list"];

function parseList(params: SearchParamsLike, defaults: Pick<ListState, "sort" | "dir">): ListState {
  const sort = firstParam(params, "ordenar");
  const dir = firstParam(params, "dir");
  const size = Number(firstParam(params, "por_pagina"));
  return {
    sort: (SORTS as string[]).includes(sort ?? "") ? (sort as ActionPlanSortKey) : defaults.sort,
    dir: dir === "asc" || dir === "desc" ? dir : defaults.dir,
    page: Math.max(1, Number(firstParam(params, "pagina")) || 1),
    pageSize: PAGE_SIZES.includes(size) ? size : 50,
  };
}

export default async function PreviewPage({ searchParams }: { searchParams: Promise<SearchParamsLike> }) {
  if (!enabled) notFound();
  const params = await searchParams;
  const granted = firstParam(params, "perfil") === "lideranca"
    ? LEADERSHIP
    : Object.values(PERMISSION_CODES).filter((code) => code.startsWith("action_plans."));
  const perms = buildPerms((code) => granted.includes(code));
  const tabs = visibleTabs(perms);
  const requested = firstParam(params, "aba") as ActionPlansTab | undefined;
  const tab: ActionPlansTab = requested && tabs.includes(requested) ? requested : tabs[0];
  const filters = parseActionPlanFilters(params);

  const data: ActionPlansViewData = {
    basePath: BASE_PATH,
    tab,
    today: TODAY,
    orgId: "org-preview",
    filters,
    catalog: CATALOG,
    perms,
    // Sem catálogo da Manutenção: a gaveta e o assistente oficiais não abrem na prévia.
    maintenanceCatalog: null,
    maintenancePerms: null,
    fixtures: FIXTURES,
  };

  if (tab === "visao-geral") {
    data.dashboard = DASHBOARD;
  } else if (tab === "planos") {
    const requestedGrouping = firstParam(params, "agrupar") as Grouping | "list" | undefined;
    const grouping = requestedGrouping && GROUPINGS.includes(requestedGrouping) ? requestedGrouping : "operation";
    const list = parseList(params, { sort: "priority", dir: "desc" });
    const effective = filters.status || filters.statusGroup || filters.deadline ? filters : { ...filters, statusGroup: "open" as const };
    data.filters = effective;
    data.plans = {
      grouping,
      groups: grouping === "list" ? null : groupsFor(effective, grouping),
      page: pageFor(effective, list.page, list.pageSize),
      list,
    };
  } else if (tab === "conciliacao") {
    const confidence = firstParam(params, "confianca") ?? null;
    data.reconciliation = {
      page: reconciliationFor(filters, confidence),
      confidence,
      list: parseList(params, { sort: "priority", dir: "desc" }),
    };
  } else if (tab === "parametros") {
    data.mapping = MAPPING;
  } else if (tab === "qualidade") {
    const section = firstParam(params, "secao");
    const days = [7, 30, 90].includes(Number(firstParam(params, "dias"))) ? Number(firstParam(params, "dias")) : 30;
    data.quality = {
      quality: QUALITY,
      health: healthFor(days),
      days,
      section: section === "saude" || section === "importacao" ? section : "qualidade",
    };
  } else if (tab === "minha-visao") {
    data.myView = MY_VIEW;
  } else if (tab === "historico") {
    const list = parseList(params, { sort: "first", dir: "desc" });
    data.history = {
      page: historyFor(list.page, list.pageSize),
      filters: {
        from: filters.from,
        to: filters.to,
        q: filters.q,
        vehicle: filters.vehicle,
        operation: filters.operation,
        employee: firstParam(params, "colaborador"),
      },
      list,
    };
  }

  return (
    <AppShell permissions={granted}>
      <ActionPlansView data={data} />
    </AppShell>
  );
}
