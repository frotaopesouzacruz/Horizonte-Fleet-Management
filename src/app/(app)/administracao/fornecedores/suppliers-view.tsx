"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageContent, PageHeader } from "@/components/layout/page-header";
import type { MaintenanceCatalog } from "@/lib/maintenance/types";
import type { MaintenanceFilterOptions } from "@/lib/maintenance/queries";
import { SuppliersSection } from "@/app/(app)/frota/manutencao/catalog-panel";
import type { PanelActions } from "@/app/(app)/frota/manutencao/shared";

export interface SuppliersViewProps {
  catalog: MaintenanceCatalog;
  options: MaintenanceFilterOptions;
  /** `maintenance.manage_suppliers`: sem ela a tela é somente leitura. */
  canManage: boolean;
  /** `maintenance.import`: mostra o caminho da planilha de fornecedores. */
  canImport: boolean;
}

/**
 * Administração › Fornecedores.
 *
 * O cadastro de oficinas e prestadores é da plataforma — a Manutenção e o
 * MTSR o consomem, nenhum dos dois é o seu dono. A seção, o formulário e as
 * regras do banco são os mesmos que viviam em Manutenção › Cadastros; só a
 * casa mudou. A importação da planilha continua em Manutenção › Importações,
 * junto das outras bases, e a tela aponta para lá.
 */
export function SuppliersView({ catalog, options, canManage, canImport }: SuppliersViewProps) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();

  // A seção foi escrita para viver numa aba com várias seções; aqui ela é a
  // tela inteira, então "navegar" não existe e "atualizar" relê a página.
  const actions = React.useMemo<PanelActions>(
    () => ({
      navigate: () => {},
      pending,
      refresh: () => startTransition(() => router.refresh()),
      openMaintenance: (id) => router.push(`/frota/manutencao?aba=base&manutencao=${encodeURIComponent(id)}`),
      openWizard: () => router.push("/frota/manutencao?aba=programacao"),
    }),
    [pending, router],
  );

  return (
    <>
      <PageHeader
        eyebrow="Administração"
        title="Fornecedores"
        description="Oficinas e prestadores de serviço da frota. É daqui que a Manutenção e o MTSR escolhem com quem agendar; o histórico de cada fornecedor continua com ele quando é inativado."
        secondaryActions={
          canImport ? (
            <Button asChild variant="secondary" leadingIcon={<Upload />}>
              <Link href="/frota/manutencao?aba=importacoes">Importar planilha</Link>
            </Button>
          ) : undefined
        }
      />
      <PageContent aria-busy={pending || undefined}>
        <div className="flex w-full flex-col gap-4" data-testid="administracao-fornecedores">
          <SuppliersSection catalog={catalog} options={options} canManage={canManage} actions={actions} standalone />
        </div>
      </PageContent>
    </>
  );
}
