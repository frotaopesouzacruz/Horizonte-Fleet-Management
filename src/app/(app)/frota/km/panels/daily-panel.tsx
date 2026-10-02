"use client";

import { EmptyState } from "@/components/feedback/empty-state";
import type { KmDailyData } from "@/lib/km/daily";
import type { KmPanelContext } from "../shared";

/** Esqueleto — substituído pela implementação da aba. */
export function DailyPanel({ data, ctx }: { data: KmDailyData | null; ctx: KmPanelContext }) {
  void data;
  return <EmptyState title="Em construção" description={ctx.error ?? "Esta aba será exibida aqui."} />;
}
