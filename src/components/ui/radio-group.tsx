"use client";

import * as React from "react";
import * as RadioGroupPrimitive from "@radix-ui/react-radio-group";
import { cn } from "@/lib/cn";
import { useOptionalFormField } from "@/components/ui/form-field";

/**
 * RadioGroup — vertical by default; pass `orientation="horizontal"` for inline
 * sets. The group renders a `role="radiogroup"` element, which a label's
 * `htmlFor` cannot name, so inside a `FormField` it points `aria-labelledby` at
 * the field label instead.
 */
export const RadioGroup = React.forwardRef<
  React.ComponentRef<typeof RadioGroupPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof RadioGroupPrimitive.Root>
>(function RadioGroup(
  {
    className,
    orientation = "vertical",
    "aria-label": ariaLabel,
    "aria-labelledby": ariaLabelledBy,
    ...props
  },
  ref,
) {
  const field = useOptionalFormField();

  return (
    <RadioGroupPrimitive.Root
      ref={ref}
      orientation={orientation}
      aria-label={ariaLabel}
      aria-labelledby={ariaLabelledBy ?? (ariaLabel ? undefined : field?.labelId)}
      className={cn("flex gap-2", orientation === "horizontal" ? "flex-row flex-wrap gap-4" : "flex-col", className)}
      {...props}
    />
  );
});

/** RadioGroupItem — 16px circle with a primary dot when selected. */
export const RadioGroupItem = React.forwardRef<
  React.ComponentRef<typeof RadioGroupPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof RadioGroupPrimitive.Item>
>(function RadioGroupItem({ className, ...props }, ref) {
  return (
    <RadioGroupPrimitive.Item
      ref={ref}
      className={cn(
        "group/radio size-4 shrink-0 rounded-full border border-input-border bg-input outline-none hfm-transition",
        "focus-visible:border-border-focus focus-visible:shadow-focus",
        "data-[state=checked]:border-primary",
        "aria-invalid:border-danger aria-invalid:focus-visible:border-danger",
        "aria-invalid:focus-visible:shadow-none aria-invalid:focus-visible:ring-3 aria-invalid:focus-visible:ring-danger/35",
        "disabled:cursor-not-allowed disabled:border-border disabled:bg-surface-tertiary",
        // Beats `data-[state=checked]:border-primary`, which has the same
        // specificity, so a disabled selected radio still reads as disabled.
        "data-[state=checked]:disabled:border-border",
        className,
      )}
      {...props}
    >
      <RadioGroupPrimitive.Indicator className="flex size-full items-center justify-center">
        <span className="block size-2 rounded-full bg-primary group-disabled/radio:bg-fg-disabled" />
      </RadioGroupPrimitive.Indicator>
    </RadioGroupPrimitive.Item>
  );
});

/* -------------------------------------------------------------------------- */

export interface RadioFieldProps
  extends Omit<React.ComponentPropsWithoutRef<typeof RadioGroupPrimitive.Item>, "children"> {
  /** Visible label, associated with the control. */
  label: React.ReactNode;
  /** Optional supporting line, wired through `aria-describedby`. */
  description?: React.ReactNode;
  /** Class names for the clickable row. */
  className?: string;
  /** Class names for the radio itself. */
  radioClassName?: string;
}

/** RadioField — radio + label (+ description) as one dense, clickable row. */
export const RadioField = React.forwardRef<
  React.ComponentRef<typeof RadioGroupPrimitive.Item>,
  RadioFieldProps
>(function RadioField(
  { label, description, className, radioClassName, id, disabled, value, "aria-describedby": describedBy, ...props },
  ref,
) {
  const generatedId = React.useId();
  const controlId = id ?? `radio-${generatedId}`;
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
      <RadioGroupItem
        ref={setRefs}
        id={controlId}
        value={value}
        disabled={disabled}
        aria-describedby={[describedBy, descriptionId].filter(Boolean).join(" ") || undefined}
        className={cn("mt-0.5", radioClassName)}
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
