import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { Competence } from "./competence";

/**
 * Central de Fidelização (Etapa 15) — leituras.
 *
 * Tudo aqui é security invoker: a RLS das posições decide o escopo. As
 * fórmulas e a classificação dos eventos vivem no banco; este módulo só
 * traduz nomes de coluna.
 */

const str = (v: unknown): string | null => (v === null || v === undefined || v === "" ? null : String(v));
const num = (v: unknown): number => Number(v ?? 0);

/* ------------------------------------------------------ planner de frotas */

export type AllocationSituation = "with_vehicle" | "without_vehicle" | "partial" | "full" | "changed";

export const ALLOCATION_SITUATIONS: { value: AllocationSituation; label: string }[] = [
  { value: "with_vehicle", label: "Com veículo no mês" },
  { value: "without_vehicle", label: "Sem veículo no mês" },
  { value: "partial", label: "Com dias sem veículo" },
  { value: "full", label: "Com veículo todos os dias" },
  { value: "changed", label: "Com troca no mês" },
];

export interface PlannerFilters {
  operationId?: string;
  stateId?: string;
  cityId?: string;
  brId?: string;
  leaderEmployeeId?: string;
  vehicleTypeId?: string;
  q?: string;
  vehicle?: string;
  situation?: string;
}

export interface PlannerDriver {
  employeeId: string;
  name: string;
  employeeCode: string | null;
  driverRole: "primary" | "secondary";
  startDate: string;
  endDate: string | null;
}

export interface PlannerSegment {
  assignmentId: string;
  vehicleId: string;
  fleetCode: string | null;
  licensePlate: string | null;
  vehicleTypeId: string | null;
  vehicleTypeName: string | null;
  status: "planned" | "confirmed" | "executed" | "cancelled";
  source: string;
  startDate: string;
  endDate: string | null;
  /** Primeiro e último dia do mês cobertos por este vínculo (1–31). */
  firstDay: number;
  lastDay: number;
  /** O vínculo começa neste mês (e não continua do anterior). */
  startsHere: boolean;
  /** O vínculo termina neste mês. */
  endsHere: boolean;
  drivers: PlannerDriver[];
}

export interface PlannerRow {
  operationBrId: string;
  brCode: string;
  brDescription: string | null;
  brStatus: string;
  operationId: string;
  operationName: string;
  stateId: number;
  stateUf: string;
  cityId: number;
  cityName: string;
  /** Liderança da competência (Planner de Lideranças, com a exceção por BR). */
  leaderEmployeeId: string | null;
  leaderName: string | null;
  /** Nível que respondeu: br, city, operation. */
  leaderLevel: string | null;
  daysWithVehicle: number;
  daysWithoutVehicle: number;
  changes: number;
  segments: PlannerSegment[];
}

export interface PlannerMatrix {
  competence: string;
  anchorDate: string;
  today: string;
  daysInMonth: number;
  total: number;
  rows: PlannerRow[];
}

export function mapPlannerMatrix(raw: unknown): PlannerMatrix {
  const r = (raw ?? {}) as Record<string, unknown>;
  const rows = Array.isArray(r.rows) ? (r.rows as Record<string, unknown>[]) : [];
  return {
    competence: String(r.competence ?? ""),
    anchorDate: String(r.anchor_date ?? ""),
    today: String(r.today ?? ""),
    daysInMonth: num(r.days_in_month),
    total: num(r.total),
    rows: rows.map((row) => ({
      operationBrId: String(row.operation_br_id),
      brCode: String(row.br_code ?? ""),
      brDescription: str(row.br_description),
      brStatus: String(row.br_status ?? "active"),
      operationId: String(row.operation_id),
      operationName: String(row.operation_name ?? ""),
      stateId: num(row.state_id),
      stateUf: String(row.state_uf ?? "").trim(),
      cityId: num(row.city_id),
      cityName: String(row.city_name ?? ""),
      leaderEmployeeId: str(row.leader_employee_id),
      leaderName: str(row.leader_name),
      leaderLevel: str(row.leader_level),
      daysWithVehicle: num(row.days_with_vehicle),
      daysWithoutVehicle: num(row.days_without_vehicle),
      changes: num(row.changes),
      segments: (Array.isArray(row.segments) ? (row.segments as Record<string, unknown>[]) : []).map((s) => ({
        assignmentId: String(s.assignment_id),
        vehicleId: String(s.vehicle_id),
        fleetCode: str(s.fleet_code),
        licensePlate: str(s.license_plate),
        vehicleTypeId: str(s.vehicle_type_id),
        vehicleTypeName: str(s.vehicle_type_name),
        status: (String(s.status ?? "planned") as PlannerSegment["status"]),
        source: String(s.source ?? "manual"),
        startDate: String(s.start_date),
        endDate: str(s.end_date),
        firstDay: num(s.first_day),
        lastDay: num(s.last_day),
        startsHere: Boolean(s.starts_here),
        endsHere: Boolean(s.ends_here),
        drivers: (Array.isArray(s.drivers) ? (s.drivers as Record<string, unknown>[]) : []).map((d) => ({
          employeeId: String(d.employee_id),
          name: String(d.name ?? ""),
          employeeCode: str(d.employee_code),
          driverRole: (d.driver_role === "secondary" ? "secondary" : "primary") as PlannerDriver["driverRole"],
          startDate: String(d.start_date),
          endDate: str(d.end_date),
        })),
      })),
    })),
  };
}

export async function getPlannerMatrix(
  organizationId: string,
  competence: Competence,
  filters: PlannerFilters = {},
): Promise<PlannerMatrix> {
  const supabase = await createClient();
  const payload: Record<string, string> = {};
  if (filters.operationId) payload.operation_id = filters.operationId;
  if (filters.stateId) payload.state_id = filters.stateId;
  if (filters.cityId) payload.city_id = filters.cityId;
  if (filters.brId) payload.br_id = filters.brId;
  if (filters.leaderEmployeeId) payload.leader_employee_id = filters.leaderEmployeeId;
  if (filters.vehicleTypeId) payload.vehicle_type_id = filters.vehicleTypeId;
  if (filters.q) payload.q = filters.q;
  if (filters.vehicle) payload.vehicle = filters.vehicle;
  if (filters.situation) payload.situation = filters.situation;

  const { data, error } = await supabase.rpc("fidelization_planner_matrix", {
    p_organization_id: organizationId,
    p_year: competence.year,
    p_month: competence.month,
    p_filters: payload,
  });
  if (error) throw new Error(error.message);
  return mapPlannerMatrix(data);
}

export async function listVehicleTypeOptions(organizationId: string): Promise<{ id: string; name: string }[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("vehicle_types")
    .select("id, name")
    .or(`organization_id.eq.${organizationId},organization_id.is.null`)
    .is("deleted_at", null)
    .order("sort_order");
  if (error) throw new Error(error.message);
  return (data ?? []).map((t) => ({ id: t.id, name: t.name }));
}

/* ------------------------------------------------ histórico de mobilizações */

export type MovementType =
  | "first_allocation"
  | "vehicle_allocation"
  | "vehicle_substitution"
  | "vehicle_inversion"
  | "vehicle_removal"
  | "vehicle_end"
  | "vehicle_return"
  | "driver_allocation"
  | "driver_substitution"
  | "driver_end"
  | "administrative_correction"
  | "cancellation";

export const MOVEMENT_TYPES: { value: MovementType; label: string; subject: "vehicle" | "driver" | "any" }[] = [
  { value: "first_allocation", label: "Primeira alocação", subject: "vehicle" },
  { value: "vehicle_allocation", label: "Alocação de veículo", subject: "vehicle" },
  { value: "vehicle_substitution", label: "Substituição de veículo", subject: "vehicle" },
  { value: "vehicle_inversion", label: "Inversão de placas", subject: "vehicle" },
  { value: "vehicle_removal", label: "Remoção de veículo", subject: "vehicle" },
  { value: "vehicle_return", label: "Retorno de veículo", subject: "vehicle" },
  { value: "vehicle_end", label: "Encerramento de vínculo", subject: "vehicle" },
  { value: "driver_allocation", label: "Vinculação de motorista", subject: "driver" },
  { value: "driver_substitution", label: "Substituição de motorista", subject: "driver" },
  { value: "driver_end", label: "Encerramento do motorista", subject: "driver" },
  { value: "administrative_correction", label: "Correção administrativa", subject: "any" },
  { value: "cancellation", label: "Cancelamento de planejamento", subject: "any" },
];

export interface MovementFilters {
  dateFrom?: string;
  dateTo?: string;
  operationId?: string;
  stateId?: string;
  cityId?: string;
  brId?: string;
  leaderEmployeeId?: string;
  movementType?: string;
  subject?: string;
  vehicle?: string;
  driver?: string;
}

export interface MovementRow {
  id: string;
  movementType: MovementType;
  subject: "vehicle" | "driver";
  effectiveDate: string;
  operationBrId: string;
  brCode: string;
  operationId: string;
  operationName: string;
  stateUf: string;
  cityId: number;
  cityName: string;
  leaderEmployeeId: string | null;
  leaderName: string | null;
  previousVehicleId: string | null;
  previousVehicleLabel: string | null;
  previousPlate: string | null;
  newVehicleId: string | null;
  newVehicleLabel: string | null;
  newPlate: string | null;
  previousDriverName: string | null;
  previousDriverCode: string | null;
  newDriverName: string | null;
  newDriverCode: string | null;
  driverRole: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  reason: string | null;
  source: string | null;
  /** user, import, replication, system, reconstructed */
  origin: string;
  /** Troca observada sem substituição registrada. */
  isInferred: boolean;
  /** Eventos da mesma transação (uma inversão, uma replicação) compartilham a chave. */
  correlationKey: string;
  notes: string | null;
  actorName: string | null;
  recordedAt: string;
}

export interface MovementsPage {
  total: number;
  page: number;
  pageSize: number;
  counts: Partial<Record<MovementType, number>>;
  reconstructed: number;
  rows: MovementRow[];
}

export function mapMovementsPage(raw: unknown): MovementsPage {
  const r = (raw ?? {}) as Record<string, unknown>;
  const rows = Array.isArray(r.rows) ? (r.rows as Record<string, unknown>[]) : [];
  const counts = (r.counts && typeof r.counts === "object" ? r.counts : {}) as Record<string, unknown>;
  return {
    total: num(r.total),
    page: num(r.page) || 1,
    pageSize: num(r.page_size) || 50,
    counts: Object.fromEntries(Object.entries(counts).map(([k, v]) => [k, Number(v ?? 0)])) as MovementsPage["counts"],
    reconstructed: num(r.reconstructed),
    rows: rows.map((m) => {
      const details = (m.details && typeof m.details === "object" ? m.details : {}) as Record<string, unknown>;
      return {
        id: String(m.id),
        movementType: String(m.movement_type) as MovementType,
        subject: (m.subject === "driver" ? "driver" : "vehicle") as MovementRow["subject"],
        effectiveDate: String(m.effective_date),
        operationBrId: String(m.operation_br_id),
        brCode: String(m.br_code ?? ""),
        operationId: String(m.operation_id),
        operationName: String(m.operation_name ?? ""),
        stateUf: String(m.state_uf ?? "").trim(),
        cityId: num(m.city_id),
        cityName: String(m.city_name ?? ""),
        leaderEmployeeId: str(m.leader_employee_id),
        leaderName: str(m.leader_name),
        previousVehicleId: str(m.previous_vehicle_id),
        previousVehicleLabel: str(m.previous_vehicle_label),
        previousPlate: str(m.previous_plate),
        newVehicleId: str(m.new_vehicle_id),
        newVehicleLabel: str(m.new_vehicle_label),
        newPlate: str(m.new_plate),
        previousDriverName: str(m.previous_driver_name),
        previousDriverCode: str(m.previous_driver_code),
        newDriverName: str(m.new_driver_name),
        newDriverCode: str(m.new_driver_code),
        driverRole: str(m.driver_role),
        periodStart: str(m.period_start),
        periodEnd: str(m.period_end),
        reason: str(m.reason),
        source: str(m.source),
        origin: String(m.origin ?? "user"),
        isInferred: Boolean(m.is_inferred),
        correlationKey: String(m.correlation_key ?? ""),
        notes: str(details.notes),
        actorName: str(m.actor_name),
        recordedAt: String(m.recorded_at ?? ""),
      };
    }),
  };
}

export async function listMovements(
  organizationId: string,
  filters: MovementFilters = {},
  page = 1,
  pageSize = 50,
): Promise<MovementsPage> {
  const supabase = await createClient();
  const payload: Record<string, string> = {};
  if (filters.dateFrom) payload.date_from = filters.dateFrom;
  if (filters.dateTo) payload.date_to = filters.dateTo;
  if (filters.operationId) payload.operation_id = filters.operationId;
  if (filters.stateId) payload.state_id = filters.stateId;
  if (filters.cityId) payload.city_id = filters.cityId;
  if (filters.brId) payload.br_id = filters.brId;
  if (filters.leaderEmployeeId) payload.leader_employee_id = filters.leaderEmployeeId;
  if (filters.movementType) payload.movement_type = filters.movementType;
  if (filters.subject) payload.subject = filters.subject;
  if (filters.vehicle) payload.vehicle = filters.vehicle;
  if (filters.driver) payload.driver = filters.driver;

  const { data, error } = await supabase.rpc("fidelization_movements_list", {
    p_organization_id: organizationId,
    p_filters: payload,
    p_page: page,
    p_page_size: pageSize,
  });
  if (error) throw new Error(error.message);
  return mapMovementsPage(data);
}

/* ------------------------------------------------ histórico de importações */

export interface FidelizationImportBatch {
  id: string;
  /** fidelization (alocações) ou operation_brs (cadastro de BRs, módulo BRs). */
  type: string;
  fileName: string;
  status: string;
  totalRows: number;
  validRows: number;
  warningRows: number;
  errorRows: number;
  createdRows: number;
  updatedRows: number;
  skippedRows: number;
  errorMessage: string | null;
  createdAt: string;
  processedAt: string | null;
  createdByName: string | null;
  errors: { row: number; message: string }[];
}

export function mapImportHistory(raw: unknown): FidelizationImportBatch[] {
  const rows = Array.isArray(raw) ? (raw as Record<string, unknown>[]) : [];
  return rows.map((b) => ({
    id: String(b.id),
    type: String(b.type ?? "fidelization"),
    fileName: String(b.file_name ?? ""),
    status: String(b.status ?? ""),
    totalRows: num(b.total_rows),
    validRows: num(b.valid_rows),
    warningRows: num(b.warning_rows),
    errorRows: num(b.error_rows),
    createdRows: num(b.created_rows),
    updatedRows: num(b.updated_rows),
    skippedRows: num(b.skipped_rows),
    errorMessage: str(b.error_message),
    createdAt: String(b.created_at ?? ""),
    processedAt: str(b.processed_at),
    createdByName: str(b.created_by_name),
    errors: (Array.isArray(b.errors) ? (b.errors as Record<string, unknown>[]) : []).map((e) => ({
      row: num(e.row),
      message: String(e.message ?? ""),
    })),
  }));
}

export async function listFidelizationImportHistory(organizationId: string, limit = 20): Promise<FidelizationImportBatch[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("fidelization_import_history", {
    p_organization_id: organizationId,
    p_limit: limit,
  });
  if (error) throw new Error(error.message);
  return mapImportHistory(data);
}
