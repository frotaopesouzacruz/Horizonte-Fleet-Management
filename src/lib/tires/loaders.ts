import "server-only";

import type { Json } from "@/types/database.types";
import {
  getTireImportHistory,
  getTireImportPreview,
  getTireInspectionDetail,
  getTireInspectionsReceived,
  getTireMaintenanceServices,
  getTireRepairs,
  getTiresAudit,
  getTiresAuditCenter,
  getTiresBase,
  getTiresBaseGroups,
  getTiresCatalog,
  getTiresEvents,
  getTiresIndicator,
  getTiresKpiHistory,
  getTiresOverview,
  getTirePositions,
  getTiresPriorities,
  getTiresSchedule,
  getTiresSyncOverview,
  getTireKpiSchedule,
  getTireSyncSource,
} from "./queries";
import type {
  ImportPreviewSection,
  ScheduleWindow,
  TireImportHistory,
  TireImportPreview,
  TireInspectionDetail,
  TireOverviewV2,
  TirePositionInfo,
  TiresAuditList,
  TiresBase,
  TiresBaseView,
  TiresCatalog,
  TiresEventsList,
  TiresFilters,
  TiresInspectionsReceived,
  TiresMaintenanceServices,
  TiresPerms,
  TiresRepairsList,
  TiresSchedule,
  TiresTab,
  AuditGroupBy,
  KpiDimension,
  KpiIndicator,
  KpiPeriod,
  KpiSchedule,
  TireIndicatorKey,
  TireSyncSource,
  TiresAuditCenter,
  TiresBaseFleet,
  TiresBaseGroups,
  TiresGroupBy,
  TiresIndicator,
  TiresKpiHistory,
  TiresPriorities,
  TiresSyncOverview,
} from "./types";
import { parseGroupBy } from "./types";
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

/** Sincronização Rodopar: estado da fonte oficial + histórico de lotes (envio manual = contingência). */
export interface TiresSyncData {
  sync: TiresSyncOverview | null;
  /** Falha ao ler a sincronização (sem permissão de leitura ou erro): o histórico de lotes segue. */
  syncError: string | null;
  history: TireImportHistory;
  preview: TireImportPreview | null;
  /** Falha ao abrir o lote pedido em `?lote=` (o histórico continua visível). */
  previewError: string | null;
}

/** Visão Geral + Prioridades agrupadas (`?prioridade=operacao|local|lideranca`, `?grupo=` abre o grupo). */
export interface TiresOverviewData {
  overview: TireOverviewV2;
  priorities: TiresPriorities | null;
  prioritiesError: string | null;
}

/** Sub-visões das Aderências (cada uma é um indicador centralizado no banco). */
export type TiresMeasurementSub = "sulco" | "prazo";
export type TiresCalibrationSub = "conformidade" | "prazo" | "psi";
export const MEASUREMENT_SUB_INDICATOR: Record<TiresMeasurementSub, TireIndicatorKey> = { sulco: "tread", prazo: "measurement" };
export const CALIBRATION_SUB_INDICATOR: Record<TiresCalibrationSub, TireIndicatorKey> = {
  conformidade: "calibration_conformity",
  prazo: "calibration",
  psi: "psi",
};
/** Indicador do histórico semanal correspondente a cada indicador gerencial. */
export const INDICATOR_KPI: Record<TireIndicatorKey, KpiIndicator> = {
  tread: "tread_conformity",
  measurement: "measurement_deadline",
  calibration: "calibration_deadline",
  psi: "psi_conformity",
  calibration_conformity: "calibration_conformity",
  overall: "overall_conformity",
};

export interface TiresIndicatorData<S extends string = string> {
  sub: S;
  indicator: TiresIndicator;
  /** Série semanal do indicador (Geral) para a evolução no próprio painel; null sem histórico/permite falhar. */
  history: TiresKpiHistory | null;
}

/** Base Geral + grupos (Por Frota agrupada) + frotas dos grupos abertos (`?abertos=k1,k2`). */
export type TiresBaseData = TiresBase & {
  positions: TirePositionInfo[];
  /** "nenhum" desliga o agrupamento */
  groupBy: TiresGroupBy | "nenhum";
  groups: TiresBaseGroups | null;
  openGroups: Record<string, TiresBaseFleet>;
};

export type TiresParametersData = TiresCatalog & { syncSource: TireSyncSource | null; kpiSchedule: KpiSchedule | null };

/** Vistorias recebidas + a vistoria aberta na gaveta (`?vistoria=`), lida no servidor. */
export type TiresInspectionsData = TiresInspectionsReceived & { detail: TireInspectionDetail | null; detailError: string | null };

export interface TiresTabData {
  "visao-geral": TiresOverviewData;
  base: TiresBaseData;
  medicao: TiresIndicatorData<TiresMeasurementSub>;
  calibragem: TiresIndicatorData<TiresCalibrationSub>;
  evolucao: TiresKpiHistory;
  cronograma: TiresSchedule;
  vistorias: TiresInspectionsData;
  servicos: TiresServicesData;
  qualidade: TiresAuditCenter;
  historico: TiresHistoryData;
  sincronizacao: TiresSyncData;
  parametros: TiresParametersData;
}

const BASE_VIEWS: TiresBaseView[] = ["frota", "fogo", "fora"];
const WINDOWS: ScheduleWindow[] = ["todos", "vencidos", "hoje", "7d", "15d", "proximos", "sem_medicao", "sem_calibragem"];
const KPI_INDICATORS: KpiIndicator[] = [
  "overall_conformity", "calibration_conformity", "tread_conformity", "measurement_deadline", "calibration_deadline", "psi_conformity",
  "data_quality", "tires_in_use", "tires_total", "tread_critical", "measurement_overdue", "calibration_overdue", "psi_out", "critical_tires",
];
const KPI_DIMENSIONS: KpiDimension[] = ["geral", "operation", "city", "leader", "vehicle_type", "dimension"];
const AUDIT_GROUPS: AuditGroupBy[] = ["rule", "category", "severity", "operation", "city", "leader"];
/** Situação pedida na lista de pendências de um indicador (código do banco, sem espaços). */
const statusParam = (v: string | undefined) => (v && /^[a-z_]{3,40}$/.test(v) ? v : null);
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
      "visao-geral": async (c) => {
        const groupBy = parseGroupBy(firstParam(c.params, "prioridade"));
        const group = firstParam(c.params, "grupo") ?? null;
        const { limit, offset } = parsePage(c.params, "pagina", 25);
        const [overview, priorities] = await Promise.all([
          getTiresOverview(c.organizationId, c.payload),
          getTiresPriorities(c.organizationId, c.payload, groupBy, group, limit, offset).then(
            (p) => ({ p, e: null as string | null }),
            (e: unknown) => ({ p: null, e: e instanceof Error ? e.message : String(e) }),
          ),
        ]);
        return { overview, priorities: priorities.p, prioritiesError: priorities.e };
      },
      base: async (c) => {
        const v = firstParam(c.params, "visao") as TiresBaseView | undefined;
        const view = v && BASE_VIEWS.includes(v) ? v : "frota";
        const { sort, dir } = parseBaseSort(c.params);
        const rawGroup = firstParam(c.params, "agrupar");
        const groupBy: TiresGroupBy | "nenhum" = view !== "frota" || rawGroup === "nenhum" ? "nenhum" : parseGroupBy(rawGroup);
        const { limit, offset } = parsePage(c.params, "pagina", view === "frota" ? 25 : 50);
        const open = splitList(firstParam(c.params, "abertos")).slice(0, 6);
        const groupPayload = (key: string): Record<string, Json> => {
          if (groupBy === "nenhum") return c.payload;
          const missing = groupBy === "operation" ? "operation" : groupBy === "city" ? "city" : "leader";
          if (key === "—") return { ...c.payload, null_dims: [missing] };
          const k = groupBy === "operation" ? "operation_ids" : groupBy === "city" ? "city_ids" : "leader_ids";
          return { ...c.payload, [k]: [groupBy === "city" ? Number(key) : key] };
        };
        const [base, positions, groups, opened] = await Promise.all([
          groupBy === "nenhum"
            ? getTiresBase(c.organizationId, c.payload, view, sort, dir, limit, offset)
            : // agrupado: a página traz só o resumo; as frotas vêm por grupo aberto
              getTiresBase(c.organizationId, c.payload, view, sort, dir, 1, 0),
          view === "frota" ? getTirePositions(c.organizationId) : Promise.resolve([]),
          groupBy === "nenhum" ? Promise.resolve(null) : getTiresBaseGroups(c.organizationId, c.payload, groupBy),
          Promise.all(
            groupBy === "nenhum"
              ? []
              : open.map((key) => getTiresBase(c.organizationId, groupPayload(key), "frota", sort, dir, 50, 0).then((r) => [key, r] as const)),
          ),
        ]);
        return {
          ...base,
          positions,
          groupBy,
          groups,
          openGroups: Object.fromEntries(opened.map(([k, r]) => [k, r as TiresBaseFleet])),
        } as TiresBaseData;
      },
      medicao: async (c) => {
        const sub = firstParam(c.params, "sub") === "prazo" ? "prazo" : "sulco";
        const indicator = MEASUREMENT_SUB_INDICATOR[sub];
        const { limit, offset } = parsePage(c.params, "pagina", 50);
        const [data, history] = await Promise.all([
          getTiresIndicator(c.organizationId, indicator, c.payload, statusParam(firstParam(c.params, "pendencia")), limit, offset),
          c.perms.dashboard ? getTiresKpiHistory(c.organizationId, "semana", INDICATOR_KPI[indicator]).catch(() => null) : Promise.resolve(null),
        ]);
        return { sub, indicator: data, history };
      },
      calibragem: async (c) => {
        const raw = firstParam(c.params, "sub");
        const sub = raw === "prazo" || raw === "psi" ? raw : "conformidade";
        const indicator = CALIBRATION_SUB_INDICATOR[sub];
        const { limit, offset } = parsePage(c.params, "pagina", 50);
        const [data, history] = await Promise.all([
          getTiresIndicator(c.organizationId, indicator, c.payload, statusParam(firstParam(c.params, "pendencia")), limit, offset),
          c.perms.dashboard ? getTiresKpiHistory(c.organizationId, "semana", INDICATOR_KPI[indicator]).catch(() => null) : Promise.resolve(null),
        ]);
        return { sub, indicator: data, history };
      },
      evolucao: (c) => {
        const period: KpiPeriod = firstParam(c.params, "periodo") === "mes" ? "mes" : "semana";
        const ind = firstParam(c.params, "indicador") as KpiIndicator | undefined;
        const dim = firstParam(c.params, "dimensao") as KpiDimension | undefined;
        const member = firstParam(c.params, "membro") ?? null;
        return getTiresKpiHistory(
          c.organizationId,
          period,
          ind && KPI_INDICATORS.includes(ind) ? ind : "overall_conformity",
          dim && KPI_DIMENSIONS.includes(dim) ? dim : "geral",
          member,
        );
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
        const g = firstParam(c.params, "agrupar") as AuditGroupBy | undefined;
        const st = firstParam(c.params, "achado");
        return getTiresAuditCenter(c.organizationId, pick(c.payload, ["operation_ids", "city_ids", "leader_ids", "vehicle_ids", "search"]), {
          category: firstParam(c.params, "categoria") ?? null,
          rule: firstParam(c.params, "regra") ?? null,
          severity: firstParam(c.params, "gravidade") ?? null,
          status: st === "resolvida" || st === "todas" ? st : "aberta",
          groupBy: g && AUDIT_GROUPS.includes(g) ? g : "rule",
          limit,
          offset,
        });
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
      sincronizacao: async (c) => {
        const batchId = firstParam(c.params, "lote");
        const s = firstParam(c.params, "secao") as ImportPreviewSection | undefined;
        const { limit, offset } = parsePage(c.params, "pagina", 50);
        const runsPage = parsePage(c.params, "execucoes", 20);
        const [sync, history, preview] = await Promise.all([
          getTiresSyncOverview(c.organizationId, runsPage.limit, runsPage.offset).then(
            (d) => ({ d, e: null as string | null }),
            (e: unknown) => ({ d: null, e: e instanceof Error ? e.message : String(e) }),
          ),
          getTireImportHistory(c.organizationId, 20, 0),
          isUuid(batchId) && c.perms.import
            ? getTireImportPreview(c.organizationId, batchId, s && SECTIONS.includes(s) ? s : "issues", firstParam(c.params, "filtro") ?? null, limit, offset).then(
                (p) => ({ p, e: null as string | null }),
                (e: unknown) => ({ p: null, e: e instanceof Error ? e.message : String(e) }),
              )
            : Promise.resolve({ p: null, e: null as string | null }),
        ]);
        // um lote inexistente ou fora do alcance não derruba a aba: o histórico segue
        return { sync: sync.d, syncError: sync.e, history, preview: preview.p, previewError: preview.e };
      },
      parametros: async (c) => {
        const [catalog, syncSource, kpiSchedule] = await Promise.all([
          getTiresCatalog(c.organizationId),
          getTireSyncSource(c.organizationId).catch(() => null),
          getTireKpiSchedule(c.organizationId).catch(() => null),
        ]);
        return { ...catalog, syncSource, kpiSchedule };
      },
    };
    return { data: (await loaders[tab](ctx)) as TiresTabData[T], error: null };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`tires: ${tab}`, message);
    return { data: null, error: message };
  }
}
