import "server-only";

import type { KmLoadContext } from "./context";

/** Esqueleto — substituído pela implementação da aba. */
export type KmAnalysisData = Record<string, unknown>;

export async function loadAnalysis(ctx: KmLoadContext): Promise<KmAnalysisData> {
  void ctx;
  return {};
}
