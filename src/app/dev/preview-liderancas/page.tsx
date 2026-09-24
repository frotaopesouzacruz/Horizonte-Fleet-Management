import { notFound } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
import { PreviewLeadership } from "./preview-leadership";

/**
 * Renders Lideranças against fixed data.
 *
 * The real screen sits behind a session and an organisation, which makes it
 * impossible to look at from an environment that cannot reach Supabase. Same
 * gate as the design system: absent from a normal production build.
 *
 * The fixture has the three scope levels side by side — one leader by city,
 * one by BR-level exception, one substitute by operation — and one place with
 * nobody, because the cards and the §35 drawer exist to tell those apart. The
 * Planejamento matrix (Tipo de Operação → Cidades) comes from
 * `fixture-planner.ts` and changes in memory when a leader is chosen.
 */
export const metadata = { title: "Preview · Lideranças", robots: { index: false, follow: false } };

export const dynamic = "force-dynamic";

const enabled =
  process.env.NODE_ENV !== "production" || process.env.NEXT_PUBLIC_ENABLE_DEV_PAGES === "1";

type SearchParams = Record<string, string | string[] | undefined>;

/**
 * Chaves na URL:
 *   `?competencia=passada` — Agosto/2026 com "hoje" em 23/09: escolher ou
 *                            remover é correção histórica, com motivo;
 *   `?sem_historico=1`     — sem `leadership.manage_historical_data`.
 */
export default async function PreviewPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  if (!enabled) notFound();
  const params = await searchParams;
  const past = params.competencia === "passada";
  const withoutHistorical = params.sem_historico === "1";

  return (
    <AppShell
      permissions={[
        "leadership.view",
        "leadership.manage",
        "leadership.assign",
        "leadership.replicate",
        ...(withoutHistorical ? [] : ["leadership.manage_historical_data"]),
      ]}
    >
      <PreviewLeadership tense={past ? "past" : "current"} canManageHistorical={!withoutHistorical} />
    </AppShell>
  );
}
