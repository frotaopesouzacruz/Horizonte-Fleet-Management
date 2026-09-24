/**
 * Lideranças › Planejamento por Tipo de Operação → Cidade — tipos e contas.
 *
 * A matriz vem pronta de `leadership_city_planner` (uma chamada); aqui ficam
 * só os tipos e as contas que a tela e os indicadores fazem sobre ela, sem
 * acesso ao banco — por isso o arquivo serve ao servidor, ao cliente e às
 * prévias.
 */

export interface PlannerLeader {
  /** O vínculo em `leadership_assignments` (nível cidade, principal). */
  id: string;
  employeeId: string;
  employeeName: string;
  employeeCode: string | null;
  employeeActive: boolean;
  effectiveFrom: string;
  effectiveTo: string | null;
  status: "active" | "ended";
  notes: string | null;
  updatedAt: string | null;
}

export interface PlannerCity {
  operationCityId: string;
  cityId: number;
  stateId: number;
  cityName: string;
  uf: string;
  /** Lideranças principais da cidade que valeram em algum dia da competência, em ordem de início. */
  leaders: PlannerLeader[];
  /** BRs da cidade com liderança própria no mês (exceção por BR). */
  brExceptions: number;
}

export interface PlannerOperation {
  id: string;
  name: string;
  code: string | null;
  cities: PlannerCity[];
}

export interface PlannerCandidate {
  id: string;
  name: string;
  code: string | null;
}

export interface LeadershipPlanner {
  /** "2026-09" */
  competence: string;
  monthStart: string;
  monthEnd: string;
  /** Hoje no fuso da operação (America/Sao_Paulo), como o banco calcula. */
  today: string;
  operations: PlannerOperation[];
  /** Colaboradores ativos do perfil Liderança Operações — o que o seletor oferece. */
  candidates: PlannerCandidate[];
}

/** Resultado de escolher ou remover a liderança de uma cidade. */
export interface CityLeadershipResult {
  action: "assigned" | "replaced" | "removed" | "unchanged";
  employeeName: string | null;
  cityName: string;
  uf: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  previous: {
    employeeName: string | null;
    action: "ended" | "cancelled";
    resumesFrom: string | null;
  } | null;
  retroactive: boolean;
  warnings: string[];
}

export interface CityLeadershipInput {
  operationCityId: string;
  competence: { year: number; month: number };
  /** `null` remove a liderança da cidade. */
  employeeId: string | null;
  /** Obrigatório quando a alteração muda dias que já passaram. */
  reason?: string | null;
}

export type CityLeadershipSaver = (
  input: CityLeadershipInput,
) => Promise<{ ok: boolean; error?: string; data?: CityLeadershipResult }>;

/** Em que situação a competência está em relação a hoje. */
export type CompetenceTense = "past" | "current" | "future";

export function competenceTense(planner: Pick<LeadershipPlanner, "monthStart" | "monthEnd" | "today">): CompetenceTense {
  if (planner.monthEnd < planner.today) return "past";
  if (planner.monthStart > planner.today) return "future";
  return "current";
}

/**
 * O dia que a matriz representa: hoje na competência corrente, o dia 1º numa
 * futura e o último dia numa passada — é a liderança desse dia que o seletor
 * mostra.
 */
export function anchorDate(planner: Pick<LeadershipPlanner, "monthStart" | "monthEnd" | "today">): string {
  const tense = competenceTense(planner);
  if (tense === "current") return planner.today;
  return tense === "future" ? planner.monthStart : planner.monthEnd;
}

/** A liderança que responde pela cidade no dia-âncora, se houver. */
export function leaderAt(city: PlannerCity, day: string): PlannerLeader | null {
  return (
    city.leaders.find((l) => l.effectiveFrom <= day && (l.effectiveTo === null || l.effectiveTo >= day)) ?? null
  );
}

export interface PlannerIndicators {
  /** Cidades das operações ativas no escopo de quem vê. */
  places: number;
  /** Cidades com liderança principal no dia-âncora. */
  assigned: number;
  /** Pessoas distintas nessas cidades. */
  leaders: number;
  /** assigned / places × 100; `null` sem locais. */
  coveragePct: number | null;
}

export function plannerIndicators(operations: PlannerOperation[], day: string): PlannerIndicators {
  let places = 0;
  let assigned = 0;
  const people = new Set<string>();
  for (const op of operations) {
    for (const city of op.cities) {
      places += 1;
      const leader = leaderAt(city, day);
      if (leader) {
        assigned += 1;
        people.add(leader.employeeId);
      }
    }
  }
  return {
    places,
    assigned,
    leaders: people.size,
    coveragePct: places > 0 ? Math.round((assigned / places) * 1000) / 10 : null,
  };
}

/** Aplica à matriz os filtros do topo da página (operação, estado, cidade, liderança). */
export function filterPlanner(
  operations: PlannerOperation[],
  filters: { operationId?: string; stateId?: string; cityId?: string; employeeId?: string },
  day: string,
): PlannerOperation[] {
  return operations
    .filter((op) => !filters.operationId || op.id === filters.operationId)
    .map((op) => ({
      ...op,
      cities: op.cities.filter(
        (c) =>
          (!filters.stateId || c.stateId === Number(filters.stateId)) &&
          (!filters.cityId || c.cityId === Number(filters.cityId)) &&
          (!filters.employeeId || leaderAt(c, day)?.employeeId === filters.employeeId),
      ),
    }))
    .filter((op) => op.cities.length > 0 || (!filters.stateId && !filters.cityId && !filters.employeeId));
}

/* ------------------------------------------------------------ mapeamento */

type Raw = Record<string, unknown>;

const str = (v: unknown): string => (typeof v === "string" ? v : v == null ? "" : String(v));
const strOrNull = (v: unknown): string | null => (v == null || v === "" ? null : String(v));

/** Converte o JSON de `leadership_city_planner` no formato da tela. */
export function mapLeadershipPlanner(raw: unknown): LeadershipPlanner {
  const r = (raw ?? {}) as Raw;
  const operations = Array.isArray(r.operations) ? (r.operations as Raw[]) : [];
  const candidates = Array.isArray(r.candidates) ? (r.candidates as Raw[]) : [];
  return {
    competence: str(r.competence),
    monthStart: str(r.month_start),
    monthEnd: str(r.month_end),
    today: str(r.today),
    operations: operations.map((op) => ({
      id: str(op.id),
      name: str(op.name) || "—",
      code: strOrNull(op.code),
      cities: (Array.isArray(op.cities) ? (op.cities as Raw[]) : []).map((c) => ({
        operationCityId: str(c.operation_city_id),
        cityId: Number(c.city_id),
        stateId: Number(c.state_id),
        cityName: str(c.city_name) || "—",
        uf: str(c.uf),
        brExceptions: Number(c.br_exceptions ?? 0),
        leaders: (Array.isArray(c.leaders) ? (c.leaders as Raw[]) : []).map((l) => ({
          id: str(l.id),
          employeeId: str(l.employee_id),
          employeeName: str(l.employee_name) || "—",
          employeeCode: strOrNull(l.employee_code),
          employeeActive: l.employee_active !== false,
          effectiveFrom: str(l.effective_from),
          effectiveTo: strOrNull(l.effective_to),
          status: l.status === "ended" ? "ended" : "active",
          notes: strOrNull(l.notes),
          updatedAt: strOrNull(l.updated_at),
        })),
      })),
    })),
    candidates: candidates.map((c) => ({ id: str(c.id), name: str(c.name) || "—", code: strOrNull(c.code) })),
  };
}

export function mapCityLeadershipResult(raw: unknown): CityLeadershipResult {
  const r = (raw ?? {}) as Raw;
  const prev = r.previous as Raw | null | undefined;
  const action = str(r.action);
  return {
    action: action === "assigned" || action === "replaced" || action === "removed" ? action : "unchanged",
    employeeName: strOrNull(r.employee_name),
    cityName: str(r.city_name),
    uf: str(r.uf),
    effectiveFrom: str(r.effective_from),
    effectiveTo: strOrNull(r.effective_to),
    previous: prev
      ? {
          employeeName: strOrNull(prev.employee_name),
          action: prev.action === "cancelled" ? "cancelled" : "ended",
          resumesFrom: strOrNull(prev.resumes_from),
        }
      : null,
    retroactive: Boolean(r.retroactive),
    warnings: Array.isArray(r.warnings) ? (r.warnings as unknown[]).map(String) : [],
  };
}
