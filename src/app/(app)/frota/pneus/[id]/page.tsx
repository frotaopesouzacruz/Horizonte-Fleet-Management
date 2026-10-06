import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireOrganization } from "@/lib/auth/session";
import { getTireSheet } from "@/lib/tires/queries";
import { TIRES_BASE_PATH, type TireSheet } from "@/lib/tires/types";
import { TireSheetError, TireSheetView } from "./tire-sheet-view";

export const metadata: Metadata = {
  title: "Ficha do pneu",
  description:
    "Ficha 360° do pneu: situação atual na base oficial (Rodopar), dados brutos do relatório, linha do tempo, dados por data, consertos e vistorias de campo.",
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Gestão de Frota › Gestão de Pneus › Ficha do pneu.
 *
 * A rota confere `tires.view`; a rotina `tire_sheet` roda sob o cliente da
 * própria pessoa (RLS e escopo pelo veículo/operação dos dados mais recentes
 * do pneu). Pneu inexistente e pneu fora do escopo recebem a mesma resposta
 * (404): confirmar que um Nº Fogo existe já é informação sobre a frota.
 */
export default async function TireSheetPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { organization } = await requireOrganization("tires.view");
  if (!UUID.test(id)) notFound();

  let sheet: TireSheet | null = null;
  let error: string | null = null;
  try {
    sheet = await getTireSheet(organization.organizationId, id);
  } catch (e) {
    error = e instanceof Error ? e.message : "Não foi possível abrir a ficha do pneu.";
  }
  if (error) return <TireSheetError message={error} basePath={TIRES_BASE_PATH} />;
  if (!sheet?.tire) notFound();

  return <TireSheetView sheet={sheet} basePath={TIRES_BASE_PATH} />;
}
