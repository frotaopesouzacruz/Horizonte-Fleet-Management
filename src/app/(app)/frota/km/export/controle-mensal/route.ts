import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse, type NextRequest } from "next/server";
import { requireOrganization } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { getKmFilterOptions } from "@/lib/km/options";
import { fetchPlanner, kmPlannerPayload, type KmPlannerData } from "@/lib/km/planner";
import { kmFiltersPayload, parseKmFilters } from "@/lib/km/url";
import { formatStamp } from "@/lib/maintenance/types";
import {
  buildControleMensalXlsx,
  controleMensalFileName,
  controleMensalRowCount,
  describeKmFilters,
} from "@/lib/km/export/controle-mensal";

/**
 * Controle Mensal de KM Rodado (XLSX) — o modelo corporativo da aba
 * "KM Rodado", montado de `km_planner` com os mesmos filtros e o mesmo escopo
 * da tela Planner mês/dia (cliente de quem exporta, sob a RLS). A exportação é
 * registrada na auditoria (`log_km_export`) antes de o arquivo sair; sem
 * registro, não há arquivo.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Rpc = (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>;

async function readLogo(): Promise<Buffer | null> {
  try {
    return await readFile(path.join(process.cwd(), "public", "brand", "logo-light.png"));
  } catch {
    return null;
  }
}

export async function GET(request: NextRequest) {
  const { session, organization } = await requireOrganization("km.export");
  const organizationId = organization.organizationId;
  const params = Object.fromEntries(request.nextUrl.searchParams.entries());
  const filters = parseKmFilters(params);
  const payload = kmFiltersPayload(filters);

  let data: KmPlannerData;
  try {
    data = await fetchPlanner(organizationId, filters, payload);
  } catch (error) {
    console.error("km: controle-mensal", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "Não foi possível ler o planner para exportar o Controle Mensal." }, { status: 500 });
  }

  const [options, logo] = await Promise.all([getKmFilterOptions(organizationId).catch(() => null), readLogo()]);

  let file: Buffer;
  try {
    file = await buildControleMensalXlsx({
      data,
      organizationName: organization.organizationName,
      generatedBy: session.fullName,
      generatedAt: formatStamp(new Date().toISOString()),
      filters: describeKmFilters(filters, options),
      logo,
    });
  } catch (error) {
    console.error("km: controle-mensal xlsx", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "Não foi possível montar o arquivo do Controle Mensal." }, { status: 500 });
  }

  // Sem registro não há exportação: a auditoria é parte do contrato.
  const supabase = await createClient();
  const { error: auditError } = await (supabase.rpc as unknown as Rpc)("log_km_export", {
    p_organization_id: organizationId,
    p_kind: "controle_mensal",
    p_format: "xlsx",
    p_row_count: controleMensalRowCount(data),
    p_filters: { ...kmPlannerPayload(filters, payload), competence: data.period.competence },
  });
  if (auditError) {
    return NextResponse.json({ error: "Não foi possível registrar a exportação na auditoria." }, { status: 403 });
  }

  return new Response(new Uint8Array(file), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${controleMensalFileName(data)}"`,
      "Cache-Control": "no-store",
    },
  });
}
