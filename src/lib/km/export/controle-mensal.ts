import "server-only";

import ExcelJS from "exceljs";
import type { KmFilterOptions } from "@/lib/km/options";
import type { KmPlannerCell, KmPlannerData, KmPlannerDay, KmPlannerRow } from "@/lib/km/planner";
import { competenceLabel, formatDate, KM_STATUS, type KmFilters, type KmReadingStatus } from "@/lib/km/types";

/**
 * Controle Mensal de KM Rodado (XLSX) — o modelo corporativo da aba
 * "KM Rodado": bloco de título com logo, cabeçalho de dias, uma linha por
 * frota (hodômetros agrupados por dia), totais do dia, resumos por tipo,
 * operação e local, médias e cobertura.
 *
 * Os números vêm prontos de `km_planner` — o mesmo conjunto, com os mesmos
 * filtros, da tela Planner mês/dia. Nada de fórmula nem de texto fixo de
 * operação: tudo vem dos dados. Sem leitura é "—", nunca 0.
 */

// ---------------------------------------------------------------------------
// Paleta (marca) e estilos
// ---------------------------------------------------------------------------
const C = {
  blue: "FF1F4B93",
  cyan: "FF008CCB",
  gold: "FFF4B223",
  white: "FFFFFFFF",
  ink: "FF1B2433",
  muted: "FF5B6B82",
  subtle: "FF8A97AB",
  line: "FFD5DCE6",
  hatch: "FFB9C3D3",
  blueSoft: "FFE8EEF8",
  cyanSoft: "FFE3F3FB",
  goldSoft: "FFFDF0D2",
  graySoft: "FFF3F5F9",
  warnSoft: "FFFBE7BF",
  warnInk: "FF6B4304",
  dangerSoft: "FFF9D7D7",
  dangerInk: "FF7D1D1D",
} as const;

type Style = Partial<ExcelJS.Style>;
type Value = ExcelJS.CellValue;

const FONT = "Calibri";
const KM_FMT = "#,##0.0";
const INT_FMT = "#,##0";

const solid = (argb: string): ExcelJS.Fill => ({ type: "pattern", pattern: "solid", fgColor: { argb } });
const HATCH: ExcelJS.Fill = { type: "pattern", pattern: "lightUp", fgColor: { argb: C.hatch }, bgColor: { argb: C.white } };
const hair: Partial<ExcelJS.Border> = { style: "hair", color: { argb: C.line } };
const thin: Partial<ExcelJS.Border> = { style: "thin", color: { argb: C.line } };
const BORDER: Partial<ExcelJS.Borders> = { top: hair, left: hair, bottom: hair, right: hair };
const BORDER_HEAD: Partial<ExcelJS.Borders> = { top: thin, left: thin, bottom: thin, right: thin };

const font = (o: Partial<ExcelJS.Font> = {}): Partial<ExcelJS.Font> => ({ name: FONT, size: 9, color: { argb: C.ink }, ...o });

const S = {
  title: { font: font({ size: 16, bold: true, color: { argb: C.blue } }), alignment: { vertical: "middle" } },
  org: { font: font({ size: 11, bold: true, color: { argb: C.cyan } }), alignment: { vertical: "middle" } },
  info: { font: font({ color: { argb: C.muted } }), alignment: { vertical: "middle" } },
  filters: { font: font({ italic: true, color: { argb: C.muted } }), alignment: { vertical: "middle" } },
  band: {
    font: font({ bold: true, color: { argb: C.white } }),
    fill: solid(C.blue),
    alignment: { horizontal: "center", vertical: "middle" },
    border: BORDER_HEAD,
  },
  bandWeekend: {
    font: font({ bold: true, color: { argb: C.white } }),
    fill: solid(C.cyan),
    alignment: { horizontal: "center", vertical: "middle" },
    border: BORDER_HEAD,
  },
  weekday: {
    font: font({ color: { argb: C.ink } }),
    fill: solid(C.blueSoft),
    alignment: { horizontal: "center", vertical: "middle" },
    border: BORDER_HEAD,
  },
  weekdayWeekend: {
    font: font({ bold: true, color: { argb: C.ink } }),
    fill: solid(C.cyanSoft),
    alignment: { horizontal: "center", vertical: "middle" },
    border: BORDER_HEAD,
  },
  head: {
    font: font({ bold: true, color: { argb: C.white } }),
    fill: solid(C.blue),
    alignment: { horizontal: "center", vertical: "middle", wrapText: true },
    border: BORDER_HEAD,
  },
  headGold: {
    font: font({ bold: true, color: { argb: C.ink } }),
    fill: solid(C.gold),
    alignment: { horizontal: "center", vertical: "middle", wrapText: true },
    border: BORDER_HEAD,
  },
  totalLabel: {
    font: font({ bold: true, color: { argb: C.white } }),
    fill: solid(C.blue),
    alignment: { horizontal: "right", vertical: "middle", indent: 1 },
    border: BORDER_HEAD,
  },
  totalValue: {
    font: font({ bold: true }),
    fill: solid(C.goldSoft),
    alignment: { horizontal: "right", vertical: "middle" },
    border: BORDER_HEAD,
    numFmt: KM_FMT,
  },
  totalGold: {
    font: font({ bold: true, size: 10 }),
    fill: solid(C.gold),
    alignment: { horizontal: "right", vertical: "middle" },
    border: BORDER_HEAD,
    numFmt: KM_FMT,
  },
  readLabel: {
    font: font({ color: { argb: C.ink } }),
    fill: solid(C.blueSoft),
    alignment: { horizontal: "right", vertical: "middle", indent: 1 },
    border: BORDER_HEAD,
  },
  readValue: {
    font: font({ color: { argb: C.muted } }),
    fill: solid(C.blueSoft),
    alignment: { horizontal: "right", vertical: "middle" },
    border: BORDER_HEAD,
    numFmt: INT_FMT,
  },
  text: { font: font(), alignment: { vertical: "middle" }, border: BORDER },
  textCenter: { font: font(), alignment: { horizontal: "center", vertical: "middle" }, border: BORDER },
  plate: { font: font({ bold: true }), alignment: { horizontal: "center", vertical: "middle" }, border: BORDER },
  status: { font: font(), fill: solid(C.blueSoft), alignment: { horizontal: "center", vertical: "middle" }, border: BORDER },
  int: { font: font(), alignment: { horizontal: "center", vertical: "middle" }, border: BORDER, numFmt: INT_FMT },
  rowTotal: {
    font: font({ bold: true }),
    fill: solid(C.goldSoft),
    alignment: { horizontal: "right", vertical: "middle" },
    border: BORDER,
    numFmt: KM_FMT,
  },
  groupLabel: {
    font: font({ bold: true, color: { argb: C.blue } }),
    fill: solid(C.blueSoft),
    alignment: { vertical: "middle" },
    border: BORDER,
  },
  groupMeta: {
    font: font({ color: { argb: C.muted } }),
    fill: solid(C.blueSoft),
    alignment: { vertical: "middle" },
    border: BORDER,
  },
  groupValue: {
    font: font({ bold: true, color: { argb: C.blue } }),
    fill: solid(C.blueSoft),
    alignment: { horizontal: "right", vertical: "middle" },
    border: BORDER,
    numFmt: KM_FMT,
  },
  groupEmpty: { fill: solid(C.blueSoft), border: BORDER },
  blockTitle: {
    font: font({ bold: true, color: { argb: C.white } }),
    fill: solid(C.blue),
    alignment: { vertical: "middle", indent: 1 },
    border: BORDER_HEAD,
  },
  blockLabel: { font: font(), alignment: { vertical: "middle", indent: 1 }, border: BORDER },
  blockFoot: {
    font: font({ bold: true }),
    fill: solid(C.goldSoft),
    alignment: { vertical: "middle", indent: 1 },
    border: BORDER_HEAD,
  },
  note: { font: font({ italic: true, size: 8, color: { argb: C.muted } }), alignment: { vertical: "middle", wrapText: false } },
} satisfies Record<string, Style>;

// Células de dia
const D = {
  odo: { font: font({ color: { argb: C.muted } }), alignment: { horizontal: "right" }, border: BORDER, numFmt: KM_FMT },
  odoWeekend: {
    font: font({ color: { argb: C.muted } }),
    fill: solid(C.graySoft),
    alignment: { horizontal: "right" },
    border: BORDER,
    numFmt: KM_FMT,
  },
  km: { font: font(), alignment: { horizontal: "right" }, border: BORDER, numFmt: KM_FMT },
  kmWeekend: { font: font(), fill: solid(C.graySoft), alignment: { horizontal: "right" }, border: BORDER, numFmt: KM_FMT },
  noMovement: { font: font({ color: { argb: C.subtle } }), alignment: { horizontal: "right" }, border: BORDER, numFmt: KM_FMT },
  high: { font: font({ bold: true, color: { argb: C.warnInk } }), fill: solid(C.goldSoft), alignment: { horizontal: "right" }, border: BORDER, numFmt: KM_FMT },
  attention: { font: font({ color: { argb: C.warnInk } }), fill: solid(C.warnSoft), alignment: { horizontal: "right" }, border: BORDER, numFmt: KM_FMT },
  noReading: { font: font({ color: { argb: C.subtle } }), alignment: { horizontal: "center" }, border: BORDER },
  noReadingWeekend: { font: font({ color: { argb: C.subtle } }), fill: solid(C.graySoft), alignment: { horizontal: "center" }, border: BORDER },
  inconsistent: { font: font({ bold: true, color: { argb: C.dangerInk } }), fill: solid(C.dangerSoft), alignment: { horizontal: "center" }, border: BORDER },
  outOfFilter: { font: font({ italic: true, color: { argb: C.subtle } }), alignment: { horizontal: "center" }, border: BORDER, numFmt: KM_FMT },
  future: { fill: HATCH, border: BORDER },
} satisfies Record<string, Style>;

// ---------------------------------------------------------------------------
// Rótulos
// ---------------------------------------------------------------------------
const VEHICLE_STATUS: Record<string, string> = {
  active: "Ativo",
  inactive: "Inativo",
  maintenance: "Em manutenção",
  sold: "Vendido",
  decommissioned: "Desmobilizado",
};
const vehicleStatus = (s: string | null | undefined) => (s ? (VEHICLE_STATUS[s] ?? s) : "—");

const WEEKDAY_LONG = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];
const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

const NO_READING = "—";
const INCONSISTENT = "Inc.";
const OUT_OF_FILTER = "Fora";

// ---------------------------------------------------------------------------
// Colunas
// ---------------------------------------------------------------------------
interface FixedColumn {
  key: string;
  header: string;
  width: number;
  /** Agrupada e recolhida (expande pelo "+" do Excel). */
  grouped?: boolean;
  style: Style;
  value: (r: KmPlannerRow) => Value;
  note?: (r: KmPlannerRow) => string | null;
}

const FIXED: FixedColumn[] = [
  {
    key: "br",
    header: "BR",
    width: 14,
    style: S.textCenter,
    value: (r) => r.br ?? "—",
    note: (r) => (r.brs.length > 1 ? `${r.brs.length} BRs no mês: ${r.brs.join(", ")}` : null),
  },
  {
    key: "local",
    header: "Local de operação",
    width: 22,
    style: S.text,
    value: (r) => r.local ?? "—",
    note: (r) => (r.locals.length > 1 ? `${r.locals.length} locais no mês: ${r.locals.join(", ")}` : null),
  },
  { key: "fleet", header: "Frota", width: 10, style: S.textCenter, value: (r) => r.fleetCode ?? "—" },
  { key: "plate", header: "Placa", width: 10, style: S.plate, value: (r) => r.plate },
  { key: "type", header: "Tipo", width: 16, style: S.textCenter, value: (r) => r.type ?? "—" },
  { key: "model", header: "Modelo", width: 16, style: S.textCenter, value: (r) => r.model ?? "—" },
  { key: "status", header: "Status", width: 10, style: S.status, value: (r) => vehicleStatus(r.status) },
  { key: "operation", header: "Operação", width: 22, grouped: true, style: S.text, value: (r) => r.operation ?? "—" },
  { key: "leader", header: "Liderança", width: 24, grouped: true, style: S.text, value: (r) => r.leader ?? "—" },
  { key: "readingDays", header: "Dias c/ leitura", width: 9.5, style: S.int, value: (r) => r.readingDays },
  {
    key: "total",
    header: "TT KM Rodado Mês",
    width: 12,
    style: S.rowTotal,
    value: (r) => (r.totalKm == null ? NO_READING : r.totalKm),
  },
];

const COL0 = 2; // coluna A é margem
const LAST_FIXED = COL0 + FIXED.length - 1;
const TOTAL_COL = LAST_FIXED;
const COUNT_COL = LAST_FIXED - 1;
const dayBase = (i: number) => LAST_FIXED + 1 + i * 3;
const ODO_W = 10.5;
// Larguras ≠ 9 (padrão do exceljs): coluna "padrão" não é gravada e perderia o estado de grupo.
const KM_W = 9.5;

// Linhas do cabeçalho
const R = { title: 2, org: 3, info: 4, filters: 5, date: 7, weekday: 8, total: 9, readings: 10, head: 11 } as const;

// ---------------------------------------------------------------------------
// Dados auxiliares (apresentação dos valores da rotina)
// ---------------------------------------------------------------------------
interface DayInfo {
  day: KmPlannerDay;
  future: boolean;
  weekend: boolean;
  noReading: boolean;
}

function dayInfos(data: KmPlannerData): DayInfo[] {
  const today = data.period.today;
  return data.days.map((day, i) => {
    const future = Boolean(today) && day.date > today;
    return { day, future, weekend: day.dow >= 6, noReading: !future && (data.dayReadings[i] ?? 0) === 0 };
  });
}

const counts = (cell: KmPlannerCell | undefined): cell is KmPlannerCell =>
  Boolean(cell && KM_STATUS[cell[0] as KmReadingStatus]?.counts && cell[3] != null);

/** Valor agregado de um dia: futuro em branco; sem leitura que conte (no dia ou no conjunto) "—". */
const aggregate = (info: DayInfo, value: number | null | undefined, present = true): Value =>
  info.future ? null : info.noReading || !present || value == null ? NO_READING : value;

/**
 * Dias em que um conjunto de frotas tem alguma leitura que conta — só para
 * não exibir como 0 km o dia que a rotina completou com zero.
 */
function presence(rows: KmPlannerRow[], days: number): boolean[] {
  const out = Array.from({ length: days }, () => false);
  for (const r of rows) for (let i = 0; i < days; i++) if (!out[i] && counts(r.cells[i])) out[i] = true;
  return out;
}

interface Group {
  label: string;
  vehicles: number;
  km: number | null;
  days: (number | null)[];
  present?: boolean[];
}

/**
 * Soma das linhas de um conjunto de frotas, dia a dia, só com o KM que conta
 * (as mesmas células exibidas). Dia sem KM que conte no conjunto fica nulo.
 */
function sumRows(rows: KmPlannerRow[], days: number): { km: number | null; days: (number | null)[] } {
  const out: (number | null)[] = Array.from({ length: days }, () => null);
  let km: number | null = null;
  for (const r of rows) {
    for (let i = 0; i < days; i++) {
      const cell = r.cells[i];
      if (!counts(cell)) continue;
      const v = cell[3] as number;
      out[i] = (out[i] ?? 0) + v;
      km = (km ?? 0) + v;
    }
  }
  // Arredonda só no fim, como a rotina (soma das células, não dos totais já arredondados).
  const round = (v: number | null) => (v == null ? null : Math.round(v * 10) / 10);
  return { km: round(km), days: out.map(round) };
}

function localGroups(rows: KmPlannerRow[]): { label: string; rows: KmPlannerRow[] }[] {
  const out: { label: string; rows: KmPlannerRow[] }[] = [];
  const index = new Map<string, { label: string; rows: KmPlannerRow[] }>();
  for (const r of rows) {
    const key = r.local ?? "";
    let g = index.get(key);
    if (!g) {
      g = { label: r.local ?? "Sem local", rows: [] };
      index.set(key, g);
      out.push(g);
    }
    g.rows.push(r);
  }
  return out;
}

/** Por operação: da rotina quando vier (`by_operation`); senão, pela operação de cada linha. */
function operationGroups(data: KmPlannerData): { groups: Group[]; derived: boolean } {
  if (data.byOperation?.length) {
    return {
      groups: data.byOperation.map((g) => ({ label: g.operation, vehicles: g.vehicles, km: g.km, days: g.days })),
      derived: false,
    };
  }
  const map = new Map<string, KmPlannerRow[]>();
  for (const r of data.rows) {
    const key = r.operation ?? "Sem operação";
    map.set(key, [...(map.get(key) ?? []), r]);
  }
  const groups = [...map.entries()]
    .map(([label, rows]) => ({ label, vehicles: rows.length, ...sumRows(rows, data.days.length) }))
    .sort((a, b) => a.label.localeCompare(b.label, "pt-BR"));
  return { groups, derived: true };
}

// ---------------------------------------------------------------------------
// Filtros aplicados (nomes a partir das opções oficiais)
// ---------------------------------------------------------------------------
const ids = (v: string | undefined) => (v ?? "").split(",").map((s) => s.trim()).filter(Boolean);

export function describeKmFilters(f: KmFilters, options: KmFilterOptions | null): string[] {
  const out: string[] = [];
  const name = (list: { id: string; name: string }[] | undefined, v: string | undefined) =>
    ids(v).map((id) => list?.find((o) => o.id === id)?.name ?? id).join(", ");
  const add = (label: string, value: string) => {
    if (value) out.push(`${label}: ${value}`);
  };
  add("Operação", name(options?.operations, f.operation));
  add(
    "UF",
    ids(f.state)
      .map((id) => options?.coverage.find((c) => String(c.stateId) === id)?.uf ?? id)
      .join(", "),
  );
  add(
    "Cidade",
    ids(f.city)
      .map((id) => options?.coverage.find((c) => String(c.cityId) === id)?.cityName ?? id)
      .join(", "),
  );
  add(
    "BR",
    ids(f.br)
      .map((id) => options?.brs.find((b) => b.id === id)?.code ?? id)
      .join(", "),
  );
  add("Liderança", name(options?.leaders, f.leader));
  add("Filial", name(options?.units, f.unit));
  add("Tipo", name(options?.vehicleTypes, f.vehicleType));
  add("Subcategoria", name(options?.subcategories, f.subcategory));
  add("Modelo", name(options?.models, f.model));
  add(
    "Veículo",
    ids(f.vehicle)
      .map((id) => options?.vehicles.find((v) => v.id === id)?.plate ?? id)
      .join(", "),
  );
  add(
    "Situação da leitura",
    ids(f.status)
      .map((c) => KM_STATUS[c as KmReadingStatus]?.label ?? c)
      .join(", "),
  );
  if (f.fleet) add("Frota", f.fleet === "active" ? "Ativas" : f.fleet === "inactive" ? "Inativas" : "Todas");
  if (f.q?.trim()) add("Busca", f.q.trim());
  return out;
}

// ---------------------------------------------------------------------------
// Montagem
// ---------------------------------------------------------------------------
export interface ControleMensalInput {
  data: KmPlannerData;
  organizationName?: string | null;
  generatedBy?: string | null;
  /** "aaaa-mm-dd hh:mm" já no fuso da operação. */
  generatedAt: string;
  filters?: string[];
  logo?: Buffer | null;
}

export const controleMensalFileName = (data: KmPlannerData) =>
  `controle-mensal-km-${data.period.competence || data.period.from.slice(0, 7) || "periodo"}.xlsx`;

/** Linhas da planilha que viram registro de auditoria. */
export const controleMensalRowCount = (data: KmPlannerData) => data.rows.length;

export async function buildControleMensalXlsx(input: ControleMensalInput): Promise<Buffer> {
  const { data } = input;
  const days = dayInfos(data);
  const lastCol = dayBase(days.length) - 1;
  const competence = capitalize(competenceLabel(data.period.competence));
  // Sem nenhuma leitura que conte no período, o total é "—" (a rotina devolve 0).
  const monthKm: Value = data.totals.daysWithKm > 0 ? data.totals.km : NO_READING;

  const wb = new ExcelJS.Workbook();
  wb.creator = "Horizonte Fleet Management";
  wb.title = `Controle Mensal de KM Rodado — ${competence}`;
  if (input.organizationName) wb.company = input.organizationName;
  wb.created = new Date();

  const ws = wb.addWorksheet("KM Rodado", {
    properties: { defaultRowHeight: 14, tabColor: { argb: C.blue }, outlineLevelCol: 1, outlineLevelRow: 1 },
    views: [
      {
        state: "frozen",
        xSplit: LAST_FIXED,
        ySplit: R.head,
        topLeftCell: `${colLetter(LAST_FIXED + 1)}${R.head + 1}`,
        activeCell: `${colLetter(LAST_FIXED + 1)}${R.head + 1}`,
        showGridLines: false,
        zoomScale: 90,
      },
    ],
  });
  ws.properties.outlineProperties = { summaryBelow: false, summaryRight: true };

  const put = (row: number, col: number, value: Value, style?: Style) => {
    const cell = ws.getCell(row, col);
    cell.value = value;
    if (style) cell.style = style;
    return cell;
  };
  const merge = (r1: number, c1: number, r2: number, c2: number, value: Value, style: Style) => {
    for (let r = r1; r <= r2; r++) for (let c = c1; c <= c2; c++) ws.getCell(r, c).style = style;
    if (r2 > r1 || c2 > c1) ws.mergeCells(r1, c1, r2, c2);
    ws.getCell(r1, c1).value = value;
  };

  // Colunas: larguras e grupos (Operação/Liderança e hodômetros recolhidos).
  ws.getColumn(1).width = 1.5;
  FIXED.forEach((f, i) => {
    const col = ws.getColumn(COL0 + i);
    col.width = f.width;
    if (f.grouped) {
      col.outlineLevel = 1;
      col.hidden = true;
      Object.defineProperty(col, "collapsed", { get: () => false });
    } else if (FIXED[i - 1]?.grouped) {
      // coluna-resumo logo após o grupo: é ela que carrega o "recolhido"
      Object.defineProperty(col, "collapsed", { get: () => true });
    }
  });
  days.forEach((_, i) => {
    const base = dayBase(i);
    for (const c of [base, base + 1]) {
      const col = ws.getColumn(c);
      col.width = ODO_W;
      col.outlineLevel = 1;
      col.hidden = true;
      Object.defineProperty(col, "collapsed", { get: () => false });
    }
    const km = ws.getColumn(base + 2);
    km.width = KM_W;
    Object.defineProperty(km, "collapsed", { get: () => true });
  });

  // ---- Título -------------------------------------------------------------
  ws.getRow(1).height = 6;
  ws.getRow(R.title).height = 24;
  ws.getRow(R.org).height = 16;
  ws.getRow(R.info).height = 14;
  ws.getRow(R.filters).height = 14;
  ws.getRow(6).height = 6;
  const textCol = COL0 + 1;
  if (input.logo) {
    const imageId = wb.addImage({ base64: input.logo.toString("base64"), extension: "png" });
    // 1920 × 1041 (proporção oficial preservada)
    ws.addImage(imageId, { tl: { col: COL0 - 1 + 0.15, row: R.title - 1 + 0.05 }, ext: { width: 98, height: 53 } });
  }
  put(R.title, textCol, "Controle Mensal de KM Rodado", S.title);
  put(R.org, textCol, input.organizationName || "—", S.org);
  put(
    R.info,
    textCol,
    [
      `Competência: ${competence} (${formatDate(data.period.from)} a ${formatDate(data.period.to)})`,
      `Gerado em ${input.generatedAt}${input.generatedBy ? ` por ${input.generatedBy}` : ""}`,
      `${data.rows.length} frota(s)`,
    ].join("  ·  "),
    S.info,
  );
  put(
    R.filters,
    textCol,
    input.filters?.length ? `Filtros: ${input.filters.join("; ")}` : "Filtros: nenhum — todas as frotas da competência no seu escopo",
    S.filters,
  );

  // ---- Cabeçalho de dias, totais do dia e cabeçalho da grade --------------
  ws.getRow(R.date).height = 16;
  ws.getRow(R.weekday).height = 14;
  ws.getRow(R.total).height = 16;
  ws.getRow(R.readings).height = 14;
  ws.getRow(R.head).height = 30;

  merge(R.date, COL0, R.weekday, LAST_FIXED, competence.toUpperCase(), { ...S.band, font: font({ bold: true, size: 11, color: { argb: C.white } }) });
  merge(R.total, COL0, R.total, LAST_FIXED - 1, "TOTAL KM DIA", S.totalLabel);
  put(R.total, TOTAL_COL, monthKm, S.totalGold);
  merge(R.readings, COL0, R.readings, LAST_FIXED - 1, "FROTAS COM LEITURA NO DIA", S.readLabel);
  put(R.readings, TOTAL_COL, data.totals.vehiclesWithReading, { ...S.readValue, numFmt: '#,##0" frotas"' });

  FIXED.forEach((f, i) => put(R.head, COL0 + i, f.header, f.key === "total" ? S.headGold : S.head));

  days.forEach((d, i) => {
    const base = dayBase(i);
    const [, mm, dd] = d.day.date.split("-");
    merge(R.date, base, R.date, base + 2, `${dd}/${mm}`, d.weekend ? S.bandWeekend : S.band);
    merge(R.weekday, base, R.weekday, base + 2, WEEKDAY_LONG[d.day.dow % 7], d.weekend ? S.weekdayWeekend : S.weekday);
    put(R.total, base, null, S.totalValue);
    put(R.total, base + 1, null, S.totalValue);
    put(R.total, base + 2, aggregate(d, data.dayTotals[i]), d.future ? { ...S.totalValue, fill: HATCH } : S.totalValue);
    put(R.readings, base, null, S.readValue);
    put(R.readings, base + 1, null, S.readValue);
    put(R.readings, base + 2, d.future ? null : (data.dayReadings[i] ?? 0), S.readValue);
    put(R.head, base, "Hod. inicial", S.head);
    put(R.head, base + 1, "Hod. final", S.head);
    put(R.head, base + 2, "KM rodado", S.headGold);
  });

  // ---- Linhas por frota, agrupadas por local ------------------------------
  let row = R.head + 1;
  if (data.rows.length === 0) {
    merge(row, COL0, row, lastCol, "Nenhuma frota elegível para a competência com os filtros aplicados.", S.blockLabel);
    row++;
  }
  for (const g of localGroups(data.rows)) {
    const sum = sumRows(g.rows, days.length);
    put(row, COL0, g.label, S.groupLabel);
    put(row, COL0 + 1, `${g.rows.length} ${g.rows.length === 1 ? "frota" : "frotas"}`, S.groupMeta);
    for (let c = COL0 + 2; c < TOTAL_COL; c++) put(row, c, null, S.groupEmpty);
    put(row, TOTAL_COL, sum.km ?? NO_READING, S.groupValue);
    days.forEach((d, i) => {
      const base = dayBase(i);
      put(row, base, null, S.groupEmpty);
      put(row, base + 1, null, S.groupEmpty);
      put(row, base + 2, d.future ? null : (sum.days[i] ?? NO_READING), d.future ? { ...S.groupEmpty, fill: HATCH } : S.groupValue);
    });
    row++;

    for (const r of g.rows) {
      const xr = ws.getRow(row);
      xr.outlineLevel = 1;
      Object.defineProperty(xr, "collapsed", { get: () => false });
      FIXED.forEach((f, i) => {
        const cell = put(row, COL0 + i, f.value(r), f.style);
        const note = f.note?.(r);
        if (note) cell.note = note;
      });
      days.forEach((d, i) => writeDay(row, dayBase(i), r.cells[i], d));
      row++;
    }
  }
  const lastData = row - 1;
  ws.autoFilter = { from: { row: R.head, column: COL0 }, to: { row: Math.max(lastData, R.head), column: lastCol } };

  function writeDay(r: number, base: number, cell: KmPlannerCell | undefined, d: DayInfo) {
    const [status, start, end, km] = cell ?? (["no_reading", null, null, null] as KmPlannerCell);
    const odo = d.weekend ? D.odoWeekend : D.odo;
    if (status === "future") {
      for (const c of [base, base + 1, base + 2]) put(r, c, null, D.future);
      return;
    }
    if (status === "out_of_filter") {
      put(r, base, start, { ...D.outOfFilter, alignment: { horizontal: "right" } });
      put(r, base + 1, end, { ...D.outOfFilter, alignment: { horizontal: "right" } });
      put(r, base + 2, OUT_OF_FILTER, D.outOfFilter);
      return;
    }
    put(r, base, start, odo);
    put(r, base + 1, end, odo);
    if (status === "no_reading") {
      put(r, base + 2, NO_READING, d.weekend ? D.noReadingWeekend : D.noReading);
      return;
    }
    if (!counts(cell)) {
      put(r, base + 2, INCONSISTENT, D.inconsistent);
      return;
    }
    const style =
      status === "no_movement"
        ? D.noMovement
        : status === "high_mileage"
          ? D.high
          : status === "km_divergence" || status === "pending_review"
            ? D.attention
            : d.weekend
              ? D.kmWeekend
              : D.km;
    put(r, base + 2, km, style);
  }

  // ---- Resumos ------------------------------------------------------------
  row = lastData + 2;
  const labelEnd = COUNT_COL - 1;

  const block = (title: string, groups: Group[], note?: string) => {
    merge(row, COL0, row, labelEnd, title, S.blockTitle);
    put(row, COUNT_COL, "Frotas", S.head);
    put(row, TOTAL_COL, "TT KM Mês", S.headGold);
    days.forEach((d, i) => {
      const base = dayBase(i);
      const [, mm, dd] = d.day.date.split("-");
      put(row, base, null, S.head);
      put(row, base + 1, null, S.head);
      put(row, base + 2, `${dd}/${mm}`, d.weekend ? S.bandWeekend : S.head);
    });
    row++;
    for (const g of groups) {
      merge(row, COL0, row, labelEnd, g.label, S.blockLabel);
      put(row, COUNT_COL, g.vehicles, S.int);
      put(row, TOTAL_COL, g.km == null || (g.present && !g.present.some(Boolean)) ? NO_READING : g.km, S.rowTotal);
      days.forEach((d, i) => {
        const base = dayBase(i);
        put(row, base, null, BORDER_ONLY);
        put(row, base + 1, null, BORDER_ONLY);
        const v = aggregate(d, g.days[i], g.present?.[i] ?? true);
        put(row, base + 2, v, d.future ? D.future : v === NO_READING ? D.noReading : d.weekend ? D.kmWeekend : D.km);
      });
      row++;
    }
    merge(row, COL0, row, labelEnd, "Total", S.blockFoot);
    put(row, COUNT_COL, data.totals.vehicles, { ...S.blockFoot, numFmt: INT_FMT, alignment: { horizontal: "center" } });
    put(row, TOTAL_COL, monthKm, S.totalGold);
    days.forEach((d, i) => {
      const base = dayBase(i);
      put(row, base, null, S.totalValue);
      put(row, base + 1, null, S.totalValue);
      put(row, base + 2, aggregate(d, data.dayTotals[i]), d.future ? { ...S.totalValue, fill: HATCH } : S.totalValue);
    });
    row++;
    if (note) put(row++, COL0, note, S.note);
    row++;
  };

  block(
    "RESUMO POR TIPO DE FROTA",
    data.byType.map((g) => ({
      label: g.type,
      vehicles: g.vehicles,
      km: g.km,
      days: g.days,
      present: presence(
        data.rows.filter((r) => (r.vehicleTypeId ?? null) === (g.vehicleTypeId ?? null)),
        days.length,
      ),
    })),
  );
  const ops = operationGroups(data);
  block(
    "RESUMO POR OPERAÇÃO",
    ops.groups,
    ops.derived
      ? "Operação vigente no último dia com contexto no mês de cada frota; KM somado das células que contam (as mesmas da grade)."
      : undefined,
  );
  block(
    "RESUMO POR LOCAL DE OPERAÇÃO",
    data.byLocal.map((g) => ({
      label: g.local,
      vehicles: g.vehicles,
      km: g.km,
      days: g.days,
      // "—" só quando nenhuma frota que passou pelo local no mês tem leitura no dia.
      present: presence(
        g.cityId == null ? data.rows : data.rows.filter((r) => r.local === g.local || r.locals.includes(g.local)),
        days.length,
      ),
    })),
    "Local de cada dia (uma frota que mudou de local no mês aparece nos dois).",
  );

  // ---- Indicadores: médias e cobertura ------------------------------------
  const t = data.totals;
  const elapsedDays = days.filter((d) => !d.future).length;
  const daysWithReading = days.filter((d) => !d.future && !d.noReading).length;
  const ratio = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 10) / 10 : NO_READING);
  const pct = (a: number, b: number) => (b > 0 ? a / b : NO_READING);
  const indicators: [string, Value, string][] = [
    ["KM validado no mês", monthKm, `${KM_FMT}" km"`],
    ["Frotas no controle", t.vehicles, INT_FMT],
    ["Frotas com leitura no mês", t.vehiclesWithReading, INT_FMT],
    ["Média por veículo (KM ÷ frotas com leitura)", ratio(t.km, t.vehiclesWithReading), `${KM_FMT}" km"`],
    ["Média diária da frota (KM ÷ dias com leitura)", ratio(t.km, daysWithReading), `${KM_FMT}" km/dia"`],
    ["Média por veículo-dia com leitura (KM ÷ leituras)", ratio(t.km, t.readingDays), `${KM_FMT}" km"`],
    ["Dias com leitura / dias decorridos", `${daysWithReading} de ${elapsedDays}`, "@"],
    ["Cobertura (dias com leitura ÷ dias decorridos)", pct(daysWithReading, elapsedDays), "0.0%"],
    ["Leituras (veículo-dia com leitura / decorridos)", `${t.readingDays.toLocaleString("pt-BR")} de ${t.elapsedVehicleDays.toLocaleString("pt-BR")}`, "@"],
    ["Cobertura de leituras (veículo-dia)", pct(t.readingDays, t.elapsedVehicleDays), "0.0%"],
    ["Dias com KM no período", t.daysWithKm, INT_FMT],
  ];
  merge(row, COL0, row, TOTAL_COL, "INDICADORES DO MÊS — MÉDIAS E COBERTURA", S.blockTitle);
  row++;
  for (const [label, value, fmt] of indicators) {
    merge(row, COL0, row, labelEnd, label, S.blockLabel);
    merge(row, COUNT_COL, row, TOTAL_COL, value, {
      font: font({ bold: true }),
      alignment: { horizontal: "right", vertical: "middle" },
      border: BORDER,
      numFmt: value === NO_READING ? "@" : fmt,
    });
    row++;
  }
  row++;

  // ---- Legenda --------------------------------------------------------------
  merge(row, COL0, row, TOTAL_COL, "LEGENDA", S.blockTitle);
  row++;
  const legend: [Value, Style, string][] = [
    [NO_READING, D.noReading, `${KM_STATUS.no_reading.label}: ${KM_STATUS.no_reading.description}`],
    [0, D.noMovement, `${KM_STATUS.no_movement.label}: ${KM_STATUS.no_movement.description}`],
    [123.4, D.km, `${KM_STATUS.validated.label}: ${KM_STATUS.validated.description}`],
    [456.7, D.high, `${KM_STATUS.high_mileage.label}: ${KM_STATUS.high_mileage.description}`],
    [
      45.6,
      D.attention,
      `${KM_STATUS.km_divergence.label} / ${KM_STATUS.pending_review.label}: entram nos totais e pedem análise.`,
    ],
    [INCONSISTENT, D.inconsistent, `${KM_STATUS.inconsistent.label}: ${KM_STATUS.inconsistent.description}`],
    [OUT_OF_FILTER, D.outOfFilter, "Fora do filtro: no dia a frota estava em outro contexto (operação, local, BR) — não entra nos totais."],
    [null, D.future, "Dia futuro: sem resultado."],
  ];
  for (const [sample, style, text] of legend) {
    put(row, COL0, sample, style);
    merge(row, COL0 + 1, row, TOTAL_COL, text, { font: font(), alignment: { vertical: "middle", indent: 1 } });
    row++;
  }
  put(
    row++,
    COL0,
    "Hodômetro inicial e final: use o “+” acima de cada dia para expandir. Operação e Liderança: “+” acima de “Dias c/ leitura”.",
    S.note,
  );
  put(
    row++,
    COL0,
    "Fonte: rotina km_planner — o mesmo conjunto e os mesmos filtros da tela Planner mês/dia. Valores fixos, sem fórmulas.",
    S.note,
  );

  // ---- Impressão ------------------------------------------------------------
  ws.pageSetup = {
    orientation: "landscape",
    paperSize: 9,
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0,
    printTitlesRow: `${R.date}:${R.head}`,
    margins: { left: 0.3, right: 0.3, top: 0.4, bottom: 0.4, header: 0.2, footer: 0.2 },
  };
  ws.headerFooter = { oddFooter: `&L${input.organizationName ?? ""}&CControle Mensal de KM Rodado — ${competence}&RPágina &P de &N` };

  return Buffer.from(await wb.xlsx.writeBuffer());
}

const BORDER_ONLY: Style = { border: BORDER };

function colLetter(n: number): string {
  let s = "";
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}
