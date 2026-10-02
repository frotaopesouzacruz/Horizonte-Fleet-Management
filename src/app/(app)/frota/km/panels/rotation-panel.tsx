"use client";

import { EmptyState } from "@/components/feedback/empty-state";
import type { KmRotationData } from "@/lib/km/rotation";
import type { KmPanelContext } from "../shared";

/** Esqueleto — substituído pela implementação da aba. */
export function RotationPanel({ data, ctx }: { data: KmRotationData | null; ctx: KmPanelContext }) {
  void data;
  return <EmptyState title="Em construção" description={ctx.error ?? "Esta aba será exibida aqui."} />;
}
