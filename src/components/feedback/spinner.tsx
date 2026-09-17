"use client";

import * as React from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/cn";

/**
 * Spinner — the single indeterminate busy indicator of the product. It is small
 * on purpose: a spinner reports that something is in flight, it is never the
 * subject of the screen. For a whole region use `LoadingState`, for content
 * that has a known shape use the skeletons.
 */

export type SpinnerSize = "xs" | "sm" | "md" | "lg";

/** Sizes follow the 4px scale: 12 / 16 / 20 / 24. */
const spinnerSizes: Record<SpinnerSize, string> = {
  xs: "size-3",
  sm: "size-4",
  md: "size-5",
  lg: "size-6",
};

export interface SpinnerProps extends Omit<React.HTMLAttributes<HTMLSpanElement>, "children"> {
  size?: SpinnerSize;
  /** Accessible name announced while spinning. */
  label?: string;
  /**
   * Set when a sibling already carries the loading text (a button label, a
   * `LoadingState` message). The spinner then becomes purely decorative.
   */
  decorative?: boolean;
}

export const Spinner = React.forwardRef<HTMLSpanElement, SpinnerProps>(function Spinner(
  { className, size = "md", label = "Carregando…", decorative = false, ...props },
  ref,
) {
  if (decorative) {
    return (
      <span ref={ref} aria-hidden className={cn("inline-flex shrink-0", className)} {...props}>
        <Loader2 className={cn("animate-spin text-fg-muted", spinnerSizes[size])} />
      </span>
    );
  }

  return (
    <span ref={ref} role="status" className={cn("inline-flex shrink-0", className)} {...props}>
      <Loader2 className={cn("animate-spin text-fg-muted", spinnerSizes[size])} aria-hidden />
      <span className="sr-only">{label}</span>
    </span>
  );
});
