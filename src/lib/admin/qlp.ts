/**
 * QLP — the corporate people base as it comes out of the source spreadsheet.
 *
 * This module turns a row of that file into the shape the database expects. It
 * is deliberately tolerant: the file is maintained by people, so "-" means
 * empty, dates arrive as Excel serials, real dates or text, and "462 - Auxiliar
 * De Estoque" is two fields glued together.
 *
 * It is equally deliberately strict about one thing: nothing here decides
 * anything about system access. The "Perfil" column is an organizational label
 * and is imported as such.
 */

/** Value as it comes from the file: a cell can be anything. */
export type CellValue = string | number | boolean | Date | null | undefined;

export interface ParseIssue {
  level: "error" | "warning";
  field: string;
  code: string;
  message: string;
}

/** Normalized row, keyed exactly as the database import functions read it. */
export interface NormalizedRow {
  employee_code: string | null;
  full_name: string | null;
  corporate_email: string | null;
  employment_status: string;
  admission_date: string | null;
  cpf: string | null;
  birth_date: string | null;
  job_position_code: string | null;
  job_position_name: string | null;
  employment_area_name: string | null;
  operation_name: string | null;
  business_profile_name: string | null;
  work_location_name: string | null;
  unit_code: string | null;
  unit_name: string | null;
  manager_name: string | null;
  license_category: string | null;
  license_number: string | null;
  license_expiration_date: string | null;
  license_first_date: string | null;
  license_points: number | null;
  parse_errors: ParseIssue[];
}

/* -------------------------------------------------------------------------- */
/* Column recognition                                                         */
/* -------------------------------------------------------------------------- */

/** Canonical fields an import file may carry, with the headers we recognize. */
export const QLP_COLUMNS = [
  { field: "full_name", label: "Nome", aliases: ["nome", "nome completo", "colaborador", "funcionario"] },
  { field: "employee_code", label: "Matrícula", aliases: ["matricula", "matrícula", "registro", "chapa"] },
  { field: "cpf", label: "CPF", aliases: ["cpf", "documento"] },
  { field: "employment_status", label: "Situação", aliases: ["situacao", "situação", "status"] },
  { field: "admission_date", label: "Admissão", aliases: ["admissao", "admissão", "data de admissao", "data de admissão"] },
  { field: "job_position", label: "Cargo", aliases: ["cargo", "funcao", "função"] },
  { field: "employment_area", label: "Área", aliases: ["area", "área"] },
  { field: "operation", label: "Operação", aliases: ["operacao", "operação"] },
  { field: "business_profile", label: "Perfil", aliases: ["perfil", "perfil organizacional"] },
  { field: "work_location", label: "Localidade", aliases: ["localidade", "local", "cidade"] },
  { field: "unit", label: "Filial", aliases: ["filial", "unidade"] },
  { field: "manager_name", label: "Líder Imediato", aliases: ["lider imediato", "líder imediato", "lider", "gestor"] },
  { field: "corporate_email", label: "Email", aliases: ["email", "e-mail", "email corporativo", "e-mail corporativo"] },
  { field: "license_category", label: "CNH tipo", aliases: ["cnh tipo", "tipo cnh", "categoria cnh", "categoria"] },
  { field: "license_number", label: "CNH número", aliases: ["cnh numero", "cnh número", "numero cnh", "registro cnh"] },
  { field: "license_expiration_date", label: "CNH validade", aliases: ["cnh validade", "validade cnh", "validade"] },
  { field: "license_first_date", label: "CNH 1ª habilitação", aliases: ["cnh 1a habilitacao", "cnh 1ª habilitação", "primeira habilitacao", "primeira habilitação"] },
  { field: "license_points", label: "CNH pontuação", aliases: ["cnh pontuacao", "cnh pontuação", "pontuacao", "pontuação", "pontos"] },
  { field: "birth_date", label: "Data de nascimento", aliases: ["data de nascimento", "nascimento", "data nascimento"] },
] as const;

export type QlpField = (typeof QLP_COLUMNS)[number]["field"];

/** The 19 columns of the reference file, in order, for the download template. */
export const QLP_TEMPLATE_HEADERS = QLP_COLUMNS.map((c) => c.label);

const comparable = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

/**
 * Maps the file's headers onto canonical fields. Unrecognized headers are
 * reported rather than guessed at, so the wizard can ask.
 */
export function autoMapColumns(headers: string[]): {
  mapping: Record<number, QlpField>;
  unmapped: { index: number; header: string }[];
  missing: { field: QlpField; label: string }[];
} {
  const mapping: Record<number, QlpField> = {};
  const unmapped: { index: number; header: string }[] = [];
  const used = new Set<QlpField>();

  headers.forEach((header, index) => {
    const key = comparable(String(header ?? ""));
    if (!key) return;
    const column = QLP_COLUMNS.find(
      (c) => (c.aliases as readonly string[]).includes(key) || comparable(c.label) === key,
    );
    if (column && !used.has(column.field)) {
      mapping[index] = column.field;
      used.add(column.field);
    } else {
      unmapped.push({ index, header: String(header ?? "") });
    }
  });

  const required: QlpField[] = ["full_name", "employee_code"];
  const missing = QLP_COLUMNS.filter((c) => required.includes(c.field) && !used.has(c.field)).map((c) => ({
    field: c.field,
    label: c.label,
  }));

  return { mapping, unmapped, missing };
}

/* -------------------------------------------------------------------------- */
/* Value normalization                                                        */
/* -------------------------------------------------------------------------- */

/** "-", "", "N/A" and friends all mean "not informed" in this base. */
const EMPTY_MARKERS = new Set(["", "-", "--", "n/a", "na", "nao informado", "não informado", "sem informacao", "null"]);

export function cleanText(value: CellValue): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return null;
  const text = String(value).replace(/\s+/g, " ").trim();
  if (EMPTY_MARKERS.has(comparable(text))) return null;
  return text || null;
}

/**
 * Excel keeps dates as a day count from 1899-12-30 (the 1900 leap-year bug is
 * baked into that epoch). Serials, real dates and the usual written forms all
 * end up as an ISO date, because that is what PostgreSQL stores.
 */
export function parseDate(value: CellValue): { value: string | null; invalid: boolean } {
  if (value === null || value === undefined) return { value: null, invalid: false };

  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return { value: null, invalid: true };
    return { value: toIsoDate(value), invalid: false };
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value) || value <= 0 || value > 2958465) return { value: null, invalid: true };
    const ms = Math.round((value - 25569) * 86400 * 1000);
    return { value: toIsoDate(new Date(ms)), invalid: false };
  }

  const text = cleanText(value);
  if (!text) return { value: null, invalid: false };

  // ISO first: unambiguous
  const iso = /^(\d{4})-(\d{2})-(\d{2})(?:[T\s].*)?$/.exec(text);
  if (iso) return buildDate(Number(iso[1]), Number(iso[2]), Number(iso[3]));

  // dd/mm/yyyy and dd-mm-yyyy — Brazilian order, never month-first
  const br = /^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})$/.exec(text);
  if (br) {
    const year = Number(br[3]) < 100 ? 2000 + Number(br[3]) : Number(br[3]);
    return buildDate(year, Number(br[2]), Number(br[1]));
  }

  // a serial that arrived as text
  if (/^\d+(\.\d+)?$/.test(text)) return parseDate(Number(text));

  return { value: null, invalid: true };
}

function buildDate(year: number, month: number, day: number): { value: string | null; invalid: boolean } {
  if (month < 1 || month > 12 || day < 1 || day > 31 || year < 1900 || year > 2200) {
    return { value: null, invalid: true };
  }
  const date = new Date(Date.UTC(year, month - 1, day));
  // rejects 31/02 and friends, which Date would silently roll over
  if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return { value: null, invalid: true };
  return { value: toIsoDate(date), invalid: false };
}

function toIsoDate(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

/** "462 - Auxiliar De Estoque" → code 462, name "Auxiliar De Estoque". */
export function splitCodeAndName(value: CellValue): { code: string | null; name: string | null } {
  const text = cleanText(value);
  if (!text) return { code: null, name: null };

  const match = /^([A-Za-z0-9][A-Za-z0-9._-]{0,29})\s*[-–—]\s*(.+)$/.exec(text);
  if (match && match[2].trim()) {
    return { code: match[1].toUpperCase(), name: match[2].trim() };
  }
  return { code: null, name: text };
}

/** CPF as 11 digits. Short values are left-padded: spreadsheets eat leading zeros. */
export function normalizeCpf(value: CellValue): { value: string | null; invalid: boolean } {
  if (value === null || value === undefined) return { value: null, invalid: false };
  const text = cleanText(typeof value === "number" ? String(value) : value);
  if (!text) return { value: null, invalid: false };

  const digits = text.replace(/\D/g, "");
  if (!digits) return { value: null, invalid: false };
  if (digits.length > 11) return { value: null, invalid: true };
  return { value: digits.padStart(11, "0"), invalid: false };
}

/** Check digits, so an invalid document is caught before it reaches the base. */
export function isValidCpf(cpf: string): boolean {
  if (!/^\d{11}$/.test(cpf)) return false;
  if (/^(\d)\1{10}$/.test(cpf)) return false;

  for (let pass = 0; pass < 2; pass++) {
    let sum = 0;
    for (let i = 0; i < 9 + pass; i++) sum += Number(cpf[i]) * (10 + pass - i);
    let check = 11 - (sum % 11);
    if (check >= 10) check = 0;
    if (check !== Number(cpf[9 + pass])) return false;
  }
  return true;
}

export function normalizeEmail(value: CellValue): { value: string | null; invalid: boolean } {
  const text = cleanText(value);
  if (!text) return { value: null, invalid: false };
  const email = text.toLowerCase();
  return { value: email, invalid: !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) };
}

const STATUS_MAP: Record<string, string> = {
  ativo: "active",
  active: "active",
  afastado: "on_leave",
  licenca: "on_leave",
  licença: "on_leave",
  ferias: "on_leave",
  férias: "on_leave",
  desligado: "terminated",
  demitido: "terminated",
  inativo: "inactive",
};

export function normalizeStatus(value: CellValue): string {
  const text = cleanText(value);
  if (!text) return "active";
  return STATUS_MAP[comparable(text)] ?? "active";
}

export function normalizeLicenseCategory(value: CellValue): string | null {
  const text = cleanText(value);
  if (!text) return null;
  const category = text.toUpperCase().replace(/[^A-E]/g, "");
  return category || null;
}

export function normalizeLicenseNumber(value: CellValue): string | null {
  const text = cleanText(typeof value === "number" ? String(value) : value);
  if (!text) return null;
  const digits = text.replace(/\D/g, "");
  if (digits.length < 9 || digits.length > 11) return null;
  return digits;
}

export function normalizePoints(value: CellValue): { value: number | null; invalid: boolean } {
  if (value === null || value === undefined || value === "") return { value: null, invalid: false };
  const text = cleanText(typeof value === "number" ? String(value) : value);
  if (!text) return { value: null, invalid: false };
  const points = Number(text.replace(",", "."));
  if (!Number.isFinite(points) || points < 0 || points > 40) return { value: null, invalid: true };
  return { value: Math.round(points), invalid: false };
}

/* -------------------------------------------------------------------------- */
/* Row normalization                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Turns one file row into the canonical shape, collecting every value it could
 * not make sense of. A bad date is a blocking error; a licence that cannot be
 * read is a warning, because the person still exists without one.
 */
export function normalizeRow(raw: Record<string, CellValue>): NormalizedRow {
  const issues: ParseIssue[] = [];

  const date = (field: string, label: string, value: CellValue, level: ParseIssue["level"] = "error") => {
    const parsed = parseDate(value);
    if (parsed.invalid) {
      issues.push({ level, field, code: "invalid_date", message: `${label}: data não reconhecida ("${String(value)}").` });
    }
    return parsed.value;
  };

  const position = splitCodeAndName(raw.job_position);
  const unit = splitCodeAndName(raw.unit);

  const cpf = normalizeCpf(raw.cpf);
  if (cpf.invalid) {
    issues.push({ level: "error", field: "cpf", code: "invalid_cpf", message: "CPF com formato inválido." });
  } else if (cpf.value && !isValidCpf(cpf.value)) {
    issues.push({ level: "error", field: "cpf", code: "invalid_cpf", message: "CPF inválido (dígitos verificadores)." });
  }

  const email = normalizeEmail(raw.corporate_email);
  if (email.invalid) {
    issues.push({ level: "error", field: "corporate_email", code: "invalid_email", message: "E-mail inválido." });
  }

  const points = normalizePoints(raw.license_points);
  if (points.invalid) {
    issues.push({ level: "warning", field: "license_points", code: "invalid_points", message: "Pontuação de CNH ignorada." });
  }

  const rawCategory = cleanText(raw.license_category);
  const category = normalizeLicenseCategory(raw.license_category);
  if (rawCategory && !category) {
    issues.push({
      level: "warning",
      field: "license_category",
      code: "invalid_license_category",
      message: `Categoria de CNH "${rawCategory}" não reconhecida.`,
    });
  }

  return {
    employee_code: cleanText(raw.employee_code),
    full_name: cleanText(raw.full_name),
    corporate_email: email.invalid ? null : email.value,
    employment_status: normalizeStatus(raw.employment_status),
    admission_date: date("admission_date", "Admissão", raw.admission_date),
    cpf: cpf.invalid ? null : cpf.value,
    birth_date: date("birth_date", "Data de nascimento", raw.birth_date),
    job_position_code: position.code,
    job_position_name: position.name,
    employment_area_name: cleanText(raw.employment_area),
    operation_name: cleanText(raw.operation),
    business_profile_name: cleanText(raw.business_profile),
    work_location_name: cleanText(raw.work_location),
    unit_code: unit.code,
    unit_name: unit.name,
    manager_name: cleanText(raw.manager_name),
    license_category: category,
    license_number: normalizeLicenseNumber(raw.license_number),
    license_expiration_date: date("license_expiration_date", "CNH validade", raw.license_expiration_date, "warning"),
    license_first_date: date("license_first_date", "CNH 1ª habilitação", raw.license_first_date, "warning"),
    license_points: points.value,
    parse_errors: issues,
  };
}

export const EMPLOYMENT_STATUS_LABELS: Record<string, string> = {
  active: "Ativo",
  on_leave: "Afastado",
  terminated: "Desligado",
  inactive: "Inativo",
};

export const ACCESS_STATUS_LABELS: Record<string, string> = {
  none: "Sem acesso",
  invited: "Convite pendente",
  active: "Ativo",
  suspended: "Suspenso",
  removed: "Removido",
};
