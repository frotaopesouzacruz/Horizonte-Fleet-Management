import type { LucideIcon } from "lucide-react";
import {
  BarChart3,
  CircleDot,
  ClipboardCheck,
  Fuel,
  LayoutDashboard,
  Network,
  ShieldAlert,
  ShieldCheck,
  Truck,
  Users,
  Wrench,
  type LucideProps,
} from "lucide-react";

export type NavIcon = LucideIcon | React.ForwardRefExoticComponent<LucideProps>;

export interface NavItem {
  label: string;
  href: string;
  icon: NavIcon;
  /** Marks a module that is not implemented yet (rendered muted, non-clickable). */
  planned?: boolean;
  badge?: string;
  /**
   * Permission code required to see the entry. Hiding a menu item is a courtesy,
   * never the boundary: the route re-checks it and RLS enforces it.
   */
  permission?: string;
}

export interface NavGroup {
  id: string;
  label?: string;
  items: NavItem[];
}

/**
 * Filters the navigation for a set of permissions, dropping groups that end up
 * empty. Entries without a `permission` are visible to every member.
 */
export function visibleNavigation(permissions: string[], isPlatformAdmin = false): NavGroup[] {
  const allowed = (item: NavItem) =>
    !item.permission || isPlatformAdmin || permissions.includes(item.permission);

  return navigation
    .map((group) => ({ ...group, items: group.items.filter(allowed) }))
    .filter((group) => group.items.length > 0);
}

/**
 * Navigation model of the product.
 *
 * Two groups, because there are two kinds of thing here. Administração is what
 * the company is — the operations it runs, the people and the fleet attached to
 * each. Módulos futuros is what the product will do with all that, and every
 * entry in it is still a placeholder.
 *
 * There is no Estados or Cidades entry, and there must not be one. The IBGE
 * tables exist and are used, but a state is not something anyone administers:
 * it is a dimension of an operation's coverage, chosen inside the operation.
 *
 * Keeping the placeholders in one visibly separate group is the point: mixed in
 * with working modules they made the product look finished and the one screen
 * that worked impossible to find.
 *
 * Colaboradores and Usuários are one entry and one module. They are the same 143
 * people seen from two sides — the employee record and the HFM account — and
 * splitting them would mean two screens arguing about who someone is.
 *
 * Perfis e permissões is its own entry precisely because it is not that: the
 * access profile is what a person may do, and it must not be reachable only as
 * a tab inside the record of who they are.
 */
export const navigation: NavGroup[] = [
  {
    id: "home",
    items: [{ label: "Dashboard", href: "/dashboard", icon: LayoutDashboard }],
  },
  {
    id: "admin",
    label: "Administração",
    items: [
      {
        label: "Operações",
        href: "/organizacao/operacoes",
        icon: Network,
        permission: "operations.view",
      },
      {
        label: "Colaboradores e usuários",
        href: "/administracao/usuarios",
        icon: Users,
        permission: "users.view",
      },
      {
        label: "Perfis e permissões",
        href: "/administracao/perfis",
        icon: ShieldCheck,
        permission: "roles.view",
      },
      {
        label: "Frotas",
        href: "/organizacao/frotas",
        icon: Truck,
        planned: true,
        permission: "vehicles.view",
      },
    ],
  },
  {
    id: "future",
    label: "Módulos futuros",
    items: [
      { label: "Checklist", href: "/checklist", icon: ClipboardCheck, planned: true },
      { label: "Manutenção", href: "/manutencao", icon: Wrench, planned: true },
      { label: "Pneus", href: "/pneus", icon: CircleDot, planned: true },
      { label: "Abastecimento", href: "/abastecimento", icon: Fuel, planned: true },
      { label: "Multas", href: "/multas", icon: ShieldAlert, planned: true },
      { label: "Relatórios", href: "/relatorios", icon: BarChart3, planned: true },
    ],
  },
];

export function isActivePath(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(href + "/");
}
