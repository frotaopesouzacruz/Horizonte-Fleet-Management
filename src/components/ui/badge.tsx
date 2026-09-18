"use client";

import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/cn";

/**
 * Badge — compact, static label for categories, counts and states.
 * Normal case, tracking-normal, small radius. Soft appearance is the default;
 * `solid` is reserved for a single strong emphasis per view and `outline`
 * for low-emphasis labels on dense surfaces.
 */
export const badgeVariants = cva(
  [
    "inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-xs border font-medium tracking-normal",
    "[&_svg]:pointer-events-none [&_svg]:shrink-0",
  ],
  {
    variants: {
      variant: {
        neutral: "",
        primary: "",
        accent: "",
        highlight: "",
        success: "",
        warning: "",
        danger: "",
        info: "",
      },
      appearance: {
        soft: "border-transparent",
        solid: "border-transparent",
        outline: "bg-transparent",
      },
      size: {
        sm: "h-5 px-1.5 text-caption [&_svg]:size-3",
        md: "h-6 px-2 text-caption [&_svg]:size-3.5",
      },
    },
    compoundVariants: [
      /* soft */
      { variant: "neutral", appearance: "soft", className: "bg-neutral-soft text-neutral-soft-fg" },
      { variant: "primary", appearance: "soft", className: "bg-primary-soft text-primary-soft-fg" },
      { variant: "accent", appearance: "soft", className: "bg-accent-soft text-accent-soft-fg" },
      { variant: "highlight", appearance: "soft", className: "bg-highlight-soft text-highlight-soft-fg" },
      { variant: "success", appearance: "soft", className: "bg-success-soft text-success-soft-fg" },
      { variant: "warning", appearance: "soft", className: "bg-warning-soft text-warning-soft-fg" },
      { variant: "danger", appearance: "soft", className: "bg-danger-soft text-danger-soft-fg" },
      { variant: "info", appearance: "soft", className: "bg-info-soft text-info-soft-fg" },
      /* solid */
      { variant: "neutral", appearance: "solid", className: "bg-neutral text-neutral-fg" },
      { variant: "primary", appearance: "solid", className: "bg-primary text-primary-fg" },
      { variant: "accent", appearance: "solid", className: "bg-accent text-accent-fg" },
      { variant: "highlight", appearance: "solid", className: "bg-highlight text-highlight-fg" },
      { variant: "success", appearance: "solid", className: "bg-success text-success-fg" },
      { variant: "warning", appearance: "solid", className: "bg-warning text-warning-fg" },
      { variant: "danger", appearance: "solid", className: "bg-danger text-danger-fg" },
      { variant: "info", appearance: "solid", className: "bg-info text-info-fg" },
      /* outline */
      { variant: "neutral", appearance: "outline", className: "border-border-strong text-fg-secondary" },
      { variant: "primary", appearance: "outline", className: "border-primary/50 text-primary-soft-fg" },
      { variant: "accent", appearance: "outline", className: "border-accent/50 text-accent-soft-fg" },
      { variant: "highlight", appearance: "outline", className: "border-highlight/60 text-highlight-soft-fg" },
      { variant: "success", appearance: "outline", className: "border-success/50 text-success-soft-fg" },
      { variant: "warning", appearance: "outline", className: "border-warning/50 text-warning-soft-fg" },
      { variant: "danger", appearance: "outline", className: "border-danger/50 text-danger-soft-fg" },
      { variant: "info", appearance: "outline", className: "border-info/50 text-info-soft-fg" },
    ],
    defaultVariants: { variant: "neutral", appearance: "soft", size: "md" },
  },
);

export type BadgeVariant = NonNullable<VariantProps<typeof badgeVariants>["variant"]>;
export type BadgeAppearance = NonNullable<VariantProps<typeof badgeVariants>["appearance"]>;
export type BadgeSize = NonNullable<VariantProps<typeof badgeVariants>["size"]>;

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {
  /** Leading dot in the current text color (decorative; the label carries meaning). */
  dot?: boolean;
  /** Leading icon (lucide). Takes precedence over `dot`. */
  icon?: React.ReactNode;
}

export const Badge = React.forwardRef<HTMLSpanElement, BadgeProps>(function Badge(
  { className, variant, appearance, size, dot = false, icon, children, ...props },
  ref,
) {
  return (
    <span ref={ref} className={cn(badgeVariants({ variant, appearance, size }), className)} {...props}>
      {icon ? (
        <span className="inline-flex shrink-0 items-center" aria-hidden>
          {icon}
        </span>
      ) : dot ? (
        <span className="size-1.5 shrink-0 rounded-full bg-current" aria-hidden />
      ) : null}
      {children}
    </span>
  );
});
