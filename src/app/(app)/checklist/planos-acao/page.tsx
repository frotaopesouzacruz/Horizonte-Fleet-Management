import type { Metadata } from "next";
import { hasPermission, requireOrganization } from "@/lib/auth/session";
import {
  DEFAULT_PAGE_SIZE,
  getActionPlanCatalog,
  getActionPlanDashboard,
  getActionPlanGroups,
  getChecklistHistory,
  getHealth,
  getMapping,
  getMyView,
  getQuality,
  getReconciliation,
  listActionPlans,
} from "@/lib/action-plans/queries";
import type { ActionPlansTab, ActionPlanSortKey, Grouping } from "@/lib/action-plans/types";
import { firstParam, parseActionPlanFilters, type SearchParamsLike } from "@/lib/action-plans/url";
import { getMaintenanceCatalog } from "@/lib/maintenance/queries";
import { buildPerms as buildMaintenancePerms } from "@/app/(app)/frota/manutencao/shared";
import { ActionPlansView } from "./action-plans-view";
import { buildPerms, PAGE_SIZES, visibleTabs, type ActionPlansViewData, type ListState } from "./shared";

export const metadata: Metadata = {
  title: "Planos de Ação",
  description: "Plano de Ação de Manutenção: inconformidades do Check List de Frota, tratativas, manutenções e indicadores.",
};

const SORTS: ActionPlanSortKey[] = ["priority", "due", "first", "last", "occurrences", "open_items", "code", "plate", "status", "age"];
const GROUPINGS: (Grouping | "list")[] = ["operation", "cluster", "vehicle", "priority", "responsible", "list"];

function parseList(params: SearchParamsLike, defaults: Pick<ListState, "sort" | "dir">): ListState {
  const sort = firstParam(params, "ordenar");
  const dir = firstParam(params, "dir");
  return {
    sort: (SORTS as string[]).includes(sort ?? "") ? (sort as ActionPlanSortKey) : defaults.sort,
    dir: dir === "asc" || dir === "desc" ? dir : defaults.dir,
    page: Math.max(1, Number(firstParam(params, "pagina")) || 1),
    pageSize: PAGE_SIZES.includes(Number(firstParam(params, "por_pagina"))) ? Number(firstParam(params, "por_pagina")) : DEFAULT_PAGE_SIZE,
  };
}

/** Uma falha num painel não derruba a tela: o painel mostra o erro, o resto segue. */
async function safe<T>(promise: Promise<T>, label: string): Promise<T | null> {
  try {
    return await promise;
  } catch (error) {
    console.error(`planos-acao: ${label}`, error instanceof Error ? error.message : error);
    return null;
  }
}

function todayInSaoPaulo(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
}

/**
 * Gestão de Checklist → Planos de Ação (Plano de Ação de Manutenção).
 *
 * A rota confere `action_plans.view`; cada leitura roda sob o cliente da
 * própria pessoa e as rotinas aplicam permissão e escopo (operação do contexto
 * gravado). Só a aba aberta é carregada.
 */
export default async function ActionPlansPage({ searchParams }: { searchParams: Promise<SearchParamsLike> }) {
  const params = await searchParams;
  const { session, organization } = await requireOrganization("action_plans.view");
  const orgId = organization.organizationId;
  const perms = buildPerms((code) => hasPermission(session, code));
  const tabs = visibleTabs(perms);
  const requested = firstParam(params, "aba") as ActionPlansTab | undefined;
  const tab: ActionPlansTab = requested && tabs.includes(requested) ? requested : tabs[0];
  const filters = parseActionPlanFilters(params);
  const today = todayInSaoPaulo();

  const maintenancePerms = perms.maintenanceView || perms.maintenanceCreate
    ? buildMaintenancePerms((code) => hasPermission(session, code))
    : null;
  const [catalog, maintenanceCatalog] = await Promise.all([
    getActionPlanCatalog(orgId),
    maintenancePerms ? safe(getMaintenanceCatalog(orgId), "catálogo da manutenção") : Promise.resolve(null),
  ]);

  const data: ActionPlansViewData = {
    basePath: "/checklist/planos-acao",
    tab,
    today,
    orgId,
    filters,
    catalog,
    perms,
    maintenanceCatalog,
    maintenancePerms,
  };

  if (tab === "visao-geral") {
    data.dashboard = await safe(getActionPlanDashboard(orgId, filters), "visão geral");
  } else if (tab === "planos") {
    const requestedGrouping = firstParam(params, "agrupar") as Grouping | "list" | undefined;
    const grouping = requestedGrouping && GROUPINGS.includes(requestedGrouping) ? requestedGrouping : "operation";
    const list = parseList(params, { sort: "priority", dir: "desc" });
    // Sem filtro de situação, o portal abre nos planos em aberto.
    const effective = filters.status || filters.statusGroup || filters.deadline ? filters : { ...filters, statusGroup: "open" as const };
    const [groups, page] = await Promise.all([
      grouping === "list" ? Promise.resolve(null) : safe(getActionPlanGroups(orgId, effective, grouping), "agrupamentos"),
      safe(listActionPlans(orgId, effective, list.sort, list.dir, list.page, list.pageSize), "planos"),
    ]);
    data.filters = effective;
    data.plans = { grouping, groups, page, list };
  } else if (tab === "conciliacao") {
    const confidence = firstParam(params, "confianca") ?? null;
    const list = parseList(params, { sort: "priority", dir: "desc" });
    data.reconciliation = {
      page: await safe(getReconciliation(orgId, filters, confidence, list.page, list.pageSize), "conciliação"),
      confidence,
      list,
    };
  } else if (tab === "parametros") {
    data.mapping = await safe(getMapping(orgId), "mapeamento");
  } else if (tab === "qualidade") {
    const section = firstParam(params, "secao");
    const days = [7, 30, 90].includes(Number(firstParam(params, "dias"))) ? Number(firstParam(params, "dias")) : 30;
    const [quality, health] = await Promise.all([safe(getQuality(orgId), "qualidade"), safe(getHealth(orgId, days), "saúde")]);
    data.quality = {
      quality,
      health,
      days,
      section: section === "saude" || section === "importacao" ? section : "qualidade",
    };
  } else if (tab === "minha-visao") {
    data.myView = await safe(getMyView(orgId), "minha visão");
  } else if (tab === "historico") {
    const list = parseList(params, { sort: "first", dir: "desc" });
    const historyFilters = {
      from: filters.from,
      to: filters.to,
      q: filters.q,
      vehicle: filters.vehicle,
      operation: filters.operation,
      employee: firstParam(params, "colaborador"),
    };
    data.history = {
      page: await safe(getChecklistHistory(orgId, historyFilters, list.page, list.pageSize), "histórico"),
      filters: historyFilters,
      list,
    };
  }

  return <ActionPlansView data={data} />;
}
