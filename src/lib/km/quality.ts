import "server-only";

import type { KmLoadContext } from "./context";

/** Esqueleto — substituído pela implementação da aba. */
export type KmQualityData = Record<string, unknown>;

export async function loadQuality(ctx: KmLoadContext): Promise<KmQualityData> {
  void ctx;
  return {};
}
