import "server-only";

import ExcelJS from "exceljs";
import type { CellValue } from "./qlp";

export interface SheetData {
  sheetName: string;
  headers: string[];
  rows: CellValue[][];
}

/** Cell values come out of ExcelJS as rich objects; this is the scalar behind them. */
function toCellValue(value: unknown): CellValue {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;

  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    if ("text" in record) return String(record.text ?? "");
    if ("result" in record) return toCellValue(record.result); // formula
    if ("richText" in record && Array.isArray(record.richText)) {
      return record.richText.map((part) => String((part as { text?: string }).text ?? "")).join("");
    }
    if ("hyperlink" in record) return String(record.text ?? record.hyperlink ?? "");
  }
  return String(value);
}

/**
 * Reads the first non-empty sheet of an XLSX workbook, or a CSV file.
 *
 * Only the header row and the data rows are taken: formatting, formulas and
 * merged cells are the file's business, not ours.
 */
export async function parseSpreadsheet(buffer: ArrayBuffer, fileName: string): Promise<SheetData> {
  if (/\.csv$/i.test(fileName)) return parseCsv(Buffer.from(buffer).toString("utf8"));

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);

  const sheet =
    workbook.worksheets.find((w) => w.name.toUpperCase() === "QLP") ??
    workbook.worksheets.find((w) => w.actualRowCount > 1) ??
    workbook.worksheets[0];

  if (!sheet) throw new Error("A planilha não contém nenhuma aba com dados.");

  const headerRow = sheet.getRow(1);
  const headers: string[] = [];
  headerRow.eachCell({ includeEmpty: true }, (cell, index) => {
    headers[index - 1] = String(toCellValue(cell.value) ?? "").trim();
  });

  const rows: CellValue[][] = [];
  sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1) return;
    const values: CellValue[] = [];
    for (let i = 1; i <= headers.length; i++) values[i - 1] = toCellValue(row.getCell(i).value);
    if (values.some((v) => v !== null && v !== undefined && String(v).trim() !== "")) rows.push(values);
  });

  return { sheetName: sheet.name, headers, rows };
}

/** RFC 4180-ish: quoted fields, doubled quotes, comma or semicolon separated. */
function parseCsv(text: string): SheetData {
  const content = text.replace(/^﻿/, "");
  const firstLine = content.slice(0, content.indexOf("\n") + 1 || content.length);
  const delimiter = (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? ";" : ",";

  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  for (let i = 0; i < content.length; i++) {
    const char = content[i];

    if (quoted) {
      if (char === '"') {
        if (content[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') quoted = true;
    else if (char === delimiter) {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (char !== "\r") {
      field += char;
    }
  }
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }

  const headers = (rows.shift() ?? []).map((h) => h.trim());
  const data = rows
    .filter((r) => r.some((value) => value.trim() !== ""))
    .map((r) => headers.map((_, index) => (r[index] ?? "").trim() as CellValue));

  return { sheetName: "CSV", headers, rows: data };
}

/** Builds an XLSX workbook in memory. Used by the exports and the template. */
export async function buildWorkbook(
  sheetName: string,
  headers: string[],
  rows: (string | number | null)[][],
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Horizonte Fleet Management";
  workbook.created = new Date();

  const sheet = workbook.addWorksheet(sheetName);
  sheet.addRow(headers);
  sheet.getRow(1).font = { bold: true };
  sheet.getRow(1).alignment = { vertical: "middle" };
  for (const row of rows) sheet.addRow(row);

  sheet.columns.forEach((column, index) => {
    const header = headers[index] ?? "";
    const longest = rows.reduce((max, row) => Math.max(max, String(row[index] ?? "").length), header.length);
    column.width = Math.min(46, Math.max(12, longest + 2));
  });
  sheet.views = [{ state: "frozen", ySplit: 1 }];

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

/** CSV with a BOM, so Excel in pt-BR opens accented text correctly. */
export function buildCsv(headers: string[], rows: (string | number | null)[][]): Buffer {
  const escape = (value: string | number | null) => {
    const text = value === null || value === undefined ? "" : String(value);
    return /[";\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };

  const lines = [headers.map(escape).join(";"), ...rows.map((row) => row.map(escape).join(";"))];
  return Buffer.from(`﻿${lines.join("\r\n")}`, "utf8");
}
