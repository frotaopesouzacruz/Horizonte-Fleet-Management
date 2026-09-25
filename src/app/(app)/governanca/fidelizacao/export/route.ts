import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getSessionContext, hasPermission } from "@/lib/auth/session";
import { spreadsheetResponse } from "@/lib/admin/spreadsheet";
import { listBrPlannerRows, type BrPlannerFilters, type BrPlannerRow } from "@/lib/governance/br-planner";
import { getBrDirectory } from "@/lib/governance/brs";
import { listFidelizationHistory } from "@/lib/governance/queries";
import { parseCompetence, formatCompetence, monthEnd, monthStart } from "@/lib/governance/competence";
import { listMovements, MOVEMENT_TYPES, type MovementRow } from "@/lib/governance/fidelization-central";
import { ALLOCATION_TEMPLATE_HEADERS, BR_TEMPLATE_HEADERS } from "@/lib/governance/import-columns";

/**
 * Exporta o Planner de Locais e BRs, o histórico de vínculos da competência em
 * tela (Etapa 13, continuação) ou o Histórico de Mobilizações com os filtros da
 * aba (Etapa 15, §45) — sempre com a permissão `fidelization.export`.
 *
 * As linhas vêm das mesmas consultas `security invoker` que a página usa, então
 * o arquivo só pode conter o que quem exporta já enxergava — a exportação não
 * é uma segunda porta, mais larga, para os dados. Cada exportação é registrada
 * na auditoria. Os modelos vazios de importação (§56, §57) saem daqui também,
 * para quem tem `fidelization.import`.
 *
 * Sem teto de linhas: cada consulta é lida página a página até o fim, e o
 * arquivo sai em fluxo.
 */

export const maxDuration = 60;

const PLANNER_HEADERS = [
  "Operação", "Estado", "Cidade", "Código BR", "Descrição", "Situação",
  "Liderança", "Origem da liderança", "Frota", "Placa", "Vínculo desde", "Vínculo até", "Motorista",
];

const HISTORY_HEADERS = [
  "Operação", "Estado", "Cidade", "Código BR", "Frota", "Placa", "Marca/Modelo", "Tipo de alocação",
  "Início", "Fim", "Situação", "Origem", "Motivo", "Motivo do encerramento",
];

const MOVEMENT_HEADERS = [
  "Data efetiva", "Tipo", "Operação", "Estado", "Cidade", "Código BR", "Liderança na data",
  "Veículo anterior", "Placa anterior", "Veículo novo", "Placa nova",
  "Motorista anterior", "Motorista novo", "Função do motorista", "Início do período", "Fim do período",
  "Motivo", "Origem", "Inferido", "Registrado por", "Registrado em",
];

const MOVEMENT_LABEL = new Map<string, string>(MOVEMENT_TYPES.map((t) => [t.value, t.label]));
const MOVEMENT_ORIGIN: Record<string, string> = {
  user: "Usuário", import: "Importação", replication: "Replicação", system: "Sistema",
  reconstructed: "Reconstruído do histórico",
};

const ASSIGNMENT_STATUS: Record<string, string> = {
  planned: "Planejado", confirmed: "Confirmado", executed: "Executado", cancelled: "Cancelado",
};
const SOURCE: Record<string, string> = {
  manual: "Manual", import: "Importação", substitution: "Substituição", inversion: "Inversão",
  replication: "Replicação",
};
const LEADER_SCOPE: Record<string, string> = { br: "Exceção do BR", city: "Cidade", operation: "Operação" };

function formatDate(value: string | null | undefined): string {
  if (!value) return "";
  const [year, month, day] = value.split("-");
  return year && month && day ? `${day}/${month}/${year}` : value;
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
    return spreadsheetResponse({
      format: "xlsx",
      fileName: kind === "modelo-brs" ? "modelo-importacao-brs.xlsx" : "modelo-importacao-alocacoes.xlsx",
      sheetName: kind === "modelo-brs" ? "BRs" : "Alocações",
      headers: kind === "modelo-brs" ? BR_TEMPLATE_HEADERS : ALLOCATION_TEMPLATE_HEADERS,
      rows: [],
    });
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
    // Só o módulo BRs manda: "com/sem substituição no período".
    swapped: params.get("substituicao") ?? undefined,
  };
  const label = formatCompetence(competence).replace("/", "-");

  let headers: string[];
  let data: (string | number | null)[][];
  let name: string;

  if (kind === "mobilizacoes") {
    const dateFrom = params.get("mov_de") ?? undefined;
    const dateTo = params.get("mov_ate") ?? undefined;
    const range = dateFrom || dateTo
      ? { dateFrom, dateTo }
      : { dateFrom: monthStart(competence), dateTo: monthEnd(competence) };
    const movementFilters = {
      ...range,
      operationId: filters.operationId,
      stateId: filters.stateId,
      cityId: filters.cityId,
      brId: params.get("br") ?? undefined,
      leaderEmployeeId: filters.leaderEmployeeId,
      movementType: params.get("mov_tipo") ?? undefined,
      subject: params.get("mov_assunto") ?? undefined,
      vehicle: params.get("mov_veiculo") ?? undefined,
      driver: params.get("mov_motorista") ?? undefined,
    };
    // Todos os eventos do filtro, de 200 em 200, até o fim.
    const rows: MovementRow[] = [];
    for (let page = 1; ; page += 1) {
      const result = await listMovements(organizationId, movementFilters, page, 200);
      rows.push(...result.rows);
      if (rows.length >= result.total || result.rows.length === 0) break;
    }
    headers = MOVEMENT_HEADERS;
    data = rows.map((m) => [
      formatDate(m.effectiveDate), MOVEMENT_LABEL.get(m.movementType) ?? m.movementType,
      m.operationName, m.stateUf, m.cityName, m.brCode, m.leaderName ?? "",
      m.previousVehicleLabel ?? "", m.previousPlate ?? "", m.newVehicleLabel ?? "", m.newPlate ?? "",
      m.previousDriverName ?? "", m.newDriverName ?? "",
      m.driverRole === "primary" ? "Principal" : m.driverRole === "secondary" ? "Secundário" : "",
      formatDate(m.periodStart), m.periodEnd ? formatDate(m.periodEnd) : m.periodStart ? "em diante" : "",
      m.reason ?? "", MOVEMENT_ORIGIN[m.origin] ?? m.origin, m.isInferred ? "Sim" : "Não",
      m.actorName ?? "", m.recordedAt ? new Date(m.recordedAt).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }) : "",
    ]);
    const suffix = dateFrom || dateTo ? `${dateFrom ?? "inicio"}-a-${dateTo ?? "hoje"}` : label;
    name = `fidelizacao-mobilizacoes-${suffix}.${format}`;
  } else if (kind === "historico") {
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
    // O filtro "substituição no período" só existe no diretório do módulo BRs;
    // com ele, as linhas vêm de lá (mesma resolução do planner), página a página.
    let rows: BrPlannerRow[];
    if (filters.swapped) {
      rows = [];
      for (let page = 0; ; page += 1) {
        const directory = await getBrDirectory(organizationId, competence, filters, {
          limit: 200,
          offset: page * 200,
        });
        rows.push(...directory.rows);
        if (rows.length >= directory.total || directory.rows.length === 0) break;
      }
    } else {
      rows = await listBrPlannerRows(organizationId, competence, filters);
    }
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
    p_kind: kind === "historico" || kind === "mobilizacoes" ? kind : "planner",
  });
  // Sem registro não há exportação: a auditoria é parte do contrato, não um extra.
  if (auditError) {
    return NextResponse.json({ error: "Não foi possível registrar a exportação." }, { status: 403 });
  }

  return spreadsheetResponse({
    format,
    fileName: name,
    sheetName: kind === "mobilizacoes" ? "Mobilizações" : kind === "historico" ? "Histórico" : "Planner",
    headers,
    rows: data,
  });
}
