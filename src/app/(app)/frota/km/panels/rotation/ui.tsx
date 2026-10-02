"use client";

import * as React from "react";
import { ArrowLeftRight, ShieldAlert } from "lucide-react";
import { cn } from "@/lib/cn";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/ui/status-badge";
import type { KmRotationVehicle } from "@/lib/km/rotation";
import { localOf, priorityLabel, priorityTone, statusLabel, statusTone } from "./format";

/** Situação do plano ou do rodízio (texto + cor; a cor nunca vem sozinha). */
export function RotationStatusBadge({ status, size = "md" }: { status: string; size?: "sm" | "md" }) {
  return (
    <StatusBadge status={statusTone(status)} size={size} data-testid="km-rodizio-status">
      {statusLabel(status)}
    </StatusBadge>
  );
}

export function PriorityBadge({ priority, revalidated }: { priority: string; revalidated?: boolean }) {
  if (priority === "none") {
    return (
      <StatusBadge status="neutral" withIcon data-testid="km-rodizio-priority">
        {revalidated ? "Sem benefício após revalidação" : "Sem benefício"}
      </StatusBadge>
    );
  }
  return (
    <StatusBadge status={priorityTone(priority)} data-testid="km-rodizio-priority">
      Prioridade {priorityLabel(priority).toLocaleLowerCase("pt-BR")}
    </StatusBadge>
  );
}

/** "Condicionado" com os motivos visíveis (preventiva/manutenção pendentes). */
export function ConditionedNote({ reasons, className }: { reasons: string[]; className?: string }) {
  return (
    <div className={cn("flex flex-wrap items-start gap-x-2 gap-y-1", className)} data-testid="km-rodizio-conditioned">
      <Badge variant="warning" size="sm" icon={<ShieldAlert aria-hidden />}>
        Condicionado
      </Badge>
      {reasons.length > 0 ? (
        <span className="min-w-0 text-caption text-fg-secondary">{reasons.join(" · ")}</span>
      ) : (
        <span className="text-caption text-fg-secondary">Há pendência de preventiva ou manutenção numa das frotas.</span>
      )}
    </div>
  );
}

/** "A / local A ⇄ B / local B". */
export function PairLine({
  a,
  b,
  className,
}: {
  a: KmRotationVehicle | null | undefined;
  b: KmRotationVehicle | null | undefined;
  className?: string;
}) {
  const side = (v: KmRotationVehicle | null | undefined) => (
    <span className="inline-flex min-w-0 flex-wrap items-baseline gap-x-1">
      <span className="font-semibold text-fg">{v?.plate ?? "—"}</span>
      {v?.fleetCode ? <span className="text-caption text-fg-muted">frota {v.fleetCode}</span> : null}
      <span className="text-fg-secondary">/ {localOf(v)}</span>
    </span>
  );
  return (
    <p className={cn("flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-body", className)}>
      {side(a)}
      <ArrowLeftRight className="size-4 shrink-0 text-accent" aria-hidden />
      <span className="sr-only">troca com</span>
      {side(b)}
    </p>
  );
}

export function Section({
  title,
  description,
  action,
  children,
  testId,
  className,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
  testId?: string;
  className?: string;
}) {
  const id = React.useId();
  return (
    <section
      aria-labelledby={id}
      className={cn("flex flex-col gap-3 rounded-md border border-border bg-surface p-3 sm:p-4", className)}
      data-testid={testId}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex min-w-0 flex-col gap-0.5">
          <h3 id={id} className="text-h4 font-semibold text-fg">
            {title}
          </h3>
          {description ? <p className="text-caption text-fg-muted">{description}</p> : null}
        </div>
        {action ? <div className="flex flex-wrap items-center gap-2">{action}</div> : null}
      </div>
      {children}
    </section>
  );
}

export function Fact({
  label,
  children,
  wide,
  testId,
}: {
  label: React.ReactNode;
  children: React.ReactNode;
  wide?: boolean;
  testId?: string;
}) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-0.5", wide && "sm:col-span-2 lg:col-span-3")} data-testid={testId}>
      <dt className="text-caption text-fg-muted">{label}</dt>
      <dd className="text-body-sm break-words text-fg tabular-nums">{children ?? "—"}</dd>
    </div>
  );
}

export function Facts({ children, className }: { children: React.ReactNode; className?: string }) {
  return <dl className={cn("grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3", className)}>{children}</dl>;
}
