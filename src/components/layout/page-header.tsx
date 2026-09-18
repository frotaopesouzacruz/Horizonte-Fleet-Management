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
}

/**
 * PageHeader — the standard top of every page. Every slot is optional:
 * a list page may use title + primaryAction + filters, a detail page may use
 * breadcrumb + title + meta + tabs.
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
  className,
  ...props
}: PageHeaderProps) {
  return (
    <div className={cn("flex flex-col gap-3 border-b border-border bg-surface px-4 pt-4 sm:px-6", tabs ? "pb-0" : "pb-4", className)} {...props}>
      {breadcrumb ? <div className="-mb-1">{breadcrumb}</div> : null}

      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="truncate text-h1 font-semibold text-fg">{title}</h1>
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

      {filters ? <div className="-mx-1">{filters}</div> : null}
      {tabs ? <div className="-mb-px">{tabs}</div> : null}
    </div>
  );
}

/** Standard content container below a PageHeader. */
export function PageContent({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("mx-auto w-full max-w-(--content-max-width) px-4 py-4 sm:px-6 sm:py-5", className)} {...props} />;
}
