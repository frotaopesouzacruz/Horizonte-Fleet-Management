"use client";

import { EmptyState } from "@/components/feedback/empty-state";
import type { KmOverviewData } from "@/lib/km/overview";
import type { KmPanelContext } from "../shared";

/** Esqueleto — substituído pela implementação da aba. */
export function OverviewPanel({ data, ctx }: { data: KmOverviewData | null; ctx: KmPanelContext }) {
  void data;
  return <EmptyState title="Em construção" description={ctx.error ?? "Esta aba será exibida aqui."} />;
}
