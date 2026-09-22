import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getSessionContext, hasPermission } from "@/lib/auth/session";
import { buildWorkbook, buildCsv } from "@/lib/admin/spreadsheet";
import { listBrPlannerRows, type BrPlannerFilters } from "@/lib/governance/br-planner";
import { listFidelizationHistory } from "@/lib/governance/queries";
import { parseCompetence, formatCompetence } from "@/lib/governance/competence";
import { ALLOCATION_TEMPLATE_HEADERS, BR_TEMPLATE_HEADERS } from "@/lib/governance/import-columns";

/**
 * Exporta o Planner de Locais e BRs ou o histórico de movimentações da
 * competência em tela (Etapa 13, continuação; permissão `fidelization.export`).
 *
 * As linhas vêm das mesmas consultas `security invoker` que a página usa, então
 * o arquivo só pode conter o que quem exporta já enxergava — a exportação não
 * é uma segunda porta, mais larga, para os dados. Cada exportação é registrada
 * na auditoria. Os modelos vazios de importação (§56, §57) saem daqui também,
 * para quem tem `fidelization.import`.
 */

const PLANNER_HEADERS = [
  "Operação", "Estado", "Cidade", "Código BR", "Descrição", "Situação",
  "Liderança", "Origem da liderança", "Frota", "Placa", "Vínculo desde", "Vínculo até", "Motorista",
];

const HISTORY_HEADERS = [
  "Operação", "Estado", "Cidade", "Código BR", "Frota", "Placa", "Marca/Modelo", "Tipo de alocação",
  "Início", "Fim", "Situação", "Origem", "Motivo", "Motivo do encerramento",
];

const ASSIGNMENT_STATUS: Record<string, string> = {
  planned: "Planejado", confirmed: "Confirmado", executed: "Executado", cancelled: "Cancelado",
};
const SOURCE: Record<string, string> = {
  manual: "Manual", import: "Importação", substitution: "Substituição", inversion: "Inversão",
};
const LEADER_SCOPE: Record<string, string> = { br: "Exceção do BR", city: "Cidade", operation: "Operação" };

function formatDate(value: string | null | undefined): string {
  if (!value) return "";
  const [year, month, day] = value.split("-");
  return year && month && day ? `${day}/${month}/${year}` : value;
}

function fileResponse(buffer: Buffer, fileName: string, format: "xlsx" | "csv") {
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type":
        format === "csv"
          ? "text/csv; charset=utf-8"
          : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${fileName}"`,
      "Cache-Control": "no-store",
    },
  });
}

export async function GET(request: NextRequest) {
  const session = await getSessionContext();
  if (!session?.activeOrganization) {
    return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
  }
  const organizationId = session.activeOrganization.organizationId;
  const params = request.nextUrl.searchParams;
  const kind = params.get("tipo") ?? "planner";
  const format: "xlsx" | "csv" = params.get("format") === "csv" ? "csv" : "xlsx";

  // Modelos vazios de importação: só os cabeçalhos, nenhuma linha.
  if (kind === "modelo-brs" || kind === "modelo-alocacoes") {
    if (!hasPermission(session, "fidelization.import")) {
      return NextResponse.json({ error: "Sem permissão para importar." }, { status: 403 });
    }
    const headers = kind === "modelo-brs" ? BR_TEMPLATE_HEADERS : ALLOCATION_TEMPLATE_HEADERS;
    const name = kind === "modelo-brs" ? "modelo-importacao-brs.xlsx" : "modelo-importacao-alocacoes.xlsx";
    const buffer = await buildWorkbook(kind === "modelo-brs" ? "BRs" : "Alocações", headers, []);
    return fileResponse(buffer, name, "xlsx");
  }

  if (!hasPermission(session, "fidelization.export")) {
    return NextResponse.json({ error: "Sem permissão para exportar." }, { status: 403 });
  }

  const competence = parseCompetence(params.get("ano") ?? undefined, params.get("mes") ?? undefined);
  const filters: BrPlannerFilters = {
    operationId: params.get("operacao") ?? undefined,
    stateId: params.get("uf") ?? undefined,
    cityId: params.get("cidade") ?? undefined,
    q: params.get("q") ?? undefined,
    status: params.get("situacao") ?? undefined,
    leaderEmployeeId: params.get("lideranca") ?? undefined,
    vehicle: params.get("veiculo") ?? undefined,
    driver: params.get("motorista") ?? undefined,
  };
  const label = formatCompetence(competence).replace("/", "-");

  let headers: string[];
  let data: (string | number | null)[][];
  let name: string;

  if (kind === "historico") {
    const rows = await listFidelizationHistory(organizationId, competence, {
      operationId: filters.operationId,
      stateId: filters.stateId,
      cityId: filters.cityId,
      brId: params.get("br") ?? undefined,
    });
    headers = HISTORY_HEADERS;
    data = rows.map((r) => [
      r.operationName, r.stateUf, r.cityName, r.brCode, r.fleetCode ?? "", r.licensePlate ?? "",
      [r.vehicleMakeName, r.vehicleModelName].filter(Boolean).join(" "),
      r.vehicleRole === "support" ? "Apoio" : "Titular",
      formatDate(r.startDate), r.endDate ? formatDate(r.endDate) : "em aberto",
      ASSIGNMENT_STATUS[r.status] ?? r.status, SOURCE[r.source] ?? r.source,
      r.reason ?? "", r.endReason ?? "",
    ]);
    name = `fidelizacao-historico-${label}.${format}`;
  } else {
    const rows = await listBrPlannerRows(organizationId, competence, filters);
    headers = PLANNER_HEADERS;
    data = rows.map((r) => [
      r.operationName, r.stateUf, r.cityName, r.code, r.description ?? "",
      r.status === "active" ? "Ativa" : "Inativa",
      r.leaderName ?? "", r.leaderScope ? (LEADER_SCOPE[r.leaderScope] ?? r.leaderScope) : "",
      r.fleetCode ?? "", r.licensePlate ?? "",
      formatDate(r.assignmentStart), formatDate(r.assignmentEnd), r.driverName ?? "",
    ]);
    name = `fidelizacao-planner-${label}.${format}`;
  }

  const supabase = await createClient();
  const { error: auditError } = await supabase.rpc("log_fidelization_export", {
    p_organization_id: organizationId,
    p_format: format,
    p_row_count: data.length,
    p_kind: kind === "historico" ? "historico" : "planner",
  });
  // Sem registro não há exportação: a auditoria é parte do contrato, não um extra.
  if (auditError) {
    return NextResponse.json({ error: "Não foi possível registrar a exportação." }, { status: 403 });
  }

  const buffer =
    format === "csv"
      ? buildCsv(headers, data)
      : await buildWorkbook(kind === "historico" ? "Histórico" : "Planner", headers, data);
  return fileResponse(buffer, name, format);
}
