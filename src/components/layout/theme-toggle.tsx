"use client";

import * as React from "react";
import { Check, Monitor, Moon, Sun } from "lucide-react";
import { useTheme, type ThemePreference } from "@/design-system/theme/theme-provider";
import { IconButton } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const options: { value: ThemePreference; label: string; icon: React.ElementType }[] = [
  { value: "light", label: "Claro", icon: Sun },
  { value: "dark", label: "Escuro", icon: Moon },
  { value: "system", label: "Sistema", icon: Monitor },
];

/** Discreet theme selector: Claro · Escuro · Sistema. */
export function ThemeToggle({ className }: { className?: string }) {
  const { preference, resolved, mounted, setPreference } = useTheme();
  const Icon = !mounted ? Monitor : resolved === "dark" ? Moon : Sun;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <IconButton label="Alterar tema" variant="ghost" className={className}>
          <Icon aria-hidden />
        </IconButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-40">
        <DropdownMenuLabel>Tema</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {options.map(({ value, label, icon: OptionIcon }) => {
          const selected = preference === value;
          return (
            <DropdownMenuItem key={value} onSelect={() => setPreference(value)} aria-checked={selected} role="menuitemradio">
              <OptionIcon aria-hidden />
              <span>{label}</span>
              {selected ? <Check className="ml-auto text-primary" aria-hidden /> : null}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * Single-click light/dark switch, for the institutional surfaces (login,
 * recovery, password). A menu asking Claro/Escuro/Sistema is three decisions on
 * a screen whose only job is to let someone in; inside the product the full
 * ThemeToggle above still offers all three.
 *
 * The icon is the destination, not the current state: one click, one outcome.
 * `toggle()` writes an explicit light/dark preference, so "system" survives as
 * the default for anyone who never touched it and is simply resolved away once
 * they do.
 */
export function ThemeSwitch({ className }: { className?: string }) {
  const { resolved, mounted, toggle } = useTheme();
  const dark = resolved === "dark";

  // Before hydration the resolved theme is unknown; rendering the light-theme
  // icon and a neutral label avoids announcing an action that may be backwards.
  const Icon = mounted && dark ? Sun : Moon;
  const label = !mounted ? "Alterar tema" : dark ? "Ativar tema claro" : "Ativar tema escuro";

  return (
    <IconButton label={label} variant="ghost" className={className} onClick={toggle}>
      <Icon aria-hidden />
    </IconButton>
  );
}

/** Inline segmented variant for settings pages. */
export function ThemeSegmented({ className }: { className?: string }) {
  const { preference, setPreference, mounted } = useTheme();
  return (
    <div role="radiogroup" aria-label="Tema" className={`inline-flex rounded-sm border border-border bg-surface-secondary p-0.5 ${className ?? ""}`}>
      {options.map(({ value, label, icon: OptionIcon }) => {
        const selected = mounted && preference === value;
        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => setPreference(value)}
            className={
              "inline-flex h-7 items-center gap-1.5 rounded-xs px-2.5 text-body-sm font-medium hfm-transition hfm-focus-ring " +
              (selected ? "bg-surface text-fg shadow-xs" : "text-fg-secondary hover:text-fg")
            }
          >
            <OptionIcon className="size-4" aria-hidden />
            {label}
          </button>
        );
      })}
    </div>
  );
}
