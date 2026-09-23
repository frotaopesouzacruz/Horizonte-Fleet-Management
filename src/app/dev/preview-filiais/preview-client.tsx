"use client";

import * as React from "react";
import { BranchesView } from "@/app/(app)/estrutura/filiais/branches-view";
import type { BranchImportLoaders } from "@/app/(app)/estrutura/filiais/branch-import-drawer";
import type { BranchCostCenterLoaders } from "@/app/(app)/estrutura/filiais/branch-cost-centers-tab";
import type { BranchCostCenterRow } from "@/lib/branches/actions";
import {
  BRANCHES, COST_CENTERS, IMPORT_OUTCOME, IMPORT_PREVIEW, LINKS, LOCATIONS, OPERATIONS, STATES, SUMMARY,
} from "./fixture";

/**
 * A tela de Filiais com loaders em memória: a importação devolve a prévia
 * fixa quando recebe um arquivo, e os centros de custo vivem num array que a
 * associação altera — como a lista do banco viveria para a sessão.
 */

export interface PreviewFiliaisProps {
  /** `leitura`: só branches.view — sem importar, exportar nem seleção. */
  profile: "admin" | "leitura";
  /** `vazio`: a organização ainda não tem centros de custo. */
  costCenters: "fixture" | "vazio";
}

export function PreviewFiliais({ profile, costCenters }: PreviewFiliaisProps) {
  const store = React.useRef<BranchCostCenterRow[]>(costCenters === "vazio" ? [] : COST_CENTERS.map((c) => ({ ...c })));

  const importLoaders = React.useMemo<BranchImportLoaders>(
    () => ({
      upload: async (formData) => {
        const file = formData.get("file");
        if (!(file instanceof File) || file.size === 0) return { ok: false, error: "Selecione um arquivo." };
        if (!/\.(xlsx|csv)$/i.test(file.name)) return { ok: false, error: "Formato não suportado. Utilize XLSX ou CSV." };
        return { ok: true, data: { ...IMPORT_PREVIEW, fileName: file.name } };
      },
      confirm: async () => ({ ok: true, data: IMPORT_OUTCOME }),
    }),
    [],
  );

  const costCenterLoaders = React.useMemo<BranchCostCenterLoaders>(
    () => ({
      list: async () => ({ ok: true, data: store.current.map((c) => ({ ...c })) }),
      set: async (branchId, costCenterId, linked) => {
        const target = store.current.find((c) => c.id === costCenterId);
        if (!target) return { ok: false, error: "Centro de custo não encontrado nesta organização." };
        if (linked && target.organizationUnitId && target.organizationUnitId !== branchId) {
          return { ok: false, error: `O centro de custo ${target.name} já está associado à filial ${target.branchName}.` };
        }
        const branch = BRANCHES.find((b) => b.id === branchId);
        target.organizationUnitId = linked ? branchId : null;
        target.branchCode = linked ? branch?.code ?? null : null;
        target.branchName = linked ? branch?.name ?? null : null;
        return { ok: true };
      },
    }),
    [],
  );

  const admin = profile === "admin";

  return (
    <BranchesView
      rows={BRANCHES}
      links={LINKS}
      summary={SUMMARY}
      filters={{}}
      operations={OPERATIONS}
      locations={LOCATIONS}
      states={STATES}
      canCreate={admin}
      canUpdate
      canDeactivate={admin}
      canManageOperations={admin}
      canViewEmployees={false}
      canViewVehicles={false}
      canViewAudit={false}
      canImport={admin}
      canExport={admin}
      canViewCostCenters
      canManageCostCenters={admin}
      importLoaders={importLoaders}
      costCenterLoaders={costCenterLoaders}
      exportPath="/dev/preview-filiais/export"
      basePath="/dev/preview-filiais"
    />
  );
}
