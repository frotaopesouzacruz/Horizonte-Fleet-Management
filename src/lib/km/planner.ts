import "server-only";

import type { KmLoadContext } from "./context";

/** Esqueleto — substituído pela implementação da aba. */
export type KmPlannerData = Record<string, unknown>;

export async function loadPlanner(ctx: KmLoadContext): Promise<KmPlannerData> {
  void ctx;
  return {};
}
