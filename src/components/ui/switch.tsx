"use client";

import * as React from "react";
import * as SwitchPrimitive from "@radix-ui/react-switch";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/cn";

/**
 * Switch — immediate, self-saving toggle (never use it inside a form that needs
 * an explicit submit; use `Checkbox` there).
 */
export const switchVariants = cva(
  [
    "group/switch inline-flex shrink-0 items-center rounded-full border border-border bg-surface-tertiary p-0.5",
    "outline-none hfm-transition",
    "focus-visible:border-border-focus focus-visible:shadow-focus",
    "data-[state=checked]:border-primary data-[state=checked]:bg-primary",
    "disabled:cursor-not-allowed disabled:opacity-55",
  ],
  {
    variants: {
      size: {
        sm: "h-4 w-7",
        md: "h-5 w-9",
      },
    },
    defaultVariants: { size: "md" },
  },
);

const thumbVariants = cva(
  "pointer-events-none block rounded-full bg-primary-fg shadow-xs hfm-transition will-change-transform",
  {
    variants: {
      size: {
        sm: "size-2.5 data-[state=checked]:translate-x-3",
        md: "size-3.5 data-[state=checked]:translate-x-4",
      },
    },
    defaultVariants: { size: "md" },
  },
);

export type SwitchSize = NonNullable<VariantProps<typeof switchVariants>["size"]>;

export interface SwitchProps
  extends React.ComponentPropsWithoutRef<typeof SwitchPrimitive.Root>,
    VariantProps<typeof switchVariants> {}

export const Switch = React.forwardRef<React.ComponentRef<typeof SwitchPrimitive.Root>, SwitchProps>(
  function Switch({ className, size = "md", ...props }, ref) {
    return (
      <SwitchPrimitive.Root ref={ref} className={cn(switchVariants({ size }), className)} {...props}>
        <SwitchPrimitive.Thumb className={thumbVariants({ size })} />
      </SwitchPrimitive.Root>
    );
  },
);

/* -------------------------------------------------------------------------- */

export interface SwitchFieldProps extends Omit<SwitchProps, "children"> {
  /** Visible label, associated with the control. */
  label: React.ReactNode;
  /** Optional supporting line, wired through `aria-describedby`. */
  description?: React.ReactNode;
  /** Class names for the clickable row. */
  className?: string;
  /** Class names for the switch itself. */
  switchClassName?: string;
}

/** SwitchField — label (+ description) on the left, control on the right. */
export const SwitchField = React.forwardRef<
  React.ComponentRef<typeof SwitchPrimitive.Root>,
  SwitchFieldProps
>(function SwitchField(
  { label, description, className, switchClassName, id, disabled, size = "md", "aria-describedby": describedBy, ...props },
  ref,
) {
  const generatedId = React.useId();
  const controlId = id ?? `switch-${generatedId}`;
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
        "flex min-h-(--control-height-md) items-start justify-between gap-4 rounded-sm px-1.5 py-2 hfm-transition",
        disabled ? "cursor-not-allowed" : "cursor-pointer hover:bg-hover-overlay",
        className,
      )}
      onClick={handleRowClick}
    >
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
      <Switch
        ref={setRefs}
        id={controlId}
        size={size}
        disabled={disabled}
        aria-describedby={[describedBy, descriptionId].filter(Boolean).join(" ") || undefined}
        className={cn("mt-0.5", switchClassName)}
        {...props}
      />
    </div>
  );
});
