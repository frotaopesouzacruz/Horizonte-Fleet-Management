import "server-only";

import type { KmLoadContext } from "./context";

/** Esqueleto — substituído pela implementação da aba. */
export type KmOverviewData = Record<string, unknown>;

export async function loadOverview(ctx: KmLoadContext): Promise<KmOverviewData> {
  void ctx;
  return {};
}
