import type { BranchOperationRow, BranchRow, BranchSummary } from "@/lib/branches/queries";
import type { BranchCostCenterRow } from "@/lib/branches/actions";
import type { BranchImportOutcome, BranchImportPreview } from "@/lib/branches/import-actions";

/**
 * Filiais com dados fixos (Etapa 09, importação/exportação/centros de custo).
 *
 * O cenário tem o que a tela precisa distinguir: uma filial com várias
 * operações, uma sem vínculo e uma inativa; uma prévia de importação com uma
 * filial nova, uma existente com diferenças (atual × recebido), uma sem
 * alteração e as linhas recusadas que a §59 manda recusar; e centros de custo
 * livres, associados aqui e associados a outra filial.
 */

const T = "2026-09-20T12:00:00Z";

function branch(partial: Partial<BranchRow> & Pick<BranchRow, "id" | "code" | "name">): BranchRow {
  return {
    unitType: "branch",
    legalName: null,
    documentNumber: null,
    status: "active",
    statusReason: null,
    notes: null,
    postalCode: null,
    street: null,
    streetNumber: null,
    complement: null,
    district: null,
    stateId: null,
    stateUf: null,
    cityId: null,
    cityName: null,
    operationCount: 0,
    employeeCount: 0,
    vehicleCount: 0,
    costCenterCount: 0,
    updatedAt: T,
    ...partial,
  };
}

export const BRANCHES: BranchRow[] = [
  branch({
    id: "00000000-0000-4000-8000-000000000087",
    code: "87",
    name: "Horizonte MG",
    legalName: "Horizonte Logística Ltda",
    documentNumber: "11222333000181",
    postalCode: "32010000",
    street: "Rua das Indústrias",
    streetNumber: "120",
    district: "Centro",
    stateId: 31,
    stateUf: "MG",
    cityId: 3118601,
    cityName: "Contagem",
    operationCount: 2,
    employeeCount: 138,
    vehicleCount: 85,
    costCenterCount: 1,
  }),
  branch({
    id: "00000000-0000-4000-8000-000000000124",
    code: "124",
    name: "Horizonte Belém",
    documentNumber: "11444777000161",
    stateId: 15,
    stateUf: "PA",
    cityId: 1501402,
    cityName: "Belém",
    operationCount: 1,
    employeeCount: 7,
    vehicleCount: 2,
  }),
  branch({
    id: "00000000-0000-4000-8000-000000000301",
    code: "087",
    name: "Base Betim",
    status: "inactive",
    statusReason: "Base desmobilizada",
    stateId: 31,
    stateUf: "MG",
    cityId: 3106705,
    cityName: "Betim",
  }),
];

export const OPERATIONS = [
  { id: "op-4", code: "OP-00004", name: "Last Mille MG", status: "active" },
  { id: "op-5", code: "OP-00005", name: "Merchandising", status: "active" },
  { id: "op-7", code: "OP-00007", name: "Redespacho - Belém/Pa", status: "active" },
];

export const LINKS: BranchOperationRow[] = [
  { id: "l1", organizationUnitId: BRANCHES[0].id, operationId: "op-4", operationCode: "OP-00004", operationName: "Last Mille MG", operationStatus: "active", effectiveFrom: "2026-01-01", effectiveTo: null, isCurrent: true, vehicleCount: 60, notes: null },
  { id: "l2", organizationUnitId: BRANCHES[0].id, operationId: "op-5", operationCode: "OP-00005", operationName: "Merchandising", operationStatus: "active", effectiveFrom: "2026-01-01", effectiveTo: null, isCurrent: true, vehicleCount: 25, notes: null },
  { id: "l3", organizationUnitId: BRANCHES[1].id, operationId: "op-7", operationCode: "OP-00007", operationName: "Redespacho - Belém/Pa", operationStatus: "active", effectiveFrom: "2026-02-01", effectiveTo: null, isCurrent: true, vehicleCount: 2, notes: null },
];

export const SUMMARY: BranchSummary = {
  totalBranches: 3,
  activeBranches: 2,
  inactiveBranches: 1,
  linkedOperations: 3,
  linkedEmployees: 145,
  linkedVehicles: 87,
};

export const LOCATIONS = [
  { stateId: 31, uf: "MG", cityId: 3106705, cityName: "Betim" },
  { stateId: 31, uf: "MG", cityId: 3118601, cityName: "Contagem" },
  { stateId: 15, uf: "PA", cityId: 1501402, cityName: "Belém" },
];

export const STATES = [
  { id: 15, uf: "PA", name: "Pará" },
  { id: 31, uf: "MG", name: "Minas Gerais" },
];

export const COST_CENTERS: BranchCostCenterRow[] = [
  { id: "cc-1", code: "CC-100", name: "Operação Contagem", status: "active", organizationUnitId: BRANCHES[0].id, branchCode: "87", branchName: "Horizonte MG" },
  { id: "cc-2", code: "CC-200", name: "Manutenção MG", status: "active", organizationUnitId: null, branchCode: null, branchName: null },
  { id: "cc-3", code: "CC-300", name: "Redespacho Belém", status: "active", organizationUnitId: BRANCHES[1].id, branchCode: "124", branchName: "Horizonte Belém" },
  { id: "cc-4", code: "CC-400", name: "Projeto encerrado", status: "inactive", organizationUnitId: null, branchCode: null, branchName: null },
];

/** O formato exato que `stage_branch_import` devolve, já mapeado pela action. */
export const IMPORT_PREVIEW: BranchImportPreview = {
  batchId: "batch-filiais-1",
  fileName: "filiais-setembro.xlsx",
  sheetName: "Filiais",
  totalRows: 6,
  validRows: 1,
  warningRows: 2,
  errorRows: 3,
  createRows: 1,
  updateRows: 1,
  skipRows: 1,
  alreadyImported: false,
  mappedColumns: [
    { header: "Código", field: "code", label: "Código" },
    { header: "Nome da Filial", field: "name", label: "Nome da Filial" },
    { header: "CNPJ", field: "document_number", label: "CNPJ" },
    { header: "Estado", field: "state", label: "Estado" },
    { header: "Cidade", field: "city", label: "Cidade" },
    { header: "Operações vinculadas", field: "operations", label: "Operações vinculadas" },
    { header: "Observações", field: "notes", label: "Observações" },
  ],
  unmappedColumns: ["Colaboradores"],
  rows: [
    {
      rowNumber: 2, status: "valid", action: "create", code: "MG-02", name: "Horizonte Sete Lagoas", currentName: null,
      legalName: "Horizonte Sete Lagoas Ltda", documentNumber: "11222333000181", statusValue: "active", currentStatus: null,
      postalCode: "35700000", stateUf: "MG", cityName: "Sete Lagoas", street: "Av. Principal", streetNumber: "900",
      complement: null, district: "Centro", notes: null,
      operations: [{ id: "op-4", code: "OP-00004", name: "Last Mille MG", link: "add" }],
      linksKept: [], changes: [], issues: [],
    },
    {
      rowNumber: 3, status: "warning", action: "update", code: "87", name: "Horizonte MG", currentName: "Horizonte MG",
      legalName: null, documentNumber: null, statusValue: "inactive", currentStatus: "active",
      postalCode: "32010100", stateUf: "MG", cityName: "Contagem", street: null, streetNumber: null,
      complement: null, district: null, notes: "Atende a região metropolitana",
      operations: [
        { id: "op-4", code: "OP-00004", name: "Last Mille MG", link: "kept" },
        { id: "op-7", code: "OP-00007", name: "Redespacho - Belém/Pa", link: "add" },
      ],
      linksKept: ["Merchandising"],
      changes: [
        { field: "postal_code", label: "CEP", current: "32010000", received: "32010100" },
        { field: "notes", label: "Observações", current: null, received: "Atende a região metropolitana" },
      ],
      issues: [
        { level: "warning", field: "status", code: "status_divergence", message: "A situação no arquivo (Inativa) difere da atual (Ativa). A importação não inativa nem reativa filiais: use Inativar/Reativar na tela, que mostra o impacto antes." },
        { level: "warning", field: "operations", code: "links_kept", message: "Vínculos atuais que não estão no arquivo continuam como estão: Merchandising. A importação nunca desvincula operações." },
        { level: "warning", field: null, code: "existing", message: "Filial já cadastrada (código 87): 2 campo(s) a atualizar e 1 operação(ões) a vincular. Nada é apagado." },
      ],
    },
    {
      rowNumber: 4, status: "warning", action: "skip", code: "124", name: "Horizonte Belém", currentName: "Horizonte Belém",
      legalName: null, documentNumber: null, statusValue: null, currentStatus: "active",
      postalCode: null, stateUf: null, cityName: null, street: null, streetNumber: null, complement: null, district: null, notes: null,
      operations: [], linksKept: [], changes: [],
      issues: [{ level: "warning", field: null, code: "existing", message: "Filial já cadastrada (código 124); nada a alterar." }],
    },
    {
      rowNumber: 5, status: "error", action: "skip", code: "MG-03", name: "Horizonte Ipatinga", currentName: null,
      legalName: null, documentNumber: null, statusValue: null, currentStatus: null,
      postalCode: null, stateUf: null, cityName: null, street: null, streetNumber: null, complement: null, district: null, notes: null,
      operations: [], linksKept: [], changes: [],
      issues: [{ level: "error", field: "document_number", code: "cnpj", message: "CNPJ inválido: 11.222.333/0001-00. Confira os 14 dígitos e os dígitos verificadores." }],
    },
    {
      rowNumber: 6, status: "error", action: "skip", code: "MG-04", name: "Horizonte Uberaba", currentName: null,
      legalName: null, documentNumber: null, statusValue: null, currentStatus: null,
      postalCode: null, stateUf: "SP", cityName: null, street: null, streetNumber: null, complement: null, district: null, notes: null,
      operations: [], linksKept: [], changes: [],
      issues: [
        { level: "error", field: "city", code: "state_city", message: "A cidade Uberaba não pertence ao estado SP (encontrada em: MG)." },
        { level: "error", field: "operations", code: "operation", message: "Operação não encontrada nesta organização: Operação Fantasma." },
      ],
    },
    {
      rowNumber: 7, status: "error", action: "skip", code: "MG-05", name: "Horizonte Juiz de Fora", currentName: null,
      legalName: null, documentNumber: null, statusValue: null, currentStatus: null,
      postalCode: null, stateUf: null, cityName: null, street: null, streetNumber: null, complement: null, district: null, notes: null,
      operations: [], linksKept: [], changes: [],
      issues: [{ level: "error", field: "code", code: "duplicate", message: "O código MG-05 aparece em mais de uma linha do arquivo. Nenhuma delas é importada até a repetição ser resolvida." }],
    },
  ],
};

export const IMPORT_OUTCOME: BranchImportOutcome = {
  created: 1,
  updated: 1,
  linksAdded: 2,
  skipped: 4,
  failed: 0,
  errors: [],
};
