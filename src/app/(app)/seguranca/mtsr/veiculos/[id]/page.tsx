import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { hasPermission, requireOrganization } from "@/lib/auth/session";
import { getMtsrVehicleSheet } from "@/lib/mtsr/queries";
import { MTSR_PERMISSION_CODES, type MtsrPerms, type MtsrVehicleSheet } from "@/lib/mtsr/types";
import { VehicleSheetView } from "./vehicle-sheet-view";

export const metadata: Metadata = {
  title: "Ficha MTSR do veículo",
  description: "Visão 360° do veículo no MTSR: estado oficial por componente, vistorias, manutenções vinculadas e linha do tempo.",
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Segurança › Gestão de MTSR › Ficha do veículo.
 *
 * A rota confere `mtsr.view`; a rotina `mtsr_vehicle_sheet` roda sob o cliente
 * da própria pessoa (RLS e escopo por operação/veículo decidem o que volta).
 * Veículo fora do escopo e veículo inexistente recebem a mesma resposta (404):
 * confirmar que uma placa existe já é informação sobre a frota.
 */
export default async function MtsrVehicleSheetPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { session, organization } = await requireOrganization("mtsr.view");
  if (!UUID.test(id)) notFound();

  const perms = Object.fromEntries(
    Object.entries(MTSR_PERMISSION_CODES).map(([key, code]) => [key, hasPermission(session, code)]),
  ) as unknown as MtsrPerms;

  let sheet: MtsrVehicleSheet | null = null;
  let error: string | null = null;
  try {
    sheet = await getMtsrVehicleSheet(organization.organizationId, id);
  } catch (e) {
    error = e instanceof Error ? e.message : "Não foi possível abrir a ficha MTSR.";
  }
  if (!error && !sheet?.vehicle) notFound();

  return <VehicleSheetView vehicleId={id} initial={sheet} error={error} perms={perms} />;
}
