"use client";

import * as React from "react";
import { ListChecks } from "lucide-react";
import { Alert, AlertDescription } from "@/components/feedback/alert";
import { Button } from "@/components/ui/button";
import { StatusBadge, type StatusTone } from "@/components/ui/status-badge";
import { Table, TableBody, TableCell, TableContainer, TableEmpty, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/cn";
import type { KmFindingsPage, KmImportFinding } from "@/lib/km/batches";
import { kmImportFindings } from "@/lib/km/import-actions";
import { formatDate } from "@/lib/km/types";
import { KM_FINDING, KM_LEVEL, fmtCount, kmFindingLabel } from "./shared";

/**
 * Achados de um lote, por código, paginados no banco (`km_import_findings`):
 * erros primeiro, depois pela linha. Nada é cortado sem aviso — o total de
 * cada código aparece, e "Carregar mais" traz a próxima página.
 */

const PAGE = 100;

interface State {
  code: string | null;
  rows: KmImportFinding[];
  total: number;
  error: string | null;
}

export function KmFindingsList({
  batchId,
  categories,
  initial,
  initialError,
  testId,
}: {
  batchId: string;
  /** Total por código, pelas chaves do banco. */
  categories: Record<string, number>;
  /** Primeira página de "todos" já carregada pelo servidor (opcional). */
  initial?: KmFindingsPage | null;
  initialError?: string | null;
  testId: string;
}) {
  const [state, setState] = React.useState<State>(() => ({
    code: null,
    rows: initial?.rows ?? [],
    total: initial?.total ?? 0,
    error: initialError ?? null,
  }));
  const [allTotal, setAllTotal] = React.useState<number | null>(initial ? initial.total : null);
  const [loading, startLoading] = React.useTransition();

  // Só a resposta do último pedido vale (trocar de código no meio de uma carga).
  const requestRef = React.useRef(0);
  const load = React.useCallback(
    (code: string | null, offset: number) => {
      const request = ++requestRef.current;
      startLoading(async () => {
        try {
          const res = await kmImportFindings(batchId, code, offset, PAGE);
          if (request !== requestRef.current) return;
          if (!res.ok || !res.data) {
            setState((prev) => ({ ...prev, code, error: res.error ?? "Não foi possível carregar os achados." }));
            return;
          }
          const page = res.data;
          if (code === null) setAllTotal(page.total);
          setState((prev) => ({
            code,
            rows: offset > 0 && prev.code === code ? [...prev.rows, ...page.rows] : page.rows,
            total: page.total,
            error: null,
          }));
        } catch {
          if (request !== requestRef.current) return;
          setState((prev) => ({ ...prev, error: "A conexão com o servidor caiu. Tente de novo." }));
        }
      });
    },
    [batchId],
  );

  // Sem a primeira página vinda do servidor (prévia recém-montada), busca aqui.
  const fetchedRef = React.useRef(Boolean(initial));
  React.useEffect(() => {
    if (fetchedRef.current) return;
    fetchedRef.current = true;
    load(null, 0);
  }, [load]);

  const codes = Object.entries(categories)
    .filter(([, n]) => n > 0)
    .sort((a, b) => {
      const la = KM_FINDING[a[0]]?.level === "error" ? 0 : 1;
      const lb = KM_FINDING[b[0]]?.level === "error" ? 0 : 1;
      return la - lb || b[1] - a[1];
    });

  const select = (code: string | null) => {
    if (code === state.code && state.rows.length) return;
    load(code, 0);
  };

  const shown = state.rows.length;
  const remaining = Math.max(0, state.total - shown);

  return (
    <section aria-labelledby={`${testId}-titulo`} className="flex flex-col gap-3" data-testid={testId}>
      <div className="flex flex-wrap items-center gap-2">
        <ListChecks className="size-4 text-fg-muted" aria-hidden />
        <h3 id={`${testId}-titulo`} className="text-label font-semibold text-fg">
          Achados por código
        </h3>
        <span className="text-caption text-fg-muted">
          {allTotal !== null ? `${fmtCount(allTotal)} no total` : ""} · erros bloqueiam a linha; avisos não
        </span>
      </div>

      <div role="group" aria-label="Filtrar achados por código" className="flex flex-wrap gap-1.5" data-testid={`${testId}-codigos`}>
        <CodeChip active={state.code === null} onClick={() => select(null)} label="Todos" count={allTotal} tone="neutral" disabled={loading} />
        {codes.map(([code, n]) => {
          const meta = KM_FINDING[code];
          return (
            <CodeChip
              key={code}
              active={state.code === code}
              onClick={() => select(code)}
              label={kmFindingLabel(code)}
              title={meta?.description}
              count={n}
              tone={meta?.level === "error" ? "danger" : "warning"}
              disabled={loading}
            />
          );
        })}
      </div>

      {state.error ? (
        <Alert variant="danger">
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      ) : null}

      <TableContainer tabIndex={0} stickyHeader maxHeight={480} aria-busy={loading} aria-label="Achados do lote">
        <Table layout="fixed" style={{ minWidth: 860 }} data-testid={`${testId}-tabela`}>
          <TableHeader>
            <TableRow>
              <TableHead style={{ width: 80 }} numeric>
                Linha
              </TableHead>
              <TableHead style={{ width: 96 }}>Nível</TableHead>
              <TableHead style={{ width: 200 }}>Achado</TableHead>
              <TableHead style={{ width: 100 }}>Placa</TableHead>
              <TableHead style={{ width: 100 }}>Data</TableHead>
              <TableHead>Mensagem</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {state.rows.length === 0 ? (
              <TableEmpty
                colSpan={6}
                message={loading ? "Carregando achados…" : state.code ? "Nenhum achado deste código." : "Nenhum achado: todas as linhas passaram sem aviso."}
              />
            ) : (
              state.rows.map((f, i) => {
                const level = KM_LEVEL[f.level] ?? { label: f.level || "—", tone: "neutral" as StatusTone };
                return (
                  <TableRow key={`${f.rowNumber ?? "x"}-${f.code ?? ""}-${i}`}>
                    <TableCell numeric>{f.rowNumber ?? "—"}</TableCell>
                    <TableCell>
                      <StatusBadge status={level.tone} size="sm">
                        {level.label}
                      </StatusBadge>
                    </TableCell>
                    <TableCell truncate title={f.code ?? undefined}>
                      {kmFindingLabel(f.code)}
                    </TableCell>
                    <TableCell truncate className="font-mono">
                      {f.plate ?? "—"}
                    </TableCell>
                    <TableCell className="tabular-nums">{formatDate(f.date)}</TableCell>
                    <TableCell className="whitespace-normal py-2 text-fg-secondary">{f.message}</TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </TableContainer>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-caption text-fg-muted" aria-live="polite" data-testid={`${testId}-contagem`}>
          Mostrando {fmtCount(shown)} de {fmtCount(state.total)} achado(s)
          {state.code ? ` de ${kmFindingLabel(state.code)}` : ""}.
        </p>
        {remaining > 0 ? (
          <Button
            size="sm"
            variant="outline"
            loading={loading}
            onClick={() => load(state.code, shown)}
            data-testid={`${testId}-mais`}
          >
            Carregar mais {fmtCount(Math.min(PAGE, remaining))}
          </Button>
        ) : null}
      </div>
    </section>
  );
}

function CodeChip({
  active,
  onClick,
  label,
  count,
  tone,
  title,
  disabled,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  count: number | null;
  tone: "neutral" | "danger" | "warning";
  title?: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={cn(
        "inline-flex h-7 items-center gap-1.5 rounded-sm border px-2.5 text-body-sm font-medium hfm-transition hfm-focus-ring",
        "disabled:cursor-wait",
        active ? "border-primary bg-primary-soft text-primary-soft-fg" : "border-border bg-surface text-fg-secondary hover:bg-hover-overlay",
      )}
    >
      {tone !== "neutral" ? (
        <span
          aria-hidden
          className={cn("size-1.5 shrink-0 rounded-full", tone === "danger" ? "bg-danger" : "bg-warning")}
        />
      ) : null}
      <span>{label}</span>
      {tone !== "neutral" ? <span className="sr-only">({tone === "danger" ? "erro" : "aviso"})</span> : null}
      <span className="tabular-nums text-fg-muted">{count === null ? "…" : fmtCount(count)}</span>
    </button>
  );
}
