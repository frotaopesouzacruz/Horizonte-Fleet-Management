"use client";

import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useToast } from "@/components/feedback/toast";
import { StabilityDashboard } from "@/app/(app)/governanca/fidelizacao/stability-dashboard";
import { DriversPlanner } from "@/app/(app)/governanca/fidelizacao/drivers-planner";
import { MovementsPanel } from "@/app/(app)/governanca/fidelizacao/movements-panel";
import { ImportPanel } from "@/app/(app)/governanca/fidelizacao/import-panel";
import { ImportDrawer, type ImportLoaders } from "@/app/(app)/governanca/fidelizacao/import-drawer";
import { DriverSubstituteDialog } from "@/app/(app)/governanca/fidelizacao/driver-substitute-dialog";
import type { DriverPlanRow } from "@/lib/governance/queries";
import {
  COMPETENCE, COMPETENCE_LABEL, DRIVER_PLANS, IMPORT_HISTORY, MATRIX, STABILITY, movementsPageFor,
} from "../fixture-central";

/** A prévia não envia arquivo: a gaveta abre e diz isso ao validar. */
const PREVIEW_LOADERS: ImportLoaders = {
  upload: async () => ({ ok: false, error: "Prévia de desenvolvimento: o arquivo não é enviado." }),
  confirm: async () => ({ ok: false, error: "Prévia de desenvolvimento: nada é gravado." }),
};

/**
 * Os filtros do histórico ficam na URL (`mov_*`), como na tela real; aqui o
 * recorte é feito sobre os dados fixos, com a mesma regra do banco.
 */
export function PreviewAreas() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const { toast } = useToast();
  const [pending, startTransition] = React.useTransition();
  const [substituteRow, setSubstituteRow] = React.useState<DriverPlanRow | null>(null);
  const [importOpen, setImportOpen] = React.useState(false);

  const get = (key: string) => params.get(key) || undefined;
  const filters = {
    dateFrom: get("mov_de"),
    dateTo: get("mov_ate"),
    movementType: get("mov_tipo"),
    subject: get("mov_assunto"),
    vehicle: get("mov_veiculo"),
    driver: get("mov_motorista"),
  };
  const page = Number(params.get("mov_pagina") ?? "1") || 1;
  const movements = movementsPageFor(filters, page, 50);

  const navigate = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params.toString());
    for (const [key, value] of Object.entries(patch)) {
      if (value === null || value === "") next.delete(key);
      else next.set(key, value);
    }
    const query = next.toString();
    startTransition(() => router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false }));
  };

  return (
    <>
      <PreviewArea id="area-visao-geral" title="Visão geral">
        <StabilityDashboard stability={STABILITY} competence={COMPETENCE} />
      </PreviewArea>

      <PreviewArea id="area-motoristas" title="Motoristas por BR">
        <DriversPlanner
          matrix={MATRIX}
          driverPlans={DRIVER_PLANS}
          competenceLabel={COMPETENCE_LABEL}
          canChangeDriver
          onOpenBr={(id) => {
            const code = MATRIX.rows.find((r) => r.operationBrId === id)?.brCode ?? id;
            toast({ title: `Na tela real, abre a gaveta da ${code} para vincular o motorista.` });
          }}
          onSubstitute={setSubstituteRow}
          endDriverAction={async () => ({ ok: true })}
        />
      </PreviewArea>

      <PreviewArea id="area-historico" title="Movimentações">
        <MovementsPanel
          movements={movements}
          filters={filters}
          competenceLabel={COMPETENCE_LABEL}
          onNavigate={navigate}
          pending={pending}
        />
      </PreviewArea>

      <PreviewArea id="area-importacao" title="Importações">
        <ImportPanel
          history={IMPORT_HISTORY}
          canImport
          brsModuleHref="/governanca/brs"
          onOpenImport={() => setImportOpen(true)}
        />
      </PreviewArea>

      <DriverSubstituteDialog
        key={`substitute-${substituteRow?.id ?? "none"}`}
        row={substituteRow}
        onClose={() => setSubstituteRow(null)}
      />
      <ImportDrawer
        open={importOpen}
        onOpenChange={setImportOpen}
        canImportBrs={false}
        loaders={PREVIEW_LOADERS}
        exportPath="#modelo"
      />
    </>
  );
}

function PreviewArea({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <h2 id={id} className="text-overline font-semibold uppercase text-fg-muted">
        {title}
      </h2>
      {children}
    </div>
  );
}
