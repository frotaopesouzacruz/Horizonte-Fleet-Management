"use client";

import * as React from "react";
import { Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ImportDrawer, type ImportLoaders } from "@/app/(app)/governanca/fidelizacao/import-drawer";
import type { AllocationImportPreview, ImportOutcome, ImportPreview } from "@/lib/governance/import-actions";
import { fileFromForm, runChunkedProcess, runStagedImport } from "@/lib/import/client";

interface BatchLog {
  loads: { first: number; last: number; rows: number; headers: string[] }[];
  validates: number[];
  processes: number[];
  sheetName: string | null;
}

declare global {
  interface Window {
    __importBatches?: BatchLog;
  }
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * O servidor simulado: guarda as linhas recebidas, "valida" e "grava" as
 * próximas `limit` a cada chamada, com uma pequena espera para o progresso
 * aparecer. A prévia conta as linhas que realmente chegaram.
 */
function createSimulatedServer(): ImportLoaders {
  let received = 0;
  let pending = 0;
  let toWrite = 0;
  const log = (): BatchLog =>
    (window.__importBatches ??= { loads: [], validates: [], processes: [], sheetName: null });

  return {
    upload: (_kind, formData, onProgress) => {
      window.__importBatches = { loads: [], validates: [], processes: [], sheetName: null };
      received = 0;
      return runStagedImport<ImportPreview>(
        fileFromForm(formData),
        {
          load: async (input) => {
            await wait(5);
            log().loads.push({
              first: input.firstRowNumber,
              last: input.firstRowNumber + input.rows.length - 1,
              rows: input.rows.length,
              headers: input.headers,
            });
            log().sheetName = input.sheetName;
            received += input.rows.length;
            pending = received;
            return { ok: true, data: { batchId: "lote-simulado" } };
          },
          validate: async (_batchId, limit) => {
            await wait(60);
            log().validates.push(limit);
            pending = Math.max(0, pending - limit);
            return { ok: true, data: { pending } };
          },
          finalize: async (batchId, sheet) => {
            toWrite = received;
            const preview: AllocationImportPreview = {
              kind: "allocations",
              batchId,
              fileName: sheet.fileName,
              sheetName: sheet.sheetName,
              totalRows: received,
              validRows: received,
              warningRows: 0,
              errorRows: 0,
              createRows: received,
              substituteRows: 0,
              skipRows: 0,
              alreadyImported: false,
              categories: {
                existing: 0, new: received, substitutions: 0, overlaps: 0, unknownBrs: 0,
                vehiclesNotFound: 0, competenceErrors: 0,
              },
              mappedColumns: sheet.headers.map((header) => ({ header, field: header, label: header })),
              unmappedColumns: [],
              findings: [],
              sample: [],
            };
            return { ok: true, data: preview };
          },
        },
        onProgress,
      );
    },
    confirm: (_kind, _batchId, onProgress, expectedRows) =>
      runChunkedProcess<ImportOutcome>(async (limit) => {
        await wait(60);
        log().processes.push(limit);
        toWrite = Math.max(0, toWrite - limit);
        return toWrite > 0
          ? { ok: true, data: { done: false, remaining: toWrite } }
          : { ok: true, data: { done: true, remaining: 0, outcome: { created: received, updated: 0, substituted: 0, skipped: 0 } } };
      }, onProgress, expectedRows),
  };
}

export function PreviewBatches() {
  const [open, setOpen] = React.useState(false);
  const [loaders] = React.useState(createSimulatedServer);
  return (
    <>
      <Button leadingIcon={<Upload />} onClick={() => setOpen(true)}>
        Importar fidelização
      </Button>
      <ImportDrawer open={open} onOpenChange={setOpen} canImportBrs={false} loaders={loaders} exportPath="#" />
    </>
  );
}
