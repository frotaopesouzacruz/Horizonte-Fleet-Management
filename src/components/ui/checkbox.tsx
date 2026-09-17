"use client";

import * as React from "react";
import * as CheckboxPrimitive from "@radix-ui/react-checkbox";
import { Check, Minus } from "lucide-react";
import { cn } from "@/lib/cn";

/**
 * Checkbox — 16px control. `checked="indeterminate"` renders the minus glyph.
 * The invalid state is driven by `aria-invalid="true"`.
 */
export const Checkbox = React.forwardRef<
  React.ComponentRef<typeof CheckboxPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root>
>(function Checkbox({ className, ...props }, ref) {
  return (
    <CheckboxPrimitive.Root
      ref={ref}
      className={cn(
        "group/checkbox peer size-4 shrink-0 rounded-xs border border-input-border bg-input outline-none hfm-transition",
        "focus-visible:border-border-focus focus-visible:shadow-focus",
        "data-[state=checked]:border-primary data-[state=checked]:bg-primary data-[state=checked]:text-primary-fg",
        "data-[state=indeterminate]:border-primary data-[state=indeterminate]:bg-primary data-[state=indeterminate]:text-primary-fg",
        "aria-invalid:border-danger aria-invalid:focus-visible:border-danger",
        "aria-invalid:focus-visible:shadow-none aria-invalid:focus-visible:ring-3 aria-invalid:focus-visible:ring-danger/35",
        "disabled:cursor-not-allowed disabled:border-border disabled:bg-surface-tertiary disabled:text-fg-disabled",
        // These beat the `data-[state=...]` rules above, which carry the same
        // specificity, so a disabled checked/indeterminate box still reads as
        // disabled instead of keeping the primary fill.
        "data-[state=checked]:disabled:border-border data-[state=checked]:disabled:bg-surface-tertiary",
        "data-[state=indeterminate]:disabled:border-border data-[state=indeterminate]:disabled:bg-surface-tertiary",
        "data-[state=checked]:disabled:text-fg-disabled data-[state=indeterminate]:disabled:text-fg-disabled",
        className,
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator className="flex items-center justify-center text-current">
        <Check className="size-3.5 group-data-[state=indeterminate]/checkbox:hidden" aria-hidden />
        <Minus className="hidden size-3.5 group-data-[state=indeterminate]/checkbox:block" aria-hidden />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
});

/* -------------------------------------------------------------------------- */

export interface CheckboxFieldProps
  extends Omit<React.ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root>, "children"> {
  /** Visible label, associated with the control. */
  label: React.ReactNode;
  /** Optional supporting line, wired through `aria-describedby`. */
  description?: React.ReactNode;
  /** Class names for the clickable row. */
  className?: string;
  /** Class names for the checkbox itself. */
  checkboxClassName?: string;
}

/** CheckboxField — checkbox + label (+ description) as one dense, clickable row. */
export const CheckboxField = React.forwardRef<
  React.ComponentRef<typeof CheckboxPrimitive.Root>,
  CheckboxFieldProps
>(function CheckboxField(
  { label, description, className, checkboxClassName, id, disabled, "aria-describedby": describedBy, ...props },
  ref,
) {
  const generatedId = React.useId();
  const controlId = id ?? `checkbox-${generatedId}`;
  const descriptionId = description ? `${controlId}-description` : undefined;
  const controlRef = React.useRef<HTMLButtonElement | null>(null);

  const setRefs = React.useCallback(
    (node: HTMLButtonElement | null) => {
      controlRef.current = node;
      if (typeof ref === "function") ref(node);
      else if (ref) ref.current = node;
    },
    [ref],
  );

  function handleRowClick(event: React.MouseEvent<HTMLDivElement>) {
    if (disabled) return;
    const target = event.target as HTMLElement;
    if (target.closest("a, button, input, label, [role='button']")) return;
    controlRef.current?.click();
  }

  return (
    <div
      className={cn(
        "flex min-h-(--control-height-md) items-start gap-2.5 rounded-sm px-1.5 py-2 hfm-transition",
        disabled ? "cursor-not-allowed" : "cursor-pointer hover:bg-hover-overlay",
        className,
      )}
      onClick={handleRowClick}
    >
      <Checkbox
        ref={setRefs}
        id={controlId}
        disabled={disabled}
        aria-describedby={[describedBy, descriptionId].filter(Boolean).join(" ") || undefined}
        className={cn("mt-0.5", checkboxClassName)}
        {...props}
      />
      <div className="grid min-w-0 gap-0.5">
        <label
          htmlFor={controlId}
          className={cn(
            "text-body font-medium select-none",
            disabled ? "cursor-not-allowed text-fg-disabled" : "cursor-pointer text-fg",
          )}
        >
          {label}
        </label>
        {description ? (
          <span id={descriptionId} className={cn("text-helper", disabled ? "text-fg-disabled" : "text-fg-muted")}>
            {description}
          </span>
        ) : null}
      </div>
    </div>
  );
});
