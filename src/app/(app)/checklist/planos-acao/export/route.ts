import { NextResponse, type NextRequest } from "next/server";
import { requireOrganization } from "@/lib/auth/session";
import { spreadsheetResponse, type ExportCell } from "@/lib/admin/spreadsheet";
import { createClient } from "@/lib/supabase/server";
import { exportActionPlanItems, listActionPlans, type ExportItemRow } from "@/lib/action-plans/queries";
import {
  CHECKLIST_TYPE_LABEL,
  DEADLINE_LABEL,
  ITEM_STATUS_LABEL,
  MAINTENANCE_STATUS_LABEL,
  PLAN_STATUS_LABEL,
  PRIORITY_LABEL,
  RESOLUTION_TYPE_LABEL,
  formatDate,
  formatDateTime,
} from "@/lib/action-plans/labels";
import type { ActionPlanRow, ActionPlanSortKey, ItemStatus, PlanStatus, Priority } from "@/lib/action-plans/types";
import { parseActionPlanFilters } from "@/lib/action-plans/url";

/**
 * Exporta o Plano de Ação de Manutenção (permissão `action_plans.export`).
 *
 * `escopo=plans` (padrão): um plano por linha, lido da mesma rotina da lista
 * (`action_plan_list`) com os mesmos filtros e a mesma ordenação da URL.
 * `escopo=items`: os apontamentos dos planos filtrados (`action_plan_export_items`).
 * Sem teto de linhas: as rotinas são lidas página a página e o arquivo sai em
 * fluxo (XLSX ou CSV com `;` e BOM). As rotinas conferem permissão e escopo
 * (operação do contexto gravado) — o arquivo só tem o que a pessoa já via.
 */

export const maxDuration = 60;

const PLAN_PAGE = 1000;
const ITEM_PAGE = 2000;
const SORTS: ActionPlanSortKey[] = ["priority", "due", "first", "last", "occurrences", "open_items", "code", "plate", "status", "age"];

const yesNo = (v: boolean) => (v ? "Sim" : "Não");
const brLabel = (code: string | null) => (code ? (/^br/i.test(code) ? code : `BR ${code}`) : null);
const date = (iso: string | null | undefined) => (iso ? formatDate(iso) : null);
const dateTime = (iso: string | null | undefined) => (iso ? formatDateTime(iso) : null);
const planStatus = (s: string) => PLAN_STATUS_LABEL[s as PlanStatus] ?? s;
const priority = (p: string) => PRIORITY_LABEL[p as Priority] ?? p;

const PLAN_HEADERS = [
  "Código", "Situação", "Prioridade", "Prazo", "Situação do prazo", "Dias em atraso", "Placa", "Frota",
  "Tipo de equipamento", "Operação", "UF", "Cidade", "BR", "Filial", "Liderança", "Cluster", "Item", "Detalhe",
  "Primeiro apontamento", "Último apontamento", "Ocorrências", "Apontamentos pendentes", "Apontamentos resolvidos",
  "Responsável", "Manutenções", "Última tratativa", "Data da última tratativa", "Possível reincidência", "Ciclo",
  "Reaberturas", "Encerrado em", "Encerramento automático", "TMR (dias)", "Exige manutenção", "Idade (dias)",
];

function planRow(p: ActionPlanRow): ExportCell[] {
  return [
    p.code,
    planStatus(p.status),
    priority(p.priority),
    date(p.dueOn),
    DEADLINE_LABEL[p.deadline] ?? p.deadline,
    p.daysOverdue,
    p.licensePlate,
    p.fleetCode,
    p.vehicleTypeName,
    p.operationName,
    p.stateUf,
    p.cityName,
    brLabel(p.brCode),
    p.unitName,
    p.leaderName,
    p.clusterName,
    p.title,
    p.detailLabel,
    date(p.firstOperationalDate),
    date(p.lastOperationalDate),
    p.occurrences,
    p.openItems,
    p.resolvedItems,
    p.responsibleName,
    p.maintenances.map((m) => `${m.code} (${MAINTENANCE_STATUS_LABEL[m.status] ?? m.status})`).join("; ") || null,
    p.lastTreatment,
    dateTime(p.lastTreatmentAt),
    yesNo(p.isRecurrence),
    p.cycleNumber,
    p.reopenedCount,
    dateTime(p.closedAt),
    p.closedAt ? yesNo(p.autoClosed) : null,
    p.tmrDays,
    yesNo(p.requiresMaintenance),
    p.ageDays,
  ];
}

const ITEM_HEADERS = [
  "Plano", "Situação do plano", "Prioridade", "Item", "Detalhe", "Cluster", "Placa", "Frota", "Data operacional",
  "Tipo de checklist", "Pergunta", "Resposta", "Opção", "Relato", "Observação", "Colaborador", "Matrícula", "Operação",
  "Cidade", "BR", "Liderança", "Situação do apontamento", "Resolvido em", "Resolução", "Motivo", "Manutenções",
];

/** "MAN-1 (in_progress), MAN-2 (completed)" → situações por extenso. */
const maintenanceText = (text: string | null) =>
  text ? text.replace(/\(([a-z_]+)\)/g, (match, code: string) => `(${MAINTENANCE_STATUS_LABEL[code] ?? code})`) : null;

function itemRow(i: ExportItemRow): ExportCell[] {
  return [
    i.planCode,
    planStatus(i.planStatus),
    priority(i.priority),
    i.title,
    i.detailLabel,
    i.clusterName,
    i.licensePlate,
    i.fleetCode,
    date(i.operationalDate),
    i.checklistType ? CHECKLIST_TYPE_LABEL[i.checklistType] ?? i.checklistType : null,
    i.question,
    i.answer === "yes" ? "Sim" : i.answer === "no" ? "Não" : i.answer,
    i.optionLabel,
    i.detailText,
    i.note,
    i.employeeName,
    i.employeeCode,
    i.operationName,
    i.cityName,
    brLabel(i.brCode),
    i.leaderName,
    ITEM_STATUS_LABEL[i.itemStatus as ItemStatus] ?? i.itemStatus,
    dateTime(i.resolvedAt),
    i.resolution ? RESOLUTION_TYPE_LABEL[i.resolution] ?? i.resolution : null,
    i.resolutionReason,
    maintenanceText(i.maintenances),
  ];
}

export async function GET(request: NextRequest) {
  const { organization } = await requireOrganization("action_plans.export");
  const organizationId = organization.organizationId;

  const search = request.nextUrl.searchParams;
  const params = Object.fromEntries(search.entries());
  const format: "xlsx" | "csv" = search.get("format") === "csv" ? "csv" : "xlsx";
  const scope: "plans" | "items" = search.get("escopo") === "items" ? "items" : "plans";
  const filters = parseActionPlanFilters(params);
  // Igual à aba Planos: sem situação, prazo ou grupo escolhidos, só os planos em aberto.
  const tab = search.get("aba");
  if ((!tab || tab === "planos") && !filters.status && !filters.statusGroup && !filters.deadline) {
    filters.statusGroup = "open";
  }

  const sortParam = search.get("ordenar") as ActionPlanSortKey | null;
  const sort: ActionPlanSortKey = sortParam && SORTS.includes(sortParam) ? sortParam : "priority";
  const dir = search.get("dir") === "asc" ? "asc" : "desc";

  const rows: ExportCell[][] = [];
  try {
    if (scope === "plans") {
      for (let page = 1; ; page++) {
        const result = await listActionPlans(organizationId, filters, sort, dir, page, PLAN_PAGE);
        for (const p of result.rows) rows.push(planRow(p));
        if (result.rows.length < PLAN_PAGE || rows.length >= result.total) break;
      }
    } else {
      for (let offset = 0; ; offset += ITEM_PAGE) {
        const result = await exportActionPlanItems(organizationId, filters, ITEM_PAGE, offset);
        for (const i of result.rows) rows.push(itemRow(i));
        if (result.rows.length < ITEM_PAGE || rows.length >= result.total) break;
      }
    }
  } catch (error) {
    console.error("planos-acao/export", error instanceof Error ? error.message : error);
    return NextResponse.json(
      { error: scope === "plans" ? "Não foi possível ler os planos para exportar." : "Não foi possível ler os apontamentos para exportar." },
      { status: 500 },
    );
  }

  // Sem registro não há exportação: a auditoria é parte do contrato, não um extra.
  const supabase = await createClient();
  const { error: auditError } = await (supabase.rpc as unknown as (
    fn: string,
    args: Record<string, unknown>,
  ) => Promise<{ error: { message: string } | null }>)("log_action_plan_export", {
    p_organization_id: organizationId,
    p_format: format,
    p_scope: scope,
    p_row_count: rows.length,
    p_filters: params,
  });
  if (auditError) {
    return NextResponse.json({ error: "Não foi possível registrar a exportação na auditoria." }, { status: 403 });
  }

  const stamp = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
  const base = scope === "plans" ? "planos-de-acao" : "apontamentos-planos-de-acao";
  return spreadsheetResponse({
    format,
    fileName: `${base}-${stamp}.${format}`,
    sheetName: scope === "plans" ? "Planos de ação" : "Apontamentos",
    headers: scope === "plans" ? PLAN_HEADERS : ITEM_HEADERS,
    rows,
  });
}
