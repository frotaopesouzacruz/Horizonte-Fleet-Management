import { notFound } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
import { PreviewPredictiveApp } from "./preview-app";

export const metadata = {
  title: "Preview · Verificação Preditiva",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

const enabled = process.env.NODE_ENV !== "production" || process.env.NEXT_PUBLIC_ENABLE_DEV_PAGES === "1";

/**
 * O aplicativo Verificação Preditiva de Frota inteiro — início → frota →
 * identificação (KM) → roteiro por cluster → revisão → envio → protocolo →
 * meus envios — com contexto fixo e carregadores injetados. É o que permite
 * verificar num navegador de verdade a validação do KM (divergência pede
 * justificativa; sem KM oficial o KM é obrigatório), os bloqueios do roteiro
 * (não conforme sem descrição, monitoramento sem alvo, passo obrigatório sem
 * resposta, número inválido), a revisão, o protocolo e o rascunho que
 * sobrevive ao recarregar com a mesma chave de idempotência.
 *
 * `?perfil=consulta` renderiza como quem só tem `applications.view`.
 */
export default async function PredictiveAppPreviewPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  if (!enabled) notFound();
  const params = await searchParams;
  const perfil = Array.isArray(params.perfil) ? params.perfil[0] : params.perfil;
  const canExecute = perfil !== "consulta";

  return (
    <AppShell permissions={canExecute ? ["applications.view", "applications.predictive.execute"] : ["applications.view"]}>
      <PreviewPredictiveApp canExecute={canExecute} />
    </AppShell>
  );
}
