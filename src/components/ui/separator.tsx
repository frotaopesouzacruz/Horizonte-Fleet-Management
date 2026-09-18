"use client";

import * as React from "react";
import * as SeparatorPrimitive from "@radix-ui/react-separator";
import { cn } from "@/lib/cn";

export interface SeparatorProps extends React.ComponentPropsWithoutRef<typeof SeparatorPrimitive.Root> {
  /** Centered text (horizontal orientation only), e.g. "ou", "Hoje". */
  label?: React.ReactNode;
}

/**
 * Separator — 1px token-colored divider. Decorative by default; pass
 * `decorative={false}` when it separates semantically distinct regions.
 */
export const Separator = React.forwardRef<React.ComponentRef<typeof SeparatorPrimitive.Root>, SeparatorProps>(
  function Separator({ className, orientation = "horizontal", decorative = true, label, ...props }, ref) {
    if (label != null && orientation === "horizontal") {
      return (
        <div
          ref={ref as React.Ref<HTMLDivElement>}
          role={decorative ? undefined : "separator"}
          aria-orientation={decorative ? undefined : "horizontal"}
          className={cn("flex w-full items-center gap-3", className)}
          {...(props as React.HTMLAttributes<HTMLDivElement>)}
        >
          <SeparatorPrimitive.Root decorative className="h-px flex-1 bg-border" />
          <span className="shrink-0 text-caption font-medium text-fg-muted">{label}</span>
          <SeparatorPrimitive.Root decorative className="h-px flex-1 bg-border" />
        </div>
      );
    }

    return (
      <SeparatorPrimitive.Root
        ref={ref}
        decorative={decorative}
        orientation={orientation}
        className={cn(
          "shrink-0 bg-border",
          orientation === "horizontal" ? "h-px w-full" : "h-full min-h-4 w-px self-stretch",
          className,
        )}
        {...props}
      />
    );
  },
);
