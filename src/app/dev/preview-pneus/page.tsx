import { notFound } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
import { TiresView } from "@/app/(app)/frota/pneus/tires-view";
import { loadTiresTab } from "@/lib/tires/loaders";
import { getTiresFilterOptions } from "@/lib/tires/queries";
import { tiresFixtureStore } from "@/lib/tires/rpc";
import { TIRES_PERMISSION_CODES, TIRES_TABS, tiresVisibleTabs, type TiresPerms, type TiresTab } from "@/lib/tires/types";
import { firstParam, parseTiresFilters, tiresFiltersPayload, type SearchParamsLike } from "@/lib/tires/url";
import { tiresPreviewResolver } from "./preview-data";

/**
 * Renderiza a Gestão de Pneus contra dados fixos (saídas das rotinas no
 * mesmo formato do banco). Os carregadores de verdade rodam aqui: só a
 * chamada ao banco é trocada pelo resolver dos fixtures (`tiresFixtureStore`).
 * Mesmo portão das demais prévias: ausente de um build de produção normal.
 *
 * `?perfil=lideranca` renderiza com as permissões padrão da Liderança de
 * Operações na matriz (ver, visão geral, base, histórico, aderências,
 * cronograma, serviços e o aplicativo) — sem Sincronização Rodopar, Auditoria dos dados, revisão de
 * vistorias, exportação nem edição de parâmetros.
 */
export const metadata = { title: "Preview · Gestão de Pneus", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

const enabled = process.env.NODE_ENV !== "production" || process.env.NEXT_PUBLIC_ENABLE_DEV_PAGES === "1";

const LEADERSHIP = [
  "tires.view", "tires.dashboard.view", "tires.base.view", "tires.history.view", "tires.measurement.view", "tires.calibration.view",
  "tires.schedule.view", "tires.services.view", "applications.view", "applications.tires.execute",
];

export default async function PreviewTiresPage({ searchParams }: { searchParams: Promise<SearchParamsLike> }) {
  if (!enabled) notFound();
  const params = await searchParams;
  const granted = firstParam(params, "perfil") === "lideranca" ? LEADERSHIP : [...Object.values(TIRES_PERMISSION_CODES), "applications.view"];
  const perms = Object.fromEntries(
    Object.entries(TIRES_PERMISSION_CODES).map(([key, code]) => [key, granted.includes(code)]),
  ) as unknown as TiresPerms;
  const tabs = tiresVisibleTabs(perms);
  const requested = firstParam(params, "aba") as TiresTab | undefined;
  const tab: TiresTab = requested && (TIRES_TABS as readonly string[]).includes(requested) && tabs.includes(requested) ? requested : tabs[0];
  const filters = parseTiresFilters(params);
  const orgId = "00000000-0000-0000-0000-000000000000";

  const [options, loaded] = await tiresFixtureStore.run(tiresPreviewResolver, () =>
    Promise.all([
      getTiresFilterOptions(orgId, filters.reference ?? null),
      loadTiresTab(tab, { organizationId: orgId, filters, payload: tiresFiltersPayload(filters), params, perms }),
    ]),
  );

  const flatParams: Record<string, string> = {};
  for (const [k, v] of Object.entries(params)) {
    const value = Array.isArray(v) ? v[0] : v;
    if (value) flatParams[k] = value;
  }

  return (
    <AppShell permissions={granted}>
      <TiresView
        data={{
          basePath: "/dev/preview-pneus",
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
    </AppShell>
  );
}
