"use client";

import * as React from "react";

export const SIDEBAR_STORAGE_KEY = "hfm.sidebar.collapsed";
const EVENT = "hfm:sidebar";

function readCollapsed(): boolean {
  if (typeof document === "undefined") return false;
  return document.documentElement.dataset.sidebar === "collapsed";
}

function subscribe(callback: () => void) {
  window.addEventListener(EVENT, callback);
  return () => window.removeEventListener(EVENT, callback);
}

interface AppShellContextValue {
  collapsed: boolean;
  setCollapsed: (value: boolean) => void;
  toggleCollapsed: () => void;
  mobileOpen: boolean;
  setMobileOpen: (value: boolean) => void;
}

const AppShellContext = React.createContext<AppShellContextValue | null>(null);

/**
 * Sidebar state. The collapsed preference is applied to <html data-sidebar>
 * by an inline script before paint (see AppShellScript) and persisted in
 * localStorage, so the layout never jumps on load.
 */
export function AppShellProvider({ children }: { children: React.ReactNode }) {
  const collapsed = React.useSyncExternalStore(subscribe, readCollapsed, () => false);
  const [mobileOpen, setMobileOpen] = React.useState(false);

  const setCollapsed = React.useCallback((value: boolean) => {
    document.documentElement.dataset.sidebar = value ? "collapsed" : "expanded";
    try {
      window.localStorage.setItem(SIDEBAR_STORAGE_KEY, value ? "1" : "0");
    } catch {
      /* storage unavailable: preference is session-only */
    }
    window.dispatchEvent(new Event(EVENT));
  }, []);

  const value = React.useMemo(
    () => ({
      collapsed,
      setCollapsed,
      toggleCollapsed: () => setCollapsed(!collapsed),
      mobileOpen,
      setMobileOpen,
    }),
    [collapsed, setCollapsed, mobileOpen],
  );

  return <AppShellContext.Provider value={value}>{children}</AppShellContext.Provider>;
}

export function useAppShell(): AppShellContextValue {
  const ctx = React.useContext(AppShellContext);
  if (!ctx) throw new Error("useAppShell must be used inside <AppShellProvider>");
  return ctx;
}

/** Inline, blocking script: restores the sidebar preference before first paint. */
export function AppShellScript() {
  const code = `try{var v=localStorage.getItem(${JSON.stringify(SIDEBAR_STORAGE_KEY)});document.documentElement.dataset.sidebar=v==="1"?"collapsed":"expanded"}catch(e){}`;
  return <script dangerouslySetInnerHTML={{ __html: code }} />;
}
