import * as React from "react";
import { AppShellProvider, AppShellScript } from "./app-shell-context";
import { Sidebar, MobileSidebar } from "./sidebar";
import { Topbar, type TopbarProps } from "./topbar";
import type { PortalKind } from "@/lib/auth/portal";

export interface AppShellProps {
  children: React.ReactNode;
  topbar?: TopbarProps;
  /** Permission codes of the caller, used to filter the navigation. */
  permissions?: string[];
  isPlatformAdmin?: boolean;
  /** Menu e início da conta (Operacional, Liderança ou o de sempre). */
  portal?: PortalKind;
}

/**
 * AppShell — Sidebar (fixed, collapsible; drawer on mobile) + Topbar + main
 * content. The content area offsets by the sidebar width through CSS variables
 * driven by <html data-sidebar>, so there is no layout jump on load.
 */
export function AppShell({ children, topbar, permissions, isPlatformAdmin, portal = "management" }: AppShellProps) {
  return (
    <AppShellProvider permissions={permissions} isPlatformAdmin={isPlatformAdmin} portal={portal}>
      <AppShellScript />
      <div className="min-h-dvh bg-background">
        <Sidebar />
        <MobileSidebar />
        <div className="flex min-h-dvh flex-col transition-[padding] duration-(--duration-slow) ease-(--ease-standard) lg:pl-(--sidebar-current-width)">
          <Topbar variant={portal === "management" ? "full" : "portal"} {...topbar} />
          <main id="main" className="flex min-h-0 flex-1 flex-col">
            {children}
          </main>
        </div>
      </div>
    </AppShellProvider>
  );
}
