"use client";

import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from "lucide-react";
import { cn } from "@/lib/cn";
import { IconButton } from "@/components/ui/button";

/**
 * Alert — a persistent message attached to the content it concerns (a form, a
 * panel, a page header). Transient feedback belongs in a toast; blocking
 * questions belong in a `ConfirmDialog`.
 *
 * ```tsx
 * <Alert variant="warning" onDismiss={dismiss} action={<Button size="sm" variant="outline">Revisar</Button>}>
 *   <AlertTitle>3 veículos com CRLV vencido</AlertTitle>
 *   <AlertDescription>Eles continuam na operação, mas não podem circular até a regularização.</AlertDescription>
 * </Alert>
 * ```
 */

export const alertVariants = cva("relative flex w-full items-start gap-2.5 rounded-md border p-3 text-body-sm", {
  variants: {
    variant: {
      info: "border-info/25 bg-info-soft text-info-soft-fg",
      success: "border-success/25 bg-success-soft text-success-soft-fg",
      warning: "border-warning/30 bg-warning-soft text-warning-soft-fg",
      danger: "border-danger/25 bg-danger-soft text-danger-soft-fg",
      neutral: "border-border bg-neutral-soft text-neutral-soft-fg",
    },
  },
  defaultVariants: { variant: "info" },
});

export type AlertVariant = NonNullable<VariantProps<typeof alertVariants>["variant"]>;

const alertIcons: Record<AlertVariant, React.ElementType> = {
  info: Info,
  success: CheckCircle2,
  warning: AlertTriangle,
  danger: XCircle,
  neutral: Info,
};

/** The icon carries the tone at full strength; the body stays on the soft foreground. */
const alertIconTone: Record<AlertVariant, string> = {
  info: "text-info",
  success: "text-success",
  warning: "text-warning",
  danger: "text-danger",
  neutral: "text-fg-secondary",
};

export interface AlertProps extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof alertVariants> {
  /** Overrides the variant icon. Pass `null` to drop it. */
  icon?: React.ReactNode | null;
  /** Adds a close button on the right. */
  onDismiss?: () => void;
  dismissLabel?: string;
  /** Low-emphasis action rendered below the text (a `Button size="sm"` or a link). */
  action?: React.ReactNode;
}

export const Alert = React.forwardRef<HTMLDivElement, AlertProps>(function Alert(
  { className, variant = "info", icon, onDismiss, dismissLabel = "Dispensar", action, children, role, ...props },
  ref,
) {
  const tone: AlertVariant = variant ?? "info";
  const Icon = alertIcons[tone];

  return (
    <div
      ref={ref}
      role={role ?? (tone === "danger" ? "alert" : "status")}
      className={cn(alertVariants({ variant: tone }), className)}
      {...props}
    >
      {icon !== null ? (
        <span className={cn("mt-0.5 shrink-0 [&_svg]:size-4", alertIconTone[tone])} aria-hidden>
          {icon ?? <Icon />}
        </span>
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        {children}
        {action ? <div className="mt-2 flex flex-wrap items-center gap-2">{action}</div> : null}
      </div>

      {onDismiss ? (
        <IconButton
          label={dismissLabel}
          variant="ghost"
          size="sm"
          onClick={onDismiss}
          className="-my-0.5 -mr-1 shrink-0 text-current hover:bg-hover-overlay hover:text-current"
        >
          <X aria-hidden />
        </IconButton>
      ) : null}
    </div>
  );
});

/* -------------------------------------------------------------------------- */

export const AlertTitle = React.forwardRef<HTMLParagraphElement, React.HTMLAttributes<HTMLParagraphElement>>(
  function AlertTitle({ className, ...props }, ref) {
    return <p ref={ref} className={cn("text-body-sm font-semibold", className)} {...props} />;
  },
);

export const AlertDescription = React.forwardRef<HTMLParagraphElement, React.HTMLAttributes<HTMLParagraphElement>>(
  function AlertDescription({ className, ...props }, ref) {
    return <p ref={ref} className={cn("text-body-sm", className)} {...props} />;
  },
);
