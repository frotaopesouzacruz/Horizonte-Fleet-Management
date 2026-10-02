import "server-only";

import type { KmLoadContext } from "./context";

/** Esqueleto — substituído pela implementação da aba. */
export type KmRotationData = Record<string, unknown>;

export async function loadRotation(ctx: KmLoadContext): Promise<KmRotationData> {
  void ctx;
  return {};
}
