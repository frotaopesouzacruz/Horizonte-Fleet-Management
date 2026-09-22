"use client";

import * as React from "react";
import { ChecklistApp, type ChecklistLoaders } from "@/app/(app)/aplicativos/check-list-frota/checklist-app";
import type { ChecklistContext, ExecutionSummary } from "@/lib/applications/queries";
import type { EquipmentOption, VehicleOption } from "@/lib/applications/actions";
import { FORM } from "@/app/dev/preview-checklist/preview-runner";

/**
 * A amostra reproduz o estado inicial aprovado: quatro operações habilitadas
 * e Frota Leve ADM fora do aplicativo. As listas de tipo e de placa vêm de
 * tabelas fixas por combinação — exatamente o que o servidor devolveria.
 */
const CONTEXT: ChecklistContext = {
  available: true,
  reason: null,
  appName: "Check List de Frota",
  allowsAttachments: false,
  version: { id: "ver-1", label: "1.0", minDurationSeconds: 60, maxDurationSeconds: 600 },
  actor: { employeeId: "emp-1", name: "Motorista de Teste", employeeCode: "000123" },
  operations: [
    { id: "op-lmmg", name: "Last Mille MG" },
    { id: "op-merch", name: "Merchandising" },
    { id: "op-redmg", name: "Redespacho - MG" },
    { id: "op-belem", name: "Redespacho - Belém/Pa" },
  ],
};

const EQUIPMENT: Record<string, EquipmentOption[]> = {
  "op-lmmg": [
    { id: "t-van", code: "van", name: "Van", vehicles: 2 },
    { id: "t-ope", code: "utility", name: "Frota Leve OPE", vehicles: 1 },
  ],
  "op-merch": [{ id: "t-ope", code: "utility", name: "Frota Leve OPE", vehicles: 1 }],
  "op-redmg": [{ id: "t-truck", code: "truck", name: "Caminhão", vehicles: 0 }],
  "op-belem": [],
};

const VEHICLES: Record<string, VehicleOption[]> = {
  "op-lmmg:t-van": [
    { id: "v-1", licensePlate: "ABC1D23", fleetCode: "FR-0142", vehicleTypeId: "t-van", vehicleTypeName: "Van", brCode: "BR-017", expected: true },
    { id: "v-2", licensePlate: "DEF4G56", fleetCode: "FR-0150", vehicleTypeId: "t-van", vehicleTypeName: "Van", brCode: "BR-022", expected: true },
  ],
  "op-lmmg:t-ope": [
    { id: "v-3", licensePlate: "HIJ7K89", fleetCode: "FR-0201", vehicleTypeId: "t-ope", vehicleTypeName: "Frota Leve OPE", brCode: null, expected: false },
  ],
  "op-merch:t-ope": [
    { id: "v-4", licensePlate: "LMN0P12", fleetCode: "FR-0310", vehicleTypeId: "t-ope", vehicleTypeName: "Frota Leve OPE", brCode: "BR-104", expected: true },
  ],
};

const HISTORY: ExecutionSummary[] = [
  {
    id: "exec-1", operationalDate: "2026-09-21", checklistType: "saida", licensePlate: "ABC1D23", fleetCode: "FR-0142",
    operationName: "Last Mille MG", brCode: "BR-017", submittedAt: "2026-09-21T09:12:00Z", durationSeconds: 184,
    applicable: 32, conforming: 30, nonConforming: 2, criticalNonConforming: 1,
  },
];

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const loaders: ChecklistLoaders = {
  loadEquipmentOptions: async (operationId) => {
    await wait(60);
    return { ok: true, data: EQUIPMENT[operationId] ?? [] };
  },
  loadVehicleOptions: async (operationId, vehicleTypeId) => {
    await wait(60);
    return { ok: true, data: VEHICLES[`${operationId}:${vehicleTypeId}`] ?? [] };
  },
  loadChecklistForm: async (vehicleId) => {
    await wait(60);
    const vehicle = Object.values(VEHICLES).flat().find((v) => v.id === vehicleId);
    return {
      ok: true,
      data: {
        ...FORM,
        vehicle: { id: vehicleId, licensePlate: vehicle?.licensePlate ?? null, fleetCode: vehicle?.fleetCode ?? null },
      },
    };
  },
  submit: async (input) => {
    await wait(60);
    return {
      ok: true,
      data: {
        executionId: "exec-preview",
        duplicate: false,
        applicable: input.answers.length,
        conforming: input.answers.length,
        nonConforming: 0,
        criticalNonConforming: 0,
        durationSeconds: 90,
        hasObligationContext: true,
      },
    };
  },
  loadExecutionDetail: async () => ({ ok: false, error: "Detalhe indisponível na prévia do fluxo." }),
  loadScopeExecutions: async () => ({ ok: true, data: [] }),
};

export function PreviewFlow() {
  return (
    <ChecklistApp
      context={CONTEXT}
      history={HISTORY}
      canExecute
      canViewOwn
      canViewScope
      canConfigure={false}
      loaders={loaders}
    />
  );
}
