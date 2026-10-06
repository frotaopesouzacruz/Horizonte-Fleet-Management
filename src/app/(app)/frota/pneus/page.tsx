import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { hasPermission, requireOrganization } from "@/lib/auth/session";
import { loadTiresTab } from "@/lib/tires/loaders";
import { getTiresFilterOptions } from "@/lib/tires/queries";
import { TIRES_BASE_PATH, TIRES_PERMISSION_CODES, TIRES_TABS, tiresVisibleTabs, type TiresPerms, type TiresTab } from "@/lib/tires/types";
import { firstParam, parseTiresFilters, tiresFiltersPayload, type SearchParamsLike } from "@/lib/tires/url";
import { TiresView } from "./tires-view";

export const metadata: Metadata = {
  title: "Gestão de Pneus",
  description:
    "Fotografia oficial dos pneus (Rodopar 10): base geral, aderência de medição e calibragem, cronograma, vistorias recebidas, serviços, qualidade e histórico.",
};

/**
 * Gestão de Frota → Gestão de Pneus.
 *
 * A rota confere `tires.view`; cada leitura roda sob o cliente da própria
 * pessoa, e a RLS mais o escopo por operação/veículo decidem as linhas. Só a
 * aba aberta é carregada; prazos, classe do sulco, regra de PSI e severidade
 * chegam prontos do banco — a tela só apresenta.
 */
export default async function TiresPage({ searchParams }: { searchParams: Promise<SearchParamsLike> }) {
  const params = await searchParams;
  const { session, organization } = await requireOrganization("tires.view");
  const orgId = organization.organizationId;

  const perms = Object.fromEntries(
    Object.entries(TIRES_PERMISSION_CODES).map(([key, code]) => [key, hasPermission(session, code)]),
  ) as unknown as TiresPerms;
  const tabs = tiresVisibleTabs(perms);
  if (tabs.length === 0) redirect("/sem-permissao");

  const requested = firstParam(params, "aba") as TiresTab | undefined;
  const tab: TiresTab =
    requested && (TIRES_TABS as readonly string[]).includes(requested) && tabs.includes(requested) ? requested : tabs[0];
  const filters = parseTiresFilters(params);

  const [options, loaded] = await Promise.all([
    getTiresFilterOptions(orgId, filters.reference ?? null).catch((error: unknown) => {
      console.error("tires: filter options", error instanceof Error ? error.message : error);
      return null;
    }),
    loadTiresTab(tab, { organizationId: orgId, filters, payload: tiresFiltersPayload(filters), params, perms }),
  ]);

  const flatParams: Record<string, string> = {};
  for (const [k, v] of Object.entries(params)) {
    const value = Array.isArray(v) ? v[0] : v;
    if (value) flatParams[k] = value;
  }

  return (
    <TiresView
      data={{
        basePath: TIRES_BASE_PATH,
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
