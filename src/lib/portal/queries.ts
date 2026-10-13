import "server-only";

import { createClient } from "@/lib/supabase/server";
import type { Competence } from "@/lib/governance/competence";
import {
  mapLeadershipHome,
  mapOperationalHome,
  type Loaded,
  type LeadershipHome,
  type OperationalHome,
} from "@/lib/portal/types";

/**
 * Leituras do Início (pós-login). As rotinas do banco resolvem a pessoa pela
 * sessão e recusam quem não pertence à organização — nenhuma recebe "quem"
 * por parâmetro.
 */

export async function getOperationalHome(organizationId: string, competence: Competence): Promise<OperationalHome> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("my_operational_home", {
    p_organization_id: organizationId,
    p_year: competence.year,
    p_month: competence.month,
  });
  if (error) throw new Error(error.message);
  return mapOperationalHome(data);
}

export async function getLeadershipHome(organizationId: string): Promise<LeadershipHome> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("my_leadership_home", { p_organization_id: organizationId });
  if (error) throw new Error(error.message);
  return mapLeadershipHome(data);
}

/**
 * Um bloco do Início que falha mostra o motivo no próprio bloco — nunca um
 * zero no lugar do número que não veio — e não derruba os outros.
 */
export async function settle<T>(work: Promise<T>, label: string): Promise<Loaded<T>> {
  try {
    return { ok: true, data: await work };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`inicio: ${label}`, message);
    return { ok: false, error: friendlyError(message) };
  }
}

/** As rotinas levantam mensagens já escritas para quem opera; só o prefixo técnico sai. */
function friendlyError(message: string): string {
  const tail = message.split(": ").pop() ?? "";
  return /^[A-ZÀ-Ý]/.test(tail.trim()) ? tail.trim() : "Tente novamente em instantes.";
}
