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
  { kind: "records", label: "Base de manutenções", description: "Manutenções e seus serviços. Uma linha por serviço; linhas do mesmo veículo, tipo, data, OS e fornecedor formam uma manutenção." },
  { kind: "clusters", label: "Clusters técnicos", description: "Agrupadores técnicos dos serviços (Motor, Freios, Elétrica…)." },
  { kind: "services", label: "Serviços", description: "Serviços por cluster (categoria), com tipos de manutenção aplicáveis, criticidade e outros nomes." },
  { kind: "suppliers", label: "Fornecedores", description: "Parceiros comerciais: código, CNPJ/CPF, categoria, tipo, pagamento e outros nomes." },
  { kind: "preventive_rules", label: "Parâmetros preventivos", description: "Intervalo de KM, marco inicial, ciclos e bandas por tipo de equipamento, subcategoria e modelo." },
];

const col = (field: string, label: string, required: boolean, aliases: string[], hint: string, date = false): MaintenanceImportColumn =>
  ({ field, label, required, aliases, hint, date });

/**
 * A ordem e os rótulos são os das planilhas da operação (06 Clusters, 07
 * Fornecedores, 08 Parâmetros, 09 Serviços, 10 Manutenções): o modelo baixado
 * sai com esses cabeçalhos, nessa ordem, e as colunas opcionais vêm depois.
 * Os nomes antigos continuam reconhecidos pelos apelidos.
 */
export const IMPORT_COLUMNS: Record<MaintenanceImportKind, MaintenanceImportColumn[]> = {
  records: [
    col("license_plate", "Placa", false, ["placa", "plate", "license plate"], "placa do veículo (ou informe a frota)"),
    col("maintenance_type", "Tipo de Manutenção", true, ["tipo de manutencao", "tipo manutencao", "tipo", "natureza", "type"], "Preventiva, Corretiva ou Preditiva (Socorro em rota e Entrega técnica entram como Corretiva com essa origem)"),
    col("cluster", "Categoria (Cluster)", false, ["categoria cluster", "categoria", "cluster", "grupo", "sistema", "cluster tecnico"], "cluster do serviço; se divergir do cadastro, vale o cadastro (aviso)"),
    col("service", "Serviço", true, ["servico", "servicos", "service", "item", "descricao do servico"], "serviço do catálogo, pelo nome ou por um dos outros nomes — nunca é criado pela importação"),
    col("supplier", "Parceiro Comercial", false, ["parceiro comercial", "parceiro", "fornecedor", "oficina", "prestador", "supplier"], "nome, nome fantasia, outro nome ou CNPJ do fornecedor; não reconhecido entra sem vínculo, com o nome guardado"),
    col("service_order_number", "OS", false, ["os", "ordem de servico", "n os", "numero os", "numero da os", "service order"], "número da ordem de serviço"),
    col("scheduled_date", "Data Agendada", false, ["data agendada", "agendamento", "data agendamento", "agendado para"], "data agendada", true),
    col("entry_date", "Data de Entrada", false, ["data de entrada", "entrada", "data entrada", "entrada real"], "data real de entrada na oficina (exigida em Em execução e Concluído)", true),
    col("entry_time", "Hora de Entrada", false, ["hora de entrada", "hora entrada"], "hh:mm"),
    col("expected_exit_date", "Previsão de Saída", false, ["previsao de saida", "previsao saida", "saida prevista"], "data prevista de saída", true),
    col("exit_date", "Data de Saída", false, ["data de saida", "saida", "data saida", "saida real", "conclusao", "data conclusao"], "data real de saída (exigida em Concluído)", true),
    col("exit_time", "Hora de Saída", false, ["hora de saida", "hora saida"], "hh:mm"),
    col("entry_km", "KM de Entrada", false, ["km de entrada", "km entrada", "km", "hodometro", "odometro"], "KM informado (casas decimais são descartadas); sem ele, o KM oficial da data é usado"),
    col("status", "Situação", false, ["situacao", "status", "etapa"], "Há agendar, Agendado, Em execução, Concluído (Realizada), Cancelado, Não realizada; vazio = Há agendar"),
    col("origin", "Origem", false, ["origem", "origin", "fonte"], "Checklist, Relato Motorista, Socorro em Rota, Preventiva Programada, Operação…; desconhecida entra como Não informado"),
    col("fleet_code", "Frota", false, ["frota", "codigo da frota", "cod frota", "fleet", "fleet code", "prefixo"], "código da frota (opcional quando há placa)"),
    col("requested_on", "Data da Solicitação", false, ["data da solicitacao", "solicitacao", "data solicitacao", "abertura", "data abertura"], "data da solicitação", true),
    col("scheduled_time", "Hora Agendada", false, ["hora agendada", "hora agendamento", "horario agendado"], "hh:mm"),
    col("preventive_cycle", "Ciclo Preventivo", false, ["ciclo preventivo", "ciclo", "mp", "revisao"], "MP1, MP2… (só preventiva)"),
    col("priority", "Prioridade", false, ["prioridade", "priority", "urgencia"], "Baixa, Média, Alta ou Crítica"),
    col("description", "Descrição", false, ["descricao", "defeito", "relato", "problema"], "texto livre"),
    col("notes", "Observações", false, ["observacoes", "observacao", "obs", "notas"], "texto livre"),
  ],
  clusters: [
    col("name", "Cluster", true, ["cluster", "nome", "name", "sistema", "categoria"], "nome do cluster"),
    col("code", "Código", false, ["codigo", "code", "sigla"], "identificador técnico; gerado do nome quando vazio; não muda depois de criado"),
    col("description", "Descrição", false, ["descricao", "description"], "texto livre"),
    col("criticality", "Criticidade", false, ["criticidade", "criticality"], "Baixa, Média, Alta ou Crítica"),
    col("status", "Status", false, ["status", "situacao", "ativo"], "Ativo ou Inativo (vazio = Ativo)"),
  ],
  services: [
    col("cluster", "Categoria", true, ["categoria", "cluster", "grupo", "sistema", "categoria cluster"], "cluster existente (nome ou código)"),
    col("name", "Serviço", true, ["servico", "nome", "name", "service"], "nome do serviço"),
    col("maintenance_types", "Tipos Manutenção", false, ["tipos manutencao", "tipos de manutencao", "tipos", "tipo", "aplicavel a"], "Preventiva; Corretiva; Preditiva — \"Não se aplica\" = nenhum tipo; coluna vazia mantém o que há"),
    col("criticality", "Criticidade", false, ["criticidade", "criticality"], "Baixa, Média, Alta ou Crítica"),
    col("status", "Status", false, ["status", "situacao", "ativo"], "Ativo ou Inativo (vazio = Ativo)"),
    col("expected_hours", "Horas Previstas", false, ["horas previstas", "horas", "tempo previsto", "tempo padrao"], "tempo esperado de execução, em horas"),
    col("is_predictive", "Preditivo", false, ["preditivo", "is predictive"], "Sim/Não; vazio = Sim quando o tipo inclui Preditiva"),
    col("alias_names", "Outros Nomes", false, ["outros nomes", "apelidos", "de para", "nomes antigos", "nomes alternativos"], "nomes antigos do serviço nas planilhas, separados por ;"),
  ],
  suppliers: [
    col("external_code", "Cod Rodopar", false, ["cod rodopar", "codigo rodopar", "rodopar", "codigo do parceiro", "cod parceiro", "codigo externo", "codigo", "cod"], "código do parceiro no sistema de origem"),
    col("name", "Parceiro Comercial", true, ["parceiro comercial", "parceiro", "fornecedor", "razao social", "nome", "name"], "razão social ou nome"),
    col("document_number", "CNPJ / CPF", false, ["cnpj cpf", "cnpj", "cpf", "documento"], "11 ou 14 dígitos; inválido ou repetido entra sem documento (aviso)"),
    col("category", "Categoria", false, ["categoria", "category"], "Mecânica, Funilaria, Peças e Acessórios…"),
    col("service_type", "Tipo", false, ["tipo", "tipo de servico", "tipo servico"], "Revisões Preventivas e Corretivas, Lava Jato…"),
    col("payment_terms", "Modelo de Pagamento", false, ["modelo de pagamento", "forma de pagamento", "prazo de pagamento", "condicao de pagamento", "pagamento"], "30 Dias, 15 Dias…; \"-\" = não informado"),
    col("financial_validation", "Validação Financeiro", false, ["validacao financeiro", "validacao financeira", "validacao do financeiro", "validacao"], "ex.: OK"),
    col("trade_name", "Nome Fantasia", false, ["nome fantasia", "fantasia"], "nome comercial"),
    col("alias_names", "Outros Nomes", false, ["outros nomes", "apelidos", "de para", "nomes alternativos"], "nomes com que o fornecedor aparece na base de manutenções, separados por ;"),
    col("address", "Endereço", false, ["endereco", "address"], "texto livre"),
    col("city", "Cidade", false, ["cidade", "municipio", "city"], "nome da cidade (IBGE)"),
    col("state", "UF", false, ["uf", "estado", "state"], "sigla da UF"),
    col("clusters", "Clusters", false, ["clusters", "cluster", "especialidades"], "separados por ; ou ,"),
    col("status", "Status", false, ["status", "situacao", "ativo"], "Ativo ou Inativo (vazio = Ativo)"),
  ],
  preventive_rules: [
    col("vehicle_type", "Tipo Equipamento", true, ["tipo equipamento", "tipo de equipamento", "tipo", "equipamento"], "tipo oficial (Etapa 07) ou uma subcategoria (Toco, Truck)"),
    col("model", "Modelo", false, ["modelo", "model"], "modelo cadastrado ou subcategoria do tipo (10,5 m³); \"—\" = todos"),
    col("interval_km", "Intervalo (KM)", true, ["intervalo km", "intervalo", "km intervalo", "periodicidade"], "a cada quantos km (mín. 100)"),
    col("initial_km", "KM Inicial", false, ["km inicial", "marco inicial", "inicio"], "vazio = 0"),
    col("cycle_count", "Ciclos", false, ["ciclos", "quantidade de ciclos", "qtd ciclos"], "vazio = 20"),
    col("alert_before_pct", "Alerta %", false, ["alerta", "alerta antes", "alerta antes %"], "vazio = 5"),
    col("tolerance_after_pct", "Tolerância %", false, ["tolerancia", "tolerancia depois", "tolerancia depois %"], "vazio = 5"),
    col("criticality", "Criticidade", false, ["criticidade", "criticality"], "Baixa, Média, Alta ou Crítica"),
    col("status", "Status", false, ["status", "situacao", "ativo"], "Ativo ou Inativo (vazio = Ativo)"),
    col("subcategory", "Subcategoria", false, ["subcategoria"], "subcategoria do tipo"),
    col("service", "Serviço", false, ["servico", "service", "revisao"], "serviço preventivo do catálogo"),
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
