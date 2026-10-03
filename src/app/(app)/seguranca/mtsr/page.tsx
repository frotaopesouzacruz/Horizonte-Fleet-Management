import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { hasPermission, requireOrganization } from "@/lib/auth/session";
import { loadMtsrTab } from "@/lib/mtsr/loaders";
import { getMtsrFilterOptions } from "@/lib/mtsr/queries";
import { MTSR_BASE_PATH, MTSR_PERMISSION_CODES, MTSR_TABS, mtsrVisibleTabs, type MtsrPerms, type MtsrTab } from "@/lib/mtsr/types";
import { firstParam, mtsrFiltersPayload, parseMtsrFilters, type SearchParamsLike } from "@/lib/mtsr/url";
import { MtsrView } from "./mtsr-view";

export const metadata: Metadata = {
  title: "Gestão de MTSR",
  description:
    "Conformidade dos componentes de segurança MTSR da frota: matriz por veículo, vistorias recebidas, manutenções vinculadas, ingestão e cadastros.",
};

/**
 * Segurança → Gestão de MTSR.
 *
 * A rota confere `mtsr.view`; cada leitura roda sob o cliente da própria
 * pessoa, e a RLS mais o escopo por operação/veículo decidem as linhas. Só a
 * aba aberta é carregada; prazo, conformidade e criticidade chegam prontos do
 * banco — a tela só apresenta.
 */
export default async function MtsrPage({ searchParams }: { searchParams: Promise<SearchParamsLike> }) {
  const params = await searchParams;
  const { session, organization } = await requireOrganization("mtsr.view");
  const orgId = organization.organizationId;

  const perms = Object.fromEntries(
    Object.entries(MTSR_PERMISSION_CODES).map(([key, code]) => [key, hasPermission(session, code)]),
  ) as unknown as MtsrPerms;
  const tabs = mtsrVisibleTabs(perms);
  if (tabs.length === 0) redirect("/sem-permissao");

  const requested = firstParam(params, "aba") as MtsrTab | undefined;
  const tab: MtsrTab =
    requested && (MTSR_TABS as readonly string[]).includes(requested) && tabs.includes(requested) ? requested : tabs[0];
  const filters = parseMtsrFilters(params);

  const [options, loaded] = await Promise.all([
    getMtsrFilterOptions(orgId),
    loadMtsrTab(tab, { organizationId: orgId, filters, payload: mtsrFiltersPayload(filters), params, perms }),
  ]);

  const flatParams: Record<string, string> = {};
  for (const [k, v] of Object.entries(params)) {
    const value = Array.isArray(v) ? v[0] : v;
    if (value) flatParams[k] = value;
  }

  return (
    <MtsrView
      data={{
        basePath: MTSR_BASE_PATH,
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
