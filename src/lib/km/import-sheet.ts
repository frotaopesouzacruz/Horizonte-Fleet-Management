import type { Cell, Workbook, Worksheet } from "exceljs";
import { toCellValue } from "@/lib/import/sheet-core";

/**
 * Leitor da fonte oficial da Gestão de KM: Base Geral KM Rodado.xlsx, aba
 * EXATA "Controle KM Rodado".
 *
 * Roda no navegador (o arquivo não passa pelo corpo de uma requisição) com a
 * mesma biblioteca das outras importações (ExcelJS, carregada sob demanda).
 * Só lê: encontra a aba pelo nome, acha a linha do cabeçalho, mapeia as
 * colunas e entrega os valores finais de cada linha com o número REAL da
 * linha na planilha. Nenhuma regra de KM mora aqui — classificação, status,
 * duplicidade e comparação são do banco (`stage_km_import`).
 *
 * Nunca escolhe outra aba por semelhança de colunas: sem a aba oficial, a
 * importação é bloqueada e as abas encontradas são listadas.
 */

export const KM_SHEET_NAME = "Controle KM Rodado";
export const KM_SOURCE_FILE = "Base Geral KM Rodado.xlsx";
const KM_SHEET_KEY = "controle km rodado";
/** Quantas linhas do topo da aba são examinadas à procura do cabeçalho. */
export const KM_HEADER_SCAN_ROWS = 40;
/** Linhas por envio ao banco (a primeira parte cria o lote). */
export const KM_CHUNK_ROWS = 2000;

export type KmSheetField = "ref" | "plate" | "fleet" | "type" | "model" | "date" | "start" | "end" | "km";

export interface KmSheetColumnSpec {
  field: KmSheetField;
  label: string;
  required: boolean;
  /** Nomes aceitos no cabeçalho, já normalizados (sem acento, minúsculas). */
  aliases: string[];
  hint: string;
}

/** Colunas esperadas da aba Controle KM Rodado, na ordem da planilha. */
export const KM_SHEET_COLUMNS: KmSheetColumnSpec[] = [
  {
    field: "ref",
    label: "Ref Pesquisa",
    required: false,
    aliases: ["ref pesquisa", "ref", "referencia pesquisa", "referencia"],
    hint: "Chave de conferência da planilha (data + placa). Guardada como referência da linha.",
  },
  { field: "plate", label: "Placa", required: true, aliases: ["placa"], hint: "Identifica o veículo no Cadastro de Frotas." },
  {
    field: "fleet",
    label: "Frota",
    required: false,
    aliases: ["frota", "codigo frota", "cod frota"],
    hint: "Só comparada com o cadastro (divergência cadastral). Não altera o Cadastro de Frotas.",
  },
  {
    field: "type",
    label: "Tipo",
    required: false,
    aliases: ["tipo", "tipo de equipamento", "tipo equipamento"],
    hint: "Só comparado com o cadastro. Não altera o Cadastro de Frotas.",
  },
  {
    field: "model",
    label: "Modelo",
    required: false,
    aliases: ["modelo"],
    hint: "Só comparado com o cadastro (subcategoria ou modelo). Não altera o Cadastro de Frotas.",
  },
  { field: "date", label: "Data", required: true, aliases: ["data", "data leitura", "data da leitura"], hint: "Dia da leitura." },
  {
    field: "start",
    label: "Hodômetro Inicial",
    required: true,
    aliases: ["hodometro inicial", "hodometro inicio", "hodometro de inicial", "hodometro de inicio", "hod inicial"],
    hint: "Hodômetro no início do dia.",
  },
  {
    field: "end",
    label: "Hodômetro Fim",
    required: true,
    aliases: ["hodometro fim", "hodometro final", "hodometro de fim", "hodometro de final", "hod fim", "hod final"],
    hint: "Hodômetro no fim do dia (aceita também Hodômetro Final).",
  },
  {
    field: "km",
    label: "KM Percorrido",
    required: false,
    aliases: ["km percorrido", "km percorridos", "km rodado", "km rodados"],
    hint: "KM informado pela planilha. Guardado como informado; vale o calculado pelos hodômetros.",
  },
];

/** Valor de uma célula como vai ao banco: número JSON, texto ou vazio. */
export type KmSheetValue = string | number | null;

export type KmSheetRow = { row_number: number } & { [K in KmSheetField]?: KmSheetValue };

export interface KmSheetMappedColumn {
  field: KmSheetField;
  label: string;
  header: string;
  /** Coluna da planilha (1 = A). */
  column: number;
}

export interface KmSheetRead {
  fileName: string;
  fileSize: number;
  fileHash: string;
  sheetName: string;
  sheetNames: string[];
  headerRow: number;
  columns: KmSheetMappedColumn[];
  /** Colunas opcionais que não estão na aba (seguem vazias). */
  missingOptional: KmSheetField[];
  rows: KmSheetRow[];
  /** Primeira e última linha de dados (número real na planilha). */
  firstRowNumber: number | null;
  lastRowNumber: number | null;
}

export type KmSheetResult =
  | { ok: true; data: KmSheetRead }
  | { ok: false; error: string; sheetNames?: string[] };

/** Minúsculas, sem acento, espaços colapsados — o mesmo critério do banco (`maintenance_norm`). */
export function normalizeSheetName(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** Cabeçalho normalizado: como o nome da aba e, além disso, pontuação vira espaço. */
export function normalizeHeader(value: unknown): string {
  if (value === null || value === undefined) return "";
  return normalizeSheetName(String(value).replace(/[^\p{L}\p{N}]+/gu, " "));
}

/** A aba oficial, pelo nome exato (normalizado). Nunca por semelhança de colunas. */
export function findKmWorksheet(workbook: Workbook): Worksheet | null {
  return workbook.worksheets.find((w) => normalizeSheetName(w.name) === KM_SHEET_KEY) ?? null;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** Data do Excel → aaaa-mm-dd, sem fuso (o ExcelJS cria datas em UTC). */
function isoFromDate(d: Date): string | null {
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/** Número serial do Excel (dias desde 1899-12-30) → aaaa-mm-dd. */
function isoFromSerial(serial: number): string | null {
  if (!Number.isFinite(serial) || serial < 1 || serial > 2958465) return null;
  return isoFromDate(new Date(Date.UTC(1899, 11, 30) + Math.floor(serial) * 86_400_000));
}

function textValue(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text === "" ? null : text;
}

/** Converte a célula conforme o campo: data → ISO, número → número JSON, o resto → texto. */
function fieldValue(field: KmSheetField, raw: unknown): KmSheetValue {
  const value = toCellValue(raw);
  if (value === null || value === undefined) return null;
  if (field === "date") {
    if (value instanceof Date) return isoFromDate(value) ?? null;
    if (typeof value === "number") return isoFromSerial(value) ?? String(value);
    return textValue(value);
  }
  if (field === "start" || field === "end" || field === "km") {
    if (typeof value === "number") return Number.isFinite(value) ? value : null;
    if (value instanceof Date) return isoFromDate(value);
    // Texto segue como texto: o banco lê o padrão brasileiro ("57.629,6").
    return textValue(value);
  }
  if (value instanceof Date) return isoFromDate(value);
  return textValue(value);
}

interface HeaderMatch {
  row: number;
  columns: KmSheetMappedColumn[];
}

/**
 * A linha de cabeçalho: entre as primeiras 40, a que tem Placa, Data e
 * alguma coluna de Hodômetro. As colunas são casadas pelo nome normalizado
 * (sem acento, caixa ou espaços extras); a primeira da esquerda vence.
 */
export function detectKmHeader(sheet: Worksheet): HeaderMatch | null {
  const limit = Math.min(KM_HEADER_SCAN_ROWS, Math.max(sheet.rowCount, 0));
  for (let r = 1; r <= limit; r++) {
    const row = sheet.getRow(r);
    const cells: { column: number; header: string; key: string }[] = [];
    row.eachCell({ includeEmpty: false }, (cell, column) => {
      const header = String(toCellValue(cell.value) ?? "").trim();
      const key = normalizeHeader(header);
      if (key) cells.push({ column, header, key });
    });
    const has = (pred: (k: string) => boolean) => cells.some((c) => pred(c.key));
    if (!has((k) => k === "placa") || !has((k) => k === "data") || !has((k) => k.startsWith("hodometro"))) continue;

    const columns: KmSheetMappedColumn[] = [];
    const used = new Set<number>();
    for (const spec of KM_SHEET_COLUMNS) {
      const hit = cells.find((c) => !used.has(c.column) && spec.aliases.includes(c.key));
      if (hit) {
        used.add(hit.column);
        columns.push({ field: spec.field, label: spec.label, header: hit.header, column: hit.column });
      }
    }
    return { row: r, columns };
  }
  return null;
}

/**
 * O valor final da célula. Numa fórmula vale o resultado gravado no arquivo
 * (o banco não recria fórmulas): o ExcelJS omite `result` do valor quando o
 * resultado é 0, por isso ele é lido de `cell.result`.
 */
function cellRaw(cell: Cell): unknown {
  const value = cell.value;
  if (value && typeof value === "object" && !(value instanceof Date) && ("formula" in value || "sharedFormula" in value)) {
    const result = (value as { result?: unknown }).result ?? (cell as { result?: unknown }).result;
    return result === undefined ? null : result;
  }
  return value;
}

/** Linhas de dados da aba: valores finais, número real da linha, vazias ignoradas. */
export function readKmRows(sheet: Worksheet, header: HeaderMatch): KmSheetRow[] {
  const rows: KmSheetRow[] = [];
  sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber <= header.row) return;
    const out: KmSheetRow = { row_number: rowNumber };
    let filled = false;
    for (const c of header.columns) {
      const v = fieldValue(c.field, cellRaw(row.getCell(c.column)));
      out[c.field] = v;
      if (v !== null) filled = true;
    }
    if (filled) rows.push(out);
  });
  return rows;
}

export async function sha256Hex(buffer: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** A leitura a partir de uma pasta já aberta (separada para poder ser testada fora do navegador). */
export function readKmWorkbook(
  workbook: Workbook,
  file: { fileName: string; fileSize: number; fileHash: string },
): KmSheetResult {
  const sheetNames = workbook.worksheets.map((w) => w.name);
  const sheet = findKmWorksheet(workbook);
  if (!sheet) {
    return { ok: false, error: "A aba Controle KM Rodado não foi localizada.", sheetNames };
  }
  const header = detectKmHeader(sheet);
  if (!header) {
    return {
      ok: false,
      error: `O cabeçalho da aba ${sheet.name} não foi encontrado nas primeiras ${KM_HEADER_SCAN_ROWS} linhas (esperado: Placa, Data, Hodômetro Inicial e Hodômetro Fim).`,
      sheetNames,
    };
  }
  const missingRequired = KM_SHEET_COLUMNS.filter(
    (spec) => spec.required && !header.columns.some((c) => c.field === spec.field),
  );
  if (missingRequired.length) {
    return {
      ok: false,
      error: `Colunas obrigatórias não encontradas na linha ${header.row} da aba ${sheet.name}: ${missingRequired
        .map((s) => s.label)
        .join(", ")}.`,
      sheetNames,
    };
  }
  const rows = readKmRows(sheet, header);
  if (!rows.length) {
    return { ok: false, error: "A aba Controle KM Rodado não possui linhas de dados.", sheetNames };
  }
  return {
    ok: true,
    data: {
      ...file,
      sheetName: sheet.name,
      sheetNames,
      headerRow: header.row,
      columns: header.columns,
      missingOptional: KM_SHEET_COLUMNS.filter((s) => !s.required && !header.columns.some((c) => c.field === s.field)).map(
        (s) => s.field,
      ),
      rows,
      firstRowNumber: rows[0]?.row_number ?? null,
      lastRowNumber: rows[rows.length - 1]?.row_number ?? null,
    },
  };
}

type TableEntryLoader = (stream: unknown, model: { tables: Record<string, unknown> }, name: string) => Promise<void>;

/**
 * A Base Geral KM Rodado tem tabelas do Excel cujo filtro automático aponta
 * colunas que a tabela não declara; o ExcelJS 4.4 para a leitura inteira por
 * isso ("Cannot set properties of undefined (setting 'filterButton')"). As
 * tabelas não importam para a leitura dos valores: quando uma não puder ser
 * lida, fica no lugar um registro vazio e as células seguem intactas.
 */
function tolerateBrokenTables(workbook: Workbook) {
  const xlsx = workbook.xlsx as unknown as { _processTableEntry?: TableEntryLoader };
  const original = xlsx._processTableEntry;
  if (typeof original !== "function") return;
  xlsx._processTableEntry = async (stream, model, name) => {
    try {
      await original.call(xlsx, stream, model, name);
    } catch {
      model.tables[`../tables/${name}.xml`] = { name: `hfm_${name}`, displayName: `hfm_${name}`, columns: [] };
    }
  };
}

/** Abre um ArrayBuffer XLSX com o ExcelJS (sob demanda) e lê a aba oficial. */
export async function readKmBuffer(buffer: ArrayBuffer, file: { fileName: string; fileSize: number }): Promise<KmSheetResult> {
  let workbook: Workbook;
  try {
    const ExcelJS = (await import("exceljs")).default;
    workbook = new ExcelJS.Workbook();
    tolerateBrokenTables(workbook);
    await workbook.xlsx.load(buffer);
  } catch {
    return { ok: false, error: "Não foi possível abrir o arquivo. Verifique se é um XLSX válido (Base Geral KM Rodado.xlsx)." };
  }
  const fileHash = await sha256Hex(buffer);
  return readKmWorkbook(workbook, { ...file, fileHash });
}

/** Leitura no navegador: tamanho, SHA-256 do arquivo e a aba Controle KM Rodado. */
export async function readKmImportFile(file: File): Promise<KmSheetResult> {
  if (file.size === 0) return { ok: false, error: "O arquivo está vazio." };
  if (!/\.(xlsx|xlsm)$/i.test(file.name)) {
    return { ok: false, error: "Formato não suportado. Envie a planilha em XLSX (Base Geral KM Rodado.xlsx)." };
  }
  let buffer: ArrayBuffer;
  try {
    buffer = await file.arrayBuffer();
  } catch {
    return { ok: false, error: "Não foi possível ler o arquivo." };
  }
  return readKmBuffer(buffer, { fileName: file.name, fileSize: file.size });
}

/** Partes de até `size` linhas, na ordem da planilha. */
export function chunkKmRows(rows: KmSheetRow[], size = KM_CHUNK_ROWS): KmSheetRow[][] {
  const out: KmSheetRow[][] = [];
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
  return out;
}
