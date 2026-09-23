"use client";

import * as React from "react";
import { FleetPlanner } from "@/app/(app)/governanca/fidelizacao/fleet-planner";
import type {
  ApplyPeriodInput, EligibleVehicle, PeriodAction, PeriodConflict, PeriodMode, PeriodResult, Result,
} from "@/lib/governance/actions";
import type { PlannerMatrix, PlannerRow, PlannerSegment } from "@/lib/governance/fidelization-central";
import {
  PLANNER_COMPETENCE, PLANNER_LEADERS, PLANNER_MATRIX, PLANNER_TODAY, PLANNER_VEHICLE_TYPES, PLANNER_VEHICLES,
  asEligible,
} from "../fixture-planner";

/**
 * O Planner de Frotas contra dados fixos.
 *
 * A tela real fala com duas rotinas do servidor — a busca de placas elegíveis e
 * `apply_fidelization_period` — que aqui não existem (não há sessão). As duas
 * são substituídas por versões que seguem as mesmas regras da rotina SQL sobre
 * o fixture: prévia de substituição e de primeira alocação, o conflito com
 * `canInvert` quando a placa ocupa outra BR, a inversão quando pedida, a recusa
 * sem motivo e a gravação que só responde "ok". Os filtros também funcionam,
 * no navegador, com a semântica dos da RPC.
 */

const OPEN_END = "9999-12-31";
const ALL_ROWS = PLANNER_MATRIX.rows;

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const overlaps = (start: string, end: string | null, from: string, to: string | null) =>
  start <= (to ?? OPEN_END) && (end ?? OPEN_END) >= from;
const addDays = (iso: string, delta: number) => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + delta)).toISOString().slice(0, 10);
};
const br = (iso: string) => iso.split("-").reverse().join("/");
const normalize = (value: string | null | undefined) =>
  (value ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const labelOf = (vehicleId: string) => {
  const v = PLANNER_VEHICLES.find((x) => x.vehicleId === vehicleId);
  return v ? v.fleetCode : "sem identificação";
};

function occupancy(vehicleId: string, from: string, to: string | null, exceptBr?: string) {
  return ALL_ROWS.flatMap((row) =>
    row.operationBrId === exceptBr
      ? []
      : row.segments
          .filter((s) => s.vehicleId === vehicleId && s.status !== "cancelled" && overlaps(s.startDate, s.endDate, from, to))
          .map((segment) => ({ row, segment })),
  );
}

/** Os mesmos recortes de `private.fidelization_carve`: antes fica, o período sai, depois volta. */
function carve(row: PlannerRow, s: PlannerSegment, from: string, to: string | null): PeriodAction[] {
  const base = { assignmentId: s.assignmentId, operationBrId: row.operationBrId, brCode: row.brCode, vehicleId: s.vehicleId, vehicleLabel: labelOf(s.vehicleId) };
  const out: PeriodAction[] = [];
  if (s.startDate < from) {
    out.push({ ...base, kind: "trim", startDate: s.startDate, endDate: addDays(from, -1), previousEndDate: s.endDate, drivers: null });
  } else {
    out.push({ ...base, kind: "cancel", startDate: s.startDate, endDate: s.endDate, previousEndDate: null, drivers: null });
  }
  if (to !== null && (s.endDate ?? OPEN_END) > to) {
    out.push({
      ...base,
      assignmentId: `${s.assignmentId}-cont`,
      kind: "continue",
      startDate: addDays(to, 1),
      endDate: s.endDate,
      previousEndDate: null,
      drivers: s.drivers.filter((d) => (d.endDate ?? OPEN_END) > to).length,
    });
  }
  return out;
}

function create(row: PlannerRow, vehicleId: string, from: string, to: string | null): PeriodAction {
  return {
    kind: "create", assignmentId: `new-${row.operationBrId}-${vehicleId}`, operationBrId: row.operationBrId,
    brCode: row.brCode, vehicleId, vehicleLabel: labelOf(vehicleId), startDate: from, endDate: to,
    previousEndDate: null, drivers: null,
  };
}

const driversIn = (s: PlannerSegment | undefined, from: string, to: string | null) =>
  s ? s.drivers.filter((d) => overlaps(d.startDate, d.endDate, from, to)).length : 0;

async function fakeApplyPeriod(input: ApplyPeriodInput): Promise<Result<PeriodResult>> {
  await wait(250);
  const row = ALL_ROWS.find((r) => r.operationBrId === input.operationBrId);
  if (!row) return { ok: false, error: "Posição operacional (BR) não encontrada." };
  const from = input.dateFrom;
  const to = input.dateTo;
  if (!from) return { ok: false, error: "Informe a BR e a data inicial do período." };
  if (to && to < from) {
    return { ok: false, error: `O fim do período (${br(to)}) não pode ser anterior ao início (${br(from)}).` };
  }

  const occ = row.segments.filter((s) => s.status !== "cancelled" && overlaps(s.startDate, s.endDate, from, to));
  let foreign: { row: PlannerRow; segment: PlannerSegment }[] = [];
  let vehicleLabel: string | null = null;
  if (input.vehicleId) {
    if (occ.some((s) => s.vehicleId === input.vehicleId)) {
      return { ok: false, error: "Este veículo já ocupa a BR em parte deste período. Ajuste o período ou use o encerramento do vínculo existente." };
    }
    foreign = occupancy(input.vehicleId, from, to, row.operationBrId);
    vehicleLabel = labelOf(input.vehicleId);
  } else if (occ.length === 0) {
    return { ok: false, error: "Não há veículo nesta BR no período escolhido — não há o que remover." };
  }

  const conflicts: PeriodConflict[] = foreign.map(({ row: r, segment: s }) => ({
    assignmentId: s.assignmentId, operationBrId: r.operationBrId, brCode: r.brCode, operationName: r.operationName,
    cityName: r.cityName, vehicleRole: "primary", startDate: s.startDate, endDate: s.endDate,
  }));
  const covers = (s: PlannerSegment) => s.startDate <= from && (s.endDate === null || (to !== null && s.endDate >= to));
  const canInvert = foreign.length === 1 && covers(foreign[0].segment) && (occ.length === 0 || (occ.length === 1 && covers(occ[0])));
  const historical = from < PLANNER_TODAY;
  const base = {
    operationBrId: row.operationBrId, brCode: row.brCode, vehicleId: input.vehicleId, vehicleLabel,
    dateFrom: from, dateTo: to, historical, conflicts, canInvert,
  };

  if (foreign.length > 0 && !input.invert) {
    if (input.dryRun) {
      return { ok: true, data: { ...base, preview: true, mode: "conflict", driversKept: 0, actions: [] } };
    }
    return { ok: false, error: `O veículo ${vehicleLabel} já está fidelizado em ${conflicts.map((c) => c.brCode).join(", ")} no período. Confirme a inversão ou ajuste o período.` };
  }
  if (input.invert && foreign.length > 0 && !canInvert) {
    return { ok: false, error: "Para inverter, o veículo precisa estar em uma única outra BR durante todo o período, e esta BR precisa ter no máximo um titular também durante todo o período. Ajuste o período." };
  }

  const mode: PeriodMode = !input.vehicleId
    ? "remove"
    : foreign.length > 0 && occ.length > 0
      ? "invert"
      : foreign.length > 0
        ? "transfer"
        : occ.length > 0
          ? "substitute"
          : "allocate";
  if (mode !== "allocate" && !input.reason?.trim()) return { ok: false, error: "Informe o motivo da alteração." };

  const actions: PeriodAction[] = occ.flatMap((s) => carve(row, s, from, to));
  if (mode === "invert" || mode === "transfer") actions.push(...carve(foreign[0].row, foreign[0].segment, from, to));
  if (input.vehicleId) actions.push(create(row, input.vehicleId, from, to));
  if (mode === "invert") actions.push(create(foreign[0].row, occ[0].vehicleId, from, to));

  const keep = input.keepDrivers ?? true;
  const driversKept = keep && input.vehicleId
    ? driversIn(occ.find((s) => s.startDate <= from) ?? occ[0], from, to) +
      (mode === "invert" ? driversIn(foreign[0].segment, from, to) : 0)
    : 0;

  return { ok: true, data: { ...base, preview: input.dryRun, mode, driversKept, actions } };
}

async function fakeSearchVehicles(input: {
  operationBrId: string;
  startDate: string;
  endDate?: string | null;
  search?: string | null;
}): Promise<Result<EligibleVehicle[]>> {
  await wait(120);
  const term = normalize(input.search);
  const data = PLANNER_VEHICLES
    .filter((v) => !term || normalize(`${v.fleetCode} ${v.licensePlate} ${v.makeName} ${v.modelName}`).includes(term))
    .map((v) => {
      const hit = occupancy(v.vehicleId, input.startDate, input.endDate ?? null)[0];
      return { ...asEligible(v), hasConflict: Boolean(hit), conflictBr: hit?.row.brCode ?? null };
    })
    .sort((a, b) => Number(a.hasConflict) - Number(b.hasConflict) || (a.fleetCode ?? "").localeCompare(b.fleetCode ?? ""));
  return { ok: true, data };
}

interface PreviewFilters {
  q?: string;
  leaderEmployeeId?: string;
  vehicle?: string;
  vehicleTypeId?: string;
  situation?: string;
}

/** Os filtros da RPC, reproduzidos no navegador sobre o fixture. */
function filterRows(rows: PlannerRow[], f: PreviewFilters): PlannerRow[] {
  const q = normalize(f.q);
  const vehicle = normalize(f.vehicle);
  return rows.filter((row) => {
    const segs = row.segments.filter((s) => s.status !== "cancelled");
    if (q && !normalize(`${row.brCode} ${row.brDescription ?? ""}`).includes(q)) return false;
    if (f.leaderEmployeeId && row.leaderEmployeeId !== f.leaderEmployeeId) return false;
    if (vehicle && !segs.some((s) => normalize(`${s.fleetCode ?? ""} ${s.licensePlate ?? ""}`).includes(vehicle))) return false;
    if (f.vehicleTypeId && !segs.some((s) => s.vehicleTypeId === f.vehicleTypeId)) return false;
    switch (f.situation) {
      case "with_vehicle": return row.daysWithVehicle > 0;
      case "without_vehicle": return row.daysWithVehicle === 0;
      case "partial": return row.daysWithoutVehicle > 0 && row.daysWithVehicle > 0;
      case "full": return row.daysWithoutVehicle === 0;
      case "changed": return row.changes > 0;
      default: return true;
    }
  });
}

const URL_TO_FILTER: Record<string, keyof PreviewFilters> = {
  q: "q",
  lideranca: "leaderEmployeeId",
  placa: "vehicle",
  tipo_equipamento: "vehicleTypeId",
  alocacao: "situation",
};

export function PreviewPlannerClient({
  canEdit,
  canManageHistorical,
}: {
  canEdit: boolean;
  canManageHistorical: boolean;
}) {
  const [filters, setFilters] = React.useState<PreviewFilters>({});
  const [pending, startTransition] = React.useTransition();
  const [opened, setOpened] = React.useState<string | null>(null);

  const matrix = React.useMemo<PlannerMatrix>(() => {
    const rows = filterRows(ALL_ROWS, filters);
    return { ...PLANNER_MATRIX, rows, total: rows.length };
  }, [filters]);

  const navigate = (patch: Record<string, string | null>) => {
    startTransition(() => {
      setFilters((current) => {
        const next = { ...current };
        for (const [key, value] of Object.entries(patch)) {
          const field = URL_TO_FILTER[key];
          if (!field) continue;
          if (value) next[field] = value;
          else delete next[field];
        }
        return next;
      });
    });
  };

  const openedRow = opened ? ALL_ROWS.find((r) => r.operationBrId === opened) : null;

  return (
    <div className="flex min-w-0 flex-col gap-3">
      {openedRow ? (
        <p role="status" className="text-caption text-fg-muted">
          Abrir BR (prévia): {openedRow.brCode} · {openedRow.cityName}/{openedRow.stateUf}
        </p>
      ) : null}
      <FleetPlanner
        matrix={matrix}
        competence={PLANNER_COMPETENCE}
        filters={filters}
        leaders={PLANNER_LEADERS}
        vehicleTypes={PLANNER_VEHICLE_TYPES}
        onNavigate={navigate}
        pending={pending}
        canEdit={canEdit}
        canManageHistorical={canManageHistorical}
        onOpenBr={setOpened}
        applyPeriod={fakeApplyPeriod}
        searchVehicles={fakeSearchVehicles}
      />
    </div>
  );
}
