"use client";

import { EmptyState } from "@/components/feedback/empty-state";

import type { KmPanelContext } from "../shared";

/** Esqueleto — substituído pela implementação da aba. */
export function ReportsPanel({ data, ctx }: { data: null | null; ctx: KmPanelContext }) {
  void data;
  return <EmptyState title="Em construção" description={ctx.error ?? "Esta aba será exibida aqui."} />;
}
