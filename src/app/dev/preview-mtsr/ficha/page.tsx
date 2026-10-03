import { notFound } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
import { VehicleSheetView } from "@/app/(app)/seguranca/mtsr/veiculos/[id]/vehicle-sheet-view";
import { getMtsrVehicleSheet } from "@/lib/mtsr/queries";
import { mtsrFixtureStore } from "@/lib/mtsr/rpc";
import { MTSR_PERMISSION_CODES, type MtsrPerms } from "@/lib/mtsr/types";
import { mtsrPreviewResolver } from "../preview-data";

/**
 * Ficha MTSR 360° de um veículo renderizada contra os fixtures da prévia: o
 * mesmo carregador da rota real, com a chamada ao banco trocada pelo resolver.
 * As ações da ficha (atualizar, backoffice, manutenção) exigem sessão e não
 * fazem parte do que esta prévia prova. Mesmo portão das demais prévias.
 */
export const metadata = { title: "Preview · Ficha MTSR", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

const enabled = process.env.NODE_ENV !== "production" || process.env.NEXT_PUBLIC_ENABLE_DEV_PAGES === "1";
const ORG = "00000000-0000-0000-0000-000000000000";

export default async function PreviewMtsrSheetPage() {
  if (!enabled) notFound();
  const granted = [...Object.values(MTSR_PERMISSION_CODES), "maintenance.view", "maintenance.create"];
  const perms = Object.fromEntries(Object.entries(MTSR_PERMISSION_CODES).map(([key, code]) => [key, granted.includes(code)])) as unknown as MtsrPerms;

  let sheet = null;
  let error: string | null = null;
  try {
    sheet = await mtsrFixtureStore.run(mtsrPreviewResolver, () => getMtsrVehicleSheet(ORG, "preview"));
  } catch (e) {
    error = e instanceof Error ? e.message : "Não foi possível abrir a ficha MTSR.";
  }

  return (
    <AppShell permissions={granted}>
      <VehicleSheetView vehicleId={sheet?.vehicle?.vehicleId ?? "preview"} initial={sheet} error={error} perms={perms} />
    </AppShell>
  );
}
