"use client";

import * as React from "react";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import { cn } from "@/lib/cn";

export function TooltipProvider({ children, ...props }: TooltipPrimitive.TooltipProviderProps) {
  return (
    <TooltipPrimitive.Provider delayDuration={300} skipDelayDuration={200} {...props}>
      {children}
    </TooltipPrimitive.Provider>
  );
}

export const Tooltip = TooltipPrimitive.Root;
export const TooltipTrigger = TooltipPrimitive.Trigger;

export const TooltipContent = React.forwardRef<
  React.ComponentRef<typeof TooltipPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Content>
>(function TooltipContent({ className, sideOffset = 6, children, ...props }, ref) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        ref={ref}
        sideOffset={sideOffset}
        className={cn(
          "z-(--z-dropdown) max-w-72 rounded-sm bg-surface-inverse px-2.5 py-1.5 text-caption font-medium text-fg-inverse shadow-md",
          "animate-fade-in data-[state=closed]:animate-fade-out",
          className,
        )}
        {...props}
      >
        {children}
      </TooltipPrimitive.Content>
    </TooltipPrimitive.Portal>
  );
});

/** Convenience wrapper: `<SimpleTooltip content="Salvar"><IconButton .../></SimpleTooltip>` */
export function SimpleTooltip({
  content,
  children,
  side,
}: {
  content: React.ReactNode;
  children: React.ReactElement;
  side?: TooltipPrimitive.TooltipContentProps["side"];
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side={side}>{content}</TooltipContent>
    </Tooltip>
  );
}
