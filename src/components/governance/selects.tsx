"use client";

import * as React from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/cn";
import { inputVariants } from "@/components/ui/input";

/**
 * A plain `<select>`, styled as a Design System field.
 *
 * Deliberately native and not a portalled listbox. The chained Operação →
 * Estado → Cidade → BR selectors are the first thing anyone touches on these
 * screens, and a portal that fails to open leaves the whole module unusable —
 * which is exactly what happened on the Operações coverage picker. The browser
 * guarantees a native select opens, and on a phone it becomes the OS picker,
 * which is the better control anyway.
 */
export interface NativeSelectProps
  extends Omit<React.SelectHTMLAttributes<HTMLSelectElement>, "size"> {
  fieldSize?: "sm" | "md" | "lg";
}

export const NativeSelect = React.forwardRef<HTMLSelectElement, NativeSelectProps>(
  function NativeSelect({ className, fieldSize = "md", children, ...props }, ref) {
    return (
      <span className="relative inline-flex w-full">
        <select
          ref={ref}
          className={cn(
            inputVariants({ size: fieldSize }),
            "cursor-pointer appearance-none pr-9",
            className,
          )}
          {...props}
        >
          {children}
        </select>
        <ChevronDown
          aria-hidden
          className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-fg-muted"
        />
      </span>
    );
  },
);
