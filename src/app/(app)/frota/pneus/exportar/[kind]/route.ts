import { NextResponse, type NextRequest } from "next/server";
import { hasPermission, requireOrganization } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import {
  buildTiresWorkbook,
  collectTiresExport,
  isTiresExportKind,
  tiresExportFileName,
  tiresExportLogFilters,
  tiresExportRequest,
  tiresExportRowCount,
  type TiresExportData,
  type TiresExportKind,
  type TiresExportSource,
} from "@/lib/tires/export-workbook";
import {
  getTireInspectionsReceived,
  getTiresAudit,
  getTiresAuditCenter,
  getTiresBase,
  getTiresEvents,
  getTiresFilterOptions,
  getTiresIndicator,
  getTiresSchedule,
} from "@/lib/tires/queries";
import { TIRES_PERMISSION_CODES } from "@/lib/tires/types";
import type { SearchParamsLike } from "@/lib/tires/url";
import { loadLogo, xlsxResponse } from "@/app/(app)/frota/km/relatorio/xlsx-kit";

/**
 * Exportações XLSX da Gestão de Pneus — `/frota/pneus/exportar/<tipo>`.
 *
 * Mesmo recorte do carregador de cada aba (filtros globais + parâmetros da
 * aba), lido página a página até o total (500 por chamada, o teto das
 * rotinas — sem teto silencioso), sob o cliente da própria pessoa (RLS e
 * escopo decididos no banco). A exportação é registrada em
 * `log_tire_export` ANTES de o arquivo sair: se o registro falhar, não há
 * arquivo. A montagem da planilha mora em `@/lib/tires/export-workbook`.
 */
export const maxDuration = 60;

/** Permissão de leitura da aba que cada exportação percorre (o banco confere de novo). */
const READ_PERMISSION: Record<Exclude<TiresExportKind, "historico">, string> = {
  base: TIRES_PERMISSION_CODES.base,
  medicao: TIRES_PERMISSION_CODES.measurement,
  calibragem: TIRES_PERMISSION_CODES.calibration,
  cronograma: TIRES_PERMISSION_CODES.schedule,
  vistorias: TIRES_PERMISSION_CODES.view,
  qualidade: TIRES_PERMISSION_CODES.quality,
};

type RpcVoid = (fn: string, args: Record<string, unknown>) => Promise<{ error: { message: string } | null }>;

export async function GET(request: NextRequest, { params }: { params: Promise<{ kind: string }> }) {
  const { kind } = await params;
  if (!isTiresExportKind(kind)) {
    return NextResponse.json({ error: "Exportação desconhecida." }, { status: 404 });
  }

  const { session, organization } = await requireOrganization(TIRES_PERMISSION_CODES.export);
  const orgId = organization.organizationId;
  const perms = {
    history: hasPermission(session, TIRES_PERMISSION_CODES.history),
    audit: hasPermission(session, TIRES_PERMISSION_CODES.audit),
  };
  const allowed = kind === "historico" ? perms.history || perms.audit : hasPermission(session, READ_PERMISSION[kind]);
  if (!allowed) {
    return NextResponse.json({ error: "Sem permissão para ler os dados desta exportação." }, { status: 403 });
  }

  const query: SearchParamsLike = Object.fromEntries(request.nextUrl.searchParams.entries());
  const req = tiresExportRequest(kind, query, perms);

  const source: TiresExportSource = {
    base: (payload, view, sort, dir, limit, offset) => getTiresBase(orgId, payload, view, sort, dir, limit, offset),
    indicator: (indicator, payload, status, limit, offset) => getTiresIndicator(orgId, indicator, payload, status, limit, offset),
    schedule: (payload, window, limit, offset) => getTiresSchedule(orgId, payload, window, limit, offset),
    auditCenter: (payload, audit, limit, offset) =>
      getTiresAuditCenter(orgId, payload, { ...audit, groupBy: "rule", limit, offset }),
    inspections: (filters, limit, offset) => getTireInspectionsReceived(orgId, filters, limit, offset),
    events: (filters, limit, offset) => getTiresEvents(orgId, filters, limit, offset),
    audit: (filters, limit, offset) => getTiresAudit(orgId, filters, limit, offset),
  };

  let data: TiresExportData;
  let options: Awaited<ReturnType<typeof getTiresFilterOptions>> | null;
  try {
    [data, options] = await Promise.all([
      collectTiresExport(req, source),
      // só para os nomes dos filtros; sem opções, o arquivo sai com a contagem dos ids
      getTiresFilterOptions(orgId, req.filters.reference ?? null).catch(() => null),
    ]);
  } catch (error) {
    const message = error instanceof Error ? error.message.replace(/^tires?_[a-z_]+:\s*/, "") : "";
    return NextResponse.json({ error: message || "Não foi possível ler os dados da exportação." }, { status: 500 });
  }

  // Exportar é tirar dados do sistema: o registro vai antes do arquivo.
  const supabase = await createClient();
  const { error: logError } = await (supabase.rpc as unknown as RpcVoid)("log_tire_export", {
    p_organization_id: orgId,
    p_kind: kind,
    p_filters: tiresExportLogFilters(req),
    p_rows: tiresExportRowCount(data),
  });
  if (logError) {
    return NextResponse.json({ error: "Não foi possível registrar a exportação na auditoria." }, { status: 403 });
  }

  const wb = buildTiresWorkbook(data, {
    logo: await loadLogo(request.nextUrl.origin),
    generatedBy: session.displayName,
    organizationName: organization.organizationName,
    options,
  });
  return xlsxResponse(wb, tiresExportFileName(kind));
}
