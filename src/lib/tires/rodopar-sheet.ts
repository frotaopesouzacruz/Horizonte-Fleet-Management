import type { Cell, Workbook, Worksheet } from "exceljs";

/**
 * Leitor do relatório Rodopar 10 (pneus) — roda no navegador.
 *
 * Só LÊ: acha o cabeçalho, identifica a janela oficial de colunas que começa
 * em "N.Fogo" (até "Desenho"/"Borracha") e devolve as células como vieram.
 * Colunas calculadas fora da janela (à esquerda de N.Fogo) são ignoradas e
 * listadas; cabeçalhos desconhecidos dentro da janela também são listados,
 * nunca inventados. Tipagem, limites técnicos, situação canônica, frota,
 * comparação com os dados anteriores e tudo o mais é decidido no banco
 * (`tire_import_*`) — nada daqui é confiado.
 *
 * Regras de fidelidade:
 *   * Nº Fogo e demais identificadores seguem como TEXTO (zeros à esquerda e
 *     números longos preservados; um número inteiro do Excel vira "79653").
 *   * Datas seguem na hora "de parede" da célula (AAAA-MM-DDTHH:MM:SS).
 *   * Número gravado com formato de data num campo numérico (ex.: PSI 70
 *     exibido como 10/03/1900) volta ao número de origem (serial do Excel) e
 *     ganha a marca `<campo>:date_serial` — o banco registra a inconsistência.
 *   * O bruto de cada coluna reconhecida vai junto, com o cabeçalho original.
 *
 * Este módulo não importa nada do app (só tipos): o mesmo código roda no teste
 * de paridade com o emulador usado nos testes do banco.
 */

export const RODOPAR_LAYOUT_VERSION = "rodopar10_v1";
export const RODOPAR_HEADER_SCAN_ROWS = 30;
export const RODOPAR_CHUNK_ROWS = 300;

/** Campo técnico → cabeçalhos aceitos (normalizados: sem acento, minúsculo, só letras e dígitos). */
export const RODOPAR_ALIASES: Record<string, string[]> = {
  fire_number: ["nfogo", "numerofogo", "numeronfogo", "numfogo", "numerodefogo", "ndefogo"],
  tire_branch: ["filialpneu", "filialdopneu"],
  unit_code: ["codunidade", "codigounidade", "cdunidade"],
  cost_code: ["codcusto", "codigocusto", "cdcusto", "centrodecusto", "centrocusto"],
  purchase_date: ["datacompra", "datadecompra", "dtcompra"],
  status_raw: ["situacaopneu", "situacaodopneu", "situacao"],
  fleet_number: ["nfrota", "numerofrota", "numeronfrota", "numfrota", "ndefrota", "frota"],
  fleet_branch: ["filialfrota", "filialdafrota"],
  brand: ["marca", "marcapneu"],
  model: ["modelopneu", "modelodopneu"],
  dimension: ["dimensao", "medida", "medidapneu"],
  position: ["posicao", "posicaopneu"],
  tread_min: ["menormilimetragem", "menormm", "menorsulco"],
  tread_1: ["sulco1", "mmatua", "mmataua", "milimetragem1", "mm1"],
  tread_2: ["sulco2", "mmatua2", "mmataua2", "milimetragem2", "mm2"],
  tread_3: ["sulco3", "mmatua3", "mmataua3", "milimetragem3", "mm3"],
  tread_4: ["sulco4", "mmatua4", "mmataua4", "milimetragem4", "mm4"],
  measurement_at: ["dtmedicao", "datamedicao", "dataultimamedicao", "datadamedicao"],
  psi: ["calibragem", "pressao", "psi"],
  calibration_at: ["dtcalibragem", "datacalibragem", "dataultimacalibragem"],
  km_rodado: ["kmrodado", "kmrodadopneu"],
  km_real: ["kmreal"],
  dot: ["dot"],
  life: ["nvida", "numerovida", "numeronvida", "numvida", "ndevida", "vida"],
  condition: ["condicao"],
  classification: ["classificacao"],
  status_label: ["status", "statuspneu"],
  registration_at: ["datacadastro", "datadecadastro", "dtcadastro"],
  serial_number: ["numerodeserie", "numeroserie", "nserie", "numserie", "serie"],
  created_by_user: ["usuariodeinclusao", "usuarioinclusao", "usuariocadastro"],
  updated_by_user: ["usuarioultimaalteracao", "usuarioalteracao"],
  updated_at: ["dataultimaalteracao", "dataalteracao", "dtultimaalteracao"],
  drawing: ["desenho", "desenhopneu"],
  rubber: ["borracha"],
};

/** Colunas que precisam existir para o lote poder ser confirmado (o banco confere de novo). */
export const RODOPAR_REQUIRED_COLUMNS = [
  "fire_number", "status_raw", "fleet_number", "position", "tread_1", "tread_2", "tread_3", "tread_4",
  "measurement_at", "psi", "calibration_at", "life",
] as const;

/** Rótulo de cada campo técnico, para a prévia. */
export const RODOPAR_FIELD_LABEL: Record<string, string> = {
  fire_number: "N.Fogo", tire_branch: "Filial pneu", unit_code: "Cód. unidade", cost_code: "Cód. custo",
  purchase_date: "Data compra", status_raw: "Situação pneu", fleet_number: "N.Frota", fleet_branch: "Filial frota",
  brand: "Marca", model: "Modelo pneu", dimension: "Dimensão", position: "Posição", tread_min: "Menor milimetragem",
  tread_1: "Sulco 1", tread_2: "Sulco 2", tread_3: "Sulco 3", tread_4: "Sulco 4", measurement_at: "Dt. medição",
  psi: "Calibragem", calibration_at: "Dt. calibragem", km_rodado: "KM rodado", km_real: "KM real", dot: "DOT",
  life: "N.Vida", condition: "Condição", classification: "Classificação", status_label: "Status",
  registration_at: "Data cadastro", serial_number: "Número de série", created_by_user: "Usuário de inclusão",
  updated_by_user: "Usuário última alteração", updated_at: "Data última alteração", drawing: "Desenho", rubber: "Borracha",
};

const DATE_KEYS = new Set(["purchase_date", "measurement_at", "calibration_at", "registration_at", "updated_at"]);
const NUM_KEYS = new Set(["tread_min", "tread_1", "tread_2", "tread_3", "tread_4", "psi", "km_rodado", "km_real", "life"]);
const LOOKUP: Record<string, string> = Object.fromEntries(
  Object.entries(RODOPAR_ALIASES).flatMap(([key, aliases]) => aliases.map((a) => [a, key])),
);
const EXCEL_EPOCH_MS = Date.UTC(1899, 11, 30);

export type RodoparCell = string | number | boolean | null;

export interface RodoparRow {
  row_number: number;
  cells: Record<string, RodoparCell>;
  raw: Record<string, RodoparCell>;
  flags: string[];
}

export interface RodoparMeta {
  file_name: string;
  file_hash: string;
  file_size: number;
  sheet_name: string;
  header_row: number;
  layout_version: string;
  window_start: string;
  window_end: string;
  recognized_columns: string[];
  unrecognized_columns: string[];
  ignored_columns: string[];
  suggested_reference_date: string | null;
  total_rows: number;
}

export interface RodoparRead {
  meta: RodoparMeta;
  rows: RodoparRow[];
  missingRequired: string[];
}

export type RodoparReadResult = { ok: true; data: RodoparRead } | { ok: false; error: string };

/** Cabeçalho normalizado: sem acento, minúsculo, só letras e dígitos. */
export function rodoparHeaderKey(value: unknown): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

/** O valor por trás de uma célula do ExcelJS (resultado de fórmula, texto rico, hyperlink). */
function scalar(cell: Cell): unknown {
  const value = cell.value as unknown;
  if (value === null || value === undefined) return null;
  if (value instanceof Date || typeof value !== "object") return value;
  const rec = value as Record<string, unknown>;
  if ("result" in rec) return rec.result instanceof Date || typeof rec.result !== "object" ? (rec.result ?? null) : null;
  if ("formula" in rec || "sharedFormula" in rec) return null;
  if ("richText" in rec && Array.isArray(rec.richText)) {
    return (rec.richText as { text?: string }[]).map((t) => t.text ?? "").join("");
  }
  if ("text" in rec) return String(rec.text ?? "");
  if ("error" in rec) return String(rec.error ?? "");
  return String(value);
}

const pad = (n: number) => String(n).padStart(2, "0");
/** Hora "de parede" da célula (o ExcelJS a guarda nos campos UTC do Date). */
function wallClock(d: Date): string {
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
}
/** Data com segundos arredondados (o Excel guarda frações de dia; evita 14:29:59.999). */
function roundToSecond(d: Date): Date {
  return new Date(Math.round(d.getTime() / 1000) * 1000);
}

function headerText(value: unknown): string {
  return value === null || value === undefined ? "" : String(value);
}

function columnCount(sheet: Worksheet, rowNumber: number): number {
  return Math.max(sheet.columnCount, sheet.getRow(rowNumber).cellCount);
}

interface HeaderMatch {
  sheet: Worksheet;
  row: number;
  columns: Record<string, number>;
  start: number;
  end: number;
  unrecognized: string[];
  ignored: string[];
}

function detect(sheet: Worksheet): HeaderMatch | null {
  let best: HeaderMatch | null = null;
  const limit = Math.min(RODOPAR_HEADER_SCAN_ROWS, sheet.rowCount);
  for (let r = 1; r <= limit; r++) {
    const width = columnCount(sheet, r);
    const values: unknown[] = [];
    for (let c = 1; c <= width; c++) values.push(scalar(sheet.getRow(r).getCell(c)));
    const heads = values.map(rodoparHeaderKey);
    const start = heads.findIndex((h) => RODOPAR_ALIASES.fire_number.includes(h));
    if (start < 0) continue;
    const columns: Record<string, number> = {};
    const unrecognized: string[] = [];
    let end = start;
    for (let i = start; i < heads.length; i++) {
      const key = LOOKUP[heads[i]];
      if (key && !(key in columns)) {
        columns[key] = i;
        end = i;
      } else if (heads[i]) {
        unrecognized.push(headerText(values[i]));
      }
    }
    const ignored = values.slice(0, start).filter((v) => v !== null && v !== undefined && v !== "").map(headerText);
    if (!best || Object.keys(columns).length > Object.keys(best.columns).length) {
      best = { sheet, row: r, columns, start, end, unrecognized, ignored };
    }
  }
  return best;
}

/**
 * Lê a pasta de trabalho inteira e devolve as linhas do Rodopar 10 prontas
 * para o staging. A primeira aba que tiver o cabeçalho com N.Fogo é usada.
 */
export function readRodoparWorkbook(
  workbook: Workbook,
  file: { fileName: string; fileSize: number; fileHash: string },
): RodoparReadResult {
  let match: HeaderMatch | null = null;
  for (const sheet of workbook.worksheets) {
    match = detect(sheet);
    if (match) break;
  }
  if (!match) {
    return {
      ok: false,
      error:
        "Não encontramos o cabeçalho do relatório Rodopar 10: nenhuma coluna \"N.Fogo\" nas primeiras linhas de nenhuma aba. Exporte o relatório Rodopar 10 (pneus) e envie o arquivo original.",
    };
  }

  const { sheet, row: headerRow, columns } = match;
  const headerOf = (index: number) => headerText(scalar(sheet.getRow(headerRow).getCell(index + 1))).replace(/\n/g, " ");
  const rows: RodoparRow[] = [];
  let maxUpdated: Date | null = null;

  for (let r = headerRow + 1; r <= sheet.rowCount; r++) {
    const row = sheet.getRow(r);
    const width = columnCount(sheet, r);
    let blank = true;
    for (let c = 1; c <= width; c++) {
      const v = scalar(row.getCell(c));
      if (v !== null && v !== undefined && v !== "") {
        blank = false;
        break;
      }
    }
    if (blank) continue;

    const cells: Record<string, RodoparCell> = {};
    const raw: Record<string, RodoparCell> = {};
    const flags: string[] = [];
    for (const [key, index] of Object.entries(columns)) {
      let v = scalar(row.getCell(index + 1));
      if (v instanceof Date) v = roundToSecond(v);
      raw[headerOf(index)] = v instanceof Date ? wallClock(v) : (v as RodoparCell);
      if (v === null || v === undefined) {
        cells[key] = null;
        continue;
      }
      if (v instanceof Date) {
        if (NUM_KEYS.has(key)) {
          const serial = (v.getTime() - EXCEL_EPOCH_MS) / 86_400_000;
          cells[key] = Math.round(serial * 1e6) / 1e6;
          flags.push(`${key}:date_serial`);
        } else {
          cells[key] = wallClock(v);
          if (key === "updated_at" && (!maxUpdated || v > maxUpdated)) maxUpdated = v;
        }
      } else if (NUM_KEYS.has(key)) {
        cells[key] = v as RodoparCell;
      } else if (typeof v === "number" && Number.isInteger(v)) {
        cells[key] = String(v);
      } else {
        cells[key] = String(v);
      }
    }
    rows.push({ row_number: r, cells, raw, flags });
  }

  const recognized = Object.keys(columns).sort();
  const meta: RodoparMeta = {
    file_name: file.fileName,
    file_hash: file.fileHash,
    file_size: file.fileSize,
    sheet_name: sheet.name,
    header_row: headerRow,
    layout_version: RODOPAR_LAYOUT_VERSION,
    window_start: headerText(scalar(sheet.getRow(headerRow).getCell(match.start + 1))),
    window_end: headerOf(match.end),
    recognized_columns: recognized,
    unrecognized_columns: match.unrecognized,
    ignored_columns: match.ignored,
    suggested_reference_date: maxUpdated ? wallClock(maxUpdated).slice(0, 10) : null,
    total_rows: rows.length,
  };
  const missingRequired = RODOPAR_REQUIRED_COLUMNS.filter((k) => !recognized.includes(k));
  return { ok: true, data: { meta, rows, missingRequired } };
}

/** Datas ISO "de parede" usadas como chave (para o cartão "data sugerida"). */
export const isDateKey = (key: string) => DATE_KEYS.has(key);
