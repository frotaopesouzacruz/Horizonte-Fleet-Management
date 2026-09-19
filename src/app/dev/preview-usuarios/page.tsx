import { notFound } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
import { UsersView } from "@/app/(app)/administracao/usuarios/users-view";
import { OverviewCards } from "@/app/(app)/administracao/usuarios/overview";
import type { DirectoryOptions, DirectoryPage, EmployeeSummary } from "@/lib/admin/queries";

/**
 * Renders Administração → Usuários against fixed data.
 *
 * The real screen needs a session and a reachable Supabase, which makes the
 * densest table in the product impossible to review from an environment that
 * has neither. Same gate as the design system: absent from a normal production
 * build. The rows are shaped like the directory view and deliberately include
 * the long values — a 40-character cargo, a two-line name and e-mail — that the
 * column widths exist to survive.
 */
export const metadata = { title: "Preview · Usuários", robots: { index: false, follow: false } };

export const dynamic = "force-dynamic";

const enabled =
  process.env.NODE_ENV !== "production" || process.env.NEXT_PUBLIC_ENABLE_DEV_PAGES === "1";

const option = (id: string, label: string) => ({ id, label });

const OPTIONS: DirectoryOptions = {
  operations: ["Last Mille MG", "Merchandising", "Redespacho", "Redespacho - Belém", "Frota", "Gente"].map((n, i) =>
    option(`op${i}`, n),
  ),
  areas: ["Operações", "Administrativo", "Manutenção", "Comercial"].map((n, i) => option(`ar${i}`, n)),
  positions: ["Motorista", "Auxiliar de Logística"].map((n, i) => option(`po${i}`, n)),
  locations: ["Contagem", "Uberlândia", "Governador Valadares", "Brasilia", "Belém Do Pará"].map((n, i) =>
    option(`lo${i}`, n),
  ),
  units: ["Filial Contagem", "Filial Uberlândia", "Matriz Belo Horizonte"].map((n, i) => option(`un${i}`, n)),
  profiles: ["Operacional", "Administrativo", "Gestão", "Coordenação"].map((n, i) => option(`pr${i}`, n)),
  managers: ["Gabriel Moutinho Albino", "Ana Paula de Almeida Rodrigues"].map((n, i) => option(`ma${i}`, n)),
  roles: [],
};

const PEOPLE: Array<[string, string, string | null, string, string, string, string, string, string, string, string[]]> = [
  ["Ana Paula de Almeida Rodrigues", "140349", "ana.paula.rodrigues@grupohorizonte.com.br", "active", "Coordenadora de Operações Logísticas", "Operações", "Last Mille MG", "Contagem", "active", "Gabriel Moutinho Albino", ["Administrador"]],
  ["Carlos Eduardo Nogueira Silva", "140350", null, "active", "Motorista Carreteiro", "Operações", "Redespacho - Belém", "Belém Do Pará", "none", "Ana Paula de Almeida Rodrigues", []],
  ["Marina dos Santos Figueiredo", "140351", "marina.figueiredo@grupohorizonte.com.br", "on_leave", "Analista de Manutenção Preventiva", "Manutenção", "Frota", "Uberlândia", "suspended", "Gabriel Moutinho Albino", ["Operacional"]],
  ["João Vitor Rodrigues de Oliveira", "140352", null, "active", "Auxiliar de Logística", "Operações", "Merchandising", "Governador Valadares", "none", "Ana Paula de Almeida Rodrigues", []],
  ["Beatriz Carvalho Mendes Lima", "140353", "beatriz.lima@grupohorizonte.com.br", "active", "Gerente Administrativa Regional", "Administrativo", "Gente", "Brasilia", "invited", "Gabriel Moutinho Albino", ["Gente"]],
  ["Rafael Augusto Pereira Barbosa", "140354", null, "terminated", "Motorista de Entrega Urbana", "Operações", "Last Mille MG", "Contagem", "none", "Ana Paula de Almeida Rodrigues", []],
  ["Luciana Aparecida Ferreira Gomes", "140355", "luciana.gomes@grupohorizonte.com.br", "active", "Supervisora de Redespacho", "Operações", "Redespacho", "Uberlândia", "active", "Gabriel Moutinho Albino", ["Gestor de Frota"]],
  ["Thiago Henrique Moreira Castro", "140356", null, "active", "Conferente de Carga", "Operações", "Merchandising", "Contagem", "none", "Luciana Aparecida Ferreira Gomes", []],
];

const PAGE: DirectoryPage = {
  rows: PEOPLE.map(
    ([full_name, employee_code, corporate_email, employment_status, job, area, operation, location, access, manager, roles], index) =>
      ({
        id: `emp-${index}`,
        organization_id: "org",
        employee_code,
        full_name,
        corporate_email,
        employment_status,
        admission_date: "2021-03-15",
        termination_date: null,
        deleted_at: null,
        created_at: "2026-01-01T00:00:00Z",
        updated_at: "2026-01-01T00:00:00Z",
        search_name: full_name.toLowerCase(),
        assignment_id: `as-${index}`,
        job_position_id: "jp",
        job_position_name: job,
        job_position_code: null,
        employment_area_id: "ea",
        employment_area_name: area,
        operation_id: "op",
        operation_name: operation,
        organization_unit_id: "ou",
        organization_unit_name: "Filial Contagem",
        organization_unit_code: null,
        work_location_id: "wl",
        work_location_name: location,
        business_profile_id: "bp",
        business_profile_name: index % 2 === 0 ? "Operacional" : "Administrativo",
        manager_employee_id: "mg",
        manager_name: manager,
        driver_license_id: null,
        license_category: null,
        license_expiration_date: null,
        license_points: null,
        license_state: null,
        membership_id: access === "none" ? null : "mb",
        account_user_id: access === "none" ? null : "us",
        access_status: access,
        access_since: null,
        access_updated_at: null,
        access_role_codes: roles,
        access_role_names: roles,
        access_operation_count: 0,
        access_all_operations: false,
      }) as unknown as DirectoryPage["rows"][number],
  ),
  total: 143,
  page: 1,
  pageSize: 25,
  pageCount: 6,
};

const SUMMARY: EmployeeSummary = {
  total: 143,
  active: 138,
  inactive: 2,
  onLeave: 2,
  terminated: 1,
  withLeader: 142,
  withoutLeader: 1,
  operationCount: 4,
  withoutOperation: 3,
  withAccess: 1,
  withoutAccess: 140,
  suspendedAccess: 1,
  pendingAccess: 1,
  byOperation: [
    { operationId: "op-1", operationName: "Merchandising", operationCode: "OP-00002", count: 61 },
    { operationId: "op-2", operationName: "Last Mille MG", operationCode: "OP-00001", count: 44 },
    { operationId: "op-3", operationName: "Redespacho", operationCode: "OP-00003", count: 24 },
    { operationId: "op-4", operationName: "Redespacho Belém", operationCode: "OP-00004", count: 11 },
    { operationId: null, operationName: "Sem operação", operationCode: null, count: 3 },
  ],
};

export default function PreviewUsersPage() {
  if (!enabled) notFound();

  return (
    <AppShell
      permissions={["users.view", "users.create", "users.import", "users.export", "users.archive", "users.bulk_manage", "users.manage_access", "operations.view"]}
      topbar={{
        userName: "Pré-visualização",
        organizationName: "Horizonte Logística",
        organizations: [{ id: "org", name: "Horizonte Logística" }],
        activeOrganizationId: "org",
        unitName: "Todas as unidades",
      }}
    >
      <UsersView
        page={PAGE}
        options={OPTIONS}
        overview={<OverviewCards summary={SUMMARY} />}
        filters={{ sort: "full_name", dir: "asc", page: 1, pageSize: 25 }}
        permissions={["users.view", "users.create", "users.import", "users.export", "users.archive", "users.bulk_manage", "users.manage_access"]}
        isPlatformAdmin={false}
      />
    </AppShell>
  );
}
