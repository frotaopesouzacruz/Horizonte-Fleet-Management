"use client";

import { EmptyState } from "@/components/feedback/empty-state";
import type { KmQualityData } from "@/lib/km/quality";
import type { KmPanelContext } from "../shared";

/** Esqueleto — substituído pela implementação da aba. */
export function QualityPanel({ data, ctx }: { data: KmQualityData | null; ctx: KmPanelContext }) {
  void data;
  return <EmptyState title="Em construção" description={ctx.error ?? "Esta aba será exibida aqui."} />;
}
