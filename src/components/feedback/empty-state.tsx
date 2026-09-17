"use client";

import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/cn";

/**
 * EmptyState — what a region says when it has nothing to show. The description
 * is not decoration: it must state what is missing, why it is missing and what
 * the operator can do about it ("Nenhum veículo corresponde aos filtros. Ajuste
 * o período ou limpe os filtros para ver a frota completa.").
 *
 * ```tsx
 * <EmptyState
 *   variant="panel"
 *   icon={<Truck />}
 *   title="Nenhum veículo cadastrado"
 *   description="A frota desta filial ainda não foi importada. Cadastre um veículo ou importe a planilha da matriz para começar a operar."
 *   action={<Button leadingIcon={<Plus />}>Cadastrar veículo</Button>}
 *   secondaryAction={<Button variant="ghost">Importar planilha</Button>}
 * />
 * ```
 */

export const emptyStateVariants = cva("flex w-full flex-col items-center justify-center text-center", {
  variants: {
    size: {
      sm: "gap-2 px-4 py-6",
      md: "gap-3 px-6 py-10",
    },
    variant: {
      plain: "",
      panel: "rounded-md border border-dashed border-border bg-surface",
    },
  },
  compoundVariants: [
    // The panel breathes a little more than the bare block, without throwing
    // away the compactness `size="sm"` was asked for.
    { variant: "panel", size: "sm", class: "py-8" },
    { variant: "panel", size: "md", class: "py-10" },
  ],
  defaultVariants: { size: "md", variant: "plain" },
});

export type EmptyStateSize = NonNullable<VariantProps<typeof emptyStateVariants>["size"]>;
export type EmptyStateVariant = NonNullable<VariantProps<typeof emptyStateVariants>["variant"]>;

export interface EmptyStateProps
  extends Omit<React.HTMLAttributes<HTMLDivElement>, "title" | "children">,
    VariantProps<typeof emptyStateVariants> {
  /** Lucide icon shown inside a neutral square. Ignored when `illustration` is set. */
  icon?: React.ReactNode;
  /** Replaces the icon square with custom artwork (decorative, never the only message). */
  illustration?: React.ReactNode;
  title: React.ReactNode;
  /** What is missing, why, and what to do next. */
  description?: React.ReactNode;
  /** Primary way out of the empty state. */
  action?: React.ReactNode;
  /** Lower-emphasis alternative ("Limpar filtros", "Saiba mais"). */
  secondaryAction?: React.ReactNode;
  /** Heading level for `title`. Defaults to h3. */
  headingLevel?: 2 | 3 | 4;
}

export const EmptyState = React.forwardRef<HTMLDivElement, EmptyStateProps>(function EmptyState(
  {
    className,
    icon,
    illustration,
    title,
    description,
    action,
    secondaryAction,
    size = "md",
    variant = "plain",
    headingLevel = 3,
    ...props
  },
  ref,
) {
  const Heading = `h${headingLevel}` as const;
  const hasActions = action != null || secondaryAction != null;

  return (
    <div ref={ref} className={cn(emptyStateVariants({ size, variant }), className)} {...props}>
      {illustration != null ? (
        <div className="flex items-center justify-center" aria-hidden>
          {illustration}
        </div>
      ) : icon != null ? (
        <div
          aria-hidden
          className="flex size-10 shrink-0 items-center justify-center rounded-md bg-surface-secondary text-fg-muted [&_svg]:size-5"
        >
          {icon}
        </div>
      ) : null}

      <div className="flex flex-col gap-1">
        <Heading className={cn("font-semibold text-fg", size === "sm" ? "text-h4" : "text-h3")}>{title}</Heading>
        {description != null ? (
          <p className="max-w-md text-body-sm text-fg-secondary">{description}</p>
        ) : null}
      </div>

      {hasActions ? (
        <div className="mt-1 flex flex-wrap items-center justify-center gap-2">
          {action}
          {secondaryAction}
        </div>
      ) : null}
    </div>
  );
});
