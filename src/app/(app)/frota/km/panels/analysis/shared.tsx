"use client";

import * as React from "react";
import { Badge } from "@/components/ui/badge";
import { StatusBadge, type StatusTone } from "@/components/ui/status-badge";
import { TableHead, type TableHeadProps, type TableSortDirection } from "@/components/ui/table";
import { fmt1, type KmTone } from "@/lib/km/types";
import type { KmPanelContext } from "../../shared";

/**
 * Peças comuns da Análise gerencial e da Qualidade de dados do KM: selo por
 * tom (com texto, nunca só cor), percentuais com sinal, ordenação de tabela no
 * cliente (só apresentação) e estado de aba na URL com resposta imediata.
 */

/** Selo de um tom do catálogo do KM. `brand` vira o selo primário. */
export function ToneBadge({
  tone, children, size = "sm", testId,
}: {
  tone: KmTone | "brand" | string | null | undefined;
  children: React.ReactNode;
  size?: "sm" | "md";
  testId?: string;
}) {
  if (tone === "brand") {
    return (
      <Badge variant="primary" size={size} data-testid={testId}>
        <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-primary" />
        {children}
      </Badge>
    );
  }
  const status: StatusTone =
    tone === "success" || tone === "warning" || tone === "danger" || tone === "info" ? tone : "neutral";
  return (
    <StatusBadge status={status} size={size} data-testid={testId}>
      {children}
    </StatusBadge>
  );
}

/** +12,3% / −4,0% / 0,0% — o sinal vem do valor devolvido pela rotina. */
export function signedPct(v: number | null | undefined): string {
  if (v == null || Number.isNaN(v)) return "—";
  const sign = v > 0 ? "+" : v < 0 ? "−" : "";
  return `${sign}${fmt1(Math.abs(v))}%`;
}

export function signedNum(v: number | null | undefined, digits = 2): string {
  if (v == null || Number.isNaN(v)) return "—";
  const nf = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: digits, maximumFractionDigits: digits });
  const sign = v > 0 ? "+" : v < 0 ? "−" : "";
  return `${sign}${nf.format(Math.abs(v))}`;
}

// ---------------------------------------------------------------------------
// Ordenação no cliente (só a ordem de exibição; os valores vêm prontos)
// ---------------------------------------------------------------------------
export interface SortState<K extends string> {
  key: K;
  dir: TableSortDirection;
}

type Accessor<T> = (row: T) => number | string | null | undefined;

export function useSorted<T, K extends string>(
  rows: T[],
  accessors: Record<K, Accessor<T>>,
  initial: SortState<K> | null,
): { sorted: T[]; sort: SortState<K> | null; setSort: (key: K, dir: TableSortDirection) => void } {
  const [sort, setSortState] = React.useState<SortState<K> | null>(initial);
  const sorted = React.useMemo(() => {
    if (!sort) return rows;
    const get = accessors[sort.key];
    const factor = sort.dir === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => {
      const va = get(a);
      const vb = get(b);
      // Sem valor sempre por último, nos dois sentidos.
      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      if (typeof va === "number" && typeof vb === "number") return (va - vb) * factor;
      return String(va).localeCompare(String(vb), "pt-BR", { numeric: true }) * factor;
    });
    // `accessors` é estável por tabela (declarado fora do render ou memoizado).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, sort]);
  const setSort = React.useCallback((key: K, dir: TableSortDirection) => setSortState({ key, dir }), []);
  return { sorted, sort, setSort };
}

/** Cabeçalho ordenável ligado ao `useSorted`. */
export function SortHead<K extends string>({
  sortKey, sort, onSort, ...props
}: Omit<TableHeadProps, "sortable" | "sortDirection" | "onSort"> & {
  sortKey: K;
  sort: SortState<K> | null;
  onSort: (key: K, dir: TableSortDirection) => void;
}) {
  return (
    <TableHead
      sortable
      sortDirection={sort?.key === sortKey ? sort.dir : null}
      onSort={(dir) => onSort(sortKey, sort?.key === sortKey ? dir : props.numeric ? "desc" : "asc")}
      {...props}
    />
  );
}

// ---------------------------------------------------------------------------
// Estado da aba na URL, com resposta imediata enquanto a tela recarrega
// ---------------------------------------------------------------------------
export function useUrlParam(
  ctx: KmPanelContext,
  key: string,
  fallback: string,
): [string, (next: string) => void] {
  const fromUrl = ctx.params[key] ?? fallback;
  const [value, setOptimistic] = React.useOptimistic(fromUrl);
  const [, startTransition] = React.useTransition();
  const { navigate } = ctx;
  const set = React.useCallback(
    (next: string) => {
      startTransition(() => {
        setOptimistic(next);
        navigate({ [key]: next === fallback ? null : next });
      });
    },
    [fallback, key, navigate, setOptimistic],
  );
  return [value, set];
}

/** Paginação simples no cliente (fatia para exibir). */
export function usePage<T>(rows: T[], initialSize = 50) {
  const [page, setPage] = React.useState(1);
  const [pageSize, setPageSize] = React.useState(initialSize);
  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize));
  const current = Math.min(page, pageCount);
  const slice = React.useMemo(
    () => rows.slice((current - 1) * pageSize, current * pageSize),
    [rows, current, pageSize],
  );
  return {
    page: current,
    pageSize,
    slice,
    setPage,
    setPageSize: (size: number) => {
      setPageSize(size);
      setPage(1);
    },
  };
}
