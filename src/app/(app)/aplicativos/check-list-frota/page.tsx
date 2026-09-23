import type { Metadata } from "next";
import { requireOrganization } from "@/lib/auth/session";
import { getChecklistContext, listMyExecutions, type ExecutionSummary } from "@/lib/applications/queries";
import { ChecklistApp } from "./checklist-app";

export const metadata: Metadata = {
  title: "Check List de Frota",
  description: "Inspeção operacional da frota na saída e no retorno de rota.",
};

/**
 * Aplicativos → Check List de Frota.
 *
 * A rota confere `applications.view` para entrar e passa adiante o que a
 * pessoa pode fazer: executar, ver o próprio histórico, configurar. Quem só
 * tem `applications.view` vê o aplicativo e descobre que não foi autorizado a
 * executá-lo — em vez de encontrar um menu que leva a lugar nenhum.
 */
export default async function ChecklistFleetPage() {
  const { session, organization } = await requireOrganization("applications.view");
  const has = (code: string) => session.isPlatformAdmin || session.permissions.includes(code);

  const context = await getChecklistContext(organization.organizationId);

  // Perder o histórico não é motivo para perder o aplicativo: quem abriu para
  // fazer o checklist da saída precisa da tela, não da lista do mês.
  let history: ExecutionSummary[] = [];
  if (has("applications.checklist_fleet.view_own")) {
    history = await listMyExecutions(organization.organizationId).catch(() => []);
  }

  return (
    <ChecklistApp
      context={context}
      history={history}
      canExecute={has("applications.checklist_fleet.execute")}
      canViewOwn={has("applications.checklist_fleet.view_own")}
      canViewScope={has("applications.checklist_fleet.view_details")}
      canConfigure={has("applications.checklist_fleet.configure")}
      canCorrect={has("applications.checklist_fleet.correct")}
    />
  );
}
