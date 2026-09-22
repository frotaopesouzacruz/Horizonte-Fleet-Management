import { notFound } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
import { PreviewFlow } from "./preview-flow";

export const metadata = {
  title: "Preview · Fluxo do Check List de Frota",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

const enabled =
  process.env.NODE_ENV !== "production" || process.env.NEXT_PUBLIC_ENABLE_DEV_PAGES === "1";

/**
 * O aplicativo inteiro — início → tipo → operação → equipamento → placa →
 * execução — com dados fixos e carregadores injetados. É o que permite
 * verificar num navegador de verdade que trocar a operação descarta o tipo e
 * a placa, e que a lista vazia diz exatamente o que a §36 pede.
 */
export default function ChecklistFlowPreviewPage() {
  if (!enabled) notFound();

  return (
    <AppShell
      permissions={[
        "applications.view",
        "applications.checklist_fleet.execute",
        "applications.checklist_fleet.view_own",
        "applications.checklist_fleet.view_details",
      ]}
    >
      <PreviewFlow />
    </AppShell>
  );
}
