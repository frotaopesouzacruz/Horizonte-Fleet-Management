"use client";

import * as React from "react";
import { Eye, History, Search } from "lucide-react";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { DateInput } from "@/components/ui/date-input";
import { Input } from "@/components/ui/input";
import { FormField } from "@/components/ui/form-field";
import { FilterBar } from "@/components/ui/filter-bar";
import { NativeSelect } from "@/components/governance/selects";
import {
  Table, TableBody, TableCell, TableContainer, TableEmpty, TableHead, TableHeader, TableLoading, TableRow,
} from "@/components/ui/table";
import { Alert, AlertDescription } from "@/components/feedback/alert";
import { loadScopeExecutions } from "@/lib/applications/history-actions";
import type { ChecklistType } from "@/lib/applications/queries";
import type { ScopeExecution, ScopeFilters } from "@/lib/applications/history-queries";
import { CHECKLIST_TYPE_SHORT, formatDateBr, formatDurationLabel } from "./execution-detail-drawer";

export type { ScopeExecution, ScopeFilters } from "@/lib/applications/history-queries";

export type ScopeLoader = (
  filters: ScopeFilters,
) => Promise<{ ok: boolean; error?: string; data?: ScopeExecution[] }>;

export interface ScopeHistoryProps {
  operations: { id: string; name: string }[];
  /** Injetável para a prévia e os testes; em produção é a action. */
  loader?: ScopeLoader;
  /** Quando vem, a lista não busca ao montar: usa o que a página já trouxe. */
  initialRows?: ScopeExecution[];
  onOpenDetail: (id: string) => void;
}

interface Draft {
  dateFrom: string;
  dateTo: string;
  operationId: string;
  checklistType: ChecklistType | "";
  search: string;
}

/** A rotina aceita até 200; pedimos o máximo e avisamos quando bate no teto. */
const LIMIT = 200;
const COLUMNS = 11;

const number = new Intl.NumberFormat("pt-BR");

/** O mês vigente, do dia 1 ao último dia — o recorte natural de quem confere aderência. */
function currentMonthDraft(): Draft {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  const mm = String(m + 1).padStart(2, "0");
  const last = new Date(y, m + 1, 0).getDate();
  return {
    dateFrom: `${y}-${mm}-01`,
    dateTo: `${y}-${mm}-${String(last).padStart(2, "0")}`,
    operationId: "",
    checklistType: "",
    search: "",
  };
}

function toFilters(d: Draft): ScopeFilters {
  return {
    dateFrom: d.dateFrom || undefined,
    dateTo: d.dateTo || undefined,
    operationId: d.operationId || undefined,
    checklistType: d.checklistType || undefined,
    search: d.search.trim() || undefined,
    limit: LIMIT,
  };
}

/**
 * Histórico do escopo (§64): o que a liderança alcança, com filtros.
 *
 * Só lista e abre — nenhuma ação sobre a execução nasce daqui. A RLS delimita
 * o alcance no banco; os filtros só reduzem o que já se podia ver.
 */
export function ScopeHistory({ operations, loader, initialRows, onOpenDetail }: ScopeHistoryProps) {
  const load = loader ?? loadScopeExecutions;
  const [initialDraft] = React.useState(currentMonthDraft);
  const [draft, setDraft] = React.useState<Draft>(initialDraft);
  const [rows, setRows] = React.useState<ScopeExecution[] | null>(initialRows ?? null);
  const [error, setError] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();
  const loading = rows === null && error === null;

  const run = React.useCallback(
    (d: Draft) => {
      startTransition(async () => {
        const result = await load(toFilters(d));
        if (result.ok) {
          setRows(result.data ?? []);
          setError(null);
        } else {
          setError(result.error ?? "Não foi possível carregar o histórico do escopo.");
        }
      });
    },
    [load],
  );

  // Sem linhas iniciais, a lista se serve sozinha ao montar.
  React.useEffect(() => {
    if (initialRows !== undefined) return;
    run(initialDraft);
  }, [initialRows, initialDraft, run]);

  const update = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));

  return (
    <div className="flex flex-col gap-3">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (!pending) run(draft);
        }}
      >
        <FilterBar label="Filtros do histórico" className="items-end gap-x-3 py-0">
          <FormField label="De" id="scope-history-from" className="w-auto">
            <DateInput
              size="sm"
              value={draft.dateFrom}
              max={draft.dateTo || undefined}
              onChange={(e) => update("dateFrom", e.target.value)}
            />
          </FormField>
          <FormField label="Até" id="scope-history-to" className="w-auto">
            <DateInput
              size="sm"
              value={draft.dateTo}
              min={draft.dateFrom || undefined}
              onChange={(e) => update("dateTo", e.target.value)}
            />
          </FormField>
          <FormField label="Operação" id="scope-history-operation" className="w-auto min-w-44">
            <NativeSelect
              fieldSize="sm"
              value={draft.operationId}
              onChange={(e) => update("operationId", e.target.value)}
            >
              <option value="">Todas</option>
              {operations.map((o) => (
                <option key={o.id} value={o.id}>{o.name}</option>
              ))}
            </NativeSelect>
          </FormField>
          <FormField label="Tipo" id="scope-history-type" className="w-auto min-w-28">
            <NativeSelect
              fieldSize="sm"
              value={draft.checklistType}
              onChange={(e) => update("checklistType", e.target.value as Draft["checklistType"])}
            >
              <option value="">Todos</option>
              <option value="saida">Saída</option>
              <option value="retorno">Retorno</option>
            </NativeSelect>
          </FormField>
          <FormField label="Busca" id="scope-history-search" className="w-auto min-w-56">
            <Input
              size="sm"
              inputMode="search"
              autoComplete="off"
              placeholder="Placa, frota ou colaborador"
              leadingIcon={<Search />}
              value={draft.search}
              onChange={(e) => update("search", e.target.value)}
            />
          </FormField>
          <Button type="submit" size="sm" loading={pending}>
            Aplicar
          </Button>
        </FilterBar>
      </form>

      {error ? (
        <Alert variant="danger">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {rows ? (
        <p className="text-caption text-fg-muted" aria-live="polite">
          {rows.length === 0
            ? "Nenhum checklist no período."
            : `${number.format(rows.length)} ${rows.length === 1 ? "checklist" : "checklists"} no período.`}
          {rows.length >= LIMIT
            ? ` Mostrando os ${number.format(LIMIT)} mais recentes — reduza o período para ver o restante.`
            : ""}
        </p>
      ) : null}

      <TableContainer>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Data</TableHead>
              <TableHead>Tipo</TableHead>
              <TableHead>Placa / Frota</TableHead>
              <TableHead>Operação · BR</TableHead>
              <TableHead>Colaborador</TableHead>
              <TableHead numeric>Duração</TableHead>
              <TableHead numeric>Conformes</TableHead>
              <TableHead numeric>Inconformes</TableHead>
              <TableHead numeric>Críticas</TableHead>
              <TableHead>Situação</TableHead>
              <TableHead>
                <span className="sr-only">Ações</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          {loading ? (
            <TableLoading cols={COLUMNS} rows={4} label="Carregando o histórico…" />
          ) : (
            <TableBody>
              {!rows || rows.length === 0 ? (
                <TableEmpty colSpan={COLUMNS} icon={<History />} message="Nenhum checklist no período" />
              ) : (
                rows.map((r) => <ScopeRow key={r.id} row={r} onOpen={() => onOpenDetail(r.id)} />)
              )}
            </TableBody>
          )}
        </Table>
      </TableContainer>
    </div>
  );
}

function ScopeRow({ row, onOpen }: { row: ScopeExecution; onOpen: () => void }) {
  const vehicle = row.licensePlate ?? row.fleetCode ?? "—";
  const hasIssue = row.nonConforming > 0;
  const hasCritical = row.criticalNonConforming > 0;
  return (
    <TableRow>
      <TableCell className="whitespace-nowrap tabular-nums">{formatDateBr(row.operationalDate)}</TableCell>
      <TableCell>
        <Badge variant={row.checklistType === "saida" ? "info" : "neutral"} appearance="soft" size="sm">
          {CHECKLIST_TYPE_SHORT[row.checklistType]}
        </Badge>
      </TableCell>
      <TableCell className="whitespace-nowrap">
        <span className="font-medium text-fg">{vehicle}</span>
        {row.licensePlate && row.fleetCode ? (
          <>
            {" "}
            <span className="text-fg-muted">{row.fleetCode}</span>
          </>
        ) : null}
      </TableCell>
      <TableCell className="text-fg-muted">
        {[row.operationName, row.brCode].filter(Boolean).join(" · ")}
      </TableCell>
      <TableCell>
        <span className="block text-fg">{row.employeeName ?? "—"}</span>
        {row.employeeCode ? (
          <span className="block text-caption text-fg-muted">Matrícula {row.employeeCode}</span>
        ) : null}
      </TableCell>
      <TableCell numeric className="whitespace-nowrap">{formatDurationLabel(row.durationSeconds)}</TableCell>
      <TableCell numeric>{number.format(row.conforming)}</TableCell>
      <TableCell numeric className={cn(hasIssue && "font-medium text-warning-soft-fg")}>
        {number.format(row.nonConforming)}
      </TableCell>
      <TableCell numeric className={cn(hasCritical && "font-medium text-danger")}>
        {number.format(row.criticalNonConforming)}
      </TableCell>
      <TableCell>
        {hasIssue ? (
          <Badge variant={hasCritical ? "danger" : "warning"} appearance="soft" size="sm">
            Com inconformidade
          </Badge>
        ) : (
          <Badge variant="success" appearance="soft" size="sm">OK</Badge>
        )}
      </TableCell>
      <TableCell className="w-px whitespace-nowrap">
        <Button variant="ghost" size="sm" leadingIcon={<Eye />} onClick={onOpen} className="-my-1">
          Ver
          <span className="sr-only">
            {` checklist de ${vehicle} em ${formatDateBr(row.operationalDate)}`}
          </span>
        </Button>
      </TableCell>
    </TableRow>
  );
}
