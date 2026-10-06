import "server-only";

import type { Json } from "@/types/database.types";
import {
  getTireImportHistory,
  getTireImportPreview,
  getTireInspectionDetail,
  getTireInspectionsReceived,
  getTireMaintenanceServices,
  getTireRepairs,
  getTiresAdherence,
  getTiresAudit,
  getTiresBase,
  getTiresCatalog,
  getTiresEvents,
  getTiresOverview,
  getTirePositions,
  getTiresQuality,
  getTiresSchedule,
} from "./queries";
import type {
  ImportPreviewSection,
  ScheduleWindow,
  TireImportHistory,
  TireImportPreview,
  TireInspectionDetail,
  TireOverview,
  TirePositionInfo,
  TiresAdherence,
  TiresAuditList,
  TiresBase,
  TiresBaseView,
  TiresCatalog,
  TiresEventsList,
  TiresFilters,
  TiresInspectionsReceived,
  TiresMaintenanceServices,
  TiresPerms,
  TiresQuality,
  TiresRepairsList,
  TiresSchedule,
  TiresTab,
} from "./types";
import { firstParam, parseBaseSort, parsePage, splitList, type SearchParamsLike } from "./url";

/** O que cada carregador de aba recebe do servidor. */
export interface TiresLoadContext {
  organizationId: string;
  filters: TiresFilters;
  /** Filtros já no formato das rotinas (ids e códigos canônicos). */
  payload: Record<string, Json>;
  /** Parâmetros crus da URL (estado próprio de cada aba: página, ordem, sub-aba…). */
  params: SearchParamsLike;
  perms: TiresPerms;
}

export type TiresServicesSub = "consertos" | "alinhamento";
export type TiresHistorySub = "eventos" | "auditoria";

export interface TiresServicesData {
  sub: TiresServicesSub;
  repairs: TiresRepairsList | null;
  maintenance: TiresMaintenanceServices | null;
}

export interface TiresHistoryData {
  sub: TiresHistorySub;
  events: TiresEventsList | null;
  audit: TiresAuditList | null;
}

export interface TiresImportData {
  history: TireImportHistory;
  preview: TireImportPreview | null;
  /** Falha ao abrir o lote pedido em `?lote=` (o histórico continua visível). */
  previewError: string | null;
}

/** Vistorias recebidas + a vistoria aberta na gaveta (`?vistoria=`), lida no servidor. */
export type TiresInspectionsData = TiresInspectionsReceived & { detail: TireInspectionDetail | null; detailError: string | null };

/** Base geral + o dicionário de posições (para montar o diagrama de eixos de cada frota). */
export type TiresBaseData = TiresBase & { positions: TirePositionInfo[] };

export interface TiresTabData {
  "visao-geral": TireOverview;
  base: TiresBaseData;
  medicao: TiresAdherence;
  calibragem: TiresAdherence;
  cronograma: TiresSchedule;
  vistorias: TiresInspectionsData;
  servicos: TiresServicesData;
  qualidade: TiresQuality;
  historico: TiresHistoryData;
  importacao: TiresImportData;
  parametros: TiresCatalog;
}

const BASE_VIEWS: TiresBaseView[] = ["frota", "fogo", "fora"];
const WINDOWS: ScheduleWindow[] = ["todos", "vencidos", "hoje", "7d", "15d", "proximos", "sem_medicao", "sem_calibragem"];
const PENDING = ["all", "vencido", "proximo", "sem_registro", "pressao", "sem_parametro"];
const SECTIONS: ImportPreviewSection[] = ["issues", "changes", "new", "rows", "absent", "reappeared"];
const isUuid = (v: string | undefined): v is string => !!v && /^[0-9a-f-]{36}$/i.test(v);

/** Recorte dos filtros globais que as rotinas de vistorias e serviços aceitam. */
function pick(payload: Record<string, Json>, keys: string[]): Record<string, Json> {
  const out: Record<string, Json> = {};
  for (const k of keys) if (payload[k] !== undefined) out[k] = payload[k];
  return out;
}

function dates(params: SearchParamsLike, f: Record<string, Json>) {
  const from = firstParam(params, "de");
  const to = firstParam(params, "ate");
  if (from && /^\d{4}-\d{2}-\d{2}$/.test(from)) f.date_from = from;
  if (to && /^\d{4}-\d{2}-\d{2}$/.test(to)) f.date_to = to;
}

/**
 * Só a aba aberta é carregada. Uma falha vira mensagem no painel — a tela
 * (cabeçalho, filtros, abas) continua de pé, e nenhum número é inventado.
 */
export async function loadTiresTab<T extends TiresTab>(
  tab: T,
  ctx: TiresLoadContext,
): Promise<{ data: TiresTabData[T] | null; error: string | null }> {
  try {
    const loaders: { [K in TiresTab]: (c: TiresLoadContext) => Promise<TiresTabData[K]> } = {
      "visao-geral": (c) => getTiresOverview(c.organizationId, c.payload),
      base: async (c) => {
        const v = firstParam(c.params, "visao") as TiresBaseView | undefined;
        const view = v && BASE_VIEWS.includes(v) ? v : "frota";
        const { sort, dir } = parseBaseSort(c.params);
        const { limit, offset } = parsePage(c.params, "pagina", view === "frota" ? 25 : 50);
        const [base, positions] = await Promise.all([
          getTiresBase(c.organizationId, c.payload, view, sort, dir, limit, offset),
          view === "frota" ? getTirePositions(c.organizationId) : Promise.resolve([]),
        ]);
        return { ...base, positions };
      },
      medicao: (c) => {
        const p = firstParam(c.params, "pendencia");
        const { limit, offset } = parsePage(c.params, "pagina", 50);
        return getTiresAdherence(c.organizationId, "measurement", c.payload, p && PENDING.includes(p) ? p : "all", limit, offset);
      },
      calibragem: (c) => {
        const p = firstParam(c.params, "pendencia");
        const { limit, offset } = parsePage(c.params, "pagina", 50);
        return getTiresAdherence(c.organizationId, "calibration", c.payload, p && PENDING.includes(p) ? p : "all", limit, offset);
      },
      cronograma: (c) => {
        const w = firstParam(c.params, "janela") as ScheduleWindow | undefined;
        const { limit, offset } = parsePage(c.params, "pagina", 50);
        return getTiresSchedule(c.organizationId, c.payload, w && WINDOWS.includes(w) ? w : "todos", limit, offset);
      },
      vistorias: async (c) => {
        const { limit, offset } = parsePage(c.params, "pagina", 50);
        const f = pick(c.payload, ["operation_ids", "city_ids", "br_ids", "leader_ids", "vehicle_ids", "search"]);
        const fase = splitList(firstParam(c.params, "fase"));
        f.statuses = fase.length ? fase : ["pendente_revisao"];
        if (firstParam(c.params, "fase") === "todas") delete f.statuses;
        const inspector = firstParam(c.params, "inspetor");
        if (isUuid(inspector)) f.inspector_user_id = inspector;
        const div = firstParam(c.params, "divergencia");
        if (div) f.divergence = div;
        dates(c.params, f);
        const open = firstParam(c.params, "vistoria");
        const [list, detail] = await Promise.all([
          getTireInspectionsReceived(c.organizationId, f, limit, offset),
          isUuid(open)
            ? getTireInspectionDetail(c.organizationId, open).then(
                (d) => ({ d, e: null as string | null }),
                (e: unknown) => ({ d: null, e: e instanceof Error ? e.message : String(e) }),
              )
            : Promise.resolve({ d: null, e: null as string | null }),
        ]);
        return { ...list, detail: detail.d, detailError: detail.e };
      },
      servicos: async (c) => {
        const sub: TiresServicesSub = firstParam(c.params, "sub") === "alinhamento" ? "alinhamento" : "consertos";
        const { limit, offset } = parsePage(c.params, "pagina", 50);
        const f = pick(c.payload, ["vehicle_ids", "search"]);
        dates(c.params, f);
        if (sub === "consertos") {
          const status = firstParam(c.params, "registro");
          if (status === "voided" || status === "all") f.status = status;
          return { sub, repairs: await getTireRepairs(c.organizationId, f, limit, offset), maintenance: null };
        }
        const kinds = splitList(firstParam(c.params, "servico"));
        if (kinds.length) f.kinds = kinds;
        const statuses = splitList(firstParam(c.params, "status_manutencao"));
        if (statuses.length) f.statuses = statuses;
        return { sub, repairs: null, maintenance: await getTireMaintenanceServices(c.organizationId, f, limit, offset) };
      },
      qualidade: (c) => {
        const { limit, offset } = parsePage(c.params, "pagina", 50);
        return getTiresQuality(c.organizationId, c.payload, firstParam(c.params, "problema") ?? null, limit, offset);
      },
      historico: async (c) => {
        const sub: TiresHistorySub =
          firstParam(c.params, "sub") === "auditoria" && c.perms.audit ? "auditoria" : c.perms.history ? "eventos" : "auditoria";
        const { limit, offset } = parsePage(c.params, "pagina", 50);
        if (sub === "eventos") {
          const f = pick(c.payload, ["vehicle_ids", "search"]);
          const types = splitList(firstParam(c.params, "evento"));
          if (types.length) f.event_types = types;
          dates(c.params, f);
          return { sub, events: await getTiresEvents(c.organizationId, f, limit, offset), audit: null };
        }
        const f = pick(c.payload, ["search"]);
        const action = firstParam(c.params, "acao");
        if (action) f.action = action;
        return { sub, events: null, audit: await getTiresAudit(c.organizationId, f, limit, offset) };
      },
      importacao: async (c) => {
        const batchId = firstParam(c.params, "lote");
        const s = firstParam(c.params, "secao") as ImportPreviewSection | undefined;
        const { limit, offset } = parsePage(c.params, "pagina", 50);
        const [history, preview] = await Promise.all([
          getTireImportHistory(c.organizationId, 20, 0),
          isUuid(batchId) && c.perms.import
            ? getTireImportPreview(c.organizationId, batchId, s && SECTIONS.includes(s) ? s : "issues", firstParam(c.params, "filtro") ?? null, limit, offset).then(
                (p) => ({ p, e: null as string | null }),
                (e: unknown) => ({ p: null, e: e instanceof Error ? e.message : String(e) }),
              )
            : Promise.resolve({ p: null, e: null as string | null }),
        ]);
        // um lote inexistente ou fora do alcance não derruba a aba: o histórico segue
        return { history, preview: preview.p, previewError: preview.e };
      },
      parametros: (c) => getTiresCatalog(c.organizationId),
    };
    return { data: (await loaders[tab](ctx)) as TiresTabData[T], error: null };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`tires: ${tab}`, message);
    return { data: null, error: message };
  }
}
