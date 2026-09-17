import type { LucideIcon } from "lucide-react";
import {
  Activity,
  BarChart3,
  Building2,
  CalendarCheck,
  CircleDot,
  ClipboardCheck,
  ClipboardList,
  Droplets,
  FileText,
  Fuel,
  Gauge,
  LayoutDashboard,
  ListChecks,
  Route,
  Settings,
  ShieldAlert,
  Truck,
  Users,
  UsersRound,
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
}

export interface NavGroup {
  id: string;
  label?: string;
  items: NavItem[];
}

/**
 * Navigation model of the product. Groups are prepared for every planned
 * module; only Dashboard exists in this stage, the rest is marked `planned`.
 */
export const navigation: NavGroup[] = [
  {
    id: "home",
    items: [{ label: "Dashboard", href: "/dashboard", icon: LayoutDashboard }],
  },
  {
    id: "fleet",
    label: "Gestão de frota",
    items: [
      { label: "Frota", href: "/frota", icon: Truck, planned: true },
      { label: "Motoristas", href: "/motoristas", icon: UsersRound, planned: true },
      { label: "Quilometragem", href: "/quilometragem", icon: Route, planned: true },
    ],
  },
  {
    id: "maintenance",
    label: "Manutenção",
    items: [
      { label: "Visão geral", href: "/manutencao", icon: Gauge, planned: true },
      { label: "Preventiva", href: "/manutencao/preventiva", icon: CalendarCheck, planned: true },
      { label: "Corretiva", href: "/manutencao/corretiva", icon: Wrench, planned: true },
      { label: "Preditiva", href: "/manutencao/preditiva", icon: Activity, planned: true },
      { label: "Ordens de serviço", href: "/manutencao/ordens", icon: ClipboardList, planned: true },
    ],
  },
  {
    id: "tires",
    label: "Pneus",
    items: [{ label: "Gestão de pneus", href: "/pneus", icon: CircleDot, planned: true }],
  },
  {
    id: "operations",
    label: "Operação",
    items: [
      { label: "Checklist", href: "/checklist", icon: ClipboardCheck, planned: true },
      { label: "Planos de ação", href: "/planos-de-acao", icon: ListChecks, planned: true },
      { label: "Abastecimento", href: "/abastecimento", icon: Fuel, planned: true },
      { label: "Multas", href: "/multas", icon: ShieldAlert, planned: true },
      { label: "Lavagem", href: "/lavagem", icon: Droplets, planned: true },
    ],
  },
  {
    id: "management",
    label: "Gestão",
    items: [
      { label: "Fornecedores", href: "/fornecedores", icon: Building2, planned: true },
      { label: "Documentos", href: "/documentos", icon: FileText, planned: true },
      { label: "Relatórios", href: "/relatorios", icon: BarChart3, planned: true },
    ],
  },
  {
    id: "admin",
    label: "Administração",
    items: [
      { label: "Usuários", href: "/admin/usuarios", icon: Users, planned: true },
      { label: "Cadastros", href: "/admin/cadastros", icon: ClipboardList, planned: true },
      { label: "Configurações", href: "/admin/configuracoes", icon: Settings, planned: true },
    ],
  },
];

export function isActivePath(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(href + "/");
}
