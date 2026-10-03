import { notFound } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
import { MtsrView } from "@/app/(app)/seguranca/mtsr/mtsr-view";
import { loadMtsrTab } from "@/lib/mtsr/loaders";
import { mtsrFixtureStore } from "@/lib/mtsr/rpc";
import { MTSR_PERMISSION_CODES, MTSR_TABS, mtsrVisibleTabs, type MtsrPerms, type MtsrTab } from "@/lib/mtsr/types";
import { firstParam, mtsrFiltersPayload, parseMtsrFilters, type SearchParamsLike } from "@/lib/mtsr/url";
import { mtsrPreviewOptions, mtsrPreviewResolver } from "./preview-data";

/**
 * Renderiza a Gestão de MTSR contra dados fixos (saídas das rotinas no mesmo
 * formato do banco). Os carregadores de verdade rodam aqui: só a chamada ao
 * banco é trocada pelo resolver dos fixtures (`mtsrFixtureStore`). Mesmo portão
 * das demais prévias: ausente de um build de produção normal.
 *
 * `?perfil=lideranca` renderiza com as permissões padrão da Liderança de
 * Operações (ver, dashboard, conformidade, revisar vistorias, exportar).
 */
export const metadata = { title: "Preview · Gestão de MTSR", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

const enabled = process.env.NODE_ENV !== "production" || process.env.NEXT_PUBLIC_ENABLE_DEV_PAGES === "1";

const LEADERSHIP = ["mtsr.view", "mtsr.dashboard.view", "mtsr.conformity.view", "mtsr.inspection.review", "mtsr.export", "maintenance.view"];

export default async function PreviewMtsrPage({ searchParams }: { searchParams: Promise<SearchParamsLike> }) {
  if (!enabled) notFound();
  const params = await searchParams;
  const granted = firstParam(params, "perfil") === "lideranca" ? LEADERSHIP : [...Object.values(MTSR_PERMISSION_CODES), "maintenance.view", "maintenance.create"];
  const perms = Object.fromEntries(
    Object.entries(MTSR_PERMISSION_CODES).map(([key, code]) => [key, granted.includes(code)]),
  ) as unknown as MtsrPerms;
  const tabs = mtsrVisibleTabs(perms);
  const requested = firstParam(params, "aba") as MtsrTab | undefined;
  const tab: MtsrTab = requested && (MTSR_TABS as readonly string[]).includes(requested) && tabs.includes(requested) ? requested : tabs[0];
  const filters = parseMtsrFilters(params);

  const loaded = await mtsrFixtureStore.run(mtsrPreviewResolver, () =>
    loadMtsrTab(tab, {
      organizationId: "00000000-0000-0000-0000-000000000000",
      filters,
      payload: mtsrFiltersPayload(filters),
      params,
      perms,
    }),
  );

  const flatParams: Record<string, string> = {};
  for (const [k, v] of Object.entries(params)) {
    const value = Array.isArray(v) ? v[0] : v;
    if (value) flatParams[k] = value;
  }

  return (
    <AppShell permissions={granted}>
      <MtsrView
        data={{
          basePath: "/dev/preview-mtsr",
          tab,
          tabs,
          filters,
          options: mtsrPreviewOptions(),
          perms,
          params: flatParams,
          tabData: loaded.data,
          error: loaded.error,
        }}
      />
    </AppShell>
  );
}
