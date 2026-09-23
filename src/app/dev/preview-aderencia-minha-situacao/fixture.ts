import type { Competence } from "@/lib/governance/competence";
import type {
  MyPendingSituation, MySituation, MySituationCell, MySituationCounts, MySituationDay, MySituationPending, MySituationResult,
} from "@/lib/adherence/my-situation";

/**
 * Dados fixos da prévia de "Minha situação" (mesmo portão do design system).
 *
 * Setembro/2026, hoje dia 23, um motorista que foi titular de uma BR até o dia
 * 18 e de outra a partir do dia 19 — as duas posições que a tela precisa
 * mostrar lado a lado —, mais um checklist que ele mesmo enviou numa BR que
 * não é a dele. Passa por todos os estados do dia a dia: feito, não fez
 * (vencido e provisório do dia vigente), retorno vencido depois da saída,
 * retorno no prazo, expurgo aprovado, justificativa pendente e planejado.
 *
 * Os totais são contados dos próprios dias com a regra oficial (devida = feita
 * ou não feita; expurgada fora da conta), para a prévia nunca mostrar um
 * número que o dia a dia desmente. Outros meses respondem como o banco
 * responde a um mês sem vínculo: "not_driver".
 */
export const TODAY = "2026-09-23";
export const COMPETENCE: Competence = { year: 2026, month: 9 };

export type PreviewScenario = "situacao" | "sem-colaborador" | "sem-fidelizacao" | "so-checklists" | "erro";
export const SCENARIOS: PreviewScenario[] = ["situacao", "sem-colaborador", "sem-fidelizacao", "so-checklists", "erro"];

const EXCLUDED = new Set(["SEM_ROTA", "MANUTENCAO", "FROTA_RESERVA", "EM_VIAGEM", "FROTA_NAO_ATIVA"]);

const POS_A = { brCode: "BR0024706", fleetCode: "VA151", licensePlate: "SNT1A63", operationName: "Last Mille MG", cityName: "Contagem" };
const POS_B = { brCode: "BR0024901", fleetCode: "VA131", licensePlate: "SNT8G21", operationName: "Last Mille MG", cityName: "Contagem" };
const OTHER = { brCode: "BR0024107", fleetCode: "VA116", licensePlate: "SNT8E16", operationName: "Last Mille MG", cityName: "Divinópolis" };

const iso = (day: number) => `2026-09-${String(day).padStart(2, "0")}`;
const nextIso = (day: number) => (day === 30 ? "2026-10-01" : iso(day + 1));

function cell(status: string, day: number, context: "saida" | "retorno", extra: Partial<MySituationCell> = {}): MySituationCell {
  const done = status === "FEZ_CHECKLIST";
  return {
    status,
    done,
    due: done || status === "NAO_FEZ_CHECKLIST",
    excluded: EXCLUDED.has(status),
    provisional: false,
    pendingRequest: false,
    condition: null,
    performedByMe: false,
    expectedAt: context === "saida" ? `${iso(day)}T09:00:00+00:00` : `${iso(day)}T21:00:00+00:00`,
    deadlineAt: context === "saida" ? `${nextIso(day)}T03:00:00+00:00` : `${nextIso(day)}T05:00:00+00:00`,
    ...extra,
  };
}

function buildDays(): MySituationDay[] {
  const days: MySituationDay[] = [];
  for (let d = 1; d <= 30; d++) {
    const pos = d <= 18 ? POS_A : POS_B;
    const mine = d >= 19;
    let saida: MySituationCell;
    let retorno: MySituationCell;
    if (d > 23) {
      saida = cell("PLANEJADO", d, "saida");
      retorno = cell("PLANEJADO", d, "retorno");
    } else if (d === 23) {
      // Dia vigente: a saída sem checklist já é "Não fez" (provisório, §15); o retorno ainda está no prazo.
      saida = cell("NAO_FEZ_CHECKLIST", d, "saida", { provisional: true });
      retorno = cell("RETORNO_PENDENTE", d, "retorno", { due: false });
    } else if (d === 5) {
      saida = cell("NAO_FEZ_CHECKLIST", d, "saida");
      retorno = cell("NAO_FEZ_CHECKLIST", d, "retorno");
    } else if (d === 9) {
      saida = cell("FEZ_CHECKLIST", d, "saida");
      retorno = cell("NAO_FEZ_CHECKLIST", d, "retorno");
    } else if (d === 14) {
      saida = cell("SEM_ROTA", d, "saida");
      retorno = cell("SEM_ROTA", d, "retorno");
    } else if (d === 20) {
      saida = cell("NAO_FEZ_CHECKLIST", d, "saida", { pendingRequest: true, condition: "MANUTENCAO" });
      retorno = cell("FEZ_CHECKLIST", d, "retorno", { performedByMe: true });
    } else {
      saida = cell("FEZ_CHECKLIST", d, "saida", { performedByMe: mine });
      retorno = cell("FEZ_CHECKLIST", d, "retorno", { performedByMe: mine });
    }
    days.push({ date: iso(d), journey: 1, ...pos, byFidelization: true, byExecution: saida.performedByMe || retorno.performedByMe, saida, retorno });
    if (d === 12) {
      // Checklist que ele mesmo enviou cobrindo outra BR: entra só pela execução.
      days.push({
        date: iso(d), journey: 1, ...OTHER, byFidelization: false, byExecution: true,
        saida: cell("FEZ_CHECKLIST", d, "saida", { performedByMe: true }), retorno: null,
      });
    }
  }
  return days;
}

function count(cells: MySituationCell[]): MySituationCounts {
  const numerator = cells.filter((c) => c.done && c.due).length;
  const denominator = cells.filter((c) => c.due).length;
  return {
    obligations: cells.length,
    done: cells.filter((c) => c.done).length,
    notDone: cells.filter((c) => c.status === "NAO_FEZ_CHECKLIST").length,
    pendingReturn: cells.filter((c) => c.status === "RETORNO_PENDENTE").length,
    planned: cells.filter((c) => c.status === "PLANEJADO").length,
    excluded: cells.filter((c) => c.excluded).length,
    pendingRequests: cells.filter((c) => c.pendingRequest).length,
    provisional: cells.filter((c) => c.provisional).length,
    numerator,
    denominator,
    adherencePct: denominator > 0 ? Math.round((numerator * 10000) / denominator) / 100 : null,
    targetPct: 90,
  };
}

function buildPending(days: MySituationDay[]): MySituationPending[] {
  const out: MySituationPending[] = [];
  for (const d of days) {
    for (const context of ["saida", "retorno"] as const) {
      const c = context === "saida" ? d.saida : d.retorno;
      if (!c || !["NAO_FEZ_CHECKLIST", "RETORNO_PENDENTE"].includes(c.status)) continue;
      const departureDone = context === "retorno" ? Boolean(d.saida?.done) : null;
      let situation: MyPendingSituation = "overdue";
      if (c.status === "RETORNO_PENDENTE") situation = departureDone ? "awaiting_return" : "not_departed";
      else if (c.provisional) situation = "provisional";
      else if (context === "retorno" && departureDone) situation = "overdue_after_departure";
      out.push({
        date: d.date, context, status: c.status, brCode: d.brCode, operationName: d.operationName, cityName: d.cityName,
        fleetCode: d.fleetCode, licensePlate: d.licensePlate, expectedAt: c.expectedAt, deadlineAt: c.deadlineAt,
        provisional: c.provisional, pendingRequest: c.pendingRequest, departureDone, situation,
      });
    }
  }
  return out.sort((a, b) => (a.deadlineAt ?? "").localeCompare(b.deadlineAt ?? ""));
}

function base(competence: Competence): Omit<MySituation, "state"> {
  const last = new Date(Date.UTC(competence.year, competence.month, 0)).getUTCDate();
  const mm = String(competence.month).padStart(2, "0");
  return {
    year: competence.year, month: competence.month,
    dateFrom: `${competence.year}-${mm}-01`, dateTo: `${competence.year}-${mm}-${last}`,
    today: TODAY, employeeName: "Rafael Souza Campos",
    summary: null, positions: [], days: [], pending: [], pendingTotal: 0, executions: { submitted: 0, linked: 0 },
  };
}

function situation(competence: Competence, onlyExecutions = false): MySituation {
  const all = buildDays();
  const days = onlyExecutions ? all.filter((d) => !d.byFidelization) : all;
  const cells = (ctx: "saida" | "retorno" | null) =>
    days.flatMap((d) => (ctx === "retorno" ? [d.retorno] : ctx === "saida" ? [d.saida] : [d.saida, d.retorno]))
      .filter((c): c is MySituationCell => c !== null);
  const pending = buildPending(days);
  const mine = cells(null).filter((c) => c.performedByMe).length;
  return {
    ...base(competence),
    state: "ok",
    summary: { total: count(cells(null)), saida: count(cells("saida")), retorno: count(cells("retorno")) },
    positions: onlyExecutions ? [] : [
      { operationBrId: "br-a", ...POS_A, uf: "MG", dateFrom: "2026-09-01", dateTo: "2026-09-18" },
      { operationBrId: "br-b", ...POS_B, uf: "MG", dateFrom: "2026-09-19", dateTo: "2026-09-30" },
    ],
    days,
    pending,
    pendingTotal: pending.length,
    executions: { submitted: mine, linked: mine },
  };
}

/**
 * O "carregador" da prévia: o mesmo contrato de `getMySituation`, com dados
 * fixos. A rota real injeta o do servidor; esta injeta este.
 */
export async function loadPreviewSituation(scenario: PreviewScenario, competence: Competence): Promise<MySituationResult> {
  if (scenario === "erro") {
    return { ok: false, error: "Você não tem autorização para consultar a própria situação na Aderência." };
  }
  if (scenario === "sem-colaborador") {
    return { ok: true, data: { ...base(competence), state: "no_employee", employeeName: null } };
  }
  const isFixtureMonth = competence.year === COMPETENCE.year && competence.month === COMPETENCE.month;
  if (scenario === "sem-fidelizacao" || !isFixtureMonth) {
    return { ok: true, data: { ...base(competence), state: "not_driver" } };
  }
  return { ok: true, data: situation(competence, scenario === "so-checklists") };
}
