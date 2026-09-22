import { notFound } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
import { PreviewConfiguration } from "./fixture";

export const metadata = {
  title: "Preview · Configuração do Check List de Frota",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

const enabled =
  process.env.NODE_ENV !== "production" || process.env.NEXT_PUBLIC_ENABLE_DEV_PAGES === "1";

/**
 * O editor administrativo do Check List de Frota com dados fixos.
 *
 * A tela real depende de sessão, organização e das rotinas do banco. Esta rota
 * renderiza o MESMO componente com um rascunho 1.1 de amostra e ações que
 * alteram esse rascunho só na memória do navegador — inclusive repetindo as
 * recusas do servidor palavra por palavra — para que o editor possa ser
 * exercitado num navegador de verdade sem Supabase. Mesma trava das demais
 * páginas de prévia: ausente de um build normal de produção.
 */
export default function ChecklistConfigurationPreviewPage() {
  if (!enabled) notFound();

  return (
    <AppShell
      permissions={[
        "applications.view",
        "applications.checklist_fleet.configure",
        "applications.checklist_fleet.create_version",
        "applications.checklist_fleet.publish",
        "applications.checklist_fleet.manage_rules",
        "applications.manage_operation_links",
        "applications.manage_equipment_links",
      ]}
    >
      <PreviewConfiguration />
    </AppShell>
  );
}
