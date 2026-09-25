import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getSessionContext, hasPermission } from "@/lib/auth/session";
import { spreadsheetResponse } from "@/lib/admin/spreadsheet";
import { parseCompetence } from "@/lib/governance/competence";
import {
  LEADERSHIP_EXPORT_HEADERS,
  leadershipExportFileName,
  leadershipExportRows,
  loadLeadershipScreen,
  readLeadershipFilters,
} from "@/lib/governance/leadership-export";

/**
 * Exporta Lideranças (Etapa 08 §20 — "Exportar, quando autorizado").
 *
 * Exige `leadership.view` e `leadership.export`. As linhas vêm da mesma
 * consulta `security invoker` que a página usa, com os mesmos filtros da URL
 * (competência, operação, estado, cidade, nível, situação, liderança) — o
 * arquivo só pode conter o que quem exporta já enxergava. Cada exportação é
 * registrada na auditoria antes de o arquivo sair; se o registro falhar, o
 * arquivo não sai. Sem teto de linhas: as vigências são lidas página a página
 * e o arquivo sai em fluxo.
 */

export const maxDuration = 60;


export async function GET(request: NextRequest) {
  const session = await getSessionContext();
  if (!session?.activeOrganization) {
    return NextResponse.json({ error: "Sua sessão expirou. Entre novamente para exportar." }, { status: 401 });
  }
  if (!hasPermission(session, "leadership.view") || !hasPermission(session, "leadership.export")) {
    return NextResponse.json({ error: "Você não possui permissão para exportar lideranças." }, { status: 403 });
  }

  const organizationId = session.activeOrganization.organizationId;
  const params = request.nextUrl.searchParams;
  const format: "xlsx" | "csv" = params.get("format") === "csv" ? "csv" : "xlsx";
  const competence = parseCompetence(params.get("ano") ?? undefined, params.get("mes") ?? undefined);
  const filters = readLeadershipFilters((key) => params.get(key));

  let rows;
  try {
    ({ rows } = await loadLeadershipScreen(organizationId, competence, filters));
  } catch {
    return NextResponse.json({ error: "Não foi possível ler as lideranças para exportar." }, { status: 500 });
  }
  const data = leadershipExportRows(rows, competence);

  const supabase = await createClient();
  const { error: auditError } = await supabase.rpc("log_leadership_export", {
    p_organization_id: organizationId,
    p_format: format,
    p_row_count: data.length,
    p_filters: {
      ano: String(competence.year),
      mes: String(competence.month),
      operacao: filters.operationId ?? null,
      uf: filters.stateId ?? null,
      cidade: filters.cityId ?? null,
      nivel: filters.scope ?? null,
      situacao: filters.status ?? null,
      lideranca: filters.employeeId ?? null,
    },
  });
  // Sem registro não há exportação: a auditoria é parte do contrato, não um extra.
  if (auditError) {
    return NextResponse.json({ error: "Não foi possível registrar a exportação na auditoria." }, { status: 403 });
  }

  const name = leadershipExportFileName(competence, format);
  return spreadsheetResponse({
    format, fileName: name, sheetName: "Lideranças", headers: LEADERSHIP_EXPORT_HEADERS, rows: data,
  });
}
