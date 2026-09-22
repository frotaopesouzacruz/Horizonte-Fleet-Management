import type {
  ExecutionAnswer, ExecutionCluster, ExecutionDetail, ScopeExecution, ScopeFilters,
} from "@/lib/applications/history-queries";

/**
 * Dados fixos para a prévia do histórico (mesmo portão do design system).
 *
 * Três execuções, uma de cada coisa que a lista precisa distinguir — uma com
 * inconformidade crítica, uma limpa, um retorno — e um detalhe que percorre o
 * que o drawer precisa apresentar: pergunta invertida respondida SIM (e por
 * isso inconforme), item crítico com condicional de escolha única, condicional
 * de múltipla escolha e observação. Setembro/2026, hoje dia 22, como a
 * Aderência.
 */
export const TODAY = "2026-09-22";

export const OPERATIONS = [
  { id: "op1", name: "Last Mille MG" },
  { id: "op2", name: "Redespacho - Belém/Pa" },
];

export const ROWS: ScopeExecution[] = [
  {
    id: "ex-critica",
    operationalDate: TODAY,
    checklistType: "saida",
    licensePlate: "SNT8E16",
    fleetCode: "VA116",
    operationName: "Last Mille MG",
    brCode: "BR0024107",
    employeeName: "Walace Rocha De Souza",
    employeeCode: "10234",
    submittedAt: "2026-09-22T10:06:42.000Z",
    durationSeconds: 272,
    applicable: 6,
    conforming: 3,
    nonConforming: 3,
    criticalNonConforming: 1,
    status: "submitted",
  },
  {
    id: "ex-limpa",
    operationalDate: TODAY,
    checklistType: "saida",
    licensePlate: "SNT8G21",
    fleetCode: "VA131",
    operationName: "Last Mille MG",
    brCode: "BR0024901",
    employeeName: "Leandro Carvalho Silva",
    employeeCode: "10877",
    submittedAt: "2026-09-22T09:48:10.000Z",
    durationSeconds: 195,
    applicable: 6,
    conforming: 6,
    nonConforming: 0,
    criticalNonConforming: 0,
    status: "submitted",
  },
  {
    id: "ex-retorno",
    operationalDate: "2026-09-21",
    checklistType: "retorno",
    licensePlate: "SNT1A73",
    fleetCode: "VA163",
    operationName: "Redespacho - Belém/Pa",
    brCode: "Redespacho Belem/Pa_1",
    employeeName: "Flaviano Lucio Dos Santos",
    employeeCode: "09915",
    submittedAt: "2026-09-21T21:32:05.000Z",
    durationSeconds: 58,
    applicable: 6,
    conforming: 5,
    nonConforming: 1,
    criticalNonConforming: 0,
    status: "submitted",
  },
];

const OPERATION_BY_NAME: Record<string, string> = { "Last Mille MG": "op1", "Redespacho - Belém/Pa": "op2" };

const answer = (
  questionKey: string,
  text: string,
  answered: ExecutionAnswer["answer"],
  isConforming: boolean,
  extra: Partial<Pick<ExecutionAnswer, "criticality" | "conditionalValue" | "note">> = {},
): ExecutionAnswer => ({
  questionKey,
  text,
  answer: answered,
  isConforming,
  criticality: extra.criticality ?? "media",
  conditionalValue: extra.conditionalValue ?? null,
  note: extra.note ?? null,
});

const cluster = (clusterKey: string, name: string, answers: ExecutionAnswer[]): ExecutionCluster => ({
  clusterKey,
  name,
  applicable: answers.length,
  nonConforming: answers.filter((a) => !a.isConforming).length,
  answers,
});

/** O detalhe da execução com crítica — o caso completo. */
const DETAIL_CRITICA: ExecutionDetail = {
  id: "ex-critica",
  operationalDate: TODAY,
  checklistType: "saida",
  licensePlate: "SNT8E16",
  fleetCode: "VA116",
  operationName: "Last Mille MG",
  brCode: "BR0024107",
  cityName: "Divinópolis",
  stateUf: "MG",
  versionLabel: "1.0",
  employeeName: "Walace Rocha De Souza",
  employeeCode: "10234",
  leaderName: "Flaviano Lucio Dos Santos",
  startedAt: "2026-09-22T10:02:10.000Z",
  submittedAt: "2026-09-22T10:06:42.000Z",
  durationSeconds: 272,
  applicable: 6,
  conforming: 3,
  nonConforming: 3,
  criticalNonConforming: 1,
  clusters: [
    cluster("5s", "5S", [
      answer("5s.limpeza_externa", "A frota está limpa externamente?", "yes", true),
      answer("5s.cabine", "A cabine está organizada, sem objetos soltos?", "yes", true),
    ]),
    cluster("funilaria", "Funilaria", [
      // Invertida: SIM é inconformidade (§37).
      answer(
        "funilaria.avaria",
        "Possui alguma avaria? Exemplo: amassado, arranhão, quebra ou dano aparente.",
        "yes",
        false,
        { conditionalValue: { descricao_avaria: "Amassado na porta lateral direita" } },
      ),
      answer("funilaria.parachoques", "Os para-choques estão fixados?", "yes", true),
    ]),
    cluster("luzes", "Luzes e Sinalização", [
      answer("luzes.freio", "As luzes de freio funcionam?", "no", false, {
        criticality: "critica",
        conditionalValue: { lado_freio: "esquerdo" },
      }),
      answer("luzes.farois", "Os faróis funcionam?", "no", false, {
        conditionalValue: { farois: ["farol_esquerdo", "milha_direito"] },
        note: "Lâmpada queimada, trocada no pátio.",
      }),
    ]),
  ],
};

/** Mesmo formulário, tudo conforme. */
const DETAIL_LIMPA: ExecutionDetail = {
  ...DETAIL_CRITICA,
  id: "ex-limpa",
  licensePlate: "SNT8G21",
  fleetCode: "VA131",
  brCode: "BR0024901",
  cityName: "Contagem",
  employeeName: "Leandro Carvalho Silva",
  employeeCode: "10877",
  startedAt: "2026-09-22T09:44:55.000Z",
  submittedAt: "2026-09-22T09:48:10.000Z",
  durationSeconds: 195,
  conforming: 6,
  nonConforming: 0,
  criticalNonConforming: 0,
  clusters: DETAIL_CRITICA.clusters.map((c) =>
    cluster(
      c.clusterKey,
      c.name,
      c.answers.map((a) =>
        answer(a.questionKey, a.text, a.questionKey === "funilaria.avaria" ? "no" : "yes", true, {
          criticality: a.criticality,
        }),
      ),
    ),
  ),
};

/** Retorno com uma inconformidade não crítica e observação. */
const DETAIL_RETORNO: ExecutionDetail = {
  ...DETAIL_LIMPA,
  id: "ex-retorno",
  operationalDate: "2026-09-21",
  checklistType: "retorno",
  licensePlate: "SNT1A73",
  fleetCode: "VA163",
  operationName: "Redespacho - Belém/Pa",
  brCode: "Redespacho Belem/Pa_1",
  cityName: "Belém",
  stateUf: "PA",
  employeeName: "Flaviano Lucio Dos Santos",
  employeeCode: "09915",
  leaderName: "Leandro Carvalho Silva",
  startedAt: "2026-09-21T21:31:07.000Z",
  submittedAt: "2026-09-21T21:32:05.000Z",
  durationSeconds: 58,
  conforming: 5,
  nonConforming: 1,
  criticalNonConforming: 0,
  clusters: DETAIL_LIMPA.clusters.map((c) =>
    c.clusterKey !== "5s"
      ? c
      : cluster(
          c.clusterKey,
          c.name,
          c.answers.map((a) =>
            a.questionKey === "5s.limpeza_externa"
              ? answer(a.questionKey, a.text, "no", false, { note: "Lama da estrada; lavagem agendada." })
              : a,
          ),
        ),
  ),
};

export const DETAILS: Record<string, ExecutionDetail> = {
  [DETAIL_CRITICA.id]: DETAIL_CRITICA,
  [DETAIL_LIMPA.id]: DETAIL_LIMPA,
  [DETAIL_RETORNO.id]: DETAIL_RETORNO,
};

/**
 * O carregador da lista: aplica tipo, operação e busca, e ignora o período de
 * propósito — a prévia tem de mostrar as mesmas três linhas em qualquer mês.
 */
export async function loadRows(filters: ScopeFilters): Promise<{ ok: boolean; error?: string; data?: ScopeExecution[] }> {
  const term = filters.search?.trim().toLowerCase();
  const data = ROWS.filter((r) => {
    if (filters.checklistType && r.checklistType !== filters.checklistType) return false;
    if (filters.operationId && OPERATION_BY_NAME[r.operationName] !== filters.operationId) return false;
    if (term) {
      const haystack = [r.licensePlate, r.fleetCode, r.employeeName, r.employeeCode]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      if (!haystack.includes(term)) return false;
    }
    return true;
  });
  return { ok: true, data };
}

export async function loadDetail(id: string): Promise<{ ok: boolean; error?: string; data?: ExecutionDetail | null }> {
  const detail = DETAILS[id];
  return detail ? { ok: true, data: detail } : { ok: false, error: "Checklist não encontrado no seu escopo." };
}
