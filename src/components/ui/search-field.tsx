"use client";

import * as React from "react";
import { Search, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { IconButton } from "@/components/ui/button";
import { Input, type InputProps, type InputSize } from "@/components/ui/input";
import { useOptionalFormField } from "@/components/ui/form-field";

const clearButtonSize: Record<InputSize, "sm" | "md"> = { sm: "sm", md: "sm", lg: "md" };

export interface SearchFieldProps
  extends Omit<InputProps, "type" | "leadingIcon" | "trailingIcon" | "leadingAddon" | "trailingAddon"> {
  /** Convenience callback with the current text, fired on every change and on clear. */
  onValueChange?: (value: string) => void;
  /** Called after the field is cleared by the clear button. */
  onClear?: () => void;
  /** Keyboard shortcut rendered as a <kbd> while the field is empty, e.g. "⌘K". */
  shortcutHint?: React.ReactNode;
  /** Accessible name of the clear button. */
  clearLabel?: string;
  /** Class names for the wrapper. */
  wrapperClassName?: string;
}

/**
 * SearchField — search input with a leading icon, a clear button that appears
 * once there is a value and an optional shortcut hint. Works controlled and
 * uncontrolled: clearing dispatches a native input event so `onChange` fires
 * in both cases.
 */
export const SearchField = React.forwardRef<HTMLInputElement, SearchFieldProps>(function SearchField(
  {
    className,
    wrapperClassName,
    size = "md",
    value,
    defaultValue,
    onChange,
    onValueChange,
    onClear,
    shortcutHint,
    clearLabel = "Limpar busca",
    disabled,
    "aria-label": ariaLabel,
    "aria-labelledby": ariaLabelledBy,
    ...props
  },
  ref,
) {
  const resolvedSize: InputSize = size ?? "md";
  // Inside a `FormField` the visible label already names the input; the generic
  // "Buscar" fallback would override it and break "label in name".
  const field = useOptionalFormField();
  const isLabelledElsewhere = Boolean(ariaLabelledBy || field?.labelId);
  const innerRef = React.useRef<HTMLInputElement | null>(null);
  const [uncontrolledFilled, setUncontrolledFilled] = React.useState(() => String(defaultValue ?? "").length > 0);

  const isControlled = value !== undefined;
  const hasValue = isControlled ? String(value ?? "").length > 0 : uncontrolledFilled;

  const setRefs = React.useCallback(
    (node: HTMLInputElement | null) => {
      innerRef.current = node;
      if (typeof ref === "function") ref(node);
      else if (ref) ref.current = node;
    },
    [ref],
  );

  function handleChange(event: React.ChangeEvent<HTMLInputElement>) {
    if (!isControlled) setUncontrolledFilled(event.target.value.length > 0);
    onChange?.(event);
    onValueChange?.(event.target.value);
  }

  function handleClear() {
    const node = innerRef.current;
    if (node) {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
      setter?.call(node, "");
      node.dispatchEvent(new Event("input", { bubbles: true }));
      node.focus();
    }
    if (!isControlled) setUncontrolledFilled(false);
    onClear?.();
  }

  return (
    <div className={cn("relative flex w-full items-center", wrapperClassName)}>
      <Input
        ref={setRefs}
        type="search"
        size={resolvedSize}
        value={value}
        defaultValue={defaultValue}
        onChange={handleChange}
        disabled={disabled}
        leadingIcon={<Search aria-hidden />}
        className={cn(
          "[&::-webkit-search-cancel-button]:hidden [&::-webkit-search-decoration]:hidden",
          shortcutHint ? "pr-16" : "pr-9",
          className,
        )}
        {...props}
        aria-labelledby={ariaLabelledBy}
        aria-label={ariaLabel ?? (isLabelledElsewhere ? undefined : "Buscar")}
      />

      <div className="absolute inset-y-0 right-1 flex items-center">
        {hasValue && !disabled ? (
          <IconButton
            variant="ghost"
            size={clearButtonSize[resolvedSize]}
            label={clearLabel}
            onClick={handleClear}
            className="text-fg-muted hover:text-fg"
          >
            <X className="size-4" aria-hidden />
          </IconButton>
        ) : shortcutHint ? (
          <kbd
            className={cn(
              "pointer-events-none mr-1.5 inline-flex h-5 items-center rounded-xs border border-border bg-surface-secondary",
              "px-1.5 font-sans text-caption font-medium text-fg-muted select-none",
              disabled && "text-fg-disabled",
            )}
          >
            {shortcutHint}
          </kbd>
        ) : null}
      </div>
    </div>
  );
});
