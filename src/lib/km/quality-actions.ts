"use server";

import { revalidatePath } from "next/cache";
import { requireOrganization } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import type { Json } from "@/types/database.types";
import { camelize } from "./types";

/**
 * Escritas da Qualidade de dados do KM. Toda escrita é uma rotina do banco
 * (`km_correct_reading`, `km_review_reading`, `km_save_settings`,
 * `km_reprocess`): permissão, escopo e trilha são decididos lá, na mesma
 * transação. A action confere a sessão, chama, traduz o erro e revalida a tela.
 */
const MODULE_PATH = "/frota/km";

export interface Result<T = undefined> {
  ok: boolean;
  error?: string;
  data?: T;
}

/** As rotinas levantam mensagens já escritas para quem opera; só códigos crus viram texto aqui. */
function toMessage(error: { code?: string; message?: string }, fallback: string): string {
  const message = error.message ?? "";
  if (message && /^[A-ZÀ-Ý]/.test(message.trim())) return message;
  switch (error.code) {
    case "42501":
      return "Você não possui permissão para esta ação.";
    case "22023":
      return "Valor inválido. Revise os campos e tente novamente.";
    case "P0002":
      return "Registro não encontrado ou fora do seu acesso.";
    default:
      return fallback;
  }
}

type Payload = Record<string, Json | undefined>;
const clean = (payload: Payload): Record<string, Json> => {
  const out: Record<string, Json> = {};
  for (const [k, v] of Object.entries(payload)) if (v !== undefined) out[k] = v;
  return out;
};

type Rpc = (
  fn: string,
  args: Record<string, Json>,
) => Promise<{ data: unknown; error: { code?: string; message?: string } | null }>;

async function call<T>(permission: string, fn: string, args: Payload, fallback: string): Promise<Result<T>> {
  await requireOrganization(permission);
  const supabase = await createClient();
  const { data, error } = await (supabase.rpc as unknown as Rpc)(fn, clean(args));
  if (error) return { ok: false, error: toMessage(error, fallback) };
  revalidatePath(MODULE_PATH);
  return { ok: true, data: camelize<T>(data) };
}

async function orgId(permission: string): Promise<string> {
  const { organization } = await requireOrganization(permission);
  return organization.organizationId;
}

const finite = (v: number | null | undefined): number | undefined =>
  v == null || !Number.isFinite(v) ? undefined : v;

// ---------------------------------------------------------------------------
// Leitura sob demanda: valores originais da fonte (nunca apagados)
// ---------------------------------------------------------------------------
export interface KmReadingSource {
  readingId: string;
  odometerStartImported: number | null;
  odometerEndImported: number | null;
  distanceImported: number | null;
  distanceCalculated: number | null;
  odometerStart: number | null;
  odometerEnd: number | null;
  distanceValidated: number | null;
  status: string | null;
  alerts: string[] | null;
  isCorrected: boolean;
  correctedAt: string | null;
  sourceType: string | null;
}

type Untyped = {
  from: (table: string) => {
    select: (columns: string) => {
      eq: (column: string, value: string) => {
        maybeSingle: () => Promise<{ data: Record<string, unknown> | null; error: { code?: string; message?: string } | null }>;
      };
    };
  };
};

/**
 * O que a fonte informou e o que vale hoje para uma leitura (RLS da própria
 * pessoa). Usado pelo diálogo de correção quando a tela não trouxe os
 * valores importados.
 */
export async function loadReadingSource(readingId: string): Promise<Result<KmReadingSource>> {
  await requireOrganization("km.view");
  const supabase = await createClient();
  const { data, error } = await (supabase as unknown as Untyped)
    .from("km_daily_readings")
    .select(
      "id, odometer_start_imported, odometer_end_imported, distance_imported, distance_calculated, odometer_start, odometer_end, distance_validated, status, alerts, is_corrected, corrected_at, source_type",
    )
    .eq("id", readingId)
    .maybeSingle();
  if (error) return { ok: false, error: toMessage(error, "Não foi possível ler os valores da fonte.") };
  if (!data) return { ok: false, error: "Leitura não encontrada ou fora do seu acesso." };
  const num = (v: unknown) => (v == null || v === "" ? null : Number(v));
  return {
    ok: true,
    data: {
      readingId: String(data.id),
      odometerStartImported: num(data.odometer_start_imported),
      odometerEndImported: num(data.odometer_end_imported),
      distanceImported: num(data.distance_imported),
      distanceCalculated: num(data.distance_calculated),
      odometerStart: num(data.odometer_start),
      odometerEnd: num(data.odometer_end),
      distanceValidated: num(data.distance_validated),
      status: (data.status as string | null) ?? null,
      alerts: (data.alerts as string[] | null) ?? null,
      isCorrected: Boolean(data.is_corrected),
      correctedAt: (data.corrected_at as string | null) ?? null,
      sourceType: (data.source_type as string | null) ?? null,
    },
  };
}

// ---------------------------------------------------------------------------
// Correção e revisão de leitura
// ---------------------------------------------------------------------------
export interface CorrectReadingInput {
  odometerStart: number;
  odometerEnd: number;
  reason: string;
}

export async function correctReading(
  readingId: string,
  input: CorrectReadingInput,
): Promise<Result<{ readingId: string; status: string; km: number | null }>> {
  return call(
    "km.correct",
    "km_correct_reading",
    {
      p_reading_id: readingId,
      p_payload: clean({
        odometer_start: finite(input.odometerStart),
        odometer_end: finite(input.odometerEnd),
        reason: input.reason.trim(),
      }),
    },
    "Não foi possível corrigir a leitura.",
  );
}

export async function reviewReading(readingId: string, reason: string): Promise<Result<{ readingId: string; status: string }>> {
  return call(
    "km.correct",
    "km_review_reading",
    { p_reading_id: readingId, p_reason: reason.trim() },
    "Não foi possível registrar a análise da leitura.",
  );
}

// ---------------------------------------------------------------------------
// Parâmetros e reprocessamento
// ---------------------------------------------------------------------------
export interface KmSettingsInput {
  noMovementToleranceKm?: number | null;
  divergenceToleranceKm?: number | null;
  highMileageKm?: number | null;
  odometerJumpKm?: number | null;
  regressionToleranceKm?: number | null;
  minCoveragePct?: number | null;
  minCohortSize?: number | null;
  outlierIqrFactor?: number | null;
  rotationMinGapKm?: number | null;
  rotationStaleDays?: number | null;
}

export async function saveSettings(payload: KmSettingsInput): Promise<Result<Record<string, unknown>>> {
  const organizationId = await orgId("km.manage_parameters");
  return call(
    "km.manage_parameters",
    "km_save_settings",
    {
      p_organization_id: organizationId,
      p_payload: clean({
        no_movement_tolerance_km: finite(payload.noMovementToleranceKm),
        divergence_tolerance_km: finite(payload.divergenceToleranceKm),
        high_mileage_km: finite(payload.highMileageKm),
        odometer_jump_km: finite(payload.odometerJumpKm),
        regression_tolerance_km: finite(payload.regressionToleranceKm),
        min_coverage_pct: finite(payload.minCoveragePct),
        min_cohort_size: finite(payload.minCohortSize),
        outlier_iqr_factor: finite(payload.outlierIqrFactor),
        rotation_min_gap_km: finite(payload.rotationMinGapKm),
        rotation_stale_days: finite(payload.rotationStaleDays),
      }),
    },
    "Não foi possível salvar os parâmetros.",
  );
}

export async function reprocess(
  from: string,
  to: string,
  vehicleIds?: string[],
): Promise<Result<{ statusChanges: number; contextChanges: number }>> {
  const organizationId = await orgId("km.reprocess");
  return call(
    "km.reprocess",
    "km_reprocess",
    {
      p_organization_id: organizationId,
      p_from: from,
      p_to: to,
      p_vehicle_ids: vehicleIds?.length ? vehicleIds : undefined,
    },
    "Não foi possível reprocessar o período.",
  );
}
