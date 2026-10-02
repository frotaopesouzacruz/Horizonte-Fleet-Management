import * as React from "react";
import { AlertOctagon, AlertTriangle, CheckCircle2, Info, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/cn";

/**
 * InsightCard — uma leitura determinística dos dados ("8 veículos estão há mais
 * de 3 dias sem atualização de KM"), com tom de negócio. Nunca um texto
 * genérico ou fictício: quem chama só passa o que foi calculado.
 *
 * Tons: positivo (success), atenção (warning), crítico (danger) e informativo
 * (info). O tom aparece no marcador lateral e no ícone; o texto fica na cor do
 * texto — a cor acompanha, não carrega a informação.
 */
export type InsightTone = "success" | "warning" | "danger" | "info" | "neutral";

const TONE: Record<InsightTone, { icon: LucideIcon; label: string; bar: string; chip: string }> = {
  success: { icon: CheckCircle2, label: "Positivo", bar: "bg-success", chip: "bg-success-soft text-success-soft-fg" },
  warning: { icon: AlertTriangle, label: "Atenção", bar: "bg-warning", chip: "bg-warning-soft text-warning-soft-fg" },
  danger: { icon: AlertOctagon, label: "Crítico", bar: "bg-danger", chip: "bg-danger-soft text-danger-soft-fg" },
  info: { icon: Info, label: "Informativo", bar: "bg-info", chip: "bg-info-soft text-info-soft-fg" },
  neutral: { icon: Info, label: "Leitura", bar: "bg-neutral", chip: "bg-neutral-soft text-neutral-soft-fg" },
};

export interface InsightCardProps extends Omit<React.HTMLAttributes<HTMLDivElement>, "title"> {
  tone?: InsightTone;
  /** Rótulo do tom (padrão: Positivo / Atenção / Crítico / Informativo). */
  label?: React.ReactNode;
  title?: React.ReactNode;
  /** O fato, em uma frase. */
  children: React.ReactNode;
  /** Ação ligada ao fato (um botão ou link pequeno). */
  action?: React.ReactNode;
  icon?: React.ReactNode;
  compact?: boolean;
}

export function InsightCard({
  tone = "info",
  label,
  title,
  children,
  action,
  icon,
  compact = false,
  className,
  ...props
}: InsightCardProps) {
  const t = TONE[tone];
  const Icon = t.icon;
  return (
    <div
      data-tone={tone}
      className={cn(
        "relative flex min-w-0 items-start gap-3 overflow-hidden rounded-lg border border-border bg-surface-raised shadow-card",
        compact ? "py-2.5 pr-3 pl-4" : "py-3.5 pr-4 pl-5",
        className,
      )}
      {...props}
    >
      <span aria-hidden className={cn("absolute inset-y-0 left-0 w-1", t.bar)} />
      <span
        aria-hidden
        className={cn("flex shrink-0 items-center justify-center rounded-md [&_svg]:size-4", compact ? "size-7" : "size-8", t.chip)}
      >
        {icon ?? <Icon />}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <p className="text-overline font-semibold tracking-wide text-fg-muted uppercase">{label ?? t.label}</p>
        {title ? <p className="text-body-sm font-semibold text-fg">{title}</p> : null}
        <div className="text-body-sm text-fg-secondary">{children}</div>
        {action ? <div className="mt-1.5 flex flex-wrap items-center gap-2">{action}</div> : null}
      </div>
    </div>
  );
}

/** Lista de insights em grade responsiva. */
export function InsightList({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("grid grid-cols-1 gap-3 md:grid-cols-2", className)} {...props} />;
}
