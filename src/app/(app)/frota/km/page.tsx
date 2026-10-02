import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { hasPermission, requireOrganization } from "@/lib/auth/session";
import { getKmFilterOptions } from "@/lib/km/options";
import { loadKmTab } from "@/lib/km/loaders";
import { KM_PERMISSION_CODES, KM_TABS, kmVisibleTabs, type KmPerms, type KmTab } from "@/lib/km/types";
import { firstParam, kmFiltersPayload, parseKmFilters, type SearchParamsLike } from "@/lib/km/url";
import { KmView } from "./km-view";

export const metadata: Metadata = {
  title: "Gestão de KM Rodado",
  description: "Rodagem diária da frota: importação validada, planner mês/dia, análise gerencial, qualidade e plano de rodízio.",
};

/**
 * Gestão de Frota → Gestão de KM Rodado.
 *
 * A rota confere `km.view`; cada leitura roda sob o cliente da própria pessoa,
 * e a RLS mais o escopo por operação/veículo decidem as linhas. Só a aba
 * aberta é carregada.
 */
export default async function KmPage({ searchParams }: { searchParams: Promise<SearchParamsLike> }) {
  const params = await searchParams;
  const { session, organization } = await requireOrganization("km.view");
  const orgId = organization.organizationId;

  const perms = Object.fromEntries(
    Object.entries(KM_PERMISSION_CODES).map(([key, code]) => [key, hasPermission(session, code)]),
  ) as unknown as KmPerms;
  const tabs = kmVisibleTabs(perms);
  if (tabs.length === 0) redirect("/sem-permissao");

  const requested = firstParam(params, "aba") as KmTab | undefined;
  const tab: KmTab = requested && (KM_TABS as readonly string[]).includes(requested) && tabs.includes(requested) ? requested : tabs[0];
  const filters = parseKmFilters(params);

  const [options, loaded] = await Promise.all([
    getKmFilterOptions(orgId),
    loadKmTab(tab, { organizationId: orgId, filters, payload: kmFiltersPayload(filters), params, perms }),
  ]);

  const flatParams: Record<string, string> = {};
  for (const [k, v] of Object.entries(params)) {
    const value = Array.isArray(v) ? v[0] : v;
    if (value) flatParams[k] = value;
  }

  return (
    <KmView
      data={{
        basePath: "/frota/km",
        tab,
        tabs,
        filters,
        options,
        perms,
        params: flatParams,
        tabData: loaded.data,
        error: loaded.error,
      }}
    />
  );
}
