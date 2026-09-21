/**
 * The fleet spreadsheet as it arrives.
 *
 * Column recognition and value normalization for the fleet import. It mirrors
 * the QLP module's contract on purpose — same `autoMapColumns` / `normalizeRow`
 * shape — so the staging pipeline built in Etapa 03 works unchanged and there
 * is no second import framework (§49).
 *
 * The generic cell helpers are imported rather than copied: "-", "N/A" and an
 * empty string mean the same thing in any spreadsheet a person maintains.
 */

import { cleanText, type CellValue, type ParseIssue } from "@/lib/admin/qlp";

export type { CellValue, ParseIssue };

/** Normalized row, keyed exactly as validate_vehicle_import reads it. */
export interface NormalizedVehicleRow {
  fleet_code: string | null;
  license_plate: string | null;
  vin: string | null;
  renavam: string | null;
  type_name: string | null;
  subcategory_name: string | null;
  make_name: string | null;
  model_name: string | null;
  ownership_type: string | null;
  status: string | null;
  asset_value: number | null;
  odometer_km: number | null;
  antt_code: string | null;
  has_tachograph: boolean | null;
  tachograph_number: string | null;
  operation_name: string | null;
  state_uf: string | null;
  city_name: string | null;
  unit_name: string | null;
  cost_center_name: string | null;
  manufacture_year: number | null;
  model_year: number | null;
  notes: string | null;
  parse_errors: ParseIssue[];
}

/* -------------------------------------------------------------------------- */
/* Column recognition                                                         */
/* -------------------------------------------------------------------------- */

export const FLEET_COLUMNS = [
  { field: "fleet_code", label: "Frota", aliases: ["frota", "codigo da frota", "código da frota", "cod frota", "numero da frota"] },
  { field: "license_plate", label: "Placa", aliases: ["placa", "placa do veiculo", "placa do veículo"] },
  { field: "type_name", label: "Tipo de Equipamento", aliases: ["tipo", "tipo de equipamento", "tipo de veiculo", "tipo de veículo", "equipamento"] },
  { field: "subcategory_name", label: "Subcategoria", aliases: ["subcategoria", "carroceria", "sub categoria", "tipo de carroceria"] },
  { field: "make_name", label: "Marca", aliases: ["marca", "fabricante"] },
  { field: "model_name", label: "Modelo", aliases: ["modelo"] },
  { field: "ownership_type", label: "Titularidade", aliases: ["titularidade", "propriedade", "proprietario", "proprietário", "posse"] },
  { field: "odometer_km", label: "KM", aliases: ["km", "km atual", "quilometragem", "hodometro", "hodômetro", "odometro", "odômetro"] },
  { field: "asset_value", label: "Valor do Ativo", aliases: ["valor do ativo", "valor", "valor patrimonial", "valor r$"] },
  { field: "status", label: "Status", aliases: ["status", "situacao", "situação", "situacao cadastral", "situação cadastral"] },
  { field: "vin", label: "Chassi", aliases: ["chassi", "chassis", "vin", "n chassi"] },
  { field: "renavam", label: "RENAVAM", aliases: ["renavam", "renavan"] },
  { field: "antt_code", label: "ANTT", aliases: ["antt", "rntrc", "antt/rntrc", "registro antt"] },
  { field: "has_tachograph", label: "Possui Tacógrafo", aliases: ["possui tacografo", "possui tacógrafo", "tacografo", "tacógrafo", "tem tacografo"] },
  { field: "tachograph_number", label: "Número do Tacógrafo", aliases: ["numero do tacografo", "número do tacógrafo", "n tacografo", "tacografo numero"] },
  { field: "operation_name", label: "Operação", aliases: ["operacao", "operação", "base", "base operacional"] },
  { field: "state_uf", label: "Estado", aliases: ["estado", "uf", "sigla do estado"] },
  { field: "city_name", label: "Cidade", aliases: ["cidade", "municipio", "município", "localidade"] },
  { field: "unit_name", label: "Filial", aliases: ["filial", "unidade", "unidade organizacional"] },
  { field: "cost_center_name", label: "Centro de Custo", aliases: ["centro de custo", "centro custo", "cc"] },
  { field: "manufacture_year", label: "Ano de Fabricação", aliases: ["ano de fabricacao", "ano de fabricação", "ano fabricacao", "ano fab"] },
  { field: "model_year", label: "Ano do Modelo", aliases: ["ano do modelo", "ano modelo", "ano mod"] },
  { field: "notes", label: "Observações", aliases: ["observacoes", "observações", "obs", "observacao", "observação"] },
] as const;

export type FleetField = (typeof FLEET_COLUMNS)[number]["field"];

/** Headers of the downloadable import template, in order. */
export const FLEET_TEMPLATE_HEADERS = FLEET_COLUMNS.map((c) => c.label);

const comparable = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

export function autoMapColumns(headers: string[]): {
  mapping: Record<number, FleetField>;
  unmapped: { index: number; header: string }[];
  missing: { field: FleetField; label: string }[];
} {
  const mapping: Record<number, FleetField> = {};
  const unmapped: { index: number; header: string }[] = [];
  const used = new Set<FleetField>();

  headers.forEach((header, index) => {
    const key = comparable(String(header ?? ""));
    if (!key) return;
    const column = FLEET_COLUMNS.find(
      (c) => (c.aliases as readonly string[]).includes(key) || comparable(c.label) === key,
    );
    if (column && !used.has(column.field)) {
      mapping[index] = column.field;
      used.add(column.field);
    } else {
      unmapped.push({ index, header: String(header ?? "") });
    }
  });

  // Only the two identity columns are required: §51 is explicit that the extra
  // structural fields must not be demanded for a minimally valid record.
  const required: FleetField[] = ["fleet_code", "license_plate"];
  const missing = FLEET_COLUMNS.filter((c) => required.includes(c.field) && !used.has(c.field)).map((c) => ({
    field: c.field,
    label: c.label,
  }));

  return { mapping, unmapped, missing };
}

/* -------------------------------------------------------------------------- */
/* Value normalization                                                        */
/* -------------------------------------------------------------------------- */

/**
 * "1.234,56", "1234,56" and "1234.56" are the same amount typed by three
 * different people. Whichever separator comes last is the decimal one; when
 * there is only one and it is a dot, it stays a dot. Stripping dots
 * indiscriminately is how "1234.56" silently becomes 123456 (§58).
 */
export function parseDecimal(raw: CellValue): { value: number | null; ambiguous: boolean } {
  if (raw === null || raw === undefined) return { value: null, ambiguous: false };
  if (typeof raw === "number") return { value: Number.isFinite(raw) ? raw : null, ambiguous: false };
  if (raw instanceof Date) return { value: null, ambiguous: false };

  const text = String(raw).replace(/[R$\s ]/g, "");
  if (!text) return { value: null, ambiguous: false };

  const hasComma = text.includes(",");
  const hasDot = text.includes(".");
  let normalized: string;
  let ambiguous = false;

  if (hasComma && hasDot) {
    normalized =
      text.lastIndexOf(",") > text.lastIndexOf(".")
        ? text.replace(/\./g, "").replace(",", ".")
        : text.replace(/,/g, "");
  } else if (hasComma) {
    normalized = text.replace(",", ".");
  } else if (hasDot) {
    // A single dot with exactly three digits after it — "1.234" — is a
    // thousands separator in pt-BR and a decimal in en-US. The value is kept
    // as written and the row is flagged rather than guessed at.
    const [, fraction = ""] = text.split(".");
    ambiguous = fraction.length === 3;
    normalized = text;
  } else {
    normalized = text;
  }

  const value = Number(normalized);
  return Number.isFinite(value) ? { value, ambiguous } : { value: null, ambiguous: false };
}

function parseInteger(raw: CellValue): number | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "number") return Number.isFinite(raw) ? Math.trunc(raw) : null;
  const digits = String(raw).replace(/[^\d-]/g, "");
  if (!digits) return null;
  const value = Number(digits);
  return Number.isFinite(value) ? Math.trunc(value) : null;
}

const OWNERSHIP_MAP: Record<string, string> = {
  proprio: "owned",
  próprio: "owned",
  propria: "owned",
  own: "owned",
  owned: "owned",
  alugado: "rented",
  alugada: "rented",
  locado: "rented",
  locacao: "rented",
  aluguel: "rented",
  rented: "rented",
  leased: "leased",
  arrendado: "leased",
};

const STATUS_MAP: Record<string, string> = {
  ativo: "active",
  ativa: "active",
  active: "active",
  inativo: "inactive",
  inativa: "inactive",
  inactive: "inactive",
  arquivado: "inactive",
  baixado: "inactive",
  // "Desativado" é como a frota do Grupo Horizonte escreve. Sem isto a situação
  // vinha como desconhecida e o veículo entrava ativo — o oposto do que a
  // planilha dizia, com um aviso fácil de perder no meio de noventa linhas.
  desativado: "inactive",
  desativada: "inactive",
};

const TRUE_MARKERS = new Set(["sim", "s", "true", "1", "yes", "y", "possui", "x"]);
const FALSE_MARKERS = new Set(["nao", "não", "n", "false", "0", "no", "nao possui", "não possui"]);

function parseBoolean(raw: CellValue): boolean | null {
  const text = cleanText(raw);
  if (!text) return null;
  const key = comparable(text);
  if (TRUE_MARKERS.has(key)) return true;
  if (FALSE_MARKERS.has(key)) return false;
  return null;
}

function parseYear(raw: CellValue): { value: number | null; invalid: boolean } {
  const value = parseInteger(raw);
  if (value === null) return { value: null, invalid: false };
  const currentYear = new Date().getFullYear();
  if (value < 1900 || value > currentYear + 2) return { value: null, invalid: true };
  return { value, invalid: false };
}

export function normalizeVehicleRow(raw: Record<string, CellValue>): NormalizedVehicleRow {
  const issues: ParseIssue[] = [];

  const plateText = cleanText(raw.license_plate);
  const plate = plateText ? plateText.toUpperCase().replace(/[^A-Z0-9]/g, "") : null;

  const vinText = cleanText(raw.vin);
  const vin = vinText ? vinText.toUpperCase().replace(/[^A-Z0-9]/g, "") : null;

  const renavamText = cleanText(raw.renavam);
  let renavam = renavamText ? renavamText.replace(/\D/g, "") : null;
  if (renavam && renavam.length >= 9 && renavam.length <= 10) renavam = renavam.padStart(11, "0");

  const asset = parseDecimal(raw.asset_value);
  if (asset.ambiguous) {
    issues.push({
      level: "warning",
      field: "asset_value",
      code: "ambiguous_decimal",
      message: `O valor "${String(raw.asset_value)}" pode ser milhar ou decimal. Confirme antes de importar.`,
    });
  }
  if (asset.value !== null && asset.value < 0) {
    issues.push({
      level: "error",
      field: "asset_value",
      code: "negative",
      message: "O valor do ativo não pode ser negativo.",
    });
  }

  const odometer = parseInteger(raw.odometer_km);
  if (odometer !== null && odometer < 0) {
    issues.push({
      level: "error",
      field: "odometer_km",
      code: "negative",
      message: "A quilometragem não pode ser negativa.",
    });
  }

  const ownershipText = cleanText(raw.ownership_type);
  const ownership = ownershipText ? (OWNERSHIP_MAP[comparable(ownershipText)] ?? null) : null;
  if (ownershipText && !ownership) {
    issues.push({
      level: "warning",
      field: "ownership_type",
      code: "unknown",
      message: `Titularidade "${ownershipText}" não reconhecida. Será mantida a titularidade atual ou "Próprio".`,
    });
  }

  const statusText = cleanText(raw.status);
  const status = statusText ? (STATUS_MAP[comparable(statusText)] ?? null) : null;
  if (statusText && !status) {
    issues.push({
      level: "warning",
      field: "status",
      code: "unknown",
      message: `Situação "${statusText}" não reconhecida. A situação cadastral não será alterada.`,
    });
  }

  const manufactureYear = parseYear(raw.manufacture_year);
  if (manufactureYear.invalid) {
    issues.push({
      level: "warning",
      field: "manufacture_year",
      code: "range",
      message: `Ano de fabricação "${String(raw.manufacture_year)}" fora de um intervalo plausível e ignorado.`,
    });
  }
  const modelYear = parseYear(raw.model_year);
  if (modelYear.invalid) {
    issues.push({
      level: "warning",
      field: "model_year",
      code: "range",
      message: `Ano do modelo "${String(raw.model_year)}" fora de um intervalo plausível e ignorado.`,
    });
  }

  const tachograph = parseBoolean(raw.has_tachograph);
  const tachographNumber = cleanText(raw.tachograph_number);
  if (tachographNumber && tachograph === false) {
    issues.push({
      level: "warning",
      field: "tachograph_number",
      code: "inconsistent",
      message: "Há número de tacógrafo mas a coluna indica que o veículo não possui um.",
    });
  }

  const stateText = cleanText(raw.state_uf);
  const stateUf = stateText ? stateText.toUpperCase().slice(0, 2) : null;

  return {
    fleet_code: cleanText(raw.fleet_code),
    license_plate: plate,
    vin,
    renavam,
    type_name: cleanText(raw.type_name),
    subcategory_name: cleanText(raw.subcategory_name),
    make_name: cleanText(raw.make_name),
    model_name: cleanText(raw.model_name),
    ownership_type: ownership,
    status,
    asset_value: asset.value,
    odometer_km: odometer,
    antt_code: cleanText(raw.antt_code)?.replace(/\D/g, "") || null,
    // `tachograph_number` implies the vehicle has one; the check constraint in
    // the database says the same thing, so the two never disagree.
    has_tachograph: tachograph ?? (tachographNumber ? true : null),
    tachograph_number: tachographNumber,
    operation_name: cleanText(raw.operation_name),
    state_uf: stateUf,
    city_name: cleanText(raw.city_name),
    unit_name: cleanText(raw.unit_name),
    cost_center_name: cleanText(raw.cost_center_name),
    manufacture_year: manufactureYear.value,
    model_year: modelYear.value,
    notes: cleanText(raw.notes),
    parse_errors: issues,
  };
}

/* -------------------------------------------------------------------------- */
/* Presentation labels                                                        */
/* -------------------------------------------------------------------------- */

export const OWNERSHIP_LABELS: Record<string, string> = {
  owned: "Próprio",
  rented: "Alugado",
  leased: "Arrendado",
};

export const VEHICLE_STATUS_LABELS: Record<string, string> = {
  active: "Ativo",
  inactive: "Inativo",
};

export const ODOMETER_SOURCE_LABELS: Record<string, string> = {
  initial_registration: "Cadastro inicial",
  manual_correction: "Correção manual",
  import: "Importação",
  checklist: "Checklist",
  fueling: "Abastecimento",
  maintenance: "Manutenção",
  telemetry: "Telemetria",
};
