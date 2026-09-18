"use client";

import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/cn";

/**
 * Button — the single button of the product. Hierarchy:
 * primary (Horizonte blue) › secondary › outline › ghost › danger.
 *
 * `highlight` (Horizonte gold) is the exception, and stays one: it is reserved
 * for the single decisive action of an institutional surface — the login
 * screen's "Entrar". Inside the application the hierarchy above is the
 * only one, because gold next to gold stops meaning anything. The foreground is
 * the near-black `highlight-fg`, not white: gold carries white at 1.8:1.
 */
export const buttonVariants = cva(
  [
    "inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap select-none",
    "rounded-sm font-medium hfm-transition hfm-focus-ring",
    "disabled:pointer-events-none disabled:opacity-55",
    "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  ],
  {
    variants: {
      variant: {
        primary: "bg-primary text-primary-fg hover:bg-primary-hover active:bg-primary-active",
        secondary: "bg-secondary text-secondary-fg hover:bg-secondary-hover active:bg-secondary-active",
        outline:
          "border border-border-strong bg-surface text-fg hover:bg-secondary active:bg-secondary-hover",
        ghost: "text-fg-secondary hover:bg-secondary hover:text-fg active:bg-secondary-hover",
        danger: "bg-danger text-danger-fg hover:bg-danger-hover active:bg-danger-active",
        highlight: "bg-highlight text-highlight-fg hover:bg-highlight-hover active:bg-highlight-hover",
        link: "h-auto px-0 text-link underline-offset-4 hover:text-link-hover hover:underline",
      },
      size: {
        sm: "h-(--control-height-sm) px-2.5 text-body-sm",
        md: "h-(--control-height-md) px-3.5 text-body",
        lg: "h-(--control-height-lg) px-4 text-body",
      },
    },
    defaultVariants: { variant: "primary", size: "md" },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  /** Render the child element instead of a <button> (e.g. a Next.js Link). */
  asChild?: boolean;
  /** Shows a spinner, disables interaction and announces the busy state. */
  loading?: boolean;
  leadingIcon?: React.ReactNode;
  trailingIcon?: React.ReactNode;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant, size, asChild = false, loading = false, leadingIcon, trailingIcon, children, disabled, type, ...props },
  ref,
) {
  const Comp = asChild ? Slot : "button";
  return (
    <Comp
      ref={ref}
      type={asChild ? undefined : type ?? "button"}
      className={cn(buttonVariants({ variant, size }), className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      data-loading={loading || undefined}
      {...props}
    >
      {asChild ? (
        children
      ) : (
        <>
          {loading ? <Loader2 className="animate-spin" aria-hidden /> : leadingIcon}
          {children}
          {!loading && trailingIcon}
        </>
      )}
    </Comp>
  );
});

/* -------------------------------------------------------------------------- */

export const iconButtonVariants = cva(
  [
    "inline-flex shrink-0 items-center justify-center rounded-sm hfm-transition hfm-focus-ring",
    "disabled:pointer-events-none disabled:opacity-55 [&_svg]:shrink-0",
  ],
  {
    variants: {
      variant: {
        primary: "bg-primary text-primary-fg hover:bg-primary-hover active:bg-primary-active",
        secondary: "bg-secondary text-secondary-fg hover:bg-secondary-hover",
        outline: "border border-border-strong bg-surface text-fg-secondary hover:bg-secondary hover:text-fg",
        ghost: "text-fg-secondary hover:bg-secondary hover:text-fg",
        danger: "text-danger hover:bg-danger-soft",
      },
      size: {
        sm: "size-(--control-height-sm) [&_svg]:size-4",
        md: "size-(--control-height-md) [&_svg]:size-4",
        lg: "size-(--control-height-lg) [&_svg]:size-5",
      },
    },
    defaultVariants: { variant: "ghost", size: "md" },
  },
);

export interface IconButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof iconButtonVariants> {
  /** Accessible name — icon-only controls must always have one. */
  label: string;
  asChild?: boolean;
}

export const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { className, variant, size, label, asChild = false, type, children, ...props },
  ref,
) {
  const Comp = asChild ? Slot : "button";
  return (
    <Comp
      ref={ref}
      type={asChild ? undefined : type ?? "button"}
      aria-label={label}
      title={label}
      className={cn(iconButtonVariants({ variant, size }), className)}
      {...props}
    >
      {children}
    </Comp>
  );
});
