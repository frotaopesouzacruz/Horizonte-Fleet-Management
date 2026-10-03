"use server";

import { revalidatePath } from "next/cache";
import { resolveOrganization } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import type { Json } from "@/types/database.types";
import { removeEvidenceObjects, signEvidenceRead } from "./evidence";
import {
  camelize,
  MTSR_BASE_PATH,
  type MtsrCatalog,
  type MtsrForMaintenance,
  type MtsrInspectionDetail,
  type MtsrMaintenanceCandidate,
  type MtsrVehicleSheet,
  type MtsrVehicleSummary,
} from "./types";

/**
 * Ações do portal Gestão de MTSR. Toda escrita é uma rotina do banco:
 * permissão, escopo por operação/veículo, regra de estado e trilha são
 * decididos lá, na mesma transação. A action só confere a sessão, repassa o
 * payload exato e traduz o erro para quem opera.
 */
export interface Result<T = undefined> {
  ok: boolean;
  error?: string;
  data?: T;
  /** Já existe manutenção aberta para o componente: a tela oferece vincular ou justificar. */
  duplicate?: { maintenanceId: string | null } | null;
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
) => Promise<{ data: unknown; error: { code?: string; message?: string; hint?: string; details?: string } | null }>;

function toMessage(error: { code?: string; message?: string }, fallback: string): string {
  const message = error.message ?? "";
  if (message && /^[A-ZÀ-Ý]/.test(message.trim())) return message;
  if (error.code === "42501") return "Você não possui permissão para esta ação no MTSR.";
  return fallback;
}

const NO_ACCESS = "Sem permissão para esta ação no MTSR ou a sessão expirou. Entre de novo.";

async function call<T>(
  permission: string | null,
  fn: string,
  args: Payload,
  fallback: string,
  map: (raw: unknown) => T = (raw) => camelize<T>(raw),
  options: { withOrg?: boolean } = {},
): Promise<Result<T>> {
  const ctx = await resolveOrganization(permission ?? undefined);
  if (!ctx) return { ok: false, error: NO_ACCESS };
  const supabase = await createClient();
  const withOrg = options.withOrg !== false;
  const { data, error } = await (supabase.rpc as unknown as Rpc)(
    fn,
    clean(withOrg ? { ...args, p_organization_id: args.p_organization_id ?? ctx.organization.organizationId } : args),
  );
  if (error) {
    return {
      ok: false,
      error: toMessage(error, fallback),
      duplicate: error.code === "23505" && (error.hint ?? "") === "mtsr_duplicate" ? { maintenanceId: error.details ?? null } : null,
    };
  }
  return { ok: true, data: map(data) };
}

const refresh = () => {
  revalidatePath(MTSR_BASE_PATH);
};

// ---------------------------------------------------------------------------
// Leituras acionadas por clique
// ---------------------------------------------------------------------------
export async function loadInspectionDetail(inspectionId: string): Promise<Result<MtsrInspectionDetail>> {
  return call("mtsr.view", "mtsr_inspection_detail", { p_inspection_id: inspectionId }, "Não foi possível abrir a vistoria.");
}

export async function loadVehicleSheet(vehicleId: string): Promise<Result<MtsrVehicleSheet>> {
  return call("mtsr.view", "mtsr_vehicle_sheet", { p_vehicle_id: vehicleId }, "Não foi possível abrir a ficha MTSR.");
}

/** Situação MTSR de um veículo (aba MTSR do Cadastro de Frotas): por id, nunca por placa. */
export async function loadVehicleMtsrSummary(vehicleId: string): Promise<Result<MtsrVehicleSummary>> {
  return call("mtsr.view", "mtsr_vehicle_summary", { p_vehicle_id: vehicleId }, "Não foi possível ler a situação MTSR do veículo.", undefined, { withOrg: false });
}

export async function loadMtsrCatalog(): Promise<Result<MtsrCatalog>> {
  return call("mtsr.view", "mtsr_catalog", {}, "Não foi possível ler o catálogo MTSR.");
}

/** Fotos de uma vistoria: só depois de a rotina de detalhe ter mostrado a vistoria à pessoa. */
export async function loadEvidenceUrls(inspectionId: string): Promise<Result<Record<string, string>>> {
  const detail = await loadInspectionDetail(inspectionId);
  if (!detail.ok || !detail.data) return { ok: false, error: detail.error ?? "Sem acesso à vistoria." };
  const paths = detail.data.items.flatMap((it) => it.evidence.filter((e) => !e.purgedAt).map((e) => e.storagePath));
  try {
    return { ok: true, data: await signEvidenceRead(paths) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Não foi possível abrir as fotos." };
  }
}

// ---------------------------------------------------------------------------
// Vistorias recebidas
// ---------------------------------------------------------------------------
export interface ValidateOutcome {
  id: string;
  protocol: string;
  alreadyValidated: boolean;
  applied: number;
  skipped: number;
  skippedStale?: number;
  changed?: number;
  nok?: number;
  lastValidAdvanced?: boolean;
}

export async function validateInspection(inspectionId: string): Promise<Result<ValidateOutcome>> {
  const r = await call<ValidateOutcome>("mtsr.inspection.validate", "mtsr_inspection_validate", { p_inspection_id: inspectionId }, "Não foi possível validar a vistoria.");
  if (r.ok) {
    refresh();
    // Retenção de evidências do veículo da vistoria, pelo parâmetro vigente.
    void applyEvidenceRetentionForInspection(inspectionId).catch(() => undefined);
  }
  return r;
}

export async function returnInspection(inspectionId: string, reason: string): Promise<Result<{ id: string; status: string }>> {
  const r = await call<{ id: string; status: string }>("mtsr.inspection.return", "mtsr_inspection_return", { p_inspection_id: inspectionId, p_reason: reason }, "Não foi possível retornar a vistoria.");
  if (r.ok) refresh();
  return r;
}

export async function rejectInspection(inspectionId: string, reason: string): Promise<Result<{ id: string; status: string }>> {
  const r = await call<{ id: string; status: string }>("mtsr.inspection.reject", "mtsr_inspection_reject", { p_inspection_id: inspectionId, p_reason: reason }, "Não foi possível rejeitar a vistoria.");
  if (r.ok) refresh();
  return r;
}

// ---------------------------------------------------------------------------
// Backoffice (estado oficial de componentes BACKOFFICE)
// ---------------------------------------------------------------------------
export interface BackofficeUpdateInput {
  vehicleId: string;
  referenceDate?: string | null;
  sourceSystem?: string | null;
  reference?: string | null;
  items: { componentId: string; status: "ok" | "nok" | "sem_informacao"; observation?: string | null }[];
}

export async function updateBackofficeStatus(input: BackofficeUpdateInput): Promise<Result<{ vehicleId: string; applied: number }>> {
  const r = await call<{ vehicleId: string; applied: number }>(
    "mtsr.backoffice.update",
    "mtsr_component_status_update",
    {
      p_payload: {
        vehicle_id: input.vehicleId,
        reference_date: input.referenceDate ?? undefined,
        source_system: input.sourceSystem ?? undefined,
        reference: input.reference ?? undefined,
        items: input.items.map((i) => ({ component_id: i.componentId, status: i.status, observation: i.observation ?? null })),
      } as unknown as Json,
    },
    "Não foi possível atualizar o estado dos componentes.",
  );
  if (r.ok) refresh();
  return r;
}

// ---------------------------------------------------------------------------
// Manutenção corporativa
// ---------------------------------------------------------------------------
export interface OpenMaintenanceInput {
  vehicleId: string;
  componentId: string;
  inspectionItemId?: string | null;
  serviceIds?: string[];
  priority?: string | null;
  description?: string | null;
  duplicateJustification?: string | null;
  reason?: string | null;
  maintenanceTypeCode?: string | null;
  requestedOn?: string | null;
  supplierId?: string | null;
  notes?: string | null;
}

export interface OpenMaintenanceOutcome {
  id: string;
  code: string;
  status: string;
  linkId: string;
  componentId: string;
}

export async function openMaintenanceFromNok(input: OpenMaintenanceInput): Promise<Result<OpenMaintenanceOutcome>> {
  const r = await call<OpenMaintenanceOutcome>(
    "mtsr.maintenance.open",
    "mtsr_maintenance_open",
    {
      p_payload: clean({
        vehicle_id: input.vehicleId,
        component_id: input.componentId,
        inspection_item_id: input.inspectionItemId ?? undefined,
        service_ids: input.serviceIds?.length ? input.serviceIds : undefined,
        priority: input.priority ?? undefined,
        description: input.description ?? undefined,
        duplicate_justification: input.duplicateJustification ?? undefined,
        reason: input.reason ?? undefined,
        maintenance_type_code: input.maintenanceTypeCode ?? undefined,
        requested_on: input.requestedOn ?? undefined,
        supplier_id: input.supplierId ?? undefined,
        notes: input.notes ?? undefined,
      }),
    },
    "Não foi possível abrir a manutenção.",
  );
  if (r.ok) {
    refresh();
    revalidatePath("/frota/manutencao");
  }
  return r;
}

export async function linkMaintenance(input: { maintenanceId: string; componentId: string; inspectionItemId?: string | null; reason?: string | null }): Promise<Result<{ linkId: string; maintenanceId: string; code: string; status: string }>> {
  const r = await call<{ linkId: string; maintenanceId: string; code: string; status: string }>(
    "mtsr.maintenance.link",
    "mtsr_maintenance_link",
    { p_payload: clean({ maintenance_id: input.maintenanceId, component_id: input.componentId, inspection_item_id: input.inspectionItemId ?? undefined, reason: input.reason ?? undefined }) },
    "Não foi possível vincular a manutenção.",
  );
  if (r.ok) {
    refresh();
    revalidatePath("/frota/manutencao");
  }
  return r;
}

export async function unlinkMaintenance(linkId: string, reason: string): Promise<Result<{ linkId: string; status: string }>> {
  const r = await call<{ linkId: string; status: string }>("mtsr.maintenance.link", "mtsr_maintenance_unlink", { p_link_id: linkId, p_reason: reason }, "Não foi possível desvincular a manutenção.");
  if (r.ok) {
    refresh();
    revalidatePath("/frota/manutencao");
  }
  return r;
}

export async function loadMaintenanceCandidates(vehicleId: string, componentId?: string | null): Promise<Result<MtsrMaintenanceCandidate[]>> {
  return call("mtsr.maintenance.link", "mtsr_maintenance_candidates", { p_vehicle_id: vehicleId, p_component_id: componentId ?? undefined }, "Não foi possível listar as manutenções do veículo.");
}

/** Para a gaveta da Manutenção: os componentes MTSR que esta manutenção trata. */
export async function loadMtsrForMaintenance(maintenanceId: string): Promise<Result<MtsrForMaintenance>> {
  return call("maintenance.view", "mtsr_for_maintenance", { p_maintenance_id: maintenanceId }, "Não foi possível ler o vínculo MTSR.", undefined, { withOrg: false });
}

// ---------------------------------------------------------------------------
// Cadastros
// ---------------------------------------------------------------------------
export interface ComponentInput {
  id?: string | null;
  code?: string | null;
  name: string;
  description?: string | null;
  verificationMode?: "field" | "backoffice";
  baseCriticality?: "critica" | "alta" | "media";
  priority?: number | null;
  sortOrder?: number | null;
  isActive?: boolean;
  contextLabel?: string | null;
  evidenceRequiredWhenOk?: boolean;
  evidenceRequiredWhenNok?: boolean;
  observationRequiredWhenNok?: boolean;
  aliases?: string[];
}

export async function saveComponent(input: ComponentInput): Promise<Result<{ id: string }>> {
  const r = await call<{ id: string }>(
    "mtsr.component.manage",
    "mtsr_save_component",
    {
      p_payload: clean({
        id: input.id ?? undefined,
        code: input.code ?? undefined,
        name: input.name,
        description: input.description === undefined ? undefined : input.description,
        verification_mode: input.verificationMode ?? undefined,
        base_criticality: input.baseCriticality ?? undefined,
        priority: input.priority ?? undefined,
        sort_order: input.sortOrder ?? undefined,
        is_active: input.isActive ?? undefined,
        context_label: input.contextLabel === undefined ? undefined : input.contextLabel,
        evidence_required_when_ok: input.evidenceRequiredWhenOk ?? undefined,
        evidence_required_when_nok: input.evidenceRequiredWhenNok ?? undefined,
        observation_required_when_nok: input.observationRequiredWhenNok ?? undefined,
        aliases: input.aliases ?? undefined,
      }),
    },
    "Não foi possível salvar o componente.",
  );
  if (r.ok) refresh();
  return r;
}

export async function saveComponentServices(componentId: string, links: { serviceId: string; isDefault?: boolean; notes?: string | null }[]): Promise<Result<{ componentId: string; services: number }>> {
  const r = await call<{ componentId: string; services: number }>(
    "mtsr.component.manage",
    "mtsr_save_component_services",
    { p_component_id: componentId, p_links: links.map((l) => ({ service_id: l.serviceId, is_default: l.isDefault ?? true, notes: l.notes ?? null })) },
    "Não foi possível salvar os serviços do componente.",
  );
  if (r.ok) refresh();
  return r;
}

export interface ParametersInput {
  effectiveFrom?: string | null;
  conformeMaxDays?: number | null;
  attentionMinDays?: number | null;
  attentionMaxDays?: number | null;
  evidenceRetentionInspections?: number | null;
  evidenceRetentionDays?: number | null;
  reviewSlaDays?: number | null;
  maintenanceOpenSlaDays?: number | null;
  revalidationSlaDays?: number | null;
  note?: string | null;
}

export async function saveParameters(input: ParametersInput): Promise<Result<{ id: string; effectiveFrom: string }>> {
  const r = await call<{ id: string; effectiveFrom: string }>(
    "mtsr.parameters.manage",
    "mtsr_save_parameters",
    {
      p_payload: clean({
        effective_from: input.effectiveFrom ?? undefined,
        conforme_max_days: input.conformeMaxDays ?? undefined,
        attention_min_days: input.attentionMinDays ?? undefined,
        attention_max_days: input.attentionMaxDays ?? undefined,
        evidence_retention_inspections: input.evidenceRetentionInspections ?? undefined,
        evidence_retention_days: input.evidenceRetentionDays === undefined ? undefined : input.evidenceRetentionDays,
        review_sla_days: input.reviewSlaDays ?? undefined,
        maintenance_open_sla_days: input.maintenanceOpenSlaDays ?? undefined,
        revalidation_sla_days: input.revalidationSlaDays ?? undefined,
        note: input.note ?? undefined,
      }),
    },
    "Não foi possível salvar os parâmetros.",
  );
  if (r.ok) refresh();
  return r;
}

export async function saveSource(input: { id: string; name?: string | null; sourceSystem?: string | null; isEnabled?: boolean; priority?: number | null; notes?: string | null }): Promise<Result<{ id: string }>> {
  const r = await call<{ id: string }>(
    "mtsr.ingestion.manage",
    "mtsr_save_source",
    {
      p_payload: clean({
        id: input.id,
        name: input.name ?? undefined,
        source_system: input.sourceSystem === undefined ? undefined : input.sourceSystem,
        is_enabled: input.isEnabled ?? undefined,
        priority: input.priority ?? undefined,
        notes: input.notes === undefined ? undefined : input.notes,
      }),
    },
    "Não foi possível salvar a fonte.",
  );
  if (r.ok) refresh();
  return r;
}

export async function saveComponentSources(componentId: string, links: { sourceId: string; priority?: number | null; isEnabled?: boolean }[]): Promise<Result<{ componentId: string; links: number }>> {
  const r = await call<{ componentId: string; links: number }>(
    "mtsr.ingestion.manage",
    "mtsr_save_component_sources",
    { p_component_id: componentId, p_links: links.map((l) => ({ source_id: l.sourceId, priority: l.priority ?? 100, is_enabled: l.isEnabled ?? true })) },
    "Não foi possível salvar as fontes do componente.",
  );
  if (r.ok) refresh();
  return r;
}

// ---------------------------------------------------------------------------
// Retenção de evidências (parâmetro vigente; o servidor apaga e marca)
// ---------------------------------------------------------------------------
export interface PurgeOutcome {
  candidates: number;
  removed: number;
  marked: number;
  retentionInspections: number;
  retentionDays: number | null;
}

interface PurgeCandidates {
  retentionInspections: number;
  retentionDays: number | null;
  candidates: { id: string; inspectionId: string; bucketId: string; storagePath: string; reason: string }[];
}

export async function applyEvidenceRetention(vehicleId?: string | null, limit = 200): Promise<Result<PurgeOutcome>> {
  const list = await call<PurgeCandidates>(
    "mtsr.inspection.validate",
    "mtsr_evidence_purge_candidates",
    { p_vehicle_id: vehicleId ?? undefined, p_limit: limit },
    "Não foi possível listar as evidências a expurgar.",
  );
  if (!list.ok || !list.data) return { ok: false, error: list.error };
  const c = list.data;
  if (!c.candidates.length) {
    return { ok: true, data: { candidates: 0, removed: 0, marked: 0, retentionInspections: c.retentionInspections, retentionDays: c.retentionDays } };
  }
  let removed: string[] = [];
  try {
    removed = await removeEvidenceObjects(c.candidates.map((x) => x.storagePath));
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Não foi possível apagar as fotos do armazenamento." };
  }
  const ids = c.candidates.filter((x) => removed.includes(x.storagePath)).map((x) => x.id);
  const marked = await call<{ purged: number }>(
    "mtsr.inspection.validate",
    "mtsr_evidence_mark_purged",
    { p_ids: ids, p_reason: "retention" },
    "As fotos foram apagadas, mas não foi possível registrar o expurgo.",
  );
  if (!marked.ok) return { ok: false, error: marked.error };
  refresh();
  return {
    ok: true,
    data: { candidates: c.candidates.length, removed: removed.length, marked: marked.data?.purged ?? 0, retentionInspections: c.retentionInspections, retentionDays: c.retentionDays },
  };
}

async function applyEvidenceRetentionForInspection(inspectionId: string) {
  const detail = await loadInspectionDetail(inspectionId);
  if (detail.ok && detail.data) await applyEvidenceRetention(detail.data.vehicleId, 200);
}

// ---------------------------------------------------------------------------
// Ingestão manual (fonte habilitada, p. ex. OTHER_CONNECTOR não entra aqui)
// ---------------------------------------------------------------------------
export interface IngestOutcome {
  source: string;
  total: number;
  applied: number;
  ignored: number;
  conflict: number;
  rejected: number;
  duplicate: number;
  results: Record<string, unknown>[];
}

export async function ingestEvents(sourceCode: string, events: Record<string, Json>[]): Promise<Result<IngestOutcome>> {
  const r = await call<IngestOutcome>("mtsr.ingestion.manage", "mtsr_ingest_events", { p_source_code: sourceCode, p_events: events }, "Não foi possível processar os eventos.");
  if (r.ok) refresh();
  return r;
}
