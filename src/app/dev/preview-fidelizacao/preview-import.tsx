"use client";

import * as React from "react";
import { Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ImportDrawer, type ImportLoaders } from "@/app/(app)/governanca/fidelizacao/import-drawer";
import type { AllocationImportPreview, BrImportPreview, ImportLayout } from "@/lib/governance/import-actions";

/**
 * A gaveta de importação com uma prévia fixa em memória — o formato exato que
 * `stage_fidelization_import` e `stage_br_import` devolvem, com as sete
 * categorias da §58 preenchidas de propósito com valores distintos, para que
 * cada tile possa ser conferido por número.
 */
const ALLOCATIONS: AllocationImportPreview = {
  kind: "allocations",
  batchId: "batch-fixture-1",
  fileName: "alocacoes-outubro.xlsx",
  sheetName: "Planilha1",
  totalRows: 8,
  validRows: 2,
  warningRows: 2,
  errorRows: 4,
  createRows: 2,
  substituteRows: 1,
  skipRows: 1,
  alreadyImported: false,
  categories: {
    existing: 1,
    new: 2,
    substitutions: 1,
    overlaps: 1,
    unknownBrs: 1,
    vehiclesNotFound: 1,
    competenceErrors: 1,
  },
  mappedColumns: [
    { header: "BR", field: "br_code", label: "Código BR" },
    { header: "Frota", field: "fleet_code", label: "Frota" },
    { header: "Início", field: "start_date", label: "Data inicial" },
    { header: "Fim", field: "end_date", label: "Data final" },
  ],
  unmappedColumns: ["Comentário"],
  findings: [
    { rowNumber: 2, level: "warning", field: null, code: "existing", message: "Vínculo já existente no HFM; nada a fazer." },
    { rowNumber: 3, level: "warning", field: null, code: "substitution", message: "Substituirá VA125 a partir de 25/09/2026; o vínculo atual será encerrado em 24/09/2026 e o novo vínculo herda o fim em 30/09/2026." },
    { rowNumber: 6, level: "error", field: null, code: "overlap", message: "Sobreposição dentro do arquivo com a linha 5." },
    { rowNumber: 7, level: "error", field: "br_code", code: "unknown_br", message: "BR não encontrada: BRNAOEXISTE." },
    { rowNumber: 8, level: "error", field: "vehicle", code: "vehicle_not_found", message: "Veículo não encontrado: FROTA-999. A importação não cria veículos." },
    { rowNumber: 9, level: "error", field: "end_date", code: "competence", message: "A data final (05/11/2026) é anterior à inicial (10/11/2026)." },
  ],
  sample: [
    { rowNumber: 2, status: "warning", action: "skip", brCode: "BR0024054", operation: "Last Mille MG", city: "Contagem", fleetCode: "VA125", licensePlate: "SNT8E16", startDate: "2026-01-01", endDate: "2026-09-30", vehicleRole: "primary", statusValue: "executed", previousVehicle: null },
    { rowNumber: 3, status: "warning", action: "substitute", brCode: "BR0024054", operation: "Last Mille MG", city: "Contagem", fleetCode: "VA155", licensePlate: "SNU2B21", startDate: "2026-09-25", endDate: "2026-09-30", vehicleRole: "primary", statusValue: "planned", previousVehicle: "VA125" },
    { rowNumber: 4, status: "valid", action: "create", brCode: "BR0024052", operation: "Last Mille MG", city: "Contagem", fleetCode: "VA155", licensePlate: "SNU2B21", startDate: "2026-10-01", endDate: "2026-10-31", vehicleRole: "primary", statusValue: "planned", previousVehicle: null },
    { rowNumber: 5, status: "valid", action: "create", brCode: "BR0024054", operation: "Last Mille MG", city: "Contagem", fleetCode: "VA125", licensePlate: "SNT8E16", startDate: "2026-10-01", endDate: "2026-10-31", vehicleRole: "primary", statusValue: "planned", previousVehicle: null },
    { rowNumber: 6, status: "error", action: "skip", brCode: "BR0024054", operation: "Last Mille MG", city: "Contagem", fleetCode: "VA155", licensePlate: "SNU2B21", startDate: "2026-10-15", endDate: "2026-10-20", vehicleRole: "primary", statusValue: "planned", previousVehicle: null },
    { rowNumber: 7, status: "error", action: "skip", brCode: "BRNAOEXISTE", operation: null, city: null, fleetCode: "VA155", licensePlate: "SNU2B21", startDate: "2026-11-01", endDate: null, vehicleRole: "primary", statusValue: "planned", previousVehicle: null },
    { rowNumber: 8, status: "error", action: "skip", brCode: "BR0024054", operation: "Last Mille MG", city: "Contagem", fleetCode: "FROTA-999", licensePlate: null, startDate: "2026-11-01", endDate: null, vehicleRole: "primary", statusValue: "planned", previousVehicle: null },
    { rowNumber: 9, status: "error", action: "skip", brCode: "BR0024054", operation: "Last Mille MG", city: "Contagem", fleetCode: "VA155", licensePlate: "SNU2B21", startDate: "2026-11-10", endDate: "2026-11-05", vehicleRole: "primary", statusValue: "planned", previousVehicle: null },
  ],
};

const BRS: BrImportPreview = {
  kind: "brs",
  batchId: "batch-fixture-2",
  fileName: "brs-belem.xlsx",
  sheetName: "BRs",
  totalRows: 4,
  validRows: 1,
  warningRows: 2,
  errorRows: 1,
  createRows: 1,
  updateRows: 1,
  skipRows: 1,
  alreadyImported: true,
  mappedColumns: [
    { header: "Operação", field: "operation", label: "Operação" },
    { header: "Cidade", field: "city", label: "Cidade" },
    { header: "BR", field: "code", label: "Código BR" },
    { header: "Descrição", field: "description", label: "Descrição" },
  ],
  unmappedColumns: [],
  findings: [
    { rowNumber: 2, level: "warning", field: null, code: "existing", message: "BR já cadastrada; nada a alterar." },
    { rowNumber: 3, level: "warning", field: null, code: "existing", message: "BR já cadastrada; a descrição e as observações serão atualizadas." },
    { rowNumber: 5, level: "error", field: "city", code: "city", message: "A cidade Ananindeua não faz parte da cobertura da operação Redespacho - Belém/Pa." },
  ],
  sample: [
    { rowNumber: 2, status: "warning", action: "skip", operation: "Redespacho - Belém/Pa", city: "Belém", stateUf: "PA", code: "BR0031001", description: "Rota Marambaia", statusValue: "active", currentStatus: "active" },
    { rowNumber: 3, status: "warning", action: "update", operation: "Redespacho - Belém/Pa", city: "Belém", stateUf: "PA", code: "BR0031002", description: "Rota Icoaraci (atualizada)", statusValue: "active", currentStatus: "active" },
    { rowNumber: 4, status: "valid", action: "create", operation: "Redespacho - Belém/Pa", city: "Belém", stateUf: "PA", code: "BR0031009", description: "Rota nova", statusValue: "active", currentStatus: null },
    { rowNumber: 5, status: "error", action: "skip", operation: "Redespacho - Belém/Pa", city: null, stateUf: null, code: "BR0031010", description: null, statusValue: "active", currentStatus: null },
  ],
};

const loaders: ImportLoaders = {
  upload: async (kind) => ({ ok: true, data: kind === "brs" ? BRS : ALLOCATIONS }),
  confirm: async (kind) => ({
    ok: true,
    data: kind === "brs"
      ? { created: 1, updated: 1, substituted: 0, skipped: 2 }
      : { created: 2, updated: 0, substituted: 1, skipped: 5 },
  }),
};

/**
 * Etapa 15: a mesma gaveta com o passo de mapeamento. O arquivo "lido" tem
 * cabeçalhos que nenhum alias reconhece (Rota, Carro, Entrada) e um que
 * reconhece (Obs → Motivo), e há um layout salvo que liga os três. Os
 * layouts vivem em memória, como a lista do banco viveria para a sessão.
 */
function useMappingLoaders(): ImportLoaders {
  const layoutsRef = React.useRef<ImportLayout[]>([
    {
      id: "layout-1",
      name: "Planilha do cliente",
      mapping: { rota: "br_code", carro: "license_plate", entrada: "start_date", obs: "" },
      updatedAt: "2026-09-20T12:00:00Z",
    },
  ]);
  return React.useMemo<ImportLoaders>(
    () => ({
      upload: async (kind, formData) => {
        const mapping = formData.get("mapping");
        if (typeof mapping !== "string" || !mapping) {
          return { ok: false, error: "A prévia esperava o mapeamento das colunas." };
        }
        return { ok: true, data: kind === "brs" ? BRS : ALLOCATIONS };
      },
      confirm: loaders.confirm,
      inspect: async () => ({
        ok: true,
        data: {
          headers: ["Rota", "Carro", "Entrada", "Obs"],
          suggestion: { Rota: "", Carro: "", Entrada: "", Obs: "reason" },
          rowCount: 8,
        },
      }),
      listLayouts: async () => ({ ok: true, data: [...layoutsRef.current] }),
      saveLayout: async (_kind, name, mapping) => {
        const normalized = Object.fromEntries(
          Object.entries(mapping).map(([k, v]) => [k.toLowerCase().trim(), v]),
        );
        const existing = layoutsRef.current.find((l) => l.name.toLowerCase() === name.toLowerCase());
        if (existing) {
          existing.mapping = normalized;
          return { ok: true, data: { id: existing.id } };
        }
        const id = `layout-${layoutsRef.current.length + 1}`;
        layoutsRef.current = [
          ...layoutsRef.current,
          { id, name, mapping: normalized, updatedAt: "2026-09-23T12:00:00Z" },
        ].sort((a, b) => a.name.localeCompare(b.name));
        return { ok: true, data: { id } };
      },
      deleteLayout: async (layoutId) => {
        layoutsRef.current = layoutsRef.current.filter((l) => l.id !== layoutId);
        return { ok: true };
      },
    }),
    [],
  );
}

export function PreviewImport({ withMapping = false }: { withMapping?: boolean }) {
  const [open, setOpen] = React.useState(false);
  const mappingLoaders = useMappingLoaders();
  return (
    <>
      <Button variant="secondary" leadingIcon={<Upload />} onClick={() => setOpen(true)}>
        {withMapping ? "Importar com mapeamento (prévia)" : "Importar (prévia)"}
      </Button>
      <ImportDrawer
        open={open}
        onOpenChange={setOpen}
        canImportBrs
        loaders={withMapping ? mappingLoaders : loaders}
        exportPath="#modelo"
      />
    </>
  );
}
