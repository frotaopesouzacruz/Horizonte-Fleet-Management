"use server";

import { revalidatePath } from "next/cache";
import { resolveOrganization } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import type { Json } from "@/types/database.types";
import type { RodoparMeta, RodoparRow } from "./rodopar-sheet";
import {
  camelize,
  TIRES_APP_PATH,
  TIRES_BASE_PATH,
  type ImportPreviewSection,
  type InspectionStatus,
  type TireImportBatch,
  type TireImportPreview,
  type TireInspectionDetail,
  type TireRepairSuggestion,
  type TireSheet,
  type TireVehicleSummary,
  type TiresCatalog,
} from "./types";

/**
 * Ações da Gestão de Pneus. Toda escrita é uma rotina do banco: permissão,
 * escopo por operação/veículo, regra de estado e trilha (com a pessoa
 * autenticada como autora) são decididos lá, na mesma transação. A action só
 * confere a sessão, repassa o payload exato e traduz o erro para quem opera.
 */
export interface Result<T = undefined> {
  ok: boolean;
  error?: string;
  data?: T;
  /** Código de conflito devolvido pelo banco (ex.: arquivo já importado). */
  code?: string | null;
  /** A chamada estourou o tempo do banco: tentar de novo com uma parte menor. */
  retry?: boolean;
}

type Payload = Record<string, Json | undefined>;
const clean = (payload: Payload): Record<string, Json> => {
  const out: Record<string, Json> = {};
  for (const [k, v] of Object.entries(payload)) if (v !== undefined) out[k] = v;
  return out;
};

type RpcError = { code?: string; message?: string; hint?: string; details?: string };
type Rpc = (fn: string, args: Record<string, Json>) => Promise<{ data: unknown; error: RpcError | null }>;

function toMessage(error: RpcError, fallback: string): string {
  const message = error.message ?? "";
  if (error.code === "57014") return "A operação demorou mais que o permitido. Tente de novo.";
  if (message && /^[A-ZÀ-Ýº]/.test(message.trim())) return message;
  if (error.code === "42501") return "Você não possui permissão para esta ação na Gestão de Pneus.";
  return fallback;
}

const NO_ACCESS = "Sem permissão para esta ação na Gestão de Pneus ou a sessão expirou. Entre de novo.";

async function call<T>(
  permission: string | null,
  fn: string,
  args: Payload,
  fallback: string,
  options: { withOrg?: boolean; raw?: boolean } = {},
): Promise<Result<T>> {
  const ctx = await resolveOrganization(permission ?? undefined);
  if (!ctx) return { ok: false, error: NO_ACCESS };
  const supabase = await createClient();
  const withOrg = options.withOrg !== false;
  const { data, error } = await (supabase.rpc as unknown as Rpc)(
    fn,
    clean(withOrg ? { ...args, p_organization_id: ctx.organization.organizationId } : args),
  );
  if (error) {
    return { ok: false, error: toMessage(error, fallback), code: error.hint ?? error.code ?? null, retry: error.code === "57014" };
  }
  return { ok: true, data: options.raw ? (data as T) : camelize<T>(data) };
}

const refresh = () => {
  revalidatePath(TIRES_BASE_PATH);
};

// ---------------------------------------------------------------------------
// Leituras acionadas por clique
// ---------------------------------------------------------------------------
export async function loadTireSheet(tireId: string): Promise<Result<TireSheet>> {
  return call("tires.view", "tire_sheet", { p_tire_id: tireId }, "Não foi possível abrir a ficha do pneu.");
}

export async function loadTireInspectionDetail(inspectionId: string): Promise<Result<TireInspectionDetail>> {
  return call("tires.view", "tire_inspection_detail", { p_inspection_id: inspectionId }, "Não foi possível abrir a vistoria.");
}

/** Pneus de um veículo (aba Pneus do Cadastro de Frotas): por id, nunca por placa. */
export async function loadVehicleTireSummary(vehicleId: string): Promise<Result<TireVehicleSummary>> {
  return call("tires.view", "tires_vehicle_summary", { p_vehicle_id: vehicleId }, "Não foi possível ler os pneus do veículo.", { withOrg: false });
}

export async function loadTiresCatalog(): Promise<Result<TiresCatalog>> {
  return call("tires.view", "tires_catalog", {}, "Não foi possível ler os parâmetros de pneus.");
}

export async function loadImportPreview(
  batchId: string,
  section: ImportPreviewSection,
  filter: string | null,
  limit = 50,
  offset = 0,
): Promise<Result<TireImportPreview>> {
  return call(
    "tires.import",
    "tire_import_preview",
    { p_batch_id: batchId, p_section: section, p_filter: filter, p_limit: limit, p_offset: offset },
    "Não foi possível montar a prévia.",
  );
}

export async function resolveRepairVehicle(fireNumber: string, date: string): Promise<Result<TireRepairSuggestion>> {
  return call("tires.services.manage", "tire_repair_resolve", { p_fire_number: fireNumber, p_date: date }, "Não foi possível localizar o pneu.");
}

// ---------------------------------------------------------------------------
// Importação Rodopar 10 (LER → VALIDAR → COMPARAR → PRÉVIA → CONFIRMAR)
// ---------------------------------------------------------------------------
export interface ImportStartInput {
  meta: RodoparMeta;
  referenceDate: string;
}

export async function startTireImport(input: ImportStartInput): Promise<Result<{ batchId: string; referenceDate: string; previousReferenceDate: string | null }>> {
  return call(
    "tires.import",
    "tire_import_start",
    { p_payload: { ...input.meta, reference_date: input.referenceDate } as unknown as Json },
    "Não foi possível abrir o lote de importação.",
  );
}

export async function stageTireImport(batchId: string, rows: RodoparRow[]): Promise<Result<{ staged: number }>> {
  return call("tires.import", "tire_import_stage", { p_batch_id: batchId, p_rows: rows as unknown as Json }, "Não foi possível enviar as linhas.");
}

export async function validateTireImport(batchId: string): Promise<Result<TireImportBatch>> {
  return call("tires.import", "tire_import_validate", { p_batch_id: batchId }, "Não foi possível validar o arquivo.");
}

export interface ImportConfirmOutcome {
  batchId: string;
  referenceDate: string;
  snapshots: number;
  newTires: number;
  updatedTires: number;
  unchangedTires: number;
  events: number;
  absent: number;
  reconciliation: { checked?: number; synced?: number; persistent?: number; pending?: number };
}

export async function confirmTireImport(batchId: string): Promise<Result<ImportConfirmOutcome>> {
  const r = await call<ImportConfirmOutcome>("tires.import", "tire_import_confirm", { p_batch_id: batchId }, "Não foi possível confirmar os dados.");
  if (r.ok) {
    refresh();
    revalidatePath(TIRES_APP_PATH);
  }
  return r;
}

export async function cancelTireImport(batchId: string, reason?: string | null): Promise<Result<TireImportBatch>> {
  const r = await call<TireImportBatch>("tires.import", "tire_import_cancel", { p_batch_id: batchId, p_reason: reason ?? null }, "Não foi possível descartar o lote.");
  if (r.ok) refresh();
  return r;
}

// ---------------------------------------------------------------------------
// Vistorias recebidas
// ---------------------------------------------------------------------------
export async function transitionTireInspection(
  inspectionId: string,
  to: InspectionStatus,
  reason?: string | null,
): Promise<Result<{ id: string; status: InspectionStatus }>> {
  const r = await call<{ id: string; status: InspectionStatus }>(
    "tires.inspection.review",
    "tire_inspection_transition",
    { p_inspection_id: inspectionId, p_to: to, p_reason: reason ?? null },
    "Não foi possível alterar a situação da vistoria.",
  );
  if (r.ok) {
    refresh();
    revalidatePath(TIRES_APP_PATH);
  }
  return r;
}

// ---------------------------------------------------------------------------
// Serviços: consertos por Nº Fogo
// ---------------------------------------------------------------------------
export interface RepairInput {
  id?: string | null;
  tireId?: string | null;
  fireNumber?: string | null;
  serviceDate: string;
  repairType: string;
  serviceId?: string | null;
  supplierId?: string | null;
  serviceOrderNumber?: string | null;
  notes?: string | null;
  vehicleId?: string | null;
  overrideReason?: string | null;
}

export async function saveTireRepair(input: RepairInput): Promise<Result<{ id: string }>> {
  const r = await call<{ id: string }>(
    "tires.services.manage",
    "tire_repair_save",
    {
      p_payload: clean({
        id: input.id ?? undefined,
        tire_id: input.tireId ?? undefined,
        fire_number: input.fireNumber ?? undefined,
        service_date: input.serviceDate,
        repair_type: input.repairType,
        service_id: input.serviceId ?? undefined,
        supplier_id: input.supplierId ?? undefined,
        service_order_number: input.serviceOrderNumber ?? undefined,
        notes: input.notes ?? undefined,
        vehicle_id: input.vehicleId ?? undefined,
        override_reason: input.overrideReason ?? undefined,
      }),
    },
    "Não foi possível salvar o conserto.",
  );
  if (r.ok) refresh();
  return r;
}

export async function voidTireRepair(repairId: string, reason: string): Promise<Result<{ id: string }>> {
  const r = await call<{ id: string }>("tires.services.manage", "tire_repair_void", { p_repair_id: repairId, p_reason: reason }, "Não foi possível cancelar o conserto.");
  if (r.ok) refresh();
  return r;
}

// ---------------------------------------------------------------------------
// Parâmetros (formulários; nunca JSON livre)
// ---------------------------------------------------------------------------
export type ParametersInput = Partial<{
  measurementOkDays: number;
  measurementWarningDays: number;
  calibrationOkDays: number;
  calibrationWarningDays: number;
  treadCriticalMm: number;
  treadAttentionMm: number;
  maxValidTreadMm: number;
  maxValidPsi: number;
  futureDateToleranceDays: number;
  treadMinDivergenceToleranceMm: number;
  inspectionTreadToleranceMm: number;
  inspectionPsiTolerance: number;
  staleUpdateDays: number;
  reviewSlaDays: number;
  rodoparSyncSlaDays: number;
  repairResolutionMaxAgeDays: number;
  retreadAlertUseRodoparCondition: boolean;
  retreadAlertTreadMm: number | null;
  note: string;
}>;

const snake = (key: string) => key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
const toSnake = (input: Record<string, unknown>): Record<string, Json> => {
  const out: Record<string, Json> = {};
  for (const [k, v] of Object.entries(input)) if (v !== undefined) out[snake(k)] = v as Json;
  return out;
};

export async function saveTireParameters(input: ParametersInput): Promise<Result<{ id: string }>> {
  const r = await call<{ id: string }>("tires.parameters.manage", "tire_save_parameters", { p_payload: toSnake(input) }, "Não foi possível salvar os parâmetros.");
  if (r.ok) refresh();
  return r;
}

export interface PressureRuleInput {
  id?: string | null;
  vehicleTypeId?: string | null;
  dimension?: string | null;
  positionCode?: string | null;
  axleGroup?: "front" | "rear" | "spare" | null;
  minPsi: number;
  idealPsi: number;
  maxPsi: number;
  minLegalTreadMm?: number | null;
  attentionTreadMm?: number | null;
  isActive?: boolean;
  validFrom?: string | null;
  validTo?: string | null;
  notes?: string | null;
}

export async function saveTirePressureRule(input: PressureRuleInput): Promise<Result<{ id: string }>> {
  const r = await call<{ id: string }>(
    "tires.parameters.manage",
    "tire_save_pressure_rule",
    { p_payload: toSnake(input as unknown as Record<string, unknown>) },
    "Não foi possível salvar a regra de PSI.",
  );
  if (r.ok) refresh();
  return r;
}

export interface PositionInput {
  code: string;
  label: string;
  axleGroup: "front" | "rear" | "spare" | "other";
  axleIndex: number;
  side: "left" | "right" | "center";
  slot: "single" | "outer" | "inner";
  sortOrder: number;
  isActive: boolean;
}

export async function saveTirePosition(input: PositionInput): Promise<Result<{ id: string }>> {
  const r = await call<{ id: string }>("tires.parameters.manage", "tire_save_position", { p_payload: toSnake(input as unknown as Record<string, unknown>) }, "Não foi possível salvar a posição.");
  if (r.ok) refresh();
  return r;
}

export interface LayoutInput {
  id?: string | null;
  code: string;
  name: string;
  description?: string | null;
  positionCodes: string[];
  isActive: boolean;
}

export async function saveTireLayout(input: LayoutInput): Promise<Result<{ id: string }>> {
  const r = await call<{ id: string }>("tires.parameters.manage", "tire_save_layout", { p_payload: toSnake(input as unknown as Record<string, unknown>) }, "Não foi possível salvar o layout.");
  if (r.ok) refresh();
  return r;
}

export async function setVehicleTypeTireLayout(vehicleTypeId: string, layoutId: string | null): Promise<Result<unknown>> {
  const r = await call("tires.parameters.manage", "tire_set_vehicle_type_layout", { p_vehicle_type_id: vehicleTypeId, p_layout_id: layoutId }, "Não foi possível vincular o layout ao tipo.");
  if (r.ok) refresh();
  return r;
}

export async function setVehicleTireLayout(vehicleId: string, layoutId: string | null, reason?: string | null): Promise<Result<unknown>> {
  const r = await call(
    "tires.parameters.manage",
    "tire_set_vehicle_layout",
    { p_vehicle_id: vehicleId, p_layout_id: layoutId, p_reason: reason ?? null },
    "Não foi possível definir o layout do veículo.",
  );
  if (r.ok) refresh();
  return r;
}

export async function saveTireServiceKind(serviceId: string, kind: string, active: boolean): Promise<Result<unknown>> {
  const r = await call("tires.parameters.manage", "tire_save_service_kind", { p_service_id: serviceId, p_kind: kind, p_active: active }, "Não foi possível salvar o vínculo do serviço.");
  if (r.ok) refresh();
  return r;
}

// ---------------------------------------------------------------------------
// Sincronização com a fonte oficial (SharePoint), indicadores e auditoria
// ---------------------------------------------------------------------------
export interface SyncNowOutcome {
  status: string;
  runId: string | null;
  message: string;
  errorCode?: string | null;
  referenceDate?: string | null;
  sameDayRevision?: boolean;
}

async function runSync(trigger: "manual" | "reprocessamento", reprocessOf: string | null): Promise<Result<SyncNowOutcome>> {
  const ctx = await resolveOrganization("tires.import");
  if (!ctx) return { ok: false, error: NO_ACCESS };
  const supabase = await createClient();
  try {
    // o cliente da própria pessoa: permissão conferida no banco e autoria nos registros
    const { runSyncAs } = await import("./sync/server");
    const outcome = await runSyncAs(supabase, ctx.organization.organizationId, trigger, reprocessOf);
    refresh();
    revalidatePath(TIRES_APP_PATH);
    const ok = ["concluida", "concluida_com_avisos", "sem_alteracao"].includes(outcome.status);
    return {
      ok,
      error: ok ? undefined : outcome.message,
      code: outcome.errorCode ?? null,
      data: {
        status: outcome.status,
        runId: outcome.runId,
        message: outcome.message,
        errorCode: outcome.errorCode ?? null,
        referenceDate: outcome.referenceDate ?? null,
        sameDayRevision: outcome.sameDayRevision ?? false,
      },
    };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Não foi possível sincronizar agora." };
  }
}

/** "Sincronizar agora": busca a planilha oficial no SharePoint e aplica pelo pipeline oficial. */
export async function syncTiresNow(): Promise<Result<SyncNowOutcome>> {
  return runSync("manual", null);
}

/** Reprocessamento controlado: baixa e revalida mesmo sem mudança de versão (fica registrado como tal). */
export async function reprocessTireSync(runId: string): Promise<Result<SyncNowOutcome>> {
  return runSync("reprocessamento", runId);
}

export async function saveTireSyncSource(payload: {
  siteHostname: string;
  sitePath: string;
  driveName: string;
  filePath: string;
  webUrl?: string | null;
  isActive: boolean;
  minIntervalMinutes: number;
}): Promise<Result<unknown>> {
  const r = await call(
    "tires.parameters.manage",
    "tire_sync_save_source",
    {
      p_payload: {
        site_hostname: payload.siteHostname,
        site_path: payload.sitePath,
        drive_name: payload.driveName,
        file_path: payload.filePath,
        web_url: payload.webUrl ?? null,
        is_active: payload.isActive,
        min_interval_minutes: payload.minIntervalMinutes,
      },
    },
    "Não foi possível salvar a fonte oficial.",
  );
  if (r.ok) refresh();
  return r;
}

export async function saveTireKpiSchedule(payload: {
  isActive: boolean;
  frequency: "daily" | "weekly" | "monthly";
  weekday: number;
  monthDay: number;
  runTime: string;
  catchUpDays: number;
}): Promise<Result<unknown>> {
  const r = await call(
    "tires.parameters.manage",
    "tire_kpi_schedule_save",
    {
      p_payload: {
        is_active: payload.isActive,
        frequency: payload.frequency,
        weekday: payload.weekday,
        month_day: payload.monthDay,
        run_time: payload.runTime,
        catch_up_days: payload.catchUpDays,
      },
    },
    "Não foi possível salvar a agenda dos indicadores.",
  );
  if (r.ok) refresh();
  return r;
}

/** Reprocessa uma captura de indicadores que falhou ou foi ignorada (nunca uma concluída). */
export async function reprocessTireKpi(runId: string): Promise<Result<unknown>> {
  const r = await call("tires.parameters.manage", "tire_kpi_reprocess", { p_run_id: runId }, "Não foi possível reprocessar a captura.");
  if (r.ok) refresh();
  return r;
}

/** Varredura sob demanda da Central de Auditoria dos Dados. */
export async function rescanTireAudit(): Promise<Result<{ opened: number; resolved: number; openTotal: number }>> {
  const r = await call<{ opened: number; resolved: number; openTotal: number }>(null, "tire_audit_rescan", {}, "Não foi possível reexecutar a auditoria.");
  if (r.ok) refresh();
  return r;
}
