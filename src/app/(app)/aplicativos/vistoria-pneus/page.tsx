import type { Metadata } from "next";
import { hasPermission, requireOrganization } from "@/lib/auth/session";
import { TIRES_PERMISSION_CODES } from "@/lib/tires/types";
import { TiresApp } from "./tires-app";

export const metadata: Metadata = {
  title: "Vistoria de Pneus",
  description: "Vistoria de campo dos pneus com leitura cega, enviada para revisão da equipe de Gestão de Pneus.",
};

/**
 * Aplicativos → Vistoria de Pneus.
 *
 * A rota confere `applications.view` para entrar e `applications.tires.execute`
 * para executar (como os demais aplicativos: toda permissão de aplicativo
 * depende de `applications.view`). Quem só tem `applications.view` vê o
 * aplicativo e descobre que não foi autorizado a executá-lo — em vez de um
 * menu que leva a lugar nenhum.
 *
 * O contexto (vistoriador, limites técnicos, contadores), as frotas, as
 * posições cegas e o histórico próprio vêm das rotinas `tire_inspection_*` e
 * `tire_my_*`, chamadas pelo próprio aplicativo (`@/lib/tires/app-actions`).
 */
export default async function TiresInspectionAppPage() {
  const { session } = await requireOrganization("applications.view");
  const canExecute = hasPermission(session, TIRES_PERMISSION_CODES.appExecute);
  return <TiresApp canExecute={canExecute} />;
}
