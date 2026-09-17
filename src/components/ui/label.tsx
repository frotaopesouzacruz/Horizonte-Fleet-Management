"use client";

import * as React from "react";
import * as LabelPrimitive from "@radix-ui/react-label";
import { cn } from "@/lib/cn";

/**
 * Label — the single field label of the product.
 * `required` adds a decorative asterisk (the requirement itself is announced by
 * the control's own `required`/`aria-required`), `hint` renders a discreet slot
 * on the right of the row (e.g. "Opcional", a character counter, a help link).
 */
export interface LabelProps extends React.ComponentPropsWithoutRef<typeof LabelPrimitive.Root> {
  /** Marks the field as required with an asterisk. */
  required?: boolean;
  /** Secondary content aligned to the right of the label row. */
  hint?: React.ReactNode;
}

export const Label = React.forwardRef<React.ComponentRef<typeof LabelPrimitive.Root>, LabelProps>(
  function Label({ className, required = false, hint, children, ...props }, ref) {
    const label = (
      <LabelPrimitive.Root
        ref={ref}
        className={cn(
          "inline-flex items-center gap-1 text-label font-medium text-fg-secondary select-none",
          className,
        )}
        {...props}
      >
        {children}
        {required ? (
          <span className="text-danger" aria-hidden>
            *
          </span>
        ) : null}
      </LabelPrimitive.Root>
    );

    if (!hint) return label;

    return (
      <span className="flex w-full items-center justify-between gap-3">
        {label}
        <span className="text-helper text-fg-muted">{hint}</span>
      </span>
    );
  },
);
