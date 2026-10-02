import "server-only";

import type { KmLoadContext } from "./context";

/** Esqueleto — substituído pela implementação da aba. */
export type KmDailyData = Record<string, unknown>;

export async function loadDaily(ctx: KmLoadContext): Promise<KmDailyData> {
  void ctx;
  return {};
}
