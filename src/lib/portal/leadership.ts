import type { LeadershipTeam, Loaded } from "@/lib/portal/types";

/**
 * Portal da Liderança: os números de cada bloco, já reduzidos ao que a tela
 * mostra, e as Prioridades derivadas deles.
 *
 * Puro (sem servidor): a rota real monta estes blocos a partir das rotinas
 * oficiais de cada módulo — `adherence_summary`, `tires_overview`,
 * `mtsr_dashboard`, `action_plan_dashboard` — e a prévia, de dados fixos.
 * Nenhum número é recalculado aqui: o portal resume, o módulo decide.
 */

export interface AdherenceNumbers {
  obligations: number;
  done: number;
  notDone: number;
  pendingReturn: number;
  planned: number;
  excluded: number;
  numerator: number;
  denominator: number;
  pct: number | null;
  targetPct: number | null;
}

export interface AdherenceBlock {
  from: string;
  to: string;
  saida: Loaded<AdherenceNumbers>;
  retorno: Loaded<AdherenceNumbers>;
}

export interface TiresNumbers {
  empty: boolean;
  referenceDate: string | null;
  inUse: number;
  fleetsWithCritical: number;
  critical: number;
  measurementOverdue: number;
  measurementDueSoon: number;
  calibrationOverdue: number;
  calibrationDueSoon: number;
}

export interface MtsrNumbers {
  vehicles: number;
  overdue: number;
  attention: number;
  nonConforming: number;
  pendingInspections: number;
  openMaintenances: number;
  conformityPct: number | null;
}

export interface PlansNumbers {
  plansActive: number;
  plansOverdue: number;
  plansCritical: number;
  itemsOpen: number;
  vehiclesPending: number;
}

/** Bloco ausente (null) = sem permissão para ele; Loaded com erro = falhou. */
export interface LeadershipBlocks {
  today: AdherenceBlock | null;
  week: AdherenceBlock | null;
  tires: Loaded<TiresNumbers> | null;
  mtsr: Loaded<MtsrNumbers> | null;
  plans: Loaded<PlansNumbers> | null;
}

export type PrioritySeverity = "critical" | "high" | "medium";

export interface Priority {
  key: string;
  severity: PrioritySeverity;
  source: string;
  title: string;
  description: string;
  href: string;
}

const SEVERITY_ORDER: Record<PrioritySeverity, number> = { critical: 0, high: 1, medium: 2 };

const plural = (n: number, one: string, many: string) => `${n.toLocaleString("pt-BR")} ${n === 1 ? one : many}`;

/**
 * As prioridades da operação (HFC: "Prioridades da Minha Operação"), na
 * ordem de severidade. Só entram fontes que carregaram; quem chama sabe,
 * por `incomplete`, se alguma ficou de fora — e a tela diz isso em vez de
 * declarar a operação "sob controle".
 */
export function buildPriorities(
  blocks: LeadershipBlocks,
  team: LeadershipTeam | null,
  /** "?lideranca=<id>" quando o recorte é a liderança; "" quando são as operações. */
  query: string,
): { items: Priority[]; incomplete: boolean } {
  const items: Priority[] = [];
  let incomplete = false;
  const ok = <T,>(b: Loaded<T> | null): T | null => {
    if (b == null) return null;
    if (!b.ok) {
      incomplete = true;
      return null;
    }
    return b.data;
  };

  const tires = ok(blocks.tires);
  const mtsr = ok(blocks.mtsr);
  const plans = ok(blocks.plans);
  const todaySaida = blocks.today ? ok(blocks.today.saida) : null;
  const todayRetorno = blocks.today ? ok(blocks.today.retorno) : null;
  const weekSaida = blocks.week ? ok(blocks.week.saida) : null;
  const weekRetorno = blocks.week ? ok(blocks.week.retorno) : null;

  if (tires && !tires.empty && tires.fleetsWithCritical > 0) {
    items.push({
      key: "tires-critical",
      severity: "critical",
      source: "Gestão de Pneus",
      title: `${plural(tires.fleetsWithCritical, "frota", "frotas")} com pneu crítico`,
      description: `${plural(tires.critical, "pneu", "pneus")} abaixo do limite legal ou em nível crítico de sulco.`,
      href: `/frota/pneus${query}`,
    });
  }
  if (mtsr && mtsr.overdue > 0) {
    items.push({
      key: "mtsr-overdue",
      severity: "critical",
      source: "Gestão de MTSR",
      title: `${plural(mtsr.overdue, "veículo", "veículos")} com vistoria MTSR vencida`,
      description: "A vistoria dos componentes MTSR passou do prazo.",
      href: `/seguranca/mtsr${query}`,
    });
  }
  const todayMissing = (todaySaida?.notDone ?? 0) + (todayRetorno?.notDone ?? 0);
  if (todayMissing > 0) {
    items.push({
      key: "checklist-today",
      severity: "high",
      source: "Check List",
      title: `${plural(todayMissing, "checklist", "checklists")} ainda sem envio hoje`,
      description: "Obrigações de hoje (saída e retorno vencido) ainda sem checklist.",
      href: `/checklist/aderencia${query}`,
    });
  }
  const weekMissing = (weekSaida?.notDone ?? 0) + (weekRetorno?.notDone ?? 0);
  if (weekMissing > todayMissing) {
    items.push({
      key: "checklist-week",
      severity: "high",
      source: "Check List",
      title: `${plural(weekMissing - todayMissing, "checklist não realizado", "checklists não realizados")} na semana`,
      description: "Obrigações de segunda até ontem que ficaram sem checklist.",
      href: `/checklist/aderencia${query}`,
    });
  }
  if (tires && !tires.empty && tires.measurementOverdue > 0) {
    items.push({
      key: "tires-measurement-overdue",
      severity: "high",
      source: "Gestão de Pneus",
      title: `${plural(tires.measurementOverdue, "pneu", "pneus")} com medição de sulco vencida`,
      description: "Medição fora do prazo oficial.",
      href: `/frota/pneus${query}`,
    });
  }
  if (tires && !tires.empty && tires.calibrationOverdue > 0) {
    items.push({
      key: "tires-calibration-overdue",
      severity: "high",
      source: "Gestão de Pneus",
      title: `${plural(tires.calibrationOverdue, "pneu", "pneus")} com calibragem vencida`,
      description: "Calibragem fora do prazo oficial.",
      href: `/frota/pneus${query}`,
    });
  }
  if (plans && plans.plansOverdue > 0) {
    items.push({
      key: "plans-overdue",
      severity: "high",
      source: "Planos de ação",
      title: `${plural(plans.plansOverdue, "plano de ação vencido", "planos de ação vencidos")}`,
      description: "Tratativas de manutenção fora do prazo.",
      href: `/checklist/planos-acao${query}`,
    });
  }
  if (tires && !tires.empty && tires.measurementDueSoon > 0) {
    items.push({
      key: "tires-measurement-soon",
      severity: "medium",
      source: "Gestão de Pneus",
      title: `${plural(tires.measurementDueSoon, "pneu", "pneus")} com medição próxima do vencimento`,
      description: "Programe a medição de sulco desta semana.",
      href: `/frota/pneus${query}`,
    });
  }
  if (tires && !tires.empty && tires.calibrationDueSoon > 0) {
    items.push({
      key: "tires-calibration-soon",
      severity: "medium",
      source: "Gestão de Pneus",
      title: `${plural(tires.calibrationDueSoon, "pneu", "pneus")} com calibragem próxima do vencimento`,
      description: "Programe a calibragem desta semana.",
      href: `/frota/pneus${query}`,
    });
  }
  if (team && team.withoutChecklistWeek > 0) {
    const names = team.withoutWeekNames.slice(0, 5).join(", ");
    items.push({
      key: "team-week",
      severity: "medium",
      source: "Minha equipe",
      title: `${plural(team.withoutChecklistWeek, "colaborador", "colaboradores")} sem checklist na semana`,
      description: names ? `Sem nenhum checklist de segunda até hoje: ${names}${team.withoutChecklistWeek > 5 ? "…" : "."}` : "Sem nenhum checklist de segunda até hoje.",
      href: "#equipe",
    });
  }
  if (mtsr && mtsr.pendingInspections > 0) {
    items.push({
      key: "mtsr-pending",
      severity: "medium",
      source: "Gestão de MTSR",
      title: `${plural(mtsr.pendingInspections, "vistoria MTSR aguardando", "vistorias MTSR aguardando")} validação`,
      description: "Vistorias enviadas pelo app que ainda não foram validadas.",
      href: `/seguranca/mtsr${query}`,
    });
  }

  items.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
  return { items, incomplete };
}
