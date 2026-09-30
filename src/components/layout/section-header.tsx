import * as React from "react";
import { cn } from "@/lib/cn";

/**
 * SectionHeader — abre um nível da narrativa do painel (resultado, tendência,
 * onde está o desvio, detalhe). Título curto que diz a pergunta, uma linha de
 * contexto e, à direita, os controles que só valem para a seção.
 */
export interface SectionHeaderProps extends Omit<React.HTMLAttributes<HTMLDivElement>, "title"> {
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  /** Ícone lucide antes do título. */
  icon?: React.ReactNode;
  headingLevel?: 2 | 3;
}

export function SectionHeader({
  title, description, actions, icon, headingLevel = 2, className, ...props
}: SectionHeaderProps) {
  const Heading = `h${headingLevel}` as const;
  return (
    <div className={cn("flex flex-wrap items-end justify-between gap-x-4 gap-y-2", className)} {...props}>
      <div className="flex min-w-0 items-start gap-2.5">
        {icon ? (
          <span aria-hidden className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md bg-primary-soft text-primary-soft-fg [&_svg]:size-4">
            {icon}
          </span>
        ) : null}
        <div className="min-w-0">
          <Heading className="text-section-title font-semibold text-fg">{title}</Heading>
          {description ? <p className="mt-0.5 text-body-sm text-fg-muted">{description}</p> : null}
        </div>
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}
