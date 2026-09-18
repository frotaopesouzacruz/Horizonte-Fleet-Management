"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronsLeft, ChevronsRight } from "lucide-react";
import { cn } from "@/lib/cn";
import { BrandLogo } from "@/components/brand/brand-logo";
import { IconButton } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Drawer, DrawerContent, DrawerTitle } from "@/components/ui/drawer";
import { VisuallyHidden } from "@radix-ui/react-visually-hidden";
import { navigation, isActivePath, type NavItem } from "./navigation";
import { useAppShell } from "./app-shell-context";

/* -------------------------------------------------------------------------- */
/* Nav item                                                                   */
/* -------------------------------------------------------------------------- */

function SidebarItem({ item, collapsed, onNavigate }: { item: NavItem; collapsed: boolean; onNavigate?: () => void }) {
  const pathname = usePathname();
  const active = !item.planned && isActivePath(pathname, item.href);
  const Icon = item.icon;

  const content = (
    <span
      className={cn(
        "relative flex h-[34px] items-center gap-3 rounded-sm px-2.5 text-body-sm font-medium hfm-transition",
        collapsed && "justify-center px-0",
        active
          ? "bg-primary-soft text-primary-soft-fg"
          : item.planned
            ? "text-fg-disabled"
            : "text-fg-secondary hover:bg-secondary hover:text-fg",
      )}
    >
      {active ? <span aria-hidden className="absolute top-1.5 bottom-1.5 -left-2 w-0.5 rounded-r bg-primary" /> : null}
      <Icon className="size-[18px] shrink-0" strokeWidth={1.75} aria-hidden />
      {!collapsed ? <span className="truncate">{item.label}</span> : null}
      {!collapsed && item.badge ? (
        <span className="ml-auto rounded-xs bg-secondary px-1.5 text-caption tabular-nums text-fg-secondary">{item.badge}</span>
      ) : null}
    </span>
  );

  const node = item.planned ? (
    <span
      aria-disabled="true"
      title={collapsed ? undefined : "Módulo em desenvolvimento"}
      className="block cursor-default select-none"
    >
      {content}
    </span>
  ) : (
    <Link
      href={item.href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      className="block rounded-sm outline-none hfm-focus-ring"
    >
      {content}
    </Link>
  );

  if (!collapsed) return node;

  return (
    <Tooltip>
      <TooltipTrigger asChild>{node}</TooltipTrigger>
      <TooltipContent side="right">
        {item.label}
        {item.planned ? <span className="ml-1 text-fg-muted">· em desenvolvimento</span> : null}
      </TooltipContent>
    </Tooltip>
  );
}

/* -------------------------------------------------------------------------- */
/* Nav list (shared by desktop sidebar and mobile drawer)                     */
/* -------------------------------------------------------------------------- */

export function SidebarNav({ collapsed = false, onNavigate }: { collapsed?: boolean; onNavigate?: () => void }) {
  return (
    <nav aria-label="Navegação principal" className="flex flex-col gap-4 px-2">
      {navigation.map((group) => (
        <div key={group.id} className="flex flex-col gap-0.5">
          {group.label ? (
            collapsed ? (
              <div aria-hidden className="mx-2 my-1 h-px bg-border" />
            ) : (
              <h2 className="px-2.5 pt-1 pb-1.5 text-[11px] font-semibold tracking-wide text-fg-muted uppercase">{group.label}</h2>
            )
          ) : null}
          <ul className="flex flex-col gap-0.5">
            {group.items.map((item) => (
              <li key={item.href}>
                <SidebarItem item={item} collapsed={collapsed} onNavigate={onNavigate} />
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );
}

/* -------------------------------------------------------------------------- */
/* Desktop sidebar                                                            */
/* -------------------------------------------------------------------------- */

export function Sidebar() {
  const { collapsed, toggleCollapsed } = useAppShell();

  return (
    <aside
      data-collapsed={collapsed || undefined}
      className={cn(
        "hidden lg:flex fixed inset-y-0 left-0 z-(--z-sidebar) flex-col border-r border-border bg-surface-sidebar",
        "w-(--sidebar-current-width) transition-[width] duration-(--duration-slow) ease-(--ease-standard)",
      )}
    >
      <div className={cn("flex h-(--topbar-height) shrink-0 items-center border-b border-border px-4", collapsed && "justify-center px-0")}>
        <Link href="/dashboard" className="flex items-center rounded-sm outline-none hfm-focus-ring" aria-label="Horizonte Fleet Management — início">
          <BrandLogo compact={collapsed} height={collapsed ? 26 : 38} />
        </Link>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto py-3">
        <SidebarNav collapsed={collapsed} />
      </div>

      <div className={cn("flex shrink-0 items-center border-t border-border p-2", collapsed ? "justify-center" : "justify-between")}>
        {!collapsed ? <span className="px-1.5 text-caption text-fg-muted">HFM · v0.1</span> : null}
        <IconButton
          label={collapsed ? "Expandir menu" : "Recolher menu"}
          variant="ghost"
          size="sm"
          onClick={toggleCollapsed}
          aria-expanded={!collapsed}
        >
          {collapsed ? <ChevronsRight aria-hidden /> : <ChevronsLeft aria-hidden />}
        </IconButton>
      </div>
    </aside>
  );
}

/* -------------------------------------------------------------------------- */
/* Mobile drawer                                                              */
/* -------------------------------------------------------------------------- */

export function MobileSidebar() {
  const { mobileOpen, setMobileOpen } = useAppShell();
  return (
    <Drawer open={mobileOpen} onOpenChange={setMobileOpen}>
      <DrawerContent side="left" size="sm" className="w-[min(85vw,300px)] bg-surface-sidebar">
        <VisuallyHidden>
          <DrawerTitle>Menu de navegação</DrawerTitle>
        </VisuallyHidden>
        <div className="flex h-(--topbar-height) shrink-0 items-center border-b border-border px-4">
          <BrandLogo height={38} />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto py-3">
          <SidebarNav onNavigate={() => setMobileOpen(false)} />
        </div>
      </DrawerContent>
    </Drawer>
  );
}
