"use client";

import { EmptyState } from "@/components/feedback/empty-state";
import type { KmPlannerData } from "@/lib/km/planner";
import type { KmPanelContext } from "../shared";

/** Esqueleto — substituído pela implementação da aba. */
export function PlannerPanel({ data, ctx }: { data: KmPlannerData | null; ctx: KmPanelContext }) {
  void data;
  return <EmptyState title="Em construção" description={ctx.error ?? "Esta aba será exibida aqui."} />;
}
