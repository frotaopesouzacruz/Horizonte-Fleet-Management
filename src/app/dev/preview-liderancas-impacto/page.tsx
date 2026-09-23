import { notFound } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
import { PreviewLeadershipImpact } from "./preview-impact";

/**
 * Lideranças com exportação (Etapa 08 §20) e prévia de impacto da correção
 * histórica (Etapa 13 §14), contra dados fixos — Setembro/2026, "hoje" em
 * 23/09/2026.
 *
 * A tela real fica atrás de sessão e organização; esta prévia injeta um
 * carregador de impacto e uma gravação que não saem do navegador. A gravação
 * guarda o que recebeu em `window.__leadershipSaves`, para o teste conferir
 * que o motivo seguiu junto. Mesmo portão das outras prévias: fora de um
 * build de produção comum.
 *
 * Chaves na URL:
 *   `?sem_historico=1` — sem `leadership.manage_historical_data`: a prévia é
 *                        recusada com a mensagem do banco;
 *   `?sem_exportar=1`  — sem `leadership.export`: o botão não aparece;
 *   `operacao`, `uf`, `cidade`, `nivel`, `situacao`, `lideranca` — os filtros
 *                        da tela, que a exportação repete.
 */
export const metadata = { title: "Preview · Lideranças (impacto)", robots: { index: false, follow: false } };

export const dynamic = "force-dynamic";

const enabled =
  process.env.NODE_ENV !== "production" || process.env.NEXT_PUBLIC_ENABLE_DEV_PAGES === "1";

type SearchParams = Record<string, string | string[] | undefined>;

const first = (params: SearchParams, key: string): string | undefined => {
  const value = params[key];
  const text = Array.isArray(value) ? value[0] : value;
  return text || undefined;
};

export default async function PreviewPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  if (!enabled) notFound();
  const params = await searchParams;
  const withoutHistorical = params.sem_historico === "1";
  const withoutExport = params.sem_exportar === "1";

  return (
    <AppShell
      permissions={[
        "leadership.view",
        "leadership.manage",
        "leadership.assign",
        "leadership.replicate",
        ...(withoutExport ? [] : ["leadership.export"]),
        ...(withoutHistorical ? [] : ["leadership.manage_historical_data"]),
      ]}
    >
      <PreviewLeadershipImpact
        canExport={!withoutExport}
        canManageHistorical={!withoutHistorical}
        filters={{
          operationId: first(params, "operacao"),
          stateId: first(params, "uf"),
          cityId: first(params, "cidade"),
          scope: first(params, "nivel"),
          status: first(params, "situacao"),
          employeeId: first(params, "lideranca"),
        }}
      />
    </AppShell>
  );
}
