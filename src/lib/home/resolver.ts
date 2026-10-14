import type { PortalKind } from "@/lib/auth/portal";

/**
 * Home por perfil: QUAL início a conta recebe e O QUE ela pode ver nele.
 *
 * O perfil não é lido de um parâmetro nem de um nome de perfil: o portal vem
 * do banco (`current_user_portal`, pelos perfis do vínculo ativo) e as
 * permissões vêm da matriz RBAC. Este módulo só junta as duas coisas num
 * objeto que a rota, os widgets e os menus leem — um lugar só, para que a
 * tela nunca decida por conta própria o que mostrar.
 *
 * Puro de propósito (sem servidor): a prévia de desenvolvimento e os testes
 * resolvem a home com os mesmos dados que a rota real.
 */

export type HomeKind = "operational" | "leadership" | "management";

/** O que a conta pode ver no Início — cada chave é uma permissão real da matriz. */
export interface HomeCapabilities {
  /** Aplicativos de campo (grupo "Aplicativos"). */
  apps: boolean;
  checklistExecute: boolean;
  mtsrExecute: boolean;
  tiresExecute: boolean;
  /** Visões pessoais do Operacional. */
  ownChecklists: boolean;
  ownReports: boolean;
  ownSituation: boolean;
  /** Módulos da Liderança (cada um pela permissão de ver o módulo e o seu painel). */
  adherence: boolean;
  actionPlans: boolean;
  fidelization: boolean;
  leadership: boolean;
  fleet: boolean;
  km: boolean;
  tires: boolean;
  maintenance: boolean;
  mtsr: boolean;
}

export interface ResolvedHome {
  kind: HomeKind;
  can: HomeCapabilities;
}

export interface HomeSubject {
  portal: PortalKind;
  permissions: readonly string[];
  isPlatformAdmin?: boolean;
}

const APP_CODES = {
  checklist_frota: "applications.checklist_fleet.execute",
  vistoria_mtsr: "applications.mtsr.execute",
  vistoria_pneus: "applications.tires.execute",
} as const;

export type HomeAppCode = keyof typeof APP_CODES;

/** A permissão que libera cada aplicativo oficial (código do catálogo `operational_apps`). */
export function appPermission(code: string): string | null {
  return (APP_CODES as Record<string, string>)[code] ?? null;
}

export function homeCapabilities(subject: HomeSubject): HomeCapabilities {
  const has = (code: string) => subject.isPlatformAdmin === true || subject.permissions.includes(code);
  return {
    apps: has("applications.view"),
    checklistExecute: has("applications.checklist_fleet.execute"),
    mtsrExecute: has("applications.mtsr.execute"),
    tiresExecute: has("applications.tires.execute"),
    ownChecklists: has("applications.checklist_fleet.view_own"),
    ownReports: has("action_plans.view_own") || has("action_plans.view"),
    ownSituation: has("adherence.view_own"),
    adherence: has("adherence.view"),
    actionPlans: has("action_plans.view") && has("action_plans.view_dashboard"),
    fidelization: has("fidelization.view"),
    leadership: has("leadership.view"),
    fleet: has("vehicles.view"),
    km: has("km.view") && has("km.view_dashboard"),
    tires: has("tires.view") && has("tires.dashboard.view"),
    maintenance: has("maintenance.view") && has("maintenance.view_dashboard"),
    mtsr: has("mtsr.view") && has("mtsr.dashboard.view"),
  };
}

/**
 * `resolveHomeByProfile`: Operacional → Operational Home; Liderança de
 * Operações → Leadership Home; qualquer outro perfil (ou nenhum) → a gestão
 * (Dashboard). Um perfil a mais nunca tira telas de ninguém — é o portal do
 * banco que já encerra essa decisão; aqui ela só ganha as capabilities.
 */
export function resolveHome(subject: HomeSubject): ResolvedHome {
  return { kind: subject.portal, can: homeCapabilities(subject) };
}
