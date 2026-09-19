"use client";

import * as React from "react";
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from "lucide-react";
import { cn } from "@/lib/cn";
import { Button, IconButton } from "@/components/ui/button";
import { inputVariants } from "@/components/ui/input";

/**
 * Pagination — dense footer control for server-paginated tables.
 * Fully controlled: `page` is 1-based and every interaction is reported through
 * `onPageChange` / `onPageSizeChange`.
 */

const numberFormat = new Intl.NumberFormat("pt-BR");

/** Formats an integer with pt-BR grouping ("1.240"). */
export function formatCount(value: number): string {
  return numberFormat.format(value);
}

type PageItem = number | "ellipsis";

/**
 * Builds the compact page list: first page, a window around the current page,
 * the last page, and ellipsis where pages were skipped.
 */
export function buildPageItems(page: number, pageCount: number, siblingCount = 1): PageItem[] {
  const windowSize = siblingCount * 2 + 5;
  if (pageCount <= windowSize) {
    return Array.from({ length: pageCount }, (_, index) => index + 1);
  }

  const showLeftEllipsis = page - siblingCount > 2;
  const showRightEllipsis = page + siblingCount < pageCount - 1;
  const edgeCount = siblingCount * 2 + 3;

  if (!showLeftEllipsis && showRightEllipsis) {
    return [...Array.from({ length: edgeCount }, (_, index) => index + 1), "ellipsis", pageCount];
  }
  if (showLeftEllipsis && !showRightEllipsis) {
    return [1, "ellipsis", ...Array.from({ length: edgeCount }, (_, index) => pageCount - edgeCount + 1 + index)];
  }
  return [
    1,
    "ellipsis",
    ...Array.from({ length: siblingCount * 2 + 1 }, (_, index) => page - siblingCount + index),
    "ellipsis",
    pageCount,
  ];
}

export interface PaginationProps extends Omit<React.HTMLAttributes<HTMLElement>, "onChange"> {
  /** Current page, 1-based. */
  page: number;
  pageSize: number;
  /** Total number of records across all pages. */
  total: number;
  onPageChange: (page: number) => void;
  /** When provided, the page-size selector is rendered. */
  onPageSizeChange?: (pageSize: number) => void;
  pageSizeOptions?: number[];
  /** Pages shown on each side of the current page. */
  siblingCount?: number;
  /** Disables every control (e.g. while a request is in flight). */
  disabled?: boolean;
  /** Accessible name of the navigation landmark. */
  label?: string;
}

export const Pagination = React.forwardRef<HTMLElement, PaginationProps>(function Pagination(
  {
    className,
    page,
    pageSize,
    total,
    onPageChange,
    onPageSizeChange,
    pageSizeOptions = [25, 50, 100],
    siblingCount = 1,
    disabled = false,
    label = "Paginação",
    ...props
  },
  ref,
) {
  const selectId = React.useId();

  const safePageSize = Math.max(1, pageSize);
  const safeTotal = Math.max(0, total);
  const pageCount = Math.max(1, Math.ceil(safeTotal / safePageSize));
  const currentPage = Math.min(Math.max(1, page), pageCount);

  const firstRecord = safeTotal === 0 ? 0 : (currentPage - 1) * safePageSize + 1;
  const lastRecord = Math.min(currentPage * safePageSize, safeTotal);

  const summary =
    safeTotal === 0
      ? "Nenhum registro"
      : `${formatCount(firstRecord)}–${formatCount(lastRecord)} de ${formatCount(safeTotal)}`;

  const items = React.useMemo(
    () => buildPageItems(currentPage, pageCount, Math.max(0, siblingCount)),
    [currentPage, pageCount, siblingCount],
  );

  const goTo = React.useCallback(
    (next: number) => {
      const clamped = Math.min(Math.max(1, next), pageCount);
      if (clamped !== currentPage) onPageChange(clamped);
    },
    [currentPage, onPageChange, pageCount],
  );

  const handlePageSizeChange = React.useCallback(
    (event: React.ChangeEvent<HTMLSelectElement>) => {
      onPageSizeChange?.(Number(event.target.value));
    },
    [onPageSizeChange],
  );

  const atStart = currentPage <= 1;
  const atEnd = currentPage >= pageCount;

  /**
   * Boundary controls are marked `aria-disabled` rather than `disabled`: the
   * last click on "Próxima página" lands on the last page and would otherwise
   * disable the very button holding focus, dropping the keyboard user back to
   * `<body>`. They stay focusable and `goTo` already clamps the no-op.
   * The `disabled` prop (a request in flight) still disables for real.
   */
  const boundaryClasses = "aria-disabled:pointer-events-none aria-disabled:opacity-55";

  return (
    <nav
      ref={ref}
      aria-label={label}
      className={cn(
        "flex min-h-9 w-full flex-wrap items-center justify-between gap-x-4 gap-y-2 text-body-sm text-fg-secondary",
        className,
      )}
      {...props}
    >
      <p className="text-caption text-fg-muted tabular-nums" aria-live="polite">
        {summary}
      </p>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        {onPageSizeChange ? (
          <div className="flex items-center gap-2">
            <label htmlFor={selectId} className="text-caption whitespace-nowrap text-fg-muted">
              Itens por página
            </label>
            <select
              id={selectId}
              value={safePageSize}
              onChange={handlePageSizeChange}
              disabled={disabled}
              // Shares the field layer's chrome so the selector matches every
              // other control (focus, invalid and disabled treatment included).
              className={cn(inputVariants({ size: "sm" }), "w-auto tabular-nums")}
            >
              {pageSizeOptions.map((option) => (
                <option key={option} value={option}>
                  {formatCount(option)}
                </option>
              ))}
            </select>
          </div>
        ) : null}

        <div className="flex items-center gap-0.5">
          <IconButton
            label="Primeira página"
            size="sm"
            variant="ghost"
            disabled={disabled}
            aria-disabled={atStart || undefined}
            className={boundaryClasses}
            onClick={() => goTo(1)}
          >
            <ChevronsLeft aria-hidden />
          </IconButton>
          <IconButton
            label="Página anterior"
            size="sm"
            variant="ghost"
            disabled={disabled}
            aria-disabled={atStart || undefined}
            className={boundaryClasses}
            onClick={() => goTo(currentPage - 1)}
          >
            <ChevronLeft aria-hidden />
          </IconButton>

          <span className="px-2 text-caption whitespace-nowrap text-fg-secondary tabular-nums sm:hidden">
            {formatCount(currentPage)} / {formatCount(pageCount)}
          </span>

          <ol className="hidden items-center gap-0.5 sm:flex">
            {items.map((item, index) =>
              item === "ellipsis" ? (
                <li
                  key={`ellipsis-${index}`}
                  aria-hidden
                  className="flex h-(--control-height-sm) w-6 items-center justify-center text-caption text-fg-muted"
                >
                  …
                </li>
              ) : (
                <li key={item}>
                  <Button
                    size="sm"
                    variant={item === currentPage ? "secondary" : "ghost"}
                    aria-label={`Página ${formatCount(item)}`}
                    aria-current={item === currentPage ? "page" : undefined}
                    disabled={disabled}
                    onClick={() => goTo(item)}
                    className={cn(
                      "min-w-(--control-height-sm) px-2 tabular-nums",
                      item === currentPage && "font-semibold",
                    )}
                  >
                    {formatCount(item)}
                  </Button>
                </li>
              ),
            )}
          </ol>

          <IconButton
            label="Próxima página"
            size="sm"
            variant="ghost"
            disabled={disabled}
            aria-disabled={atEnd || undefined}
            className={boundaryClasses}
            onClick={() => goTo(currentPage + 1)}
          >
            <ChevronRight aria-hidden />
          </IconButton>
          <IconButton
            label="Última página"
            size="sm"
            variant="ghost"
            disabled={disabled}
            aria-disabled={atEnd || undefined}
            className={boundaryClasses}
            onClick={() => goTo(pageCount)}
          >
            <ChevronsRight aria-hidden />
          </IconButton>
        </div>
      </div>
    </nav>
  );
});
