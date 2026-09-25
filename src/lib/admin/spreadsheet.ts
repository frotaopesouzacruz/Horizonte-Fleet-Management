import "server-only";

import { PassThrough, Readable } from "node:stream";
import ExcelJS from "exceljs";

/**
 * Os arquivos que o HFM entrega: XLSX e CSV.
 *
 * Exportação não tem teto de linhas, então o arquivo sai em fluxo — linha a
 * linha para a resposta, sem montar a planilha inteira na memória. A leitura
 * de planilhas (importação) mora em `@/lib/import/sheet-core`, e acontece no
 * navegador.
 */

export type ExportCell = string | number | null;
export type ExportFormat = "xlsx" | "csv";

const CONTENT_TYPE: Record<ExportFormat, string> = {
  csv: "text/csv; charset=utf-8",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

/** Largura de cada coluna pelo conteúdo mais longo, entre 12 e 46 caracteres. */
function columnWidths(headers: string[], rows: ExportCell[][]): number[] {
  const widths = headers.map((header) => header.length);
  for (const row of rows) {
    for (let i = 0; i < widths.length; i++) {
      const length = row[i] == null ? 0 : String(row[i]).length;
      if (length > widths[i]) widths[i] = length;
    }
  }
  return widths.map((longest) => Math.min(46, Math.max(12, longest + 2)));
}

const yieldToLoop = () => new Promise<void>((resolve) => setImmediate(resolve));

/** XLSX em fluxo: cabeçalho em negrito e congelado, uma linha por vez. */
function xlsxStream(sheetName: string, headers: string[], rows: ExportCell[][]): ReadableStream<Uint8Array> {
  const output = new PassThrough();
  const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({ stream: output, useStyles: true, useSharedStrings: false });
  workbook.creator = "Horizonte Fleet Management";
  workbook.created = new Date();

  const sheet = workbook.addWorksheet(sheetName, { views: [{ state: "frozen", ySplit: 1 }] });
  sheet.columns = columnWidths(headers, rows).map((width) => ({ width }));

  void (async () => {
    const header = sheet.addRow(headers);
    header.font = { bold: true };
    header.alignment = { vertical: "middle" };
    header.commit();
    for (let i = 0; i < rows.length; i++) {
      sheet.addRow(rows[i]).commit();
      if (i % 2000 === 1999) await yieldToLoop();
    }
    sheet.commit();
    await workbook.commit();
  })().catch((error: unknown) => output.destroy(error instanceof Error ? error : new Error(String(error))));

  return Readable.toWeb(output) as unknown as ReadableStream<Uint8Array>;
}

/** CSV com BOM, para o Excel em pt-BR abrir acentos corretamente; separador ";". */
function csvStream(headers: string[], rows: ExportCell[][]): ReadableStream<Uint8Array> {
  const escape = (value: ExportCell) => {
    const text = value === null || value === undefined ? "" : String(value);
    return /[";\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  const line = (row: ExportCell[]) => row.map(escape).join(";");
  const encoder = new TextEncoder();
  let next = -1;

  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (next === -1) {
        controller.enqueue(encoder.encode(`﻿${line(headers)}`));
        next = 0;
        return;
      }
      if (next >= rows.length) {
        controller.close();
        return;
      }
      const end = Math.min(rows.length, next + 1000);
      let chunk = "";
      for (; next < end; next++) chunk += `\r\n${line(rows[next])}`;
      controller.enqueue(encoder.encode(chunk));
    },
  });
}

/** A planilha pronta para download, em fluxo. */
export function spreadsheetResponse(options: {
  format: ExportFormat;
  fileName: string;
  sheetName: string;
  headers: string[];
  rows: ExportCell[][];
}): Response {
  const { format, fileName, sheetName, headers, rows } = options;
  const body = format === "csv" ? csvStream(headers, rows) : xlsxStream(sheetName, headers, rows);
  return new Response(body, {
    headers: {
      "Content-Type": CONTENT_TYPE[format],
      "Content-Disposition": `attachment; filename="${fileName}"`,
      "Cache-Control": "no-store",
    },
  });
}
