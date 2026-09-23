"use server";

import { createClient } from "@/lib/supabase/server";
import { resolveOrganization } from "@/lib/auth/session";
import type { Json } from "@/types/database.types";
import type { Result, SaveLeadershipInput } from "./actions";
import type { LeadershipImpact } from "./leadership-impact-types";

/**
 * Prévia do impacto de uma alteração de liderança (Etapa 13 §14).
 *
 * Chama `leadership_change_impact` com o MESMO payload que a gravação usa, sob
 * o cliente de quem pede: a rotina confere `leadership.manage` no escopo da
 * operação e, quando a alteração alcança dias que já passaram, a permissão de
 * correção histórica. Nada é gravado — a função é STABLE no banco.
 */

const SESSION_LOST = "Sua sessão expirou ou o acesso mudou. Recarregue a página e tente de novo.";

/** Frases das rotinas passam como estão; o resto vira uma frase honesta. */
function toMessage(error: { message?: string; code?: string } | null): string {
  const message = error?.message ?? "";
  if (error?.code === "42501" && !/^[A-ZÀ-Ú]/.test(message)) return "Você não possui permissão para esta ação.";
  if (/^[A-ZÀ-Ú]/.test(message) && !message.includes("violates") && !message.includes("relation")) return message;
  return "Não foi possível calcular o impacto da alteração.";
}

const asCount = (value: unknown): number => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};
const asText = (value: unknown): string | null => (typeof value === "string" && value !== "" ? value : null);
const asList = (value: unknown): Record<string, unknown>[] =>
  Array.isArray(value) ? (value.filter((v) => v && typeof v === "object") as Record<string, unknown>[]) : [];
const group = (value: unknown) => (value && typeof value === "object" ? (value as Record<string, unknown>) : {});

function parseImpact(data: unknown): LeadershipImpact {
  const d = group(data);
  const brs = group(d.brs);
  const vehicles = group(d.vehicles);
  const drivers = group(d.drivers);
  const checklists = group(d.checklists);
  const obligations = group(d.obligations);
  const names = (value: unknown) => (Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : []);

  return {
    retroactive: Boolean(d.retroactive),
    today: asText(d.today) ?? "",
    periods: asList(d.periods).map((p) => ({ from: asText(p.from) ?? "", to: asText(p.to) ?? "" })),
    pastDays: asCount(d.past_days),
    changedDays: asCount(d.changed_days),
    snapshotsPreserved: d.snapshots_preserved !== false,
    recentPendingObligations: asCount(d.recent_pending_obligations),
    brs: {
      count: asCount(brs.count),
      sample: asList(brs.sample).map((b) => ({
        id: asText(b.operation_br_id) ?? "",
        code: asText(b.code) ?? "—",
        operationName: asText(b.operation_name),
        cityName: asText(b.city_name),
        stateUf: asText(b.state_uf),
        firstDay: asText(b.first_day) ?? "",
        lastDay: asText(b.last_day) ?? "",
        days: asCount(b.days),
        leadersBefore: names(b.leaders_before),
        leadersAfter: names(b.leaders_after),
      })),
    },
    vehicles: {
      count: asCount(vehicles.count),
      sample: asList(vehicles.sample).map((v) => ({
        id: asText(v.vehicle_id) ?? "",
        fleetCode: asText(v.fleet_code),
        licensePlate: asText(v.license_plate),
        brCode: asText(v.br_code),
        from: asText(v.from) ?? "",
        to: asText(v.to) ?? "",
      })),
    },
    drivers: {
      count: asCount(drivers.count),
      sample: asList(drivers.sample).map((v) => ({
        id: asText(v.employee_id) ?? "",
        name: asText(v.name) ?? "—",
        employeeCode: asText(v.employee_code),
        brCode: asText(v.br_code),
        from: asText(v.from) ?? "",
        to: asText(v.to) ?? "",
      })),
    },
    checklists: {
      count: asCount(checklists.count),
      sample: asList(checklists.sample).map((c) => ({
        id: asText(c.id) ?? "",
        date: asText(c.operational_date) ?? "",
        context: asText(c.checklist_type),
        brCode: asText(c.br_code),
        licensePlate: asText(c.license_plate),
        fleetCode: asText(c.fleet_code),
        leaderName: asText(c.leader_name),
      })),
    },
    obligations: {
      count: asCount(obligations.count),
      open: asCount(obligations.open),
      sample: asList(obligations.sample).map((o) => ({
        id: asText(o.id) ?? "",
        date: asText(o.operational_date) ?? "",
        context: asText(o.checklist_context),
        brCode: asText(o.br_code),
        licensePlate: asText(o.license_plate),
        fleetCode: asText(o.fleet_code),
        leaderName: asText(o.leader_name),
        open: Boolean(o.open),
      })),
    },
  };
}

export async function previewLeadershipChange(input: SaveLeadershipInput): Promise<Result<LeadershipImpact>> {
  const context = await resolveOrganization("leadership.manage");
  if (!context) return { ok: false, error: SESSION_LOST };

  const supabase = await createClient();
  const payload = {
    id: input.id ?? null,
    employee_id: input.employeeId,
    scope_level: input.scopeLevel,
    operation_id: input.operationId,
    operation_city_id: input.operationCityId ?? null,
    operation_br_id: input.operationBrId ?? null,
    responsibility_type: input.responsibilityType,
    effective_from: input.effectiveFrom,
    effective_to: input.effectiveTo ?? null,
  };

  const { data, error } = await supabase.rpc("leadership_change_impact", {
    p_organization_id: context.organization.organizationId,
    p_payload: payload as unknown as Json,
  });

  if (error) return { ok: false, error: toMessage(error) };
  return { ok: true, data: parseImpact(data) };
}
