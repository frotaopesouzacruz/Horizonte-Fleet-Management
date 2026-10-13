import type { Metadata } from "next";
import Link from "next/link";
import { Home, ShieldAlert } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { EmptyState } from "@/components/feedback/empty-state";
import { Button } from "@/components/ui/button";
import { PORTAL_HOME } from "@/lib/auth/portal";

export const metadata: Metadata = { title: "Sem permissão" };

export default function NoPermissionPage() {
  return (
    <>
      <PageHeader title="Acesso negado" description="Você não possui permissão para esta área." />
      <EmptyState
        icon={<ShieldAlert />}
        title="Sem permissão para acessar"
        description="Seu perfil de acesso não inclui esta funcionalidade. Solicite a permissão ao administrador da organização."
        action={
          <Button asChild leadingIcon={<Home />}>
            <Link href={PORTAL_HOME}>Voltar ao início</Link>
          </Button>
        }
      />
    </>
  );
}
