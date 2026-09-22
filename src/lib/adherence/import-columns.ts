/**
 * Colunas aceitas na importação de aderência (§54). Sem `"use server"` de
 * propósito: a tela usa a mesma lista para explicar o formato, e a action
 * usa para mapear os cabeçalhos — uma lista, dois leitores.
 */
export type ImportField =
  | "fleet_code" | "license_plate" | "operational_date" | "context" | "status" | "justification" | "evidence_reference";

export interface ImportColumn {
  field: ImportField;
  label: string;
  required: boolean;
  aliases: string[];
  hint: string;
}

export const IMPORT_COLUMNS: ImportColumn[] = [
  { field: "fleet_code", label: "Frota", required: false, hint: "código da frota (ou informe a placa)",
    aliases: ["frota", "codigo", "codigo da frota", "cod frota", "cod", "fleet", "fleet code", "veiculo"] },
  { field: "license_plate", label: "Placa", required: false, hint: "placa do veículo (ou informe a frota)",
    aliases: ["placa", "plate", "license plate"] },
  { field: "operational_date", label: "Data", required: true, hint: "dia operacional (dd/mm/aaaa ou aaaa-mm-dd)",
    aliases: ["data", "data operacional", "dia", "date", "operational date", "competencia"] },
  { field: "context", label: "Contexto", required: false, hint: "saída ou retorno; vazio = saída",
    aliases: ["contexto", "tipo", "tipo de checklist", "context", "saida retorno", "momento"] },
  { field: "status", label: "Status", required: true, hint: "Sem rota, Manutenção, Reserva, Em viagem, Frota não ativa, Outros, Fez, Não fez",
    aliases: ["status", "situacao", "status diario", "resultado", "checklist", "aderencia"] },
  { field: "justification", label: "Justificativa", required: false, hint: "texto livre; entra na solicitação",
    aliases: ["justificativa", "observacao", "observacoes", "motivo", "obs", "descricao"] },
  { field: "evidence_reference", label: "Evidência", required: false, hint: "OS, chamado ou documento; obrigatória em Manutenção, Fez e Outros",
    aliases: ["evidencia", "os", "chamado", "referencia", "documento", "comprovante"] },
];

export const ACCEPTED_STATUSES = [
  "Sem rota", "Manutenção", "Reserva", "Em viagem", "Frota não ativa", "Outros", "Fez (execução comprovada)", "Não fez",
];

export function normalizeHeader(header: string): string {
  return header
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export interface ColumnMapping {
  mapping: Record<number, ImportField>;
  mapped: { header: string; field: ImportField; label: string }[];
  unmapped: string[];
  missing: string[];
}

export function mapImportColumns(headers: string[]): ColumnMapping {
  const mapping: Record<number, ImportField> = {};
  const taken = new Set<ImportField>();
  const mapped: ColumnMapping["mapped"] = [];
  const unmapped: string[] = [];

  headers.forEach((header, index) => {
    const key = normalizeHeader(header ?? "");
    if (!key) return;
    const column =
      IMPORT_COLUMNS.find((c) => !taken.has(c.field) && c.aliases.includes(key)) ??
      IMPORT_COLUMNS.find((c) => !taken.has(c.field) && c.aliases.some((a) => key.startsWith(a)));
    if (column) {
      mapping[index] = column.field;
      taken.add(column.field);
      mapped.push({ header, field: column.field, label: column.label });
    } else {
      unmapped.push(header);
    }
  });

  const missing: string[] = [];
  if (!taken.has("fleet_code") && !taken.has("license_plate")) missing.push("Frota ou Placa");
  if (!taken.has("operational_date")) missing.push("Data");
  if (!taken.has("status")) missing.push("Status");
  return { mapping, mapped, unmapped, missing };
}

/** Datas chegam como Date (XLSX), número de série do Excel ou texto. Tudo vira aaaa-mm-dd; o que não der, vai como está e o banco recusa. */
export function toIsoDate(value: unknown): string | null {
  if (value == null || value === "") return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, "0")}-${String(value.getUTCDate()).padStart(2, "0")}`;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    const base = Date.UTC(1899, 11, 30);
    return toIsoDate(new Date(base + Math.round(value) * 86_400_000));
  }
  const text = String(value).trim();
  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const br = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (br) {
    const year = br[3].length === 2 ? `20${br[3]}` : br[3];
    return `${year}-${br[2].padStart(2, "0")}-${br[1].padStart(2, "0")}`;
  }
  return text;
}

export function cellToText(value: unknown): string | null {
  if (value == null) return null;
  if (value instanceof Date) return toIsoDate(value);
  if (typeof value === "boolean") return value ? "sim" : "não";
  const text = String(value).trim();
  return text === "" ? null : text;
}
