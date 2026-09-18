"use client";

import * as React from "react";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import { cn } from "@/lib/cn";

/**
 * Table — dense data-table primitives for operational lists (vehicles, drivers,
 * orders, maintenance). Composition mirrors the HTML table structure so that
 * semantics, keyboard order and screen-reader announcements stay native:
 *
 * ```tsx
 * <TableContainer stickyHeader maxHeight={480}>
 *   <Table>
 *     <TableHeader>
 *       <TableRow>
 *         <TableHead sortable sortDirection={dir} onSort={setDir}>Placa</TableHead>
 *         <TableHead numeric>Km</TableHead>
 *       </TableRow>
 *     </TableHeader>
 *     {loading ? <TableLoading cols={2} /> : <TableBody>…</TableBody>}
 *   </Table>
 * </TableContainer>
 * ```
 */

export type TableAlign = "left" | "center" | "right";
export type TableSortDirection = "asc" | "desc";

const alignClasses: Record<TableAlign, string> = {
  left: "text-left",
  center: "text-center",
  right: "text-right",
};

type TableContextValue = { stickyHeader: boolean };

const TableContext = React.createContext<TableContextValue>({ stickyHeader: false });

/* -------------------------------------------------------------------------- */

export interface TableContainerProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Keeps the header row pinned while the body scrolls. Also sets the default for `TableHeader`. */
  stickyHeader?: boolean;
  /** Caps the scroll area. A number is interpreted as pixels. */
  maxHeight?: number | string;
}

/**
 * TableContainer — bordered, scrollable frame around a `Table`. It owns the
 * radius and the overflow so the table itself stays a plain `<table>`.
 */
export const TableContainer = React.forwardRef<HTMLDivElement, TableContainerProps>(function TableContainer(
  { className, stickyHeader = false, maxHeight, style, children, ...props },
  ref,
) {
  const context = React.useMemo<TableContextValue>(() => ({ stickyHeader }), [stickyHeader]);
  const resolvedMaxHeight = typeof maxHeight === "number" ? `${maxHeight}px` : maxHeight;

  return (
    <TableContext.Provider value={context}>
      <div
        ref={ref}
        className={cn("relative w-full overflow-auto rounded-md border border-border bg-surface", className)}
        style={resolvedMaxHeight ? { ...style, maxHeight: resolvedMaxHeight } : style}
        {...props}
      >
        {children}
      </div>
    </TableContext.Provider>
  );
});

/* -------------------------------------------------------------------------- */

export interface TableProps extends React.TableHTMLAttributes<HTMLTableElement> {
  /** `fixed` makes column widths predictable and enables reliable cell truncation. */
  layout?: "auto" | "fixed";
}

export const Table = React.forwardRef<HTMLTableElement, TableProps>(function Table(
  { className, layout = "auto", ...props },
  ref,
) {
  return (
    <table
      ref={ref}
      className={cn(
        "w-full caption-bottom border-collapse text-body-sm text-fg",
        layout === "fixed" ? "table-fixed" : "table-auto",
        className,
      )}
      {...props}
    />
  );
});

/* -------------------------------------------------------------------------- */

export interface TableHeaderProps extends React.HTMLAttributes<HTMLTableSectionElement> {
  /** Pins the header cells. Defaults to the `stickyHeader` of the surrounding `TableContainer`. */
  sticky?: boolean;
}

export const TableHeader = React.forwardRef<HTMLTableSectionElement, TableHeaderProps>(function TableHeader(
  { className, sticky, ...props },
  ref,
) {
  const { stickyHeader } = React.useContext(TableContext);
  const isSticky = sticky ?? stickyHeader;

  return (
    <thead
      ref={ref}
      data-sticky={isSticky || undefined}
      className={cn(
        "bg-surface-secondary text-caption font-semibold text-fg-secondary",
        "[&_tr]:h-(--table-header-height) [&_tr]:border-b [&_tr]:border-border [&_tr:hover]:bg-transparent",
        isSticky && [
          // `relative` used to be added here to anchor the ::after rule below.
          // It cancelled the `sticky` on the same selector — tailwind-merge keeps
          // the last position utility — so the sticky header silently never
          // stuck. `sticky` is itself a positioned value and anchors ::after
          // perfectly well, so the fix is to stop asking for both.
          "[&_th]:sticky [&_th]:top-0 [&_th]:z-10 [&_th]:bg-surface-secondary",
          // The row border does not travel with sticky cells — redraw it per cell.
          "[&_tr]:border-b-0",
          "[&_th]:after:absolute [&_th]:after:inset-x-0 [&_th]:after:bottom-0 [&_th]:after:h-px [&_th]:after:bg-border",
        ],
        className,
      )}
      {...props}
    />
  );
});

export const TableBody = React.forwardRef<HTMLTableSectionElement, React.HTMLAttributes<HTMLTableSectionElement>>(
  function TableBody({ className, ...props }, ref) {
    return (
      <tbody
        ref={ref}
        className={cn("[&>tr]:bg-surface [&_tr:last-child]:border-0", className)}
        {...props}
      />
    );
  },
);

export const TableFooter = React.forwardRef<HTMLTableSectionElement, React.HTMLAttributes<HTMLTableSectionElement>>(
  function TableFooter({ className, ...props }, ref) {
    return (
      <tfoot
        ref={ref}
        className={cn(
          "border-t border-border bg-surface-secondary text-caption font-medium text-fg-secondary",
          "[&_tr]:h-9 [&_tr]:border-0 [&_tr:hover]:bg-transparent",
          className,
        )}
        {...props}
      />
    );
  },
);

/* -------------------------------------------------------------------------- */

export interface TableRowProps extends React.HTMLAttributes<HTMLTableRowElement> {
  /** Marks the row as selected (drives `data-state` and `aria-selected`). */
  selected?: boolean;
}

export const TableRow = React.forwardRef<HTMLTableRowElement, TableRowProps>(function TableRow(
  { className, selected, ...props },
  ref,
) {
  return (
    <tr
      ref={ref}
      data-state={selected ? "selected" : undefined}
      aria-selected={selected}
      className={cn(
        "h-10 border-b border-border-subtle hfm-transition",
        "hover:bg-hover-overlay data-[state=selected]:bg-selected-overlay",
        className,
      )}
      {...props}
    />
  );
});

/* -------------------------------------------------------------------------- */

export interface TableHeadProps extends Omit<React.ThHTMLAttributes<HTMLTableCellElement>, "align"> {
  /** Turns the label into a sort toggle and exposes `aria-sort`. */
  sortable?: boolean;
  /** Current sort of this column. `null` means the column is sortable but not sorted. */
  sortDirection?: TableSortDirection | null;
  /** Called with the direction to apply next. */
  onSort?: (direction: TableSortDirection) => void;
  align?: TableAlign;
  /** Numeric column: right-aligned with tabular figures. */
  numeric?: boolean;
}

export const TableHead = React.forwardRef<HTMLTableCellElement, TableHeadProps>(function TableHead(
  { className, sortable = false, sortDirection = null, onSort, align, numeric = false, children, ...props },
  ref,
) {
  const resolvedAlign = align ?? (numeric ? "right" : "left");
  const SortIcon = sortDirection === "asc" ? ArrowUp : sortDirection === "desc" ? ArrowDown : ArrowUpDown;

  const handleSort = React.useCallback(() => {
    onSort?.(sortDirection === "asc" ? "desc" : "asc");
  }, [onSort, sortDirection]);

  return (
    <th
      ref={ref}
      scope={props.scope ?? "col"}
      aria-sort={
        sortable
          ? sortDirection === "asc"
            ? "ascending"
            : sortDirection === "desc"
              ? "descending"
              : "none"
          : undefined
      }
      className={cn(
        "px-3 align-middle font-semibold whitespace-nowrap",
        alignClasses[resolvedAlign],
        numeric && "tabular-nums",
        className,
      )}
      {...props}
    >
      {sortable ? (
        <button
          type="button"
          onClick={handleSort}
          data-sorted={sortDirection ?? undefined}
          className={cn(
            "-mx-1.5 inline-flex h-7 max-w-full items-center gap-1 rounded-xs px-1.5",
            "font-semibold hfm-transition hfm-focus-ring hover:text-fg",
            resolvedAlign === "right" && "flex-row-reverse",
            resolvedAlign === "center" && "justify-center",
          )}
        >
          <span className="truncate">{children}</span>
          <SortIcon className={cn("size-3.5 shrink-0", sortDirection ? "text-fg" : "text-fg-muted")} aria-hidden />
        </button>
      ) : (
        children
      )}
    </th>
  );
});

/* -------------------------------------------------------------------------- */

export interface TableCellProps extends Omit<React.TdHTMLAttributes<HTMLTableCellElement>, "align"> {
  align?: TableAlign;
  /** Numeric cell: right-aligned with tabular figures. */
  numeric?: boolean;
  /** Clips overflowing text with an ellipsis. Pair with `Table layout="fixed"` or a column width. */
  truncate?: boolean;
}

export const TableCell = React.forwardRef<HTMLTableCellElement, TableCellProps>(function TableCell(
  { className, align, numeric = false, truncate = false, ...props },
  ref,
) {
  const resolvedAlign = align ?? (numeric ? "right" : "left");
  return (
    <td
      ref={ref}
      className={cn(
        "px-3 align-middle",
        alignClasses[resolvedAlign],
        numeric && "tabular-nums",
        truncate && "truncate",
        className,
      )}
      {...props}
    />
  );
});

/**
 * TableActionCell — trailing cell for a row menu or inline actions. Shrinks to
 * its content so the data columns keep the available width.
 */
export const TableActionCell = React.forwardRef<
  HTMLTableCellElement,
  Omit<React.TdHTMLAttributes<HTMLTableCellElement>, "align">
>(function TableActionCell({ className, children, ...props }, ref) {
  return (
    <td ref={ref} className={cn("w-px px-2 align-middle whitespace-nowrap", className)} {...props}>
      <div className="flex items-center justify-end gap-0.5">{children}</div>
    </td>
  );
});

export const TableCaption = React.forwardRef<
  HTMLTableCaptionElement,
  React.HTMLAttributes<HTMLTableCaptionElement>
>(function TableCaption({ className, ...props }, ref) {
  return <caption ref={ref} className={cn("px-3 py-2 text-left text-caption text-fg-muted", className)} {...props} />;
});

/* -------------------------------------------------------------------------- */

export interface TableEmptyProps extends Omit<React.HTMLAttributes<HTMLTableRowElement>, "children"> {
  /** Number of columns to span — must match the header. */
  colSpan: number;
  message?: React.ReactNode;
  /** Optional lucide icon shown above the message. */
  icon?: React.ReactNode;
  /** Optional call to action (e.g. "Limpar filtros"). */
  action?: React.ReactNode;
}

/** TableEmpty — single full-width row stating that the query returned nothing. */
export const TableEmpty = React.forwardRef<HTMLTableRowElement, TableEmptyProps>(function TableEmpty(
  { className, colSpan, message = "Nenhum registro encontrado.", icon, action, ...props },
  ref,
) {
  return (
    <tr ref={ref} className={cn("border-b-0 hover:bg-transparent", className)} {...props}>
      <td colSpan={colSpan} className="px-3 py-10 text-center align-middle">
        <div className="flex flex-col items-center justify-center gap-2 text-body-sm text-fg-muted">
          {icon ? (
            <span className="text-fg-muted [&_svg]:size-5" aria-hidden>
              {icon}
            </span>
          ) : null}
          <span>{message}</span>
          {action ? <div className="mt-1 flex items-center gap-2">{action}</div> : null}
        </div>
      </td>
    </tr>
  );
});

/* -------------------------------------------------------------------------- */

/** Deterministic widths — avoids a hydration mismatch and reads as real data. */
const SKELETON_WIDTHS = ["72%", "48%", "86%", "56%", "64%", "40%"] as const;

export interface TableLoadingProps extends Omit<React.HTMLAttributes<HTMLTableSectionElement>, "children"> {
  /** Number of placeholder rows. */
  rows?: number;
  /** Number of columns — must match the header. */
  cols: number;
  /** Announced while the data loads. */
  label?: string;
}

/**
 * TableLoading — renders a `<tbody>` of skeleton rows. Use it *instead of*
 * `TableBody` while the first page is loading.
 */
export const TableLoading = React.forwardRef<HTMLTableSectionElement, TableLoadingProps>(function TableLoading(
  { className, rows = 5, cols, label = "Carregando…", ...props },
  ref,
) {
  return (
    <tbody ref={ref} aria-busy className={cn("[&_tr:last-child]:border-0", className)} {...props}>
      {Array.from({ length: Math.max(1, rows) }, (_, rowIndex) => (
        <tr key={rowIndex} className="h-10 border-b border-border-subtle">
          {Array.from({ length: Math.max(1, cols) }, (_, colIndex) => (
            <td key={colIndex} className="px-3 align-middle">
              {rowIndex === 0 && colIndex === 0 ? (
                <span role="status" className="sr-only">
                  {label}
                </span>
              ) : null}
              <span
                className="hfm-skeleton block h-3"
                style={{ width: SKELETON_WIDTHS[(rowIndex + colIndex) % SKELETON_WIDTHS.length] }}
                aria-hidden
              />
            </td>
          ))}
        </tr>
      ))}
    </tbody>
  );
});
