"use client";

import * as React from "react";
import { cn } from "@/lib/cn";
import { fieldControlClasses } from "@/components/ui/input";

const useIsomorphicLayoutEffect = typeof window !== "undefined" ? React.useLayoutEffect : React.useEffect;

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  /** Grows with the content between `minRows` and `maxRows`. */
  autoResize?: boolean;
  /** Minimum visible rows. Defaults to `rows` or 3. */
  minRows?: number;
  /** Maximum visible rows before the textarea starts scrolling. */
  maxRows?: number;
}

/**
 * Textarea — same chrome as `Input`, with an optional auto-growing height.
 * The invalid state is driven by `aria-invalid="true"`, like every other field.
 */
export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { className, autoResize = false, minRows, maxRows = 10, rows, value, defaultValue, onChange, ...props },
  ref,
) {
  const innerRef = React.useRef<HTMLTextAreaElement | null>(null);
  const resolvedMinRows = minRows ?? rows ?? 3;

  const setRefs = React.useCallback(
    (node: HTMLTextAreaElement | null) => {
      innerRef.current = node;
      if (typeof ref === "function") ref(node);
      else if (ref) ref.current = node;
    },
    [ref],
  );

  const resize = React.useCallback(() => {
    const node = innerRef.current;
    if (!node || !autoResize) return;

    const styles = window.getComputedStyle(node);
    const lineHeight = Number.parseFloat(styles.lineHeight) || 20;
    const verticalPadding = Number.parseFloat(styles.paddingTop) + Number.parseFloat(styles.paddingBottom);
    const verticalBorder = Number.parseFloat(styles.borderTopWidth) + Number.parseFloat(styles.borderBottomWidth);
    const chrome = verticalPadding + verticalBorder;

    const min = resolvedMinRows * lineHeight + chrome;
    const max = maxRows * lineHeight + chrome;

    node.style.height = "auto";
    const next = Math.min(Math.max(node.scrollHeight + verticalBorder, min), max);
    node.style.height = `${next}px`;
    node.style.overflowY = node.scrollHeight + verticalBorder > max ? "auto" : "hidden";
  }, [autoResize, maxRows, resolvedMinRows]);

  useIsomorphicLayoutEffect(() => {
    resize();
  }, [resize, value, defaultValue]);

  const handleChange = React.useCallback(
    (event: React.ChangeEvent<HTMLTextAreaElement>) => {
      onChange?.(event);
      resize();
    },
    [onChange, resize],
  );

  return (
    <textarea
      ref={setRefs}
      rows={autoResize ? resolvedMinRows : rows}
      value={value}
      defaultValue={defaultValue}
      onChange={handleChange}
      className={cn(
        fieldControlClasses,
        "block px-3 py-2 text-body",
        autoResize ? "resize-none" : "min-h-20 resize-y",
        className,
      )}
      {...props}
    />
  );
});
