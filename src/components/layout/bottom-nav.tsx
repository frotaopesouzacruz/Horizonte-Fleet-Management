"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { History, Home, LayoutGrid, User } from "lucide-react";
import { cn } from "@/lib/cn";
import { isActivePath } from "./navigation";

const HISTORY = "/aplicativos/check-list-frota/meus-checklists";

const ITEMS = [
  { label: "Início", href: "/inicio", icon: Home },
  { label: "Aplicativos", href: "/aplicativos", icon: LayoutGrid },
  { label: "Histórico", href: HISTORY, icon: History },
  { label: "Perfil", href: "/perfil", icon: User },
] as const;

/**
 * Navegação inferior do Operacional no celular: Início, Aplicativos,
 * Histórico e Perfil — as quatro coisas que a pessoa faz no HFM, sempre à
 * mão, sem abrir menu. No desktop a sidebar assume.
 */
export function BottomNav() {
  const pathname = usePathname();
  const isActive = (href: string) =>
    href === "/aplicativos"
      ? pathname.startsWith("/aplicativos") && !isActivePath(pathname, HISTORY)
      : isActivePath(pathname, href);

  return (
    <nav
      aria-label="Navegação do celular"
      className="fixed inset-x-0 bottom-0 z-(--z-topbar) border-t border-border bg-surface-topbar pb-[env(safe-area-inset-bottom)] lg:hidden"
    >
      <ul className="grid grid-cols-4">
        {ITEMS.map((item) => {
          const active = isActive(item.href);
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex min-h-14 flex-col items-center justify-center gap-0.5 text-caption font-medium hfm-transition hfm-focus-ring",
                  active ? "text-primary" : "text-fg-muted hover:text-fg",
                )}
              >
                <item.icon aria-hidden className="size-5" />
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
