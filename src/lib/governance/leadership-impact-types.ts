/**
 * O que `leadership_change_impact` devolve, já em camelCase (Etapa 13 §14).
 *
 * Arquivo só de tipos: a gaveta (cliente), a ação de servidor e a prévia de
 * desenvolvimento leem a mesma forma.
 */

export interface LeadershipImpactBr {
  id: string;
  code: string;
  operationName: string | null;
  cityName: string | null;
  stateUf: string | null;
  firstDay: string;
  lastDay: string;
  /** Dias em que a liderança resolvida desta BR muda. */
  days: number;
  leadersBefore: string[];
  leadersAfter: string[];
}

export interface LeadershipImpactVehicle {
  id: string;
  fleetCode: string | null;
  licensePlate: string | null;
  brCode: string | null;
  from: string;
  to: string;
}

export interface LeadershipImpactDriver {
  id: string;
  name: string;
  employeeCode: string | null;
  brCode: string | null;
  from: string;
  to: string;
}

export interface LeadershipImpactRecord {
  id: string;
  date: string;
  /** "saida" | "retorno" */
  context: string | null;
  brCode: string | null;
  licensePlate: string | null;
  fleetCode: string | null;
  /** A liderança gravada no registro (fotografia) — não muda com a correção. */
  leaderName: string | null;
}

export interface LeadershipImpact {
  /** false: a alteração só alcança hoje ou o futuro — nada a prever. */
  retroactive: boolean;
  today: string;
  /** Intervalos de dias passados em que o vínculo muda (inclusivos). */
  periods: { from: string; to: string }[];
  pastDays: number;
  /** Dias em que alguma BR muda de liderança. */
  changedDays: number;
  /** Sempre true: checklists e obrigações guardam a liderança da época. */
  snapshotsPreserved: boolean;
  /** Obrigações de ontem sem checklist nem decisão que a rotina da Aderência ainda realinha. */
  recentPendingObligations: number;
  brs: { count: number; sample: LeadershipImpactBr[] };
  vehicles: { count: number; sample: LeadershipImpactVehicle[] };
  drivers: { count: number; sample: LeadershipImpactDriver[] };
  checklists: { count: number; sample: LeadershipImpactRecord[] };
  obligations: { count: number; open: number; sample: (LeadershipImpactRecord & { open: boolean })[] };
}
