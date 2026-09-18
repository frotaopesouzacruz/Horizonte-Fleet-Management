"use client";

import * as React from "react";

/**
 * A set of strings kept in localStorage — closed sidebar groups, hidden table
 * columns — read through `useSyncExternalStore` rather than an effect.
 *
 * The naive version (state, then read storage in an effect) renders the default
 * once and the stored value a frame later, which shows as a menu that opens and
 * then collapses. `useSyncExternalStore` renders the server snapshot during
 * hydration and the real value immediately after, with no intermediate commit.
 *
 * Storage is per-browser and can throw or come back empty — private windows,
 * blocked site data — so every access is guarded and the fallback is a working
 * default, never an error.
 */
const CHANGE_EVENT = "hfm:persisted-set";

function parse(raw: string | null, fallback: readonly string[]): string[] {
  if (!raw) return [...fallback];
  try {
    const value: unknown = JSON.parse(raw);
    return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [...fallback];
  } catch {
    return [...fallback];
  }
}

export function usePersistedSet(
  key: string,
  /** Must be referentially stable — a module constant or a memo. */
  fallback: readonly string[],
): readonly [string[], (entry: string) => void] {
  // getSnapshot has to return the same reference until the data actually
  // changes, or React re-renders forever. The raw string is the change signal.
  const cache = React.useRef<{ raw: string | null; value: string[] } | null>(null);

  const getSnapshot = React.useCallback(() => {
    let raw: string | null = null;
    try {
      raw = window.localStorage.getItem(key);
    } catch {
      raw = null;
    }
    if (!cache.current || cache.current.raw !== raw) {
      cache.current = { raw, value: parse(raw, fallback) };
    }
    return cache.current.value;
  }, [key, fallback]);

  const getServerSnapshot = React.useCallback(() => fallback as string[], [fallback]);

  const subscribe = React.useCallback((onChange: () => void) => {
    // `storage` covers another tab; the custom event covers this one, which the
    // browser does not notify about.
    window.addEventListener("storage", onChange);
    window.addEventListener(CHANGE_EVENT, onChange);
    return () => {
      window.removeEventListener("storage", onChange);
      window.removeEventListener(CHANGE_EVENT, onChange);
    };
  }, []);

  const value = React.useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const toggle = React.useCallback(
    (entry: string) => {
      const current = getSnapshot();
      const next = current.includes(entry) ? current.filter((item) => item !== entry) : [...current, entry];
      try {
        window.localStorage.setItem(key, JSON.stringify(next));
      } catch {
        // Not worth failing a click over; the change simply is not remembered.
      }
      window.dispatchEvent(new Event(CHANGE_EVENT));
    },
    [key, getSnapshot],
  );

  return [value, toggle] as const;
}
