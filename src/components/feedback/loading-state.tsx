"use client";

import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/cn";
import { Spinner } from "@/components/feedback/spinner";

/**
 * LoadingState — a spinner plus a message, for waits that have no predictable
 * shape (an action in flight, a refetch, a lazy panel). When the shape *is*
 * known, prefer the skeletons: they keep the layout from jumping.
 *
 * - `inline`  — one row inside an existing block ("Calculando rota…").
 * - `block`   — compact centered column where a panel body will appear.
 * - `overlay` — dims the content that is being refreshed; the parent element
 *               must be positioned (`relative`).
 */

export const loadingStateVariants = cva("text-body-sm text-fg-muted", {
  variants: {
    variant: {
      inline: "flex items-center gap-2",
      block: "flex flex-col items-center justify-center gap-2 px-4 py-8 text-center",
      overlay: "absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 bg-surface/60 text-center",
    },
  },
  defaultVariants: { variant: "inline" },
});

export type LoadingStateVariant = NonNullable<VariantProps<typeof loadingStateVariants>["variant"]>;

export interface LoadingStateProps
  extends Omit<React.HTMLAttributes<HTMLDivElement>, "children">,
    VariantProps<typeof loadingStateVariants> {
  /** Message shown next to the spinner. Defaults to "Carregando…". */
  label?: React.ReactNode;
  /** Second line with context ("Isto pode levar alguns segundos."). `block` and `overlay` only. */
  description?: React.ReactNode;
  /**
   * Hides the message (and `description`) visually while keeping it announced.
   * Use it on `overlay` when the dimmed content already says what is being
   * refreshed.
   */
  hideLabel?: boolean;
}

export const LoadingState = React.forwardRef<HTMLDivElement, LoadingStateProps>(function LoadingState(
  { className, variant = "inline", label = "Carregando…", description, hideLabel = false, ...props },
  ref,
) {
  const spinnerSize = variant === "inline" ? "sm" : "md";

  return (
    <div
      ref={ref}
      role="status"
      aria-busy
      className={cn(loadingStateVariants({ variant }), className)}
      {...props}
    >
      <Spinner size={spinnerSize} decorative />
      <span className={hideLabel ? "sr-only" : undefined}>{label}</span>
      {description != null && variant !== "inline" ? (
        <span className={hideLabel ? "sr-only" : "max-w-xs text-caption text-fg-muted"}>{description}</span>
      ) : null}
    </div>
  );
});
