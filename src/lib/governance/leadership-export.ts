import "server-only";

import { listLeadership, type LeadershipFilters, type LeadershipRow } from "./queries";
import { formatCompetence, type Competence } from "./competence";

/**
 * Lideranças — o que a tela mostra e o que a exportação entrega (Etapa 08 §20).
 *
 * A página e a rota de exportação leem daqui, com os mesmos filtros e a mesma
 * consulta `security invoker` (`leadership_directory` sob o cliente de quem
 * pede). É isso que garante que o arquivo tem exatamente o que a pessoa via —
 * nem uma linha fora do seu escopo, nem uma linha a menos do que a tela.
 */

export interface LeaderOption {
  id: string;
  name: string;
  code: string | null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const INTEGER = /^\d{1,9}$/;
const SCOPES = new Set(["operation", "city", "br"]);
const STATUSES = new Set(["current", "active", "ended", "cancelled"]);

/**
 * Filtros da URL (`operacao`, `uf`, `cidade`, `nivel`, `situacao`,
 * `lideranca`). Um valor malformado é ignorado em vez de virar erro de banco:
 * um link antigo ou editado à mão abre a tela sem aquele filtro.
 */
export function readLeadershipFilters(get: (key: string) => string | null | undefined): LeadershipFilters {
  const read = (key: string, valid: (value: string) => boolean): string | undefined => {
    const value = get(key)?.trim();
    return value && valid(value) ? value : undefined;
  };
  return {
    operationId: read("operacao", (v) => UUID.test(v)),
    stateId: read("uf", (v) => INTEGER.test(v)),
    cityId: read("cidade", (v) => INTEGER.test(v)),
    scope: read("nivel", (v) => SCOPES.has(v)),
    status: read("situacao", (v) => STATUSES.has(v)),
    employeeId: read("lideranca", (v) => UUID.test(v)),
  };
}

/**
 * As linhas da competência com os filtros da tela e as lideranças que o
 * filtro "Liderança" oferece.
 *
 * O filtro por liderança é aplicado sobre a mesma consulta, e não enviado ao
 * banco, para que a lista de opções continue mostrando todas as lideranças da
 * competência — escolher uma não pode fazer as outras sumirem do seletor.
 */
export async function loadLeadershipScreen(
  organizationId: string,
  competence: Competence,
  filters: LeadershipFilters,
): Promise<{ rows: LeadershipRow[]; leaders: LeaderOption[] }> {
  const all = await listLeadership(organizationId, competence, { ...filters, employeeId: undefined });

  const seen = new Map<string, LeaderOption>();
  for (const row of all) {
    if (!seen.has(row.employeeId)) {
      seen.set(row.employeeId, { id: row.employeeId, name: row.employeeName, code: row.employeeCode });
    }
  }
  const leaders = [...seen.values()].sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
  const rows = filters.employeeId ? all.filter((row) => row.employeeId === filters.employeeId) : all;
  return { rows, leaders };
}

/* ------------------------------------------------------------------ arquivo */

export const LEADERSHIP_EXPORT_HEADERS = [
  "Competência",
  "Nível",
  "Operação",
  "Estado",
  "Cidade",
  "BR",
  "Colaborador",
  "Matrícula",
  "Função",
  "Início da vigência",
  "Fim da vigência",
  "Situação",
  "Vigente hoje",
  "Observações",
  "Motivo do encerramento",
];

const SCOPE_LABEL: Record<LeadershipRow["scopeLevel"], string> = {
  operation: "Operação",
  city: "Cidade",
  br: "BR",
};

const RESPONSIBILITY_LABEL: Record<LeadershipRow["responsibilityType"], string> = {
  principal: "Principal",
  substitute: "Substituto",
  support: "Apoio",
};

const STATUS_LABEL: Record<LeadershipRow["status"], string> = {
  active: "Ativa",
  ended: "Encerrada",
  cancelled: "Cancelada",
};

function formatDate(value: string | null): string {
  if (!value) return "";
  const [year, month, day] = value.split("-");
  return year && month && day ? `${day}/${month}/${year}` : value;
}

/**
 * Texto livre (nome, observação, motivo) que começa com `=`, `+`, `-` ou `@`
 * seria lido como fórmula pela planilha. O apóstrofo o mantém como texto.
 */
function cell(value: string | null | undefined): string {
  const text = value ?? "";
  return /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
}

/** Uma linha do arquivo por vínculo, na ordem da tela. */
export function leadershipExportRows(
  rows: LeadershipRow[],
  competence: Competence,
): (string | number | null)[][] {
  const label = formatCompetence(competence);
  return rows.map((row) => [
    label,
    SCOPE_LABEL[row.scopeLevel],
    cell(row.operationName),
    row.stateUf ?? "",
    cell(row.cityName),
    cell(row.brCode),
    cell(row.employeeName),
    cell(row.employeeCode),
    RESPONSIBILITY_LABEL[row.responsibilityType],
    formatDate(row.effectiveFrom),
    row.effectiveTo ? formatDate(row.effectiveTo) : "em aberto",
    STATUS_LABEL[row.status],
    row.isCurrent ? "Sim" : "Não",
    cell(row.notes),
    cell(row.endReason),
  ]);
}

/** "liderancas-setembro-2026.xlsx" — sem acento nem barra no nome do arquivo. */
export function leadershipExportFileName(competence: Competence, format: "xlsx" | "csv"): string {
  const slug = formatCompetence(competence)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace("/", "-")
    .toLowerCase();
  return `liderancas-${slug}.${format}`;
}
