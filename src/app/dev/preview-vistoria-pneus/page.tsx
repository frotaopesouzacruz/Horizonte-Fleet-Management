import { notFound } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
import fixtures from "@/app/dev/preview-pneus/fixtures.json";
import { TIRES_PERMISSION_CODES } from "@/lib/tires/types";
import { PreviewTiresApp, type PreviewScenario } from "./preview-app";

export const metadata = {
  title: "Preview · Vistoria de Pneus",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

// Valor do servidor: um array exportado de módulo "use client" chegaria aqui como referência de cliente.
const PREVIEW_SCENARIOS: readonly PreviewScenario[] = ["base", "retorno", "falha", "sem-foto", "indisponivel"];

const enabled = process.env.NODE_ENV !== "production" || process.env.NEXT_PUBLIC_ENABLE_DEV_PAGES === "1";

/** Só as saídas das rotinas do aplicativo seguem para o navegador (o resto dos fixtures é do portal). */
const APP_KEYS = (key: string) =>
  key === "app_context" || key === "app_vehicles" || key === "my_inspections" || key.startsWith("app_positions:") || key.startsWith("my_detail:");

/**
 * O aplicativo Vistoria de Pneus inteiro — início → frota → medição →
 * revisão → envio → protocolo → minhas vistorias — com carregadores injetados
 * que devolvem os fixtures da Gestão de Pneus (formato do banco, convertidos
 * por `camelize`) e um envio simulado (protocolo PNEU-2026-000123, idempotente
 * pela `clientSubmissionId`).
 *
 * `?perfil=consulta` renderiza como quem só tem `applications.view`.
 * `?cenario=` acrescenta um caso que os fixtures não trazem:
 *   - `retorno`: a vistoria PNEU-2026-000004 (SOY7E65) retornada com nota do
 *     revisor — destaque na lista de frotas, nota na medição e "Refazer";
 *   - `falha`: o primeiro envio "chega" ao banco mas a resposta se perde; o
 *     reenvio usa a mesma chave e recebe o mesmo protocolo (`duplicate`);
 *   - `sem-foto`: a base oficial (Rodopar) ainda não recebeu nenhum dado;
 *   - `indisponivel`: aplicativo inativo na organização.
 */
export default async function TiresAppPreviewPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  if (!enabled) notFound();
  const params = await searchParams;
  const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const canExecute = first(params.perfil) !== "consulta";
  const requested = first(params.cenario);
  const scenario: PreviewScenario = (PREVIEW_SCENARIOS as readonly string[]).includes(requested ?? "") ? (requested as PreviewScenario) : "base";

  const all = fixtures as unknown as Record<string, unknown>;
  const picked: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(all)) if (APP_KEYS(key)) picked[key] = value;

  return (
    <AppShell permissions={canExecute ? ["applications.view", TIRES_PERMISSION_CODES.appExecute] : ["applications.view"]}>
      <PreviewTiresApp canExecute={canExecute} fixtures={picked} scenario={scenario} />
    </AppShell>
  );
}
