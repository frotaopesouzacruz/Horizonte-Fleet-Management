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
  BATCH_STATUS_LABEL,
  BREAKDOWN_LABEL,
  DEADLINE_LABEL,
  ENRICHMENT_LABEL,
  ERROR_ISSUES,
  EVENT_TONE,
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
  issueLabel,
  type ScheduleWindow,
  type TireAuditRow,
  type TireBreakdownDim,
  type TireEventRow,
  type TireFilterOptions,
  type TireFleetGroup,
  type TireInspectionRow,
  type TirePendingRow,
  type TireQualityRow,
  type TireRow,
  type TireScheduleRow,
  type TiresAdherence,
  type TiresAuditList,
  type TiresBase,
  type TiresBaseView,
  type TiresEventsList,
  type TiresFilters,
  type TiresInspectionsReceived,
  type TiresQuality,
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
 * 3. `buildTiresWorkbook` monta a aba Resumo (logo, fotografia, filtros em
 *    texto, indicadores da rotina com a explicação) e a aba de dados com uma
 *    linha por item.
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
const PENDING = ["all", "vencido", "proximo", "sem_registro", "pressao", "sem_parametro"];
const isUuid = (v: string | undefined): v is string => !!v && /^[0-9a-f-]{36}$/i.test(v);
const isIsoDate = (v: string | undefined): v is string => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v);

interface ReqBase {
  filters: TiresFilters;
}
export type TiresExportRequest =
  | (ReqBase & { kind: "base"; payload: Filters; view: TiresBaseView; sort: TiresBaseSort | null; dir: "asc" | "desc" })
  | (ReqBase & { kind: "medicao" | "calibragem"; payload: Filters; pending: string })
  | (ReqBase & { kind: "cronograma"; payload: Filters; window: ScheduleWindow })
  | (ReqBase & { kind: "vistorias"; payload: Filters; fase: string | undefined })
  | (ReqBase & { kind: "historico"; payload: Filters; sub: "eventos" | "auditoria" })
  | (ReqBase & { kind: "qualidade"; payload: Filters; issue: string | null });

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
      const p = firstParam(params, "pendencia");
      return { kind, filters, payload, pending: p && PENDING.includes(p) ? p : "all" };
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
    case "qualidade":
      return { kind, filters, payload, issue: firstParam(params, "problema") ?? null };
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
      out.pending = req.pending;
      break;
    case "cronograma":
      out.window = req.window;
      break;
    case "historico":
      out.sub = req.sub;
      break;
    case "qualidade":
      if (req.issue) out.issue = req.issue;
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
  adherence(kind: "measurement" | "calibration", payload: Filters, pending: string, limit: number, offset: number): Promise<TiresAdherence>;
  schedule(payload: Filters, window: ScheduleWindow, limit: number, offset: number): Promise<TiresSchedule>;
  quality(payload: Filters, issue: string | null, limit: number, offset: number): Promise<TiresQuality>;
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
  | ({ kind: "medicao" | "calibragem"; req: Extract<TiresExportRequest, { kind: "medicao" | "calibragem" }> } & Read<TiresAdherence, TirePendingRow>)
  | ({ kind: "cronograma"; req: Extract<TiresExportRequest, { kind: "cronograma" }> } & Read<TiresSchedule, TireScheduleRow>)
  | ({ kind: "vistorias"; req: Extract<TiresExportRequest, { kind: "vistorias" }> } & Read<TiresInspectionsReceived, TireInspectionRow>)
  | ({ kind: "historico"; sub: "eventos"; req: Extract<TiresExportRequest, { kind: "historico" }> } & Read<TiresEventsList, TireEventRow>)
  | ({ kind: "historico"; sub: "auditoria"; req: Extract<TiresExportRequest, { kind: "historico" }> } & Read<TiresAuditList, TireAuditRow>)
  | ({ kind: "qualidade"; req: Extract<TiresExportRequest, { kind: "qualidade" }> } & Read<TiresQuality, TireQualityRow>);

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
      const kind = req.kind === "medicao" ? "measurement" : "calibration";
      const r = await readAllPages(
        (l, o) => source.adherence(kind, req.payload, req.pending, l, o),
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
      // Com um problema escolhido, só ele (como na aba); sem escolha, todos os
      // problemas que a rotina listou, um a um — a lista completa.
      const readIssue = (code: string) =>
        readAllPages((l, o) => source.quality(req.payload, code, l, o), (p) => p.rows, (p) => p.issueTotal, limit);
      if (req.issue) {
        const r = await readIssue(req.issue);
        return { kind: "qualidade", req, ...r };
      }
      // sem problema escolhido a rotina não devolve linhas: a 1ª chamada só traz a lista de problemas
      const first = await source.quality(req.payload, null, 1, 0);
      const rows: TireQualityRow[] = [];
      let total = 0;
      let complete = true;
      for (const code of (first.issues ?? []).map((i) => i.code)) {
        const r = await readIssue(code);
        rows.push(...r.rows);
        total += r.total;
        complete &&= r.complete;
      }
      return { kind: "qualidade", req, first, rows, total, complete };
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
    case "qualidade":
      // a rotina sempre lê a fotografia mais recente
      return ALL_GLOBAL.filter((k) => k !== "reference");
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
const PENDING_LABEL: Record<string, string> = {
  all: "Todas as pendências",
  vencido: "Vencidos",
  proximo: "Próximos do vencimento",
  sem_registro: "Sem registro",
  pressao: "Pressão fora da faixa",
  sem_parametro: "Sem parâmetro de PSI",
};
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
      push("Pendência", PENDING_LABEL[req.pending] ?? req.pending);
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
    case "qualidade":
      push("Problema", req.issue ? issueLabel(req.issue) : "Todos os problemas");
      break;
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

/** "Fotografia oficial Rodopar de dd/mm/aaaa (…) · prazos calculados em dd/mm/aaaa". */
function photoLine(data: TiresExportData, options: TireFilterOptions | null): string {
  const latest = options?.referenceDates?.[0]?.referenceDate ?? null;
  const snapshot = (ref: string | null | undefined, asOf: string | null | undefined, isLatest?: boolean) => {
    if (!ref) return "Sem fotografia oficial Rodopar confirmada";
    const latestFlag = isLatest ?? (latest ? ref === latest : undefined);
    const tag = latestFlag === true ? " (a mais recente)" : latestFlag === false ? " (fotografia anterior — não é a mais recente)" : "";
    return `Fotografia oficial Rodopar de ${formatDate(ref)}${tag}${asOf ? ` · prazos calculados em ${formatDate(asOf)}` : ""}`;
  };
  switch (data.kind) {
    case "base":
      return snapshot(data.first.empty ? null : data.first.referenceDate, data.first.asOf);
    case "medicao":
    case "calibragem":
      return snapshot(data.first.empty ? null : data.first.referenceDate, data.first.asOf, data.first.isLatest);
    case "cronograma":
      return snapshot(data.first.empty ? null : data.first.referenceDate, data.first.asOf, true);
    case "qualidade":
      return snapshot(data.first.empty ? null : data.first.referenceDate, data.first.asOf, true);
    case "vistorias":
      return latest
        ? `Fotografia oficial mais recente: ${formatDate(latest)} — as vistorias de campo não alteram a fotografia oficial`
        : "Vistorias de campo — não alteram a fotografia oficial";
    case "historico":
      return latest ? `Fotografia oficial mais recente: ${formatDate(latest)}` : "Histórico da Gestão de Pneus";
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

function pendingSpecs(kind: "medicao" | "calibragem"): Spec<TirePendingRow>[] {
  const id: Spec<TirePendingRow>[] = [
    { header: "Nº Fogo", width: 12, numFmt: NUMF.text, value: (r) => text(r.fireNumber) },
    { header: "Frota", width: 11, numFmt: NUMF.text, value: (r) => text(r.fleetNumber) },
    { header: "Placa", width: 11, numFmt: NUMF.text, value: (r) => text(r.licensePlate) },
    { header: "Posição", width: 9, numFmt: NUMF.text, value: (r) => text(r.positionCode) },
    { header: "Descrição da posição", width: 22, value: (r) => r.positionLabel },
    { header: "Operação", width: 24, value: (r) => r.operationName },
    { header: "Cidade/UF", width: 20, value: (r) => cityUf(r.cityName, r.stateUf) },
    { header: "BR", width: 9, value: (r) => r.brCode },
    { header: "Liderança", width: 22, value: (r) => r.leaderName },
    { header: "Filial", width: 18, value: (r) => r.unitName },
  ];
  const what = kind === "medicao" ? "medição" : "calibragem";
  const deadline: Spec<TirePendingRow>[] = [
    { header: `Última ${what}`, width: 12, numFmt: NUM.date, value: (r) => excelDate(r.lastDate) },
    { header: `Dias desde a ${what}`, width: 10, numFmt: NUM.int, value: (r) => r.days },
    { header: `Prazo de ${what}`, width: 15, value: (r) => label(DEADLINE_LABEL, r.status) },
    { header: "Vence em", width: 12, numFmt: NUM.date, value: (r) => excelDate(r.dueDate) },
  ];
  const tread: Spec<TirePendingRow>[] = [
    { header: "Sulco 1 (mm)", width: 9, numFmt: NUMF.mm, value: (r) => r.tread1 },
    { header: "Sulco 2 (mm)", width: 9, numFmt: NUMF.mm, value: (r) => r.tread2 },
    { header: "Sulco 3 (mm)", width: 9, numFmt: NUMF.mm, value: (r) => r.tread3 },
    { header: "Sulco 4 (mm)", width: 9, numFmt: NUMF.mm, value: (r) => r.tread4 },
    { header: "Menor sulco (mm)", width: 10, numFmt: NUMF.mm, value: (r) => r.treadMin },
    { header: "Classe do sulco", width: 15, value: (r) => label(TREAD_LABEL, r.treadClass) },
  ];
  const psi: Spec<TirePendingRow>[] = [
    { header: "PSI", width: 7, numFmt: NUMF.psi, value: (r) => r.psi },
    { header: "PSI mínimo", width: 8, numFmt: NUMF.psi, value: (r) => r.psiMin },
    { header: "PSI ideal", width: 8, numFmt: NUMF.psi, value: (r) => r.psiIdeal },
    { header: "PSI máximo", width: 8, numFmt: NUMF.psi, value: (r) => r.psiMax },
    { header: "Pressão", width: 15, value: (r) => label(PSI_LABEL, r.psiStatus) },
  ];
  return kind === "medicao" ? [...id, ...deadline, ...tread] : [...id, ...deadline, ...psi, tread[4], tread[5]];
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
 * Sem estado anterior (primeira fotografia), o retrato principal do pneu.
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

function qualityDetail(r: TireQualityRow): string | null {
  if (!r.detail) return null;
  if (r.code === "ausente_ultima_importacao") return `Ausente desde ${formatDate(r.detail)}`;
  if (r.code === "sem_parametro_psi") return `Dimensão: ${r.detail}`;
  if (r.code === "posicao_fora_layout") return `Posições do layout: ${r.detail}`;
  return r.detail;
}
const QUALITY_SPECS: Spec<TireQualityRow>[] = [
  { header: "Problema", width: 40, value: (r) => issueLabel(r.code) },
  { header: "Bloqueia importação", width: 11, value: (r) => ERROR_ISSUES.has(r.code) },
  { header: "Nº Fogo", width: 12, numFmt: NUMF.text, value: (r) => text(r.fireNumber) },
  { header: "Frota", width: 11, numFmt: NUMF.text, value: (r) => text(r.fleetNumber) },
  { header: "Placa", width: 11, numFmt: NUMF.text, value: (r) => text(r.licensePlate) },
  { header: "Posição", width: 9, numFmt: NUMF.text, value: (r) => text(r.positionCode) },
  { header: "Detalhe", width: 50, value: (r) => qualityDetail(r) },
];

// ---------------------------------------------------------------------------
// 6. Montagem por tipo
// ---------------------------------------------------------------------------
const NOTE_PHOTO =
  "A base é a fotografia oficial do Rodopar 10 confirmada na importação. Vistorias de campo não alteram esta base: só uma nova fotografia do Rodopar muda os números.";
const NOTE_EMPTY = "Células vazias nas abas de dados significam valor não registrado (nunca zero por omissão). No Resumo, — indica valor indisponível.";
const NOTE_PSI = "\"Sem parâmetro\" de PSI significa que não há regra de pressão para o tipo/dimensão/posição: nunca conta como pressão adequada.";
const NOTE_SCOPE = "O escopo segue as suas permissões (organização, operação e veículos visíveis); os filtros do navegador não ampliam esse escopo.";

const pct = NUM.pct;
const int = NUM.int;

const BREAKDOWN_EMPTY: Record<TireBreakdownDim, string> = {
  operation: "Sem operação",
  state: "Sem UF",
  city: "Sem local",
  br: "Sem BR",
  unit: "Sem filial",
  leader: "Sem liderança",
  vehicleType: "Sem tipo de equipamento",
};

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
      { label: "Frotas no recorte", value: s.fleets, help: "Veículos/frotas com pneus em uso na fotografia, dentro dos filtros." },
      { label: "Frotas críticas", value: s.critical, help: "Pelo menos um pneu com sulco crítico ou abaixo do legal, ou com medição vencida." },
      { label: "Frotas em atenção", value: s.attention, help: "Sulco em atenção, PSI fora da faixa, calibragem vencida ou medição/calibragem sem registro (sem item crítico)." },
      { label: "Frotas sem pendência", value: s.ok, help: "Nenhum dos critérios acima." },
      { label: "Pneus em uso nas frotas", value: s.tires, help: "Uma linha por pneu na aba Pneus." },
    );
  } else if (!first.empty && "summary" in first && first.view !== "frota") {
    const s = first.summary;
    indicators.push(
      { label: "Pneus no recorte", value: s.total, help: view === "fora" ? "Pneus fora de uso (estoque, ressolagem, descarte, baixa…) na fotografia." : "Todos os pneus da fotografia, dentro dos filtros." },
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

function buildAdherence(data: Extract<TiresExportData, { kind: "medicao" | "calibragem" }>): Built {
  const cal = data.kind === "calibragem";
  const what = cal ? "calibragem" : "medição";
  const first = data.first;
  const k = first.empty ? null : first.kpis;
  const rows = data.rows;
  const indicators: Indicator[] = k
    ? [
        { label: "Pneus em uso elegíveis", value: k.eligible, help: "Pneus em uso na fotografia, dentro dos filtros." },
        { label: `Com registro de ${what}`, value: k.withRecord, help: `Pneus em uso com data de ${what} no Rodopar.` },
        { label: "Em dia", value: k.emDia, help: "Dentro do prazo." },
        { label: "Próximo do vencimento", value: k.proximo, help: "Na janela de aviso, antes de vencer." },
        { label: "Vencido", value: k.vencido, help: "Além do prazo." },
        { label: "Sem registro", value: k.semRegistro, help: `Sem data de ${what}: fica fora da aderência e reduz a cobertura.` },
        { label: "Cobertura", value: k.coveragePct, fmt: pct, help: "Pneus com registro ÷ pneus elegíveis." },
        { label: "Aderência", value: k.adherencePct, fmt: pct, help: "(Em dia + Próximo) ÷ (Em dia + Próximo + Vencido); sem registro não entra na conta." },
        ...(cal
          ? [
              { label: "PSI adequada", value: k.psiAdequate, help: "Dentro da faixa mínima–máxima da regra aplicável." },
              { label: "PSI abaixo do mínimo", value: k.psiLow, help: "Abaixo do mínimo da regra." },
              { label: "PSI acima do máximo", value: k.psiHigh, help: "Acima do máximo da regra." },
              { label: "Sem parâmetro de PSI", value: k.psiNoRule, help: "Sem regra de pressão para o tipo/dimensão/posição — nunca conta como adequada." },
              { label: "Sem calibragem", value: k.psiMissing, help: "Sem leitura de PSI no Rodopar." },
              { label: "Pressão adequada", value: k.pressureAdequatePct, fmt: pct, help: "Adequada ÷ (Adequada + Abaixo + Acima); sem parâmetro e sem calibragem ficam fora da conta." },
            ]
          : []),
        { label: "Sulco crítico ou abaixo do legal", value: k.treadCritical, help: "Pneus em uso com classe Crítico ou Abaixo do legal." },
        { label: "Sulco em atenção", value: k.treadAttention, help: "Pneus em uso com classe Atenção." },
        { label: "Pendências exportadas", value: first.pendingTotal, help: `Pneus fora do prazo em dia${cal ? " ou com PSI fora da faixa/sem parâmetro" : ""}, no filtro de pendência escolhido (linhas da aba Pendências).` },
      ]
    : [{ label: "Fotografia", value: null, help: "Nenhuma fotografia oficial Rodopar confirmada para o recorte." }];
  const notes = [
    NOTE_PHOTO,
    deadlineNote(first.parameters?.okDays, first.parameters?.warningDays, what),
    `A aba Pendências traz só os pneus pendentes (pneus em dia${cal ? " e com PSI adequada" : ""} não entram), na ordem da tela: mais dias sem ${what} primeiro.`,
    `Linhas destacadas: ${what} vencida${cal ? " ou PSI abaixo do mínimo" : " ou sulco crítico/abaixo do legal"}.`,
    cal ? NOTE_PSI : null,
    NOTE_EMPTY,
    NOTE_SCOPE,
    incompleteNote(data),
  ].filter((n): n is string => Boolean(n));
  const specs = pendingSpecs(data.kind);
  const dims: TireBreakdownDim[] = ["operation", "state", "city", "br", "unit", "leader", "vehicleType"];
  const breakdownRows: XCell[][] = [];
  for (const d of dims) {
    for (const b of first.breakdowns?.[d] ?? []) {
      breakdownRows.push([BREAKDOWN_LABEL[d], b.name ?? BREAKDOWN_EMPTY[d], b.total, b.emDia, b.proximo, b.vencido, b.semRegistro, b.coveragePct, b.adherencePct]);
    }
  }
  return {
    spec: { title: cal ? "Aderência de calibragem (PSI)" : "Aderência de medição (MM)", indicators, notes },
    sheets: (wb, context) => {
      dataSheet(wb, "Pendências", `Pendências de ${what}`, context, colsOf(specs), rowsOf(specs, rows), {
        freezeCols: 1,
        highlight: (i) => {
          const r = rows[i];
          if (!r) return false;
          return r.status === "vencido" || (cal ? r.psiStatus === "baixa" : r.treadClass === "abaixo_legal" || r.treadClass === "critico");
        },
        note: `Uma linha por pneu pendente. Linhas destacadas: ${what} vencida${cal ? " ou PSI abaixo do mínimo" : " ou sulco crítico/abaixo do legal"}.`,
      });
      dataSheet(
        wb,
        "Por recorte",
        `Aderência de ${what} por recorte`,
        context,
        [
          { header: "Recorte", width: 20 },
          { header: "Nome", width: 30 },
          { header: "Pneus", width: 9, numFmt: int },
          { header: "Em dia", width: 9, numFmt: int },
          { header: "Próximo", width: 9, numFmt: int },
          { header: "Vencido", width: 9, numFmt: int },
          { header: "Sem registro", width: 10, numFmt: int },
          { header: "Cobertura (%)", width: 11, numFmt: pct },
          { header: "Aderência (%)", width: 11, numFmt: pct },
        ],
        breakdownRows,
        { note: "Quebras calculadas pela rotina sobre todos os pneus em uso elegíveis (não só os pendentes)." },
      );
      if (cal && first.gaps?.length) {
        dataSheet(
          wb,
          "Sem parâmetro PSI",
          "Pneus sem regra de PSI aplicável",
          context,
          [
            { header: "Tipo de equipamento", width: 24 },
            { header: "Dimensão", width: 16 },
            { header: "Posição", width: 10, numFmt: NUMF.text },
            { header: "Pneus", width: 9, numFmt: int },
          ],
          first.gaps.map((g) => [g.vehicleTypeName ?? "Sem tipo", g.dimension, text(g.positionCode), g.tires]),
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
          { label: "Frotas no cronograma", value: k.units, help: "Frotas com pneus em uso na fotografia mais recente, dentro dos filtros." },
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
      : [{ label: "Fotografia", value: null, help: "Nenhuma fotografia oficial Rodopar confirmada." }];
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
        { label: "Divergência persistente", value: k.persistent, help: "Aprovadas cuja leitura não bateu com a fotografia seguinte." },
        { label: "Sincronizadas com o Rodopar", value: k.sincronizadoRodopar, help: "A fotografia oficial já reflete a leitura de campo." },
        { label: "Retornadas por divergência", value: k.retornarDivergencia, help: "Devolvidas ao inspetor para nova medição." },
        { label: "Substituídas", value: k.substituida, help: "Trocadas por uma nova medição (reenvio)." },
        { label: "Tempo médio de revisão (h)", value: k.avgReviewHours, fmt: "#,##0.0", help: "Média de horas entre envio e revisão nos últimos 90 dias." },
        { label: "Vistorias exportadas", value: data.first.total, help: "Vistorias na situação e nos filtros escolhidos (linhas da aba Vistorias)." },
      ]
    : [];
  const notes = [
    "Vistoria de campo ≠ fotografia oficial: a vistoria nunca altera a base de pneus. Depois de aprovada, a leitura precisa ser lançada no Rodopar e só chega à base na próxima importação.",
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
        note: "Uma linha por vistoria. Linhas destacadas: com divergência. A vistoria não altera a fotografia oficial.",
      }),
  };
}

function buildHistory(data: Extract<TiresExportData, { kind: "historico" }>): Built {
  if (data.sub === "eventos") {
    const rows = data.rows;
    const counts = Object.entries(data.first.counts ?? {}).sort((a, b) => b[1] - a[1]);
    const indicators: Indicator[] = [
      { label: "Eventos no recorte", value: data.first.total, help: "Movimentações e mudanças detectadas entre fotografias oficiais, nos filtros (linhas da aba Eventos)." },
    ];
    const notes = [
      "Os eventos nascem da comparação entre fotografias oficiais do Rodopar confirmadas na importação (troca de posição, mudança de vida, medição, calibragem, retirada, ausência…).",
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

function buildQuality(data: Extract<TiresExportData, { kind: "qualidade" }>): Built {
  const first = data.first;
  const rows = data.rows;
  const b = first.empty ? null : first.lastBatch;
  const indicators: Indicator[] = first.empty
    ? [{ label: "Fotografia", value: null, help: "Nenhuma fotografia oficial Rodopar confirmada." }]
    : [
        { label: "Pneus na fotografia", value: first.totalTires, help: "Pneus da fotografia mais recente, dentro dos filtros." },
        { label: "Pneus com inconsistência do Rodopar", value: first.tiresWithRodoparIssue, help: "Pneus com pelo menos um alerta gravado na importação." },
        { label: "Índice de qualidade", value: first.qualityScore, fmt: pct, help: "Pneus sem inconsistência do Rodopar ÷ pneus na fotografia." },
        { label: "Ocorrências exportadas", value: data.total, help: "Linhas da aba Inconsistências (uma por ocorrência)." },
        ...(b
          ? [
              { label: "Linhas no último lote de importação", value: b.totalRows, help: `Arquivo ${b.fileName} · fotografia de ${formatDate(b.referenceDate)} · ${label(BATCH_STATUS_LABEL, b.status)}.` },
              { label: "Linhas com erro no último lote", value: b.errorRows, help: "Erros impedem a confirmação do lote." },
              { label: "Linhas com aviso no último lote", value: b.warningRows, help: "Avisos não bloqueiam, mas aparecem aqui." },
            ]
          : []),
      ];
  const notes = [
    "Inconsistências do relatório Rodopar (gravadas na importação) e lacunas de configuração do HFM (regra de PSI, layout de posições). Corrija na origem: o HFM não altera o dado do Rodopar.",
    data.req.issue ? "A aba Inconsistências traz só o problema escolhido na tela." : "A aba Inconsistências traz todos os problemas listados, um após o outro.",
    "Linhas destacadas: problemas que bloqueiam a importação.",
    NOTE_EMPTY,
    NOTE_SCOPE,
    incompleteNote(data),
  ].filter((n): n is string => Boolean(n));
  return {
    spec: {
      title: "Qualidade de dados dos pneus",
      indicators,
      tables: [
        {
          title: "Problemas encontrados",
          cols: [{ header: "Problema" }, { header: "Ocorrências", numFmt: int }, { header: "Pneus distintos", numFmt: int }],
          rows: (first.issues ?? []).map((i) => [issueLabel(i.code), i.count, i.tires]),
        },
      ],
      notes,
    },
    sheets: (wb, context) =>
      dataSheet(wb, "Inconsistências", "Inconsistências de dados", context, colsOf(QUALITY_SPECS), rowsOf(QUALITY_SPECS, rows), {
        freezeCols: 1,
        highlight: (i) => ERROR_ISSUES.has(rows[i]?.code ?? ""),
        note: "Uma linha por ocorrência. Linhas destacadas: problemas que bloqueiam a importação.",
      }),
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
      built = buildAdherence(data);
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
      built = buildQuality(data);
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
