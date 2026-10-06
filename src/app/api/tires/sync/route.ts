import { NextResponse, type NextRequest } from "next/server";
import { revalidatePath } from "next/cache";
import { runScheduledSyncs } from "@/lib/tires/sync/server";

/**
 * Sincronização agendada da fonte oficial dos pneus (Vercel Cron).
 *
 * Só aceita a chamada do agendador: `Authorization: Bearer <CRON_SECRET>`.
 * Sem o segredo configurado, recusa tudo — nunca roda aberta. A trava, o
 * intervalo mínimo e o registro de cada execução ficam no banco
 * (`tire_sync_begin`/`tire_sync_finish`).
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ ok: false, error: "Agendamento não configurado." }, { status: 503 });
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false, error: "Não autorizado." }, { status: 401 });
  }
  try {
    const results = await runScheduledSyncs();
    revalidatePath("/frota/pneus");
    return NextResponse.json({
      ok: true,
      results: results.map((r) => ({ organizationId: r.organizationId, status: r.outcome.status, runId: r.outcome.runId, message: r.outcome.message })),
    });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Falha na sincronização agendada." }, { status: 500 });
  }
}
