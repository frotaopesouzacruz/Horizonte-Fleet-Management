import type { LucideIcon } from "lucide-react";
import {
  BarChart3,
  Building2,
  CalendarRange,
  CircleDot,
  ClipboardCheck,
  Fuel,
  Gauge,
  LayoutDashboard,
  Network,
  ShieldAlert,
  ShieldCheck,
  Shapes,
  Truck,
  UserCog,
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
 * Four structures, because there are four kinds of thing here, and until now
 * two of them were filed under the wrong heading.
 *
 * ADMINISTRAÇÃO is the platform itself: who has an account and what each
 * account may do. Nothing operational lives here.
 *
 * ESTRUTURA OPERACIONAL is what the company *is* — the operations it runs, the
 * branches it runs them from, and the catalogue that classifies the equipment
 * those operations use. Operações sat under Administração and Tipos de
 * equipamento under Gestão de frota; neither is administration and neither is
 * fleet management. They are the skeleton the other modules hang off.
 *
 * Filiais sits between them on purpose: an operation is what the company does,
 * a filial is where it answers from, and one is not the other. A filial serves
 * many operations and an operation is served by many filiais.
 *
 * GOVERNANÇA OPERACIONAL is who answers for that structure and how the fleet is
 * committed to it month by month: Lideranças and Fidelização.
 *
 * GESTÃO DE FROTA is the fleet itself — the vehicles, and later everything done
 * to them.
 *
 * Módulos futuros stays separate and every entry in it is still a placeholder.
 * Mixed in with working modules they made the product look finished and the one
 * screen that worked impossible to find.
 *
 * No module appears twice. An entry has exactly one home, and moving it here is
 * the only way it moves — there is no second list to keep in step.
 *
 * Cadastro de frotas is the single source of truth for vehicles; Tipos de
 * equipamento for how they are classified; Operações for where they run; Filiais
 * for the units they answer to. Everything that comes later references those by
 * id and never re-registers any of them.
 *
 * There is no Estados or Cidades entry, and there must not be one. The IBGE
 * tables exist and are used, but a state is not something anyone administers:
 * it is a dimension of an operation's coverage, chosen inside the operation.
 *
 * Colaboradores and Usuários are one entry and one module. They are the same 143
 * people seen from two sides — the employee record and the HFM account — and
 * splitting them would mean two screens arguing about who someone is.
 *
 * Perfis e permissões is its own entry precisely because it is not that: the
 * access profile is what a person may do, and it must not be reachable only as
 * a tab inside the record of who they are.
 *
 * Routes did not change. Operações is still /organizacao/operacoes and Tipos de
 * equipamento still /frota/tipos-equipamento — a link someone saved a month ago
 * still opens the same screen.
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
    ],
  },
  {
    id: "structure",
    label: "Estrutura operacional",
    items: [
      {
        label: "Operações",
        href: "/organizacao/operacoes",
        icon: Network,
        permission: "operations.view",
      },
      {
        label: "Filiais",
        href: "/estrutura/filiais",
        icon: Building2,
        permission: "branches.view",
      },
      {
        label: "Tipos de equipamento",
        href: "/frota/tipos-equipamento",
        icon: Shapes,
        permission: "equipment_types.view",
      },
    ],
  },
  {
    id: "governance",
    label: "Governança operacional",
    items: [
      {
        label: "Lideranças",
        href: "/governanca/liderancas",
        icon: UserCog,
        permission: "leadership.view",
      },
      {
        label: "Fidelização",
        href: "/governanca/fidelizacao",
        icon: CalendarRange,
        permission: "fidelization.view",
      },
    ],
  },
  {
    id: "fleet",
    label: "Gestão de frota",
    items: [
      {
        label: "Cadastro de frotas",
        href: "/frota/cadastro",
        icon: Truck,
        permission: "vehicles.view",
      },
    ],
  },
  {
    /**
     * Aplicativos são os módulos que o time OPERA no celular, não os que a
     * administração configura. Por isso são um grupo próprio e não um item
     * dentro de Gestão de frota: quem abre esta entrada está saindo para rota,
     * não administrando cadastro.
     *
     * O grupo nasce com um aplicativo e foi desenhado para receber outros
     * (Conferência de Pneus, Vistoria, MTCR) sem virar uma lista de exceções.
     */
    id: "applications",
    label: "Aplicativos",
    items: [
      {
        label: "Check List de Frota",
        href: "/aplicativos/check-list-frota",
        icon: ClipboardCheck,
        permission: "applications.view",
      },
    ],
  },
  {
    id: "future",
    label: "Módulos futuros",
    items: [
      /*
       * Era "Checklist → /checklist". O aplicativo real assumiu o endereço e o
       * ícone; o que continua por construir é a ADERÊNCIA (Etapa 11), que é
       * outra pergunta: o aplicativo registra a inspeção, a aderência cobra
       * quem devia tê-la feito. Deixar os dois como "Checklist" faria o módulo
       * aparecer duas vezes no menu.
       */
      { label: "Aderência de checklist", href: "/checklist/aderencia", icon: Gauge, planned: true },
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
