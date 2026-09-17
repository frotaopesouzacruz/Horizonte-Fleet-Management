"use client";

import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { cn } from "@/lib/cn";
import { DialogOverlay } from "./dialog";

/**
 * Drawer — side panel for details, filters and secondary flows.
 * Built on Radix Dialog so focus management and a11y are shared with Dialog.
 */
export const Drawer = DialogPrimitive.Root;
export const DrawerTrigger = DialogPrimitive.Trigger;
export const DrawerClose = DialogPrimitive.Close;
export const DrawerPortal = DialogPrimitive.Portal;

type DrawerSide = "left" | "right";
type DrawerSize = "sm" | "md" | "lg" | "xl";

const sizeClasses: Record<DrawerSize, string> = {
  sm: "sm:max-w-sm",
  md: "sm:max-w-md",
  lg: "sm:max-w-xl",
  xl: "sm:max-w-3xl",
};

export interface DrawerContentProps extends React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> {
  side?: DrawerSide;
  size?: DrawerSize;
  hideClose?: boolean;
}

export const DrawerContent = React.forwardRef<React.ComponentRef<typeof DialogPrimitive.Content>, DrawerContentProps>(
  function DrawerContent({ className, children, side = "right", size = "md", hideClose = false, ...props }, ref) {
    return (
      <DrawerPortal>
        <DialogOverlay />
        <DialogPrimitive.Content
          ref={ref}
          className={cn(
            "fixed inset-y-0 z-(--z-overlay) flex h-dvh w-full flex-col bg-surface-elevated text-fg shadow-lg outline-none",
            side === "right" &&
              "right-0 border-l border-border data-[state=open]:animate-slide-in-right data-[state=closed]:animate-slide-out-right",
            side === "left" &&
              "left-0 border-r border-border data-[state=open]:animate-slide-in-left data-[state=closed]:animate-slide-out-left",
            sizeClasses[size],
            className,
          )}
          {...props}
        >
          {children}
          {!hideClose ? (
            <DialogPrimitive.Close
              aria-label="Fechar"
              className="absolute top-3 right-3 rounded-sm p-1.5 text-fg-muted hfm-transition hover:bg-secondary hover:text-fg hfm-focus-ring"
            >
              <X className="size-4" aria-hidden />
            </DialogPrimitive.Close>
          ) : null}
        </DialogPrimitive.Content>
      </DrawerPortal>
    );
  },
);

export function DrawerHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex flex-col gap-1 border-b border-border px-5 py-4 pr-12", className)} {...props} />;
}

export function DrawerBody({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("min-h-0 flex-1 overflow-y-auto px-5 py-4", className)} {...props} />;
}

export function DrawerFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn("flex flex-col-reverse gap-2 border-t border-border bg-surface-secondary px-5 py-3 sm:flex-row sm:justify-end", className)} {...props} />
  );
}

export const DrawerTitle = React.forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(function DrawerTitle({ className, ...props }, ref) {
  return <DialogPrimitive.Title ref={ref} className={cn("text-h3 font-semibold text-fg", className)} {...props} />;
});

export const DrawerDescription = React.forwardRef<
  React.ComponentRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(function DrawerDescription({ className, ...props }, ref) {
  return <DialogPrimitive.Description ref={ref} className={cn("text-body-sm text-fg-secondary", className)} {...props} />;
});
