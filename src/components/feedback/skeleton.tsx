"use client";

import * as React from "react";
import { cn } from "@/lib/cn";

/**
 * Skeleton — placeholder shapes shown while the first payload of a screen is
 * loading. They exist to keep the layout stable, not to entertain: the shapes
 * mirror the real content box for box.
 *
 * Accessibility contract: a *group* (`SkeletonText` and every preset) is the
 * live region — `role="status"` plus one visually hidden "Carregando…". Every
 * shape inside is `aria-hidden`, and nested groups detect that an ancestor
 * already announces the load, so a screen reader hears it exactly once.
 *
 * ```tsx
 * {loading ? <SkeletonCard lines={3} /> : <VehicleCard {...vehicle} />}
 * ```
 */

/** True when an ancestor `SkeletonGroup` already owns the live region. */
const SkeletonGroupContext = React.createContext(false);

const DEFAULT_LABEL = "Carregando…";

/* -------------------------------------------------------------------------- */

export type SkeletonProps = React.HTMLAttributes<HTMLDivElement>;

/**
 * Skeleton — the base shape. Always decorative; size it with `className`
 * (`h-3 w-40`, `h-(--control-height-md) w-full`, …).
 */
export const Skeleton = React.forwardRef<HTMLDivElement, SkeletonProps>(function Skeleton(
  { className, ...props },
  ref,
) {
  return <div ref={ref} aria-hidden className={cn("hfm-skeleton block h-4 w-full", className)} {...props} />;
});

/** SkeletonCircle — round placeholder for avatars and status dots. */
export const SkeletonCircle = React.forwardRef<HTMLDivElement, SkeletonProps>(function SkeletonCircle(
  { className, ...props },
  ref,
) {
  return <div ref={ref} aria-hidden className={cn("hfm-skeleton block size-9 shrink-0 rounded-full", className)} {...props} />;
});

/* -------------------------------------------------------------------------- */

export interface SkeletonGroupProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Announced once while the group is on screen. */
  label?: string;
}

/**
 * SkeletonGroup — wraps a set of shapes into a single announced loading block.
 * When nested inside another group it degrades to a plain `aria-hidden` box so
 * the "Carregando…" message is never repeated.
 */
export const SkeletonGroup = React.forwardRef<HTMLDivElement, SkeletonGroupProps>(function SkeletonGroup(
  { className, label = DEFAULT_LABEL, children, ...props },
  ref,
) {
  const isNested = React.useContext(SkeletonGroupContext);

  if (isNested) {
    return (
      <div ref={ref} aria-hidden className={className} {...props}>
        {children}
      </div>
    );
  }

  return (
    <SkeletonGroupContext.Provider value>
      <div ref={ref} role="status" aria-busy className={className} {...props}>
        <span className="sr-only">{label}</span>
        {children}
      </div>
    </SkeletonGroupContext.Provider>
  );
});

/* -------------------------------------------------------------------------- */

/** Deterministic widths — no randomness, so server and client markup match. */
const TEXT_LINE_WIDTHS = ["w-full", "w-11/12", "w-5/6", "w-full", "w-4/5", "w-11/12"] as const;

export interface SkeletonTextProps extends Omit<SkeletonGroupProps, "children"> {
  /** Number of placeholder lines. Defaults to 3. */
  lines?: number;
  /** Extra classes for every line (e.g. `h-4` for body text). */
  lineClassName?: string;
}

/**
 * SkeletonText — a paragraph of placeholder lines with varying widths; the last
 * line is short, the way real wrapped text ends.
 */
export const SkeletonText = React.forwardRef<HTMLDivElement, SkeletonTextProps>(function SkeletonText(
  { className, lines = 3, lineClassName, ...props },
  ref,
) {
  const count = Math.max(1, Math.trunc(lines));

  return (
    <SkeletonGroup ref={ref} className={cn("flex w-full flex-col gap-2", className)} {...props}>
      {Array.from({ length: count }, (_, index) => {
        const isLast = index === count - 1;
        return (
          <Skeleton
            key={index}
            className={cn(
              "h-3",
              isLast && count > 1 ? "w-1/2" : TEXT_LINE_WIDTHS[index % TEXT_LINE_WIDTHS.length],
              lineClassName,
            )}
          />
        );
      })}
    </SkeletonGroup>
  );
});

/* -------------------------------------------------------------------------- */

export interface SkeletonCardProps extends Omit<SkeletonGroupProps, "children"> {
  /** Body lines below the header. Defaults to 3. */
  lines?: number;
  /** Leading avatar placeholder in the header. */
  avatar?: boolean;
  /** Footer strip with two short action placeholders. */
  footer?: boolean;
}

/** SkeletonCard — placeholder for a bordered `Card`: header, body lines, footer. */
export const SkeletonCard = React.forwardRef<HTMLDivElement, SkeletonCardProps>(function SkeletonCard(
  { className, lines = 3, avatar = false, footer = false, ...props },
  ref,
) {
  return (
    <SkeletonGroup
      ref={ref}
      className={cn("flex w-full flex-col rounded-md border border-border bg-surface", className)}
      {...props}
    >
      <div className="flex items-start gap-3 p-4 pb-3">
        {avatar ? <SkeletonCircle /> : null}
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <Skeleton className="h-4 w-2/5" />
          <Skeleton className="h-3 w-1/4" />
        </div>
      </div>
      <div className="px-4 pb-4">
        <SkeletonText lines={lines} />
      </div>
      {footer ? (
        <div className="flex items-center gap-2 border-t border-border-subtle px-4 py-3">
          <Skeleton className="h-(--control-height-sm) w-24 rounded-sm" />
          <Skeleton className="h-(--control-height-sm) w-20 rounded-sm" />
        </div>
      ) : null}
    </SkeletonGroup>
  );
});

/* -------------------------------------------------------------------------- */

/** Deterministic cell widths so rows read as data instead of a striped block. */
const CELL_WIDTHS = ["72%", "48%", "86%", "56%", "64%", "40%"] as const;

export interface SkeletonTableRowsProps extends Omit<React.HTMLAttributes<HTMLTableSectionElement>, "children"> {
  /** Number of placeholder rows. Defaults to 5. */
  rows?: number;
  /** Number of columns — must match the header. */
  cols: number;
  /** Announced once while the rows are on screen. */
  label?: string;
}

/**
 * SkeletonTableRows — a `<tbody>` of placeholder rows. Render it *instead of*
 * `TableBody` while the first page loads, so the header and the column widths
 * stay put.
 */
export const SkeletonTableRows = React.forwardRef<HTMLTableSectionElement, SkeletonTableRowsProps>(
  function SkeletonTableRows({ className, rows = 5, cols, label = DEFAULT_LABEL, ...props }, ref) {
    const rowCount = Math.max(1, Math.trunc(rows));
    const colCount = Math.max(1, Math.trunc(cols));

    return (
      <tbody ref={ref} aria-busy className={cn("[&_tr:last-child]:border-0", className)} {...props}>
        {Array.from({ length: rowCount }, (_, rowIndex) => (
          <tr key={rowIndex} className="h-10 border-b border-border-subtle">
            {Array.from({ length: colCount }, (_, colIndex) => (
              <td key={colIndex} className="px-3 align-middle">
                {rowIndex === 0 && colIndex === 0 ? (
                  <span role="status" className="sr-only">
                    {label}
                  </span>
                ) : null}
                <span
                  aria-hidden
                  className="hfm-skeleton block h-3"
                  style={{ width: CELL_WIDTHS[(rowIndex + colIndex) % CELL_WIDTHS.length] }}
                />
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    );
  },
);

/* -------------------------------------------------------------------------- */

export type SkeletonKpiProps = Omit<SkeletonGroupProps, "children">;

/** SkeletonKpi — placeholder matching the `KpiCard` box: label, value, trend. */
export const SkeletonKpi = React.forwardRef<HTMLDivElement, SkeletonKpiProps>(function SkeletonKpi(
  { className, ...props },
  ref,
) {
  return (
    <SkeletonGroup
      ref={ref}
      className={cn("flex min-h-26 w-full flex-col gap-2 rounded-md border border-border bg-surface p-4", className)}
      {...props}
    >
      <Skeleton className="h-3 w-24" />
      <Skeleton className="h-6 w-28" />
      <Skeleton className="h-4 w-20 rounded-xs" />
    </SkeletonGroup>
  );
});

/* -------------------------------------------------------------------------- */

export interface SkeletonFormProps extends Omit<SkeletonGroupProps, "children"> {
  /** Number of placeholder fields. Defaults to 4. */
  fields?: number;
  /** Footer strip with two button placeholders. */
  actions?: boolean;
}

/** SkeletonForm — placeholder for a stack of labelled fields. */
export const SkeletonForm = React.forwardRef<HTMLDivElement, SkeletonFormProps>(function SkeletonForm(
  { className, fields = 4, actions = true, ...props },
  ref,
) {
  const count = Math.max(1, Math.trunc(fields));

  return (
    <SkeletonGroup ref={ref} className={cn("flex w-full flex-col gap-4", className)} {...props}>
      {Array.from({ length: count }, (_, index) => (
        <div key={index} className="flex flex-col gap-1.5">
          <Skeleton className="h-3 w-28" />
          <Skeleton className="h-(--control-height-md) w-full rounded-sm" />
        </div>
      ))}
      {actions ? (
        <div className="flex items-center gap-2 pt-1">
          <Skeleton className="h-(--control-height-md) w-28 rounded-sm" />
          <Skeleton className="h-(--control-height-md) w-24 rounded-sm" />
        </div>
      ) : null}
    </SkeletonGroup>
  );
});
