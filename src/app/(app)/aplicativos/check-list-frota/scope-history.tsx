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
const COLUMNS = 10;

/** Campo da barra de filtros (UI 2.0): rótulo discreto acima, controle `sm`. */
const FIELD = "w-auto gap-1";
const FIELD_LABEL = "text-caption font-normal text-fg-muted";
/** No celular (a tela também abre no app do executor), alvo de toque de 38 px; `sm` a partir de 640 px. */
const TOUCH = "h-(--control-height-md) sm:h-(--control-height-sm)";

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
      {/* UI 2.0: cartão de ferramentas — campos rotulados que crescem juntos e
          "Aplicar" à direita da primeira linha. */}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (!pending) run(draft);
        }}
        className="rounded-xl border border-border bg-surface-toolbar px-3 py-2.5 shadow-card"
      >
        <FilterBar label="Filtros do histórico" className="flex-wrap items-end gap-x-3 gap-y-2.5 py-0">
          <div className="flex min-w-0 flex-1 basis-[34rem] flex-wrap items-end gap-2.5">
            <FormField
              label="De"
              id="scope-history-from"
              className={cn(FIELD, "flex-[1_1_8.75rem] sm:flex-[0_0_9.5rem]")}
              labelClassName={FIELD_LABEL}
            >
              <DateInput
                size="sm"
                className={TOUCH}
                value={draft.dateFrom}
                max={draft.dateTo || undefined}
                onChange={(e) => update("dateFrom", e.target.value)}
              />
            </FormField>
            <FormField
              label="Até"
              id="scope-history-to"
              className={cn(FIELD, "flex-[1_1_8.75rem] sm:flex-[0_0_9.5rem]")}
              labelClassName={FIELD_LABEL}
            >
              <DateInput
                size="sm"
                className={TOUCH}
                value={draft.dateTo}
                min={draft.dateFrom || undefined}
                onChange={(e) => update("dateTo", e.target.value)}
              />
            </FormField>
            <FormField
              label="Operação"
              id="scope-history-operation"
              className={cn(FIELD, "flex-[1.2_1_10rem]")}
              labelClassName={FIELD_LABEL}
            >
              <NativeSelect
                fieldSize="sm"
                className={TOUCH}
                value={draft.operationId}
                onChange={(e) => update("operationId", e.target.value)}
              >
                <option value="">Todas</option>
                {operations.map((o) => (
                  <option key={o.id} value={o.id}>{o.name}</option>
                ))}
              </NativeSelect>
            </FormField>
            <FormField
              label="Tipo"
              id="scope-history-type"
              className={cn(FIELD, "flex-[0.6_1_7rem]")}
              labelClassName={FIELD_LABEL}
            >
              <NativeSelect
                fieldSize="sm"
                className={TOUCH}
                value={draft.checklistType}
                onChange={(e) => update("checklistType", e.target.value as Draft["checklistType"])}
              >
                <option value="">Todos</option>
                <option value="saida">Saída</option>
                <option value="retorno">Retorno</option>
              </NativeSelect>
            </FormField>
            <FormField
              label="Busca"
              id="scope-history-search"
              className={cn(FIELD, "flex-[1.6_1_13rem]")}
              labelClassName={FIELD_LABEL}
            >
              <Input
                size="sm"
                className={TOUCH}
                inputMode="search"
                autoComplete="off"
                placeholder="Placa, frota ou colaborador"
                leadingIcon={<Search />}
                value={draft.search}
                onChange={(e) => update("search", e.target.value)}
              />
            </FormField>
          </div>
          <Button type="submit" size="sm" loading={pending} className={cn("shrink-0", TOUCH)}>
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

      {/* Células de duas linhas (data · tipo, placa · frota, operação · BR) e
          cabeçalhos curtos com <abbr title>: a tabela cabe sem cortar títulos. */}
      <TableContainer>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Data · tipo</TableHead>
              <TableHead>Placa / Frota</TableHead>
              <TableHead>Operação · BR</TableHead>
              <TableHead>Colaborador</TableHead>
              <TableHead numeric>Duração</TableHead>
              <TableHead numeric>
                <abbr title="Respostas conformes">Conf.</abbr>
              </TableHead>
              <TableHead numeric>
                <abbr title="Respostas inconformes">Inconf.</abbr>
              </TableHead>
              <TableHead numeric>
                <abbr title="Inconformidades críticas">Crít.</abbr>
              </TableHead>
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
      <TableCell>
        <span className="flex flex-col items-start gap-1">
          <span className="whitespace-nowrap tabular-nums">{formatDateBr(row.operationalDate)}</span>
          <Badge variant={row.checklistType === "saida" ? "info" : "neutral"} appearance="soft" size="sm">
            {CHECKLIST_TYPE_SHORT[row.checklistType]}
          </Badge>
        </span>
      </TableCell>
      <TableCell className="whitespace-nowrap">
        <span className="block font-medium text-fg">{vehicle}</span>
        {row.licensePlate && row.fleetCode ? (
          <>
            {" "}
            <span className="block text-caption text-fg-muted">{row.fleetCode}</span>
          </>
        ) : null}
      </TableCell>
      <TableCell className="min-w-36">
        <span className="block text-fg-secondary">{row.operationName ?? "—"}</span>
        {row.brCode ? <span className="block text-caption text-fg-muted">{row.brCode}</span> : null}
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
