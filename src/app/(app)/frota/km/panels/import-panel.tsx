"use client";

import { EmptyState } from "@/components/feedback/empty-state";
import type { KmBatchesData } from "@/lib/km/batches";
import type { KmPanelContext } from "../shared";

/** Esqueleto — substituído pela implementação da aba. */
export function ImportPanel({ data, ctx }: { data: KmBatchesData | null; ctx: KmPanelContext }) {
  void data;
  return <EmptyState title="Em construção" description={ctx.error ?? "Esta aba será exibida aqui."} />;
}
