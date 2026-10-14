import type { HomeCapabilities } from "@/lib/home/resolver";
import { loadLeadershipSecondary } from "@/lib/portal/leadership-data";
import { LeadershipSecondaryBlocks } from "./leadership-secondary";

/**
 * Os blocos secundários da Home da Liderança, carregados depois da primeira
 * pintura (Suspense na rota). Componente de servidor: lê sob a sessão da
 * própria pessoa e entrega os números prontos ao cliente.
 */
export async function LeadershipSecondary({
  organizationId,
  can,
  leaderId,
  operationId,
  today,
  query,
}: {
  organizationId: string;
  can: HomeCapabilities;
  leaderId: string | null;
  operationId: string | null;
  today: string;
  query: string;
}) {
  const data = await loadLeadershipSecondary(organizationId, can, { leaderId, operationId, today });
  return <LeadershipSecondaryBlocks data={data} query={query} />;
}
