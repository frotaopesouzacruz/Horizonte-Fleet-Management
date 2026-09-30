import * as React from "react";
import { cn } from "@/lib/cn";

export interface PageHeaderProps extends Omit<React.HTMLAttributes<HTMLDivElement>, "title"> {
  title: React.ReactNode;
  description?: React.ReactNode;
  /** Breadcrumb node (use the Breadcrumb component). Rendered above the title. */
  breadcrumb?: React.ReactNode;
  /** Main call to action (one Button). */
  primaryAction?: React.ReactNode;
  /** Secondary actions (Buttons/IconButtons). */
  secondaryActions?: React.ReactNode;
  /** Filters/toolbar rendered under the title row (use FilterBar). */
  filters?: React.ReactNode;
  /** Tabs or view switchers rendered at the bottom edge of the header. */
  tabs?: React.ReactNode;
  /** Optional status/badge next to the title. */
  meta?: React.ReactNode;
  /** Módulo ou área acima do título ("Gestão de checklist"), quando não há breadcrumb. */
  eyebrow?: React.ReactNode;
}

/**
 * PageHeader — the standard top of every page and the first level of the page
 * narrative: header › filters › KPIs › analyses › details. Every slot is
 * optional: a list page may use title + primaryAction + filters, a detail page
 * may use breadcrumb + title + meta + tabs.
 */
export function PageHeader({
  title,
  description,
  breadcrumb,
  primaryAction,
  secondaryActions,
  filters,
  tabs,
  meta,
  eyebrow,
  className,
  ...props
}: PageHeaderProps) {
  return (
    <div
      className={cn(
        "flex flex-col gap-3 border-b border-border bg-surface-header px-4 pt-4 sm:px-6 sm:pt-5",
        tabs ? "pb-0" : "pb-4",
        className,
      )}
      {...props}
    >
      {breadcrumb ? <div className="-mb-1">{breadcrumb}</div> : null}

      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0">
          {eyebrow && !breadcrumb ? (
            <p className="mb-1 text-overline font-semibold uppercase text-fg-muted">{eyebrow}</p>
          ) : null}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <h1 className="truncate text-page-title font-semibold text-fg">{title}</h1>
            {meta}
          </div>
          {description ? <p className="mt-1 max-w-3xl text-body-sm text-fg-secondary">{description}</p> : null}
        </div>

        {primaryAction || secondaryActions ? (
          <div className="flex shrink-0 flex-wrap items-center gap-2 md:justify-end">
            {secondaryActions}
            {primaryAction}
          </div>
        ) : null}
      </div>

      {filters ? <div className="-mx-1 border-t border-border-subtle pt-1">{filters}</div> : null}
      {tabs ? <div className="-mb-px">{tabs}</div> : null}
    </div>
  );
}

/** Standard content container below a PageHeader. */
export function PageContent({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("mx-auto w-full max-w-(--content-max-width) px-4 py-4 sm:px-6 sm:py-5", className)} {...props} />;
}
