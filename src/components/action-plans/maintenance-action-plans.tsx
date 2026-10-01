"use client";

import * as React from "react";
import Link from "next/link";
import { ClipboardList } from "lucide-react";
import { PlanStatusBadge, PriorityBadge } from "@/components/action-plans/badges";
import { loadMaintenanceActionPlans, type MaintenancePlanRef } from "@/lib/action-plans/actions";
import { LINK_ORIGIN_LABEL, planTitle } from "@/lib/action-plans/labels";

/**
 * Na gaveta oficial da Manutenção: os Planos de Ação (Gestão de Checklist) que
 * esta manutenção trata. O vínculo é o mesmo do plano (N:N); aqui só se lê.
 */
export function MaintenanceActionPlans({ maintenanceId }: { maintenanceId: string }) {
  const [rows, setRows] = React.useState<MaintenancePlanRef[] | null>(null);

  React.useEffect(() => {
    let alive = true;
    loadMaintenanceActionPlans(maintenanceId).then((result) => {
      if (alive) setRows(result.ok ? result.data ?? [] : []);
    });
    return () => {
      alive = false;
    };
  }, [maintenanceId]);

  if (!rows || rows.length === 0) return null;

  return (
    <section className="flex flex-col gap-2" data-testid="maintenance-drawer-action-plans">
      <h3 className="flex items-center gap-2 text-label font-semibold text-fg">
        <ClipboardList aria-hidden className="size-4 text-fg-muted" />
        Planos de ação ({rows.length})
      </h3>
      <ul className="flex flex-col gap-2">
        {rows.map((p) => (
          <li key={p.planId} className="flex flex-col gap-1.5 rounded-md border border-border p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              {p.canView ? (
                <Link
                  href={`/checklist/planos-acao?aba=planos&plano=${p.planId}`}
                  className="text-body-sm font-medium text-primary underline-offset-2 hover:underline"
                >
                  {p.code}
                </Link>
              ) : (
                <span className="text-body-sm font-medium text-fg">{p.code}</span>
              )}
              <div className="flex flex-wrap items-center gap-1.5">
                <PriorityBadge priority={p.priority} />
                <PlanStatusBadge status={p.status} />
              </div>
            </div>
            <p className="text-body-sm text-fg">{planTitle(p)}</p>
            <p className="text-caption text-fg-muted">
              {LINK_ORIGIN_LABEL[p.origin] ?? p.origin}
              {p.resolutive ? "" : " · informativo"} · {p.occurrences} ocorrência(s), {p.openItems} pendente(s)
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}
