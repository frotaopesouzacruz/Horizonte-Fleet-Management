import type { Cell, Workbook, Worksheet } from "exceljs";
import { toCellValue } from "@/lib/import/sheet-core";

/**
 * Leitor da planilha de conformidade MTSR (importação histórica).
 *
 * Roda no navegador com a mesma biblioteca das outras importações (ExcelJS,
 * carregada sob demanda). Só lê: acha a linha do cabeçalho, mapeia as colunas
 * fixas (Placa, Frota, Última vistoria, Observação) e reconhece uma coluna por
 * componente do catálogo (nome, código ou apelido). Os valores dos componentes
 * seguem como texto: quem decide OK/NOK/sem informação, placa conhecida, data
 * válida e prioridade de fonte é o banco (`stage_mtsr_import`).
 */
export const MTSR_SHEET_NAME = "Conformidade";
export const MTSR_TEMPLATE_FILE = "modelo-conformidade-mtsr.xlsx";
export const MTSR_HEADER_SCAN_ROWS = 20;
export const MTSR_CHUNK_ROWS = 500;

export type MtsrFixedField = "license_plate" | "fleet_code" | "last_inspection_date" | "observation";

export interface MtsrFixedColumnSpec {
  field: MtsrFixedField;
  label: string;
  required: boolean;
  aliases: string[];
  hint: string;
}

export const MTSR_FIXED_COLUMNS: MtsrFixedColumnSpec[] = [
  { field: "license_plate", label: "Placa", required: true, aliases: ["placa", "placa do veiculo", "veiculo"], hint: "Identifica o veículo no Cadastro de Frotas. A importação nunca cria veículo." },
  { field: "fleet_code", label: "Frota", required: false, aliases: ["frota", "codigo frota", "cod frota", "numero frota"], hint: "Usada só quando a placa está vazia." },
  { field: "last_inspection_date", label: "Última vistoria", required: false, aliases: ["ultima vistoria", "data ultima vistoria", "data da ultima vistoria", "ultima verificacao", "data"], hint: "Data da última vistoria válida (dd/mm/aaaa). Nunca retrocede a data já registrada." },
  { field: "observation", label: "Observação", required: false, aliases: ["observacao", "observacoes", "obs"], hint: "Texto livre guardado com cada leitura." },
];

/** Componente conhecido pelo leitor: nome, código e apelidos normalizados. */
export interface MtsrSheetComponentSpec {
  id: string;
  code: string;
  name: string;
  keys: string[];
}

export interface MtsrMappedColumn {
  kind: "fixed" | "component";
  field: string;
  label: string;
  header: string;
  column: number;
}

export type MtsrSheetRow = {
  row_number: number;
  license_plate?: string | null;
  fleet_code?: string | null;
  last_inspection_date?: string | null;
  observation?: string | null;
  components: Record<string, string>;
  raw: Record<string, string | number | boolean | null>;
};

export interface MtsrSheetRead {
  fileName: string;
  fileSize: number;
  fileHash: string;
  sheetName: string;
  sheetNames: string[];
  headerRow: number;
  columns: MtsrMappedColumn[];
  unknownHeaders: string[];
  componentsFound: string[];
  rows: MtsrSheetRow[];
}

export type MtsrSheetResult = { ok: true; data: MtsrSheetRead } | { ok: false; error: string; sheetNames?: string[] };

export function normalizeKey(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const pad = (n: number) => String(n).padStart(2, "0");
function isoFromDate(d: Date): string | null {
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}
function isoFromSerial(serial: number): string | null {
  if (!Number.isFinite(serial) || serial < 1 || serial > 2958465) return null;
  return isoFromDate(new Date(Date.UTC(1899, 11, 30) + Math.floor(serial) * 86_400_000));
}
/** "dd/mm/aaaa" ou "aaaa-mm-dd" → ISO; outro texto segue como veio (o banco recusa com motivo). */
function isoFromText(text: string): string {
  const br = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (br) return `${br[3]}-${pad(Number(br[2]))}-${pad(Number(br[1]))}`;
  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  return text;
}

function cellRaw(cell: Cell): unknown {
  const value = cell.value;
  if (value && typeof value === "object" && !(value instanceof Date) && ("formula" in value || "sharedFormula" in value)) {
    const result = (value as { result?: unknown }).result ?? (cell as { result?: unknown }).result;
    return result === undefined ? null : result;
  }
  if (value && typeof value === "object" && "richText" in (value as object)) {
    return (value as { richText: { text: string }[] }).richText.map((t) => t.text).join("");
  }
  return value;
}

function textOf(raw: unknown): string | null {
  const v = toCellValue(raw);
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return isoFromDate(v);
  const t = String(v).trim();
  return t === "" ? null : t;
}

function dateOf(raw: unknown): string | null {
  const v = toCellValue(raw);
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return isoFromDate(v);
  if (typeof v === "number") return isoFromSerial(v) ?? String(v);
  const t = String(v).trim();
  return t === "" ? null : isoFromText(t);
}

interface HeaderMatch {
  row: number;
  columns: MtsrMappedColumn[];
  unknownHeaders: string[];
}

export function detectHeader(sheet: Worksheet, components: MtsrSheetComponentSpec[]): HeaderMatch | null {
  const limit = Math.min(MTSR_HEADER_SCAN_ROWS, Math.max(sheet.rowCount, 0));
  for (let r = 1; r <= limit; r++) {
    const row = sheet.getRow(r);
    const cells: { column: number; header: string; key: string }[] = [];
    row.eachCell({ includeEmpty: false }, (cell, column) => {
      const header = String(toCellValue(cellRaw(cell)) ?? "").trim();
      const key = normalizeKey(header);
      if (key) cells.push({ column, header, key });
    });
    if (!cells.some((c) => MTSR_FIXED_COLUMNS[0].aliases.includes(c.key))) continue;
    const columns: MtsrMappedColumn[] = [];
    const unknown: string[] = [];
    for (const c of cells) {
      const fixed = MTSR_FIXED_COLUMNS.find((s) => s.aliases.includes(c.key) && !columns.some((m) => m.field === s.field));
      if (fixed) {
        columns.push({ kind: "fixed", field: fixed.field, label: fixed.label, header: c.header, column: c.column });
        continue;
      }
      const comp = components.find((x) => x.keys.includes(c.key) && !columns.some((m) => m.field === x.code));
      if (comp) {
        columns.push({ kind: "component", field: comp.code, label: comp.name, header: c.header, column: c.column });
        continue;
      }
      unknown.push(c.header);
    }
    return { row: r, columns, unknownHeaders: unknown };
  }
  return null;
}

export function readRows(sheet: Worksheet, header: HeaderMatch): MtsrSheetRow[] {
  const rows: MtsrSheetRow[] = [];
  sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber <= header.row) return;
    const out: MtsrSheetRow = { row_number: rowNumber, components: {}, raw: {} };
    let filled = false;
    for (const c of header.columns) {
      const raw = cellRaw(row.getCell(c.column));
      if (c.kind === "fixed") {
        const v = c.field === "last_inspection_date" ? dateOf(raw) : textOf(raw);
        (out as Record<string, unknown>)[c.field] = v;
        if (v !== null) {
          filled = true;
          out.raw[c.header] = v;
        }
      } else {
        const v = textOf(raw);
        if (v !== null) {
          out.components[c.field] = v.slice(0, 60);
          out.raw[c.header] = v;
          filled = true;
        }
      }
    }
    if (filled) rows.push(out);
  });
  return rows;
}

export async function sha256Hex(buffer: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

export function readMtsrWorkbook(
  workbook: Workbook,
  file: { fileName: string; fileSize: number; fileHash: string },
  components: MtsrSheetComponentSpec[],
): MtsrSheetResult {
  const sheetNames = workbook.worksheets.map((w) => w.name);
  const sheet =
    workbook.worksheets.find((w) => normalizeKey(w.name) === normalizeKey(MTSR_SHEET_NAME)) ??
    workbook.worksheets.find((w) => detectHeader(w, components)) ??
    null;
  if (!sheet) return { ok: false, error: "Nenhuma aba com a coluna Placa foi encontrada.", sheetNames };
  const header = detectHeader(sheet, components);
  if (!header) {
    return { ok: false, error: `O cabeçalho (coluna Placa) não foi encontrado nas primeiras ${MTSR_HEADER_SCAN_ROWS} linhas da aba ${sheet.name}.`, sheetNames };
  }
  const comps = header.columns.filter((c) => c.kind === "component");
  const hasDate = header.columns.some((c) => c.field === "last_inspection_date");
  if (!comps.length && !hasDate) {
    return { ok: false, error: "A planilha não tem nenhuma coluna de componente MTSR nem a data da última vistoria. Use a planilha modelo.", sheetNames };
  }
  const rows = readRows(sheet, header);
  if (!rows.length) return { ok: false, error: `A aba ${sheet.name} não possui linhas de dados.`, sheetNames };
  return {
    ok: true,
    data: {
      ...file,
      sheetName: sheet.name,
      sheetNames,
      headerRow: header.row,
      columns: header.columns,
      unknownHeaders: header.unknownHeaders,
      componentsFound: comps.map((c) => c.label),
      rows,
    },
  };
}

export async function readMtsrImportFile(file: File, components: MtsrSheetComponentSpec[]): Promise<MtsrSheetResult> {
  const name = file.name.toLowerCase();
  if (!name.endsWith(".xlsx") && !name.endsWith(".xlsm")) {
    return { ok: false, error: "Envie a planilha em XLSX (use a planilha modelo)." };
  }
  const buffer = await file.arrayBuffer();
  const ExcelJS = (await import("exceljs")).default;
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(buffer);
  } catch {
    return { ok: false, error: "Não foi possível ler o arquivo. Confira se é um XLSX válido." };
  }
  return readMtsrWorkbook(workbook, { fileName: file.name, fileSize: file.size, fileHash: await sha256Hex(buffer) }, components);
}

export function chunkRows<T>(rows: T[], size = MTSR_CHUNK_ROWS): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
  return out;
}

/** Catálogo → chaves que o leitor reconhece no cabeçalho. */
export function componentSpecs(components: { id: string; code: string; name: string; aliases?: string[] | null }[]): MtsrSheetComponentSpec[] {
  return components.map((c) => ({
    id: c.id,
    code: c.code,
    name: c.name,
    keys: [...new Set([normalizeKey(c.code), normalizeKey(c.name), ...(c.aliases ?? []).map(normalizeKey)].filter(Boolean))],
  }));
}
