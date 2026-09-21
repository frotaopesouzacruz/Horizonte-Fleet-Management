"use client";

import * as React from "react";
import * as SelectPrimitive from "@radix-ui/react-select";
import { Check, ChevronDown, ChevronUp } from "lucide-react";
import { cn } from "@/lib/cn";
import { inputVariants, type InputSize } from "@/components/ui/input";
import { useOptionalFormField } from "@/components/ui/form-field";

export const Select = SelectPrimitive.Root;
export const SelectGroup = SelectPrimitive.Group;
export const SelectValue = SelectPrimitive.Value;

export interface SelectTriggerProps
  extends React.ComponentPropsWithoutRef<typeof SelectPrimitive.Trigger> {
  /** Control height — matches `Input`. */
  size?: InputSize;
}

/** Trigger — visually identical to `Input`, with a chevron affordance. */
export const SelectTrigger = React.forwardRef<
  React.ComponentRef<typeof SelectPrimitive.Trigger>,
  SelectTriggerProps
>(function SelectTrigger(
  {
    className,
    size = "md",
    children,
    id,
    "aria-describedby": ariaDescribedBy,
    "aria-invalid": ariaInvalid,
    "aria-required": ariaRequired,
    ...props
  },
  ref,
) {
  // A trigger inside a `FormField` inherits its id and description wiring.
  const field = useOptionalFormField();

  return (
    <SelectPrimitive.Trigger
      ref={ref}
      id={id ?? field?.id}
      aria-describedby={ariaDescribedBy ?? field?.describedBy}
      aria-invalid={ariaInvalid ?? (field?.invalid || undefined)}
      aria-required={ariaRequired ?? (field?.required || undefined)}
      className={cn(
        inputVariants({ size }),
        "flex items-center justify-between gap-2 text-left",
        "data-[placeholder]:text-input-placeholder",
        "data-[state=open]:border-border-focus",
        "[&>span]:min-w-0 [&>span]:truncate",
        className,
      )}
      {...props}
    >
      {children}
      <SelectPrimitive.Icon asChild>
        <ChevronDown className="size-4 shrink-0 text-fg-muted" aria-hidden />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  );
});

const scrollButtonClasses =
  "flex cursor-default items-center justify-center py-1 text-fg-muted";

export const SelectScrollUpButton = React.forwardRef<
  React.ComponentRef<typeof SelectPrimitive.ScrollUpButton>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.ScrollUpButton>
>(function SelectScrollUpButton({ className, ...props }, ref) {
  return (
    <SelectPrimitive.ScrollUpButton ref={ref} className={cn(scrollButtonClasses, className)} {...props}>
      <ChevronUp className="size-4" aria-hidden />
    </SelectPrimitive.ScrollUpButton>
  );
});

export const SelectScrollDownButton = React.forwardRef<
  React.ComponentRef<typeof SelectPrimitive.ScrollDownButton>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.ScrollDownButton>
>(function SelectScrollDownButton({ className, ...props }, ref) {
  return (
    <SelectPrimitive.ScrollDownButton ref={ref} className={cn(scrollButtonClasses, className)} {...props}>
      <ChevronDown className="size-4" aria-hidden />
    </SelectPrimitive.ScrollDownButton>
  );
});

export const SelectContent = React.forwardRef<
  React.ComponentRef<typeof SelectPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Content>
>(function SelectContent({ className, children, position = "popper", sideOffset = 6, ...props }, ref) {
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Content
        ref={ref}
        position={position}
        sideOffset={sideOffset}
        collisionPadding={8}
        className={cn(
          "relative z-(--z-dropdown) overflow-hidden rounded-md border border-border bg-surface-elevated outline-none",
          "text-body-sm text-fg shadow-md",
          "data-[state=open]:animate-scale-in data-[state=closed]:animate-fade-out",
          position === "popper" &&
            "w-(--radix-select-trigger-width) max-h-(--radix-select-content-available-height)",
          className,
        )}
        {...props}
      >
        <SelectScrollUpButton />
        <SelectPrimitive.Viewport className="p-1">{children}</SelectPrimitive.Viewport>
        <SelectScrollDownButton />
      </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
  );
});

export const SelectLabel = React.forwardRef<
  React.ComponentRef<typeof SelectPrimitive.Label>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Label>
>(function SelectLabel({ className, ...props }, ref) {
  return (
    <SelectPrimitive.Label
      ref={ref}
      className={cn("px-2 py-1.5 text-caption font-semibold text-fg-muted", className)}
      {...props}
    />
  );
});

export const SelectItem = React.forwardRef<
  React.ComponentRef<typeof SelectPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Item>
>(function SelectItem({ className, children, ...props }, ref) {
  return (
    <SelectPrimitive.Item
      ref={ref}
      className={cn(
        "relative flex cursor-default items-center gap-2 rounded-sm py-1.5 pr-2 pl-8 outline-none select-none hfm-transition",
        "focus:bg-secondary data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
        className,
      )}
      {...props}
    >
      <span className="absolute left-2 flex size-4 items-center justify-center">
        <SelectPrimitive.ItemIndicator>
          <Check className="size-4 text-primary" aria-hidden />
        </SelectPrimitive.ItemIndicator>
      </span>
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
    </SelectPrimitive.Item>
  );
});

export const SelectSeparator = React.forwardRef<
  React.ComponentRef<typeof SelectPrimitive.Separator>,
  React.ComponentPropsWithoutRef<typeof SelectPrimitive.Separator>
>(function SelectSeparator({ className, ...props }, ref) {
  return <SelectPrimitive.Separator ref={ref} className={cn("-mx-1 my-1 h-px bg-border", className)} {...props} />;
});

/**
 * A linha que uma lista sem itens mostra no lugar do nada.
 *
 * Um menu que abre vazio e um menu que não abre são indistinguíveis para quem
 * está preenchendo o formulário — os dois parecem defeito. Dizer "nenhum X
 * cadastrado" transforma a ausência num fato do cadastro, que a pessoa sabe
 * resolver, em vez de num sintoma que ela só pode reportar.
 */
export function SelectEmpty({ children }: { children: React.ReactNode }) {
  return (
    <p role="presentation" className="px-3 py-2 text-caption text-fg-muted">
      {children}
    </p>
  );
}
