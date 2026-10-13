import type { Metadata } from "next";
import { hasPermission, requireOrganization } from "@/lib/auth/session";
import { getMaintenanceCatalog, getMaintenanceFilterOptions } from "@/lib/maintenance/queries";
import { SuppliersView } from "./suppliers-view";

export const metadata: Metadata = {
  title: "Fornecedores",
  description: "Cadastro de oficinas e prestadores de serviço da frota.",
};

/**
 * Administração › Fornecedores.
 *
 * Mesma leitura e mesmas permissões de quando a seção vivia em Manutenção ›
 * Cadastros: `maintenance.view` abre (somente leitura), `maintenance.manage_suppliers`
 * edita, e o banco decide de novo em cada escrita.
 */
export default async function SuppliersPage() {
  const { session, organization } = await requireOrganization("maintenance.view");
  const orgId = organization.organizationId;
  const [catalog, options] = await Promise.all([getMaintenanceCatalog(orgId), getMaintenanceFilterOptions(orgId)]);

  return (
    <SuppliersView
      catalog={catalog}
      options={options}
      canManage={hasPermission(session, "maintenance.manage_suppliers")}
      canImport={hasPermission(session, "maintenance.import")}
    />
  );
}
