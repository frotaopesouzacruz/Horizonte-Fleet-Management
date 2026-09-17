"use client";

import * as React from "react";
import { Eye, EyeOff } from "lucide-react";
import { cn } from "@/lib/cn";
import { Input, type InputProps, type InputSize } from "@/components/ui/input";
import { IconButton } from "@/components/ui/button";

/**
 * PasswordInput — Input with a visibility toggle.
 *
 * `Input`'s icon slots are decorative (`pointer-events-none`, `aria-hidden`), so
 * an interactive affix needs its own control. The toggle is a real button: it is
 * focusable, labelled, and keeps the field's type in sync.
 */

const togglePosition: Record<InputSize, string> = {
  sm: "right-0.5",
  md: "right-1",
  lg: "right-1.5",
};

const toggleInset: Record<InputSize, string> = {
  sm: "pr-8",
  md: "pr-9",
  lg: "pr-11",
};

export interface PasswordInputProps extends Omit<InputProps, "type" | "trailingIcon" | "trailingAddon"> {
  /** Accessible name when the password is hidden. */
  showLabel?: string;
  /** Accessible name when the password is visible. */
  hideLabel?: string;
  /** Hides the toggle entirely (e.g. read-only summaries). */
  hideToggle?: boolean;
  /** Class names for the relative wrapper. */
  wrapperClassName?: string;
}

export const PasswordInput = React.forwardRef<HTMLInputElement, PasswordInputProps>(function PasswordInput(
  {
    className,
    wrapperClassName,
    size = "md",
    showLabel = "Mostrar senha",
    hideLabel = "Ocultar senha",
    hideToggle = false,
    disabled,
    ...props
  },
  ref,
) {
  const [visible, setVisible] = React.useState(false);
  const resolvedSize: InputSize = size ?? "md";

  if (hideToggle) {
    return <Input ref={ref} type="password" size={resolvedSize} disabled={disabled} className={className} {...props} />;
  }

  return (
    <span className={cn("relative flex w-full items-center", wrapperClassName)}>
      <Input
        ref={ref}
        type={visible ? "text" : "password"}
        size={resolvedSize}
        disabled={disabled}
        className={cn(toggleInset[resolvedSize], className)}
        {...props}
      />
      <IconButton
        label={visible ? hideLabel : showLabel}
        aria-pressed={visible}
        size="sm"
        variant="ghost"
        disabled={disabled}
        onClick={() => setVisible((current) => !current)}
        className={cn("absolute", togglePosition[resolvedSize])}
      >
        {visible ? <EyeOff /> : <Eye />}
      </IconButton>
    </span>
  );
});
