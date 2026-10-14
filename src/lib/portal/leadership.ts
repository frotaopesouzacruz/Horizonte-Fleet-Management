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

export interface FleetNumbers {
  total: number;
  active: number;
  inactive: number;
  unassigned: number;
  operations: number;
}

/** Bloco ausente (null) = sem permissão para ele; Loaded com erro = falhou. */
export interface LeadershipBlocks {
  today: AdherenceBlock | null;
  /** Ontem, para o comparativo "hoje × ontem" da aderência. */
  yesterday: AdherenceBlock | null;
  week: AdherenceBlock | null;
  tires: Loaded<TiresNumbers> | null;
  mtsr: Loaded<MtsrNumbers> | null;
  plans: Loaded<PlansNumbers> | null;
  fleet: Loaded<FleetNumbers> | null;
}

/* -------------------------------------------------------------------------- */
/* Blocos secundários (carregados depois da primeira pintura)                 */
/* -------------------------------------------------------------------------- */

export interface MaintenanceNumbers {
  today: string;
  open: number;
  toSchedule: number;
  scheduled: number;
  inProgress: number;
  scheduledToday: number;
  exitOverdue: number;
  unscheduledOverdue: number;
  immobilized: number;
  preventiveCritical: number;
  preventiveDue: number;
  preventiveToSchedule: number;
  predictiveCritical: number;
}

export interface PredictiveNumbers {
  itemsMonitored: number;
  critical: number;
  due: number;
  toSchedule: number;
  upcoming: number;
  coveragePct: number | null;
  uncoveredVehicles: number;
  criticalClusters: { cluster: string; critical: number; toSchedule: number }[];
}

export interface KmNumbers {
  referenceDay: string | null;
  kmTotal: number | null;
  vehiclesWithoutReadingRef: number;
  vehiclesStale: number;
  coveragePeriodPct: number | null;
  lastUpdate: string | null;
}

export interface AdherenceTrendPoint {
  month: number;
  adherencePct: number | null;
  targetPct: number | null;
  isCurrent: boolean;
  isFuture: boolean;
}

export interface LeadershipSecondary {
  maintenance: Loaded<MaintenanceNumbers> | null;
  predictive: Loaded<PredictiveNumbers> | null;
  km: Loaded<KmNumbers> | null;
  /** Aderência de saída mês a mês no ano (tendência). */
  trend: Loaded<AdherenceTrendPoint[]> | null;
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

/* -------------------------------------------------------------------------- */
/* Pendências da equipe por categoria                                         */
/* -------------------------------------------------------------------------- */

export type PendingCategoryKey = "checklist" | "tires" | "mtsr" | "plans";

export interface PendingCategory {
  key: PendingCategoryKey;
  label: string;
  /** Quantidade total da categoria; null quando a fonte não carregou. */
  total: number | null;
  /** Dentro do total, o que é crítico. */
  critical: number;
  /** As partes que compõem o total, para a linha de detalhe. */
  parts: { label: string; value: number }[];
  href: string;
  /** Sem permissão para a fonte: a categoria não aparece. */
  available: boolean;
}

/**
 * As pendências agrupadas por categoria (HFC: "Pendências da equipe"), cada
 * uma abrindo o módulo já filtrado pelo recorte. Fonte que falhou vira
 * total nulo — a tela diz "não carregou", nunca zero.
 */
export function pendingByCategory(blocks: LeadershipBlocks, query: string): PendingCategory[] {
  const out: PendingCategory[] = [];

  if (blocks.today || blocks.week) {
    const t = blocks.today;
    const w = blocks.week;
    const ok = (!t || (t.saida.ok && t.retorno.ok)) && (!w || (w.saida.ok && w.retorno.ok));
    const todayMissing = t && t.saida.ok && t.retorno.ok ? t.saida.data.notDone + t.retorno.data.notDone : 0;
    const weekMissing = w && w.saida.ok && w.retorno.ok ? w.saida.data.notDone + w.retorno.data.notDone : 0;
    out.push({
      key: "checklist",
      label: "Checklist",
      total: ok ? weekMissing : null,
      critical: todayMissing,
      parts: [
        { label: "sem envio hoje", value: todayMissing },
        { label: "não realizados na semana", value: Math.max(weekMissing - todayMissing, 0) },
      ],
      href: `/checklist/aderencia${query}`,
      available: true,
    });
  }

  if (blocks.tires) {
    const b = blocks.tires;
    const d = b.ok && !b.data.empty ? b.data : null;
    out.push({
      key: "tires",
      label: "Pneus",
      total: b.ok ? (d ? d.critical + d.measurementOverdue + d.calibrationOverdue : 0) : null,
      critical: d ? d.critical : 0,
      parts: [
        { label: "críticos", value: d?.critical ?? 0 },
        { label: "medição vencida", value: d?.measurementOverdue ?? 0 },
        { label: "calibragem vencida", value: d?.calibrationOverdue ?? 0 },
      ],
      href: `/frota/pneus${query}`,
      available: true,
    });
  }

  if (blocks.mtsr) {
    const b = blocks.mtsr;
    const d = b.ok ? b.data : null;
    out.push({
      key: "mtsr",
      label: "MTSR",
      total: d ? d.overdue + d.nonConforming + d.pendingInspections : null,
      critical: d ? d.overdue : 0,
      parts: [
        { label: "vistorias vencidas", value: d?.overdue ?? 0 },
        { label: "não conformes", value: d?.nonConforming ?? 0 },
        { label: "aguardando validação", value: d?.pendingInspections ?? 0 },
      ],
      href: `/seguranca/mtsr${query}`,
      available: true,
    });
  }

  if (blocks.plans) {
    const b = blocks.plans;
    const d = b.ok ? b.data : null;
    out.push({
      key: "plans",
      label: "Planos de ação",
      total: d ? d.plansActive : null,
      critical: d ? d.plansOverdue : 0,
      parts: [
        { label: "vencidos", value: d?.plansOverdue ?? 0 },
        { label: "críticos", value: d?.plansCritical ?? 0 },
        { label: "veículos com pendência", value: d?.vehiclesPending ?? 0 },
      ],
      href: `/checklist/planos-acao${query}`,
      available: true,
    });
  }

  return out;
}

/* -------------------------------------------------------------------------- */
/* Insights (2–3, só do que os dados dizem)                                   */
/* -------------------------------------------------------------------------- */

export interface Insight {
  key: string;
  tone: "positive" | "warning" | "critical" | "info";
  title: string;
  text: string;
  href?: string;
}

const pp = (n: number) => `${n.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} p.p.`;
const pct = (n: number) => `${n.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;

/**
 * Dois ou três fatos derivados dos números carregados — nunca inventados.
 * Sem base (fonte que falhou, sem obrigação, sem equipe), o insight não
 * existe; a lista pode ficar vazia e a tela diz isso.
 */
export function buildInsights(
  blocks: LeadershipBlocks,
  team: LeadershipTeam | null,
  categories: PendingCategory[],
  query: string,
): Insight[] {
  const out: Insight[] = [];

  const today = blocks.today && blocks.today.saida.ok ? blocks.today.saida.data : null;
  const yesterday = blocks.yesterday && blocks.yesterday.saida.ok ? blocks.yesterday.saida.data : null;
  if (today && today.pct != null) {
    const target = today.targetPct ?? 90;
    if (yesterday && yesterday.pct != null) {
      const delta = today.pct - yesterday.pct;
      out.push({
        key: "adherence-vs-yesterday",
        tone: today.pct >= target ? "positive" : delta < 0 ? "warning" : "info",
        title: `Saída hoje em ${pct(today.pct)}`,
        text:
          Math.abs(delta) < 0.05
            ? `Igual a ontem (${pct(yesterday.pct)}); meta ${pct(target)}.`
            : `${delta > 0 ? "Acima" : "Abaixo"} de ontem em ${pp(Math.abs(delta))} (ontem ${pct(yesterday.pct)}); meta ${pct(target)}.`,
        href: `/checklist/aderencia${query}`,
      });
    } else {
      out.push({
        key: "adherence-today",
        tone: today.pct >= target ? "positive" : "warning",
        title: `Saída hoje em ${pct(today.pct)}`,
        text: `${today.numerator.toLocaleString("pt-BR")} de ${today.denominator.toLocaleString("pt-BR")} obrigações; meta ${pct(target)}.`,
        href: `/checklist/aderencia${query}`,
      });
    }
  }

  const loaded = categories.filter((c) => c.total != null && (c.total ?? 0) > 0);
  if (loaded.length) {
    const top = [...loaded].sort((a, b) => (b.critical - a.critical) || ((b.total ?? 0) - (a.total ?? 0)))[0];
    out.push({
      key: `category-${top.key}`,
      tone: top.critical > 0 ? "critical" : "warning",
      title: `${top.label} concentra as pendências`,
      text: `${(top.total ?? 0).toLocaleString("pt-BR")} ${top.total === 1 ? "pendência" : "pendências"}${top.critical > 0 ? `, ${top.critical.toLocaleString("pt-BR")} ${top.critical === 1 ? "crítica" : "críticas"}` : ""}.`,
      href: top.href,
    });
  }

  if (team && team.members > 0) {
    out.push({
      key: "team-week",
      tone: team.withoutChecklistWeek === 0 ? "positive" : team.withoutChecklistWeek > team.members / 2 ? "critical" : "warning",
      title:
        team.withoutChecklistWeek === 0
          ? "Toda a equipe enviou checklist na semana"
          : `${team.withoutChecklistWeek.toLocaleString("pt-BR")} de ${team.members.toLocaleString("pt-BR")} sem checklist na semana`,
      text:
        team.withoutChecklistWeek === 0
          ? `${team.members.toLocaleString("pt-BR")} colaboradores da equipe direta, todos com envio de segunda até hoje.`
          : `Hoje, ${team.withoutChecklistToday.toLocaleString("pt-BR")} ainda sem checklist.`,
      href: "#equipe",
    });
  }

  return out.slice(0, 3);
}

/** Variação entre dois percentuais, para o KpiCard (direção, bom quando sobe). */
export function pctDelta(current: number | null, previous: number | null): { value: string; direction: "up" | "down" | "flat" } | null {
  if (current == null || previous == null) return null;
  const delta = current - previous;
  if (Math.abs(delta) < 0.05) return { value: "0 p.p.", direction: "flat" };
  return { value: `${delta > 0 ? "+" : "−"}${pp(Math.abs(delta))}`, direction: delta > 0 ? "up" : "down" };
}
