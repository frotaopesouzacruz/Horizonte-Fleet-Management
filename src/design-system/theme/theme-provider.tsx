"use client";

import * as React from "react";
import { ThemeProvider as NextThemesProvider, useTheme as useNextTheme } from "next-themes";

export type ThemePreference = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

export const THEME_STORAGE_KEY = "hfm.theme";

/**
 * Centralized theme management for the whole application.
 * - preference: light | dark | system (persisted in localStorage under `hfm.theme`)
 * - resolution order: user preference → OS preference → light
 * - applies the `.dark` class on <html> before hydration (no theme flash)
 */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
      storageKey={THEME_STORAGE_KEY}
      themes={["light", "dark"]}
    >
      {children}
    </NextThemesProvider>
  );
}

export interface UseThemeResult {
  /** The stored preference (light | dark | system). Undefined until mounted. */
  preference: ThemePreference | undefined;
  /** The theme actually applied to the document. Undefined until mounted. */
  resolved: ResolvedTheme | undefined;
  /** True once the client knows the real theme (avoid rendering theme-dependent UI before). */
  mounted: boolean;
  setPreference: (theme: ThemePreference) => void;
  toggle: () => void;
}

/** Never notifies: the value only differs between the server and the client. */
const neverSubscribe = () => () => {};

export function useTheme(): UseThemeResult {
  const { theme, resolvedTheme, setTheme } = useNextTheme();
  // Hydration-safe "are we on the client yet" without setState in an effect:
  // the server snapshot is false, the client snapshot is true.
  const mounted = React.useSyncExternalStore(
    neverSubscribe,
    () => true,
    () => false,
  );

  return {
    preference: mounted ? (theme as ThemePreference | undefined) : undefined,
    resolved: mounted ? (resolvedTheme as ResolvedTheme | undefined) : undefined,
    mounted,
    setPreference: (t) => setTheme(t),
    toggle: () => setTheme(resolvedTheme === "dark" ? "light" : "dark"),
  };
}
