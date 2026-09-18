"use client";

import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { ChevronRight, Ellipsis } from "lucide-react";
import { cn } from "@/lib/cn";

/**
 * Breadcrumb — location trail above the page header. Muted by default so the
 * page title keeps the emphasis; only the current page uses `text-fg`.
 *
 * ```tsx
 * <Breadcrumb>
 *   <BreadcrumbList>
 *     <BreadcrumbItem>
 *       <BreadcrumbLink asChild><Link href="/frota">Frota</Link></BreadcrumbLink>
 *     </BreadcrumbItem>
 *     <BreadcrumbSeparator />
 *     <BreadcrumbItem><BreadcrumbPage>ABC-1D23</BreadcrumbPage></BreadcrumbItem>
 *   </BreadcrumbList>
 * </Breadcrumb>
 * ```
 */
export const Breadcrumb = React.forwardRef<HTMLElement, React.ComponentPropsWithoutRef<"nav">>(
  function Breadcrumb({ className, "aria-label": ariaLabel, ...props }, ref) {
    return (
      <nav
        ref={ref}
        className={cn("min-w-0", className)}
        {...props}
        // Applied after the spread so the landmark keeps a name even when the
        // caller passes an explicitly undefined `aria-label`.
        aria-label={ariaLabel ?? "Trilha de navegação"}
      />
    );
  },
);

export const BreadcrumbList = React.forwardRef<HTMLOListElement, React.ComponentPropsWithoutRef<"ol">>(
  function BreadcrumbList({ className, ...props }, ref) {
    return (
      <ol
        ref={ref}
        className={cn("flex flex-wrap items-center gap-1.5 text-body-sm text-fg-muted", className)}
        {...props}
      />
    );
  },
);

export const BreadcrumbItem = React.forwardRef<HTMLLIElement, React.ComponentPropsWithoutRef<"li">>(
  function BreadcrumbItem({ className, ...props }, ref) {
    return <li ref={ref} className={cn("inline-flex min-w-0 items-center gap-1.5", className)} {...props} />;
  },
);

export interface BreadcrumbLinkProps extends React.ComponentPropsWithoutRef<"a"> {
  /** Render the child element instead of an `<a>` (e.g. a Next.js `<Link>`). */
  asChild?: boolean;
}

export const BreadcrumbLink = React.forwardRef<HTMLAnchorElement, BreadcrumbLinkProps>(function BreadcrumbLink(
  { className, asChild = false, ...props },
  ref,
) {
  const Comp = asChild ? Slot : "a";
  return (
    <Comp
      ref={ref}
      className={cn(
        "max-w-48 truncate rounded-xs hfm-transition hfm-focus-ring hover:text-fg hover:underline underline-offset-4",
        className,
      )}
      {...props}
    />
  );
});

export const BreadcrumbPage = React.forwardRef<HTMLSpanElement, React.ComponentPropsWithoutRef<"span">>(
  function BreadcrumbPage({ className, ...props }, ref) {
    return (
      <span
        ref={ref}
        aria-current="page"
        className={cn("max-w-64 truncate font-medium text-fg", className)}
        {...props}
      />
    );
  },
);

export interface BreadcrumbSeparatorProps extends React.ComponentPropsWithoutRef<"li"> {
  /** Custom separator glyph. Defaults to a ChevronRight. */
  children?: React.ReactNode;
}

export const BreadcrumbSeparator = React.forwardRef<HTMLLIElement, BreadcrumbSeparatorProps>(
  function BreadcrumbSeparator({ className, children, ...props }, ref) {
    return (
      <li
        ref={ref}
        role="presentation"
        aria-hidden
        className={cn("inline-flex shrink-0 items-center text-fg-muted", className)}
        {...props}
      >
        {children ?? <ChevronRight className="size-3.5" />}
      </li>
    );
  },
);

/** BreadcrumbEllipsis — stands in for collapsed middle levels. */
export const BreadcrumbEllipsis = React.forwardRef<HTMLSpanElement, React.ComponentPropsWithoutRef<"span">>(
  function BreadcrumbEllipsis({ className, ...props }, ref) {
    return (
      <span
        ref={ref}
        className={cn("inline-flex size-4 items-center justify-center text-fg-muted", className)}
        {...props}
      >
        <Ellipsis className="size-3.5" aria-hidden />
        <span className="sr-only">Níveis ocultos</span>
      </span>
    );
  },
);
