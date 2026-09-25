"use client";

import * as React from "react";
import { Download } from "lucide-react";
import {
  Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { RadioField, RadioGroup } from "@/components/ui/radio-group";
import type { BranchExportKind } from "@/lib/branches/import-columns";

/**
 * Exportar filiais (§61): o que e em que formato.
 *
 * O arquivo sai da rota `/estrutura/filiais/export`, que consulta as mesmas
 * views da tela com o cliente de quem exporta e registra a exportação na
 * auditoria antes de devolver um byte. Este diálogo só monta o endereço.
 */

export interface BranchExportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Filtros da tela, já no formato da URL da página. */
  filterQuery: string;
  hasFilters: boolean;
  filteredCount: number;
  totalCount: number;
  selectedIds: string[];
  canExport: boolean;
  canImport: boolean;
  initialKind?: BranchExportKind;
  exportPath?: string;
}

const number = new Intl.NumberFormat("pt-BR");

export function BranchExportDialog({
  open,
  onOpenChange,
  filterQuery,
  hasFilters,
  filteredCount,
  totalCount,
  selectedIds,
  canExport,
  canImport,
  initialKind,
  exportPath = "/estrutura/filiais/export",
}: BranchExportDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md" aria-describedby="branch-export-description">
        {open ? (
          <ExportBody
            filterQuery={filterQuery}
            hasFilters={hasFilters}
            filteredCount={filteredCount}
            totalCount={totalCount}
            selectedIds={selectedIds}
            canExport={canExport}
            canImport={canImport}
            initialKind={initialKind}
            exportPath={exportPath}
            onClose={() => onOpenChange(false)}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function ExportBody({
  filterQuery,
  hasFilters,
  filteredCount,
  totalCount,
  selectedIds,
  canExport,
  canImport,
  initialKind,
  exportPath,
  onClose,
}: Omit<BranchExportDialogProps, "open" | "onOpenChange"> & { exportPath: string; onClose: () => void }) {
  const available: Record<BranchExportKind, boolean> = {
    todas: canExport,
    filtradas: canExport && hasFilters,
    selecionadas: canExport && selectedIds.length > 0,
    operacoes: canExport,
    modelo: canExport || canImport,
  };
  const fallback: BranchExportKind = canExport ? "todas" : "modelo";
  const [kind, setKind] = React.useState<BranchExportKind>(
    initialKind && available[initialKind] ? initialKind : fallback,
  );
  const [format, setFormat] = React.useState<"xlsx" | "csv">("xlsx");

  const href = React.useMemo(() => {
    const params = new URLSearchParams();
    params.set("tipo", kind);
    params.set("format", format);
    if (kind === "filtradas") {
      const filters = new URLSearchParams(filterQuery);
      for (const key of ["q", "situacao", "operacao", "uf", "cidade", "frota", "colaboradores"]) {
        const value = filters.get(key);
        if (value) params.set(key, value);
      }
    }
    return `${exportPath}?${params.toString()}`;
  }, [kind, format, filterQuery, exportPath]);

  return (
    <>
      <DialogHeader>
        <DialogTitle>Exportar filiais</DialogTitle>
        <DialogDescription id="branch-export-description">
          O arquivo contém só o que você pode ver, e cada exportação fica registrada na auditoria.
        </DialogDescription>
      </DialogHeader>

      <DialogBody className="flex flex-col gap-4">
        <fieldset className="flex flex-col gap-1">
          <legend className="mb-1 text-label font-semibold text-fg">O que exportar</legend>
          <RadioGroup
            aria-label="O que exportar"
            value={kind}
            onValueChange={(v) => setKind(v as BranchExportKind)}
            className="gap-0"
          >
            <RadioField
              value="todas"
              disabled={!available.todas}
              label={`Todas as filiais autorizadas (${number.format(totalCount)})`}
              description="Todas as que você enxerga, sem os filtros da tela."
            />
            <RadioField
              value="filtradas"
              disabled={!available.filtradas}
              label={`Filiais filtradas (${number.format(filteredCount)})`}
              description={hasFilters ? "Exatamente a lista em tela, com os filtros aplicados." : "Nenhum filtro aplicado na tela."}
            />
            <RadioField
              value="selecionadas"
              disabled={!available.selecionadas}
              label={`Filiais selecionadas (${number.format(selectedIds.length)})`}
              description={
                selectedIds.length === 0 ? "Marque as filiais na lista para exportá-las." : "Só as linhas marcadas na lista."
              }
            />
            <RadioField
              value="operacoes"
              disabled={!available.operacoes}
              label="Relação filiais × operações"
              description="Uma linha por vínculo, com vigência — inclusive os encerrados."
            />
            <RadioField
              value="modelo"
              disabled={!available.modelo}
              label="Modelo de importação"
              description="Só os cabeçalhos, para preencher e importar."
            />
          </RadioGroup>
        </fieldset>

        <fieldset className="flex flex-col gap-1">
          <legend className="mb-1 text-label font-semibold text-fg">Formato</legend>
          <RadioGroup
            aria-label="Formato do arquivo"
            orientation="horizontal"
            value={format}
            onValueChange={(v) => setFormat(v === "csv" ? "csv" : "xlsx")}
          >
            <RadioField value="xlsx" label="XLSX" />
            <RadioField value="csv" label="CSV" />
          </RadioGroup>
        </fieldset>
      </DialogBody>

      <DialogFooter>
        <Button variant="ghost" onClick={onClose}>
          Cancelar
        </Button>
        {available[kind] && kind === "selecionadas" ? (
          // A seleção vai no corpo da requisição: sem teto de filiais marcadas.
          <form method="post" action={exportPath} onSubmit={() => onClose()}>
            <input type="hidden" name="tipo" value={kind} />
            <input type="hidden" name="format" value={format} />
            <input type="hidden" name="ids" value={selectedIds.join(",")} />
            <Button type="submit" leadingIcon={<Download />} data-testid="branch-export-download">
              Baixar arquivo
            </Button>
          </form>
        ) : available[kind] ? (
          <Button asChild>
            <a href={href} download onClick={() => onClose()} data-testid="branch-export-download">
              <Download aria-hidden />
              Baixar arquivo
            </a>
          </Button>
        ) : (
          <Button disabled leadingIcon={<Download />}>
            Baixar arquivo
          </Button>
        )}
      </DialogFooter>
    </>
  );
}
