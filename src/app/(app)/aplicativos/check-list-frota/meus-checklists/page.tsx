import type { Metadata } from "next";
import { hasPermission, requireOrganization } from "@/lib/auth/session";
import { listMyExecutions } from "@/lib/applications/queries";
import { MyChecklistsView, type MyChecklistsResult } from "./my-checklists-view";

export const metadata: Metadata = {
  title: "Meus checklists · Check List de Frota",
  description: "Os checklists de saída e de retorno que você enviou.",
};

/** O teto da rotina `checklist_my_executions`. */
const LIMIT = 200;

/**
 * Aplicativos → Check List de Frota → Meus checklists.
 *
 * Entrada por `applications.checklist_fleet.view_own`: é a lista da própria
 * pessoa, a mesma que o aplicativo mostra em "Meus checklists".
 */
export default async function MyChecklistsPage() {
  const { session, organization } = await requireOrganization("applications.checklist_fleet.view_own");

  let result: MyChecklistsResult;
  try {
    result = { ok: true, rows: await listMyExecutions(organization.organizationId, LIMIT), limit: LIMIT };
  } catch (error) {
    console.error("meus-checklists", error instanceof Error ? error.message : error);
    result = { ok: false, error: "Tente novamente em instantes." };
  }

  return <MyChecklistsView result={result} canExecute={hasPermission(session, "applications.checklist_fleet.execute")} />;
}
