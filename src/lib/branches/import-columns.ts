/**
 * Colunas da importação e da exportação de Filiais (Etapa 09, §58 e §61).
 *
 * Sem `"use server"` de propósito: a gaveta usa a mesma lista para explicar o
 * formato, a action usa para mapear os cabeçalhos e a rota de exportação usa
 * para escrever o modelo — uma lista, três leitores. O mapeamento por alias é
 * o mesmo da Fidelização (`mapColumns`), que já resolveu acento, caixa e
 * prefixo de cabeçalho.
 *
 * "Endereço" é o logradouro. Número, Complemento e Bairro são colunas
 * opcionais a mais: sem elas o arquivo exportado não voltaria igual na
 * importação, e partir "Rua X, 120 — Centro" em três campos seria adivinhar.
 */
import {
  cellToText, mapColumns, normalizeHeader,
  type ColumnMapping, type ImportColumn,
} from "@/lib/governance/import-columns";

export { cellToText, mapColumns, normalizeHeader };
export type { ColumnMapping, ImportColumn };

export type BranchImportField =
  | "code" | "name" | "legal_name" | "document_number" | "status" | "postal_code"
  | "state" | "city" | "street" | "street_number" | "complement" | "district"
  | "operations" | "notes";

export const BRANCH_IMPORT_COLUMNS: ImportColumn<BranchImportField>[] = [
  { field: "code", label: "Código", required: true,
    hint: "código interno; identifica a filial já cadastrada (087 e 87 são códigos diferentes)",
    aliases: ["codigo", "codigo interno", "codigo da filial", "cod filial", "code"] },
  { field: "name", label: "Nome da Filial", required: true,
    hint: "obrigatório para filial nova; único na organização",
    aliases: ["nome da filial", "nome", "filial", "name", "nome filial"] },
  { field: "legal_name", label: "Razão Social", required: false, hint: "opcional",
    aliases: ["razao social", "razao", "legal name"] },
  { field: "document_number", label: "CNPJ", required: false,
    hint: "com ou sem máscara; dígitos verificadores conferidos. Não troca o CNPJ de filial que já tem um",
    aliases: ["cnpj", "cnpj da filial", "documento"] },
  { field: "status", label: "Situação", required: false,
    hint: "Ativa ou Inativa; vazio = Ativa. Não inativa nem reativa filial existente",
    aliases: ["situacao", "status", "ativo"] },
  { field: "postal_code", label: "CEP", required: false, hint: "8 dígitos",
    aliases: ["cep", "codigo postal"] },
  { field: "state", label: "Estado", required: false, hint: "UF (ex.: MG) ou nome; obrigatório quando houver cidade",
    aliases: ["estado", "uf", "state"] },
  { field: "city", label: "Cidade", required: false, hint: "município do estado informado",
    aliases: ["cidade", "municipio", "city"] },
  { field: "street", label: "Endereço", required: false, hint: "logradouro",
    aliases: ["endereco", "logradouro", "rua", "street"] },
  { field: "street_number", label: "Número", required: false, hint: "opcional",
    aliases: ["numero", "num", "nro"] },
  { field: "complement", label: "Complemento", required: false, hint: "opcional",
    aliases: ["complemento"] },
  { field: "district", label: "Bairro", required: false, hint: "opcional",
    aliases: ["bairro"] },
  { field: "operations", label: "Operações vinculadas", required: false,
    hint: "nomes ou códigos separados por ponto e vírgula; só acrescenta vínculos, nunca remove",
    aliases: ["operacoes vinculadas", "operacoes", "operacao", "operations"] },
  { field: "notes", label: "Observações", required: false, hint: "texto livre; vazio não apaga o que existe",
    aliases: ["observacoes", "observacao", "obs", "notas", "notes"] },
];

export const BRANCH_REQUIRED: { label: string; fields: BranchImportField[] }[] = [
  { label: "Código", fields: ["code"] },
  { label: "Nome da Filial", fields: ["name"] },
];

/** Cabeçalhos do modelo vazio — a mesma ordem da exportação. */
export const BRANCH_TEMPLATE_HEADERS = BRANCH_IMPORT_COLUMNS.map((c) => c.label);

/**
 * A exportação das filiais: o modelo, e depois o que só se lê (contadores e
 * data). Reimportar o arquivo exportado funciona — as colunas a mais aparecem
 * na prévia como ignoradas.
 */
export const BRANCH_EXPORT_HEADERS = [
  ...BRANCH_TEMPLATE_HEADERS,
  "Colaboradores",
  "Veículos",
  "Centros de custo",
  "Atualizada em",
];

export const BRANCH_OPERATION_EXPORT_HEADERS = [
  "Código da filial",
  "Filial",
  "Situação da filial",
  "Código da operação",
  "Operação",
  "Situação da operação",
  "Vinculada desde",
  "Vinculada até",
  "Vínculo vigente",
  "Veículos na combinação",
];

export type BranchExportKind = "todas" | "filtradas" | "selecionadas" | "operacoes" | "modelo";

export const BRANCH_EXPORT_KINDS: BranchExportKind[] = ["todas", "filtradas", "selecionadas", "operacoes", "modelo"];
