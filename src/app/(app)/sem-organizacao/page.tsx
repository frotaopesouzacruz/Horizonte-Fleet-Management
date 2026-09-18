import type { Metadata } from "next";
import { Building2 } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState } from "@/components/feedback/empty-state";

export const metadata: Metadata = { title: "Sem organização" };

export default function NoOrganizationPage() {
  return (
    <>
      <PageHeader title="Sem organização" description="Sua conta ainda não está vinculada a uma organização." />
      <EmptyState
        icon={<Building2 />}
        title="Nenhuma organização ativa"
        description="Sua conta existe, mas ainda não possui um vínculo ativo. Solicite ao administrador da sua organização que conceda o acesso."
      />
    </>
  );
}
