import type { Metadata } from "next";
import { hasPermission, requireOrganization } from "@/lib/auth/session";
import { loadAppContext, loadMyInspections, type Result } from "@/lib/mtsr/app-actions";
import { MTSR_PERMISSION_CODES, type MtsrAppContext, type MtsrInspectionDetail } from "@/lib/mtsr/types";
import { MtsrApp } from "./mtsr-app";

export const metadata: Metadata = {
  title: "Vistoria MTSR",
  description: "Vistoria de campo dos componentes MTSR, enviada para validação da Segurança.",
};

/**
 * Aplicativos → Vistoria MTSR.
 *
 * A rota confere `applications.view` para entrar e `applications.mtsr.execute`
 * para executar (o código vive em Aplicativos porque a plataforma exige que
 * toda permissão de aplicativo dependa de `applications.view`). Quem só tem
 * `applications.view` vê o aplicativo e descobre que não foi autorizado a
 * executá-lo — em vez de um menu que leva a lugar nenhum.
 *
 * O contexto (componentes de campo, regras de foto, limites de evidência) vem
 * da rotina `mtsr_inspection_context`; o histórico próprio, de
 * `mtsr_my_inspections`. Perder o histórico não é motivo para perder o
 * aplicativo: quem abriu para vistoriar precisa da tela, não da lista.
 */
export default async function MtsrInspectionAppPage() {
  const { session } = await requireOrganization("applications.view");
  const canExecute = hasPermission(session, MTSR_PERMISSION_CODES.appExecute);

  let context: MtsrAppContext | null = null;
  let contextError: string | null = null;
  let history: MtsrInspectionDetail[] = [];

  if (canExecute) {
    const loaded = await loadAppContext().catch(
      (error: unknown): Result<MtsrAppContext> => ({ ok: false, error: error instanceof Error ? error.message : "Não foi possível abrir a Vistoria MTSR." }),
    );
    if (loaded.ok && loaded.data) context = loaded.data;
    else contextError = loaded.error ?? "Não foi possível abrir a Vistoria MTSR.";

    const mine = await loadMyInspections(30).catch(() => null);
    if (mine?.ok && mine.data) history = mine.data;
  }

  return <MtsrApp context={context} contextError={contextError} history={history} canExecute={canExecute} />;
}
