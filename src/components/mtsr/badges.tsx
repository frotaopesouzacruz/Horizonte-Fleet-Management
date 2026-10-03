import * as React from "react";
import { StatusBadge, type StatusBadgeProps } from "@/components/ui/status-badge";
import {
  COMPONENT_STATUS_LABEL,
  COMPONENT_STATUS_TONE,
  CONFORMITY_LABEL,
  CONFORMITY_TONE,
  CRITICALITY_LABEL,
  CRITICALITY_TONE,
  DEADLINE_LABEL,
  DEADLINE_TONE,
  INGESTION_OUTCOME_LABEL,
  INGESTION_OUTCOME_TONE,
  INSPECTION_STATUS_LABEL,
  INSPECTION_STATUS_TONE,
  REVALIDATION_LABEL,
  REVALIDATION_TONE,
  VERIFICATION_MODE_LABEL,
  type ComponentStatus,
  type ConformityStatus,
  type Criticality,
  type DeadlineStatus,
  type IngestionOutcome,
  type InspectionStatus,
  type RevalidationStatus,
  type VerificationMode,
} from "@/lib/mtsr/types";

/**
 * Selos do MTSR — um lugar só para rótulo e tom de cada status oficial. O
 * texto sempre acompanha a cor (nunca cor sozinha).
 */
type Rest = Omit<StatusBadgeProps, "status" | "children">;

export function DeadlineBadge({ value, ...rest }: { value: string | null | undefined } & Rest) {
  const v = (value ?? "pendente") as DeadlineStatus;
  return <StatusBadge status={DEADLINE_TONE[v] ?? "neutral"} {...rest}>{DEADLINE_LABEL[v] ?? value}</StatusBadge>;
}

export function ConformityBadge({ value, ...rest }: { value: string | null | undefined } & Rest) {
  const v = (value ?? "sem_informacao") as ConformityStatus;
  return <StatusBadge status={CONFORMITY_TONE[v] ?? "neutral"} {...rest}>{CONFORMITY_LABEL[v] ?? value}</StatusBadge>;
}

export function CriticalityBadge({ value, ...rest }: { value: string | null | undefined } & Rest) {
  const v = (value ?? "sem_criticidade") as Criticality;
  return <StatusBadge status={CRITICALITY_TONE[v] ?? "neutral"} {...rest}>{CRITICALITY_LABEL[v] ?? value}</StatusBadge>;
}

export function ComponentStatusBadge({ value, awaiting, ...rest }: { value: string | null | undefined; awaiting?: boolean } & Rest) {
  const v = (value ?? "sem_informacao") as ComponentStatus;
  return (
    <StatusBadge status={awaiting ? "warning" : (COMPONENT_STATUS_TONE[v] ?? "neutral")} {...rest}>
      {COMPONENT_STATUS_LABEL[v] ?? value}
      {awaiting ? " · aguardando revalidação" : ""}
    </StatusBadge>
  );
}

export function InspectionStatusBadge({ value, ...rest }: { value: string | null | undefined } & Rest) {
  const v = (value ?? "pendente_validacao") as InspectionStatus;
  return <StatusBadge status={INSPECTION_STATUS_TONE[v] ?? "neutral"} {...rest}>{INSPECTION_STATUS_LABEL[v] ?? value}</StatusBadge>;
}

export function RevalidationBadge({ value, ...rest }: { value: string | null | undefined } & Rest) {
  const v = (value ?? "pending") as RevalidationStatus;
  return <StatusBadge status={REVALIDATION_TONE[v] ?? "neutral"} {...rest}>{REVALIDATION_LABEL[v] ?? value}</StatusBadge>;
}

export function IngestionOutcomeBadge({ value, ...rest }: { value: string | null | undefined } & Rest) {
  const v = (value ?? "received") as IngestionOutcome;
  return <StatusBadge status={INGESTION_OUTCOME_TONE[v] ?? "neutral"} {...rest}>{INGESTION_OUTCOME_LABEL[v] ?? value}</StatusBadge>;
}

export function VerificationModeBadge({ value, ...rest }: { value: string | null | undefined } & Rest) {
  const v = (value ?? "field") as VerificationMode;
  return <StatusBadge status={v === "field" ? "info" : "progress"} {...rest}>{VERIFICATION_MODE_LABEL[v] ?? value}</StatusBadge>;
}
