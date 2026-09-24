import "server-only";

import { createClient } from "@/lib/supabase/server";
import type { Competence } from "./competence";
import { mapLeadershipPlanner, type LeadershipPlanner } from "./leadership-planner-types";

/**
 * A matriz do Planejamento de Lideranças da competência: operações ativas do
 * escopo de quem pede → cidades → liderança principal da cidade no mês, mais as
 * pessoas do perfil Liderança Operações que o seletor oferece.
 *
 * Uma chamada só (`leadership_city_planner`): a rotina confere
 * `leadership.view` e o escopo por operação no banco, e a tela não monta a
 * matriz com uma consulta por cidade.
 */
export async function getLeadershipCityPlanner(
  organizationId: string,
  competence: Competence,
): Promise<LeadershipPlanner> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("leadership_city_planner", {
    p_organization_id: organizationId,
    p_year: competence.year,
    p_month: competence.month,
  });
  if (error) throw new Error(error.message);
  return mapLeadershipPlanner(data);
}
