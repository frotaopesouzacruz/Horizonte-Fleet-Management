"use client";

import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/cn";

/**
 * Card — bordered surface for grouping related content. Cards rely on borders,
 * not shadows; `elevated` adds the discreet shadow-sm for floating summaries.
 * `interactive` is for whole-card links/buttons (use `asChild` with an anchor).
 */
export const cardVariants = cva("relative flex flex-col rounded-md bg-surface text-fg", {
  variants: {
    variant: {
      default: "border border-border",
      outlined: "border border-border-strong",
      elevated: "border border-border shadow-sm",
      interactive: [
        "border border-border hfm-transition hfm-focus-ring cursor-pointer",
        "hover:border-border-strong",
        "after:pointer-events-none after:absolute after:inset-0 after:rounded-[inherit] after:bg-hover-overlay after:opacity-0",
        "after:transition-opacity after:duration-(--duration-base) hover:after:opacity-100",
      ],
    },
  },
  defaultVariants: { variant: "default" },
});

export interface CardProps extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof cardVariants> {
  /** Render the child element (e.g. Next.js Link) instead of a <div>. */
  asChild?: boolean;
}

export const Card = React.forwardRef<HTMLDivElement, CardProps>(function Card(
  { className, variant, asChild = false, onClick, onKeyDown, tabIndex, role, ...props },
  ref,
) {
  const Comp = asChild ? Slot : "div";
  const isInteractive = variant === "interactive";
  const clickableDiv = isInteractive && !asChild && typeof onClick === "function";

  const handleKeyDown = clickableDiv
    ? (event: React.KeyboardEvent<HTMLDivElement>) => {
        onKeyDown?.(event);
        if (event.defaultPrevented) return;
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          event.currentTarget.click();
        }
      }
    : onKeyDown;

  return (
    <Comp
      ref={ref}
      className={cn(cardVariants({ variant }), className)}
      onClick={onClick}
      onKeyDown={handleKeyDown}
      role={role ?? (clickableDiv ? "button" : undefined)}
      tabIndex={tabIndex ?? (clickableDiv ? 0 : undefined)}
      {...props}
    />
  );
});

/* -------------------------------------------------------------------------- */

export interface CardHeaderProps extends Omit<React.HTMLAttributes<HTMLDivElement>, "title"> {
  title?: React.ReactNode;
  description?: React.ReactNode;
  /** Right-aligned slot for buttons, menus or badges. */
  actions?: React.ReactNode;
  /** Heading level for `title`. Defaults to h3. */
  headingLevel?: 2 | 3 | 4;
}

export const CardHeader = React.forwardRef<HTMLDivElement, CardHeaderProps>(function CardHeader(
  { className, title, description, actions, headingLevel = 3, children, ...props },
  ref,
) {
  const Heading = `h${headingLevel}` as const;
  const hasText = title != null || description != null;
  return (
    <div ref={ref} className={cn("flex items-start justify-between gap-3 p-4 pb-3", className)} {...props}>
      {hasText || children ? (
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          {title != null ? <Heading className="text-h4 font-semibold text-fg">{title}</Heading> : null}
          {description != null ? <p className="text-body-sm text-fg-muted">{description}</p> : null}
          {children}
        </div>
      ) : null}
      {actions ? <div className="flex shrink-0 items-center gap-1">{actions}</div> : null}
    </div>
  );
});

export const CardTitle = React.forwardRef<HTMLHeadingElement, React.HTMLAttributes<HTMLHeadingElement>>(
  function CardTitle({ className, ...props }, ref) {
    return <h3 ref={ref} className={cn("text-h4 font-semibold text-fg", className)} {...props} />;
  },
);

export const CardDescription = React.forwardRef<HTMLParagraphElement, React.HTMLAttributes<HTMLParagraphElement>>(
  function CardDescription({ className, ...props }, ref) {
    return <p ref={ref} className={cn("text-body-sm text-fg-muted", className)} {...props} />;
  },
);

export const CardContent = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  function CardContent({ className, ...props }, ref) {
    return <div ref={ref} className={cn("flex-1 px-4 pb-4 [&:first-child]:pt-4", className)} {...props} />;
  },
);

export const CardFooter = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  function CardFooter({ className, ...props }, ref) {
    return (
      <div
        ref={ref}
        className={cn("flex items-center gap-2 border-t border-border-subtle px-4 py-3", className)}
        {...props}
      />
    );
  },
);

/* -------------------------------------------------------------------------- */

const panelBodyPadding = {
  none: "",
  sm: "p-3",
  md: "p-4",
} as const;

export interface PanelProps extends Omit<React.HTMLAttributes<HTMLElement>, "title"> {
  title: React.ReactNode;
  /** Secondary text next to the title (count, last update, unit). */
  meta?: React.ReactNode;
  /** Right-aligned slot for compact controls (IconButton size sm, small selects). */
  actions?: React.ReactNode;
  /** Body padding. `none` for tables and lists that manage their own edges. */
  padding?: keyof typeof panelBodyPadding;
  headingLevel?: 2 | 3 | 4;
  /** Optional footer rendered below the body with a top border. */
  footer?: React.ReactNode;
}

/**
 * Panel — section container with a compact header bar. Used to group content
 * on operational pages (tables, lists, maps, small charts).
 */
export const Panel = React.forwardRef<HTMLElement, PanelProps>(function Panel(
  { className, title, meta, actions, padding = "md", headingLevel = 3, footer, children, ...props },
  ref,
) {
  const Heading = `h${headingLevel}` as const;
  const headingId = React.useId();
  return (
    <section
      ref={ref}
      aria-labelledby={headingId}
      className={cn("flex flex-col rounded-md border border-border bg-surface text-fg", className)}
      {...props}
    >
      <header className="flex min-h-10 items-center gap-3 rounded-t-[inherit] border-b border-border bg-surface-secondary px-3 py-1.5">
        <div className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2 gap-y-0">
          <Heading id={headingId} className="truncate text-label font-semibold text-fg">
            {title}
          </Heading>
          {meta != null ? <span className="truncate text-caption text-fg-muted">{meta}</span> : null}
        </div>
        {actions ? <div className="flex shrink-0 items-center gap-1">{actions}</div> : null}
      </header>
      <div className={cn("flex-1", panelBodyPadding[padding])}>{children}</div>
      {footer ? (
        <div className="flex items-center gap-2 border-t border-border-subtle px-3 py-2 text-body-sm text-fg-secondary">
          {footer}
        </div>
      ) : null}
    </section>
  );
});
