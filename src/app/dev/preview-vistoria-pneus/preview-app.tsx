"use client";

import * as React from "react";
import { TiresApp, type TiresAppLoaders } from "@/app/(app)/aplicativos/vistoria-pneus/tires-app";
import type { Result, TireAppSubmitInput } from "@/lib/tires/app-actions";
import {
  camelize,
  type TireAppContext,
  type TireAppPositions,
  type TireAppSubmitResult,
  type TireAppVehicles,
  type TireMyInspectionDetail,
  type TireMyInspections,
} from "@/lib/tires/types";

/**
 * Carregadores da prévia: devolvem as saídas das rotinas `tire_inspection_*` e
 * `tire_my_*` guardadas nos fixtures (formato do banco, snake_case →
 * `camelize`), sem sessão nem banco. O envio é simulado com a mesma regra de
 * idempotência da rotina: a mesma `clientSubmissionId` devolve o mesmo
 * protocolo (`duplicate: true`). Um envio aceito entra em "Minhas vistorias"
 * desta sessão da prévia (e, se refaz uma vistoria retornada, a marca como
 * substituída), como faria o banco.
 *
 * As `clientSubmissionId` recebidas ficam em `window.__tiresPreviewSubmits`
 * para a verificação automatizada do reenvio.
 */
export type PreviewScenario = "base" | "retorno" | "falha" | "sem-foto" | "indisponivel";

type Raw = Record<string, unknown>;
type RawRow = Record<string, unknown>;

const RETURNED_ID = "e62f871e-ee29-4f7f-ba9d-e0a47b607aee";
const RETURNED_VEHICLE = "5258aefd-a8a2-4dfb-9d23-b05331280b48";
const RETURNED_NOTE = "Medição interrompida: 5 posições ficaram sem leitura. Refaça a medição completa do veículo, inclusive o estepe.";
const RETURNED_AT = "2026-10-06T13:10:00+00:00";

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const ok = <T,>(data: T): Result<T> => ({ ok: true, data });
const plateKey = (v: string) => v.toUpperCase().replace(/[^A-Z0-9]/g, "");

/** Os casos que os fixtures não trazem, aplicados sobre uma cópia (formato do banco). */
function applyScenario(source: Raw, scenario: PreviewScenario): Raw {
  const fx = structuredClone(source) as Raw;
  const context = fx.app_context as RawRow;
  if (scenario === "sem-foto") context.has_official_photo = false;
  if (scenario === "indisponivel") {
    context.app = { ...(context.app as RawRow), is_active: false };
    fx.app_vehicles = { app_available: false, total: 0, vehicles: [] };
  }
  if (scenario === "retorno") {
    const counts = context.counts as RawRow;
    context.counts = { mine_pending: Number(counts.mine_pending) - 1, mine_returned: 1 };
    const mine = fx.my_inspections as { rows: RawRow[] };
    for (const row of mine.rows) {
      if (row.id === RETURNED_ID) Object.assign(row, { status: "retornar_divergencia", review_note: RETURNED_NOTE, reviewed_at: RETURNED_AT });
    }
    const detail = fx[`my_detail:${RETURNED_ID}`] as RawRow & { items: RawRow[]; history: RawRow[] };
    Object.assign(detail, { status: "retornar_divergencia", review_note: RETURNED_NOTE, reviewed_at: RETURNED_AT });
    // A rotina devolve os tipos de divergência quando a vistoria volta ao campo;
    // estão aqui de propósito: a tela NÃO pode exibi-los (só a nota do revisor).
    detail.items = detail.items.map((it) => ({ ...it, divergence_types: it.measured ? ["PSI_DIVERGENTE"] : ["MEDICAO_INCOMPLETA"] }));
    detail.history = [...detail.history, { from_status: "pendente_revisao", to_status: "retornar_divergencia", reason: RETURNED_NOTE, created_at: RETURNED_AT }];
    const vehicles = fx.app_vehicles as { vehicles: RawRow[] };
    for (const v of vehicles.vehicles) {
      if (v.id === RETURNED_VEHICLE) Object.assign(v, { returned_inspection_id: RETURNED_ID, last_inspection_date: "2026-10-04" });
    }
    const positions = fx[`app_positions:${RETURNED_VEHICLE}`] as RawRow;
    positions.returned_inspection = { id: RETURNED_ID, protocol: "PNEU-2026-000004", review_note: RETURNED_NOTE, reviewed_at: RETURNED_AT };
  }
  return fx;
}

declare global {
  interface Window {
    __tiresPreviewSubmits?: string[];
  }
}

function buildLoaders(source: Raw, scenario: PreviewScenario): TiresAppLoaders {
  const fx = applyScenario(source, scenario);
  const accepted = new Map<string, TireAppSubmitResult>();
  let loseNextResponse = scenario === "falha";
  let sequence = 123;

  const submit = async (input: TireAppSubmitInput): Promise<Result<TireAppSubmitResult>> => {
    window.__tiresPreviewSubmits = [...(window.__tiresPreviewSubmits ?? []), input.clientSubmissionId];
    await wait(600);
    const existing = accepted.get(input.clientSubmissionId);
    if (existing) return ok({ ...existing, duplicate: true });

    const positions = fx[`app_positions:${input.vehicleId}`] as { positions: { code: string; label: string }[]; vehicle: RawRow } | undefined;
    if (!positions) return { ok: false, error: "Veículo não encontrado nesta organização." };
    const codes = new Set(positions.positions.map((p) => p.code));
    const foreign = input.items.find((it) => !codes.has(it.positionCode));
    if (foreign) return { ok: false, error: `Posição "${foreign.positionCode}" não pertence a este veículo.` };
    const measured = input.items.filter((it) => [it.fireNumberRead, it.tread1, it.tread2, it.tread3, it.tread4, it.psiRead].some((v) => v != null && v !== ""));
    if (measured.length === 0) return { ok: false, error: "Meça ao menos uma posição antes de enviar." };

    const protocol = `PNEU-2026-${String(sequence).padStart(6, "0")}`;
    sequence += 1;
    const id = `preview-${input.clientSubmissionId}`;
    const submittedAt = new Date().toISOString();
    const result: TireAppSubmitResult = {
      id,
      protocol,
      submittedAt,
      positionsExpected: codes.size,
      positionsMeasured: measured.length,
      duplicate: false,
    };
    accepted.set(input.clientSubmissionId, result);

    // Como o banco: entra em "Minhas vistorias" e substitui a retornada que refaz.
    const v = positions.vehicle;
    const mine = fx.my_inspections as { rows: RawRow[]; total: number };
    const context = fx.app_context as { counts: { mine_pending: number; mine_returned: number } };
    if (input.parentInspectionId) {
      for (const row of mine.rows) if (row.id === input.parentInspectionId) row.status = "substituida";
      const parent = fx[`my_detail:${input.parentInspectionId}`] as RawRow | undefined;
      if (parent) parent.status = "substituida";
      context.counts.mine_returned = Math.max(0, context.counts.mine_returned - 1);
      const list = fx.app_vehicles as { vehicles: RawRow[] };
      for (const veh of list.vehicles) if (veh.id === input.vehicleId) veh.returned_inspection_id = null;
      const pos = fx[`app_positions:${input.vehicleId}`] as RawRow;
      pos.returned_inspection = null;
    }
    context.counts.mine_pending += 1;
    const today = (fx.app_context as RawRow).today as string;
    mine.rows = [
      {
        id,
        protocol,
        vehicle_id: input.vehicleId,
        license_plate: v.license_plate,
        fleet_code: v.fleet_code,
        inspection_date: today,
        submitted_at: submittedAt,
        status: "pendente_revisao",
        positions_expected: codes.size,
        positions_measured: measured.length,
        review_note: null,
        reviewed_at: null,
      },
      ...mine.rows,
    ];
    mine.total += 1;
    const byCode = new Map(input.items.map((it) => [it.positionCode, it]));
    const num = (s: string | null | undefined) => (s ? Number(s.replace(",", ".")) : null);
    fx[`my_detail:${id}`] = {
      id,
      protocol,
      status: "pendente_revisao",
      vehicle_id: input.vehicleId,
      license_plate: v.license_plate,
      fleet_code: v.fleet_code,
      operation_name: v.operation_name,
      city_name: v.city_name,
      inspection_date: today,
      submitted_at: submittedAt,
      general_observation: input.generalObservation ?? null,
      review_note: null,
      reviewed_at: null,
      positions_expected: codes.size,
      positions_measured: measured.length,
      items: positions.positions.map((p) => {
        const it = byCode.get(p.code);
        const isMeasured = !!it && [it.fireNumberRead, it.tread1, it.tread2, it.tread3, it.tread4, it.psiRead].some((x) => x != null && x !== "");
        return {
          position_code: p.code,
          position_label: p.label,
          measured: isMeasured,
          fire_number_read: it?.fireNumberRead ?? null,
          tread_1: num(it?.tread1),
          tread_2: num(it?.tread2),
          tread_3: num(it?.tread3),
          tread_4: num(it?.tread4),
          psi_read: num(it?.psiRead),
          observation: it?.observation ?? null,
          divergence_types: [],
        };
      }),
      history: [{ from_status: null, to_status: "pendente_revisao", reason: "Vistoria enviada pelo aplicativo (leitura cega).", created_at: submittedAt }],
    };

    if (loseNextResponse) {
      // O banco gravou, mas a resposta não voltou ao aparelho.
      loseNextResponse = false;
      throw new TypeError("Failed to fetch");
    }
    return ok(result);
  };

  return {
    context: async () => {
      await wait(150);
      return ok(camelize<TireAppContext>(structuredClone(fx.app_context)));
    },
    vehicles: async (search) => {
      await wait(180);
      const base = fx.app_vehicles as { app_available: boolean; total: number; vehicles: RawRow[] };
      const q = (search ?? "").trim();
      const rows = q
        ? base.vehicles.filter(
            (v) => plateKey(String(v.license_plate)).includes(plateKey(q) || "#") || String(v.fleet_code ?? "").toUpperCase().includes(q.toUpperCase()),
          )
        : base.vehicles;
      return ok(camelize<TireAppVehicles>({ ...base, vehicles: structuredClone(rows), total: rows.length }));
    },
    positions: async (vehicleId) => {
      await wait(200);
      const p = fx[`app_positions:${vehicleId}`];
      return p ? ok(camelize<TireAppPositions>(structuredClone(p))) : { ok: false, error: "Veículo não encontrado nesta organização." };
    },
    submit,
    myInspections: async () => {
      await wait(150);
      return ok(camelize<TireMyInspections>(structuredClone(fx.my_inspections)));
    },
    myDetail: async (id) => {
      await wait(150);
      const d = fx[`my_detail:${id}`];
      // Como a rotina: vistoria de outra pessoa (ou inexistente) volta vazia.
      return d ? ok(camelize<TireMyInspectionDetail>(structuredClone(d))) : { ok: true };
    },
  };
}

export function PreviewTiresApp({ canExecute, fixtures, scenario }: { canExecute: boolean; fixtures: Raw; scenario: PreviewScenario }) {
  const loaders = React.useMemo(() => buildLoaders(fixtures, scenario), [fixtures, scenario]);
  return <TiresApp loaders={loaders} canExecute={canExecute} />;
}
