import type { Metadata } from "next";
import { hasPermission, requireOrganization } from "@/lib/auth/session";
import { PREDICTIVE_APP_PERMISSION, type PredictiveAppContext, type PredictiveMySubmission } from "@/lib/maintenance/predictive-app";
import { loadMyPredictiveSubmissions, loadPredictiveAppContext, type Result } from "@/lib/maintenance/predictive-app-actions";
import { PredictiveApp } from "./predictive-app";

export const metadata: Metadata = {
  title: "Verificação Preditiva de Frota",
  description: "Roteiro técnico por cluster: cada item verificado reinicia, monitora ou abre corretiva no motor preditivo.",
};

/**
 * Aplicativos → Verificação Preditiva de Frota.
 *
 * A rota confere `applications.view` para entrar e
 * `applications.predictive.execute` para executar. Quem só tem a primeira vê o
 * aplicativo e descobre que não foi autorizado a executá-lo — em vez de um
 * menu que leva a lugar nenhum. O contexto (responsável automático, regras de
 * KM, vocabulário de resultados) vem de `maintenance_predictive_app_context`;
 * o histórico próprio, de `maintenance_predictive_my_submissions`.
 */
export default async function PredictiveAppPage() {
  const { session } = await requireOrganization("applications.view");
  const canExecute = hasPermission(session, PREDICTIVE_APP_PERMISSION);

  let context: PredictiveAppContext | null = null;
  let contextError: string | null = null;
  let history: PredictiveMySubmission[] = [];

  if (canExecute) {
    const loaded = await loadPredictiveAppContext().catch(
      (error: unknown): Result<PredictiveAppContext> => ({ ok: false, error: error instanceof Error ? error.message : "Não foi possível abrir a Verificação Preditiva." }),
    );
    if (loaded.ok && loaded.data) context = loaded.data;
    else contextError = loaded.error ?? "Não foi possível abrir a Verificação Preditiva.";

    const mine = await loadMyPredictiveSubmissions(30).catch(() => null);
    if (mine?.ok && mine.data) history = mine.data;
  }

  return <PredictiveApp context={context} contextError={contextError} history={history} canExecute={canExecute} />;
}
