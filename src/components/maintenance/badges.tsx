"use client";

import * as React from "react";
import { StatusBadge } from "@/components/ui/status-badge";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  CONFORMITY_LABEL,
  CRITICALITY_LABEL,
  CRITICALITY_TONE,
  KM_STATUS_HINT,
  KM_STATUS_LABEL,
  KM_STATUS_TONE,
  PLAN_STATUS_LABEL,
  PLAN_STATUS_TONE,
  PREDICTIVE_STATUS_LABEL,
  PREDICTIVE_STATUS_TONE,
  PREVENTIVE_STATUS_LABEL,
  PREVENTIVE_STATUS_TONE,
  STATUS_LABEL,
  STATUS_TONE,
  typeLabel,
  VERIFICATION_RESULT_LABEL,
  VERIFICATION_RESULT_TONE,
  type Conformity,
  type Criticality,
  type KmStatus,
  type MaintenanceStatus,
  type PlanStatus,
  type PredictiveStatus,
  type PreventiveStatus,
  type VerificationResult,
} from "@/lib/maintenance/types";

/**
 * Selos da Manutenção. Sempre com texto: a cor nunca é a única informação.
 * Um vocabulário, um lugar — a tela da Manutenção e a aba do veículo no
 * Cadastro de Frotas mostram o mesmo selo para o mesmo código.
 */

type Size = "sm" | "md";

export function MaintenanceStatusBadge({ status, size = "sm" }: { status: MaintenanceStatus; size?: Size }) {
  return (
    <StatusBadge status={STATUS_TONE[status] ?? "neutral"} size={size}>
      {STATUS_LABEL[status] ?? status}
    </StatusBadge>
  );
}

const TYPE_TONE: Record<string, "accent" | "info" | "warning" | "neutral"> = {
  preventive: "info",
  corrective: "warning",
  predictive: "accent",
};

export function MaintenanceTypeBadge({ type, name, size = "sm" }: { type: string; name?: string | null; size?: Size }) {
  return (
    <Badge variant={TYPE_TONE[type] ?? "neutral"} appearance="outline" size={size}>
      {typeLabel(type, name)}
    </Badge>
  );
}

export function CriticalityBadge({ value, size = "sm" }: { value: Criticality; size?: Size }) {
  return (
    <StatusBadge status={CRITICALITY_TONE[value] ?? "neutral"} size={size}>
      {CRITICALITY_LABEL[value] ?? value}
    </StatusBadge>
  );
}

/** Situação do KM de entrada, com a regra que a produziu no tooltip. */
export function KmStatusBadge({ status, size = "sm" }: { status: KmStatus | null; size?: Size }) {
  if (!status) return <span className="text-fg-muted">—</span>;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span tabIndex={0} className="inline-flex rounded-sm hfm-focus-ring">
          <StatusBadge status={KM_STATUS_TONE[status] ?? "neutral"} size={size}>
            {KM_STATUS_LABEL[status] ?? status}
          </StatusBadge>
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-72">{KM_STATUS_HINT[status]}</TooltipContent>
    </Tooltip>
  );
}

export function PreventiveStatusBadge({ status, size = "sm" }: { status: PreventiveStatus; size?: Size }) {
  return (
    <StatusBadge status={PREVENTIVE_STATUS_TONE[status] ?? "neutral"} size={size}>
      {PREVENTIVE_STATUS_LABEL[status] ?? status}
    </StatusBadge>
  );
}

export function PredictiveStatusBadge({ status, size = "sm" }: { status: PredictiveStatus; size?: Size }) {
  return (
    <StatusBadge status={PREDICTIVE_STATUS_TONE[status] ?? "neutral"} size={size}>
      {PREDICTIVE_STATUS_LABEL[status] ?? status}
    </StatusBadge>
  );
}

export function VerificationResultBadge({ result, size = "sm" }: { result: VerificationResult; size?: Size }) {
  return (
    <StatusBadge status={VERIFICATION_RESULT_TONE[result] ?? "neutral"} size={size}>
      {VERIFICATION_RESULT_LABEL[result] ?? result}
    </StatusBadge>
  );
}

export function ConformityText({ value }: { value: Conformity }) {
  return <span>{CONFORMITY_LABEL[value] ?? value}</span>;
}

export function PlanStatusBadge({ status, size = "sm" }: { status: PlanStatus; size?: Size }) {
  return (
    <StatusBadge status={PLAN_STATUS_TONE[status] ?? "neutral"} size={size}>
      {PLAN_STATUS_LABEL[status] ?? status}
    </StatusBadge>
  );
}
