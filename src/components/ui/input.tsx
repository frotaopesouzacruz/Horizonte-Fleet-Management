"use client";

import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/cn";

/**
 * Shared chrome of every text-like form control (input, textarea, select
 * trigger, date input). Keeps border, background, focus and state styling in a
 * single place so the whole form layer stays visually identical.
 *
 * The invalid state is driven exclusively by `aria-invalid="true"` so it works
 * for native controls, Radix triggers and anything wired by `FormField`.
 */
export const fieldControlClasses = [
  "w-full min-w-0 rounded-sm border border-input-border bg-input text-fg outline-none hfm-transition",
  "placeholder:text-input-placeholder",
  "focus-visible:border-border-focus focus-visible:shadow-focus",
  "aria-invalid:border-danger",
  "aria-invalid:focus-visible:border-danger aria-invalid:focus-visible:shadow-none",
  "aria-invalid:focus-visible:ring-3 aria-invalid:focus-visible:ring-danger/35",
  "disabled:cursor-not-allowed disabled:border-border disabled:bg-surface-tertiary disabled:text-fg-disabled",
  "disabled:placeholder:text-fg-disabled",
].join(" ");

export const inputVariants = cva(fieldControlClasses, {
  variants: {
    size: {
      sm: "h-(--control-height-sm) px-2.5 text-body-sm",
      md: "h-(--control-height-md) px-3 text-body",
      lg: "h-(--control-height-lg) px-3.5 text-body",
    },
  },
  defaultVariants: { size: "md" },
});

export type InputSize = NonNullable<VariantProps<typeof inputVariants>["size"]>;

/** Horizontal padding reserved for an icon rendered inside the control. */
const iconInset: Record<InputSize, { leading: string; trailing: string; left: string; right: string }> = {
  sm: { leading: "pl-8", trailing: "pr-8", left: "left-2.5", right: "right-2.5" },
  md: { leading: "pl-9", trailing: "pr-9", left: "left-3", right: "right-3" },
  lg: { leading: "pl-10", trailing: "pr-10", left: "left-3.5", right: "right-3.5" },
};

const addonSize: Record<InputSize, string> = {
  sm: "h-(--control-height-sm) px-2.5 text-body-sm",
  md: "h-(--control-height-md) px-3 text-body-sm",
  lg: "h-(--control-height-lg) px-3.5 text-body-sm",
};

const addonBase =
  "inline-flex shrink-0 items-center whitespace-nowrap border border-input-border bg-surface-secondary text-fg-muted";

/** Absolute icon slot inside a control. Exported shape is intentionally internal. */
function FieldIcon({ side, size, children }: { side: "leading" | "trailing"; size: InputSize; children: React.ReactNode }) {
  const inset = iconInset[size];
  return (
    <span
      className={cn(
        "pointer-events-none absolute top-1/2 flex -translate-y-1/2 items-center text-fg-muted",
        "[&_svg]:size-4 [&_svg]:shrink-0",
        side === "leading" ? inset.left : inset.right,
      )}
      aria-hidden
    >
      {children}
    </span>
  );
}

export interface InputProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "size">,
    VariantProps<typeof inputVariants> {
  /** Decorative icon rendered inside the control, before the text. */
  leadingIcon?: React.ReactNode;
  /** Decorative icon rendered inside the control, after the text. */
  trailingIcon?: React.ReactNode;
  /** Short attached text before the control, e.g. "R$". */
  leadingAddon?: React.ReactNode;
  /** Short attached text after the control, e.g. "km". */
  trailingAddon?: React.ReactNode;
  /** Class names for the wrapper rendered when icons or addons are present. */
  wrapperClassName?: string;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(function Input(
  {
    className,
    wrapperClassName,
    size = "md",
    type = "text",
    leadingIcon,
    trailingIcon,
    leadingAddon,
    trailingAddon,
    disabled,
    ...props
  },
  ref,
) {
  const resolvedSize: InputSize = size ?? "md";
  const inset = iconInset[resolvedSize];
  const hasAffix = Boolean(leadingIcon || trailingIcon || leadingAddon || trailingAddon);

  const control = (
    <input
      ref={ref}
      type={type}
      disabled={disabled}
      className={cn(
        inputVariants({ size: resolvedSize }),
        leadingIcon && inset.leading,
        trailingIcon && inset.trailing,
        leadingAddon && "rounded-l-none",
        trailingAddon && "rounded-r-none",
        className,
      )}
      {...props}
    />
  );

  if (!hasAffix) return control;

  return (
    <div className={cn("relative flex w-full items-stretch", disabled && "cursor-not-allowed", wrapperClassName)}>
      {leadingAddon ? (
        <span className={cn(addonBase, addonSize[resolvedSize], "-mr-px rounded-l-sm", disabled && "text-fg-disabled")}>
          {leadingAddon}
        </span>
      ) : null}

      {/* `focus-within:z-10` keeps the focus ring above an attached addon,
          which would otherwise paint over it. */}
      <span className="relative flex min-w-0 flex-1 items-center focus-within:z-10">
        {leadingIcon ? (
          <FieldIcon side="leading" size={resolvedSize}>
            {leadingIcon}
          </FieldIcon>
        ) : null}
        {control}
        {trailingIcon ? (
          <FieldIcon side="trailing" size={resolvedSize}>
            {trailingIcon}
          </FieldIcon>
        ) : null}
      </span>

      {trailingAddon ? (
        <span className={cn(addonBase, addonSize[resolvedSize], "-ml-px rounded-r-sm", disabled && "text-fg-disabled")}>
          {trailingAddon}
        </span>
      ) : null}
    </div>
  );
});
