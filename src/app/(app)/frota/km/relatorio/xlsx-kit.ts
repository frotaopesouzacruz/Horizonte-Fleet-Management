import "server-only";

import { readFile } from "node:fs/promises";
import path from "node:path";
import ExcelJS from "exceljs";

export { logKmExport, stampText } from "./export-log";

/**
 * Kit das planilhas do KM (Relatório Gerencial e Qualidade): cores da marca,
 * logo, cabeçalho de tabela, painéis congelados, autofiltro e a resposta de
 * download. Os valores entram fixos (sem fórmulas): o arquivo é a fotografia
 * do que o banco calculou no momento da geração.
 */

export const BRAND = {
  primary: "FF1F4B93",
  secondary: "FF008CCB",
  accent: "FFF4B223",
  ink: "FF1F2937",
  muted: "FF6B7280",
  band: "FFF3F6FB",
  highlight: "FFFDF3D9",
  white: "FFFFFFFF",
} as const;

export const NUM = {
  int: "#,##0",
  km: "#,##0.0",
  km2: "#,##0.00",
  pct: '0.0"%"',
  z: "0.00",
  date: "dd/mm/yyyy",
  stamp: "dd/mm/yyyy hh:mm",
} as const;

export type XCell = string | number | Date | boolean | null | undefined;

export interface XCol {
  header: string;
  width?: number;
  numFmt?: string;
}

export function newWorkbook(): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Horizonte Fleet Management";
  wb.company = "Horizonte";
  wb.created = new Date();
  return wb;
}

/** "2026-09-30" → data do Excel (meia-noite UTC, sem deslocar o dia). */
export function excelDate(iso: string | null | undefined): Date | null {
  if (!iso || !/^\d{4}-\d{2}-\d{2}/.test(iso)) return null;
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

/** Data e hora local de São Paulo, como valor fixo de Excel. */
export function excelStamp(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(d);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  return new Date(Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute")));
}

export const brDate = (iso: string | null | undefined) =>
  iso && /^\d{4}-\d{2}-\d{2}/.test(iso) ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : "—";

// ---------------------------------------------------------------------------
// Logo
// ---------------------------------------------------------------------------
let logoCache: Buffer | null | undefined;

/** O logo oficial (claro), do disco ou, em último caso, do próprio site. */
export async function loadLogo(origin: string): Promise<Buffer | null> {
  if (logoCache !== undefined) return logoCache;
  try {
    logoCache = await readFile(path.join(process.cwd(), "public", "brand", "logo-light.png"));
    return logoCache;
  } catch {
    // segue para o site
  }
  try {
    const res = await fetch(new URL("/brand/logo-light.png", origin), { cache: "force-cache" });
    if (res.ok) {
      logoCache = Buffer.from(await res.arrayBuffer());
      return logoCache;
    }
  } catch {
    // sem logo: o título continua
  }
  return null;
}

/** Logo no canto superior esquerdo (proporção oficial 1920 × 1041). */
export function placeLogo(wb: ExcelJS.Workbook, ws: ExcelJS.Worksheet, logo: Buffer | null, height = 64) {
  if (!logo) return;
  const id = wb.addImage({ buffer: logo as unknown as ArrayBuffer, extension: "png" });
  ws.addImage(id, { tl: { col: 0.15, row: 0.15 }, ext: { width: Math.round((height * 1920) / 1041), height }, editAs: "oneCell" });
}

// ---------------------------------------------------------------------------
// Blocos
// ---------------------------------------------------------------------------
const thin = { style: "thin" as const, color: { argb: "FFD9DEE7" } };

/** Título e linhas de contexto no topo de uma aba. Devolve a próxima linha livre. */
export function sheetHeading(ws: ExcelJS.Worksheet, title: string, lines: string[], startCol = 1): number {
  const t = ws.getCell(1, startCol);
  t.value = title;
  t.font = { bold: true, size: 14, color: { argb: BRAND.primary } };
  ws.getRow(1).height = 22;
  lines.forEach((line, i) => {
    const c = ws.getCell(2 + i, startCol);
    c.value = line;
    c.font = { size: 10, color: { argb: BRAND.muted } };
  });
  return 2 + lines.length + 1;
}

/** Faixa de seção (azul-claro da marca, texto branco). */
export function sectionBand(ws: ExcelJS.Worksheet, row: number, text: string, span: number, startCol = 1) {
  for (let c = startCol; c < startCol + span; c++) {
    const cell = ws.getCell(row, c);
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: BRAND.secondary } };
    cell.font = { bold: true, color: { argb: BRAND.white } };
  }
  ws.getCell(row, startCol).value = text;
  ws.getRow(row).height = 18;
}

function styleHeader(row: ExcelJS.Row, from: number, count: number) {
  row.height = 30;
  for (let c = from; c < from + count; c++) {
    const cell = row.getCell(c);
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: BRAND.primary } };
    cell.font = { bold: true, color: { argb: BRAND.white } };
    cell.alignment = { vertical: "middle", wrapText: true };
    cell.border = { bottom: { style: "medium", color: { argb: BRAND.accent } } };
  }
}

/**
 * Tabela a partir de `startRow`: cabeçalho da marca, formatos por coluna,
 * zebra leve e, opcionalmente, linhas em destaque (dourado claro).
 * Devolve a última linha escrita.
 */
export function writeTable(
  ws: ExcelJS.Worksheet,
  startRow: number,
  cols: XCol[],
  rows: XCell[][],
  opts: { startCol?: number; highlight?: (index: number) => boolean; total?: XCell[] } = {},
): number {
  const startCol = opts.startCol ?? 1;
  const header = ws.getRow(startRow);
  cols.forEach((col, i) => {
    header.getCell(startCol + i).value = col.header;
  });
  styleHeader(header, startCol, cols.length);

  rows.forEach((values, r) => {
    const row = ws.getRow(startRow + 1 + r);
    const highlighted = opts.highlight?.(r) ?? false;
    values.forEach((v, i) => {
      const cell = row.getCell(startCol + i);
      cell.value = v === undefined ? null : typeof v === "boolean" ? (v ? "Sim" : "Não") : v;
      const fmt = cols[i]?.numFmt;
      if (fmt) cell.numFmt = fmt;
      if (highlighted) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: BRAND.highlight } };
      else if (r % 2 === 1) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: BRAND.band } };
      cell.border = { bottom: thin };
    });
  });

  let last = startRow + rows.length;
  if (opts.total) {
    last += 1;
    const row = ws.getRow(last);
    opts.total.forEach((v, i) => {
      const cell = row.getCell(startCol + i);
      cell.value = v === undefined ? null : typeof v === "boolean" ? (v ? "Sim" : "Não") : v;
      const fmt = cols[i]?.numFmt;
      if (fmt) cell.numFmt = fmt;
      cell.font = { bold: true, color: { argb: BRAND.primary } };
      cell.border = { top: { style: "thin", color: { argb: BRAND.primary } } };
    });
  }
  return last;
}

/**
 * Aba de dados: título, contexto, tabela com cabeçalho congelado e autofiltro.
 * `freezeCols` congela as primeiras colunas (placa/frota) além do cabeçalho.
 */
export function dataSheet(
  wb: ExcelJS.Workbook,
  name: string,
  title: string,
  lines: string[],
  cols: XCol[],
  rows: XCell[][],
  opts: { freezeCols?: number; highlight?: (index: number) => boolean; total?: XCell[]; note?: string } = {},
): ExcelJS.Worksheet {
  const ws = wb.addWorksheet(name, { properties: { tabColor: { argb: BRAND.primary } } });
  ws.columns = cols.map((c) => ({ width: c.width ?? Math.min(40, Math.max(12, c.header.length + 4)) }));
  const context = opts.note ? [...lines, opts.note] : lines;
  const headerRow = sheetHeading(ws, title, context);
  const last = writeTable(ws, headerRow, cols, rows, { highlight: opts.highlight, total: opts.total });
  ws.views = [{ state: "frozen", xSplit: opts.freezeCols ?? 0, ySplit: headerRow, showGridLines: false }];
  if (rows.length > 0) {
    ws.autoFilter = { from: { row: headerRow, column: 1 }, to: { row: headerRow + rows.length, column: cols.length } };
  }
  if (rows.length === 0) {
    const c = ws.getCell(last + 1, 1);
    c.value = "Sem linhas para os filtros aplicados.";
    c.font = { italic: true, color: { argb: BRAND.muted } };
  }
  return ws;
}

// ---------------------------------------------------------------------------
// Resposta
// ---------------------------------------------------------------------------
export const XLSX_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export async function xlsxResponse(wb: ExcelJS.Workbook, fileName: string): Promise<Response> {
  const buffer = await wb.xlsx.writeBuffer();
  return new Response(buffer as ArrayBuffer, {
    headers: {
      "Content-Type": XLSX_TYPE,
      "Content-Disposition": `attachment; filename="${fileName}"`,
      "Cache-Control": "no-store",
    },
  });
}
