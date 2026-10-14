/**
 * Pós-login: o início e as telas de cada perfil.
 *
 * O HFC dá a cada perfil uma casa própria — o Operacional entra no "Meu
 * resumo", a Liderança no "Portal da Liderança" — e silenciosamente leva de
 * volta para ela quem abre uma tela fora da sua alçada. O HFM faz o mesmo,
 * em duas camadas que não se confundem:
 *
 *   * a PERMISSÃO decide o dado (RBAC + RLS no banco), como sempre;
 *   * o PORTAL decide as telas. O Operacional precisa de `operations.view` e
 *     `vehicles.view` para o Check List listar operações e placas — e nem por
 *     isso Operações ou Cadastro de frotas são telas dele.
 *
 * O tipo de portal vem do banco (`current_user_portal`), pelos perfis do
 * vínculo ativo; nunca de um parâmetro. Quem tem qualquer perfil além de
 * Operacional e Liderança de Operações fica com a navegação de sempre
 * ("management"): um perfil a mais nunca tira telas de ninguém.
 *
 * Sem "server-only": a sidebar usa as mesmas listas para montar o menu, e o
 * menu e a trava nunca podem discordar.
 */

export type PortalKind = "operational" | "leadership" | "management";

/** O início de quem tem portal; quem não tem é levado ao Dashboard. */
export const PORTAL_HOME = "/inicio";
export const MANAGEMENT_HOME = "/dashboard";

/** Cabeçalho que o middleware preenche com o caminho pedido (nunca o do cliente). */
export const PATHNAME_HEADER = "x-hfm-pathname";

export const PORTAL_KIND_LABEL: Record<PortalKind, string> = {
  operational: "Operacional",
  leadership: "Liderança de Operações",
  management: "Gestão",
};

/** O início, o perfil da própria conta e as telas de recusa. */
const SHARED_ROUTES = [PORTAL_HOME, "/perfil", "/sem-permissao", "/sem-organizacao"] as const;

/** Os três aplicativos de campo — de quem executa e de quem lidera — e o índice deles. */
const APP_ROUTES = [
  "/aplicativos",
  "/aplicativos/check-list-frota",
  "/aplicativos/vistoria-mtsr",
  "/aplicativos/vistoria-pneus",
] as const;

/**
 * As telas de cada portal, por prefixo de caminho.
 *
 * Operacional (HFC: "Meu resumo", "Meus checklists", "Minhas tratativas" e os
 * três apps): o início, os aplicativos — "Meus checklists" é uma tela do
 * próprio Check List —, a própria situação na Aderência e os próprios
 * apontamentos nos Planos de Ação.
 *
 * Liderança de Operações (menu desta etapa: Início › Gestão da operação ›
 * Frota › Segurança › Aplicativos): o portal, a operação que ela lidera —
 * Aderência, Planos de ação, Fidelização, BRs e Lideranças —, a frota —
 * Cadastro de frotas (leitura), KM, Pneus e Manutenção —, a segurança (MTSR)
 * e os aplicativos. Ficam de fora a administração da plataforma
 * (Colaboradores e usuários, Fornecedores, Perfis) e a estrutura (Operações,
 * Filiais, Tipos de equipamento). O que cada tela deixa fazer continua
 * decidido pela permissão: a Liderança entra em Cadastro de frotas e em
 * Lideranças com o que `vehicles.*` e `leadership.*` lhe dão, nada além.
 */
export const PORTAL_ROUTES: Record<Exclude<PortalKind, "management">, readonly string[]> = {
  operational: [
    ...SHARED_ROUTES,
    ...APP_ROUTES,
    "/checklist/aderencia/minha-situacao",
    "/checklist/planos-acao/meus-apontamentos",
  ],
  leadership: [
    ...SHARED_ROUTES,
    ...APP_ROUTES,
    "/checklist/aderencia",
    "/checklist/planos-acao",
    "/governanca/fidelizacao",
    "/governanca/brs",
    "/governanca/liderancas",
    "/frota/cadastro",
    "/frota/km",
    "/frota/pneus",
    "/frota/manutencao",
    "/seguranca/mtsr",
  ],
};

const within = (pathname: string, base: string) => pathname === base || pathname.startsWith(`${base}/`);

/** A tela pertence ao portal? Quem não tem portal ("management") não tem trava. */
export function portalAllowsPath(kind: PortalKind, pathname: string): boolean {
  if (kind === "management") return true;
  return PORTAL_ROUTES[kind].some((base) => within(pathname, base));
}

/** O início de cada tipo de portal. */
export function portalHome(kind: PortalKind): string {
  return kind === "management" ? MANAGEMENT_HOME : PORTAL_HOME;
}

export function parsePortalKind(value: unknown): PortalKind {
  return value === "operational" || value === "leadership" ? value : "management";
}
