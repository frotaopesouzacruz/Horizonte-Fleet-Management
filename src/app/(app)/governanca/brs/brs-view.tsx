"use client";

import * as React from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ChevronDown, Download, FileSpreadsheet, Layers, ListPlus, MapPin, Plus, Upload } from "lucide-react";
import { PageContent, PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Pagination } from "@/components/ui/pagination";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { EmptyState } from "@/components/feedback/empty-state";
import { useToast } from "@/components/feedback/toast";
import { useConfirm } from "@/components/feedback/confirm-dialog";
import type { CoverageEntry } from "@/components/governance/scope-picker";
import { BrFormDrawer, type BrFormValue } from "@/components/governance/brs/br-form-drawer";
import { BrBatchDrawer } from "@/components/governance/brs/br-batch-drawer";
import { BrHistoryDrawer } from "@/components/governance/brs/br-history-drawer";
import { ImportDrawer } from "@/app/(app)/governanca/fidelizacao/import-drawer";
import { loadBrDetail, loadBrImpact, setOperationBrStatus } from "@/lib/governance/actions";
import type { BrDirectoryPage, BrDirectoryRow, BrSort } from "@/lib/governance/brs";
import type { BrPlannerFilters, BrPlannerIndicators } from "@/lib/governance/br-planner";
import type { Competence } from "@/lib/governance/competence";
import { BrsTable } from "./brs-table";
import { BrsFilters } from "./brs-filters";
import { BrsIndicators } from "./brs-indicators";
import { BrDetailDrawer } from "./br-detail-drawer";
import { formatDate, number } from "./br-labels";

export interface BrsViewProps {
  page: BrDirectoryPage;
  indicators: BrPlannerIndicators | null;
  competence: Competence;
  operations: { id: string; name: string; status: string }[];
  coverage: CoverageEntry[];
  leaders: { id: string; name: string }[];
  filters: BrPlannerFilters;
  sort: BrSort;
  dir: "asc" | "desc";
  /** Página atual, 1-based, como está na URL. */
  pageNumber: number;
  canManageBrs: boolean;
  canImport: boolean;
  canExport: boolean;
  canPlan: boolean;
  /**
   * `fidelization.audit` lê a trilha de auditoria da posição. A gaveta de
   * detalhe desta etapa mostra as movimentações vindas das próprias tabelas,
   * então a permissão chega até aqui mas ainda não abre nada a mais.
   */
  canAudit: boolean;
}

/* --------------------------------------------------------------------- view */

/**
 * Governança Operacional → BRs.
 *
 * A BR é a posição operacional permanente; veículo, motorista e liderança
 * passam por ela. Esta tela é a única casa administrativa da posição:
 * Operações e Fidelização apontam para cá e não repetem o cadastro.
 *
 * Filtros, ordenação e página vivem na URL. A tela é compartilhável, o
 * servidor faz o trabalho, e voltar do detalhe devolve exatamente o recorte
 * que estava aberto.
 */
export function BrsView({
  page,
  indicators,
  competence,
  operations,
  coverage,
  leaders,
  filters,
  sort,
  dir,
  pageNumber,
  canManageBrs,
  canImport,
  canExport,
  canPlan,
}: BrsViewProps) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const { toast } = useToast();
  const confirm = useConfirm();
  const [pending, startTransition] = React.useTransition();

  const [brFormOpen, setBrFormOpen] = React.useState(false);
  const [editingBr, setEditingBr] = React.useState<BrFormValue | undefined>();
  // Bumped on every open so the form remounts with fresh state instead of being
  // reset from an effect after the first frame has already shown the old one.
  const [brFormKey, setBrFormKey] = React.useState(0);
  const [batchOpen, setBatchOpen] = React.useState(false);
  const [importOpen, setImportOpen] = React.useState(false);
  const [detailId, setDetailId] = React.useState<string | null>(null);
  const [historyBr, setHistoryBr] = React.useState<BrDirectoryRow | null>(null);

  /**
   * Qualquer mudança de filtro, competência ou ordenação volta à primeira
   * página: a página 4 de um recorte não é a página 4 de outro. Só a própria
   * paginação passa `page`.
   */
  const navigate = React.useCallback(
    (patch: Record<string, string | null>) => {
      const next = new URLSearchParams(params.toString());
      if (!("page" in patch)) next.delete("page");
      for (const [key, value] of Object.entries(patch)) {
        if (value === null || value === "") next.delete(key);
        else next.set(key, value);
      }
      const query = next.toString();
      startTransition(() => router.push(query ? `${pathname}?${query}` : pathname, { scroll: false }));
    },
    [params, pathname, router],
  );

  /** A exportação leva a competência e os filtros em tela: o arquivo é o que se vê. */
  const exportHref = (format: "xlsx" | "csv") => {
    const next = new URLSearchParams(params.toString());
    next.delete("page");
    next.delete("ordem");
    next.delete("dir");
    next.set("tipo", "planner");
    next.set("format", format);
    return `/governanca/fidelizacao/export?${next.toString()}`;
  };

  /* ---------------------------------------------------------------- ações */

  const openNewBr = () => {
    setEditingBr(undefined);
    setBrFormKey((k) => k + 1);
    setBrFormOpen(true);
  };

  const openEditForm = (value: BrFormValue) => {
    setEditingBr(value);
    setBrFormKey((k) => k + 1);
    setBrFormOpen(true);
  };

  /**
   * A linha da listagem não carrega observações nem `updated_at`. Abrir o
   * formulário só com ela salvaria observações vazias por cima das existentes
   * e sem a conferência de concorrência — então o detalhe é lido antes, como
   * o impacto é lido antes de inativar.
   */
  const openEditBr = (row: BrDirectoryRow) => {
    startTransition(async () => {
      const result = await loadBrDetail(row.id, competence);
      if (!result.ok || !result.data) {
        toast({ title: result.error ?? "Não foi possível abrir a BR para edição.", variant: "danger" });
        return;
      }
      const br = result.data.br;
      openEditForm({
        id: br.id,
        operationId: br.operationId,
        operationCityId: br.operationCityId,
        code: br.code,
        description: br.description,
        notes: br.notes,
        updatedAt: br.updatedAt,
      });
    });
  };

  const toggleBrStatus = async (br: BrDirectoryRow) => {
    const next = br.status === "active" ? "inactive" : "active";

    if (next === "inactive") {
      // §52 in spirit: the dependencies shown are counted from the tables, not
      // guessed. Someone deciding to deactivate needs the real number.
      const impact = await loadBrImpact(br.id);
      const lines = impact.ok && impact.data
        ? [
            `${impact.data.currentVehicles} veículo(s) com vínculo vigente`,
            `${impact.data.currentDrivers} motorista(s) planejado(s)`,
            `${impact.data.currentLeaders} liderança(s) responsável(is)`,
            `${impact.data.totalVehicles} vínculo(s) no histórico`,
          ].join(" · ")
        : "Não foi possível calcular as dependências agora.";

      const confirmed = await confirm({
        title: `Inativar a BR ${br.code}?`,
        description: `A BR deixa de receber novo planejamento. O que já está vigente continua vigente e nada é apagado. Hoje ela tem: ${lines}.`,
        confirmLabel: "Inativar",
        destructive: true,
      });
      if (!confirmed) return;
    }

    startTransition(async () => {
      const result = await setOperationBrStatus(br.id, next, null);
      if (result.ok) {
        toast({ title: next === "inactive" ? "BR inativada." : "BR reativada.", variant: "success" });
        router.refresh();
      } else {
        toast({ title: result.error ?? "Não foi possível alterar a situação.", variant: "danger" });
      }
    });
  };

  /* ------------------------------------------------------------ indicadores */

  const anchorDate = indicators?.anchorDate ?? page.rows[0]?.anchorDate ?? null;
  const hasFilters = Boolean(
    filters.q || filters.operationId || filters.stateId || filters.cityId || filters.status ||
    filters.leaderEmployeeId || filters.vehicle || filters.driver || filters.swapped,
  );

  return (
    <>
      <PageHeader
        title="BRs"
        description="A BR é a posição operacional permanente: veículo, motorista e liderança passam por ela. Este é o único lugar onde a posição é administrada — Operações e Fidelização apenas apontam para cá."
        primaryAction={
          canManageBrs ? (
            <Button leadingIcon={<Plus />} onClick={openNewBr}>
              Nova BR
            </Button>
          ) : undefined
        }
        secondaryActions={
          <>
            {canExport ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="secondary" leadingIcon={<Download />} trailingIcon={<ChevronDown />}>
                    Exportar
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="min-w-64">
                  <DropdownMenuLabel>
                    Exportar {number.format(page.total)} posição(ões) com os filtros atuais
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem asChild>
                    <a href={exportHref("xlsx")} download>
                      <FileSpreadsheet aria-hidden /> BRs (XLSX)
                    </a>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <a href={exportHref("csv")} download>
                      <FileSpreadsheet aria-hidden /> BRs (CSV)
                    </a>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}
            {canImport && canManageBrs ? (
              <Button variant="secondary" leadingIcon={<Upload />} onClick={() => setImportOpen(true)}>
                Importar
              </Button>
            ) : null}
            {canManageBrs ? (
              <Button variant="secondary" leadingIcon={<ListPlus />} onClick={() => setBatchOpen(true)}>
                Cadastrar em lote
              </Button>
            ) : null}
          </>
        }
        filters={
          <BrsFilters
            competence={competence}
            filters={filters}
            operations={operations}
            coverage={coverage}
            leaders={leaders}
            pending={pending}
            onNavigate={navigate}
          />
        }
      />

      <PageContent className="flex flex-col gap-5">
        <BrsIndicators
          indicators={indicators}
          competence={competence}
          fallbackTotal={page.total}
          anchorDate={anchorDate}
        />

        {page.total === 0 && !hasFilters ? (
          <Card>
            <CardContent>
              <EmptyState
                icon={<MapPin />}
                title="Nenhuma posição operacional cadastrada"
                description="Cadastre a primeira BR, ou várias de uma vez para o mesmo local."
                action={
                  canManageBrs ? (
                    <Button leadingIcon={<Plus />} onClick={openNewBr}>
                      Nova BR
                    </Button>
                  ) : undefined
                }
                secondaryAction={
                  canManageBrs ? (
                    <Button variant="secondary" onClick={() => setBatchOpen(true)}>
                      Cadastrar em lote
                    </Button>
                  ) : undefined
                }
              />
            </CardContent>
          </Card>
        ) : (
          <div className="flex flex-col gap-3">
            <BrsTable
              rows={page.rows}
              sort={sort}
              dir={dir}
              onSort={(key, direction) => navigate({ ordem: key, dir: direction })}
              onDetail={(row) => setDetailId(row.id)}
              onHistory={(row) => setHistoryBr(row)}
              onEdit={canManageBrs ? openEditBr : undefined}
              onToggleStatus={canManageBrs ? (row) => void toggleBrStatus(row) : undefined}
              pending={pending}
            />

            <Pagination
              page={pageNumber}
              pageSize={page.limit}
              total={page.total}
              disabled={pending}
              onPageChange={(value) => navigate({ page: value === 1 ? null : String(value) })}
              label="Paginação das posições"
            />
          </div>
        )}

        {/* §22: a data que a competência representa fica dita, não subentendida —
            senão "veículo atual" num mês passado pareceria o veículo de hoje. */}
        {anchorDate ? (
          <p className="flex items-center gap-1.5 text-caption text-fg-muted">
            <Layers className="size-3.5" aria-hidden />
            Recursos resolvidos em {formatDate(anchorDate)} — o cadastro das posições não muda com a
            competência.
          </p>
        ) : null}
      </PageContent>

      {/* ------------------------------------------------------------ gavetas */}

      <BrDetailDrawer
        brId={detailId}
        competence={competence}
        onClose={() => setDetailId(null)}
        canPlan={canPlan}
        canManageBrs={canManageBrs}
        onEdit={
          canManageBrs
            ? (value) => {
                setDetailId(null);
                openEditForm(value);
              }
            : undefined
        }
      />

      <BrHistoryDrawer br={historyBr} onClose={() => setHistoryBr(null)} />

      {canManageBrs ? (
        <>
          <BrFormDrawer
            key={brFormKey}
            open={brFormOpen}
            onOpenChange={setBrFormOpen}
            value={editingBr}
            operations={operations}
            coverage={coverage}
          />
          <BrBatchDrawer
            open={batchOpen}
            onOpenChange={setBatchOpen}
            operations={operations}
            coverage={coverage}
          />
        </>
      ) : null}

      {canImport && canManageBrs ? (
        <ImportDrawer
          open={importOpen}
          onOpenChange={setImportOpen}
          canImportBrs={canManageBrs}
          initialKind="brs"
          exportPath="/governanca/fidelizacao/export"
        />
      ) : null}
    </>
  );
}
