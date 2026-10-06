import ExcelJS from "exceljs";
import { RODOPAR_FIELD_LABEL } from "../../src/lib/tires/rodopar-sheet";

/**
 * Monta um XLSX no layout oficial (N.Fogo … Borracha) a partir de linhas no
 * formato `cells` do staging — o mesmo arquivo que viria do SharePoint.
 * Datas viram datas do Excel (o leitor usa a hora "de parede").
 */
const DATE_KEYS = new Set(["purchase_date", "measurement_at", "calibration_at", "registration_at", "updated_at"]);
const KEYS = Object.keys(RODOPAR_FIELD_LABEL);

export type Cells = Record<string, string | number | null>;

const toDate = (v: string) => {
  const m = v.match(/^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2}))?)?/);
  return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] ?? 0), +(m[5] ?? 0), +(m[6] ?? 0))) : v;
};

export async function buildRodoparXlsx(rows: Cells[], opts: { drop?: string[]; extraColumn?: string } = {}): Promise<ArrayBuffer> {
  const keys = KEYS.filter((k) => !(opts.drop ?? []).includes(k));
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Pneus");
  ws.addRow(["Relatório Rodopar 10 — Pneus"]);
  ws.addRow([...keys.map((k) => RODOPAR_FIELD_LABEL[k]), ...(opts.extraColumn ? [opts.extraColumn] : [])]);
  for (const r of rows) {
    ws.addRow([
      ...keys.map((k) => {
        const v = r[k];
        if (v === null || v === undefined) return null;
        return DATE_KEYS.has(k) && typeof v === "string" ? toDate(v) : v;
      }),
      ...(opts.extraColumn ? ["x"] : []),
    ]);
  }
  const buf = await wb.xlsx.writeBuffer();
  return (buf as Buffer).buffer.slice((buf as Buffer).byteOffset, (buf as Buffer).byteOffset + (buf as Buffer).byteLength) as ArrayBuffer;
}
