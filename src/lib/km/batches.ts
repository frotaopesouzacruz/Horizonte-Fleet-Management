import "server-only";

import type { KmLoadContext } from "./context";

/** Esqueleto — substituído pela implementação da aba. */
export type KmBatchesData = Record<string, unknown>;

export async function loadBatches(ctx: KmLoadContext): Promise<KmBatchesData> {
  void ctx;
  return {};
}
