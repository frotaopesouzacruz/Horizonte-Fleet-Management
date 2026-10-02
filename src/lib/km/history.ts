import "server-only";

import type { KmLoadContext } from "./context";

/** Esqueleto — substituído pela implementação da aba. */
export type KmHistoryData = Record<string, unknown>;

export async function loadHistory(ctx: KmLoadContext): Promise<KmHistoryData> {
  void ctx;
  return {};
}
