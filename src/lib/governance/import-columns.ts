/**
 * Colunas aceitas nas importações da Fidelização (Etapa 13, §56 e §57).
 *
 * Sem `"use server"` de propósito: a gaveta usa as mesmas listas para explicar
 * o formato e oferecer o modelo, e a action usa para mapear os cabeçalhos —
 * uma lista, dois leitores. Os utilitários de data, texto e cabeçalho vêm da
 * importação de aderência, que já resolveu Excel, ISO e dd/mm/aaaa.
 */
import { cellToText, normalizeHeader, toIsoDate } from "@/lib/adherence/import-columns";

export { cellToText, toIsoDate };

export type ImportKind = "brs" | "allocations";

export type BrImportField =
  | "operation" | "state" | "city" | "code" | "description" | "status" | "notes";

export type AllocationImportField =
  | "operation" | "state" | "city" | "br_code" | "fleet_code" | "license_plate"
  | "start_date" | "end_date" | "vehicle_role" | "status" | "reason";

export interface ImportColumn<F extends string> {
  field: F;
  label: string;
  required: boolean;
  aliases: string[];
  hint: string;
}

/** §56 — cadastro de BRs. */
export const BR_IMPORT_COLUMNS: ImportColumn<BrImportField>[] = [
  { field: "operation", label: "Operação", required: true, hint: "nome ou código da operação (ex.: Last Mille MG ou OP-00004)",
    aliases: ["operacao", "operation", "tipo de operacao", "cod operacao", "codigo da operacao"] },
  { field: "state", label: "Estado", required: false, hint: "UF (ex.: MG); só é obrigatória se a cidade se repetir na cobertura",
    aliases: ["estado", "uf", "state"] },
  { field: "city", label: "Cidade", required: true, hint: "cidade da cobertura da operação",
    aliases: ["cidade", "municipio", "city", "local", "local de operacao"] },
  { field: "code", label: "Código BR", required: true, hint: "identidade da posição (ex.: BR0024052)",
    aliases: ["codigo br", "br", "codigo", "codigo da br", "br code", "cod br", "posicao"] },
  { field: "description", label: "Descrição", required: false, hint: "texto livre; vazio não apaga a descrição existente",
    aliases: ["descricao", "description", "nome", "rota"] },
  { field: "status", label: "Situação", required: false, hint: "Ativo ou Inativo; não altera a situação de uma BR existente",
    aliases: ["situacao", "status", "ativo"] },
  { field: "notes", label: "Observações", required: false, hint: "texto livre",
    aliases: ["observacoes", "observacao", "obs", "notes", "notas"] },
];

/** §57 — planejamento de veículos por BR. */
export const ALLOCATION_IMPORT_COLUMNS: ImportColumn<AllocationImportField>[] = [
  { field: "br_code", label: "Código BR", required: true, hint: "BR oficial; com operação e cidade quando o código se repetir",
    aliases: ["codigo br", "br", "codigo", "codigo da br", "br code", "cod br", "posicao", "br oficial"] },
  { field: "operation", label: "Operação", required: false, hint: "restringe a busca da BR",
    aliases: ["operacao", "operation", "tipo de operacao"] },
  { field: "state", label: "Estado", required: false, hint: "UF; restringe a busca da BR",
    aliases: ["estado", "uf", "state"] },
  { field: "city", label: "Cidade", required: false, hint: "restringe a busca da BR",
    aliases: ["cidade", "municipio", "city", "local", "local de operacao"] },
  { field: "fleet_code", label: "Frota", required: false, hint: "código da frota (ou informe a placa)",
    aliases: ["frota", "codigo da frota", "cod frota", "fleet", "fleet code", "veiculo"] },
  { field: "license_plate", label: "Placa", required: false, hint: "placa do veículo (ou informe a frota)",
    aliases: ["placa", "plate", "license plate"] },
  { field: "start_date", label: "Data inicial", required: true, hint: "dd/mm/aaaa ou aaaa-mm-dd",
    aliases: ["data inicial", "inicio", "data de inicio", "start", "start date", "de", "data inicio"] },
  { field: "end_date", label: "Data final", required: false, hint: "vazio herda o fim do vínculo substituído, ou fica em aberto",
    aliases: ["data final", "fim", "data de fim", "end", "end date", "ate", "data fim", "termino"] },
  { field: "vehicle_role", label: "Tipo de alocação", required: false, hint: "Titular (padrão) ou Apoio",
    aliases: ["tipo de alocacao", "tipo", "alocacao", "papel", "role", "titular"] },
  { field: "status", label: "Situação", required: false, hint: "Planejado, Confirmado ou Executado; vazio = Planejado (Executado quando o período já terminou)",
    aliases: ["situacao", "status"] },
  { field: "reason", label: "Motivo", required: false, hint: "obrigatório na prática para substituições; fica no histórico",
    aliases: ["motivo", "reason", "justificativa", "observacao", "obs"] },
];

export interface ColumnMapping<F extends string> {
  mapping: Record<number, F>;
  mapped: { header: string; field: F; label: string }[];
  unmapped: string[];
  missing: string[];
}

export function mapColumns<F extends string>(
  headers: string[],
  columns: ImportColumn<F>[],
  requiredGroups: { label: string; fields: F[] }[],
): ColumnMapping<F> {
  const mapping: Record<number, F> = {};
  const taken = new Set<F>();
  const mapped: ColumnMapping<F>["mapped"] = [];
  const unmapped: string[] = [];

  headers.forEach((header, index) => {
    const key = normalizeHeader(header ?? "");
    if (!key) return;
    const column =
      columns.find((c) => !taken.has(c.field) && c.aliases.includes(key)) ??
      columns.find((c) => !taken.has(c.field) && c.aliases.some((a) => key.startsWith(a)));
    if (column) {
      mapping[index] = column.field;
      taken.add(column.field);
      mapped.push({ header, field: column.field, label: column.label });
    } else {
      unmapped.push(header);
    }
  });

  const missing = requiredGroups
    .filter((group) => !group.fields.some((f) => taken.has(f)))
    .map((group) => group.label);
  return { mapping, mapped, unmapped, missing };
}

export const BR_REQUIRED: { label: string; fields: BrImportField[] }[] = [
  { label: "Operação", fields: ["operation"] },
  { label: "Cidade", fields: ["city"] },
  { label: "Código BR", fields: ["code"] },
];

export const ALLOCATION_REQUIRED: { label: string; fields: AllocationImportField[] }[] = [
  { label: "Código BR", fields: ["br_code"] },
  { label: "Frota ou Placa", fields: ["fleet_code", "license_plate"] },
  { label: "Data inicial", fields: ["start_date"] },
];

/** Cabeçalhos dos modelos vazios que a exportação oferece. */
export const BR_TEMPLATE_HEADERS = BR_IMPORT_COLUMNS.map((c) => c.label);
export const ALLOCATION_TEMPLATE_HEADERS = ALLOCATION_IMPORT_COLUMNS.map((c) => c.label);
