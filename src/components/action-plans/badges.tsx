"use client";

import * as React from "react";
import { Repeat } from "lucide-react";
import { StatusBadge, type StatusTone } from "@/components/ui/status-badge";
import { Badge } from "@/components/ui/badge";
import {
  CONFIDENCE_LABEL,
  CONFIDENCE_TONE,
  DEADLINE_LABEL,
  DEADLINE_TONE,
  ITEM_STATUS_LABEL,
  ITEM_STATUS_TONE,
  PLAN_STATUS_LABEL,
  PLAN_STATUS_TONE,
  PRIORITY_LABEL,
  PRIORITY_TONE,
  type Tone,
} from "@/lib/action-plans/labels";
import type { Confidence, Deadline, ItemStatus, PlanStatus, Priority } from "@/lib/action-plans/types";

/**
 * Selos do Plano de Ação. Sempre com texto: a cor nunca é a única informação.
 * Verde = tratado/no prazo; âmbar = atenção; vermelho = vencido/crítico;
 * azul = informacional; violeta (progress) = em manutenção.
 */

type Size = "sm" | "md";

const TONE: Record<Tone, StatusTone> = {
  neutral: "neutral",
  info: "info",
  success: "success",
  warning: "warning",
  danger: "danger",
  accent: "progress",
};

export function PlanStatusBadge({ status, size = "sm" }: { status: PlanStatus; size?: Size }) {
  return (
    <StatusBadge status={TONE[PLAN_STATUS_TONE[status] ?? "neutral"]} size={size}>
      {PLAN_STATUS_LABEL[status] ?? status}
    </StatusBadge>
  );
}

export function ItemStatusBadge({ status, size = "sm" }: { status: ItemStatus; size?: Size }) {
  return (
    <StatusBadge status={TONE[ITEM_STATUS_TONE[status] ?? "neutral"]} size={size}>
      {ITEM_STATUS_LABEL[status] ?? status}
    </StatusBadge>
  );
}

export function PriorityBadge({ priority, size = "sm" }: { priority: Priority; size?: Size }) {
  return (
    <StatusBadge status={TONE[PRIORITY_TONE[priority] ?? "neutral"]} size={size}>
      {PRIORITY_LABEL[priority] ?? priority}
    </StatusBadge>
  );
}

export function DeadlineBadge({ deadline, size = "sm", days }: { deadline: Deadline; size?: Size; days?: number | null }) {
  const label = DEADLINE_LABEL[deadline] ?? deadline;
  return (
    <StatusBadge status={TONE[DEADLINE_TONE[deadline] ?? "neutral"]} size={size}>
      {deadline === "overdue" && days ? `${label} · ${days} d` : label}
    </StatusBadge>
  );
}

export function ConfidenceBadge({ confidence, size = "sm" }: { confidence: Confidence; size?: Size }) {
  return (
    <StatusBadge status={TONE[CONFIDENCE_TONE[confidence] ?? "neutral"]} size={size}>
      {CONFIDENCE_LABEL[confidence] ?? confidence}
    </StatusBadge>
  );
}

export function RecurrenceBadge({ size = "sm" }: { size?: Size }) {
  return (
    <Badge variant="warning" appearance="outline" size={size}>
      <Repeat aria-hidden className="size-3" />
      Possível reincidência
    </Badge>
  );
}
