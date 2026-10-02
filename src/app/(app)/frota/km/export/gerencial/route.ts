import { NextResponse, type NextRequest } from "next/server";
import type ExcelJS from "exceljs";
import { requireOrganization } from "@/lib/auth/session";
import { getKmFilterOptions } from "@/lib/km/options";
import { parseKmFilters } from "@/lib/km/url";
import { byCode, KM_FRESHNESS, KM_QUADRANT, KM_STATUS, type KmReadingStatus } from "@/lib/km/types";
import { kmFilterSummary, kmPeriodSlug, kmResolvedPeriodLabel } from "../../relatorio/filter-summary";
import { loadManagementReport, locationRows, type ManagementReport } from "../../relatorio/report-data";
import {
  bandLabel, COHORT_LEVEL, CONFIDENCE_LABEL, NO_READING_NOTE, outlierLabel, OUTLIER_NOTE, PARITY_NOTE, quadrantLabel,
  REPORT_TITLE, TONE_LABEL,
} from "../../relatorio/labels";
import {
  BRAND, brDate, dataSheet, excelDate, loadLogo, logKmExport, newWorkbook, NUM, placeLogo, sectionBand, stampText,
  writeTable, xlsxResponse, type XCell,
} from "../../relatorio/xlsx-kit";

/**
 * Relatório Gerencial de KM (XLSX).
 *
 * `km_overview` + `km_analysis` com os filtros da URL — o mesmo conjunto da
 * tela, sob o cliente de quem exporta (RLS e escopo no banco). Abas: Resumo,
 * Por operação, Por localização, Coortes e Veículos. A exportação é
 * registrada (`log_km_export`) antes de o arquivo sair.
 */
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const { session, organization } = await requireOrganization("km.export");
  const orgId = organization.organizationId;
  const params = Object.fromEntries(request.nextUrl.searchParams.entries());
  const filters = parseKmFilters(params);

  let report: ManagementReport;
  let options: Awaited<ReturnType<typeof getKmFilterOptions>> | null = null;
  try {
    [report, options] = await Promise.all([
      loadManagementReport(orgId, filters),
      getKmFilterOptions(orgId).catch(() => null),
    ]);
  } catch {
    return NextResponse.json({ error: "Não foi possível ler os dados do relatório gerencial." }, { status: 500 });
  }
  if (!report.overview && !report.analysis) {
    return NextResponse.json(
      { error: report.errors.join(" · ") || "Não foi possível ler os dados do relatório gerencial." },
      { status: 403 },
    );
  }

  const vehicles = report.analysis?.vehicles ?? [];
  const rowCount = report.analysis ? vehicles.length : (report.overview?.kpis.vehicles ?? 0);
  const auditError = await logKmExport(orgId, "gerencial", "xlsx", rowCount, report.payload);
  if (auditError) {
    return NextResponse.json({ error: "Não foi possível registrar a exportação na auditoria." }, { status: 403 });
  }

  const wb = newWorkbook();
  const logo = await loadLogo(request.nextUrl.origin);
  const periodText = kmResolvedPeriodLabel(report.period);
  const generated = `Gerado em ${stampText(new Date())} por ${session.displayName} · ${organization.organizationName}`;
  const summary = kmFilterSummary(filters, options);
  const filterLine = summary.length ? `Filtros: ${summary.map((s) => `${s.label}: ${s.value}`).join(" · ")}` : "Filtros: nenhum (todas as frotas visíveis)";
  const context = [periodText, filterLine, generated];

  buildSummary(wb, logo, report, { periodText, generated, summary });

  const an = report.analysis;
  if (an) {
    // ----------------------------------------------------------- operação --
    dataSheet(
      wb,
      "Por operação",
      "KM por operação",
      context,
      [
        { header: "Operação", width: 34 },
        { header: "KM validado", numFmt: NUM.km, width: 16 },
        { header: "Veículos", numFmt: NUM.int, width: 11 },
        { header: "Média por veículo (km)", numFmt: NUM.km, width: 16 },
        { header: "Mediana por veículo (km)", numFmt: NUM.km, width: 16 },
        { header: "P90 por veículo (km)", numFmt: NUM.km, width: 16 },
        { header: "KM por dia", numFmt: NUM.km, width: 14 },
        { header: "Cobertura", numFmt: NUM.pct, width: 12 },
        { header: "Desvio vs. média geral", numFmt: NUM.pct, width: 16 },
        { header: "Participação", numFmt: NUM.pct, width: 13 },
      ],
      an.byOperation.map((o) => [
        o.operation, o.km, o.vehicles, o.avgPerVehicle, o.medianPerVehicle, o.p90PerVehicle, o.kmPerDay, o.coveragePct,
        o.deviationVsOverallPct, o.sharePct,
      ]),
      { freezeCols: 1, total: ["Total", an.totals.km, an.totals.vehicles, null, null, null, null, null, null, null] },
    );

    // --------------------------------------------------------- localização --
    const loc = locationRows(an.byLocation);
    dataSheet(
      wb,
      "Por localização",
      "KM por localização (operação › UF › cidade › BR)",
      context,
      [
        { header: "Nível", width: 11 },
        { header: "Operação", width: 30 },
        { header: "UF", width: 6 },
        { header: "Cidade", width: 24 },
        { header: "BR", width: 12 },
        { header: "KM validado", numFmt: NUM.km, width: 16 },
        { header: "Veículos", numFmt: NUM.int, width: 11 },
        { header: "Média por veículo (km)", numFmt: NUM.km, width: 16 },
        { header: "Mediana por veículo (km)", numFmt: NUM.km, width: 16 },
        { header: "KM por dia", numFmt: NUM.km, width: 14 },
        { header: "Cobertura", numFmt: NUM.pct, width: 12 },
        { header: "Participação", numFmt: NUM.pct, width: 13 },
      ],
      loc.map((r) => [
        r.level, r.operation, r.state, r.city, r.br, r.km, r.vehicles, r.avgPerVehicle, r.medianPerVehicle, r.kmPerDay,
        r.coveragePct, r.sharePct,
      ]),
      { freezeCols: 2 },
    );

    // ------------------------------------------------------------- coortes --
    dataSheet(
      wb,
      "Coortes",
      "Coortes técnicas — estatística da média diária (km/dia)",
      [...context, "Só veículos com cobertura mínima entram nas estatísticas (elegíveis). Coorte insuficiente não é comparada."],
      [
        { header: "Coorte", width: 40 },
        { header: "Nível", width: 28 },
        { header: "Veículos", numFmt: NUM.int, width: 10 },
        { header: "Elegíveis", numFmt: NUM.int, width: 10 },
        { header: "Coorte suficiente", width: 12 },
        { header: "Média", numFmt: NUM.km, width: 10 },
        { header: "Mediana", numFmt: NUM.km, width: 10 },
        { header: "Q1", numFmt: NUM.km, width: 10 },
        { header: "Q3", numFmt: NUM.km, width: 10 },
        { header: "P10", numFmt: NUM.km, width: 10 },
        { header: "P90", numFmt: NUM.km, width: 10 },
        { header: "Mínimo", numFmt: NUM.km, width: 10 },
        { header: "Máximo", numFmt: NUM.km, width: 10 },
        { header: "Amplitude", numFmt: NUM.km, width: 11 },
        { header: "IQR", numFmt: NUM.km, width: 10 },
        { header: "CV", numFmt: NUM.pct, width: 10 },
        { header: "Hodômetro mediano (km)", numFmt: NUM.int, width: 16 },
        { header: "IQR do hodômetro (km)", numFmt: NUM.int, width: 16 },
        { header: "IQR do hodômetro — período anterior (km)", numFmt: NUM.int, width: 20 },
        { header: "Acima do P90", numFmt: NUM.int, width: 11 },
        { header: "Pontos para análise", numFmt: NUM.int, width: 12 },
      ],
      an.cohorts.map((c) => [
        c.label, COHORT_LEVEL[c.level] ?? c.level, c.vehicles, c.eligible, c.sufficient, c.mean, c.median, c.q1, c.q3, c.p10,
        c.p90, c.min, c.max, c.range, c.iqr, c.cvPct, c.odometerMedian, c.odometerIqr, c.odometerIqrPrevious, c.aboveP90,
        c.outliers,
      ]),
      { freezeCols: 1 },
    );

    // ------------------------------------------------------------ veículos --
    const outlierRows = new Set<number>();
    const rows: XCell[][] = vehicles.map((v, i) => {
      const isOutlier = Boolean(v.outlier && v.outlier !== "low_coverage");
      if (isOutlier) outlierRows.add(i);
      return [
        v.plate, v.fleetCode, v.type, v.subcategory, v.model, v.operation, v.br, v.local, v.cohortLabel,
        COHORT_LEVEL[v.cohortLevel] ?? v.cohortLevel, v.eligible, v.kmPeriod, v.readingDays, v.coveragePct, v.dailyAvg,
        v.odometer, v.cohortSize, v.cohortDailyMedian, v.cohortOdometerMedian, v.dailyPercentile, v.odometerPercentile,
        v.robustZ, v.deviationPct, bandLabel(v.band), v.quadrant ? quadrantLabel(v.quadrant) : "—",
        v.outlier ? `Ponto para análise · ${outlierLabel(v.outlier)}` : "", v.projection?.d30 ?? null,
        v.projection?.d60 ?? null, v.projection?.d90 ?? null,
        v.projection ? (CONFIDENCE_LABEL[v.projection.confidence] ?? v.projection.confidence) : "—",
        v.preventive?.cycleNumber ?? null, v.preventive?.milestoneKm ?? null, v.preventive?.kmRemaining ?? null,
        v.preventive ? (v.preventive.kmRemaining != null && v.preventive.kmRemaining <= 0 ? "Marco atingido" : v.preventive.daysEstimate) : null,
      ];
    });
    dataSheet(
      wb,
      "Veículos",
      "Veículos — dispersão, quadrante, projeções e preventiva",
      [...context, OUTLIER_NOTE],
      [
        { header: "Placa", width: 11 },
        { header: "Frota", width: 10 },
        { header: "Tipo", width: 16 },
        { header: "Subcategoria", width: 14 },
        { header: "Modelo", width: 18 },
        { header: "Operação", width: 22 },
        { header: "BR", width: 10 },
        { header: "Local", width: 18 },
        { header: "Coorte", width: 30 },
        { header: "Nível da coorte", width: 24 },
        { header: "Elegível", width: 9 },
        { header: "KM no período", numFmt: NUM.km, width: 13 },
        { header: "Dias com leitura", numFmt: NUM.int, width: 10 },
        { header: "Cobertura", numFmt: NUM.pct, width: 11 },
        { header: "Média diária (km)", numFmt: NUM.km, width: 12 },
        { header: "Hodômetro (km)", numFmt: NUM.km, width: 13 },
        { header: "Tamanho da coorte", numFmt: NUM.int, width: 10 },
        { header: "Mediana diária da coorte (km)", numFmt: NUM.km, width: 14 },
        { header: "Hodômetro mediano da coorte (km)", numFmt: NUM.int, width: 15 },
        { header: "Percentil da média diária", numFmt: NUM.int, width: 12 },
        { header: "Percentil do hodômetro", numFmt: NUM.int, width: 12 },
        { header: "Z robusto", numFmt: NUM.z, width: 10 },
        { header: "Desvio vs. mediana da coorte", numFmt: NUM.pct, width: 14 },
        { header: "Faixa", width: 22 },
        { header: "Quadrante", width: 24 },
        { header: "Ponto para análise", width: 36 },
        { header: "Hodômetro em 30 dias", numFmt: NUM.int, width: 13 },
        { header: "Hodômetro em 60 dias", numFmt: NUM.int, width: 13 },
        { header: "Hodômetro em 90 dias", numFmt: NUM.int, width: 13 },
        { header: "Confiança da projeção", width: 12 },
        { header: "Ciclo preventivo", numFmt: NUM.int, width: 10 },
        { header: "Marco preventivo (km)", numFmt: NUM.int, width: 13 },
        { header: "KM até o marco", numFmt: NUM.int, width: 12 },
        { header: "Dias estimados até o marco", numFmt: NUM.int, width: 14 },
      ],
      rows,
      { freezeCols: 2, highlight: (i) => outlierRows.has(i) },
    );
  }

  return xlsxResponse(wb, `km-gerencial-${kmPeriodSlug(report.period, filters)}.xlsx`);
}

// ---------------------------------------------------------------------------
// Resumo
// ---------------------------------------------------------------------------
function buildSummary(
  wb: ExcelJS.Workbook,
  logo: Buffer | null,
  report: ManagementReport,
  meta: { periodText: string; generated: string; summary: { label: string; value: string }[] },
) {
  const ws = wb.addWorksheet("Resumo", { properties: { tabColor: { argb: BRAND.accent } } });
  ws.columns = [{ width: 44 }, { width: 22 }, { width: 70 }];
  ws.views = [{ state: "frozen", ySplit: 5, showGridLines: false }];
  placeLogo(wb, ws, logo, 64);
  for (let r = 1; r <= 5; r++) ws.getRow(r).height = r === 5 ? 8 : 18;

  const title = ws.getCell("B1");
  title.value = REPORT_TITLE;
  title.font = { bold: true, size: 16, color: { argb: BRAND.primary } };
  ws.getCell("B2").value = meta.periodText;
  ws.getCell("B2").font = { bold: true, size: 11, color: { argb: BRAND.ink } };
  ws.getCell("B3").value = meta.generated;
  ws.getCell("B3").font = { size: 10, color: { argb: BRAND.muted } };
  ws.getCell("B4").value = "Fonte: Gestão de KM Rodado · Horizonte Fleet Management";
  ws.getCell("B4").font = { size: 10, color: { argb: BRAND.muted } };
  for (let c = 1; c <= 3; c++) ws.getCell(5, c).border = { bottom: { style: "medium", color: { argb: BRAND.accent } } };

  let row = 7;
  const ov = report.overview;
  const an = report.analysis;
  const k = ov?.kpis;

  if (report.errors.length) {
    sectionBand(ws, row, "Observação", 3);
    row += 1;
    for (const e of report.errors) {
      ws.getCell(row, 1).value = "Parte do relatório não pôde ser lida";
      ws.getCell(row, 3).value = e;
      ws.getCell(row, 3).alignment = { wrapText: true };
      row += 1;
    }
    row += 1;
  }

  // Filtros
  sectionBand(ws, row, "Filtros aplicados", 3);
  row = writeTable(
    ws,
    row + 1,
    [{ header: "Filtro" }, { header: "Valor" }, { header: "" }],
    meta.summary.length ? meta.summary.map((s) => [s.label, s.value, null]) : [["Escopo", "Todas as frotas visíveis no período", null]],
  );
  row += 2;

  // Período
  sectionBand(ws, row, "Período", 3);
  const period = report.period;
  row = writeTable(
    ws,
    row + 1,
    [{ header: "Item" }, { header: "Valor", numFmt: NUM.date }, { header: "Observação" }],
    [
      ["Início", excelDate(period?.from), null],
      ["Fim", excelDate(period?.to), null],
      ["Dia de referência", excelDate(ov?.period.referenceDay), "Último dia com KM validado no período (não um dia em que todos estão sem leitura)."],
      [
        "Período anterior (comparação)",
        an ? `${brDate(an.period.previousFrom)} a ${brDate(an.period.previousTo)}` : "—",
        "Usado na variação da dispersão dos hodômetros.",
      ],
    ],
  );
  row += 2;

  // Indicadores
  if (k) {
    sectionBand(ws, row, "Indicadores", 3);
    const pctRef = k.coverageRefTotal ? `${k.coverageRefCount ?? 0} de ${k.coverageRefTotal} frotas ativas` : "—";
    const kpiRows: [string, XCell, string, string?][] = [
      ["KM total no período (km)", k.kmTotal, "Soma do KM validado (só o que conta nos totais).", NUM.km],
      ["Veículos no relatório", k.vehicles, "Frotas no escopo e nos filtros.", NUM.int],
      ["Frotas ativas", k.activeVehicles, "", NUM.int],
      ["Média por veículo (km)", k.avgPerVehicle, "", NUM.km],
      ["Mediana por veículo (km)", k.medianPerVehicle, "", NUM.km],
      ["Média diária da frota (km/dia)", k.avgDailyFleet, "Dias com leitura.", NUM.km],
      ["Mediana diária da frota (km/dia)", k.medianDailyFleet, "", NUM.km],
      ["Média diária por veículo (km/dia)", k.avgDailyPerVehicle, "KM ÷ dias com leitura.", NUM.km],
      ["Cobertura do período", k.coveragePeriodPct, "Dias-veículo com leitura ÷ dias-veículo decorridos.", NUM.pct],
      ["Dias com leitura", k.validDays, "", NUM.int],
      ["KM no dia de referência (km)", k.kmRefDay, "", NUM.km],
      ["Frotas com leitura no dia de referência", k.coverageRefCount, pctRef, NUM.int],
      ["Frotas ativas sem leitura no dia de referência", k.vehiclesWithoutReadingRef, "Sem leitura não é 0 km.", NUM.int],
      ["Sem movimento no dia de referência", k.noMovementRef, "Leitura válida, deslocamento zero.", NUM.int],
      ["Frotas atualizadas", k.vehiclesUpdated, "Leitura até ontem.", NUM.int],
      ["Frotas desatualizadas (2 dias ou mais)", k.vehiclesStale, "", NUM.int],
      ["Dias de alta rodagem", k.highMileageDays, k.highMileageKm != null ? `Acima de ${k.highMileageKm} km/dia.` : "", NUM.int],
      ["Veículos com alta rodagem", k.highMileageVehicles, "", NUM.int],
      ["Inconsistências", k.inconsistencies, "Inconsistentes, pendentes, divergências e regressões.", NUM.int],
      ["Última importação", stampText(k.lastUpdate), ""],
    ];
    const start = row + 1;
    row = writeTable(
      ws,
      start,
      [{ header: "Indicador" }, { header: "Valor" }, { header: "Observação" }],
      kpiRows.map(([label, value, note]) => [label, value ?? "—", note]),
    );
    kpiRows.forEach(([, , , fmt], i) => {
      if (fmt) ws.getCell(start + 1 + i, 2).numFmt = fmt;
    });
    row += 2;
  }

  // Situação das leituras
  if (ov?.byStatus) {
    sectionBand(ws, row, "Situação das leituras (dias-veículo)", 3);
    const codes = Object.keys(KM_STATUS) as KmReadingStatus[];
    row = writeTable(
      ws,
      row + 1,
      [{ header: "Situação" }, { header: "Dias-veículo", numFmt: NUM.int }, { header: "Descrição" }],
      codes.map((c) => [KM_STATUS[c].label, byCode(ov.byStatus, c) ?? 0, KM_STATUS[c].description]),
    );
    row += 2;
  }

  // Atualização
  if (ov?.freshness) {
    sectionBand(ws, row, "Atualização das frotas", 3);
    row = writeTable(
      ws,
      row + 1,
      [{ header: "Faixa" }, { header: "Frotas", numFmt: NUM.int }, { header: "" }],
      KM_FRESHNESS.map((f) => [f.label, byCode(ov.freshness, f.key) ?? 0, null]),
    );
    row += 2;
  }

  // Quadrantes
  if (an?.quadrants) {
    sectionBand(ws, row, "Quadrantes (hodômetro acumulado × intensidade de rodagem)", 3);
    row = writeTable(
      ws,
      row + 1,
      [{ header: "Quadrante" }, { header: "Veículos", numFmt: NUM.int }, { header: "Leitura" }],
      Object.entries(KM_QUADRANT).map(([code, q]) => [q.label, byCode(an.quadrants, code) ?? 0, q.hint]),
    );
    row += 2;
  }

  // Leitura gerencial
  const insights = [...(ov?.insights ?? []), ...(an?.insights ?? [])];
  sectionBand(ws, row, "Leitura gerencial", 3);
  row = writeTable(
    ws,
    row + 1,
    [{ header: "Tom" }, { header: "" }, { header: "Fato" }],
    insights.length ? insights.map((i) => [TONE_LABEL[i.tone] ?? "Informativo", null, i.text]) : [["—", null, "Sem destaques para o recorte."]],
  );
  for (let r = row - insights.length + 1; r <= row; r++) ws.getCell(r, 3).alignment = { wrapText: true, vertical: "top" };
  row += 2;

  // Notas
  sectionBand(ws, row, "Notas", 3);
  row += 1;
  for (const note of [PARITY_NOTE, NO_READING_NOTE, OUTLIER_NOTE]) {
    ws.mergeCells(row, 1, row, 3);
    const c = ws.getCell(row, 1);
    c.value = note;
    c.alignment = { wrapText: true, vertical: "top" };
    c.font = { size: 10, color: { argb: BRAND.muted } };
    ws.getRow(row).height = 30;
    row += 1;
  }
}
