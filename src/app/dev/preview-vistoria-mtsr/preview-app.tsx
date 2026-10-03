"use client";

import * as React from "react";
import { MtsrApp, type MtsrAppLoaders } from "@/app/(app)/aplicativos/vistoria-mtsr/mtsr-app";
import type { MtsrAppContext, MtsrAppVehicle, MtsrInspectionDetail, MtsrInspectionItem } from "@/lib/mtsr/types";

/**
 * O aplicativo inteiro com contexto fixo e carregadores injetados.
 *
 * A amostra traz um caso de cada regra que o executor precisa distinguir:
 * foto obrigatória em OK e em NOK (Teclado Macro), foto só em NOK (travas),
 * foto sempre opcional (sirene), observação obrigatória em NOK em todos; três
 * frotas com prazo Conforme / Atenção / Vencido, uma com vistoria pendente de
 * validação; e um histórico com vistoria validada, retornada (com motivo) e
 * pendente, com foto viva e foto expurgada.
 */
export const CONTEXT: MtsrAppContext = {
  available: true,
  reason: null,
  today: "2026-10-03",
  app: { id: "app-mtsr", name: "Vistoria MTSR", slug: "vistoria_mtsr", allowsAttachments: true },
  actor: { userId: "user-preview", employeeId: "emp-456", name: "Vistoriador de Teste", employeeCode: "000456" },
  components: [
    {
      id: "cmp-teclado",
      code: "teclado_macro",
      name: "Teclado Macro",
      description: "Teclado de macros do rastreador: todas as teclas respondem e o display acende.",
      evidenceRequiredWhenOk: true,
      evidenceRequiredWhenNok: true,
      observationRequiredWhenNok: true,
    },
    {
      id: "cmp-trava-lateral",
      code: "travas_bau_lateral",
      name: "Travas do Baú Lateral",
      description: "As travas das portas laterais do baú fecham e travam pelo sistema.",
      evidenceRequiredWhenOk: false,
      evidenceRequiredWhenNok: true,
      observationRequiredWhenNok: true,
    },
    {
      id: "cmp-trava-traseira",
      code: "travas_bau_traseiro",
      name: "Travas do Baú Traseiro",
      description: "A trava da porta traseira do baú fecha e trava pelo sistema.",
      evidenceRequiredWhenOk: false,
      evidenceRequiredWhenNok: true,
      observationRequiredWhenNok: true,
    },
    {
      id: "cmp-sirene",
      code: "sirene",
      name: "Sirene do Sistema",
      description: "A sirene dispara no teste de pânico.",
      evidenceRequiredWhenOk: false,
      evidenceRequiredWhenNok: false,
      observationRequiredWhenNok: true,
    },
  ],
  backofficeComponents: ["MDVR", "Câmeras (CFTV)", "Geotab"],
  evidence: { bucket: "mtsr-evidence", maxBytes: 10485760, mimeTypes: ["image/jpeg", "image/png", "image/webp"], maxPerItem: 6 },
};

const VEHICLES: MtsrAppVehicle[] = [
  {
    id: "v-1",
    licensePlate: "ABC1D23",
    fleetCode: "FR-0142",
    vehicleTypeId: "t-van",
    vehicleTypeName: "Van",
    operationId: "op-lmmg",
    operationName: "Last Mille MG",
    cityName: "Belo Horizonte",
    stateUf: "MG",
    brCode: "BR-017",
    leaderName: "Carlos Lima",
    lastValidInspectionDate: "2026-09-20",
    deadlineStatus: "conforme",
    daysSince: 13,
    nokCount: 0,
    conformityStatus: "conforme",
    pendingInspection: false,
  },
  {
    id: "v-2",
    licensePlate: "DEF4G56",
    fleetCode: "FR-0150",
    vehicleTypeId: "t-van",
    vehicleTypeName: "Van",
    operationId: "op-lmmg",
    operationName: "Last Mille MG",
    cityName: "Contagem",
    stateUf: "MG",
    brCode: "BR-022",
    leaderName: "Carlos Lima",
    lastValidInspectionDate: "2026-08-05",
    deadlineStatus: "atencao",
    daysSince: 59,
    nokCount: 1,
    conformityStatus: "nao_conforme",
    pendingInspection: true,
  },
  {
    id: "v-3",
    licensePlate: "HIJ7K89",
    fleetCode: "FR-0201",
    vehicleTypeId: "t-ope",
    vehicleTypeName: "Frota Leve OPE",
    operationId: "op-merch",
    operationName: "Merchandising",
    cityName: "São Paulo",
    stateUf: "SP",
    brCode: null,
    leaderName: null,
    lastValidInspectionDate: "2026-06-01",
    deadlineStatus: "vencido",
    daysSince: 124,
    nokCount: 0,
    conformityStatus: "sem_informacao",
    pendingInspection: false,
  },
];

type ItemSeed = Pick<MtsrInspectionItem, "id" | "componentId" | "componentCode" | "componentName" | "status"> & Partial<MtsrInspectionItem>;

function item(seed: ItemSeed): MtsrInspectionItem {
  return {
    observation: null,
    evidenceCount: 0,
    appliedAt: null,
    skippedReason: null,
    officialStatus: "sem_informacao",
    officialReferenceDate: null,
    officialSourceType: null,
    awaitingRevalidation: false,
    maintenance: null,
    evidence: [],
    ...seed,
  };
}

type InspectionSeed = Pick<MtsrInspectionDetail, "id" | "protocol" | "status" | "inspectionDate" | "submittedAt" | "licensePlateSnapshot"> & Partial<MtsrInspectionDetail>;

function inspection(seed: InspectionSeed): MtsrInspectionDetail {
  const items = seed.items ?? [];
  return {
    appId: "app-mtsr",
    source: "field_inspection",
    vehicleId: "v-1",
    fleetCodeSnapshot: null,
    vehicleTypeId: "t-van",
    contextDate: seed.inspectionDate,
    contextSource: "fidelization",
    operationId: "op-lmmg",
    operationNameSnapshot: "Last Mille MG",
    cityNameSnapshot: "Belo Horizonte",
    stateUfSnapshot: "MG",
    brCodeSnapshot: null,
    unitNameSnapshot: null,
    leaderNameSnapshot: null,
    inspectorUserId: "user-preview",
    inspectorEmployeeId: "emp-456",
    inspectorNameSnapshot: "Vistoriador de Teste",
    inspectorCodeSnapshot: "000456",
    inspectedAt: seed.submittedAt,
    generalObservation: null,
    itemCount: items.length,
    nokCount: items.filter((i) => i.status === "nok").length,
    evidenceCount: items.reduce((sum, i) => sum + i.evidence.length, 0),
    reviewedBy: null,
    reviewedAt: null,
    reviewerNameSnapshot: null,
    reviewReason: null,
    clientSubmissionId: `csid-${seed.id}`,
    createdAt: seed.submittedAt,
    events: [],
    card: null,
    daysWaiting: null,
    isOwn: true,
    ...seed,
    items,
  };
}

const evidence = (id: string, storagePath: string, purged: boolean) => ({
  id,
  bucketId: "mtsr-evidence",
  storagePath,
  mimeType: "image/jpeg",
  sizeBytes: 182_000,
  capturedAt: "2026-10-01T11:02:00Z",
  purgedAt: purged ? "2026-10-02T03:00:00Z" : null,
});

const HISTORY: MtsrInspectionDetail[] = [
  inspection({
    id: "insp-3",
    protocol: "MTSR-2026-000122",
    status: "pendente_validacao",
    inspectionDate: "2026-10-02",
    submittedAt: "2026-10-02T14:20:00Z",
    licensePlateSnapshot: "HIJ7K89",
    fleetCodeSnapshot: "FR-0201",
    vehicleId: "v-3",
    operationNameSnapshot: "Merchandising",
    cityNameSnapshot: "São Paulo",
    stateUfSnapshot: "SP",
    daysWaiting: 1,
    items: CONTEXT.components.map((c, index) =>
      item({ id: `i3-${index}`, componentId: c.id, componentCode: c.code, componentName: c.name, status: "ok", officialStatus: "sem_informacao" }),
    ),
  }),
  inspection({
    id: "insp-2",
    protocol: "MTSR-2026-000121",
    status: "retornada",
    inspectionDate: "2026-10-01",
    submittedAt: "2026-10-01T11:05:00Z",
    licensePlateSnapshot: "DEF4G56",
    fleetCodeSnapshot: "FR-0150",
    vehicleId: "v-2",
    cityNameSnapshot: "Contagem",
    reviewedAt: "2026-10-01T16:40:00Z",
    reviewerNameSnapshot: "Ana Segurança",
    reviewReason: "Foto do teclado macro ilegível; refaça a vistoria com foto nítida do display aceso.",
    items: [
      item({
        id: "i2-1",
        componentId: "cmp-teclado",
        componentCode: "teclado_macro",
        componentName: "Teclado Macro",
        status: "ok",
        officialStatus: "ok",
        officialReferenceDate: "2026-08-05",
        officialSourceType: "field_inspection",
        evidenceCount: 2,
        evidence: [
          evidence("ev-1", "org-preview/inspections/insp-2/cmp-teclado/1.jpg", false),
          evidence("ev-2", "org-preview/inspections/insp-2/cmp-teclado/2.jpg", true),
        ],
      }),
      item({
        id: "i2-2",
        componentId: "cmp-trava-lateral",
        componentCode: "travas_bau_lateral",
        componentName: "Travas do Baú Lateral",
        status: "nok",
        observation: "Trava lateral esquerda não aciona pelo sistema.",
        officialStatus: "nok",
        officialReferenceDate: "2026-08-05",
        officialSourceType: "field_inspection",
        awaitingRevalidation: true,
        maintenance: { id: "m-1", code: "MNT-2026-0419", status: "in_progress", label: "Em execução", linkId: "l-1" },
        evidenceCount: 1,
        evidence: [evidence("ev-3", "org-preview/inspections/insp-2/cmp-trava-lateral/1.jpg", false)],
      }),
      item({ id: "i2-3", componentId: "cmp-trava-traseira", componentCode: "travas_bau_traseiro", componentName: "Travas do Baú Traseiro", status: "ok", officialStatus: "ok", officialReferenceDate: "2026-08-05", officialSourceType: "field_inspection" }),
      item({ id: "i2-4", componentId: "cmp-sirene", componentCode: "sirene", componentName: "Sirene do Sistema", status: "ok", officialStatus: "ok", officialReferenceDate: "2026-08-05", officialSourceType: "field_inspection" }),
    ],
  }),
  inspection({
    id: "insp-1",
    protocol: "MTSR-2026-000118",
    status: "validada",
    inspectionDate: "2026-09-20",
    submittedAt: "2026-09-20T09:12:00Z",
    licensePlateSnapshot: "ABC1D23",
    fleetCodeSnapshot: "FR-0142",
    reviewedAt: "2026-09-20T13:00:00Z",
    reviewerNameSnapshot: "Ana Segurança",
    items: CONTEXT.components.map((c, index) =>
      item({
        id: `i1-${index}`,
        componentId: c.id,
        componentCode: c.code,
        componentName: c.name,
        status: "ok",
        officialStatus: "ok",
        officialReferenceDate: "2026-09-20",
        officialSourceType: "field_inspection",
        appliedAt: "2026-09-20T13:00:00Z",
      }),
    ),
  }),
];

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const normalize = (value: string) => value.toUpperCase().replace(/[^A-Z0-9]/g, "");

const PHOTO_URL =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="96" height="72"><rect width="96" height="72" fill="gray"/><rect x="24" y="18" width="48" height="36" fill="white"/></svg>',
  );

let sequence = 0;

/** Os carregadores devolvem o que o servidor devolveria, sem sessão nem banco. */
export const LOADERS: MtsrAppLoaders = {
  loadVehicles: async (search) => {
    await wait(80);
    const q = normalize(search ?? "");
    return { ok: true, data: q ? VEHICLES.filter((v) => normalize(v.licensePlate).includes(q) || normalize(v.fleetCode ?? "").includes(q)) : VEHICLES };
  },
  createEvidenceUpload: async ({ clientSubmissionId, componentId, mimeType, sizeBytes }) => {
    await wait(40);
    if (!CONTEXT.evidence.mimeTypes.includes(mimeType)) return { ok: false, error: "Formato de foto não aceito (use JPEG, PNG ou WebP)." };
    if (sizeBytes > CONTEXT.evidence.maxBytes) return { ok: false, error: "A foto deve ter até 10 MB." };
    sequence += 1;
    const path = `org-preview/inspections/drafts/user-preview/${clientSubmissionId}/${componentId}/${sequence}.jpg`;
    return { ok: true, data: { path, token: `token-${sequence}`, signedUrl: `https://preview.invalid/upload/${sequence}`, bucket: CONTEXT.evidence.bucket } };
  },
  upload: async () => {
    await wait(120);
    return { ok: true };
  },
  submit: async (input) => {
    await wait(150);
    return {
      ok: true,
      data: {
        id: "insp-preview",
        protocol: "MTSR-2026-000123",
        submittedAt: new Date().toISOString(),
        itemCount: input.items.length,
        nokCount: input.items.filter((i) => i.status === "nok").length,
        evidenceCount: input.items.reduce((sum, i) => sum + i.evidence.length, 0),
        duplicate: false,
      },
    };
  },
  loadOwnInspection: async (id) => {
    await wait(60);
    const found = HISTORY.find((h) => h.id === id);
    return found ? { ok: true, data: found } : { ok: false, error: "Vistoria não encontrada na prévia." };
  },
  loadOwnEvidenceUrls: async (id) => {
    await wait(40);
    const found = HISTORY.find((h) => h.id === id);
    if (!found) return { ok: false, error: "Vistoria não encontrada na prévia." };
    const urls: Record<string, string> = {};
    for (const it of found.items) for (const e of it.evidence) if (!e.purgedAt) urls[e.storagePath] = PHOTO_URL;
    return { ok: true, data: urls };
  },
};

export function PreviewMtsrApp({ canExecute = true }: { canExecute?: boolean }) {
  return <MtsrApp context={canExecute ? CONTEXT : null} history={canExecute ? HISTORY : []} canExecute={canExecute} loaders={LOADERS} preview />;
}
