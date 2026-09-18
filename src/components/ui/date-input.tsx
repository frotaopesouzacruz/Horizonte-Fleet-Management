"use client";

import * as React from "react";
import { Calendar } from "lucide-react";
import { cn } from "@/lib/cn";
import { inputVariants, type InputSize } from "@/components/ui/input";
import { useOptionalFormField } from "@/components/ui/form-field";

/**
 * Native date picker styled as `Input`.
 *
 * `color-scheme` is bound to the theme so the browser renders the calendar
 * popup, the date segments and the clear affordance with the right palette in
 * dark mode. The native indicator is kept (transparent) on top of the Calendar
 * icon so the whole affordance stays clickable.
 */
const nativeIndicatorClasses = [
  "[&::-webkit-calendar-picker-indicator]:absolute",
  "[&::-webkit-calendar-picker-indicator]:inset-y-0",
  "[&::-webkit-calendar-picker-indicator]:right-0",
  "[&::-webkit-calendar-picker-indicator]:h-full",
  "[&::-webkit-calendar-picker-indicator]:w-9",
  "[&::-webkit-calendar-picker-indicator]:cursor-pointer",
  "[&::-webkit-calendar-picker-indicator]:opacity-0",
  "[&::-webkit-inner-spin-button]:hidden",
  "[&::-webkit-date-and-time-value]:text-left",
].join(" ");

const iconOffset: Record<InputSize, string> = {
  sm: "right-2.5",
  md: "right-3",
  lg: "right-3.5",
};

export interface DateInputProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "size" | "type"> {
  /** Control height — matches `Input`. */
  size?: InputSize;
  /** Class names for the wrapper. */
  wrapperClassName?: string;
}

export const DateInput = React.forwardRef<HTMLInputElement, DateInputProps>(function DateInput(
  { className, wrapperClassName, size = "md", disabled, ...props },
  ref,
) {
  return (
    <div className={cn("relative flex w-full items-center", wrapperClassName)}>
      <input
        ref={ref}
        type="date"
        disabled={disabled}
        className={cn(
          inputVariants({ size }),
          "relative pr-9 [color-scheme:light] dark:[color-scheme:dark]",
          nativeIndicatorClasses,
          className,
        )}
        {...props}
      />
      <Calendar
        className={cn(
          "pointer-events-none absolute size-4 text-fg-muted",
          iconOffset[size],
          disabled && "text-fg-disabled",
        )}
        aria-hidden
      />
    </div>
  );
});

/* -------------------------------------------------------------------------- */

export interface DateRangeInputProps extends Omit<React.HTMLAttributes<HTMLDivElement>, "onChange"> {
  /** Accessible name of the group. */
  label?: string;
  /** Control height applied to both inputs. */
  size?: InputSize;
  /** Disables both inputs. */
  disabled?: boolean;
  /** Marks both inputs as invalid. */
  invalid?: boolean;
  /** Word rendered between the two inputs. */
  separator?: React.ReactNode;
  /** Props of the first (start) date input. */
  start?: DateInputProps;
  /** Props of the second (end) date input. */
  end?: DateInputProps;
}

/** DateRangeInput — two native date inputs read as a single labelled group. */
export const DateRangeInput = React.forwardRef<HTMLDivElement, DateRangeInputProps>(
  function DateRangeInput(
    {
      className,
      label = "Período",
      size = "md",
      disabled,
      invalid,
      separator = "até",
      start,
      end,
      id,
      "aria-invalid": ariaInvalid,
      "aria-required": ariaRequired,
      "aria-labelledby": ariaLabelledBy,
      ...props
    },
    ref,
  ) {
    // `FormField` wires the group through `id`/`aria-invalid`/`aria-required`;
    // all three belong on the inputs, not on the `role="group"` wrapper, which
    // does not support `aria-invalid`/`aria-required` at all.
    const isInvalid = invalid || ariaInvalid === true || ariaInvalid === "true";
    const invalidProps = isInvalid ? ({ "aria-invalid": true } as const) : null;
    const isRequired = ariaRequired === true || ariaRequired === "true";
    const requiredProps = isRequired ? ({ "aria-required": true } as const) : null;

    // The wrapper is a `role="group"`, which the field label's `htmlFor` cannot
    // name, so inside a `FormField` the group is named by that label and the
    // generic "Período" fallback is dropped.
    const field = useOptionalFormField();
    const labelledBy = ariaLabelledBy ?? field?.labelId;

    return (
      <div
        ref={ref}
        role="group"
        aria-label={labelledBy ? undefined : label}
        aria-labelledby={labelledBy}
        className={cn("flex w-full items-center gap-2", className)}
        {...props}
      >
        <DateInput
          size={size}
          disabled={disabled}
          id={id}
          aria-label="Data inicial"
          {...invalidProps}
          {...requiredProps}
          {...start}
          wrapperClassName={cn("flex-1", start?.wrapperClassName)}
        />
        <span
          className={cn(
            "shrink-0 text-body-sm select-none",
            disabled ? "text-fg-disabled" : "text-fg-muted",
          )}
        >
          {separator}
        </span>
        <DateInput
          size={size}
          disabled={disabled}
          aria-label="Data final"
          {...invalidProps}
          {...requiredProps}
          {...end}
          wrapperClassName={cn("flex-1", end?.wrapperClassName)}
        />
      </div>
    );
  },
);
