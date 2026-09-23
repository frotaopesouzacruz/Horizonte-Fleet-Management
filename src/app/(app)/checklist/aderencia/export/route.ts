import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getSessionContext, hasPermission } from "@/lib/auth/session";
import { buildWorkbook, buildCsv } from "@/lib/admin/spreadsheet";
import {
  getAdherenceMatrix, getAdherenceSummary, getReturnTracking,
  type AdherenceFilters, type AdherenceGroupBy, type ChecklistContext,
} from "@/lib/adherence/queries";
import { monthEnd, monthStart, parseCompetence, formatCompetence } from "@/lib/governance/competence";
import { STATUS_META } from "../status";

/**
 * Exporta a Aderência (permissão `adherence.export`): a visão consolidada com
 * a quebra escolhida, a matriz mês/dia ou o acompanhamento do retorno, sempre
 * no contexto (saída ou retorno) e com os filtros em tela — o arquivo é o que
 * se vê, nunca uma segunda porta para os dados. As linhas vêm das mesmas
 * rotinas `security invoker` da página, e cada exportação é registrada na
 * auditoria; sem registro não há arquivo.
 */

const GROUPS: AdherenceGroupBy[] = ["operation", "state", "city", "branch", "leader", "br", "vehicle_type", "vehicle"];
const GROUP_LABEL: Record<AdherenceGroupBy, string> = {
  operation: "Operação", state: "Estado", city: "Cidade", branch: "Filial", leader: "Liderança",
  br: "BR", vehicle_type: "Tipo de equipamento", vehicle: "Veículo",
};
const CONTEXT_LABEL: Record<ChecklistContext, string> = { saida: "Saída de rota", retorno: "Retorno de rota" };
const SITUATION: Record<string, string> = {
  awaiting_return: "Aguardando retorno", not_departed: "Sem saída registrada",
  overdue_after_departure: "Retorno vencido (saiu)", overdue: "Retorno vencido",
};

const pct = (v: number | null) => (v == null ? "Sem base" : `${v.toFixed(2).replace(".", ",")}%`);
const dateBr = (v: string | null | undefined) => {
  if (!v) return "";
  const [y, m, d] = v.slice(0, 10).split("-");
  return d ? `${d}/${m}/${y}` : v;
};
const dateTimeBr = (v: string | null | undefined) =>
  v ? new Date(v).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "";

function fileResponse(buffer: Buffer, fileName: string, format: "xlsx" | "csv") {
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": format === "csv" ? "text/csv; charset=utf-8" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
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
  if (!hasPermission(session, "adherence.export")) {
    return NextResponse.json({ error: "Sem permissão para exportar." }, { status: 403 });
  }
  const organizationId = session.activeOrganization.organizationId;
  const params = request.nextUrl.searchParams;
  const kind = params.get("tipo") ?? "consolidada";
  const format: "xlsx" | "csv" = params.get("format") === "csv" ? "csv" : "xlsx";
  const context: ChecklistContext = params.get("contexto") === "retorno" ? "retorno" : "saida";
  const competence = parseCompetence(params.get("ano") ?? undefined, params.get("mes") ?? undefined);
  const from = monthStart(competence);
  const to = monthEnd(competence);
  const groupParam = params.get("agrupar") ?? "operation";
  const groupBy: AdherenceGroupBy = (GROUPS as string[]).includes(groupParam) ? (groupParam as AdherenceGroupBy) : "operation";

  const filters: AdherenceFilters = {
    operationId: params.get("operacao") ?? undefined,
    stateId: params.get("uf") ?? undefined,
    cityId: params.get("cidade") ?? undefined,
    branchId: params.get("filial") ?? undefined,
    leaderEmployeeId: params.get("lideranca") ?? undefined,
    brId: params.get("br") ?? undefined,
    vehicleTypeId: params.get("tipo") === kind ? undefined : (params.get("tipo_equipamento") ?? undefined),
    status: params.get("situacao") ?? undefined,
    q: params.get("q") ?? undefined,
    justification: params.get("justificativa") ?? undefined,
  };
  const label = `${formatCompetence(competence).replace("/", "-")}-${context}`;

  let headers: string[];
  let data: (string | number | null)[][];
  let name: string;
  let sheet: string;

  if (kind === "matriz") {
    const matrix = await getAdherenceMatrix(organizationId, competence, context, filters, 1, 5000);
    const days = new Date(competence.year, competence.month, 0).getDate();
    const dayHeaders = Array.from({ length: days }, (_, i) => String(i + 1).padStart(2, "0"));
    headers = ["Frota", "Placa", "Operação", "Cidade", "UF", "BR", "Liderança", "Tipo", ...dayHeaders];
    data = matrix.rows.map((r) => [
      r.fleetCode ?? "", r.licensePlate ?? "", r.operationName ?? "", r.cityName ?? "", r.stateUf ?? "",
      r.brCode ?? "", r.leaderName ?? "", r.vehicleTypeName ?? "",
      ...dayHeaders.map((d) => {
        const cell = r.days[String(Number(d))];
        if (!cell) return "";
        const meta = STATUS_META[cell.status];
        return `${meta?.label ?? cell.status}${cell.pendingRequest ? " (justificativa pendente)" : ""}`;
      }),
    ]);
    name = `aderencia-matriz-${label}.${format}`;
    sheet = "Matriz";
  } else if (kind === "retorno") {
    const tracking = await getReturnTracking(organizationId, from, to, filters, 5000);
    headers = ["Data", "Frota", "Placa", "Operação", "Cidade", "BR", "Liderança", "Retorno previsto", "Prazo", "Situação", "Saída", "Retorno", "Justificativa pendente"];
    data = tracking.rows.map((r) => [
      dateBr(r.operationalDate), r.fleetCode ?? "", r.licensePlate ?? "", r.operationName ?? "", r.cityName ?? "",
      r.brCode ?? "", r.leaderName ?? "", dateTimeBr(r.expectedAt), dateTimeBr(r.deadlineAt),
      SITUATION[r.situation] ?? r.situation,
      r.departureStatus ? (STATUS_META[r.departureStatus]?.label ?? r.departureStatus) : "Sem obrigação",
      STATUS_META[r.status]?.label ?? r.status, r.pendingRequest ? "Sim" : "Não",
    ]);
    name = `aderencia-retorno-${label}.${format}`;
    sheet = "Retorno";
  } else {
    const summary = await getAdherenceSummary(organizationId, from, to, context, filters, groupBy);
    headers = [GROUP_LABEL[groupBy], "Obrigações", "Realizados", "Não realizados", "Expurgos", "Justificativas pendentes", "Numerador", "Denominador", "Aderência", "Meta"];
    data = [
      ...summary.groups.map((g) => [
        g.label, g.obligations, g.done, g.notDone, g.excluded, g.pendingRequests, g.numerator, g.denominator,
        pct(g.adherencePct), summary.targetPct == null ? "Não definida" : pct(summary.targetPct),
      ]),
      [`Total (${CONTEXT_LABEL[context]})`, summary.obligations, summary.done, summary.notDone, summary.excluded,
        summary.pendingRequests, summary.numerator, summary.denominator, pct(summary.adherencePct),
        summary.targetPct == null ? "Não definida" : pct(summary.targetPct)],
    ];
    name = `aderencia-consolidada-${label}.${format}`;
    sheet = "Consolidada";
  }

  const supabase = await createClient();
  const { error: auditError } = await supabase.rpc("log_adherence_export", {
    p_organization_id: organizationId,
    p_format: format,
    p_row_count: data.length,
    p_kind: kind === "matriz" ? "matriz" : kind === "retorno" ? "retorno" : "consolidada",
  });
  if (auditError) {
    return NextResponse.json({ error: "Não foi possível registrar a exportação." }, { status: 403 });
  }

  const buffer = format === "csv" ? buildCsv(headers, data) : await buildWorkbook(sheet, headers, data);
  return fileResponse(buffer, name, format);
}
