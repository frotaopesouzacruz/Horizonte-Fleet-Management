import * as React from "react";
import { BarChart3 } from "lucide-react";
import { cn } from "@/lib/cn";

/**
 * ChartCard — a moldura de toda análise visual: título que diz a pergunta,
 * subtítulo com o recorte, ações compactas à direita, legenda acima do
 * desenho e, embaixo, a leitura (o "e daí?") do gráfico.
 */
export interface ChartCardProps extends Omit<React.HTMLAttributes<HTMLElement>, "title"> {
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  legend?: React.ReactNode;
  /** Leitura do gráfico, em uma frase factual. */
  insight?: React.ReactNode;
  footer?: React.ReactNode;
  loading?: boolean;
  /** Mensagem quando não há dados; substitui o desenho. */
  empty?: React.ReactNode;
  headingLevel?: 2 | 3 | 4;
  /** Altura reservada para o esqueleto, em px. */
  skeletonHeight?: number;
}

export function ChartCard({
  title, description, actions, legend, insight, footer, loading = false, empty, headingLevel = 3, skeletonHeight = 220,
  className, children, ...props
}: ChartCardProps) {
  const Heading = `h${headingLevel}` as const;
  const headingId = React.useId();
  return (
    <section
      aria-labelledby={headingId}
      aria-busy={loading || undefined}
      className={cn("flex min-w-0 flex-col rounded-lg border border-border bg-surface-raised text-fg shadow-card", className)}
      {...props}
    >
      <header className="flex flex-wrap items-start justify-between gap-3 px-4 pt-4">
        <div className="flex min-w-0 flex-col gap-0.5">
          <Heading id={headingId} className="text-card-title font-semibold text-fg">{title}</Heading>
          {description ? <p className="text-caption text-fg-muted">{description}</p> : null}
        </div>
        {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
      </header>
      {legend && !loading && !empty ? <div className="px-4 pt-3">{legend}</div> : null}
      <div className="min-w-0 flex-1 px-4 pb-4 pt-3">
        {loading ? (
          <div role="status" className="flex flex-col gap-2" style={{ height: skeletonHeight }}>
            <span className="sr-only">Carregando gráfico…</span>
            <span className="hfm-skeleton h-full w-full rounded-md" aria-hidden />
          </div>
        ) : empty ? (
          <div className="flex flex-col items-center justify-center gap-2 rounded-md border border-dashed border-border bg-surface-sunken/40 px-4 py-10 text-center">
            <BarChart3 className="size-5 text-fg-muted" aria-hidden />
            <p className="max-w-sm text-body-sm text-fg-muted">{empty}</p>
          </div>
        ) : (
          children
        )}
      </div>
      {insight && !loading && !empty ? (
        <p className="mx-4 mb-4 -mt-1 rounded-md bg-surface-secondary px-3 py-2 text-body-sm text-fg-secondary">{insight}</p>
      ) : null}
      {footer ? <div className="border-t border-border-subtle px-4 py-3 text-body-sm text-fg-secondary">{footer}</div> : null}
    </section>
  );
}
