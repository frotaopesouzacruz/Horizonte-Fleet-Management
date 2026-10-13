import * as React from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { cn } from "@/lib/cn";

/** Tom do chip do ícone — só tokens semânticos, nunca cor solta. */
export type ShortcutTone = "primary" | "info" | "warning" | "highlight" | "success" | "neutral";

const CHIP: Record<ShortcutTone, string> = {
  primary: "bg-primary-soft text-primary-soft-fg",
  info: "bg-info-soft text-info-soft-fg",
  warning: "bg-warning-soft text-warning-soft-fg",
  highlight: "bg-highlight-soft text-highlight-soft-fg",
  success: "bg-success-soft text-success-soft-fg",
  neutral: "bg-surface-interactive text-fg-secondary",
};

/**
 * Atalho do Início: o cartão inteiro é o link (alvo de toque de 64px, como
 * no HFC). `featured` é o atalho principal — "Abrir o App de Checklist" —,
 * com o ícone em chip sólido e a borda na cor da marca.
 */
export function ShortcutCard({
  href,
  title,
  description,
  icon,
  tone = "neutral",
  featured = false,
  testId,
}: {
  href: string;
  title: string;
  description?: React.ReactNode;
  icon: React.ReactNode;
  tone?: ShortcutTone;
  featured?: boolean;
  testId?: string;
}) {
  return (
    <Link
      href={href}
      data-testid={testId}
      className={cn(
        "group relative flex items-center gap-3 rounded-xl border p-3.5 shadow-card outline-none hfm-transition hfm-focus-ring",
        "hover:-translate-y-px hover:shadow-card-hover",
        featured
          ? "min-h-[76px] border-border-emphasis bg-primary-soft hover:border-primary"
          : "min-h-16 border-border bg-surface-raised hover:border-border-emphasis",
      )}
    >
      <span
        aria-hidden
        className={cn(
          "flex shrink-0 items-center justify-center rounded-lg [&_svg]:shrink-0",
          featured ? "size-12 bg-primary text-primary-fg [&_svg]:size-6" : cn("size-10 [&_svg]:size-5", CHIP[tone]),
        )}
      >
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span
          className={cn(
            "block font-semibold text-fg",
            featured ? "text-body md:text-section-title" : "text-body-sm",
          )}
        >
          {title}
        </span>
        {description ? (
          <span className={cn("mt-0.5 block text-fg-muted", featured ? "text-body-sm" : "text-caption")}>{description}</span>
        ) : null}
      </span>
      <ArrowRight
        aria-hidden
        className={cn(
          "size-5 shrink-0 hfm-transition group-hover:translate-x-0.5",
          featured ? "text-primary" : "text-fg-muted",
        )}
      />
    </Link>
  );
}

/** Seção do Início: título curto, uma linha de contexto e o conteúdo. */
export function HomeSection({
  id,
  title,
  description,
  icon,
  actions,
  children,
  testId,
}: {
  id: string;
  title: React.ReactNode;
  description?: React.ReactNode;
  icon?: React.ReactNode;
  actions?: React.ReactNode;
  children: React.ReactNode;
  testId?: string;
}) {
  const headingId = `${id}-titulo`;
  return (
    <section id={id} aria-labelledby={headingId} className="flex scroll-mt-20 flex-col gap-3" data-testid={testId}>
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
        <div className="flex min-w-0 items-start gap-2.5">
          {icon ? (
            <span
              aria-hidden
              className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md bg-primary-soft text-primary-soft-fg [&_svg]:size-4"
            >
              {icon}
            </span>
          ) : null}
          <div className="min-w-0">
            <h2 id={headingId} className="text-section-title font-semibold text-fg">
              {title}
            </h2>
            {description ? <p className="mt-0.5 text-body-sm text-fg-muted">{description}</p> : null}
          </div>
        </div>
        {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
      {children}
    </section>
  );
}
