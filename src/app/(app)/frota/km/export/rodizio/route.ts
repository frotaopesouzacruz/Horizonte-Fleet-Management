import { NextResponse, type NextRequest } from "next/server";
import ExcelJS from "exceljs";
import { requireOrganization } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { loadRotationPlanDetail, type KmRotationItem } from "@/lib/km/rotation";
import { KM_ROTATION_PRIORITY, KM_ROTATION_SCOPE, KM_ROTATION_STATUS } from "@/lib/km/types";

/**
 * Exporta um plano de rodízio (GET ?plano=<id>) em XLSX — aba "Rodízios".
 *
 * Exige `km.export`; o plano é lido pela mesma rotina da tela
 * (`km_rotation_plan_detail`, que confere `km.rotation.view`), então o arquivo
 * só tem o que a pessoa já via. Os números saem como a rotina devolveu. A
 * exportação é registrada na auditoria (`log_km_export`) antes de o arquivo
 * sair; se o registro falhar, o arquivo não sai.
 */

export const maxDuration = 60;

const BRAND_BLUE = "FF1F4B93";
const BRAND_CYAN = "FF008CCB";
const BRAND_GOLD = "FFF4B223";
const WHITE = "FFFFFFFF";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const COLUMNS: { header: string; width: number; numFmt?: string; wrap?: boolean }[] = [
  { header: "Grupo técnico", width: 32 },
  { header: "Frota A", width: 12 },
  { header: "Local A", width: 22 },
  { header: "KM atual A", width: 13, numFmt: "#,##0" },
  { header: "Rodagem A (km/mês)", width: 14, numFmt: "#,##0" },
  { header: "Frota B", width: 12 },
  { header: "Local B", width: 22 },
  { header: "KM atual B", width: 13, numFmt: "#,##0" },
  { header: "Rodagem B (km/mês)", width: 14, numFmt: "#,##0" },
  { header: "Média do grupo (km/mês)", width: 15, numFmt: "#,##0" },
  { header: "Redução do desequilíbrio", width: 14, numFmt: "0.0%" },
  { header: "Prioridade", width: 14 },
  { header: "Status", width: 13 },
  { header: "Data prevista", width: 13, numFmt: "dd/mm/yyyy" },
  { header: "Responsável", width: 26 },
  { header: "Justificativa", width: 90, wrap: true },
];

const br = (iso: string | null | undefined) => {
  const m = iso?.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : "—";
};
/** Data ISO → Date em UTC (o Excel grava o dia certo, sem fuso). */
const excelDate = (iso: string | null | undefined) => {
  const m = iso?.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))) : null;
};
const stamp = (d: Date) =>
  new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
    .format(d)
    .replace(",", "");
const fileSafe = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();

function itemRow(i: KmRotationItem): (string | number | Date | null)[] {
  const s = i.snapshot ?? {};
  const a = s.vehicleA;
  const b = s.vehicleB;
  const priority =
    i.priority === "none"
      ? i.revalidatedAt
        ? "Sem benefício após revalidação"
        : "Sem benefício"
      : (KM_ROTATION_PRIORITY[i.priority]?.label ?? i.priority);
  return [
    i.cohortLabel ?? s.cohort?.label ?? "Grupo técnico não identificado",
    a?.plate ?? null,
    a?.local ?? "local não informado",
    a?.odometer ?? null,
    a?.kmMonth ?? null,
    b?.plate ?? null,
    b?.local ?? "local não informado",
    b?.odometer ?? null,
    b?.kmMonth ?? null,
    s.cohort?.kmMonthMedian ?? null,
    i.reductionPct == null ? null : Number((i.reductionPct / 100).toFixed(4)),
    priority,
    KM_ROTATION_STATUS[i.status]?.label ?? i.status,
    excelDate(i.effectiveDate),
    i.responsibleName ?? null,
    i.justification ?? null,
  ];
}

export async function GET(request: NextRequest) {
  const { organization } = await requireOrganization("km.export");
  const organizationId = organization.organizationId;

  const planId = request.nextUrl.searchParams.get("plano") ?? "";
  if (!UUID.test(planId)) {
    return NextResponse.json({ error: "Informe o plano de rodízio a exportar." }, { status: 400 });
  }

  let detail: Awaited<ReturnType<typeof loadRotationPlanDetail>>;
  try {
    detail = await loadRotationPlanDetail(planId);
  } catch (error) {
    const message = error instanceof Error ? error.message.replace(/^km_[a-z_]+: /, "") : "";
    return NextResponse.json(
      { error: /^[A-ZÀ-Ý]/.test(message) ? message : "Não foi possível ler o plano de rodízio para exportar." },
      { status: /permiss/i.test(message) ? 403 : 500 },
    );
  }
  const { plan, items } = detail;
  const sorted = [...items].sort(
    (x, y) =>
      (x.cohortLabel ?? "").localeCompare(y.cohortLabel ?? "", "pt-BR") || (x.itemNumber ?? 0) - (y.itemNumber ?? 0),
  );

  // Sem registro não há exportação: a auditoria é parte do contrato.
  const supabase = await createClient();
  const { error: auditError } = await (
    supabase.rpc as unknown as (
      fn: string,
      args: Record<string, unknown>,
    ) => Promise<{ error: { message: string } | null }>
  )("log_km_export", {
    p_organization_id: organizationId,
    p_kind: "rodizio",
    p_format: "xlsx",
    p_row_count: sorted.length,
    p_filters: { plan_id: plan.id },
  });
  if (auditError) {
    return NextResponse.json({ error: "Não foi possível registrar a exportação na auditoria." }, { status: 403 });
  }

  const now = new Date();
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Horizonte Fleet Management";
  workbook.created = now;

  const HEADER_ROW = 7;
  const sheet = workbook.addWorksheet("Rodízios", {
    views: [{ state: "frozen", ySplit: HEADER_ROW, xSplit: 2 }],
    properties: { defaultRowHeight: 18 },
  });
  sheet.columns = COLUMNS.map((c) => ({ width: c.width }));
  const lastCol = COLUMNS.length;

  // Cabeçalho do relatório
  const title = sheet.getRow(1);
  title.getCell(1).value = "Gestão de KM Rodado · Plano de Rodízio";
  title.getCell(1).font = { bold: true, size: 14, color: { argb: BRAND_BLUE } };
  title.height = 22;
  sheet.mergeCells(1, 1, 1, lastCol);
  for (let c = 1; c <= lastCol; c++) {
    sheet.getRow(1).getCell(c).border = { bottom: { style: "medium", color: { argb: BRAND_GOLD } } };
  }

  const meta: [string, string][] = [
    ["Plano", `${plan.code} · ${plan.name} (${KM_ROTATION_STATUS[plan.status]?.label ?? plan.status})`],
    ["Período analisado", `${br(plan.periodFrom)} a ${br(plan.periodTo)}${plan.dataAsOf ? ` · leituras até ${br(plan.dataAsOf)}` : ""}`],
    [
      "Horizonte de projeção",
      `${plan.horizonDays} dias · ${KM_ROTATION_SCOPE[plan.scopeMode] ?? plan.scopeMode}${plan.differentLocationsOnly ? " · somente locais diferentes" : ""}`,
    ],
    ["Gerado em", `${stamp(now)} · ${sorted.length} ${sorted.length === 1 ? "rodízio" : "rodízios"}`],
  ];
  meta.forEach(([label, value], idx) => {
    const row = sheet.getRow(2 + idx);
    row.getCell(1).value = label;
    row.getCell(1).font = { bold: true, color: { argb: BRAND_CYAN } };
    row.getCell(2).value = value;
    sheet.mergeCells(2 + idx, 2, 2 + idx, lastCol);
  });

  // Cabeçalho da tabela
  const header = sheet.getRow(HEADER_ROW);
  COLUMNS.forEach((c, idx) => {
    const cell = header.getCell(idx + 1);
    cell.value = c.header;
    cell.font = { bold: true, color: { argb: WHITE } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: BRAND_BLUE } };
    cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
    cell.border = { bottom: { style: "thin", color: { argb: BRAND_GOLD } } };
  });
  header.height = 32;

  // Linhas
  sorted.forEach((item, idx) => {
    const row = sheet.getRow(HEADER_ROW + 1 + idx);
    const values = itemRow(item);
    values.forEach((v, c) => {
      const cell = row.getCell(c + 1);
      cell.value = v;
      const col = COLUMNS[c];
      if (col.numFmt) cell.numFmt = col.numFmt;
      cell.alignment = { vertical: "top", wrapText: Boolean(col.wrap) };
    });
    if (item.status === "cancelled") row.font = { color: { argb: "FF808080" } };
  });

  if (sorted.length > 0) {
    sheet.autoFilter = {
      from: { row: HEADER_ROW, column: 1 },
      to: { row: HEADER_ROW + sorted.length, column: lastCol },
    };
  }

  const buffer = await workbook.xlsx.writeBuffer();
  const fileName = `plano-rodizio-${fileSafe(plan.code)}-${new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(now)}.xlsx`;
  return new Response(buffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${fileName}"`,
      "Cache-Control": "no-store",
    },
  });
}
