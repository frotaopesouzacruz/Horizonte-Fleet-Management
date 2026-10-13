/**
 * O Início de cada perfil (pós-login): tipos e conversão do JSON das rotinas
 * `my_operational_home` e `my_leadership_home`.
 *
 * Puro de propósito — sem "server-only" e sem Supabase: a prévia de
 * desenvolvimento e os testes convertem dados fixos com as mesmas funções que
 * a rota real usa.
 */

export type ChecklistContextKind = "saida" | "retorno";

export interface PortalIdentity {
  id: string;
  name: string;
  code: string | null;
  jobPosition: string | null;
  operationName: string | null;
  unitName: string | null;
}

export interface OperationalExecution {
  id: string;
  date: string;
  context: ChecklistContextKind;
  licensePlate: string | null;
  fleetCode: string | null;
  operationName: string | null;
  brCode: string | null;
  startedAt: string | null;
  submittedAt: string | null;
  durationSeconds: number | null;
  nonConforming: number;
  criticalNonConforming: number;
  source: "app" | "import";
}

export interface OperationalReports {
  windowDays: number;
  total: number;
  open: number;
  resolved: number;
  closedOther: number;
}

export interface OperationalHome {
  today: string;
  year: number;
  month: number;
  dateFrom: string;
  dateTo: string;
  employee: PortalIdentity | null;
  checklists: {
    total: number;
    monthTotal: number;
    last30Days: number;
    lastSubmittedAt: string | null;
    lastDate: string | null;
  };
  executions: OperationalExecution[];
  executionsTruncated: boolean;
  /** Null quando a conta não pode ver os próprios apontamentos. */
  reports: OperationalReports | null;
}

export type ResponsibilityLevel = "operation" | "city" | "br";
export type ResponsibilityType = "principal" | "substitute" | "support";

export interface LeadershipResponsibility {
  scopeLevel: ResponsibilityLevel;
  responsibilityType: ResponsibilityType;
  operationId: string | null;
  operationName: string | null;
  cityName: string | null;
  uf: string | null;
  brCode: string | null;
  effectiveFrom: string | null;
  effectiveTo: string | null;
}

export interface TeamMember {
  id: string;
  name: string;
  code: string | null;
  jobPosition: string | null;
  today: number;
  week: number;
  lastDate: string | null;
}

export interface LeadershipTeam {
  members: number;
  withChecklistToday: number;
  withoutChecklistToday: number;
  withoutChecklistWeek: number;
  withoutWeekNames: string[];
  list: TeamMember[];
  truncated: boolean;
}

export interface LeadershipHome {
  today: string;
  weekFrom: string;
  employee: PortalIdentity | null;
  scope: {
    allOperations: boolean;
    operations: { id: string; name: string; status: string | null }[];
    responsibilities: LeadershipResponsibility[];
  };
  /** Null quando a conta não tem colaborador vinculado: não há "equipe de ninguém". */
  team: LeadershipTeam | null;
}

/** O resultado de um bloco do Início: dado ou o motivo de não ter vindo — nunca zero no lugar do erro. */
export type Loaded<T> = { ok: true; data: T } | { ok: false; error: string };

type Raw = Record<string, unknown>;
const obj = (v: unknown): Raw => (v && typeof v === "object" && !Array.isArray(v) ? (v as Raw) : {});
const arr = (v: unknown): Raw[] => (Array.isArray(v) ? (v as Raw[]) : []);
const num = (v: unknown): number => (v == null ? 0 : Number(v) || 0);
const numOrNull = (v: unknown): number | null => (v == null ? null : Number(v));
const str = (v: unknown): string => (v == null ? "" : String(v));
const strOrNull = (v: unknown): string | null => (v == null || v === "" ? null : String(v));

function mapIdentity(v: unknown): PortalIdentity | null {
  if (v == null) return null;
  const r = obj(v);
  if (!r.id) return null;
  return {
    id: str(r.id),
    name: str(r.name),
    code: strOrNull(r.code),
    jobPosition: strOrNull(r.job_position),
    operationName: strOrNull(r.operation_name),
    unitName: strOrNull(r.unit_name),
  };
}

export function mapOperationalHome(data: unknown): OperationalHome {
  const r = obj(data);
  const c = obj(r.checklists);
  const reports = r.reports == null ? null : obj(r.reports);
  return {
    today: str(r.today),
    year: num(r.year),
    month: num(r.month),
    dateFrom: str(r.date_from),
    dateTo: str(r.date_to),
    employee: mapIdentity(r.employee),
    checklists: {
      total: num(c.total),
      monthTotal: num(c.month_total),
      last30Days: num(c.last_30_days),
      lastSubmittedAt: strOrNull(c.last_submitted_at),
      lastDate: strOrNull(c.last_date),
    },
    executions: arr(r.executions).map((e) => ({
      id: str(e.id),
      date: str(e.date),
      context: e.context === "retorno" ? "retorno" : "saida",
      licensePlate: strOrNull(e.license_plate),
      fleetCode: strOrNull(e.fleet_code),
      operationName: strOrNull(e.operation_name),
      brCode: strOrNull(e.br_code),
      startedAt: strOrNull(e.started_at),
      submittedAt: strOrNull(e.submitted_at),
      durationSeconds: numOrNull(e.duration_seconds),
      nonConforming: num(e.non_conforming),
      criticalNonConforming: num(e.critical_non_conforming),
      source: e.source === "import" ? "import" : "app",
    })),
    executionsTruncated: r.executions_truncated === true,
    reports: reports
      ? {
          windowDays: num(reports.window_days) || 90,
          total: num(reports.total),
          open: num(reports.open),
          resolved: num(reports.resolved),
          closedOther: num(reports.closed_other),
        }
      : null,
  };
}

const LEVELS: ResponsibilityLevel[] = ["operation", "city", "br"];
const TYPES: ResponsibilityType[] = ["principal", "substitute", "support"];

export function mapLeadershipHome(data: unknown): LeadershipHome {
  const r = obj(data);
  const scope = obj(r.scope);
  const team = r.team == null ? null : obj(r.team);
  return {
    today: str(r.today),
    weekFrom: str(r.week_from),
    employee: mapIdentity(r.employee),
    scope: {
      allOperations: scope.all_operations === true,
      operations: arr(scope.operations).map((o) => ({ id: str(o.id), name: str(o.name), status: strOrNull(o.status) })),
      responsibilities: arr(scope.responsibilities).map((x) => ({
        scopeLevel: LEVELS.includes(x.scope_level as ResponsibilityLevel) ? (x.scope_level as ResponsibilityLevel) : "operation",
        responsibilityType: TYPES.includes(x.responsibility_type as ResponsibilityType)
          ? (x.responsibility_type as ResponsibilityType)
          : "principal",
        operationId: strOrNull(x.operation_id),
        operationName: strOrNull(x.operation_name),
        cityName: strOrNull(x.city_name),
        uf: strOrNull(x.uf),
        brCode: strOrNull(x.br_code),
        effectiveFrom: strOrNull(x.effective_from),
        effectiveTo: strOrNull(x.effective_to),
      })),
    },
    team: team
      ? {
          members: num(team.members),
          withChecklistToday: num(team.with_checklist_today),
          withoutChecklistToday: num(team.without_checklist_today),
          withoutChecklistWeek: num(team.without_checklist_week),
          withoutWeekNames: Array.isArray(team.without_week_names) ? team.without_week_names.map(String) : [],
          list: arr(team.list).map((m) => ({
            id: str(m.id),
            name: str(m.name),
            code: strOrNull(m.code),
            jobPosition: strOrNull(m.job_position),
            today: num(m.today),
            week: num(m.week),
            lastDate: strOrNull(m.last_date),
          })),
          truncated: team.truncated === true,
        }
      : null,
  };
}
