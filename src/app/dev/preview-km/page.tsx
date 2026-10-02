import { notFound } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
import { KmView } from "@/app/(app)/frota/km/km-view";
import { loadKmTab } from "@/lib/km/loaders";
import { kmFixtureStore } from "@/lib/km/rpc";
import type { KmFilterOptions } from "@/lib/km/options";
import { KM_PERMISSION_CODES, KM_TABS, kmVisibleTabs, type KmPerms, type KmTab } from "@/lib/km/types";
import { firstParam, kmFiltersPayload, parseKmFilters, type SearchParamsLike } from "@/lib/km/url";
import fixtures from "./fixtures.json";

/**
 * Renderiza a Gestão de KM Rodado contra dados fixos (saídas reais das
 * rotinas, gravadas do banco local com a planilha oficial importada).
 *
 * Os carregadores de verdade rodam aqui: só a chamada ao banco é trocada pelo
 * resolver dos fixtures (`kmFixtureStore`). Mesmo portão das demais prévias:
 * ausente de um build de produção normal.
 *
 * `?perfil=lideranca` renderiza com as permissões padrão da Liderança de
 * Operações (visões, rodízio só leitura, exportação).
 */
export const metadata = { title: "Preview · Gestão de KM Rodado", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

const enabled = process.env.NODE_ENV !== "production" || process.env.NEXT_PUBLIC_ENABLE_DEV_PAGES === "1";

const LEADERSHIP = [
  "km.view", "km.view_dashboard", "km.view_planner", "km.view_daily", "km.view_history", "km.view_analysis",
  "km.view_quality", "km.rotation.view", "km.export",
];

type Fx = typeof fixtures;
const FX = fixtures as Fx & Record<string, unknown>;

function resolver(fn: string): unknown {
  switch (fn) {
    case "km_overview": return FX.overview;
    case "km_settings_get": return FX.settings;
    case "km_planner": return FX.planner;
    case "km_daily": return FX.daily;
    case "km_vehicle_history": return FX.history;
    case "km_analysis": return FX.analysis;
    case "km_quality": return FX.quality;
    case "km_import_batches": return FX.batches;
    case "km_import_batch": {
      const row = (FX.batches as { rows: Record<string, unknown>[] }).rows[0];
      return { ...row, summary: FX.importSummary, findings_by_code: { high_mileage: 17, odometer_jump: 16, odometer_regression: 6 }, odometers_synced: 21865 };
    }
    case "km_import_findings": return FX.importFindings;
    case "km_rotation_candidates": return FX.rotationCandidates;
    case "km_rotation_plans_list": return FX.rotationPlans;
    case "km_rotation_plan_detail": return FX.rotationPlanDetail;
    case "km_simulate_rotation": return FX.rotationSimulate;
    default: return new Error(`rotina ${fn} sem fixture na prévia`);
  }
}

/** Opções de filtro derivadas dos próprios fixtures (veículos, tipos, subcategorias, modelos). */
function previewOptions(): KmFilterOptions {
  const rows = (FX.planner as unknown as { rows: Record<string, string | null>[] }).rows;
  const uniq = <T extends { id: string }>(list: T[]) => [...new Map(list.map((x) => [x.id, x])).values()];
  return {
    operations: [],
    coverage: [],
    brs: [],
    leaders: [],
    vehicleTypes: uniq(rows.filter((r) => r.vehicle_type_id).map((r) => ({ id: r.vehicle_type_id as string, name: r.type ?? "—" }))),
    subcategories: uniq(
      rows.filter((r) => r.subcategory_id).map((r) => ({ id: r.subcategory_id as string, name: r.subcategory ?? "—", vehicleTypeId: r.vehicle_type_id ?? "" })),
    ),
    makes: [],
    models: uniq(rows.filter((r) => r.model_id).map((r) => ({ id: r.model_id as string, name: r.model ?? "—", makeId: "" }))),
    units: [],
    apps: [],
    vehicles: rows.map((r) => ({
      id: r.vehicle_id as string,
      plate: r.plate ?? "—",
      fleetCode: r.fleet_code,
      status: r.status ?? "active",
      vehicleTypeId: r.vehicle_type_id,
      subcategoryId: r.subcategory_id,
      modelId: r.model_id,
    })),
  };
}

export default async function PreviewKmPage({ searchParams }: { searchParams: Promise<SearchParamsLike> }) {
  if (!enabled) notFound();
  const params = await searchParams;
  const granted = firstParam(params, "perfil") === "lideranca" ? LEADERSHIP : Object.values(KM_PERMISSION_CODES);
  const perms = Object.fromEntries(
    Object.entries(KM_PERMISSION_CODES).map(([key, code]) => [key, granted.includes(code)]),
  ) as unknown as KmPerms;
  const tabs = kmVisibleTabs(perms);
  const requested = firstParam(params, "aba") as KmTab | undefined;
  const tab: KmTab = requested && (KM_TABS as readonly string[]).includes(requested) && tabs.includes(requested) ? requested : tabs[0];
  const filters = parseKmFilters(params);
  // O Histórico abre um veículo dos fixtures quando a URL não traz nenhum.
  const effective: SearchParamsLike =
    tab === "historico" && !firstParam(params, "veiculo")
      ? { ...params, veiculo: (FX.history as { vehicle?: { vehicle_id?: string } }).vehicle?.vehicle_id ?? "" }
      : params;

  const loaded = await kmFixtureStore.run(resolver, () =>
    loadKmTab(tab, {
      organizationId: "00000000-0000-0000-0000-000000000000",
      filters,
      payload: kmFiltersPayload(filters),
      params: effective,
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
      <KmView
        data={{
          basePath: "/dev/preview-km",
          tab,
          tabs,
          filters,
          options: previewOptions(),
          perms,
          params: flatParams,
          tabData: loaded.data,
          error: loaded.error,
        }}
      />
    </AppShell>
  );
}
