"use client";

import * as React from "react";
import { Check } from "lucide-react";
import { cn } from "@/lib/cn";

/**
 * SegmentedControl — escolha única entre 2–4 modos de exibição (Compacto /
 * Detalhado, Dia / Semana / Mês). Trilho tonal com o segmento ativo elevado,
 * a mesma linguagem das Tabs "segmented", mas sem painéis: é um radiogroup.
 * Setas movem a seleção; Tab sai do grupo.
 */
export interface SegmentedOption<T extends string> {
  value: T;
  label: React.ReactNode;
  icon?: React.ReactNode;
  /** Dica nativa (o que muda ao escolher). */
  title?: string;
  "data-testid"?: string;
}

export interface SegmentedControlProps<T extends string> {
  value: T;
  onValueChange: (value: T) => void;
  options: readonly SegmentedOption<T>[];
  "aria-label": string;
  disabled?: boolean;
  /** Permite quebrar em mais de uma linha (rótulos longos no celular). */
  wrap?: boolean;
  className?: string;
  "data-testid"?: string;
}

export function SegmentedControl<T extends string>({
  value,
  onValueChange,
  options,
  disabled,
  wrap = false,
  className,
  ...rest
}: SegmentedControlProps<T>) {
  const refs = React.useRef<(HTMLButtonElement | null)[]>([]);
  const move = (from: number, delta: number) => {
    const next = (from + delta + options.length) % options.length;
    onValueChange(options[next].value);
    refs.current[next]?.focus();
  };
  return (
    <div
      role="radiogroup"
      aria-label={rest["aria-label"]}
      data-testid={rest["data-testid"]}
      className={cn(
        "inline-flex w-fit max-w-full items-center gap-0.5 rounded-md border border-border-subtle bg-surface-interactive p-0.5",
        wrap && "flex-wrap",
        className,
      )}
    >
      {options.map((o, i) => {
        const checked = o.value === value;
        return (
          <button
            key={o.value}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={checked}
            tabIndex={checked ? 0 : -1}
            disabled={disabled}
            title={o.title}
            data-testid={o["data-testid"]}
            onClick={() => onValueChange(o.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowRight" || e.key === "ArrowDown") {
                e.preventDefault();
                move(i, 1);
              } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
                e.preventDefault();
                move(i, -1);
              }
            }}
            className={cn(
              "inline-flex h-7 items-center gap-1.5 rounded-sm px-2.5 text-body-sm font-medium whitespace-nowrap text-fg-secondary hfm-transition hfm-focus-ring",
              "hover:text-fg disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-3.5 [&_svg]:shrink-0",
              checked && "bg-surface-raised font-semibold text-fg shadow-selected",
            )}
          >
            {o.icon}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/**
 * ToggleChip — liga/desliga uma opção independente (coluna opcional, camada
 * do gráfico). Estado visível sem depender só da cor: marca de seleção.
 */
export interface ToggleChipProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "onChange"> {
  pressed: boolean;
  onPressedChange: (pressed: boolean) => void;
}

export function ToggleChip({ pressed, onPressedChange, className, children, ...props }: ToggleChipProps) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={() => onPressedChange(!pressed)}
      className={cn(
        "inline-flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-body-sm font-medium whitespace-nowrap hfm-transition hfm-focus-ring",
        "disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-3.5 [&_svg]:shrink-0",
        pressed
          ? "border-primary/40 bg-primary-soft text-primary-soft-fg"
          : "border-border bg-surface-raised text-fg-secondary shadow-xs hover:border-input-border-hover hover:text-fg",
        className,
      )}
      {...props}
    >
      <span
        aria-hidden
        className={cn(
          "flex size-3.5 items-center justify-center rounded-[4px] border",
          pressed ? "border-primary bg-primary text-primary-fg" : "border-border-emphasis bg-surface",
        )}
      >
        {pressed ? <Check className="size-2.5!" strokeWidth={3} /> : null}
      </span>
      {children}
    </button>
  );
}
