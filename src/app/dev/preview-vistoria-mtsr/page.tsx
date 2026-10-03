import { notFound } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
import { PreviewMtsrApp } from "./preview-app";

export const metadata = {
  title: "Preview · Vistoria MTSR",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

const enabled = process.env.NODE_ENV !== "production" || process.env.NEXT_PUBLIC_ENABLE_DEV_PAGES === "1";

/**
 * O aplicativo Vistoria MTSR inteiro — início → frota → itens → revisão →
 * envio → protocolo → minhas vistorias — com contexto fixo e carregadores
 * injetados. É o que permite verificar num navegador de verdade os bloqueios
 * de envio (item sem resposta, NOK sem observação, OK sem foto obrigatória),
 * a foto simulada percorrendo o mesmo caminho do upload e o protocolo no fim.
 *
 * `?perfil=consulta` renderiza como quem só tem `applications.view`.
 */
export default async function MtsrAppPreviewPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  if (!enabled) notFound();
  const params = await searchParams;
  const perfil = Array.isArray(params.perfil) ? params.perfil[0] : params.perfil;
  const canExecute = perfil !== "consulta";

  return (
    <AppShell permissions={canExecute ? ["applications.view", "applications.mtsr.execute"] : ["applications.view"]}>
      <PreviewMtsrApp canExecute={canExecute} />
    </AppShell>
  );
}
