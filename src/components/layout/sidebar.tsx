"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronDown, ChevronsLeft, ChevronsRight } from "lucide-react";
import { cn } from "@/lib/cn";
import { BrandLogo, BrandSymbol } from "@/components/brand/brand-logo";
import { IconButton } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Drawer, DrawerContent, DrawerTitle } from "@/components/ui/drawer";
import { VisuallyHidden } from "@radix-ui/react-visually-hidden";
import { visibleNavigation, isActivePath, type NavGroup, type NavItem } from "./navigation";
import { useAppShell } from "./app-shell-context";
import { usePersistedSet } from "@/lib/use-persisted-set";

const GROUPS_STORAGE_KEY = "hfm.nav.closed";
/** Nothing closed. Module-level so the snapshot keeps its identity. */
const ALL_OPEN: readonly string[] = [];

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
        "relative flex h-(--sidebar-item-height) items-center gap-2.5 rounded-sm text-body-sm hfm-transition",
        collapsed ? "w-10 justify-center px-0" : "px-2.5",
        active
          ? "bg-primary-soft font-semibold text-primary-soft-fg"
          : item.planned
            ? "font-medium text-fg-disabled"
            : "font-medium text-fg-secondary hover:bg-hover-overlay hover:text-fg",
      )}
    >
      {/* The active marker is a rule on the item's own left edge, not a filled
          block: at a glance you read "this one", not "this is a button". */}
      {active ? (
        <span aria-hidden className="absolute top-1.5 bottom-1.5 left-0 w-[3px] rounded-r-full bg-primary" />
      ) : null}
      <Icon
        className={cn("size-[18px] shrink-0", active ? "text-primary" : item.planned ? "" : "text-fg-muted")}
        strokeWidth={active ? 2 : 1.75}
        aria-hidden
      />
      {/* Recolhida, o ícone é aria-hidden e o rótulo não é pintado: sem isto o
          link chega ao leitor de tela sem nome nenhum. O tooltip resolve para
          quem vê o menu, não para quem o ouve. */}
      {collapsed ? (
        <span className="sr-only">{item.label}</span>
      ) : (
        <span className="truncate">{item.label}</span>
      )}
      {!collapsed && item.badge ? (
        <span className="ml-auto rounded-xs bg-secondary px-1.5 text-caption tabular-nums text-fg-secondary">
          {item.badge}
        </span>
      ) : null}
    </span>
  );

  const node = item.planned ? (
    <span aria-disabled="true" className="block cursor-default select-none">
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

  // Collapsed has no labels, and a planned module has to say why it does not
  // respond. Both are the same affordance, so both get the same tooltip.
  if (!collapsed && !item.planned) return node;

  return (
    <Tooltip>
      <TooltipTrigger asChild>{node}</TooltipTrigger>
      <TooltipContent side="right">
        {collapsed ? item.label : null}
        {item.planned ? (
          <span className={collapsed ? "ml-1 text-fg-muted" : undefined}>
            {collapsed ? "· em desenvolvimento" : "Módulo em desenvolvimento"}
          </span>
        ) : null}
      </TooltipContent>
    </Tooltip>
  );
}

/* -------------------------------------------------------------------------- */
/* Group                                                                      */
/* -------------------------------------------------------------------------- */

function SidebarGroup({
  group,
  collapsed,
  open,
  onToggle,
  onNavigate,
}: {
  group: NavGroup;
  collapsed: boolean;
  open: boolean;
  onToggle: () => void;
  onNavigate?: () => void;
}) {
  const listId = `nav-group-${group.id}`;

  // Collapsed leaves no room for a label, so the grouping is carried by a rule.
  if (collapsed) {
    return (
      <div className="flex flex-col items-center gap-1">
        {group.label ? <div aria-hidden className="my-1 h-px w-8 bg-border" /> : null}
        <ul className="flex flex-col items-center gap-1">
          {group.items.map((item) => (
            <li key={item.href}>
              <SidebarItem item={item} collapsed onNavigate={onNavigate} />
            </li>
          ))}
        </ul>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      {group.label ? (
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          aria-controls={listId}
          className={cn(
            "group relative flex h-7 w-full items-center rounded-xs pr-6 pl-2.5 text-overline font-semibold uppercase",
            "text-fg-muted hfm-transition hover:text-fg-secondary hfm-focus-ring",
          )}
        >
          {/* O rótulo carrega a hierarquia do menu, então ele leva a largura:
              "GOVERNANÇA OPERACIONAL" cortado ao meio deixa de ser um título.
              A seta sai do fluxo para não disputar espaço com ele. */}
          <span className="min-w-0 flex-1 truncate text-left">{group.label}</span>
          <ChevronDown
            aria-hidden
            className={cn(
              "absolute inset-y-0 right-1.5 my-auto size-3.5 shrink-0 opacity-0 hfm-transition",
              "group-hover:opacity-100 group-focus-visible:opacity-100",
              !open && "-rotate-90 opacity-100",
            )}
          />
        </button>
      ) : null}
      {open ? (
        <ul id={listId} className="flex flex-col gap-0.5">
          {group.items.map((item) => (
            <li key={item.href}>
              <SidebarItem item={item} collapsed={false} onNavigate={onNavigate} />
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Nav list (shared by desktop sidebar and mobile drawer)                     */
/* -------------------------------------------------------------------------- */

export function SidebarNav({ collapsed = false, onNavigate }: { collapsed?: boolean; onNavigate?: () => void }) {
  const { permissions, isPlatformAdmin } = useAppShell();
  const groups = React.useMemo(
    () => visibleNavigation(permissions, isPlatformAdmin),
    [permissions, isPlatformAdmin],
  );

  // Every group starts open: a menu that hides its own contents on first visit
  // is a menu nobody discovers. What someone closes is remembered, nothing else.
  const [closed, toggle] = usePersistedSet(GROUPS_STORAGE_KEY, ALL_OPEN);

  return (
    <nav aria-label="Navegação principal" className="flex flex-col gap-3 px-3">
      {groups.map((group) => (
        <SidebarGroup
          key={group.id}
          group={group}
          collapsed={collapsed}
          open={!closed.includes(group.id)}
          onToggle={() => toggle(group.id)}
          onNavigate={onNavigate}
        />
      ))}
    </nav>
  );
}

/* -------------------------------------------------------------------------- */
/* Footer                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Rodapé.
 *
 * Havia aqui um item "Configurações" desabilitado, que não levava a lugar nenhum
 * porque a rota não existe. Um item de menu que não responde ensina a pessoa a
 * desconfiar do menu — e a conta do usuário já está na Topbar, então duplicá-la
 * aqui também não serviria. Sobra a versão, que é informação de verdade.
 *
 * O controle de recolher mora aqui, e não junto da marca: a faixa superior tem
 * exatamente a altura da Topbar (56px) e recolhida ela precisa caber o símbolo
 * oficial inteiro. Empilhar marca e botão nessa faixa estourava os 56px e o
 * símbolo invadia a Topbar. Embaixo o botão tem a faixa inteira para si, fica
 * na mesma posição nos dois estados e não disputa espaço com nada.
 */
function SidebarFooter({
  collapsed,
  onToggleCollapsed,
}: {
  collapsed: boolean;
  onToggleCollapsed?: () => void;
}) {
  const label = collapsed ? "Expandir menu" : "Recolher menu";

  return (
    <div
      className={cn(
        "flex shrink-0 items-center gap-2 border-t border-border px-3 py-2",
        collapsed ? "justify-center" : "justify-between",
      )}
    >
      {!collapsed || !onToggleCollapsed ? (
        <span className="truncate text-caption text-fg-muted">{collapsed ? "v0.1" : "HFM · v0.1"}</span>
      ) : null}
      {onToggleCollapsed ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <IconButton
              label={label}
              variant="ghost"
              size="sm"
              onClick={onToggleCollapsed}
              aria-expanded={!collapsed}
            >
              {collapsed ? <ChevronsRight aria-hidden /> : <ChevronsLeft aria-hidden />}
            </IconButton>
          </TooltipTrigger>
          <TooltipContent side="right">{label}</TooltipContent>
        </Tooltip>
      ) : null}
    </div>
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
        "fixed inset-y-0 left-0 z-(--z-sidebar) hidden flex-col border-r border-border bg-surface-sidebar lg:flex",
        "w-(--sidebar-current-width) transition-[width] duration-(--duration-slow) ease-(--ease-standard)",
      )}
    >
      {/* A faixa da marca tem a altura da Topbar para que as duas comecem na
          mesma linha. Só a marca mora aqui — o controle de recolher está no
          rodapé, porque nesses 56px não cabem os dois quando recolhida. */}
      <div
        className={cn(
          "flex h-(--topbar-height) shrink-0 items-center overflow-hidden border-b border-border",
          collapsed ? "justify-center px-2" : "px-4",
        )}
      >
        <Link
          href="/dashboard"
          className="flex items-center rounded-sm outline-none hfm-focus-ring"
          aria-label="Horizonte Fleet Management — início"
        >
          {/* Recolhida, o lockup inteiro vira três pixels cinzentos: a faixa tem
              68px. O que aparece é o símbolo oficial, o mesmo do favicon. */}
          {collapsed ? <BrandSymbol height={20} /> : <BrandLogo height={36} />}
        </Link>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto py-4">
        <SidebarNav collapsed={collapsed} />
      </div>

      <SidebarFooter collapsed={collapsed} onToggleCollapsed={toggleCollapsed} />
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
      <DrawerContent side="left" size="sm" className="w-[min(86vw,304px)] bg-surface-sidebar">
        <VisuallyHidden>
          <DrawerTitle>Menu de navegação</DrawerTitle>
        </VisuallyHidden>
        <div className="flex h-(--topbar-height) shrink-0 items-center border-b border-border px-4">
          <BrandLogo height={36} />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto py-4">
          <SidebarNav onNavigate={() => setMobileOpen(false)} />
        </div>
        <SidebarFooter collapsed={false} />
      </DrawerContent>
    </Drawer>
  );
}
