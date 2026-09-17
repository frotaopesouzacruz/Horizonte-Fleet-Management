import * as React from "react";
import { AppShellProvider, AppShellScript } from "./app-shell-context";
import { Sidebar, MobileSidebar } from "./sidebar";
import { Topbar, type TopbarProps } from "./topbar";

export interface AppShellProps {
  children: React.ReactNode;
  topbar?: TopbarProps;
}

/**
 * AppShell — Sidebar (fixed, collapsible; drawer on mobile) + Topbar + main
 * content. The content area offsets by the sidebar width through CSS variables
 * driven by <html data-sidebar>, so there is no layout jump on load.
 */
export function AppShell({ children, topbar }: AppShellProps) {
  return (
    <AppShellProvider>
      <AppShellScript />
      <div className="min-h-dvh bg-background">
        <Sidebar />
        <MobileSidebar />
        <div className="flex min-h-dvh flex-col lg:pl-(--sidebar-width) lg:[html[data-sidebar=collapsed]_&]:pl-(--sidebar-width-collapsed) transition-[padding] duration-(--duration-slow) ease-(--ease-standard)">
          <Topbar {...topbar} />
          <main id="main" className="flex min-h-0 flex-1 flex-col">
            {children}
          </main>
        </div>
      </div>
    </AppShellProvider>
  );
}
