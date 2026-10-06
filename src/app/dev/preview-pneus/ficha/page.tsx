import { notFound } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
import { TireSheetError, TireSheetView } from "@/app/(app)/frota/pneus/[id]/tire-sheet-view";
import { getTireSheet } from "@/lib/tires/queries";
import { tiresFixtureStore } from "@/lib/tires/rpc";
import { TIRES_PERMISSION_CODES, type TireSheet } from "@/lib/tires/types";
import { firstParam, type SearchParamsLike } from "@/lib/tires/url";
import { previewIds, tiresPreviewResolver } from "../preview-data";

/**
 * Ficha 360° de um pneu renderizada contra os fixtures da prévia: o mesmo
 * carregador da rota real, com a chamada ao banco trocada pelo resolver.
 * `?id=` escolhe o pneu entre os presentes nos fixtures (padrão: o primeiro).
 * Mesmo portão das demais prévias: ausente de um build de produção normal.
 */
export const metadata = { title: "Preview · Ficha do pneu", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

const enabled = process.env.NODE_ENV !== "production" || process.env.NEXT_PUBLIC_ENABLE_DEV_PAGES === "1";
const ORG = "00000000-0000-0000-0000-000000000000";
const BASE_PATH = "/dev/preview-pneus";

export default async function PreviewTireSheetPage({ searchParams }: { searchParams: Promise<SearchParamsLike> }) {
  if (!enabled) notFound();
  const params = await searchParams;
  const granted = Object.values(TIRES_PERMISSION_CODES);
  const requested = firstParam(params, "id");
  const id = requested && previewIds.sheets.includes(requested) ? requested : previewIds.sheets[0];

  let sheet: TireSheet | null = null;
  let error: string | null = null;
  try {
    sheet = await tiresFixtureStore.run(tiresPreviewResolver, () => getTireSheet(ORG, id ?? "preview"));
  } catch (e) {
    error = e instanceof Error ? e.message : "Não foi possível abrir a ficha do pneu.";
  }

  return (
    <AppShell permissions={granted}>
      {error || !sheet?.tire ? (
        <TireSheetError message={error ?? "Sem fixture de ficha na prévia."} basePath={BASE_PATH} />
      ) : (
        <TireSheetView sheet={sheet} basePath={BASE_PATH} />
      )}
    </AppShell>
  );
}
