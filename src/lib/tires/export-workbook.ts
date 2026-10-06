import "server-only";

import type ExcelJS from "exceljs";
import type { Json } from "@/types/database.types";
import {
  BRAND,
  dataSheet,
  excelDate,
  excelStamp,
  newWorkbook,
  NUM,
  placeLogo,
  sectionBand,
  stampText,
  writeTable,
  type XCell,
  type XCol,
} from "@/app/(app)/frota/km/relatorio/xlsx-kit";
import {
  AUDIT_ACTION_LABEL,
  AUDIT_CATEGORY_LABEL,
  AUDIT_SEVERITY_LABEL,
  CAL_CONF_LABEL,
  CRITICALITY_LABEL,
  DEADLINE_LABEL,
  ENRICHMENT_LABEL,
  EVENT_TONE,
  INDICATOR_DIM_LABEL,
  INDICATOR_LABEL,
  INSPECTION_STATUS_LABEL,
  LAYOUT_SOURCE_LABEL,
  PSI_LABEL,
  SCHEDULE_WINDOW_LABEL,
  SEVERITY_LABEL,
  STATUS_LABEL,
  TIRES_FILTER_PARAM,
  TIRES_TAB_LABEL,
  TREAD_LABEL,
  eventTypeLabel,
  formatDate,
  modernTerms,
  issueCode,
  issueLabel,
  reasonLabel,
  type AuditCategory,
  type AuditSeverity,
  type ScheduleWindow,
  type TireAuditFinding,
  type TireAuditRow,
  type TireEventRow,
  type TireFilterOptions,
  type TireFleetGroup,
  type TireIndicatorDim,
  type TireIndicatorKey,
  type TireIndicatorPendingRow,
  type TireInspectionRow,
  type TireRow,
  type TireScheduleRow,
  type TiresAuditCenter,
  type TiresAuditList,
  type TiresBase,
  type TiresBaseView,
  type TiresEventsList,
  type TiresFilters,
  type TiresIndicator,
  type TiresInspectionsReceived,
  type TiresSchedule,
} from "./types";
import { firstParam, parseBaseSort, parseTiresFilters, splitList, tiresFiltersPayload, type SearchParamsLike, type TiresBaseSort } from "./url";

/**
 * Exportações XLSX da Gestão de Pneus — montagem pura, sem acesso ao banco.
 *
 * 1. `tiresExportRequest` traduz a URL (filtros globais + parâmetros da aba)
 *    no MESMO recorte que o carregador da aba usa (`loaders.ts`).
 * 2. `collectTiresExport` percorre TODAS as páginas das rotinas (500 por
 *    chamada, o teto delas) por meio de uma fonte injetada — a rota usa as
 *    consultas reais; a verificação usa os dados fixos da prévia.
 * 3. `buildTiresWorkbook` monta a aba Resumo (logo, data dos dados, filtros
 *    em texto, indicadores da rotina com a explicação) e a aba de dados com
 *    uma linha por item.
 *
 * Nada é calculado aqui além de rótulos e formatação: prazos, classes, PSI,
 * severidade e contadores chegam prontos do banco. Sem custo/CPK. Nº Fogo,
 * frota, placa, série e DOT vão sempre como TEXTO.
 */

export const TIRES_EXPORT_KINDS = ["base", "medicao", "calibragem", "cronograma", "vistorias", "historico", "qualidade"] as const;
export type TiresExportKind = (typeof TIRES_EXPORT_KINDS)[number];
export const isTiresExportKind = (v: string): v is TiresExportKind => (TIRES_EXPORT_KINDS as readonly string[]).includes(v);

/** O teto das rotinas paginadas (`least(..., 500)`). */
export const TIRES_EXPORT_PAGE = 500;

type Filters = Record<string, Json>;

// ---------------------------------------------------------------------------
// 1. Pedido: URL → recorte das rotinas (o mesmo do carregador de cada aba)
// ---------------------------------------------------------------------------
const BASE_VIEWS: TiresBaseView[] = ["frota", "fogo", "fora"];
const WINDOWS: ScheduleWindow[] = ["todos", "vencidos", "hoje", "7d", "15d", "proximos", "sem_medicao", "sem_calibragem"];
/** Sub-visão (`?sub=`) → indicador do banco — o mesmo mapa do carregador de Medição e Calibragem. */
const MEASUREMENT_SUB: Record<string, TireIndicatorKey> = { sulco: "tread", prazo: "measurement" };
const CALIBRATION_SUB: Record<string, TireIndicatorKey> = { conformidade: "calibration_conformity", prazo: "calibration", psi: "psi" };
/** Situação pedida na lista de pendências (código do banco, sem espaços) — o mesmo filtro do carregador. */
const statusParam = (v: string | undefined) => (v && /^[a-z_]{3,40}$/.test(v) ? v : null);
const isUuid = (v: string | undefined): v is string => !!v && /^[0-9a-f-]{36}$/i.test(v);
const isIsoDate = (v: string | undefined): v is string => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v);

interface ReqBase {
  filters: TiresFilters;
}
export type TiresExportRequest =
  | (ReqBase & { kind: "base"; payload: Filters; view: TiresBaseView; sort: TiresBaseSort | null; dir: "asc" | "desc" })
  | (ReqBase & { kind: "medicao" | "calibragem"; payload: Filters; sub: string; indicator: TireIndicatorKey; status: string | null })
  | (ReqBase & { kind: "cronograma"; payload: Filters; window: ScheduleWindow })
  | (ReqBase & { kind: "vistorias"; payload: Filters; fase: string | undefined })
  | (ReqBase & { kind: "historico"; payload: Filters; sub: "eventos" | "auditoria" })
  | (ReqBase & { kind: "qualidade"; payload: Filters; audit: AuditExportFilters });

/** Filtros próprios da Central de Auditoria (os mesmos da tela). */
export interface AuditExportFilters {
  category: string | null;
  rule: string | null;
  severity: string | null;
  status: "aberta" | "resolvida" | "todas";
}

function pick(payload: Filters, keys: string[]): Filters {
  const out: Filters = {};
  for (const k of keys) if (payload[k] !== undefined) out[k] = payload[k];
  return out;
}

function putDates(params: SearchParamsLike, f: Filters) {
  const from = firstParam(params, "de");
  const to = firstParam(params, "ate");
  if (isIsoDate(from)) f.date_from = from;
  if (isIsoDate(to)) f.date_to = to;
}

/**
 * Os filtros globais e os parâmetros próprios da aba, na forma que cada rotina
 * recebe — espelho de `loadTiresTab`. `perms` decide a sub-aba do histórico
 * como a tela decide.
 */
export function tiresExportRequest(
  kind: TiresExportKind,
  params: SearchParamsLike,
  perms: { history: boolean; audit: boolean },
): TiresExportRequest {
  const filters = parseTiresFilters(params);
  const payload = tiresFiltersPayload(filters);
  switch (kind) {
    case "base": {
      const v = firstParam(params, "visao") as TiresBaseView | undefined;
      const { sort, dir } = parseBaseSort(params);
      return { kind, filters, payload, view: v && BASE_VIEWS.includes(v) ? v : "frota", sort, dir };
    }
    case "medicao":
    case "calibragem": {
      const raw = firstParam(params, "sub");
      const map = kind === "medicao" ? MEASUREMENT_SUB : CALIBRATION_SUB;
      const sub = raw && map[raw] ? raw : kind === "medicao" ? "sulco" : "conformidade";
      return { kind, filters, payload, sub, indicator: map[sub], status: statusParam(firstParam(params, "pendencia")) };
    }
    case "cronograma": {
      const w = firstParam(params, "janela") as ScheduleWindow | undefined;
      return { kind, filters, payload, window: w && WINDOWS.includes(w) ? w : "todos" };
    }
    case "vistorias": {
      const f = pick(payload, ["operation_ids", "city_ids", "br_ids", "leader_ids", "vehicle_ids", "search"]);
      const raw = firstParam(params, "fase");
      const fase = splitList(raw);
      f.statuses = fase.length ? fase : ["pendente_revisao"];
      if (raw === "todas") delete f.statuses;
      const inspector = firstParam(params, "inspetor");
      if (isUuid(inspector)) f.inspector_user_id = inspector;
      const div = firstParam(params, "divergencia");
      if (div) f.divergence = div;
      putDates(params, f);
      return { kind, filters, payload: f, fase: raw };
    }
    case "historico": {
      const sub = firstParam(params, "sub") === "auditoria" && perms.audit ? "auditoria" : perms.history ? "eventos" : "auditoria";
      if (sub === "eventos") {
        const f = pick(payload, ["vehicle_ids", "search"]);
        const types = splitList(firstParam(params, "evento"));
        if (types.length) f.event_types = types;
        putDates(params, f);
        return { kind, filters, payload: f, sub };
      }
      const f = pick(payload, ["search"]);
      const action = firstParam(params, "acao");
      if (action) f.action = action;
      return { kind, filters, payload: f, sub };
    }
    case "qualidade": {
      // espelho do carregador da Central: só operação, local, liderança, frota e busca
      const st = firstParam(params, "achado");
      return {
        kind,
        filters,
        payload: pick(payload, ["operation_ids", "city_ids", "leader_ids", "vehicle_ids", "search"]),
        audit: {
          category: firstParam(params, "categoria") ?? null,
          rule: firstParam(params, "regra") ?? null,
          severity: firstParam(params, "gravidade") ?? null,
          status: st === "resolvida" || st === "todas" ? st : "aberta",
        },
      };
    }
  }
}

/** O que vai para `log_tire_export.p_filters`: o recorte exato que a rotina recebeu. */
export function tiresExportLogFilters(req: TiresExportRequest): Filters {
  const out: Filters = { ...req.payload };
  switch (req.kind) {
    case "base":
      out.view = req.view;
      if (req.sort) out.sort = req.sort;
      out.dir = req.dir;
      break;
    case "medicao":
    case "calibragem":
      out.indicator = req.indicator;
      if (req.status) out.status = req.status;
      break;
    case "cronograma":
      out.window = req.window;
      break;
    case "historico":
      out.sub = req.sub;
      break;
    case "qualidade":
      if (req.audit.category) out.category = req.audit.category;
      if (req.audit.rule) out.rule = req.audit.rule;
      if (req.audit.severity) out.severity = req.audit.severity;
      out.status = req.audit.status;
      break;
    default:
      break;
  }
  return out;
}

// ---------------------------------------------------------------------------
// 2. Leitura de todas as páginas (fonte injetada)
// ---------------------------------------------------------------------------
export interface TiresExportSource {
  base(payload: Filters, view: TiresBaseView, sort: string | null, dir: "asc" | "desc", limit: number, offset: number): Promise<TiresBase>;
  indicator(indicator: TireIndicatorKey, payload: Filters, status: string | null, limit: number, offset: number): Promise<TiresIndicator>;
  schedule(payload: Filters, window: ScheduleWindow, limit: number, offset: number): Promise<TiresSchedule>;
  auditCenter(payload: Filters, audit: AuditExportFilters, limit: number, offset: number): Promise<TiresAuditCenter>;
  inspections(filters: Filters, limit: number, offset: number): Promise<TiresInspectionsReceived>;
  events(filters: Filters, limit: number, offset: number): Promise<TiresEventsList>;
  audit(filters: Filters, limit: number, offset: number): Promise<TiresAuditList>;
}

/**
 * Percorre uma rotina paginada até o total que a primeira página informa.
 * Uma página vazia encerra o laço (a base pode ter mudado entre as chamadas);
 * nesse caso `complete` volta falso e o arquivo diz isso no Resumo.
 */
export async function readAllPages<P, R>(
  fetchPage: (limit: number, offset: number) => Promise<P>,
  rowsOf: (page: P) => R[] | null | undefined,
  totalOf: (page: P) => number | null | undefined,
  limit: number = TIRES_EXPORT_PAGE,
): Promise<{ first: P; rows: R[]; total: number; complete: boolean }> {
  const first = await fetchPage(limit, 0);
  const rows: R[] = [...(rowsOf(first) ?? [])];
  const total = totalOf(first) ?? rows.length;
  while (rows.length < total) {
    const more = rowsOf(await fetchPage(limit, rows.length)) ?? [];
    if (!more.length) break;
    rows.push(...more);
  }
  return { first, rows, total, complete: rows.length >= total };
}

/** Linha da base: o pneu e, na visão por frota, o grupo (veículo) a que pertence. */
export interface BaseItem {
  group: TireFleetGroup | null;
  tire: TireRow;
}

interface Read<P, R> {
  first: P;
  rows: R[];
  /** Total que a rotina informou (na base por frota, o total de frotas). */
  total: number;
  complete: boolean;
}
export type TiresExportData =
  | ({ kind: "base"; req: Extract<TiresExportRequest, { kind: "base" }> } & Read<TiresBase, BaseItem>)
  | ({ kind: "medicao" | "calibragem"; req: Extract<TiresExportRequest, { kind: "medicao" | "calibragem" }> } & Read<TiresIndicator, TireIndicatorPendingRow>)
  | ({ kind: "cronograma"; req: Extract<TiresExportRequest, { kind: "cronograma" }> } & Read<TiresSchedule, TireScheduleRow>)
  | ({ kind: "vistorias"; req: Extract<TiresExportRequest, { kind: "vistorias" }> } & Read<TiresInspectionsReceived, TireInspectionRow>)
  | ({ kind: "historico"; sub: "eventos"; req: Extract<TiresExportRequest, { kind: "historico" }> } & Read<TiresEventsList, TireEventRow>)
  | ({ kind: "historico"; sub: "auditoria"; req: Extract<TiresExportRequest, { kind: "historico" }> } & Read<TiresAuditList, TireAuditRow>)
  | ({ kind: "qualidade"; req: Extract<TiresExportRequest, { kind: "qualidade" }> } & Read<TiresAuditCenter, TireAuditFinding>);

/** Lê o recorte inteiro do pedido (todas as páginas, sem teto). */
export async function collectTiresExport(
  req: TiresExportRequest,
  source: TiresExportSource,
  limit: number = TIRES_EXPORT_PAGE,
): Promise<TiresExportData> {
  switch (req.kind) {
    case "base": {
      if (req.view === "frota") {
        const r = await readAllPages(
          (l, o) => source.base(req.payload, "frota", req.sort, req.dir, l, o),
          (p) => ("groups" in p ? p.groups : []),
          (p) => p.total,
          limit,
        );
        const rows = r.rows.flatMap((group) => (group.tireRows ?? []).map((tire) => ({ group, tire })));
        return { kind: "base", req, ...r, rows };
      }
      const r = await readAllPages(
        (l, o) => source.base(req.payload, req.view, req.sort, req.dir, l, o),
        (p) => ("rows" in p ? p.rows : []),
        (p) => p.total,
        limit,
      );
      return { kind: "base", req, ...r, rows: r.rows.map((tire) => ({ group: null, tire })) };
    }
    case "medicao":
    case "calibragem": {
      const r = await readAllPages(
        (l, o) => source.indicator(req.indicator, req.payload, req.status, l, o),
        (p) => p.pending,
        (p) => p.pendingTotal,
        limit,
      );
      return { kind: req.kind, req, ...r };
    }
    case "cronograma": {
      const r = await readAllPages((l, o) => source.schedule(req.payload, req.window, l, o), (p) => p.rows, (p) => p.total, limit);
      return { kind: "cronograma", req, ...r };
    }
    case "vistorias": {
      const r = await readAllPages((l, o) => source.inspections(req.payload, l, o), (p) => p.rows, (p) => p.total, limit);
      return { kind: "vistorias", req, ...r };
    }
    case "historico": {
      if (req.sub === "eventos") {
        const r = await readAllPages((l, o) => source.events(req.payload, l, o), (p) => p.rows, (p) => p.total, limit);
        return { kind: "historico", sub: "eventos", req, ...r };
      }
      const r = await readAllPages((l, o) => source.audit(req.payload, l, o), (p) => p.rows, (p) => p.total, limit);
      return { kind: "historico", sub: "auditoria", req, ...r };
    }
    case "qualidade": {
      // os achados da Central com os filtros da tela (categoria, regra, gravidade, situação), todas as páginas
      const r = await readAllPages((l, o) => source.auditCenter(req.payload, req.audit, l, o), (p) => p.rows, (p) => p.total, limit);
      return { kind: "qualidade", req, ...r };
    }
  }
}

/** Linhas da aba de dados principal (o número registrado na auditoria). */
export const tiresExportRowCount = (data: TiresExportData) => data.rows.length;

// ---------------------------------------------------------------------------
// 3. Rótulos e textos
// ---------------------------------------------------------------------------
const NUMF = { mm: "#,##0.00", psi: "#,##0.0", text: "@" } as const;
/** Início do aviso de leitura incompleta (destacado no Resumo). */
const INCOMPLETE = "Atenção: a leitura terminou antes do total";

const label = <K extends string>(map: Record<K, string>, key: string | null | undefined): string | null =>
  key == null || key === "" ? null : (map[key as K] ?? key);
const cityUf = (city: string | null | undefined, uf: string | null | undefined) => (city ? `${city}${uf ? `/${uf}` : ""}` : (uf ?? null));
const text = (v: string | number | null | undefined): string | null => (v == null || v === "" ? null : String(v));

/**
 * Carimbo do banco → data/hora do Excel. Com fuso (timestamptz), em São
 * Paulo; sem fuso (hora local do Rodopar), exatamente como veio.
 */
function stamp(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  if (/(?:[zZ]|[+-]\d{2}:?\d{2})$/.test(iso)) return excelStamp(iso);
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/);
  if (m) return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]));
  return excelDate(iso);
}

/** AAAAMMDD de hoje em São Paulo (nome do arquivo). */
export function tiresExportFileName(kind: TiresExportKind, now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `pneus-${kind}-${get("year")}${get("month")}${get("day")}.xlsx`;
}

export interface FilterItem {
  label: string;
  value: string;
}

const GLOBAL_LABEL: Record<keyof TiresFilters, string> = {
  reference: "Data dos dados",
  operation: "Operação",
  state: "UF",
  city: "Local de operação",
  br: "BR",
  leader: "Liderança",
  unit: "Filial",
  vehicleType: "Tipo de equipamento",
  vehicle: "Frota",
  status: "Situação do pneu",
  brand: "Fabricante",
  model: "Modelo",
  dimension: "Medida",
  life: "Vida",
  position: "Posição",
  tread: "Sulco",
  measurement: "Medição",
  calibration: "Calibragem",
  psi: "Pressão",
  severity: "Severidade",
  quality: "Qualidade",
  retread: "Ressolagem",
  conformity: "Conformidade geral",
  calConformity: "Conformidade de calibragem",
  missing: "Sem operação/local/liderança",
  q: "Busca",
};
const ALL_GLOBAL = Object.keys(TIRES_FILTER_PARAM) as (keyof TiresFilters)[];

/** Filtros globais que cada exportação de fato aplica (o mesmo recorte do carregador). */
function appliedGlobalKeys(req: TiresExportRequest): (keyof TiresFilters)[] {
  switch (req.kind) {
    case "base":
    case "medicao":
    case "calibragem":
      return ALL_GLOBAL;
    case "cronograma":
      // a rotina sempre lê os dados mais recentes
      return ALL_GLOBAL.filter((k) => k !== "reference");
    case "qualidade":
      // a Central avalia os dados mais recentes e aceita só estes recortes
      return ["operation", "city", "leader", "vehicle", "q"];
    case "vistorias":
      return ["operation", "city", "br", "leader", "vehicle", "q"];
    case "historico":
      return req.sub === "eventos" ? ["vehicle", "q"] : ["q"];
  }
}

const truthy = (v: string | undefined) => v === "1" || v === "true";

function globalValue(key: keyof TiresFilters, raw: string, o: TireFilterOptions | null): string | null {
  const list = splitList(raw);
  const named = <T,>(items: T[] | undefined, match: (x: T, id: string) => boolean, show: (x: T) => string) =>
    items ? list.map((id) => { const f = items.find((x) => match(x, id)); return f ? show(f) : "(não encontrado)"; }).join(", ") : `${list.length} selecionado(s)`;
  const labels = (map: Record<string, string>) => list.map((v) => map[v] ?? v).join(", ");
  switch (key) {
    case "reference":
      return formatDate(raw);
    case "operation":
      return named(o?.operations, (x, id) => x.id === id, (x) => x.name);
    case "state":
      return named(o?.states, (x, id) => String(x.id) === id, (x) => x.uf);
    case "city":
      return named(o?.cities, (x, id) => String(x.id) === id, (x) => `${x.name}/${x.uf}`);
    case "br":
      return named(o?.brs, (x, id) => x.id === id, (x) => x.code);
    case "leader":
      return named(o?.leaders, (x, id) => x.id === id, (x) => x.name);
    case "unit":
      return named(o?.units, (x, id) => x.id === id, (x) => x.name);
    case "vehicleType":
      return named(o?.vehicleTypes, (x, id) => x.id === id, (x) => x.name);
    case "vehicle":
      return named(o?.vehicles, (x, id) => x.id === id, (x) => [x.fleet, x.plate].filter(Boolean).join(" · ") || "(sem identificação)");
    case "status":
      return labels(STATUS_LABEL);
    case "dimension":
      return o ? list.map((k) => o.dimensions.find((d) => d.key === k)?.label ?? k).join(", ") : list.join(", ");
    case "life":
      return list.map((n) => `${n}ª vida`).join(", ");
    case "position":
      return list.map((c) => { const p = o?.positions.find((x) => x.code === c); return p ? `${p.code} · ${p.label}` : c; }).join(", ");
    case "tread":
      return labels(TREAD_LABEL);
    case "measurement":
    case "calibration":
      return labels(DEADLINE_LABEL);
    case "psi":
      return labels(PSI_LABEL);
    case "severity":
      return labels(SEVERITY_LABEL);
    case "quality":
      return truthy(raw) ? "Só pneus com inconsistência" : null;
    case "retread":
      return truthy(raw) ? "Só pneus com alerta de ressolagem" : null;
    default:
      return raw.trim() || null;
  }
}

const BASE_VIEW_LABEL: Record<TiresBaseView, string> = {
  frota: "Por frota (pneus em uso)",
  fogo: "Por Nº Fogo (todos os pneus)",
  fora: "Fora de uso",
};
const BASE_TITLE: Record<TiresBaseView, string> = {
  frota: "Base geral de pneus por frota",
  fogo: "Base geral de pneus por Nº Fogo",
  fora: "Base geral de pneus fora de uso",
};
const BASE_SORT_LABEL: Record<string, string> = {
  fire_number: "Nº Fogo",
  status: "Situação",
  plate: "Placa",
  fleet: "Frota",
  brand: "Marca",
  position: "Posição",
  tread: "Sulco",
  measurement: "Dias desde a medição",
  calibration: "Dias desde a calibragem",
  psi: "PSI",
  life: "Vida",
  km: "KM real",
  operation: "Operação",
};
/** Rótulo da situação de cada indicador (os códigos que `tires_indicator` devolve). */
const INDICATOR_STATUS_LABEL: Record<TireIndicatorKey, Record<string, string>> = {
  tread: TREAD_LABEL,
  measurement: DEADLINE_LABEL,
  calibration: DEADLINE_LABEL,
  psi: PSI_LABEL,
  calibration_conformity: CAL_CONF_LABEL,
  overall: { conforme: "Conforme", nao_conforme: "Não conforme" },
};
const indicatorStatus = (indicator: TireIndicatorKey, code: string | null | undefined) =>
  code ? (INDICATOR_STATUS_LABEL[indicator][code] ?? code) : null;
const DIVERGENCE_FILTER_LABEL: Record<string, string> = { com: "Com divergência", sem: "Sem divergência", persistente: "Divergência persistente" };
const FLEET_STATUS_LABEL: Record<TireFleetGroup["status"], string> = { critico: "Crítica", atencao: "Atenção", ok: "Sem pendência" };
const EVENT_SOURCE_LABEL: Record<string, string> = { rodopar_import: "Importação Rodopar", system: "Sistema" };
const AUDIT_STEP_LABEL: Record<string, string> = {
  created: "Registro",
  updated: "Alteração",
  voided: "Anulação",
  saved: "Gravação",
  confirmed: "Confirmação",
  cancelled: "Descarte",
  vehicle: "Layout por veículo",
  vehicle_type: "Layout por tipo de equipamento",
};

function period(from: Json | undefined, to: Json | undefined): string | null {
  if (!from && !to) return null;
  return `${from ? formatDate(String(from)) : "—"} a ${to ? formatDate(String(to)) : "—"}`;
}

/** Filtros próprios da aba exportada (visão, pendência, janela, situação…). */
function tabFilters(data: TiresExportData): FilterItem[] {
  const out: FilterItem[] = [];
  const push = (l: string, v: string | null | undefined) => {
    if (v) out.push({ label: l, value: v });
  };
  const req = data.req;
  switch (req.kind) {
    case "base":
      push("Visão", BASE_VIEW_LABEL[req.view]);
      push("Ordem", req.sort ? `${BASE_SORT_LABEL[req.sort] ?? req.sort} (${req.dir === "desc" ? "decrescente" : "crescente"})` : "Severidade (mais grave primeiro)");
      break;
    case "medicao":
    case "calibragem":
      push("Indicador", INDICATOR_LABEL[req.indicator]);
      push("Situação", req.status ? indicatorStatus(req.indicator, req.status) : "Todas as pendências");
      break;
    case "cronograma":
      push("Janela", SCHEDULE_WINDOW_LABEL[req.window]);
      break;
    case "vistorias": {
      const f = req.payload;
      const statuses = Array.isArray(f.statuses) ? (f.statuses as string[]) : null;
      push("Situação da vistoria", statuses ? statuses.map((s) => label(INSPECTION_STATUS_LABEL, s)).join(", ") : "Todas");
      if (typeof f.inspector_user_id === "string") {
        const inspectors = data.kind === "vistorias" ? data.first.inspectors : [];
        push("Inspetor", inspectors.find((i) => i.id === f.inspector_user_id)?.name ?? "(não encontrado)");
      }
      if (typeof f.divergence === "string") push("Divergência", DIVERGENCE_FILTER_LABEL[f.divergence] ?? f.divergence);
      push("Data da vistoria", period(f.date_from, f.date_to));
      break;
    }
    case "historico": {
      const f = req.payload;
      push("Sub-aba", req.sub === "eventos" ? "Movimentações e eventos" : "Auditoria");
      if (Array.isArray(f.event_types)) push("Evento", (f.event_types as string[]).map(eventTypeLabel).join(", "));
      if (typeof f.action === "string") push("Ação", label(AUDIT_ACTION_LABEL, f.action));
      push("Data de referência", period(f.date_from, f.date_to));
      break;
    }
    case "qualidade": {
      const a = req.audit;
      const rules = data.kind === "qualidade" ? data.first.rules : [];
      push("Situação dos achados", AUDIT_STATUS_LABEL[a.status]);
      push("Categoria", a.category ? label(AUDIT_CATEGORY_LABEL, a.category) : null);
      push("Regra", a.rule ? (rules.find((r) => r.code === a.rule)?.title ?? a.rule) : null);
      push("Gravidade", a.severity ? label(AUDIT_SEVERITY_LABEL, a.severity) : null);
      break;
    }
  }
  return out;
}

/** Filtros aplicados (aba + globais) e os globais ativos que esta exportação não usa. */
export function tiresExportFilters(data: TiresExportData, options: TireFilterOptions | null): { applied: FilterItem[]; ignored: string[] } {
  const keys = appliedGlobalKeys(data.req);
  const applied = tabFilters(data);
  const ignored: string[] = [];
  for (const key of ALL_GLOBAL) {
    const raw = data.req.filters[key];
    if (!raw) continue;
    if (!keys.includes(key)) {
      ignored.push(GLOBAL_LABEL[key]);
      continue;
    }
    const value = globalValue(key, raw, options);
    if (value) applied.push({ label: GLOBAL_LABEL[key], value });
  }
  return { applied, ignored };
}

const filterLine = (items: FilterItem[]) => (items.length ? `Filtros: ${items.map((f) => `${f.label}: ${f.value}`).join(" · ")}` : "Filtros: nenhum");

/** "Base oficial (Rodopar): dados de dd/mm/aaaa (…) · prazos calculados em dd/mm/aaaa". */
function photoLine(data: TiresExportData, options: TireFilterOptions | null): string {
  const latest = options?.referenceDates?.[0]?.referenceDate ?? null;
  const snapshot = (ref: string | null | undefined, asOf: string | null | undefined, isLatest?: boolean) => {
    if (!ref) return "Sem dados confirmados na base oficial (Rodopar)";
    const latestFlag = isLatest ?? (latest ? ref === latest : undefined);
    const tag = latestFlag === true ? " (os mais recentes)" : latestFlag === false ? " (dados anteriores — não são os mais recentes)" : "";
    return `Base oficial (Rodopar): dados de ${formatDate(ref)}${tag}${asOf ? ` · prazos calculados em ${formatDate(asOf)}` : ""}`;
  };
  switch (data.kind) {
    case "base":
      return snapshot(data.first.empty ? null : data.first.referenceDate, data.first.asOf);
    case "medicao":
    case "calibragem":
      return snapshot(data.first.empty ? null : data.first.referenceDate, data.first.asOf, data.first.isLatest);
    case "cronograma":
      return snapshot(data.first.empty ? null : data.first.referenceDate, data.first.asOf, true);
    case "qualidade": {
      const scan = data.first.lastScan;
      const ref = scan?.referenceDate ?? latest;
      const scanned = scan ? ` · última varredura em ${stampText(scan.finishedAt ?? scan.startedAt)}` : " · nenhuma varredura registrada";
      return `${ref ? `Auditoria da base oficial (Rodopar): dados de ${formatDate(ref)}` : "Auditoria da base oficial (Rodopar)"}${scanned}`;
    }
    case "vistorias":
      return latest
        ? `Base oficial (Rodopar): dados de ${formatDate(latest)} — as vistorias de campo não alteram a base oficial`
        : "Vistorias de campo — não alteram a base oficial (Rodopar)";
    case "historico":
      return latest ? `Base oficial (Rodopar): dados de ${formatDate(latest)}` : "Histórico da Gestão de Pneus";
  }
}

// ---------------------------------------------------------------------------
// 4. Aba Resumo
// ---------------------------------------------------------------------------
interface Indicator {
  label: string;
  value: number | string | null | undefined;
  fmt?: string;
  help: string;
}
interface SummaryTable {
  title: string;
  cols: XCol[];
  rows: XCell[][];
}
interface SummarySpec {
  title: string;
  indicators: Indicator[];
  tables?: SummaryTable[];
  notes: string[];
}

export interface TiresExportMeta {
  logo: Buffer | null;
  generatedBy: string;
  organizationName: string;
  generatedAt?: Date;
  options: TireFilterOptions | null;
}

const estimateHeight = (s: string, charsPerLine: number, lineHeight = 14) => Math.max(18, Math.ceil(s.length / charsPerLine) * lineHeight + 4);

function summarySheet(
  wb: ExcelJS.Workbook,
  meta: TiresExportMeta,
  head: { photo: string; generated: string; filters: { applied: FilterItem[]; ignored: string[] } },
  spec: SummarySpec,
) {
  const ws = wb.addWorksheet("Resumo", { properties: { tabColor: { argb: BRAND.accent } } });
  ws.columns = [{ width: 44 }, { width: 18 }, { width: 86 }];
  ws.views = [{ state: "frozen", ySplit: 5, showGridLines: false }];
  placeLogo(wb, ws, meta.logo, 64);
  for (let r = 1; r <= 5; r++) ws.getRow(r).height = r === 5 ? 8 : 18;
  ws.getCell("B1").value = spec.title;
  ws.getCell("B1").font = { bold: true, size: 16, color: { argb: BRAND.primary } };
  ws.getCell("B2").value = head.photo;
  ws.getCell("B2").font = { bold: true, size: 11, color: { argb: BRAND.ink } };
  ws.getCell("B3").value = head.generated;
  ws.getCell("B3").font = { size: 10, color: { argb: BRAND.muted } };
  ws.getCell("B4").value = filterLine(head.filters.applied);
  ws.getCell("B4").font = { size: 10, color: { argb: BRAND.muted } };
  for (let c = 1; c <= 3; c++) ws.getCell(5, c).border = { bottom: { style: "medium", color: { argb: BRAND.accent } } };

  let row = 7;
  // Indicadores da rotina
  sectionBand(ws, row, "Indicadores", 3);
  row += 1;
  const indEnd = writeTable(
    ws,
    row,
    [{ header: "Indicador" }, { header: "Valor" }, { header: "Como é lido" }],
    spec.indicators.map((i) => [i.label, i.value ?? "—", i.help]),
  );
  spec.indicators.forEach((ind, i) => {
    const r = row + 1 + i;
    const v = ws.getCell(r, 2);
    if (typeof ind.value === "number") v.numFmt = ind.fmt ?? NUM.int;
    v.alignment = { horizontal: "right", vertical: "top" };
    ws.getCell(r, 1).alignment = { vertical: "top", wrapText: true };
    ws.getCell(r, 3).alignment = { vertical: "top", wrapText: true };
    ws.getRow(r).height = estimateHeight(ind.help, 95);
  });
  row = indEnd + 2;

  for (const t of spec.tables ?? []) {
    sectionBand(ws, row, t.title, 3);
    row += 1;
    const end = writeTable(ws, row, t.cols, t.rows);
    if (!t.rows.length) {
      const c = ws.getCell(end + 1, 1);
      c.value = "Nada a listar.";
      c.font = { italic: true, color: { argb: BRAND.muted } };
      row = end + 3;
    } else {
      row = end + 2;
    }
  }

  // Filtros aplicados, um por linha
  sectionBand(ws, row, "Filtros aplicados", 3);
  row += 1;
  if (head.filters.applied.length) {
    const end = writeTable(ws, row, [{ header: "Filtro" }, { header: "Valor" }], head.filters.applied.map((f) => [f.label, f.value]));
    for (let r = row; r <= end; r++) {
      ws.mergeCells(r, 2, r, 3);
      if (r === row) continue;
      ws.getCell(r, 2).alignment = { wrapText: true, vertical: "top" };
      ws.getRow(r).height = estimateHeight(String(ws.getCell(r, 2).value ?? ""), 110);
    }
    row = end + 1;
  } else {
    const c = ws.getCell(row, 1);
    c.value = "Nenhum filtro: todo o escopo visível para você.";
    c.font = { italic: true, color: { argb: BRAND.muted } };
    row += 1;
  }
  if (head.filters.ignored.length) {
    ws.mergeCells(row, 1, row, 3);
    const c = ws.getCell(row, 1);
    c.value = `Filtros ativos na tela que não se aplicam a esta exportação (a rotina desta aba não os usa): ${head.filters.ignored.join(", ")}.`;
    c.font = { size: 10, color: { argb: BRAND.muted } };
    c.alignment = { wrapText: true, vertical: "top" };
    ws.getRow(row).height = estimateHeight(String(c.value), 140);
    row += 1;
  }
  row += 1;

  // Como ler
  sectionBand(ws, row, "Como ler", 3);
  row += 1;
  // o aviso de leitura incompleta (se houver) vem primeiro e em negrito
  const notes = [...spec.notes].sort((a, b) => Number(b.startsWith(INCOMPLETE)) - Number(a.startsWith(INCOMPLETE)));
  for (const note of notes) {
    ws.mergeCells(row, 1, row, 3);
    const c = ws.getCell(row, 1);
    c.value = note;
    c.font = { size: 10, bold: note.startsWith(INCOMPLETE), color: { argb: BRAND.ink } };
    c.alignment = { wrapText: true, vertical: "top" };
    ws.getRow(row).height = estimateHeight(note, 165);
    row += 1;
  }
  return ws;
}

// ---------------------------------------------------------------------------
// 5. Colunas (especificação → cabeçalho + valores)
// ---------------------------------------------------------------------------
interface Spec<T> extends XCol {
  value: (r: T) => XCell;
}
const colsOf = <T,>(specs: Spec<T>[]): XCol[] => specs.map(({ header, width, numFmt }) => ({ header, width, numFmt }));
const rowsOf = <T,>(specs: Spec<T>[], items: T[]): XCell[][] => items.map((r) => specs.map((s) => s.value(r)));

/** Colunas do pneu avaliado (`private.tire_rows`). */
const TIRE_SPECS: Spec<TireRow>[] = [
  { header: "Nº Fogo", width: 12, numFmt: NUMF.text, value: (r) => text(r.fireNumber) },
  { header: "Situação", width: 13, value: (r) => label(STATUS_LABEL, r.canonicalStatus) },
  { header: "Situação no Rodopar", width: 20, value: (r) => r.rodoparStatusLabel ?? r.rodoparStatusRaw },
  { header: "Condição no Rodopar", width: 15, value: (r) => r.rodoparCondition },
  { header: "Frota", width: 11, numFmt: NUMF.text, value: (r) => text(r.fleetNumber ?? r.fleetNumberRaw) },
  { header: "Placa", width: 11, numFmt: NUMF.text, value: (r) => text(r.licensePlate) },
  { header: "Tipo de equipamento", width: 20, value: (r) => r.vehicleTypeName },
  { header: "Posição", width: 9, numFmt: NUMF.text, value: (r) => text(r.positionCode) },
  { header: "Descrição da posição", width: 22, value: (r) => r.positionLabel },
  { header: "Operação", width: 24, value: (r) => r.operationName },
  { header: "Cidade/UF", width: 20, value: (r) => cityUf(r.cityName, r.stateUf) },
  { header: "BR", width: 9, value: (r) => r.brCode },
  { header: "Liderança", width: 22, value: (r) => r.leaderName },
  { header: "Filial", width: 18, value: (r) => r.unitName },
  { header: "Marca", width: 14, value: (r) => r.brand },
  { header: "Modelo", width: 18, value: (r) => r.model },
  { header: "Dimensão", width: 14, value: (r) => r.dimension },
  { header: "Nº de série", width: 12, numFmt: NUMF.text, value: (r) => text(r.serialNumber) },
  { header: "DOT", width: 8, numFmt: NUMF.text, value: (r) => text(r.dot) },
  { header: "Desenho", width: 10, value: (r) => r.drawing },
  { header: "Borracha", width: 10, value: (r) => r.rubber },
  { header: "Vida", width: 6, numFmt: NUM.int, value: (r) => r.life },
  { header: "Sulco 1 (mm)", width: 9, numFmt: NUMF.mm, value: (r) => r.tread1 },
  { header: "Sulco 2 (mm)", width: 9, numFmt: NUMF.mm, value: (r) => r.tread2 },
  { header: "Sulco 3 (mm)", width: 9, numFmt: NUMF.mm, value: (r) => r.tread3 },
  { header: "Sulco 4 (mm)", width: 9, numFmt: NUMF.mm, value: (r) => r.tread4 },
  { header: "Menor sulco (mm)", width: 10, numFmt: NUMF.mm, value: (r) => r.treadMin },
  { header: "Classe do sulco", width: 15, value: (r) => label(TREAD_LABEL, r.treadClass) },
  { header: "Sulco legal (mm)", width: 9, numFmt: NUMF.mm, value: (r) => r.legalTreadMm },
  { header: "Menor sulco divergente", width: 11, value: (r) => r.treadDivergence },
  { header: "Data da medição", width: 12, numFmt: NUM.date, value: (r) => excelDate(r.measurementDate) },
  { header: "Dias desde a medição", width: 10, numFmt: NUM.int, value: (r) => r.measurementDays },
  { header: "Prazo de medição", width: 14, value: (r) => label(DEADLINE_LABEL, r.measurementStatus) },
  { header: "Medição vence em", width: 12, numFmt: NUM.date, value: (r) => excelDate(r.measurementDueDate) },
  { header: "PSI", width: 7, numFmt: NUMF.psi, value: (r) => r.psi },
  { header: "PSI mínimo", width: 8, numFmt: NUMF.psi, value: (r) => r.psiMin },
  { header: "PSI ideal", width: 8, numFmt: NUMF.psi, value: (r) => r.psiIdeal },
  { header: "PSI máximo", width: 8, numFmt: NUMF.psi, value: (r) => r.psiMax },
  { header: "Pressão", width: 15, value: (r) => label(PSI_LABEL, r.psiStatus) },
  { header: "Data da calibragem", width: 12, numFmt: NUM.date, value: (r) => excelDate(r.calibrationDate) },
  { header: "Dias desde a calibragem", width: 10, numFmt: NUM.int, value: (r) => r.calibrationDays },
  { header: "Prazo de calibragem", width: 14, value: (r) => label(DEADLINE_LABEL, r.calibrationStatus) },
  { header: "Calibragem vence em", width: 12, numFmt: NUM.date, value: (r) => excelDate(r.calibrationDueDate) },
  { header: "KM rodado", width: 10, numFmt: NUM.int, value: (r) => r.kmRodado },
  { header: "KM real", width: 10, numFmt: NUM.int, value: (r) => r.kmReal },
  { header: "Alerta de ressolagem", width: 11, value: (r) => r.retreadAlert },
  { header: "Severidade", width: 13, value: (r) => label(SEVERITY_LABEL, r.severity) },
  { header: "Inconsistências", width: 40, value: (r) => (r.qualityFlags?.length ? r.qualityFlags.map(issueLabel).join("; ") : null) },
  { header: "Atualizado no Rodopar", width: 16, numFmt: NUM.stamp, value: (r) => stamp(r.rodoparUpdatedAt) },
  { header: "Contexto da frota", width: 22, value: (r) => label(ENRICHMENT_LABEL, r.enrichmentStatus) },
];

const FLEET_SPECS: Spec<BaseItem>[] = [
  { header: "Frota", width: 11, numFmt: NUMF.text, value: (i) => text(i.group?.fleetNumber ?? i.tire.fleetNumber) },
  { header: "Placa", width: 11, numFmt: NUMF.text, value: (i) => text(i.group?.licensePlate ?? i.tire.licensePlate) },
  { header: "Posição", width: 9, numFmt: NUMF.text, value: (i) => text(i.tire.positionCode) },
  { header: "Nº Fogo", width: 12, numFmt: NUMF.text, value: (i) => text(i.tire.fireNumber) },
  { header: "Situação da frota", width: 14, value: (i) => (i.group ? label(FLEET_STATUS_LABEL, i.group.status) : null) },
  { header: "Pneus em uso na frota", width: 10, numFmt: NUM.int, value: (i) => i.group?.tires ?? null },
  {
    header: "Layout do veículo",
    width: 32,
    value: (i) => (i.group?.layout ? (i.group.layout.layoutName ?? label(LAYOUT_SOURCE_LABEL, i.group.layout.layoutSource)) : null),
  },
];
/** Base por frota: identificação + colunas da frota + o pneu (sem repetir frota/placa/posição/fogo). */
const BASE_FLEET_SPECS: Spec<BaseItem>[] = [
  ...FLEET_SPECS,
  ...TIRE_SPECS.filter((s) => !["Nº Fogo", "Frota", "Placa", "Posição"].includes(s.header)).map((s) => ({ ...s, value: (i: BaseItem) => s.value(i.tire) })),
];
const BASE_ROW_SPECS: Spec<BaseItem>[] = TIRE_SPECS.map((s) => ({ ...s, value: (i: BaseItem) => s.value(i.tire) }));

/** Colunas das pendências de um indicador (`tires_indicator`): identificação, situação e os campos do critério. */
function indicatorSpecs(indicator: TireIndicatorKey): Spec<TireIndicatorPendingRow>[] {
  type S = Spec<TireIndicatorPendingRow>;
  const id: S[] = [
    { header: "Nº Fogo", width: 12, numFmt: NUMF.text, value: (r) => text(r.fireNumber) },
    { header: "Frota", width: 11, numFmt: NUMF.text, value: (r) => text(r.fleetNumber) },
    { header: "Placa", width: 11, numFmt: NUMF.text, value: (r) => text(r.licensePlate) },
    { header: "Posição", width: 9, numFmt: NUMF.text, value: (r) => text(r.positionCode) },
    { header: "Descrição da posição", width: 22, value: (r) => r.positionLabel },
    { header: "Operação", width: 24, value: (r) => r.operationName },
    { header: "Cidade/UF", width: 20, value: (r) => cityUf(r.cityName, r.stateUf) },
    { header: "Liderança", width: 22, value: (r) => r.leaderName },
    { header: "Tipo de equipamento", width: 20, value: (r) => r.vehicleTypeName },
    { header: "Medida", width: 14, value: (r) => r.dimension },
    { header: "Situação no indicador", width: 24, value: (r) => indicatorStatus(indicator, r.status) },
    { header: "Criticidade", width: 13, value: (r) => label(CRITICALITY_LABEL, r.criticality) },
    { header: "Motivos", width: 44, value: (r) => (r.reasons?.length ? r.reasons.map(reasonLabel).join("; ") : null) },
  ];
  const tread: S[] = [
    { header: "Sulco 1 (mm)", width: 9, numFmt: NUMF.mm, value: (r) => r.tread1 },
    { header: "Sulco 2 (mm)", width: 9, numFmt: NUMF.mm, value: (r) => r.tread2 },
    { header: "Sulco 3 (mm)", width: 9, numFmt: NUMF.mm, value: (r) => r.tread3 },
    { header: "Sulco 4 (mm)", width: 9, numFmt: NUMF.mm, value: (r) => r.tread4 },
    { header: "Menor sulco (mm)", width: 10, numFmt: NUMF.mm, value: (r) => r.treadMin },
    { header: "Classe do sulco", width: 15, value: (r) => label(TREAD_LABEL, r.treadClass) },
    { header: "Sulco legal (mm)", width: 9, numFmt: NUMF.mm, value: (r) => r.legalTreadMm },
  ];
  const measurement: S[] = [
    { header: "Data da medição", width: 12, numFmt: NUM.date, value: (r) => excelDate(r.measurementDate) },
    { header: "Dias desde a medição", width: 10, numFmt: NUM.int, value: (r) => r.measurementDays },
    { header: "Prazo de medição", width: 15, value: (r) => label(DEADLINE_LABEL, r.measurementStatus) },
    { header: "Medição vence em", width: 12, numFmt: NUM.date, value: (r) => excelDate(r.measurementDueDate) },
    { header: "Atraso da medição (dias)", width: 10, numFmt: NUM.int, value: (r) => r.measurementLate },
  ];
  const calibration: S[] = [
    { header: "Data da calibragem", width: 12, numFmt: NUM.date, value: (r) => excelDate(r.calibrationDate) },
    { header: "Dias desde a calibragem", width: 10, numFmt: NUM.int, value: (r) => r.calibrationDays },
    { header: "Prazo de calibragem", width: 15, value: (r) => label(DEADLINE_LABEL, r.calibrationStatus) },
    { header: "Calibragem vence em", width: 12, numFmt: NUM.date, value: (r) => excelDate(r.calibrationDueDate) },
    { header: "Atraso da calibragem (dias)", width: 10, numFmt: NUM.int, value: (r) => r.calibrationLate },
  ];
  const psi: S[] = [
    { header: "PSI", width: 7, numFmt: NUMF.psi, value: (r) => r.psi },
    { header: "PSI mínimo", width: 8, numFmt: NUMF.psi, value: (r) => r.psiMin },
    { header: "PSI ideal", width: 8, numFmt: NUMF.psi, value: (r) => r.psiIdeal },
    { header: "PSI máximo", width: 8, numFmt: NUMF.psi, value: (r) => r.psiMax },
    { header: "Pressão", width: 15, value: (r) => label(PSI_LABEL, r.psiStatus) },
    { header: "Desvio (PSI)", width: 9, numFmt: NUMF.psi, value: (r) => r.psiDev },
    { header: "Desvio (% sobre o ideal)", width: 10, numFmt: NUM.pct, value: (r) => r.psiDevPct },
  ];
  switch (indicator) {
    case "tread":
      return [...id, ...tread];
    case "measurement":
      return [...id, ...measurement, tread[4], tread[5]];
    case "calibration":
      return [...id, ...calibration, ...psi.slice(0, 5)];
    case "psi":
      return [...id, ...psi, calibration[0]];
    case "calibration_conformity":
      return [...id, ...calibration, ...psi];
    default:
      return [...id, ...tread, ...measurement, ...calibration, ...psi];
  }
}

const SCHEDULE_SPECS: Spec<TireScheduleRow>[] = [
  { header: "Frota", width: 11, numFmt: NUMF.text, value: (r) => text(r.fleetNumber) },
  { header: "Placa", width: 11, numFmt: NUMF.text, value: (r) => text(r.licensePlate) },
  { header: "Tipo de equipamento", width: 20, value: (r) => r.vehicleTypeName },
  { header: "Operação", width: 24, value: (r) => r.operationName },
  { header: "Cidade/UF", width: 20, value: (r) => cityUf(r.cityName, r.stateUf) },
  { header: "BR", width: 9, value: (r) => r.brCode },
  { header: "Liderança", width: 22, value: (r) => r.leaderName },
  { header: "Pneus em uso", width: 9, numFmt: NUM.int, value: (r) => r.tires },
  { header: "Medição mais antiga", width: 12, numFmt: NUM.date, value: (r) => excelDate(r.lastMeasurement) },
  { header: "Próxima medição até", width: 12, numFmt: NUM.date, value: (r) => excelDate(r.nextMeasurement) },
  { header: "Prazo de medição", width: 15, value: (r) => label(DEADLINE_LABEL, r.measurementStatus) },
  { header: "Calibragem mais antiga", width: 12, numFmt: NUM.date, value: (r) => excelDate(r.lastCalibration) },
  { header: "Próxima calibragem até", width: 12, numFmt: NUM.date, value: (r) => excelDate(r.nextCalibration) },
  { header: "Prazo de calibragem", width: 15, value: (r) => label(DEADLINE_LABEL, r.calibrationStatus) },
  { header: "Próximo vencimento", width: 12, numFmt: NUM.date, value: (r) => excelDate(r.nextDue) },
];

type ScheduleTire = { fleet: TireScheduleRow; tire: TireScheduleRow["tireRows"][number] };
const SCHEDULE_TIRE_SPECS: Spec<ScheduleTire>[] = [
  { header: "Frota", width: 11, numFmt: NUMF.text, value: (r) => text(r.fleet.fleetNumber) },
  { header: "Placa", width: 11, numFmt: NUMF.text, value: (r) => text(r.fleet.licensePlate) },
  { header: "Posição", width: 9, numFmt: NUMF.text, value: (r) => text(r.tire.positionCode) },
  { header: "Descrição da posição", width: 22, value: (r) => r.tire.positionLabel },
  { header: "Nº Fogo", width: 12, numFmt: NUMF.text, value: (r) => text(r.tire.fireNumber) },
  { header: "Data da medição", width: 12, numFmt: NUM.date, value: (r) => excelDate(r.tire.measurementDate) },
  { header: "Prazo de medição", width: 15, value: (r) => label(DEADLINE_LABEL, r.tire.measurementStatus) },
  { header: "Data da calibragem", width: 12, numFmt: NUM.date, value: (r) => excelDate(r.tire.calibrationDate) },
  { header: "Prazo de calibragem", width: 15, value: (r) => label(DEADLINE_LABEL, r.tire.calibrationStatus) },
];

const INSPECTION_SPECS: Spec<TireInspectionRow>[] = [
  { header: "Protocolo", width: 20, numFmt: NUMF.text, value: (r) => text(r.protocol) },
  { header: "Situação", width: 34, value: (r) => label(INSPECTION_STATUS_LABEL, r.status) },
  { header: "Placa", width: 11, numFmt: NUMF.text, value: (r) => text(r.licensePlate) },
  { header: "Frota", width: 11, numFmt: NUMF.text, value: (r) => text(r.fleetCode) },
  { header: "Tipo de equipamento", width: 20, value: (r) => r.vehicleTypeName },
  { header: "Operação", width: 24, value: (r) => r.operationName },
  { header: "Cidade/UF", width: 20, value: (r) => cityUf(r.cityName, r.stateUf) },
  { header: "BR", width: 9, value: (r) => r.brCode },
  { header: "Liderança", width: 22, value: (r) => r.leaderName },
  { header: "Inspetor", width: 32, value: (r) => r.inspectorName },
  { header: "Data da vistoria", width: 12, numFmt: NUM.date, value: (r) => excelDate(r.inspectionDate) },
  { header: "Enviada em", width: 16, numFmt: NUM.stamp, value: (r) => stamp(r.submittedAt) },
  { header: "Posições previstas", width: 10, numFmt: NUM.int, value: (r) => r.positionsExpected },
  { header: "Posições medidas", width: 10, numFmt: NUM.int, value: (r) => r.positionsMeasured },
  { header: "Posições com divergência", width: 11, numFmt: NUM.int, value: (r) => r.positionsDivergent },
  { header: "Divergência persistente", width: 11, value: (r) => r.persistentDivergence },
  { header: "Dias aguardando", width: 10, numFmt: NUM.int, value: (r) => r.waitingDays },
  { header: "Revisada por", width: 24, value: (r) => r.reviewedByName },
  { header: "Revisada em", width: 16, numFmt: NUM.stamp, value: (r) => stamp(r.reviewedAt) },
  { header: "Aprovada em", width: 16, numFmt: NUM.stamp, value: (r) => stamp(r.approvedAt) },
  { header: "Chegou ao Rodopar em", width: 16, numFmt: NUM.stamp, value: (r) => stamp(r.syncedAt) },
  { header: "Reenvio de vistoria retornada", width: 12, value: (r) => Boolean(r.parentInspectionId) },
];

/** Campos de `previous`/`current` dos eventos, em texto. */
const EVENT_FIELD: Record<string, { label: string; fmt?: (v: unknown) => string }> = {
  status: { label: "Situação", fmt: (v) => label(STATUS_LABEL, String(v)) ?? "—" },
  fleet_number: { label: "Frota" },
  license_plate: { label: "Placa" },
  position_code: { label: "Posição" },
  life: { label: "Vida", fmt: (v) => `${v}ª` },
  tread_min: { label: "Menor sulco", fmt: (v) => `${fmtDec(v)} mm` },
  psi: { label: "PSI", fmt: (v) => fmtDec(v) },
  measurement_date: { label: "Medição", fmt: (v) => formatDate(String(v)) },
  calibration_date: { label: "Calibragem", fmt: (v) => formatDate(String(v)) },
  brand: { label: "Marca" },
  model: { label: "Modelo" },
  dimension: { label: "Dimensão" },
  dot: { label: "DOT" },
  drawing: { label: "Desenho" },
  rubber: { label: "Borracha" },
  serial_number: { label: "Nº de série" },
};
const nf2 = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 });
const fmtDec = (v: unknown) => (typeof v === "number" ? nf2.format(v) : String(v));
const fieldText = (key: string, v: unknown) => (v == null || v === "" ? "—" : (EVENT_FIELD[key]?.fmt?.(v) ?? String(v)));

/**
 * O que mudou no evento: "Menor sulco: 4,69 mm → 4,09 mm · PSI: 70 → 72".
 * Sem estado anterior (primeira carga dos dados), o retrato principal do pneu.
 */
function eventChanges(e: TireEventRow): string | null {
  const prev = e.previous && typeof e.previous === "object" ? (e.previous as Record<string, unknown>) : null;
  const cur = e.current && typeof e.current === "object" ? (e.current as Record<string, unknown>) : null;
  if (!cur && !prev) return null;
  // camelize converteu as chaves; voltamos ao formato do banco para casar com o dicionário
  const snake = (o: Record<string, unknown> | null) =>
    o ? Object.fromEntries(Object.entries(o).map(([k, v]) => [k.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`), v])) : null;
  const p = snake(prev);
  const c = snake(cur);
  const keys = Object.keys(EVENT_FIELD);
  if (!p || !Object.keys(p).length) {
    const parts = ["status", "fleet_number", "position_code", "life", "tread_min", "psi"]
      .filter((k) => c?.[k] != null && c[k] !== "")
      .map((k) => `${EVENT_FIELD[k].label}: ${fieldText(k, c![k])}`);
    return parts.length ? parts.join(" · ") : null;
  }
  const changed = keys.filter((k) => JSON.stringify(p[k] ?? null) !== JSON.stringify(c?.[k] ?? null));
  if (!changed.length) return "Sem alteração nos campos acompanhados";
  return changed.map((k) => `${EVENT_FIELD[k].label}: ${fieldText(k, p[k])} → ${fieldText(k, c?.[k])}`).join(" · ");
}

const EVENT_SPECS: Spec<TireEventRow>[] = [
  { header: "Data de referência", width: 12, numFmt: NUM.date, value: (r) => excelDate(r.referenceDate) },
  { header: "Registrado em", width: 16, numFmt: NUM.stamp, value: (r) => stamp(r.occurredAt) },
  { header: "Evento", width: 26, value: (r) => eventTypeLabel(r.eventType) },
  { header: "Nº Fogo", width: 12, numFmt: NUMF.text, value: (r) => text(r.fireNumber) },
  { header: "Frota", width: 11, numFmt: NUMF.text, value: (r) => text(r.fleetNumber) },
  { header: "Placa", width: 11, numFmt: NUMF.text, value: (r) => text(r.licensePlate) },
  { header: "Posição", width: 9, numFmt: NUMF.text, value: (r) => text(r.positionCode) },
  { header: "Frota anterior", width: 11, numFmt: NUMF.text, value: (r) => text(r.previousFleetNumber) },
  { header: "Placa anterior", width: 11, numFmt: NUMF.text, value: (r) => text(r.previousLicensePlate) },
  { header: "Posição anterior", width: 9, numFmt: NUMF.text, value: (r) => text(r.previousPositionCode) },
  { header: "Alterações", width: 70, value: (r) => eventChanges(r) },
  { header: "Origem", width: 20, value: (r) => label(EVENT_SOURCE_LABEL, r.source) },
];

function auditAction(action: string): { area: string; step: string | null } {
  const [area, ...rest] = action.split(".");
  const step = rest.join(".");
  const areaLabel = AUDIT_ACTION_LABEL[area] ?? area;
  if (!step) return { area: areaLabel, step: null };
  if (area === "inspection") return { area: areaLabel, step: label(INSPECTION_STATUS_LABEL, step) };
  if (area === "export") return { area: areaLabel, step: (TIRES_TAB_LABEL as Record<string, string>)[step] ?? step };
  return { area: areaLabel, step: AUDIT_STEP_LABEL[step] ?? step };
}

const AUDIT_SPECS: Spec<TireAuditRow>[] = [
  { header: "Quando", width: 16, numFmt: NUM.stamp, value: (r) => stamp(r.createdAt) },
  { header: "Área", width: 20, value: (r) => auditAction(r.action).area },
  { header: "Ação", width: 30, value: (r) => auditAction(r.action).step },
  { header: "Resumo", width: 80, value: (r) => r.summary },
  {
    header: "Motivo",
    width: 40,
    value: (r) => {
      const reason = r.currentValues && typeof r.currentValues === "object" ? (r.currentValues as Record<string, unknown>).reason : null;
      return typeof reason === "string" && reason.trim() ? reason : null;
    },
  },
  { header: "Responsável", width: 30, value: (r) => r.actorName },
];

/** Situação pedida na Central de Auditoria (filtro `achado`). */
const AUDIT_STATUS_LABEL: Record<AuditExportFilters["status"], string> = {
  aberta: "Abertas",
  resolvida: "Resolvidas",
  todas: "Todas (abertas e resolvidas)",
};
const AUDIT_SEVERITY_ORDER: AuditSeverity[] = ["critica", "alta", "media", "baixa"];

/** Achados da Central de Auditoria: uma linha por achado, com regra, onde, valores e histórico. */
const AUDIT_FINDING_SPECS: Spec<TireAuditFinding>[] = [
  { header: "Gravidade", width: 10, value: (r) => label(AUDIT_SEVERITY_LABEL, r.severity) },
  { header: "Regra", width: 34, value: (r) => r.ruleTitle },
  { header: "Código da regra", width: 22, numFmt: NUMF.text, value: (r) => text(r.ruleCode) },
  { header: "Categoria", width: 16, value: (r) => label(AUDIT_CATEGORY_LABEL, r.category) },
  { header: "Situação", width: 11, value: (r) => (r.status === "resolvida" ? "Resolvida" : "Aberta") },
  { header: "Nº Fogo", width: 12, numFmt: NUMF.text, value: (r) => text(r.fireNumber) },
  { header: "Frota", width: 11, numFmt: NUMF.text, value: (r) => text(r.fleetNumber) },
  { header: "Placa", width: 11, numFmt: NUMF.text, value: (r) => text(r.licensePlate) },
  { header: "Posição", width: 9, numFmt: NUMF.text, value: (r) => text(r.positionCode) },
  { header: "Operação", width: 24, value: (r) => r.operationName },
  { header: "Local de operação", width: 22, value: (r) => r.cityLabel },
  { header: "Liderança", width: 22, value: (r) => r.leaderName },
  { header: "Campo", width: 18, value: (r) => r.field },
  { header: "Valor encontrado", width: 20, numFmt: NUMF.text, value: (r) => text(r.foundValue) },
  { header: "Valor esperado", width: 22, value: (r) => r.expectedValue },
  { header: "Detalhe", width: 50, value: (r) => (r.detail ? modernTerms(r.detail) : null) },
  { header: "Primeira detecção (dados de)", width: 13, numFmt: NUM.date, value: (r) => excelDate(r.firstReferenceDate) },
  { header: "Última detecção (dados de)", width: 13, numFmt: NUM.date, value: (r) => excelDate(r.lastReferenceDate) },
  { header: "Detectado pela 1ª vez em", width: 16, numFmt: NUM.stamp, value: (r) => stamp(r.firstSeenAt) },
  { header: "Detectado pela última vez em", width: 16, numFmt: NUM.stamp, value: (r) => stamp(r.lastSeenAt) },
  { header: "Ocorrências", width: 10, numFmt: NUM.int, value: (r) => r.occurrences },
  { header: "Reaberturas", width: 10, numFmt: NUM.int, value: (r) => r.reopenedCount },
  { header: "Resolvido em", width: 16, numFmt: NUM.stamp, value: (r) => stamp(r.resolvedAt) },
];

// ---------------------------------------------------------------------------
// 6. Montagem por tipo
// ---------------------------------------------------------------------------
const NOTE_PHOTO =
  "A base é a base oficial (Rodopar) — a planilha Rodopar 10 confirmada pela sincronização ou pelo envio manual. Vistorias de campo não alteram esta base: só novos dados do Rodopar mudam os números.";
const NOTE_EMPTY = "Células vazias nas abas de dados significam valor não registrado (nunca zero por omissão). No Resumo, — indica valor indisponível.";
const NOTE_PSI = "\"Sem parâmetro\" de PSI significa que não há regra de pressão para o tipo/dimensão/posição: nunca conta como pressão adequada.";
const NOTE_SCOPE = "O escopo segue as suas permissões (organização, operação e veículos visíveis); os filtros do navegador não ampliam esse escopo.";

const pct = NUM.pct;
const int = NUM.int;

function deadlineNote(okDays: number | null | undefined, warningDays: number | null | undefined, what: string): string | null {
  if (okDays == null || warningDays == null) return null;
  return `Prazo de ${what} vigente: em dia até ${okDays} dias desde o último registro; próximo do vencimento até ${warningDays} dias; vencido acima de ${warningDays} dias; sem registro quando a data não existe no Rodopar.`;
}

function incompleteNote(data: TiresExportData): string | null {
  if (data.complete) return null;
  return `${INCOMPLETE} que a rotina informou — a base mudou durante a exportação. Gere o arquivo de novo para um retrato completo.`;
}

interface Built {
  spec: SummarySpec;
  sheets: (wb: ExcelJS.Workbook, context: string[]) => void;
}

function buildBase(data: Extract<TiresExportData, { kind: "base" }>): Built {
  const view = data.req.view;
  const first = data.first;
  const rows = data.rows;
  const indicators: Indicator[] = [];
  const tables: SummaryTable[] = [];
  if (view === "frota" && !first.empty && "summary" in first && first.view === "frota") {
    const s = first.summary;
    indicators.push(
      { label: "Frotas no recorte", value: s.fleets, help: "Veículos/frotas com pneus em uso nos dados, dentro dos filtros." },
      { label: "Frotas críticas", value: s.critical, help: "Pelo menos um pneu com sulco crítico ou abaixo do legal, ou com medição vencida." },
      { label: "Frotas em atenção", value: s.attention, help: "Sulco em atenção, PSI fora da faixa, calibragem vencida ou medição/calibragem sem registro (sem item crítico)." },
      { label: "Frotas sem pendência", value: s.ok, help: "Nenhum dos critérios acima." },
      { label: "Pneus em uso nas frotas", value: s.tires, help: "Uma linha por pneu na aba Pneus." },
    );
  } else if (!first.empty && "summary" in first && first.view !== "frota") {
    const s = first.summary;
    indicators.push(
      { label: "Pneus no recorte", value: s.total, help: view === "fora" ? "Pneus fora de uso (estoque, ressolagem, descarte, baixa…) nos dados." : "Todos os pneus dos dados, dentro dos filtros." },
      { label: "Em uso", value: s.inUse, help: "Pneus com situação Em uso." },
      { label: "Medição vencida", value: s.measurementOverdue, help: "Pneus em uso com a última medição além do prazo." },
      { label: "Medição próxima do vencimento", value: s.measurementDueSoon, help: "Pneus em uso dentro da janela de aviso." },
      { label: "Sem data de medição", value: s.measurementMissing, help: "Pneus sem data de medição no Rodopar." },
      { label: "PSI fora da faixa", value: s.psiOut, help: "Pneus em uso abaixo do mínimo ou acima do máximo da regra aplicável." },
      { label: "Em uso sem veículo", value: s.withoutVehicle, help: "Em uso no Rodopar, mas sem frota resolvida no HFM." },
      { label: "Menor sulco divergente", value: s.treadDivergence, help: "Menor sulco informado difere do menor dos sulcos 1–4 além da tolerância." },
      { label: "KM real negativo", value: s.kmRealNegative, help: "Inconsistência do relatório Rodopar." },
      { label: "Alerta de ressolagem", value: s.retreadAlerts, help: "Pelo critério de ressolagem vigente nos parâmetros." },
    );
    tables.push({
      title: "Pneus por situação",
      cols: [{ header: "Situação" }, { header: "Pneus", numFmt: int }],
      rows: (first.statusCounts ?? []).map((c) => [label(STATUS_LABEL, c.key), c.count]),
    });
  }
  const notes = [
    NOTE_PHOTO,
    view === "frota"
      ? "Visão por frota: só pneus em uso, uma linha por pneu com as colunas da frota (situação da frota, layout). A situação da frota é a do pior pneu."
      : "Uma linha por pneu, na ordem da tela.",
    "Linhas destacadas: pneus com severidade Crítica (sulco crítico/abaixo do legal, medição vencida e demais critérios da rotina).",
    NOTE_PSI,
    NOTE_EMPTY,
    NOTE_SCOPE,
    incompleteNote(data),
  ].filter((n): n is string => Boolean(n));
  const specs = view === "frota" ? BASE_FLEET_SPECS : BASE_ROW_SPECS;
  return {
    spec: { title: BASE_TITLE[view], indicators, tables, notes },
    sheets: (wb, context) =>
      dataSheet(wb, "Pneus", BASE_TITLE[view], context, colsOf(specs), rowsOf(specs, rows), {
        freezeCols: view === "frota" ? 4 : 1,
        highlight: (i) => rows[i]?.tire.severity === "critica",
        note: "Linhas destacadas: severidade Crítica. Nº Fogo, frota, placa, série e DOT em texto, exatamente como no Rodopar.",
      }),
  };
}

const NOTE_SOURCE =
  "A base são os dados oficiais do Rodopar, sincronizados do SharePoint. Vistorias de campo não alteram esta base: só um novo dado do Rodopar muda os números.";
const DIM_ORDER: TireIndicatorDim[] = ["operation", "city", "leader", "vehicleType", "dimension"];

/** Definição de cada indicador, com os números da regra vigente (nada fixo aqui). */
function indicatorDefinition(data: Extract<TiresExportData, { kind: "medicao" | "calibragem" }>): string | null {
  const first = data.first;
  if (first.empty || !first.parameters) return null;
  const p = first.parameters;
  switch (data.req.indicator) {
    case "tread":
      return `Sulco OK = menor sulco acima de ${p.treadCriticalMm} mm (limite crítico) e acima do sulco legal da regra do pneu; até ${p.treadAttentionMm} mm fica em atenção, ainda conforme. Sem medição não conta como OK.`;
    case "measurement":
      return `${deadlineNote(p.measurementOkDays, p.measurementWarningDays, "medição")} Prazo OK = em dia ou próximo do vencimento.`;
    case "calibration":
      return `${deadlineNote(p.calibrationOkDays, p.calibrationWarningDays, "calibragem")} Prazo OK = em dia ou próximo do vencimento. Prazo em dia não garante pressão certa: veja Calibragem: prazo + PSI.`;
    case "psi":
      return "PSI OK = leitura da última calibragem dentro da faixa mín.–máx. da regra mais específica (tipo de equipamento × medida × posição × eixo). Sem regra = sem parâmetro: não avaliado, e nunca conta como adequado.";
    case "calibration_conformity":
      return `Conforme = prazo de calibragem OK (até ${p.calibrationWarningDays} dias desde a última calibragem) E PSI dentro da faixa da regra. Calibragem feita no prazo com pressão inadequada NÃO é saudável: conta como não conforme.`;
    default:
      return null;
  }
}

function buildIndicator(data: Extract<TiresExportData, { kind: "medicao" | "calibragem" }>): Built {
  const indicator = data.req.indicator;
  const name = INDICATOR_LABEL[indicator];
  const first = data.first;
  const k = first.empty ? null : first.kpis;
  const d = first.empty ? null : first.details;
  const rows = data.rows;
  const late = indicator === "measurement" || indicator === "calibration";
  const psiDev = indicator === "psi" || indicator === "calibration_conformity";
  const specific: Indicator[] = !d
    ? []
    : indicator === "tread"
      ? [
          { label: "Sulco médio (mm)", value: d.avg, fmt: NUMF.mm, help: "Média do menor sulco dos pneus em uso." },
          { label: "Mediana (mm)", value: d.median, fmt: NUMF.mm, help: "Metade dos pneus abaixo deste valor." },
          { label: "Menor sulco (mm)", value: d.min, fmt: NUMF.mm, help: "O pneu mais gasto do recorte." },
          { label: "Divergências de MM", value: d.divergent, help: "Menor MM informado difere do medido." },
        ]
      : late
        ? [
            { label: "Vencem em 7 dias", value: d.due7d, help: "Vencimento entre hoje e os próximos 7 dias." },
            { label: "Vencem em 15 dias", value: d.due15d, help: "Vencimento entre hoje e os próximos 15 dias." },
            { label: "Maior atraso (dias)", value: d.maxLate, help: "Maior número de dias além do prazo, entre os vencidos." },
            { label: "Atraso médio (dias)", value: d.avgLate, fmt: NUM.km, help: "Média dos dias além do prazo, entre os vencidos." },
            ...(indicator === "calibration" && d.onTimeBadPsi != null
              ? [{ label: "No prazo, mas PSI inadequado", value: d.onTimeBadPsi, help: "Calibrados no prazo com pressão fora da faixa, sem parâmetro ou sem leitura: não é saudável." }]
              : []),
          ]
        : indicator === "psi"
          ? [
              { label: "Desvio médio (%)", value: d.avgDevPct, fmt: pct, help: "Quanto o PSI passou do limite da faixa, em % sobre o ideal (média dos fora da faixa)." },
              { label: "Combinações sem regra", value: d.ruleGaps, help: "Tipo × medida × posição com pneus sem regra de PSI (sem parâmetro)." },
            ]
          : indicator === "calibration_conformity"
            ? [
                { label: "No prazo, mas PSI inadequado", value: d.onTimeBadPsi, help: "Calibrados no prazo com pressão inadequada: NÃO é saudável, conta como não conforme." },
                { label: "PSI OK, prazo vencido", value: d.lateGoodPsi, help: "Pressão certa, mas calibragem fora do prazo." },
                { label: "Prazo e PSI fora", value: d.lateBadPsi, help: "Calibragem fora do prazo e pressão inadequada." },
              ]
            : [];
  const distribution: XCell[][] = Object.entries(first.distribution ?? {}).map(([code, n]) => {
    return [indicatorStatus(indicator, issueCode(code)), n];
  });
  const indicators: Indicator[] = k
    ? [
        { label: "Conformidade", value: k.pct, fmt: pct, help: "Pneus conformes ÷ pneus em uso no recorte, pela regra centralizada no banco." },
        { label: "Pneus em uso (base)", value: k.base, help: "Pneus em uso nos dados, dentro dos filtros." },
        { label: "Conformes", value: k.ok, help: `Pneus dentro da regra de ${name}.` },
        { label: "Não conformes", value: k.nok, help: "Pneus fora da regra; são as pendências." },
        { label: "Críticos", value: k.critical, help: "Pela regra do banco: os casos mais graves do indicador." },
        { label: "Frotas afetadas", value: k.fleetsAffected, help: "Frotas com ao menos um pneu não conforme." },
        ...specific,
        { label: "Pendências exportadas", value: first.pendingTotal, help: "Pneus não conformes na situação escolhida (linhas da aba Pendências), do pior para o melhor." },
      ]
    : [{ label: "Dados", value: null, help: "Nenhum dado oficial do Rodopar confirmado para o recorte." }];
  const notes = [
    NOTE_SOURCE,
    indicatorDefinition(data),
    "A aba Pendências traz só os pneus não conformes deste indicador, na ordem da tela (do pior para o melhor). Linhas destacadas: criticidade Crítica.",
    indicator === "psi" || indicator === "calibration_conformity" || indicator === "calibration" ? NOTE_PSI : null,
    NOTE_EMPTY,
    NOTE_SCOPE,
    incompleteNote(data),
  ].filter((n): n is string => Boolean(n));
  const specs = indicatorSpecs(indicator);
  const breakdownRows: XCell[][] = [];
  for (const dim of DIM_ORDER) {
    for (const b of first.breakdowns?.[dim] ?? []) {
      breakdownRows.push([
        INDICATOR_DIM_LABEL[dim], b.label, b.total, b.ok, b.nok, b.pct, b.critical,
        ...(late ? [b.avgLate, b.maxLate] : []),
        ...(psiDev ? [b.avgPsiDevPct] : []),
        ...(indicator === "tread" ? [b.avgTread] : []),
      ]);
    }
  }
  return {
    spec: {
      title: `${data.kind === "medicao" ? "Aderência MM" : "Aderência calibragem"} — ${name}`,
      indicators,
      tables: [{ title: "Distribuição por situação", cols: [{ header: "Situação" }, { header: "Pneus", numFmt: int }], rows: distribution }],
      notes,
    },
    sheets: (wb, context) => {
      dataSheet(wb, "Pendências", `Pendências — ${name}`, context, colsOf(specs), rowsOf(specs, rows), {
        freezeCols: 1,
        highlight: (i) => rows[i]?.criticality === "critico",
        note: "Uma linha por pneu não conforme. Linhas destacadas: criticidade Crítica. Nº Fogo, frota e placa em texto, como no Rodopar.",
      });
      dataSheet(
        wb,
        "Onde estão os desvios",
        `${name} por recorte`,
        context,
        [
          { header: "Recorte", width: 20 },
          { header: "Nome", width: 30 },
          { header: "Pneus", width: 9, numFmt: int },
          { header: "Conformes", width: 10, numFmt: int },
          { header: "Não conformes", width: 10, numFmt: int },
          { header: "Conformidade (%)", width: 12, numFmt: pct },
          { header: "Críticos", width: 9, numFmt: int },
          ...(late
            ? [
                { header: "Atraso médio (dias)", width: 11, numFmt: NUM.km },
                { header: "Atraso máximo (dias)", width: 11, numFmt: int },
              ]
            : []),
          ...(psiDev ? [{ header: "Desvio médio PSI (%)", width: 11, numFmt: pct }] : []),
          ...(indicator === "tread" ? [{ header: "MM médio", width: 10, numFmt: NUMF.mm }] : []),
        ],
        breakdownRows,
        { note: "Quebras calculadas pela rotina sobre todos os pneus em uso do recorte (não só os pendentes), do pior percentual para o melhor." },
      );
      if (indicator === "psi" && d?.gaps?.length) {
        dataSheet(
          wb,
          "Sem parâmetro PSI",
          "Combinações sem regra de PSI",
          context,
          [
            { header: "Tipo de equipamento", width: 24 },
            { header: "Medida", width: 16 },
            { header: "Posição", width: 10, numFmt: NUMF.text },
            { header: "Pneus", width: 9, numFmt: int },
          ],
          d.gaps.map((g) => [g.vehicleTypeName ?? "Sem tipo", g.dimension, text(g.positionCode), g.tires]),
          { note: "Cadastre a regra em Parâmetros › Regras de PSI. Sem regra, a pressão aparece como Sem parâmetro — nunca como adequada." },
        );
      }
    },
  };
}

function buildSchedule(data: Extract<TiresExportData, { kind: "cronograma" }>): Built {
  const first = data.first;
  const rows = data.rows;
  const k = first.empty ? null : first.kpis;
  const a = first.empty ? null : first.agenda;
  const indicators: Indicator[] =
    k && a
      ? [
          { label: "Frotas no cronograma", value: k.units, help: "Frotas com pneus em uso nos dados mais recentes, dentro dos filtros." },
          { label: "Medição vencida", value: k.measurementOverdue, help: "Frotas cujo pneu mais atrasado já passou do prazo de medição." },
          { label: "Medição próxima do vencimento", value: k.measurementDueSoon, help: "Frotas na janela de aviso de medição." },
          { label: "Sem medição", value: k.measurementMissing, help: "Frotas com algum pneu em uso sem data de medição." },
          { label: "Calibragem vencida", value: k.calibrationOverdue, help: "Frotas cujo pneu mais atrasado já passou do prazo de calibragem." },
          { label: "Calibragem próxima do vencimento", value: k.calibrationDueSoon, help: "Frotas na janela de aviso de calibragem." },
          { label: "Sem calibragem", value: k.calibrationMissing, help: "Frotas com algum pneu em uso sem data de calibragem." },
          { label: "Agenda: vencidos", value: a.vencidos, help: "Frotas com medição ou calibragem vencida." },
          { label: "Agenda: vence hoje", value: a.hoje, help: "Frotas com medição ou calibragem vencendo hoje." },
          { label: "Agenda: próximos 7 dias", value: a.proximos7, help: "Frotas com vencimento entre hoje e 7 dias." },
          { label: "Agenda: próximos 15 dias", value: a.proximos15, help: "Frotas com vencimento entre hoje e 15 dias." },
          { label: "Frotas exportadas", value: first.total, help: "Frotas na janela escolhida (linhas da aba Cronograma)." },
        ]
      : [{ label: "Dados", value: null, help: "Nenhum dado confirmado na base oficial (Rodopar)." }];
  const p = first.empty ? null : first.parameters;
  const notes = [
    NOTE_PHOTO,
    "O pior pneu manda: a data de medição/calibragem da frota é a mais antiga entre os pneus em uso, e o prazo vale para a frota inteira.",
    deadlineNote(p?.measurementOkDays, p?.measurementWarningDays, "medição"),
    deadlineNote(p?.calibrationOkDays, p?.calibrationWarningDays, "calibragem"),
    "Linhas destacadas: medição ou calibragem vencida. A aba Pneus por frota detalha cada pneu das frotas exportadas.",
    NOTE_EMPTY,
    NOTE_SCOPE,
    incompleteNote(data),
  ].filter((n): n is string => Boolean(n));
  const tires: ScheduleTire[] = rows.flatMap((fleet) => (fleet.tireRows ?? []).map((tire) => ({ fleet, tire })));
  return {
    spec: { title: "Cronograma de medição e calibragem", indicators, notes },
    sheets: (wb, context) => {
      dataSheet(wb, "Cronograma", "Cronograma por frota", context, colsOf(SCHEDULE_SPECS), rowsOf(SCHEDULE_SPECS, rows), {
        freezeCols: 2,
        highlight: (i) => rows[i]?.measurementStatus === "vencido" || rows[i]?.calibrationStatus === "vencido",
        note: "Uma linha por frota. Linhas destacadas: medição ou calibragem vencida.",
      });
      dataSheet(wb, "Pneus por frota", "Pneus das frotas do cronograma", context, colsOf(SCHEDULE_TIRE_SPECS), rowsOf(SCHEDULE_TIRE_SPECS, tires), {
        freezeCols: 3,
        highlight: (i) => tires[i]?.tire.measurementStatus === "vencido" || tires[i]?.tire.calibrationStatus === "vencido",
        note: "Uma linha por pneu em uso. Linhas destacadas: medição ou calibragem vencida.",
      });
    },
  };
}

function buildInspections(data: Extract<TiresExportData, { kind: "vistorias" }>): Built {
  const k = data.first.kpis;
  const rows = data.rows;
  const indicators: Indicator[] = k
    ? [
        { label: "Pendentes de revisão", value: k.pendenteRevisao, help: "Vistorias enviadas aguardando a decisão do revisor (todo o escopo, não só o filtro)." },
        { label: "Pendentes com divergência", value: k.pendingWithDivergence, help: "Pendentes de revisão com pelo menos uma posição divergente." },
        { label: "Revisão acima do SLA", value: k.reviewOverSla, help: `Pendentes de revisão há mais de ${k.reviewSlaDays} dia(s).` },
        { label: "Pendentes de lançamento no Rodopar", value: k.pendenteRodopar, help: "Aprovadas, aguardando o lançamento no Rodopar." },
        { label: "Lançamento acima do SLA", value: k.rodoparOverSla, help: `Aprovadas há mais de ${k.rodoparSyncSlaDays} dia(s) sem chegar ao Rodopar.` },
        { label: "Divergência persistente", value: k.persistent, help: "Aprovadas cuja leitura não bateu com os dados seguintes do Rodopar." },
        { label: "Sincronizadas com o Rodopar", value: k.sincronizadoRodopar, help: "A base oficial (Rodopar) já reflete a leitura de campo." },
        { label: "Retornadas por divergência", value: k.retornarDivergencia, help: "Devolvidas ao inspetor para nova medição." },
        { label: "Substituídas", value: k.substituida, help: "Trocadas por uma nova medição (reenvio)." },
        { label: "Tempo médio de revisão (h)", value: k.avgReviewHours, fmt: "#,##0.0", help: "Média de horas entre envio e revisão nos últimos 90 dias." },
        { label: "Vistorias exportadas", value: data.first.total, help: "Vistorias na situação e nos filtros escolhidos (linhas da aba Vistorias)." },
      ]
    : [];
  const notes = [
    "Vistoria de campo ≠ base oficial (Rodopar): a vistoria nunca altera a base de pneus. Depois de aprovada, a leitura precisa ser lançada no Rodopar e só chega à base na próxima sincronização.",
    "Os indicadores de situação contam todo o escopo visível; a aba Vistorias segue os filtros (padrão: só pendentes de revisão).",
    "Linhas destacadas: vistorias com posição divergente, divergência persistente ou retornadas por divergência.",
    NOTE_EMPTY,
    NOTE_SCOPE,
    incompleteNote(data),
  ].filter((n): n is string => Boolean(n));
  return {
    spec: { title: "Vistorias de pneus recebidas", indicators, notes },
    sheets: (wb, context) =>
      dataSheet(wb, "Vistorias", "Vistorias de pneus recebidas", context, colsOf(INSPECTION_SPECS), rowsOf(INSPECTION_SPECS, rows), {
        freezeCols: 1,
        highlight: (i) => {
          const r = rows[i];
          return !!r && (r.positionsDivergent > 0 || r.persistentDivergence || r.status === "retornar_divergencia");
        },
        note: "Uma linha por vistoria. Linhas destacadas: com divergência. A vistoria não altera a base oficial (Rodopar).",
      }),
  };
}

function buildHistory(data: Extract<TiresExportData, { kind: "historico" }>): Built {
  if (data.sub === "eventos") {
    const rows = data.rows;
    const counts = Object.entries(data.first.counts ?? {}).sort((a, b) => b[1] - a[1]);
    const indicators: Indicator[] = [
      { label: "Eventos no recorte", value: data.first.total, help: "Movimentações e mudanças detectadas entre os dados oficiais de datas diferentes, nos filtros (linhas da aba Eventos)." },
    ];
    const notes = [
      "Os eventos nascem da comparação entre os dados oficiais do Rodopar de cada data confirmada (troca de posição, mudança de vida, medição, calibragem, retirada, ausência…).",
      "Linhas destacadas: descarte/baixa e ausência no relatório.",
      NOTE_EMPTY,
      NOTE_SCOPE,
      incompleteNote(data),
    ].filter((n): n is string => Boolean(n));
    return {
      spec: {
        title: "Histórico de movimentações e eventos",
        indicators,
        tables: [{ title: "Eventos por tipo", cols: [{ header: "Evento" }, { header: "Quantidade", numFmt: int }], rows: counts.map(([t, n]) => [eventTypeLabel(t), n]) }],
        notes,
      },
      sheets: (wb, context) =>
        dataSheet(wb, "Eventos", "Movimentações e eventos dos pneus", context, colsOf(EVENT_SPECS), rowsOf(EVENT_SPECS, rows), {
          freezeCols: 4,
          highlight: (i) => EVENT_TONE[rows[i]?.eventType ?? ""] === "danger",
          note: "Uma linha por evento, do mais recente para o mais antigo. Linhas destacadas: descarte/baixa e ausência no relatório.",
        }),
    };
  }
  const rows = data.rows;
  const byArea = new Map<string, number>();
  for (const r of rows) {
    const area = auditAction(r.action).area;
    byArea.set(area, (byArea.get(area) ?? 0) + 1);
  }
  return {
    spec: {
      title: "Auditoria da Gestão de Pneus",
      indicators: [{ label: "Registros no recorte", value: data.first.total, help: "Decisões, importações, parâmetros, consertos e exportações (linhas da aba Auditoria)." }],
      tables: [
        {
          title: "Registros exportados por área",
          cols: [{ header: "Área" }, { header: "Registros", numFmt: int }],
          rows: [...byArea.entries()].sort((a, b) => b[1] - a[1]).map(([area, n]) => [area, n]),
        },
      ],
      notes: [
        "Trilha append-only do módulo: quem fez o quê e quando, com a pessoa autenticada como autora. Esta exportação também fica registrada aqui.",
        NOTE_SCOPE,
        incompleteNote(data),
      ].filter((n): n is string => Boolean(n)),
    },
    sheets: (wb, context) =>
      dataSheet(wb, "Auditoria", "Auditoria da Gestão de Pneus", context, colsOf(AUDIT_SPECS), rowsOf(AUDIT_SPECS, rows), {
        freezeCols: 1,
        note: "Uma linha por registro, do mais recente para o mais antigo.",
      }),
  };
}

function buildAudit(data: Extract<TiresExportData, { kind: "qualidade" }>): Built {
  const first = data.first;
  const rows = data.rows;
  const k = first.kpis;
  const a = data.req.audit;
  const scan = first.lastScan;
  const indicators: Indicator[] = [
    { label: "Inconsistências abertas", value: k.open, help: "Achados abertos com os filtros globais aplicados (operação, local, liderança, frota e busca)." },
    { label: "Registros afetados", value: k.records, help: "Pneus, frotas ou itens distintos com pelo menos um achado aberto." },
    { label: "Pneus afetados", value: k.tiresAffected, help: "Pneus distintos com pelo menos um achado aberto." },
    { label: "Frotas afetadas", value: k.vehiclesAffected, help: "Frotas distintas com pelo menos um achado aberto." },
    { label: "% da base com inconsistência", value: k.pctBase, fmt: pct, help: `Pneus afetados ÷ ${fmtDec(first.totalTires)} pneus nos dados atuais da base oficial (Rodopar).` },
    { label: "Críticas", value: k.critical, help: "Achados abertos de gravidade crítica (bloqueiam ou distorcem os indicadores)." },
    { label: "Altas", value: k.high, help: "Achados abertos de gravidade alta." },
    { label: "Novas em 7 dias", value: k.new7d, help: "Achados abertos detectados pela primeira vez nos últimos 7 dias." },
    { label: "Resolvidas em 30 dias", value: k.resolved30d, help: "Achados que a varredura deu como resolvidos nos últimos 30 dias (corrigidos na origem)." },
    { label: "Reabertas", value: k.reopened, help: "Achados abertos que já tinham sido resolvidos e voltaram." },
    {
      label: "Achados exportados",
      value: data.total,
      help: `Linhas da aba Achados: situação ${AUDIT_STATUS_LABEL[a.status].toLowerCase()}${a.category || a.rule || a.severity ? ", com a categoria/regra/gravidade escolhidas" : ""}.`,
    },
  ];
  const notes = [
    "A Central de Auditoria aplica as regras do banco à base oficial (Rodopar) a cada confirmação dos dados, na agenda diária e sob demanda. A auditoria não corrige nada: a correção é feita na origem (planilha/Rodopar, Cadastro de Frotas ou Parâmetros) e a próxima varredura resolve o achado.",
    scan
      ? `Última varredura: ${stampText(scan.finishedAt ?? scan.startedAt)}${scan.referenceDate ? ` sobre os dados de ${formatDate(scan.referenceDate)}` : ""} — ${fmtDec(scan.opened)} novos, ${fmtDec(scan.resolved)} resolvidos, ${fmtDec(scan.openTotal)} abertos ao final.`
      : "Nenhuma varredura registrada ainda.",
    "Os indicadores contam os achados abertos com os filtros globais; categoria, regra, gravidade e situação filtram só a aba Achados.",
    "Datas de detecção \"(dados de)\" são as datas dos dados em que a regra apontou o problema; os carimbos \"detectado em\" são os momentos das varreduras.",
    "Linhas destacadas: gravidade crítica ou alta.",
    NOTE_EMPTY,
    NOTE_SCOPE,
    incompleteNote(data),
  ].filter((n): n is string => Boolean(n));
  const byCategory = (Object.keys(AUDIT_CATEGORY_LABEL) as AuditCategory[]).map((c) => [AUDIT_CATEGORY_LABEL[c], k.byCategory?.[c] ?? 0] as XCell[]);
  const bySeverity = AUDIT_SEVERITY_ORDER.map((sv) => [AUDIT_SEVERITY_LABEL[sv], k.bySeverity?.[sv] ?? 0] as XCell[]);
  return {
    spec: {
      title: "Auditoria dos dados de pneus",
      indicators,
      tables: [
        { title: "Achados abertos por categoria", cols: [{ header: "Categoria" }, { header: "Achados abertos", numFmt: int }], rows: byCategory },
        { title: "Achados abertos por gravidade", cols: [{ header: "Gravidade" }, { header: "Achados abertos", numFmt: int }], rows: bySeverity },
      ],
      notes,
    },
    sheets: (wb, context) => {
      dataSheet(wb, "Achados", "Achados da auditoria dos dados", context, colsOf(AUDIT_FINDING_SPECS), rowsOf(AUDIT_FINDING_SPECS, rows), {
        freezeCols: 2,
        highlight: (i) => rows[i]?.severity === "critica" || rows[i]?.severity === "alta",
        note: "Uma linha por achado, do mais grave para o mais leve. Linhas destacadas: gravidade crítica ou alta. Nº Fogo, frota e placa em texto, exatamente como no Rodopar.",
      });
      dataSheet(
        wb,
        "Regras",
        "Regras da auditoria",
        context,
        [
          { header: "Regra", width: 34 },
          { header: "Código", width: 22, numFmt: NUMF.text },
          { header: "Categoria", width: 16 },
          { header: "Gravidade", width: 10 },
          { header: "Campo", width: 18 },
          { header: "Valor esperado", width: 26 },
          { header: "Descrição", width: 70 },
          { header: "Achados abertos", width: 10, numFmt: int },
        ],
        first.rules.map((r) => [
          r.title,
          r.code,
          label(AUDIT_CATEGORY_LABEL, r.category),
          label(AUDIT_SEVERITY_LABEL, r.severity),
          r.field,
          r.expected,
          r.description,
          r.open,
        ]),
        { note: "Catálogo das regras ativas (definidas no banco). Achados abertos com os filtros globais." },
      );
    },
  };
}

/** Planilha completa: Resumo + aba(s) de dados. */
export function buildTiresWorkbook(data: TiresExportData, meta: TiresExportMeta): ExcelJS.Workbook {
  let built: Built;
  switch (data.kind) {
    case "base":
      built = buildBase(data);
      break;
    case "medicao":
    case "calibragem":
      built = buildIndicator(data);
      break;
    case "cronograma":
      built = buildSchedule(data);
      break;
    case "vistorias":
      built = buildInspections(data);
      break;
    case "historico":
      built = buildHistory(data);
      break;
    case "qualidade":
      built = buildAudit(data);
      break;
  }

  const filters = tiresExportFilters(data, meta.options);
  const photo = photoLine(data, meta.options);
  const generated = `Gerado em ${stampText(meta.generatedAt ?? new Date())} por ${meta.generatedBy} · ${meta.organizationName}`;
  const wb = newWorkbook();
  wb.title = built.spec.title;
  summarySheet(wb, meta, { photo, generated, filters }, built.spec);
  built.sheets(wb, [photo, filterLine(filters.applied), generated]);
  return wb;
}
