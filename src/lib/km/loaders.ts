import "server-only";

import type { KmLoadContext } from "./context";
import type { KmTab } from "./types";
import { loadOverview, type KmOverviewData } from "./overview";
import { loadDaily, type KmDailyData } from "./daily";
import { loadPlanner, type KmPlannerData } from "./planner";
import { loadAnalysis, type KmAnalysisData } from "./analysis";
import { loadQuality, type KmQualityData } from "./quality";
import { loadRotation, type KmRotationData } from "./rotation";
import { loadHistory, type KmHistoryData } from "./history";
import { loadBatches, type KmBatchesData } from "./batches";

export interface KmTabData {
  "visao-geral": KmOverviewData;
  analise: KmAnalysisData;
  planner: KmPlannerData;
  diaria: KmDailyData;
  historico: KmHistoryData;
  rodizio: KmRotationData;
  qualidade: KmQualityData;
  importacao: KmBatchesData;
  lotes: KmBatchesData;
  relatorios: null;
}

/**
 * Só a aba aberta é carregada. Uma falha vira mensagem no painel — a tela
 * (cabeçalho, filtros, abas) continua de pé.
 */
export async function loadKmTab<T extends KmTab>(
  tab: T,
  ctx: KmLoadContext,
): Promise<{ data: KmTabData[T] | null; error: string | null }> {
  try {
    const loaders: { [K in KmTab]: (c: KmLoadContext) => Promise<KmTabData[K]> } = {
      "visao-geral": loadOverview,
      analise: loadAnalysis,
      planner: loadPlanner,
      diaria: loadDaily,
      historico: loadHistory,
      rodizio: loadRotation,
      qualidade: loadQuality,
      importacao: loadBatches,
      lotes: loadBatches,
      relatorios: async () => null,
    };
    return { data: (await loaders[tab](ctx)) as KmTabData[T], error: null };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`km: ${tab}`, message);
    return { data: null, error: message };
  }
}
