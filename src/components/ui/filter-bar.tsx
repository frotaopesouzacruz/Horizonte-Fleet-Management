"use client";

import * as React from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";

/**
 * FilterBar — dense toolbar above a table: search, selects and active filter
 * chips on the left, secondary actions (density, columns, export) on the right.
 * It is a layout shell only; the controls themselves stay the caller's.
 */

export interface FilterBarProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Leading slot — search field, primary selects. */
  start?: React.ReactNode;
  /** Trailing slot, pushed to the right — column/density/export controls. */
  end?: React.ReactNode;
  /** Accessible name of the filter region. */
  label?: string;
}

export const FilterBar = React.forwardRef<HTMLDivElement, FilterBarProps>(function FilterBar(
  { className, start, end, label = "Filtros", children, ...props },
  ref,
) {
  return (
    <div
      ref={ref}
      role="group"
      aria-label={label}
      className={cn("flex flex-wrap items-center gap-2 py-2", className)}
      {...props}
    >
      {start}
      {children}
      {end ? <div className="ml-auto flex flex-wrap items-center gap-2">{end}</div> : null}
    </div>
  );
});

/* -------------------------------------------------------------------------- */

export interface FilterGroupProps extends Omit<React.HTMLAttributes<HTMLDivElement>, "onChange"> {
  /** Short label shown before the control, e.g. "Unidade". */
  label: React.ReactNode;
  /**
   * `id` of the control this label describes. When omitted the label wraps the
   * control instead, which keeps the pair accessible either way.
   */
  htmlFor?: string;
}

/** FilterGroup — inline "label + control" pair for a dense toolbar. */
export const FilterGroup = React.forwardRef<HTMLDivElement, FilterGroupProps>(function FilterGroup(
  { className, label, htmlFor, children, ...props },
  ref,
) {
  const labelClasses = "shrink-0 text-caption font-medium whitespace-nowrap text-fg-secondary";

  if (!htmlFor) {
    return (
      <div ref={ref} className={cn("inline-flex items-center", className)} {...props}>
        <label className="inline-flex items-center gap-2">
          <span className={labelClasses}>{label}</span>
          {children}
        </label>
      </div>
    );
  }

  return (
    <div ref={ref} className={cn("inline-flex items-center gap-2", className)} {...props}>
      <label htmlFor={htmlFor} className={labelClasses}>
        {label}
      </label>
      {children}
    </div>
  );
});

/* -------------------------------------------------------------------------- */

export interface FilterChipProps extends Omit<React.HTMLAttributes<HTMLSpanElement>, "onChange"> {
  /** Filter name, e.g. "Unidade". Rendered muted before the value. */
  label?: React.ReactNode;
  /** Applied value, e.g. "São Paulo". Ignored when `children` is given. */
  value?: React.ReactNode;
  /** When provided, a remove button is rendered. */
  onRemove?: () => void;
  /**
   * Plain-text description used in the remove button's accessible name.
   * Defaults to `"<label>: <value>"` when both are strings.
   */
  removeLabel?: string;
  disabled?: boolean;
}

/**
 * FilterChip — one applied filter, e.g. "Unidade: São Paulo" with an X to drop
 * it. Chips are read-only summaries; editing happens in the control itself.
 */
export const FilterChip = React.forwardRef<HTMLSpanElement, FilterChipProps>(function FilterChip(
  { className, label, value, onRemove, removeLabel, disabled = false, children, ...props },
  ref,
) {
  const described =
    removeLabel ??
    [typeof label === "string" ? label : null, typeof value === "string" ? value : null]
      .filter(Boolean)
      .join(": ");

  return (
    <span
      ref={ref}
      data-disabled={disabled || undefined}
      className={cn(
        "inline-flex h-7 max-w-full shrink-0 items-center gap-1.5 rounded-xs border border-border",
        "bg-surface-secondary pl-2 text-caption text-fg-secondary",
        onRemove ? "pr-1" : "pr-2",
        disabled && "opacity-55",
        className,
      )}
      {...props}
    >
      <span className="min-w-0 truncate">
        {label != null ? <span className="text-fg-muted">{label}: </span> : null}
        {children ?? <span className="font-medium text-fg">{value}</span>}
      </span>
      {onRemove ? (
        <button
          type="button"
          onClick={onRemove}
          disabled={disabled}
          aria-label={described ? `Remover filtro ${described}` : "Remover filtro"}
          title={described ? `Remover filtro ${described}` : "Remover filtro"}
          className={cn(
            "inline-flex size-5 shrink-0 items-center justify-center rounded-xs text-fg-muted",
            "hfm-transition hfm-focus-ring hover:bg-secondary-hover hover:text-fg",
            "disabled:pointer-events-none disabled:opacity-55",
          )}
        >
          <X className="size-3.5" aria-hidden />
        </button>
      ) : null}
    </span>
  );
});

/* -------------------------------------------------------------------------- */

export interface FilterBarClearProps extends Omit<React.ComponentPropsWithoutRef<typeof Button>, "children"> {
  onClear: () => void;
  /**
   * Number of active filters. When it is `0` the control renders nothing, so the
   * toolbar only offers "Limpar filtros" when there is something to clear.
   */
  count?: number;
  children?: React.ReactNode;
}

export const FilterBarClear = React.forwardRef<HTMLButtonElement, FilterBarClearProps>(function FilterBarClear(
  { className, onClear, count, children = "Limpar filtros", onClick, ...props },
  ref,
) {
  if (count !== undefined && count <= 0) return null;

  // `onClear` is the component's contract, so it runs even when the caller also
  // passes an `onClick` — spreading props over it would have silently dropped it.
  const handleClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    onClick?.(event);
    if (event.defaultPrevented) return;
    onClear();
  };

  return (
    <Button
      ref={ref}
      type="button"
      variant="ghost"
      size="sm"
      className={cn("shrink-0", className)}
      {...props}
      onClick={handleClick}
    >
      {children}
      {count !== undefined ? <span className="tabular-nums">({count})</span> : null}
    </Button>
  );
});
