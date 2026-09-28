/**
 * Colunas aceitas nas importações da Manutenção. Sem `"use server"` de
 * propósito: a tela usa a mesma lista para explicar o formato e a action para
 * mapear os cabeçalhos — uma lista, dois leitores.
 *
 * Cinco bases, cada uma com o seu layout: a base de manutenções e os quatro
 * cadastros (clusters, serviços, fornecedores, parâmetros preventivos). Os
 * cadastros vêm antes: a base só aceita serviço e fornecedor que existam.
 */
import { normalizeHeader, toIsoDate, cellToText } from "@/lib/adherence/import-columns";

export type MaintenanceImportKind = "records" | "clusters" | "services" | "suppliers" | "preventive_rules";

export interface MaintenanceImportColumn {
  field: string;
  label: string;
  required: boolean;
  aliases: string[];
  hint: string;
  /** Datas viram aaaa-mm-dd no navegador; o banco ainda aceita dd/mm/aaaa. */
  date?: boolean;
}

export const IMPORT_KINDS: { kind: MaintenanceImportKind; label: string; description: string }[] = [
  { kind: "records", label: "Base de manutenções", description: "Manutenções e seus serviços. Uma linha por serviço; linhas do mesmo veículo, tipo, data e OS formam uma manutenção." },
  { kind: "clusters", label: "Clusters técnicos", description: "Agrupadores técnicos dos serviços (Motor, Freios, Elétrica…)." },
  { kind: "services", label: "Serviços", description: "Serviços por cluster, com tipos de manutenção aplicáveis e tempo esperado." },
  { kind: "suppliers", label: "Fornecedores", description: "Oficinas e prestadores, com CNPJ/CPF, cidade e clusters atendidos." },
  { kind: "preventive_rules", label: "Parâmetros preventivos", description: "Intervalo de KM, marco inicial, ciclos e bandas por tipo, subcategoria e modelo." },
];

const col = (field: string, label: string, required: boolean, aliases: string[], hint: string, date = false): MaintenanceImportColumn =>
  ({ field, label, required, aliases, hint, date });

export const IMPORT_COLUMNS: Record<MaintenanceImportKind, MaintenanceImportColumn[]> = {
  records: [
    col("fleet_code", "Frota", false, ["frota", "codigo da frota", "cod frota", "fleet", "fleet code", "prefixo"], "código da frota (ou informe a placa)"),
    col("license_plate", "Placa", false, ["placa", "plate", "license plate"], "placa do veículo (ou informe a frota)"),
    col("maintenance_type", "Tipo", true, ["tipo", "tipo de manutencao", "tipo manutencao", "natureza", "type"], "Preventiva, Corretiva ou Preditiva (Socorro em rota e Entrega técnica entram como Corretiva com essa origem)"),
    col("status", "Situação", false, ["situacao", "status", "etapa"], "Há agendar, Agendado, Em execução, Concluído (Realizada), Cancelado, Não realizada; vazio = Há agendar"),
    col("origin", "Origem", false, ["origem", "origin", "fonte"], "origem do catálogo; desconhecida entra como Não informado"),
    col("cluster", "Cluster", false, ["cluster", "grupo", "sistema", "cluster tecnico"], "cluster técnico do serviço (desempata serviços de mesmo nome)"),
    col("service", "Serviço", true, ["servico", "servicos", "service", "item", "descricao do servico"], "serviço do catálogo — nunca é criado pela importação"),
    col("supplier", "Fornecedor", false, ["fornecedor", "oficina", "prestador", "supplier"], "nome, nome fantasia ou CNPJ de um fornecedor cadastrado"),
    col("service_order_number", "OS", false, ["os", "ordem de servico", "n os", "numero os", "numero da os", "service order"], "número da ordem de serviço"),
    col("requested_on", "Solicitação", false, ["solicitacao", "data solicitacao", "data da solicitacao", "abertura", "data abertura"], "data da solicitação", true),
    col("scheduled_date", "Agendamento", false, ["agendamento", "data agendamento", "data agendada", "agendado para"], "data agendada", true),
    col("scheduled_time", "Hora agendada", false, ["hora agendada", "hora agendamento", "horario agendado"], "hh:mm"),
    col("expected_exit_date", "Previsão de saída", false, ["previsao de saida", "previsao saida", "saida prevista"], "data prevista de saída", true),
    col("entry_date", "Entrada", false, ["entrada", "data entrada", "data de entrada", "entrada real"], "data real de entrada na oficina", true),
    col("entry_time", "Hora de entrada", false, ["hora entrada", "hora de entrada"], "hh:mm"),
    col("exit_date", "Saída", false, ["saida", "data saida", "data de saida", "saida real", "conclusao", "data conclusao"], "data real de saída", true),
    col("exit_time", "Hora de saída", false, ["hora saida", "hora de saida"], "hh:mm"),
    col("entry_km", "KM de entrada", false, ["km", "km entrada", "km de entrada", "hodometro", "odometro"], "KM informado; sem ele, o KM oficial da data é usado"),
    col("preventive_cycle", "Ciclo preventivo", false, ["ciclo", "mp", "ciclo preventivo", "revisao"], "MP1, MP2… (só preventiva)"),
    col("priority", "Prioridade", false, ["prioridade", "priority", "urgencia"], "Baixa, Média, Alta ou Crítica"),
    col("description", "Descrição", false, ["descricao", "defeito", "relato", "problema"], "texto livre"),
    col("notes", "Observações", false, ["observacao", "observacoes", "obs", "notas"], "texto livre"),
  ],
  clusters: [
    col("name", "Cluster", true, ["cluster", "nome", "name", "sistema"], "nome do cluster"),
    col("code", "Código", false, ["codigo", "code", "sigla"], "gerado do nome quando vazio"),
    col("description", "Descrição", false, ["descricao", "description"], "texto livre"),
    col("criticality", "Criticidade", false, ["criticidade", "criticality"], "Baixa, Média, Alta ou Crítica"),
  ],
  services: [
    col("cluster", "Cluster", true, ["cluster", "grupo", "sistema"], "cluster existente (nome ou código)"),
    col("name", "Serviço", true, ["servico", "nome", "name", "service"], "nome do serviço"),
    col("maintenance_types", "Tipos", false, ["tipos", "tipo", "tipos de manutencao", "aplicavel a"], "Preventiva; Corretiva; Preditiva (vazio = todos)"),
    col("criticality", "Criticidade", false, ["criticidade", "criticality"], "Baixa, Média, Alta ou Crítica"),
    col("expected_hours", "Horas previstas", false, ["horas", "horas previstas", "tempo previsto", "tempo padrao"], "tempo esperado de execução, em horas"),
    col("is_predictive", "Preditivo", false, ["preditivo", "preditiva", "is predictive"], "Sim/Não"),
  ],
  suppliers: [
    col("name", "Fornecedor", true, ["fornecedor", "nome", "razao social", "name"], "razão social ou nome"),
    col("document_number", "CNPJ/CPF", false, ["cnpj", "cpf", "cnpj cpf", "documento"], "11 ou 14 dígitos"),
    col("address", "Endereço", false, ["endereco", "address"], "texto livre"),
    col("city", "Cidade", false, ["cidade", "municipio", "city"], "nome da cidade (IBGE)"),
    col("state", "UF", false, ["uf", "estado", "state"], "sigla da UF"),
    col("clusters", "Clusters", false, ["clusters", "cluster", "especialidades"], "separados por ; ou ,"),
  ],
  preventive_rules: [
    col("vehicle_type", "Tipo de equipamento", true, ["tipo de equipamento", "tipo equipamento", "tipo", "equipamento"], "tipo oficial (Etapa 07)"),
    col("subcategory", "Subcategoria", false, ["subcategoria", "categoria"], "subcategoria do tipo"),
    col("model", "Modelo", false, ["modelo", "model"], "modelo cadastrado"),
    col("service", "Serviço", false, ["servico", "service", "revisao"], "serviço preventivo do catálogo"),
    col("interval_km", "Intervalo (km)", true, ["intervalo", "intervalo km", "km intervalo", "periodicidade"], "a cada quantos km (mín. 100)"),
    col("initial_km", "KM inicial", false, ["km inicial", "marco inicial", "inicio"], "vazio = 0"),
    col("cycle_count", "Ciclos", false, ["ciclos", "quantidade de ciclos", "qtd ciclos"], "vazio = 20"),
    col("alert_before_pct", "Alerta antes (%)", false, ["alerta", "alerta antes", "alerta %"], "vazio = 5"),
    col("tolerance_after_pct", "Tolerância depois (%)", false, ["tolerancia", "tolerancia depois", "tolerancia %"], "vazio = 5"),
  ],
};

export interface ColumnMapping {
  mapping: Record<number, string>;
  mapped: { header: string; field: string; label: string }[];
  unmapped: string[];
  missing: string[];
}

export function mapMaintenanceColumns(kind: MaintenanceImportKind, headers: string[]): ColumnMapping {
  const columns = IMPORT_COLUMNS[kind];
  const mapping: Record<number, string> = {};
  const taken = new Set<string>();
  const mapped: ColumnMapping["mapped"] = [];
  const unmapped: string[] = [];

  headers.forEach((header, index) => {
    const key = normalizeHeader(header ?? "");
    if (!key) return;
    // Primeiro o nome exato; depois o prefixo — "KM de entrada" não pode cair em "Entrada".
    const column =
      columns.find((c) => !taken.has(c.field) && (c.aliases.includes(key) || normalizeHeader(c.label) === key)) ??
      columns.find((c) => !taken.has(c.field) && c.aliases.some((a) => a.length > 3 && key.startsWith(a)));
    if (column) {
      mapping[index] = column.field;
      taken.add(column.field);
      mapped.push({ header, field: column.field, label: column.label });
    } else {
      unmapped.push(header);
    }
  });

  const missing: string[] = [];
  if (kind === "records" && !taken.has("fleet_code") && !taken.has("license_plate")) missing.push("Frota ou Placa");
  for (const c of columns) if (c.required && !taken.has(c.field)) missing.push(c.label);
  return { mapping, mapped, unmapped, missing };
}

/** Horas chegam como texto, Date (XLSX) ou fração do dia (número do Excel). */
function toTime(value: unknown): string | null {
  if (value == null || value === "") return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return `${String(value.getUTCHours()).padStart(2, "0")}:${String(value.getUTCMinutes()).padStart(2, "0")}`;
  }
  if (typeof value === "number" && Number.isFinite(value) && value >= 0 && value < 1) {
    const minutes = Math.round(value * 24 * 60);
    return `${String(Math.floor(minutes / 60) % 24).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
  }
  return cellToText(value);
}

export function importCell(column: MaintenanceImportColumn | undefined, value: unknown): string | null {
  if (!column) return null;
  if (column.date) return toIsoDate(value);
  if (column.field.endsWith("_time")) return toTime(value);
  return cellToText(value);
}

export const templateHeaders = (kind: MaintenanceImportKind) => IMPORT_COLUMNS[kind].map((c) => c.label);
