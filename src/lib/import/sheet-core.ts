import type { Workbook } from "exceljs";
import type { CellValue } from "@/lib/admin/qlp";

/**
 * A leitura da planilha, igual no servidor e no navegador.
 *
 * As importações leem o arquivo no navegador (sem limite de tamanho do corpo
 * de uma requisição) e mandam as linhas ao servidor em partes; o modelo e os
 * testes ainda leem no servidor. As duas pontas usam estas mesmas funções,
 * para que um arquivo seja entendido do mesmo jeito onde quer que seja lido.
 */

export interface SheetData {
  sheetName: string;
  headers: string[];
  rows: CellValue[][];
}

/** Cell values come out of ExcelJS as rich objects; this is the scalar behind them. */
export function toCellValue(value: unknown): CellValue {
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
 * The first non-empty sheet of an XLSX workbook (QLP first, when present).
 *
 * Only the header row and the data rows are taken: formatting, formulas and
 * merged cells are the file's business, not ours.
 */
export function readWorkbookSheet(workbook: Workbook): SheetData {
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
export function parseCsv(text: string): SheetData {
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

/** The raw cells of one row, keyed by header, as `import_rows.raw_data` keeps them. */
export function rawRow(headers: string[], values: CellValue[]): Record<string, string | number | boolean | null> {
  const raw: Record<string, string | number | boolean | null> = {};
  headers.forEach((header, columnIndex) => {
    const value = values[columnIndex] ?? null;
    raw[header || `col_${columnIndex + 1}`] = value instanceof Date ? value.toISOString() : value;
  });
  return raw;
}
