import type { MySituationCell, MySituationDay } from "@/lib/adherence/my-situation";
import type { ChecklistContextKind, OperationalExecution } from "@/lib/portal/types";

/**
 * "Meu calendário de checklists" (Início do Operacional).
 *
 * No HFC o calendário pinta de vermelho TODO dia passado sem checklist da
 * pessoa — inclusive folga, fim de semana, veículo em manutenção ou dia em
 * que ela nem estava escalada. Aqui cada quadrante (Saída / Retorno) nasce de
 * uma de duas fontes, e de nenhuma outra:
 *
 *   1. a obrigação oficial da Aderência (`adherence_my_situation`): a BR em
 *      que a pessoa é motorista titular fidelizada, com o status oficial —
 *      fez, não fez, retorno no prazo, previsto, ou dispensado por expurgo
 *      (manutenção, sem rota, em viagem, reserva, frota não ativa);
 *   2. o checklist que a própria pessoa enviou naquele dia, mesmo sem
 *      obrigação (aparece como realizado).
 *
 * Dia sem nenhuma das duas fica neutro: não havia o que cobrar.
 *
 * Puro: a tela, a prévia e os testes usam a mesma função.
 */

export type QuadrantTone = "done" | "missed" | "pending" | "planned" | "excused";

export interface CalendarQuadrant {
  context: ChecklistContextKind;
  tone: QuadrantTone;
  /** Rótulo do quadrante; para "excused" a tela usa o status oficial (`statusCode`). */
  label: string;
  /** Status oficial que decidiu o quadrante, quando veio de obrigação. */
  statusCode: string | null;
  /** Placa principal (a da obrigação, ou a do checklist enviado). */
  plate: string | null;
  /** Outras placas além da principal no mesmo dia e contexto. */
  extra: number;
  /** Obrigações devidas (sem expurgo) e quantas foram cumpridas. */
  due: number;
  done: number;
  /** Veio de obrigação oficial (true) ou só do checklist enviado (false). */
  byObligation: boolean;
}

export interface CalendarDay {
  date: string;
  day: number;
  isToday: boolean;
  isFuture: boolean;
  saida: CalendarQuadrant | null;
  retorno: CalendarQuadrant | null;
  /** As obrigações do dia (uma linha por BR/veículo/jornada). */
  obligations: MySituationDay[];
  /** Os checklists que a pessoa enviou no dia. */
  executions: OperationalExecution[];
}

export interface CalendarMonth {
  year: number;
  month: number;
  /** Células vazias antes do dia 1 (a semana começa no domingo, como no HFC). */
  leading: number;
  days: CalendarDay[];
}

const pad = (n: number) => String(n).padStart(2, "0");
export const isoDate = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function weekdayOf(iso: string): number {
  return new Date(`${iso}T12:00:00Z`).getUTCDay();
}

function distinct(values: (string | null | undefined)[]): string[] {
  return [...new Set(values.filter((v): v is string => Boolean(v)))];
}

function quadrant(
  context: ChecklistContextKind,
  rows: MySituationDay[],
  executions: OperationalExecution[],
): CalendarQuadrant | null {
  const cells = rows
    .map((row) => ({ row, cell: row[context] as MySituationCell | null }))
    .filter((x): x is { row: MySituationDay; cell: MySituationCell } => x.cell != null);
  const mine = executions.filter((e) => e.context === context);

  if (cells.length > 0) {
    const due = cells.filter((x) => !x.cell.excluded);
    const done = due.filter((x) => x.cell.done);
    const plates = distinct([
      ...cells.map((x) => x.row.licensePlate),
      ...mine.map((e) => e.licensePlate),
    ]);
    const base = {
      context,
      plate: (done[0]?.row.licensePlate ?? cells[0].row.licensePlate ?? mine[0]?.licensePlate) || null,
      extra: Math.max(0, plates.length - 1),
      due: due.length,
      done: done.length,
      byObligation: true,
    };

    if (due.length === 0) {
      return { ...base, tone: "excused", label: "Dispensado", statusCode: cells[0].cell.status };
    }
    if (done.length === due.length) {
      return { ...base, tone: "done", label: "Realizado", statusCode: "FEZ_CHECKLIST" };
    }
    const missed = due.find((x) => x.cell.status === "NAO_FEZ_CHECKLIST" && !x.cell.provisional);
    if (missed) {
      return {
        ...base,
        tone: "missed",
        label: due.length > 1 && done.length > 0 ? `${done.length} de ${due.length} realizados` : "Não realizado",
        statusCode: missed.cell.status,
      };
    }
    // Dia vigente ainda sem checklist: a obrigação continua aberta, não é falta.
    const today = due.find((x) => x.cell.status === "NAO_FEZ_CHECKLIST" && x.cell.provisional);
    if (today) return { ...base, tone: "pending", label: "Pendente hoje", statusCode: today.cell.status };
    const awaiting = due.find((x) => x.cell.status === "RETORNO_PENDENTE");
    if (awaiting) return { ...base, tone: "pending", label: "Aguardando retorno", statusCode: awaiting.cell.status };
    return { ...base, tone: "planned", label: "Previsto", statusCode: due.find((x) => !x.cell.done)?.cell.status ?? null };
  }

  if (mine.length > 0) {
    const plates = distinct(mine.map((e) => e.licensePlate));
    return {
      context,
      tone: "done",
      label: "Realizado",
      statusCode: null,
      plate: plates[0] ?? mine[0].fleetCode ?? null,
      extra: Math.max(0, plates.length - 1),
      due: 0,
      done: 0,
      byObligation: false,
    };
  }
  return null;
}

export function buildCalendar({
  year,
  month,
  today,
  obligations,
  executions,
}: {
  year: number;
  month: number;
  /** Dia operacional vigente (servidor, fuso da organização). */
  today: string;
  /** Dias de `adherence_my_situation`; null quando a pessoa não pode ver a própria aderência. */
  obligations: MySituationDay[] | null;
  executions: OperationalExecution[];
}): CalendarMonth {
  const total = daysInMonth(year, month);
  const first = isoDate(year, month, 1);
  const days: CalendarDay[] = [];

  for (let d = 1; d <= total; d += 1) {
    const date = isoDate(year, month, d);
    const rows = (obligations ?? []).filter((row) => row.date === date);
    const mine = executions.filter((e) => e.date === date);
    days.push({
      date,
      day: d,
      isToday: date === today,
      isFuture: Boolean(today) && date > today,
      saida: quadrant("saida", rows, mine),
      retorno: quadrant("retorno", rows, mine),
      obligations: rows,
      executions: mine,
    });
  }

  return { year, month, leading: weekdayOf(first), days };
}

/** Totais do mês para o rodapé do calendário — contados sobre os quadrantes, não recalculados. */
export function calendarTotals(calendar: CalendarMonth) {
  const quadrants = calendar.days.flatMap((d) => [d.saida, d.retorno]).filter((q): q is CalendarQuadrant => q != null);
  const count = (tone: QuadrantTone) => quadrants.filter((q) => q.tone === tone).length;
  return {
    done: count("done"),
    missed: count("missed"),
    pending: count("pending"),
    planned: count("planned"),
    excused: count("excused"),
    executions: calendar.days.reduce((n, d) => n + d.executions.length, 0),
  };
}
