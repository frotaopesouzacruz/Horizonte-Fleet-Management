"use client";

import * as React from "react";
import Link from "next/link";
import { ShieldCheck } from "lucide-react";
import { ComponentStatusBadge, RevalidationBadge } from "@/components/mtsr/badges";
import { loadMtsrForMaintenance } from "@/lib/mtsr/actions";
import { MTSR_BASE_PATH, formatStamp, type MtsrForMaintenance } from "@/lib/mtsr/types";

/**
 * Na gaveta oficial da Manutenção: os componentes MTSR que esta manutenção
 * trata. O vínculo é o do MTSR (componente × manutenção); aqui só se lê.
 */

const LINK_TYPE_LABEL: Record<string, string> = {
  opened_from_nok: "Aberta pelo MTSR",
  linked_existing: "Vínculo a manutenção existente",
  import: "Importação",
};

export function MaintenanceMtsr({ maintenanceId, vehicleId }: { maintenanceId: string; vehicleId?: string | null }) {
  const [data, setData] = React.useState<MtsrForMaintenance | null>(null);

  React.useEffect(() => {
    let alive = true;
    void loadMtsrForMaintenance(maintenanceId).then((result) => {
      if (alive) setData(result.ok ? (result.data ?? null) : null);
    });
    return () => {
      alive = false;
    };
  }, [maintenanceId]);

  if (!data || data.links.length === 0) return null;

  const sheetHref = data.canViewMtsr && vehicleId ? `${MTSR_BASE_PATH}/veiculos/${vehicleId}` : null;

  return (
    <section className="flex flex-col gap-2" data-testid="maintenance-drawer-mtsr">
      <h3 className="flex items-center gap-2 text-label font-semibold text-fg">
        <ShieldCheck aria-hidden className="size-4 text-fg-muted" />
        Componentes MTSR ({data.links.length})
      </h3>
      <ul className="flex flex-col gap-2">
        {data.links.map((l) => (
          <li key={l.linkId} className="flex flex-col gap-1.5 rounded-md border border-border p-3" data-testid="maintenance-drawer-mtsr-link">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-body-sm font-medium text-fg">{l.componentName}</span>
              <div className="flex flex-wrap items-center gap-1.5">
                <ComponentStatusBadge value={l.officialStatus} awaiting={l.awaitingRevalidation} size="sm" />
                <RevalidationBadge value={l.revalidationStatus} size="sm" />
              </div>
            </div>
            <p className="text-caption text-fg-muted">
              {LINK_TYPE_LABEL[l.linkType] ?? l.linkType}
              {l.protocol ? ` · Vistoria ${l.protocol}` : ""} · Vinculada em {formatStamp(l.linkedAt)}
              {l.maintenanceConcludedAt ? ` · Manutenção concluída em ${formatStamp(l.maintenanceConcludedAt)}` : ""}
              {l.revalidatedAt ? ` · Revalidado em ${formatStamp(l.revalidatedAt)}` : ""}
            </p>
          </li>
        ))}
      </ul>
      <p className="text-caption text-fg-muted">
        Concluir esta manutenção deixa o componente Aguardando revalidação; a conformidade só muda com nova vistoria ou leitura.
      </p>
      {sheetHref ? (
        <Link href={sheetHref} className="w-fit text-body-sm font-medium text-primary underline-offset-2 hover:underline" data-testid="maintenance-drawer-mtsr-sheet">
          Abrir ficha MTSR do veículo
        </Link>
      ) : null}
    </section>
  );
}
