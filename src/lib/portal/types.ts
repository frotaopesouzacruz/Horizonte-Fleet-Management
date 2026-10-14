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

/** Uma obrigação oficial de hoje da própria pessoa (Motor de Aderência). */
export interface TodayAction {
  obligationId: string;
  context: ChecklistContextKind;
  journey: number;
  /** Código oficial (FEZ_CHECKLIST, NAO_FEZ_CHECKLIST, RETORNO_PENDENTE, PLANEJADO, expurgos…). */
  status: string;
  due: boolean;
  done: boolean;
  excluded: boolean;
  provisional: boolean;
  pendingRequest: boolean;
  expectedAt: string | null;
  deadlineAt: string | null;
  vehicleId: string | null;
  licensePlate: string | null;
  fleetCode: string | null;
  brCode: string | null;
  operationName: string | null;
  cityName: string | null;
}

export interface MyVehicle {
  id: string;
  licensePlate: string | null;
  fleetCode: string | null;
  typeName: string | null;
  modelName: string | null;
  status: string | null;
  brCode: string | null;
  operationName: string | null;
  cityName: string | null;
  uf: string | null;
  odometerKm: number | null;
  odometerDate: string | null;
  lastChecklist: { date: string; context: ChecklistContextKind; submittedAt: string | null; mine: boolean } | null;
  /** Null quando a conta não vê apontamentos. */
  openReports: number | null;
  maintenance: {
    id: string;
    code: string;
    status: string;
    scheduledDate: string | null;
    entryDate: string | null;
    expectedExitDate: string | null;
  } | null;
}

export type ActivityKind = "checklist" | "mtsr" | "tires";

/** Vistoria devolvida ao campo: só a própria pessoa resolve. */
export interface PendingInspection {
  kind: Exclude<ActivityKind, "checklist">;
  id: string;
  protocol: string | null;
  licensePlate: string | null;
  date: string;
  status: string;
  reason: string | null;
  reviewedAt: string | null;
}

export interface RecentActivity {
  kind: ActivityKind;
  id: string;
  date: string;
  submittedAt: string | null;
  licensePlate: string | null;
  context: ChecklistContextKind | null;
  protocol: string | null;
  status: string;
  nonConforming: number | null;
}

export interface HomeApp {
  code: string;
  slug: string;
  name: string;
  /** Null quando a pessoa não tem operação no vínculo: a permissão decide sozinha. */
  enabled: boolean | null;
}

export interface OperationalHome {
  today: string;
  year: number;
  month: number;
  dateFrom: string;
  dateTo: string;
  employee: PortalIdentity | null;
  operationId: string | null;
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
  /** Null quando a conta não consulta a própria situação (adherence.view_own). */
  todayActions: TodayAction[] | null;
  /** Null sem fidelização vigente hoje. */
  vehicle: MyVehicle | null;
  pending: PendingInspection[];
  recent: RecentActivity[];
  apps: HomeApp[];
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
    operationId: strOrNull(r.operation_id),
    todayActions: r.today_actions == null ? null : arr(r.today_actions).map(mapTodayAction),
    vehicle: mapVehicle(r.vehicle),
    pending: arr(r.pending).map((x) => ({
      kind: x.kind === "tires" ? "tires" : "mtsr",
      id: str(x.id),
      protocol: strOrNull(x.protocol),
      licensePlate: strOrNull(x.license_plate),
      date: str(x.date),
      status: str(x.status),
      reason: strOrNull(x.reason),
      reviewedAt: strOrNull(x.reviewed_at),
    })),
    recent: arr(r.recent).map((x) => ({
      kind: x.kind === "mtsr" ? "mtsr" : x.kind === "tires" ? "tires" : "checklist",
      id: str(x.id),
      date: str(x.date),
      submittedAt: strOrNull(x.submitted_at),
      licensePlate: strOrNull(x.license_plate),
      context: x.context === "retorno" ? "retorno" : x.context === "saida" ? "saida" : null,
      protocol: strOrNull(x.protocol),
      status: str(x.status),
      nonConforming: numOrNull(x.non_conforming),
    })),
    apps: mapHomeApps(r.apps),
  };
}

/** O catálogo de aplicativos da organização (`my_apps` e `apps` do Início). */
export function mapHomeApps(v: unknown): HomeApp[] {
  return arr(v).map((a) => ({
    code: str(a.code),
    slug: str(a.slug),
    name: str(a.name),
    enabled: a.enabled == null ? null : a.enabled === true,
  }));
}

function mapTodayAction(x: Raw): TodayAction {
  return {
    obligationId: str(x.obligation_id),
    context: x.context === "retorno" ? "retorno" : "saida",
    journey: num(x.journey) || 1,
    status: str(x.status),
    due: x.due === true,
    done: x.done === true,
    excluded: x.excluded === true,
    provisional: x.provisional === true,
    pendingRequest: x.pending_request === true,
    expectedAt: strOrNull(x.expected_at),
    deadlineAt: strOrNull(x.deadline_at),
    vehicleId: strOrNull(x.vehicle_id),
    licensePlate: strOrNull(x.license_plate),
    fleetCode: strOrNull(x.fleet_code),
    brCode: strOrNull(x.br_code),
    operationName: strOrNull(x.operation_name),
    cityName: strOrNull(x.city_name),
  };
}

function mapVehicle(v: unknown): MyVehicle | null {
  if (v == null) return null;
  const r = obj(v);
  if (!r.id) return null;
  const last = r.last_checklist == null ? null : obj(r.last_checklist);
  const m = r.maintenance == null ? null : obj(r.maintenance);
  return {
    id: str(r.id),
    licensePlate: strOrNull(r.license_plate),
    fleetCode: strOrNull(r.fleet_code),
    typeName: strOrNull(r.type_name),
    modelName: strOrNull(r.model_name),
    status: strOrNull(r.status),
    brCode: strOrNull(r.br_code),
    operationName: strOrNull(r.operation_name),
    cityName: strOrNull(r.city_name),
    uf: strOrNull(r.uf),
    odometerKm: numOrNull(r.odometer_km),
    odometerDate: strOrNull(r.odometer_date),
    lastChecklist:
      last && last.date
        ? { date: str(last.date), context: last.context === "retorno" ? "retorno" : "saida", submittedAt: strOrNull(last.submitted_at), mine: last.mine === true }
        : null,
    openReports: numOrNull(r.open_reports),
    maintenance:
      m && m.id
        ? {
            id: str(m.id),
            code: str(m.code),
            status: str(m.status),
            scheduledDate: strOrNull(m.scheduled_date),
            entryDate: strOrNull(m.entry_date),
            expectedExitDate: strOrNull(m.expected_exit_date),
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
