import { notFound } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
import { AccessProfilesView } from "@/app/(app)/administracao/perfis/access-profiles-view";
import type {
  AccessInconsistency,
  AccessProfile,
  AccessProfileChange,
  PermissionRow,
  SimulatableMembership,
} from "@/lib/admin/access-profiles";

/**
 * Renders Administração → Perfis e permissões against fixed data.
 *
 * The real route needs a session, which makes it impossible to look at from an
 * environment that cannot reach Supabase. Same gate as the design system:
 * absent from a normal production build. The accessibility suite checks this
 * markup in light and dark without credentials — and the matrix, a grid of
 * dozens of ✓/— cells, is exactly the kind of thing that fails contrast
 * quietly in one theme only.
 */
export const metadata = { title: "Preview · Perfis e permissões", robots: { index: false, follow: false } };

export const dynamic = "force-dynamic";

const enabled =
  process.env.NODE_ENV !== "production" || process.env.NEXT_PUBLIC_ENABLE_DEV_PAGES === "1";

const PROFILES: AccessProfile[] = [
  {
    roleId: "r1",
    code: "operacional",
    name: "Operacional",
    description: "Executa a operação do dia a dia. Enxerga apenas as operações às quais está vinculado.",
    sortOrder: 10,
    isAdministrator: false,
    permissionCount: 6,
    memberCount: 84,
    addedPermissions: [],
    removedPermissions: [],
    lastChangedAt: "2026-09-01T09:00:00Z",
  },
  {
    roleId: "r2",
    code: "seguranca",
    name: "Segurança",
    description: "Acompanha segurança operacional, condutores e habilitações das operações vinculadas.",
    sortOrder: 20,
    isAdministrator: false,
    permissionCount: 10,
    memberCount: 4,
    addedPermissions: [],
    removedPermissions: [],
    lastChangedAt: null,
  },
  {
    roleId: "r3",
    code: "lideranca_operacoes",
    name: "Liderança de Operações",
    description: "Lidera operações: acompanha pessoas, frota e indicadores das operações sob sua responsabilidade.",
    sortOrder: 30,
    isAdministrator: false,
    permissionCount: 11,
    memberCount: 9,
    addedPermissions: ["users.view_sensitive"],
    removedPermissions: [],
    lastChangedAt: "2026-09-17T09:02:00Z",
  },
  {
    roleId: "r4",
    code: "gestor_frota",
    name: "Gestor de Frota",
    description: "Responsável pela frota: veículos, condutores, unidades e centros de custo.",
    sortOrder: 40,
    isAdministrator: false,
    permissionCount: 18,
    memberCount: 3,
    addedPermissions: [],
    removedPermissions: [],
    lastChangedAt: null,
  },
  {
    roleId: "r5",
    code: "gente",
    name: "Gente",
    description: "Responsável pelos dados das pessoas. Não concede, altera nem remove acesso ao HFM.",
    sortOrder: 50,
    isAdministrator: false,
    permissionCount: 16,
    memberCount: 2,
    addedPermissions: [],
    removedPermissions: ["users.export_sensitive"],
    lastChangedAt: "2026-09-10T15:20:00Z",
  },
  {
    roleId: "r6",
    code: "gestao",
    name: "Gestão",
    description: "Visão executiva de leitura sobre toda a organização, incluindo trilha de auditoria.",
    sortOrder: 60,
    isAdministrator: false,
    permissionCount: 13,
    memberCount: 2,
    addedPermissions: [],
    removedPermissions: [],
    lastChangedAt: null,
  },
  {
    roleId: "r7",
    code: "administrador",
    name: "Administrador",
    description: "Controle total do HFM, inclusive perfis de acesso, permissões e escopo de operações.",
    sortOrder: 70,
    isAdministrator: true,
    permissionCount: 44,
    memberCount: 1,
    addedPermissions: [],
    removedPermissions: [],
    lastChangedAt: null,
  },
];

const MATRIX: PermissionRow[] = [
  {
    code: "users.view",
    name: "Ver colaboradores",
    module: "users",
    description: "Listar colaboradores e o seu vínculo organizacional",
    reserved: false,
    grantedCodes: ["seguranca", "lideranca_operacoes", "gestor_frota", "gente", "gestao", "administrador"],
    defaultCodes: ["seguranca", "lideranca_operacoes", "gestor_frota", "gente", "gestao", "administrador"],
  },
  {
    code: "users.view_sensitive",
    name: "Ver dados pessoais",
    module: "users",
    description: "Ver CPF, data de nascimento e número completo da CNH",
    reserved: false,
    grantedCodes: ["lideranca_operacoes", "gente", "administrador"],
    defaultCodes: ["gente", "administrador"],
  },
  {
    code: "users.export_sensitive",
    name: "Exportar dados pessoais",
    module: "users",
    description: "Incluir dados pessoais em uma exportação",
    reserved: false,
    grantedCodes: ["administrador"],
    defaultCodes: ["gente", "administrador"],
  },
  {
    code: "users.manage_roles",
    name: "Gerenciar perfis de acesso",
    module: "users",
    description: "Atribuir e remover o perfil de acesso de uma conta",
    reserved: true,
    grantedCodes: ["administrador"],
    defaultCodes: ["administrador"],
  },
  {
    code: "operations.view",
    name: "Ver operações",
    module: "operations",
    description: "Listar as operações da organização",
    reserved: false,
    grantedCodes: [
      "operacional",
      "seguranca",
      "lideranca_operacoes",
      "gestor_frota",
      "gente",
      "gestao",
      "administrador",
    ],
    defaultCodes: [
      "operacional",
      "seguranca",
      "lideranca_operacoes",
      "gestor_frota",
      "gente",
      "gestao",
      "administrador",
    ],
  },
  {
    code: "operations.access_all",
    name: "Acessar todas as operações",
    module: "operations",
    description: "Ler dados de todas as operações. Sem esta permissão a conta enxerga apenas as operações atribuídas a ela",
    reserved: false,
    grantedCodes: ["gestao", "administrador"],
    defaultCodes: ["gestao", "administrador"],
  },
  {
    code: "vehicles.update",
    name: "Editar veículos",
    module: "vehicles",
    description: "Alterar os dados do veículo e a sua situação",
    reserved: false,
    grantedCodes: ["gestor_frota", "administrador"],
    defaultCodes: ["gestor_frota", "administrador"],
  },
  {
    code: "audit.view",
    name: "Ver trilha de auditoria",
    module: "audit",
    description: "Ler o registro de auditoria da organização",
    reserved: false,
    grantedCodes: ["seguranca", "lideranca_operacoes", "gestor_frota", "gente", "gestao", "administrador"],
    defaultCodes: ["seguranca", "lideranca_operacoes", "gestor_frota", "gente", "gestao", "administrador"],
  },
];

const INCONSISTENCIES: AccessInconsistency[] = [
  {
    kind: "access_without_employment",
    severity: "high",
    subjectId: "m1",
    subject: "Fulano de Tal",
    detail: "Colaborador desligado e com acesso ao HFM ainda ativo.",
  },
  {
    kind: "profile_without_operation_scope",
    severity: "medium",
    subjectId: "m2",
    subject: "Beltrano de Tal",
    detail: "Perfil restrito por operação, mas nenhuma operação atribuída à conta.",
  },
  {
    kind: "profile_customised",
    severity: "low",
    subjectId: "r3",
    subject: "Liderança de Operações",
    detail: "Matriz diferente do padrão oficial: 1 adicionada(s), 0 removida(s).",
  },
];

const CHANGES: AccessProfileChange[] = [
  {
    id: "c1",
    roleId: null,
    membershipId: "m3",
    actorUserId: "u1",
    actorName: "Gabriel Albino",
    targetName: "Sicrano de Tal",
    previousCodes: ["operacional"],
    newCodes: ["lideranca_operacoes"],
    reason: "Promoção a líder da operação Last Mille MG, aprovada por Gente em 12/03.",
    createdAt: "2026-09-18T13:24:00Z",
  },
  {
    id: "c2",
    roleId: "r3",
    membershipId: null,
    actorUserId: "u1",
    actorName: "Gabriel Albino",
    targetName: null,
    previousCodes: ["users.view", "users.export"],
    newCodes: ["users.view", "users.export", "users.view_sensitive"],
    reason: "Liderança precisa conferir CNH das equipes de campo.",
    createdAt: "2026-09-17T09:02:00Z",
  },
];

const MEMBERSHIPS: SimulatableMembership[] = [
  {
    membershipId: "m1",
    name: "Gabriel Albino",
    email: "gabriel.albino@grupohorizonte.com.br",
    status: "active",
    profileCodes: ["administrador"],
  },
  {
    membershipId: "m2",
    name: "Beltrano de Tal",
    email: "beltrano@grupohorizonte.com.br",
    status: "active",
    profileCodes: ["lideranca_operacoes"],
  },
];

export default function PreviewAccessProfilesPage() {
  if (!enabled) notFound();

  return (
    <AppShell
      permissions={["roles.view", "roles.manage", "users.view", "operations.view"]}
      topbar={{
        userName: "Pré-visualização",
        organizationName: "Horizonte Logística",
        organizations: [{ id: "org", name: "Horizonte Logística" }],
        activeOrganizationId: "org",
        unitName: "Todas as unidades",
      }}
    >
      <AccessProfilesView
        profiles={PROFILES}
        matrix={MATRIX}
        inconsistencies={INCONSISTENCIES}
        changes={CHANGES}
        memberships={MEMBERSHIPS}
        canManage
      />
    </AppShell>
  );
}
