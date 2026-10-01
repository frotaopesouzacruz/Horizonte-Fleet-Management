import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getSessionContext, hasPermission } from "@/lib/auth/session";
import { spreadsheetResponse, type ExportCell } from "@/lib/admin/spreadsheet";
import { listMaintenances } from "@/lib/maintenance/queries";
import { parseMaintenanceFilters } from "@/lib/maintenance/url";
import {
  CRITICALITY_LABEL,
  ITEM_STATUS_LABEL,
  KM_SOURCE_LABEL,
  KM_STATUS_LABEL,
  STATUS_LABEL,
  typeLabel,
  type MaintenanceRow,
  type MaintenanceSortKey,
} from "@/lib/maintenance/types";

/**
 * Exporta a base de manutenções (Etapa 16).
 *
 * Exige `maintenance.view` e `maintenance.export`. As linhas vêm da mesma
 * rotina da tela (`maintenance_list`, security invoker, sob a RLS de quem
 * exporta) com os mesmos filtros da URL — o arquivo só contém o que a pessoa
 * já enxergava. Sem teto de linhas: a base é lida página a página e o arquivo
 * sai em fluxo. A exportação é registrada na auditoria antes de o arquivo
 * sair; se o registro falhar, o arquivo não sai.
 */

export const maxDuration = 60;

const PAGE = 1000;
const SORTS: MaintenanceSortKey[] = ["reference", "requested", "scheduled", "entry", "exit", "code", "plate", "status", "duration"];

const HEADERS = [
  "Código", "Tipo", "Situação", "Prioridade", "Origem", "Frota", "Placa", "Operação", "UF", "Cidade", "Liderança",
  "Filial", "Fornecedor", "OS", "Clusters", "Serviços", "Situação dos serviços", "Solicitação", "Agendamento",
  "Hora agendada", "Previsão de saída", "Entrada", "Hora de entrada", "Saída", "Hora de saída", "TMM (h)",
  "Precisão do TMM", "KM de entrada", "Situação do KM", "Fonte do KM", "Entrada atrasada", "Saída vencida",
  "Reaberturas", "Descrição",
];

const time = (t: string | null) => (t ? t.slice(0, 5) : null);
const yesNo = (v: boolean) => (v ? "Sim" : "Não");

function toRow(m: MaintenanceRow): ExportCell[] {
  const items = m.items.filter((i) => i.status !== "cancelled");
  return [
    m.code,
    typeLabel(m.type, m.typeName),
    STATUS_LABEL[m.status] ?? m.status,
    CRITICALITY_LABEL[m.priority] ?? m.priority,
    m.originName,
    m.fleetCode,
    m.licensePlate,
    m.operationName,
    m.stateUf,
    m.cityName,
    m.leaderName,
    m.unitName,
    m.supplierName,
    m.serviceOrderNumber,
    [...new Set(items.map((i) => i.cluster))].join("; "),
    items.map((i) => i.service).join("; "),
    items.map((i) => `${i.service}: ${ITEM_STATUS_LABEL[i.status] ?? i.status}`).join("; "),
    m.requestedOn,
    m.scheduledDate,
    time(m.scheduledTime),
    m.expectedExitDate,
    m.entryDate,
    time(m.entryTime),
    m.exitDate,
    time(m.exitTime),
    m.durationHours,
    m.durationPrecision === "exact" ? "Data e hora" : m.durationPrecision === "date" ? "Só datas" : null,
    m.entryKm,
    m.entryKmStatus ? KM_STATUS_LABEL[m.entryKmStatus] : null,
    m.entryKmSource ? KM_SOURCE_LABEL[m.entryKmSource] : null,
    yesNo(m.lateEntry),
    yesNo(m.exitOverdue),
    m.reopenCount,
    m.description,
  ];
}

export async function GET(request: NextRequest) {
  const session = await getSessionContext();
  if (!session?.activeOrganization) {
    return NextResponse.json({ error: "Sua sessão expirou. Entre novamente para exportar." }, { status: 401 });
  }
  if (!hasPermission(session, "maintenance.view") || !hasPermission(session, "maintenance.export")) {
    return NextResponse.json({ error: "Você não possui permissão para exportar manutenções." }, { status: 403 });
  }

  const organizationId = session.activeOrganization.organizationId;
  const search = request.nextUrl.searchParams;
  const params = Object.fromEntries(search.entries());
  const format: "xlsx" | "csv" = search.get("format") === "csv" ? "csv" : "xlsx";
  const filters = parseMaintenanceFilters(params);
  // A fila da Programação, sem situação escolhida, é o que está em aberto — igual à tela.
  if (search.get("aba") === "programacao" && !filters.status && filters.queue !== "completed_today") filters.openOnly = true;
  const sortParam = search.get("ordenar") as MaintenanceSortKey | null;
  const sort: MaintenanceSortKey = sortParam && SORTS.includes(sortParam) ? sortParam : "reference";
  const dir = search.get("dir") === "asc" ? "asc" : "desc";

  const rows: ExportCell[][] = [];
  try {
    for (let page = 1; ; page++) {
      const result = await listMaintenances(organizationId, filters, { sort, dir, page, pageSize: PAGE });
      for (const m of result.rows) rows.push(toRow(m));
      if (result.rows.length < PAGE || rows.length >= result.total) break;
    }
  } catch {
    return NextResponse.json({ error: "Não foi possível ler as manutenções para exportar." }, { status: 500 });
  }

  const supabase = await createClient();
  const { error: auditError } = await (supabase.rpc as unknown as (
    fn: string,
    args: Record<string, unknown>,
  ) => Promise<{ error: { message: string } | null }>)("log_maintenance_export", {
    p_organization_id: organizationId,
    p_format: format,
    p_row_count: rows.length,
    p_filters: params,
  });
  // Sem registro não há exportação: a auditoria é parte do contrato, não um extra.
  if (auditError) {
    return NextResponse.json({ error: "Não foi possível registrar a exportação na auditoria." }, { status: 403 });
  }

  const stamp = new Date().toISOString().slice(0, 10);
  return spreadsheetResponse({
    format,
    fileName: `manutencoes-${stamp}.${format}`,
    sheetName: "Manutenções",
    headers: HEADERS,
    rows,
  });
}
