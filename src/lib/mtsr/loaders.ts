import "server-only";

import type { Json } from "@/types/database.types";
import {
  getMtsrCatalog,
  getMtsrDashboard,
  getMtsrEvents,
  getMtsrFleetStatus,
  getMtsrHealth,
  getMtsrImportHistory,
  getMtsrIngestionEvents,
  getMtsrInspectionsReceived,
  getMtsrMaintenanceLinks,
  type MtsrImportBatch,
  type MtsrIngestionEventsPage,
  type MtsrMaintenanceLinksPage,
} from "./queries";
import type {
  MtsrCatalog,
  MtsrDashboard,
  MtsrEventsList,
  MtsrFilters,
  MtsrFleetStatus,
  MtsrHealth,
  MtsrInspectionsReceived,
  MtsrPerms,
  MtsrTab,
} from "./types";
import { firstParam, parsePage, parseSort, type SearchParamsLike } from "./url";

/** O que cada carregador de aba recebe do servidor. */
export interface MtsrLoadContext {
  organizationId: string;
  filters: MtsrFilters;
  /** Filtros já no formato das rotinas (ids). */
  payload: Record<string, Json>;
  /** Parâmetros crus da URL (estado próprio de cada aba: página, ordem, sub-aba…). */
  params: SearchParamsLike;
  perms: MtsrPerms;
}

export interface MtsrIngestionData {
  catalog: MtsrCatalog;
  events: MtsrIngestionEventsPage;
  imports: MtsrImportBatch[];
}

export interface MtsrTabData {
  "visao-geral": MtsrDashboard;
  conformidade: MtsrFleetStatus;
  vistorias: MtsrInspectionsReceived;
  manutencoes: MtsrMaintenanceLinksPage & { catalog: MtsrCatalog };
  ingestao: MtsrIngestionData;
  cadastros: MtsrCatalog;
  auditoria: MtsrEventsList;
  saude: MtsrHealth;
}

const list = (v: string | undefined) => (v ?? "").split(",").map((s) => s.trim()).filter(Boolean);

/**
 * Só a aba aberta é carregada. Uma falha vira mensagem no painel — a tela
 * (cabeçalho, filtros, abas) continua de pé.
 */
export async function loadMtsrTab<T extends MtsrTab>(
  tab: T,
  ctx: MtsrLoadContext,
): Promise<{ data: MtsrTabData[T] | null; error: string | null }> {
  try {
    const loaders: { [K in MtsrTab]: (c: MtsrLoadContext) => Promise<MtsrTabData[K]> } = {
      "visao-geral": (c) => getMtsrDashboard(c.organizationId, c.payload),
      conformidade: (c) => {
        const { sort, dir } = parseSort(c.params);
        const { limit, offset } = parsePage(c.params, "pagina", 50);
        return getMtsrFleetStatus(c.organizationId, c.payload, sort, dir, limit, offset);
      },
      vistorias: (c) => {
        const { limit, offset } = parsePage(c.params, "pagina", 50);
        const f: Record<string, Json> = {};
        const statuses = list(firstParam(c.params, "situacao"));
        if (statuses.length) f.statuses = statuses;
        else f.statuses = ["pendente_validacao"];
        if (c.filters.q) f.search = c.filters.q;
        if (c.payload.operation_ids) f.operation_ids = c.payload.operation_ids;
        if (c.payload.vehicle_type_ids) f.vehicle_type_ids = c.payload.vehicle_type_ids;
        const inspector = firstParam(c.params, "inspetor");
        if (inspector) f.inspector_ids = [inspector];
        const from = firstParam(c.params, "de");
        const to = firstParam(c.params, "ate");
        if (from) f.date_from = from;
        if (to) f.date_to = to;
        if (firstParam(c.params, "nok") === "1") f.nok_only = true;
        return getMtsrInspectionsReceived(c.organizationId, f, limit, offset);
      },
      manutencoes: async (c) => {
        const { limit, offset } = parsePage(c.params, "pagina", 50);
        const [page, catalog] = await Promise.all([
          getMtsrMaintenanceLinks(
            c.organizationId,
            {
              statuses: list(firstParam(c.params, "vinculo")),
              revalidation: list(firstParam(c.params, "revalidacao_status")),
              componentId: c.filters.component ?? null,
              vehicleIds: list(c.filters.vehicle),
              search: c.filters.q ?? null,
            },
            limit,
            offset,
          ),
          getMtsrCatalog(c.organizationId),
        ]);
        return { ...page, catalog };
      },
      ingestao: async (c) => {
        const { limit, offset } = parsePage(c.params, "pagina", 50);
        const [catalog, events, imports] = await Promise.all([
          getMtsrCatalog(c.organizationId),
          getMtsrIngestionEvents(
            c.organizationId,
            { statuses: list(firstParam(c.params, "resultado")), sourceId: firstParam(c.params, "fonte") ?? null, vehicleIds: list(c.filters.vehicle) },
            limit,
            offset,
          ),
          c.perms.import || c.perms.audit ? getMtsrImportHistory(c.organizationId, 20) : Promise.resolve([]),
        ]);
        return { catalog, events, imports };
      },
      cadastros: (c) => getMtsrCatalog(c.organizationId),
      auditoria: (c) => {
        const { limit, offset } = parsePage(c.params, "pagina", 50);
        const f: Record<string, Json> = {};
        const types = list(firstParam(c.params, "evento"));
        if (types.length) f.event_types = types;
        if (c.payload.vehicle_ids) f.vehicle_ids = c.payload.vehicle_ids;
        const from = firstParam(c.params, "de");
        const to = firstParam(c.params, "ate");
        if (from) f.date_from = from;
        if (to) f.date_to = to;
        if (c.filters.q) f.search = c.filters.q;
        return getMtsrEvents(c.organizationId, f, limit, offset);
      },
      saude: (c) => getMtsrHealth(c.organizationId),
    };
    return { data: (await loaders[tab](ctx)) as MtsrTabData[T], error: null };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`mtsr: ${tab}`, message);
    return { data: null, error: message };
  }
}
