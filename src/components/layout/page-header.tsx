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
  /**
   * `bottom` (padrão): abas na borda inferior, abaixo dos filtros.
   * `top`: abas logo abaixo do título e os filtros abaixo delas — para módulos
   * em que a aba escolhe a tela e os filtros valem para a tela escolhida.
   */
  tabsPlacement?: "bottom" | "top";
  /** Optional status/badge next to the title. */
  meta?: React.ReactNode;
  /** Módulo ou área acima do título ("Gestão de checklist"), quando não há breadcrumb. */
  eyebrow?: React.ReactNode;
  /**
   * Contexto da visão (UI 2.0): competência, recorte, última atualização.
   * Pequenos itens abaixo da descrição — use `PageHeaderContext`.
   */
  context?: React.ReactNode;
  /**
   * Versão enxuta para cabeçalho fixo já rolado: esconde eyebrow, descrição e
   * contexto e reduz os espaços — título, abas e filtros continuam à mão.
   */
  compact?: boolean;
}

/**
 * PageHeader — o topo de toda página e o primeiro nível da narrativa:
 * cabeçalho › filtros › KPIs › análises › detalhes.
 *
 * UI 2.0: o cabeçalho mora no próprio canvas (sem faixa branca), com título
 * forte, descrição, contexto e ações separados; os filtros ficam numa barra de
 * ferramentas elevada (nível 1), e as abas logo abaixo do título quando
 * `tabsPlacement="top"`. Todos os slots são opcionais.
 */
export function PageHeader({
  title,
  description,
  breadcrumb,
  primaryAction,
  secondaryActions,
  filters,
  tabs,
  tabsPlacement = "bottom",
  meta,
  eyebrow,
  context,
  compact = false,
  className,
  ...props
}: PageHeaderProps) {
  const tabsOnTop = Boolean(tabs) && tabsPlacement === "top";
  return (
    <div
      data-slot="page-header"
      className={cn(
        "flex flex-col bg-surface-header px-4 sm:px-6",
        compact ? "gap-2 pt-2.5 sm:pt-3" : "gap-4 pt-5 sm:pt-6",
        tabs && !tabsOnTop ? "pb-0" : compact ? "pb-2.5" : "pb-4",
        className,
      )}
      data-compact={compact || undefined}
      {...props}
    >
      {breadcrumb ? <div className="-mb-2">{breadcrumb}</div> : null}

      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0">
          {eyebrow && !breadcrumb && !compact ? (
            <p className="mb-1.5 flex items-center gap-2 text-overline font-semibold uppercase text-primary-soft-fg">
              <span aria-hidden className="h-3 w-0.5 rounded-full bg-highlight" />
              {eyebrow}
            </p>
          ) : null}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <h1 className={cn("truncate font-semibold text-fg", compact ? "text-section-title" : "text-page-title")}>{title}</h1>
            {meta}
          </div>
          {description && !compact ? <p className="mt-1.5 max-w-3xl text-body-sm text-fg-secondary">{description}</p> : null}
          {context && !compact ? <div className="mt-2.5 flex flex-wrap items-center gap-2">{context}</div> : null}
        </div>

        {primaryAction || secondaryActions ? (
          <div className="flex shrink-0 flex-wrap items-center gap-2 md:justify-end md:pt-1">
            {secondaryActions}
            {primaryAction}
          </div>
        ) : null}
      </div>

      {tabsOnTop ? <div>{tabs}</div> : null}
      {filters ? (
        <div
          data-slot="page-toolbar"
          className="rounded-xl border border-border bg-surface-toolbar px-2.5 py-1 shadow-card sm:px-3"
        >
          {filters}
        </div>
      ) : null}
      {tabs && !tabsOnTop ? <div className="-mb-px border-b border-border">{tabs}</div> : null}
    </div>
  );
}

/** Um item de contexto do cabeçalho: rótulo discreto + valor ("Competência · Outubro/2026"). */
export function PageHeaderContext({
  label,
  children,
  icon,
  className,
}: {
  label?: React.ReactNode;
  children: React.ReactNode;
  icon?: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex h-7 items-center gap-1.5 rounded-md border border-border bg-surface-raised px-2.5 text-caption text-fg-secondary shadow-xs",
        "[&_svg]:size-3.5 [&_svg]:shrink-0 [&_svg]:text-fg-muted",
        className,
      )}
    >
      {icon}
      {label != null ? <span className="text-fg-muted">{label}</span> : null}
      <span className="font-semibold text-fg">{children}</span>
    </span>
  );
}

/** Standard content container below a PageHeader. */
export function PageContent({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("mx-auto w-full max-w-(--content-max-width) px-4 py-4 sm:px-6 sm:py-5", className)} {...props} />;
}
