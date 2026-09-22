import "server-only";

import { createClient } from "@/lib/supabase/server";
import type { Competence } from "./competence";
import { brPlannerPayload, mapBrPlannerRow, type BrPlannerFilters, type BrPlannerRow } from "./br-planner";

/**
 * Módulo BRs (Etapa 13.1).
 *
 * Nada aqui cria entidade: a BR continua sendo `operation_brs` (§18/§20), o
 * vínculo `fidelization_assignments`, o motorista `fidelization_drivers` e a
 * liderança `leadership_assignments`. Este arquivo é o modelo de leitura do
 * módulo — listagem paginada no servidor (§24), detalhe completo (§29), BR
 * atual e anteriores de um veículo (§48) e o serviço central de contexto (§47)
 * — resolvido em uma consulta por tela, nunca em uma por linha (§67).
 */

/* ---------------------------------------------------------------- diretório */

export type BrSort =
  | "code"
  | "operation"
  | "city"
  | "leader"
  | "vehicle"
  | "driver"
  | "last_movement"
  | "status";

export const BR_SORTS: BrSort[] = [
  "code", "operation", "city", "leader", "vehicle", "driver", "last_movement", "status",
];

export interface BrDirectoryRow extends BrPlannerRow {
  /** Última criação ou alteração de vínculo de veículo desta BR. */
  lastMovementAt: string | null;
  /** Houve substituição ou inversão de veículo iniciada na competência. */
  swappedInPeriod: boolean;
}

export interface BrDirectoryPage {
  total: number;
  limit: number;
  offset: number;
  competence: string;
  periodStart: string;
  periodEnd: string;
  rows: BrDirectoryRow[];
}

export interface BrDirectoryOptions {
  limit?: number;
  offset?: number;
  sort?: string;
  dir?: string;
}

export const BR_PAGE_SIZE = 50;

/**
 * §24: a listagem do módulo, paginada e ordenada no servidor. Os filtros são
 * os mesmos do planner (§25) mais "com/sem substituição no período"; a
 * resolução de liderança, veículo e motorista é a de `br_planner_rows`, então
 * o módulo BRs e o Planner de Locais nunca discordam sobre a mesma BR.
 */
export async function getBrDirectory(
  organizationId: string,
  competence: Competence,
  filters: BrPlannerFilters = {},
  options: BrDirectoryOptions = {},
): Promise<BrDirectoryPage> {
  const supabase = await createClient();
  const sort = BR_SORTS.includes(options.sort as BrSort) ? (options.sort as BrSort) : "code";
  const { data, error } = await supabase.rpc("br_directory", {
    p_organization_id: organizationId,
    p_year: competence.year,
    p_month: competence.month,
    p_filters: brPlannerPayload(filters),
    p_limit: options.limit ?? BR_PAGE_SIZE,
    p_offset: options.offset ?? 0,
    p_sort: sort,
    p_dir: options.dir === "desc" ? "desc" : "asc",
  });
  if (error) throw new Error(error.message);

  const raw = (data ?? {}) as Record<string, unknown>;
  const rows = Array.isArray(raw.rows) ? (raw.rows as unknown[]) : [];
  return {
    total: Number(raw.total ?? 0),
    limit: Number(raw.limit ?? BR_PAGE_SIZE),
    offset: Number(raw.offset ?? 0),
    competence: String(raw.competence ?? ""),
    periodStart: String(raw.period_start ?? ""),
    periodEnd: String(raw.period_end ?? ""),
    rows: rows.map((row): BrDirectoryRow => {
      const r = row as Record<string, unknown>;
      return {
        ...mapBrPlannerRow(row),
        lastMovementAt: (r.last_movement_at as string) ?? null,
        swappedInPeriod: Boolean(r.swapped_in_period),
      };
    }),
  };
}

/* ----------------------------------------------------------------- contexto */

export interface OperationalContext {
  date: string;
  operation: { id: string; code: string | null; name: string; status: string };
  state: { id: number; uf: string; name: string };
  city: { id: number; name: string; operationCityId: string };
  br: { id: string; code: string; description: string | null; status: string };
  vehicle: {
    id: string;
    fleetCode: string | null;
    licensePlate: string | null;
    vehicleTypeId: string | null;
    vehicleTypeName: string | null;
    assignmentId: string;
    effectiveFrom: string;
    effectiveTo: string | null;
    status: string;
    source: string;
    reason: string | null;
  } | null;
  driver: {
    employeeId: string;
    name: string;
    employeeCode: string | null;
    driverId: string;
    role: string;
    effectiveFrom: string;
    effectiveTo: string | null;
    status: string;
  } | null;
  leadership: {
    employeeId: string;
    name: string;
    scopeLevel: "br" | "city" | "operation";
    assignmentId: string;
    effectiveFrom: string | null;
    effectiveTo: string | null;
    /** Texto da regra que respondeu: "exceção do BR", "operação + cidade + competência" ou "operação". */
    rule: string;
  } | null;
  unit: { id: string; code: string | null; name: string } | null;
  origins: { vehicle: string | null; leadership: string | null; driver: string | null };
}

function str(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value);
}

export function mapOperationalContext(raw: unknown): OperationalContext | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, Record<string, unknown> | null | string>;
  const op = (r.operation ?? {}) as Record<string, unknown>;
  const st = (r.state ?? {}) as Record<string, unknown>;
  const ci = (r.city ?? {}) as Record<string, unknown>;
  const br = (r.br ?? {}) as Record<string, unknown>;
  const veh = r.vehicle as Record<string, unknown> | null;
  const drv = r.driver as Record<string, unknown> | null;
  const lead = r.leadership as Record<string, unknown> | null;
  const unit = r.unit as Record<string, unknown> | null;
  const origins = (r.origins ?? {}) as Record<string, unknown>;
  const scope = lead?.scope_level;

  return {
    date: String(r.date ?? ""),
    operation: { id: String(op.id), code: str(op.code), name: String(op.name ?? "—"), status: String(op.status ?? "") },
    state: { id: Number(st.id), uf: String(st.uf ?? "").trim(), name: String(st.name ?? "") },
    city: { id: Number(ci.id), name: String(ci.name ?? ""), operationCityId: String(ci.operation_city_id ?? "") },
    br: { id: String(br.id), code: String(br.code ?? ""), description: str(br.description), status: String(br.status ?? "") },
    vehicle: veh && veh.id
      ? {
          id: String(veh.id),
          fleetCode: str(veh.fleet_code),
          licensePlate: str(veh.license_plate),
          vehicleTypeId: str(veh.vehicle_type_id),
          vehicleTypeName: str(veh.vehicle_type_name),
          assignmentId: String(veh.assignment_id),
          effectiveFrom: String(veh.effective_from),
          effectiveTo: str(veh.effective_to),
          status: String(veh.status ?? ""),
          source: String(veh.source ?? ""),
          reason: str(veh.reason),
        }
      : null,
    driver: drv && drv.employee_id
      ? {
          employeeId: String(drv.employee_id),
          name: String(drv.name ?? "—"),
          employeeCode: str(drv.employee_code),
          driverId: String(drv.driver_id),
          role: String(drv.role ?? "primary"),
          effectiveFrom: String(drv.effective_from),
          effectiveTo: str(drv.effective_to),
          status: String(drv.status ?? ""),
        }
      : null,
    leadership: lead && lead.employee_id
      ? {
          employeeId: String(lead.employee_id),
          name: String(lead.name ?? "—"),
          scopeLevel: scope === "br" || scope === "city" ? scope : "operation",
          assignmentId: String(lead.assignment_id),
          effectiveFrom: str(lead.effective_from),
          effectiveTo: str(lead.effective_to),
          rule: String(lead.rule ?? ""),
        }
      : null,
    unit: unit && unit.id ? { id: String(unit.id), code: str(unit.code), name: String(unit.name ?? "") } : null,
    origins: {
      vehicle: str(origins.vehicle),
      leadership: str(origins.leadership),
      driver: str(origins.driver),
    },
  };
}

/**
 * §45/§47: o serviço central de contexto. Dada uma BR e uma data, devolve
 * operação, estado, cidade, veículo, motorista, liderança e filial que valiam
 * NAQUELA data — o que Aderência, Check List, Planos de Ação e Manutenção
 * consomem em vez de resolver cada vínculo por conta própria. Devolve null
 * quando a BR não existe ou está fora do escopo de quem pergunta.
 */
export async function getOperationalContext(
  organizationId: string,
  operationBrId: string,
  date?: string,
): Promise<OperationalContext | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("resolve_operational_context", {
    p_organization_id: organizationId,
    p_operation_br_id: operationBrId,
    p_date: date ?? undefined,
  });
  if (error) throw new Error(error.message);
  return mapOperationalContext(data);
}

/* ------------------------------------------------------------------ detalhe */

export interface BrLeadershipHistoryRow {
  id: string;
  employeeId: string;
  employeeName: string;
  scopeLevel: "br" | "city" | "operation";
  responsibilityType: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  status: string;
  notes: string | null;
}

export interface BrVehicleRow {
  assignmentId: string;
  vehicleId: string;
  fleetCode: string | null;
  licensePlate: string | null;
  vehicleRole: "primary" | "support";
  startDate: string;
  endDate: string | null;
  status: string;
  source: string;
  reason: string | null;
  endReason: string | null;
  replacesAssignmentId: string | null;
  createdAt: string;
}

export interface BrDriverRow {
  driverId: string;
  assignmentId: string;
  employeeId: string;
  employeeName: string;
  employeeCode: string | null;
  driverRole: string;
  startDate: string;
  endDate: string | null;
  status: string;
  reason: string | null;
  endReason: string | null;
  vehicleId: string;
  fleetCode: string | null;
  licensePlate: string | null;
}

export interface BrMovementRow {
  assignmentId: string;
  /** substitution | inversion | import (substituição por importação). */
  kind: string;
  effectiveFrom: string;
  newVehicleId: string;
  newFleetCode: string | null;
  newLicensePlate: string | null;
  previousAssignmentId: string | null;
  previousVehicleId: string | null;
  previousFleetCode: string | null;
  previousLicensePlate: string | null;
  reason: string | null;
  createdAt: string;
  createdBy: string | null;
  /** Quem registrou, pelo perfil — o ator real, nunca um nome digitado. */
  actorName: string | null;
}

export interface BrDetailIndicators {
  daysWithVehicle: number;
  daysInPeriod: number;
  vehicleSwapsInPeriod: number;
  driverChangesInPeriod: number;
  checklistsInPeriod: number;
  adherenceExpectedInPeriod: number;
  adherenceDoneInPeriod: number;
}

export interface BrDetail {
  br: {
    id: string;
    code: string;
    description: string | null;
    status: "active" | "inactive";
    statusReason: string | null;
    notes: string | null;
    operationId: string;
    operationName: string;
    operationCode: string | null;
    operationCityId: string;
    stateId: number;
    stateUf: string;
    cityId: number;
    cityName: string;
    createdAt: string;
    updatedAt: string | null;
  };
  competence: string;
  anchorDate: string;
  context: OperationalContext | null;
  leadershipHistory: BrLeadershipHistoryRow[];
  vehicleHistory: BrVehicleRow[];
  driverHistory: BrDriverRow[];
  movements: BrMovementRow[];
  indicators: BrDetailIndicators;
}

export function mapBrDetail(raw: unknown): BrDetail | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const b = (r.br ?? {}) as Record<string, unknown>;
  const ind = (r.indicators ?? {}) as Record<string, unknown>;
  const list = (key: string) => (Array.isArray(r[key]) ? (r[key] as Record<string, unknown>[]) : []);
  const scope = (value: unknown): "br" | "city" | "operation" =>
    value === "br" || value === "city" ? value : "operation";

  return {
    br: {
      id: String(b.id),
      code: String(b.code ?? ""),
      description: str(b.description),
      status: b.status === "inactive" ? "inactive" : "active",
      statusReason: str(b.status_reason),
      notes: str(b.notes),
      operationId: String(b.operation_id),
      operationName: String(b.operation_name ?? "—"),
      operationCode: str(b.operation_code),
      operationCityId: String(b.operation_city_id ?? ""),
      stateId: Number(b.state_id),
      stateUf: String(b.state_uf ?? "").trim(),
      cityId: Number(b.city_id),
      cityName: String(b.city_name ?? ""),
      createdAt: String(b.created_at ?? ""),
      updatedAt: str(b.updated_at),
    },
    competence: String(r.competence ?? ""),
    anchorDate: String(r.anchor_date ?? ""),
    context: mapOperationalContext(r.context),
    leadershipHistory: list("leadership_history").map((l) => ({
      id: String(l.id),
      employeeId: String(l.employee_id),
      employeeName: String(l.employee_name ?? "—"),
      scopeLevel: scope(l.scope_level),
      responsibilityType: String(l.responsibility_type ?? "principal"),
      effectiveFrom: String(l.effective_from),
      effectiveTo: str(l.effective_to),
      status: String(l.status ?? ""),
      notes: str(l.notes),
    })),
    vehicleHistory: list("vehicle_history").map((h) => ({
      assignmentId: String(h.assignment_id),
      vehicleId: String(h.vehicle_id),
      fleetCode: str(h.fleet_code),
      licensePlate: str(h.license_plate),
      vehicleRole: h.vehicle_role === "support" ? "support" : "primary",
      startDate: String(h.start_date),
      endDate: str(h.end_date),
      status: String(h.status ?? ""),
      source: String(h.source ?? ""),
      reason: str(h.reason),
      endReason: str(h.end_reason),
      replacesAssignmentId: str(h.replaces_assignment_id),
      createdAt: String(h.created_at ?? ""),
    })),
    driverHistory: list("driver_history").map((d) => ({
      driverId: String(d.driver_id),
      assignmentId: String(d.assignment_id),
      employeeId: String(d.employee_id),
      employeeName: String(d.employee_name ?? "—"),
      employeeCode: str(d.employee_code),
      driverRole: String(d.driver_role ?? "primary"),
      startDate: String(d.start_date),
      endDate: str(d.end_date),
      status: String(d.status ?? ""),
      reason: str(d.reason),
      endReason: str(d.end_reason),
      vehicleId: String(d.vehicle_id),
      fleetCode: str(d.fleet_code),
      licensePlate: str(d.license_plate),
    })),
    movements: list("movements").map((m) => ({
      assignmentId: String(m.assignment_id),
      kind: String(m.kind ?? ""),
      effectiveFrom: String(m.effective_from),
      newVehicleId: String(m.new_vehicle_id),
      newFleetCode: str(m.new_fleet_code),
      newLicensePlate: str(m.new_license_plate),
      previousAssignmentId: str(m.previous_assignment_id),
      previousVehicleId: str(m.previous_vehicle_id),
      previousFleetCode: str(m.previous_fleet_code),
      previousLicensePlate: str(m.previous_license_plate),
      reason: str(m.reason),
      createdAt: String(m.created_at ?? ""),
      createdBy: str(m.created_by),
      actorName: str(m.actor_name),
    })),
    indicators: {
      daysWithVehicle: Number(ind.days_with_vehicle ?? 0),
      daysInPeriod: Number(ind.days_in_period ?? 0),
      vehicleSwapsInPeriod: Number(ind.vehicle_swaps_in_period ?? 0),
      driverChangesInPeriod: Number(ind.driver_changes_in_period ?? 0),
      checklistsInPeriod: Number(ind.checklists_in_period ?? 0),
      adherenceExpectedInPeriod: Number(ind.adherence_expected_in_period ?? 0),
      adherenceDoneInPeriod: Number(ind.adherence_done_in_period ?? 0),
    },
  };
}

/**
 * §29: o detalhe completo de uma BR na competência — dados, contexto na
 * data-âncora, lideranças que a alcançam, veículos e motoristas que passaram
 * por ela, movimentações com ator real e indicadores do mês. Null quando a BR
 * não existe ou está fora do escopo.
 */
export async function getBrDetail(
  organizationId: string,
  operationBrId: string,
  competence: Competence,
): Promise<BrDetail | null> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("br_detail", {
    p_organization_id: organizationId,
    p_operation_br_id: operationBrId,
    p_year: competence.year,
    p_month: competence.month,
  });
  if (error) throw new Error(error.message);
  return mapBrDetail(data);
}

/* ------------------------------------------------------------ BR do veículo */

export interface VehicleBrRow {
  assignmentId: string;
  operationBrId: string;
  brCode: string;
  brDescription: string | null;
  brStatus: string;
  operationId: string;
  operationName: string;
  cityName: string;
  stateUf: string;
  vehicleRole: "primary" | "support";
  startDate: string;
  endDate: string | null;
  status: string;
  source: string;
  reason: string | null;
  endReason: string | null;
  replacesAssignmentId: string | null;
  isCurrent: boolean;
}

export interface VehicleBrHistory {
  current: VehicleBrRow | null;
  history: VehicleBrRow[];
  substitutions: number;
}

function mapVehicleBrRow(row: unknown): VehicleBrRow {
  const r = row as Record<string, unknown>;
  return {
    assignmentId: String(r.assignment_id),
    operationBrId: String(r.operation_br_id),
    brCode: String(r.br_code ?? ""),
    brDescription: str(r.br_description),
    brStatus: String(r.br_status ?? ""),
    operationId: String(r.operation_id),
    operationName: String(r.operation_name ?? "—"),
    cityName: String(r.city_name ?? ""),
    stateUf: String(r.state_uf ?? "").trim(),
    vehicleRole: r.vehicle_role === "support" ? "support" : "primary",
    startDate: String(r.start_date),
    endDate: str(r.end_date),
    status: String(r.status ?? ""),
    source: String(r.source ?? ""),
    reason: str(r.reason),
    endReason: str(r.end_reason),
    replacesAssignmentId: str(r.replaces_assignment_id),
    isCurrent: Boolean(r.is_current),
  };
}

export function mapVehicleBrHistory(raw: unknown): VehicleBrHistory {
  const r = (raw ?? {}) as Record<string, unknown>;
  const history = Array.isArray(r.history) ? (r.history as unknown[]) : [];
  return {
    current: r.current ? mapVehicleBrRow(r.current) : null,
    history: history.map(mapVehicleBrRow),
    substitutions: Number(r.substitutions ?? 0),
  };
}

/**
 * §48: a BR atual e as anteriores de um veículo, para a aba Fidelização do
 * Cadastro de Frotas. Lê os vínculos pelo `vehicle_id` oficial — nunca pela
 * placa, que pode mudar de dono.
 */
export async function getVehicleBrHistory(
  organizationId: string,
  vehicleId: string,
): Promise<VehicleBrHistory> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("vehicle_br_history", {
    p_organization_id: organizationId,
    p_vehicle_id: vehicleId,
  });
  if (error) throw new Error(error.message);
  return mapVehicleBrHistory(data);
}

/* -------------------------------------------------------------- estabilidade */

export interface StabilityBreakdownRow {
  /** operation_id, city_id ou employee_id — o que agrupou. */
  key: string;
  label: string;
  sublabel: string | null;
  brs: number;
  withVehicle: number;
  mobilizations: number;
  brsWithChange: number;
  stabilityPct: number | null;
}

export interface FidelizationStability {
  competence: string;
  anchorDate: string;
  periodStart: string;
  periodEnd: string;
  brsTotal: number;
  brsWithVehicle: number;
  brsWithVehicleNow: number;
  brsWithoutVehicleNow: number;
  brsWithDriver: number;
  brsWithoutDriver: number;
  brsWithLeader: number;
  vehicleSubstitutions: number;
  /** Pares: uma inversão gera duas linhas e conta como um evento. */
  vehicleInversions: number;
  /** substituições + inversões — eventos explícitos, sem contagem dupla. */
  mobilizations: number;
  brsWithVehicleChange: number;
  /** Trocas observadas na matriz sem evento explícito por trás: informadas à parte, nunca somadas. */
  inferredVehicleChanges: number;
  driverChanges: number;
  brsWithDriverChange: number;
  fleetStabilityPct: number | null;
  driverStabilityPct: number | null;
  leadershipCoveragePct: number | null;
  byOperation: StabilityBreakdownRow[];
  byCity: StabilityBreakdownRow[];
  byLeader: StabilityBreakdownRow[];
}

export interface StabilityFilters {
  operationId?: string;
  stateId?: string;
  cityId?: string;
  leaderEmployeeId?: string;
}

function pct(value: unknown): number | null {
  return value === null || value === undefined ? null : Number(value);
}

export function mapFidelizationStability(raw: unknown): FidelizationStability {
  const r = (raw ?? {}) as Record<string, unknown>;
  const num = (key: string) => Number(r[key] ?? 0);
  const list = (key: string) => (Array.isArray(r[key]) ? (r[key] as Record<string, unknown>[]) : []);
  const row = (e: Record<string, unknown>, key: string, label: string, sublabel: string | null): StabilityBreakdownRow => ({
    key,
    label,
    sublabel,
    brs: Number(e.brs ?? 0),
    withVehicle: Number(e.with_vehicle ?? 0),
    mobilizations: Number(e.mobilizations ?? 0),
    brsWithChange: Number(e.brs_with_change ?? 0),
    stabilityPct: pct(e.stability_pct),
  });

  return {
    competence: String(r.competence ?? ""),
    anchorDate: String(r.anchor_date ?? ""),
    periodStart: String(r.period_start ?? ""),
    periodEnd: String(r.period_end ?? ""),
    brsTotal: num("brs_total"),
    brsWithVehicle: num("brs_with_vehicle"),
    brsWithVehicleNow: num("brs_with_vehicle_now"),
    brsWithoutVehicleNow: num("brs_without_vehicle_now"),
    brsWithDriver: num("brs_with_driver"),
    brsWithoutDriver: num("brs_without_driver"),
    brsWithLeader: num("brs_with_leader"),
    vehicleSubstitutions: num("vehicle_substitutions"),
    vehicleInversions: num("vehicle_inversions"),
    mobilizations: num("mobilizations"),
    brsWithVehicleChange: num("brs_with_vehicle_change"),
    inferredVehicleChanges: num("inferred_vehicle_changes"),
    driverChanges: num("driver_changes"),
    brsWithDriverChange: num("brs_with_driver_change"),
    fleetStabilityPct: pct(r.fleet_stability_pct),
    driverStabilityPct: pct(r.driver_stability_pct),
    leadershipCoveragePct: pct(r.leadership_coverage_pct),
    byOperation: list("by_operation").map((e) =>
      row(e, String(e.operation_id), String(e.operation_name ?? "—"), null),
    ),
    byCity: list("by_city").map((e) =>
      row(
        e,
        `${e.operation_name}:${e.city_id}`,
        `${String(e.city_name ?? "")}/${String(e.state_uf ?? "").trim()}`,
        String(e.operation_name ?? ""),
      ),
    ),
    byLeader: list("by_leader").map((e) =>
      row(e, String(e.employee_id ?? "none"), String(e.leader_name ?? "Sem liderança"), null),
    ),
  };
}

/**
 * §39–§43: o Dashboard de Estabilidade, com as fórmulas definidas no banco e
 * documentadas em docs/modules/fidelization.md. Substituição e inversão são
 * eventos explícitos; a troca observada na matriz sem evento é "inferida" e
 * fica em número separado, para não contar a mesma mobilização duas vezes.
 */
export async function getFidelizationStability(
  organizationId: string,
  competence: Competence,
  filters: StabilityFilters = {},
): Promise<FidelizationStability> {
  const supabase = await createClient();
  const payload: Record<string, string> = {};
  if (filters.operationId) payload.operation_id = filters.operationId;
  if (filters.stateId) payload.state_id = filters.stateId;
  if (filters.cityId) payload.city_id = filters.cityId;
  if (filters.leaderEmployeeId) payload.leader_employee_id = filters.leaderEmployeeId;

  const { data, error } = await supabase.rpc("fidelization_stability", {
    p_organization_id: organizationId,
    p_year: competence.year,
    p_month: competence.month,
    p_filters: payload,
  });
  if (error) throw new Error(error.message);
  return mapFidelizationStability(data);
}

/* --------------------------------------------------- escopo de uma liderança */

export interface LeadershipScopeBr {
  id: string;
  code: string;
  operationName: string;
  cityName: string;
  stateUf: string;
  scopeLevel: "br" | "city" | "operation";
  fleetCode: string | null;
  licensePlate: string | null;
  driverName: string | null;
}

export interface LeadershipScopeSummary {
  employeeId: string;
  competence: string;
  anchorDate: string;
  operations: { operationId: string; operationName: string }[];
  cities: { operationCityId: string; cityName: string; stateUf: string; operationName: string }[];
  brsTotal: number;
  brs: LeadershipScopeBr[];
  vehiclesTotal: number;
  driversTotal: number;
}

export function mapLeadershipScopeSummary(raw: unknown): LeadershipScopeSummary {
  const r = (raw ?? {}) as Record<string, unknown>;
  const list = (key: string) => (Array.isArray(r[key]) ? (r[key] as Record<string, unknown>[]) : []);
  return {
    employeeId: String(r.employee_id ?? ""),
    competence: String(r.competence ?? ""),
    anchorDate: String(r.anchor_date ?? ""),
    operations: list("operations").map((o) => ({
      operationId: String(o.operation_id),
      operationName: String(o.operation_name ?? "—"),
    })),
    cities: list("cities").map((c) => ({
      operationCityId: String(c.operation_city_id),
      cityName: String(c.city_name ?? ""),
      stateUf: String(c.state_uf ?? "").trim(),
      operationName: String(c.operation_name ?? ""),
    })),
    brsTotal: Number(r.brs_total ?? 0),
    brs: list("brs").map((b) => ({
      id: String(b.id),
      code: String(b.code ?? ""),
      operationName: String(b.operation_name ?? "—"),
      cityName: String(b.city_name ?? ""),
      stateUf: String(b.state_uf ?? "").trim(),
      scopeLevel: b.scope_level === "br" || b.scope_level === "city" ? b.scope_level : "operation",
      fleetCode: str(b.fleet_code),
      licensePlate: str(b.license_plate),
      driverName: str(b.driver_name),
    })),
    vehiclesTotal: Number(r.vehicles_total ?? 0),
    driversTotal: Number(r.drivers_total ?? 0),
  };
}

/**
 * §35: o que uma liderança responde na competência — operações, cidades, BRs
 * (resolvidas pela precedência do §43), veículos e motoristas sob ela.
 */
export async function getLeadershipScopeSummary(
  organizationId: string,
  employeeId: string,
  competence: Competence,
): Promise<LeadershipScopeSummary> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("leadership_scope_summary", {
    p_organization_id: organizationId,
    p_employee_id: employeeId,
    p_year: competence.year,
    p_month: competence.month,
  });
  if (error) throw new Error(error.message);
  return mapLeadershipScopeSummary(data);
}
