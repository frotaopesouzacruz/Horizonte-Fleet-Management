import { NextResponse, type NextRequest } from "next/server";
import { requireOrganization } from "@/lib/auth/session";
import { getKmFilterOptions } from "@/lib/km/options";
import { kmRpc } from "@/lib/km/rpc";
import { kmFiltersPayload, parseKmFilters } from "@/lib/km/url";
import { byCode, KM_ALERT_LABEL, KM_FRESHNESS, kmStatusLabel, type KmAlert, type KmVehicleCard } from "@/lib/km/types";
import { kmFilterSummary, kmPeriodSlug, kmResolvedPeriodLabel } from "../../relatorio/filter-summary";
import { NO_READING_NOTE, PARITY_NOTE } from "../../relatorio/labels";
import {
  BRAND, dataSheet, excelDate, excelStamp, loadLogo, logKmExport, newWorkbook, NUM, placeLogo, sectionBand, stampText,
  writeTable, xlsxResponse,
} from "../../relatorio/xlsx-kit";

/**
 * Qualidade de Dados de KM (XLSX) — `km_quality` com os filtros da URL.
 *
 * Abas: Resumo (score e seus três componentes, saúde dos hodômetros, último
 * lote), Indicadores, Ocorrências e Frotas desatualizadas. A exportação é
 * registrada antes de o arquivo sair.
 */
export const maxDuration = 60;

interface QualityIssue extends KmVehicleCard {
  readingId: string;
  day: string;
  status: string;
  alerts: string[] | null;
  odometerStart: number | null;
  odometerEnd: number | null;
  kmInformed: number | null;
  kmCalculated: number | null;
  km: number | null;
  corrected: boolean | null;
}

interface QualityStale extends KmVehicleCard {
  lastReadingDate: string | null;
  missingDays: number | null;
  bucket: string;
}

interface QualityData {
  period: { from: string; to: string };
  score: number | null;
  components: {
    coveragePct: number | null;
    consistencyPct: number | null;
    freshnessPct: number | null;
    elapsedVehicleDays: number | null;
    readings: number | null;
    withReading: number | null;
    problems: number | null;
    activeVehicles: number | null;
    updatedVehicles: number | null;
  } | null;
  indicators: Record<string, number | null> | null;
  issues: QualityIssue[] | null;
  stale: QualityStale[] | null;
  health: Record<string, number> | null;
  lastBatch: {
    id: string;
    fileName: string | null;
    processedAt: string | null;
    createdRows: number | null;
    updatedRows: number | null;
    errorRows: number | null;
    warningRows: number | null;
  } | null;
}

/** Limite de ocorrências devolvidas pela rotina (as mais recentes). */
const ISSUE_LIMIT = 1000;

const EXTRA_ALERT: Record<string, string> = {
  high_mileage: "Alta rodagem",
  missing_odometer: "Hodômetro ausente",
  end_before_start: "Final menor que o inicial",
};
const alertText = (codes: string[] | null) =>
  (codes ?? []).map((c) => KM_ALERT_LABEL[c as KmAlert] ?? EXTRA_ALERT[c] ?? c).join("; ");

const INDICATORS: [string, string, string][] = [
  ["valid", "Leituras validadas", "Dias-veículo"],
  ["noReading", "Sem leitura", "Dias-veículo decorridos sem informação confiável (não é 0 km)"],
  ["noReadingInformed", "Sem leitura com linha na base", "A fonte trouxe a linha, sem hodômetro confiável"],
  ["noMovement", "Sem movimento", "Leitura válida, deslocamento zero ou dentro da tolerância"],
  ["kmDivergence", "Divergência de KM", "KM informado difere do calculado; vale o calculado"],
  ["highMileage", "Alta rodagem", "Acima do limite diário configurado"],
  ["inconsistent", "Inconsistentes", "Final menor que o inicial ou só um hodômetro; fora dos totais"],
  ["pendingReview", "Pendentes de análise", "Hodômetro regrediu em relação ao dia anterior"],
  ["regression", "Hodômetros regressivos", "Alertas de regressão"],
  ["jump", "Saltos de hodômetro", "Alertas de salto"],
  ["registryDivergence", "Divergência cadastral", "Veículos"],
  ["corrected", "Leituras corrigidas", "Correções manuais auditadas"],
  ["staleVehicles", "Frotas desatualizadas", "2 dias ou mais sem leitura, ou nunca"],
  ["unregisteredPlates", "Placas não cadastradas", "No último lote processado"],
  ["duplicates", "Duplicidades", "No último lote processado"],
];

const HEALTH: [string, string][] = [
  ["healthy", "Saudável"],
  ["attention", "Atenção"],
  ["critical", "Crítico"],
  ["no_data", "Sem dados"],
];

export async function GET(request: NextRequest) {
  const { session, organization } = await requireOrganization("km.export");
  const orgId = organization.organizationId;
  const filters = parseKmFilters(Object.fromEntries(request.nextUrl.searchParams.entries()));
  const payload = kmFiltersPayload(filters);

  let data: QualityData;
  let options: Awaited<ReturnType<typeof getKmFilterOptions>> | null = null;
  try {
    [data, options] = await Promise.all([
      kmRpc<QualityData>("km_quality", { p_organization_id: orgId, p_filters: payload }),
      getKmFilterOptions(orgId).catch(() => null),
    ]);
  } catch (error) {
    const message = error instanceof Error ? error.message.replace(/^km_quality:\s*/, "") : "";
    return NextResponse.json({ error: message || "Não foi possível ler a qualidade de dados de KM." }, { status: 500 });
  }

  const issues = data.issues ?? [];
  const stale = data.stale ?? [];
  const auditError = await logKmExport(orgId, "qualidade", "xlsx", issues.length + stale.length, payload);
  if (auditError) {
    return NextResponse.json({ error: "Não foi possível registrar a exportação na auditoria." }, { status: 403 });
  }

  const wb = newWorkbook();
  const logo = await loadLogo(request.nextUrl.origin);
  const periodText = kmResolvedPeriodLabel(data.period);
  const summary = kmFilterSummary(filters, options);
  const filterLine = summary.length ? `Filtros: ${summary.map((s) => `${s.label}: ${s.value}`).join(" · ")}` : "Filtros: nenhum (todas as frotas visíveis)";
  const generated = `Gerado em ${stampText(new Date())} por ${session.displayName} · ${organization.organizationName}`;
  const context = [periodText, filterLine, generated];

  // ------------------------------------------------------------- resumo --
  const ws = wb.addWorksheet("Resumo", { properties: { tabColor: { argb: BRAND.accent } } });
  ws.columns = [{ width: 44 }, { width: 20 }, { width: 70 }];
  ws.views = [{ state: "frozen", ySplit: 5, showGridLines: false }];
  placeLogo(wb, ws, logo, 64);
  for (let r = 1; r <= 5; r++) ws.getRow(r).height = r === 5 ? 8 : 18;
  ws.getCell("B1").value = "Qualidade de Dados de KM";
  ws.getCell("B1").font = { bold: true, size: 16, color: { argb: BRAND.primary } };
  ws.getCell("B2").value = periodText;
  ws.getCell("B2").font = { bold: true, size: 11, color: { argb: BRAND.ink } };
  ws.getCell("B3").value = generated;
  ws.getCell("B3").font = { size: 10, color: { argb: BRAND.muted } };
  ws.getCell("B4").value = filterLine;
  ws.getCell("B4").font = { size: 10, color: { argb: BRAND.muted } };
  for (let c = 1; c <= 3; c++) ws.getCell(5, c).border = { bottom: { style: "medium", color: { argb: BRAND.accent } } };

  let row = 7;
  const comp = data.components;
  sectionBand(ws, row, "Score de qualidade (0 a 100)", 3);
  const scoreStart = row + 1;
  row = writeTable(
    ws,
    scoreStart,
    [{ header: "Componente" }, { header: "Valor" }, { header: "Como é calculado" }],
    [
      ["Score", data.score, "50 × cobertura + 30 × consistência + 20 × atualização (cada componente de 0 a 1)."],
      ["Cobertura (peso 50)", comp?.coveragePct ?? null, `${comp?.withReading ?? 0} de ${comp?.elapsedVehicleDays ?? 0} dias-veículo decorridos com leitura confiável.`],
      ["Consistência (peso 30)", comp?.consistencyPct ?? null, `${comp?.problems ?? 0} leituras com problema em ${comp?.readings ?? 0} (inconsistente, divergência, pendente ou regressão).`],
      ["Atualização (peso 20)", comp?.freshnessPct ?? null, `${comp?.updatedVehicles ?? 0} de ${comp?.activeVehicles ?? 0} frotas ativas com leitura até ontem.`],
    ],
  );
  ws.getCell(scoreStart + 1, 2).numFmt = "0.0";
  for (let i = 2; i <= 4; i++) ws.getCell(scoreStart + i, 2).numFmt = NUM.pct;
  ws.getCell(scoreStart + 1, 2).font = { bold: true, size: 12, color: { argb: BRAND.primary } };
  row += 2;

  sectionBand(ws, row, "Saúde dos hodômetros", 3);
  row = writeTable(
    ws,
    row + 1,
    [{ header: "Saúde" }, { header: "Veículos", numFmt: NUM.int }, { header: "" }],
    HEALTH.map(([code, label]) => [label, byCode(data.health, code) ?? 0, null]),
  );
  row += 2;

  sectionBand(ws, row, "Último lote processado", 3);
  const lb = data.lastBatch;
  const lbStart = row + 1;
  row = writeTable(
    ws,
    lbStart,
    [{ header: "Item" }, { header: "Valor" }, { header: "" }],
    lb
      ? [
          ["Arquivo", lb.fileName, null],
          ["Processado em", excelStamp(lb.processedAt), null],
          ["Linhas criadas", lb.createdRows, null],
          ["Linhas atualizadas", lb.updatedRows, null],
          ["Linhas com aviso", lb.warningRows, null],
          ["Linhas com erro", lb.errorRows, null],
        ]
      : [["Nenhum lote concluído", null, null]],
  );
  if (lb) {
    ws.getCell(lbStart + 2, 2).numFmt = NUM.stamp;
    for (let i = 3; i <= 6; i++) ws.getCell(lbStart + i, 2).numFmt = NUM.int;
  }
  row += 2;

  sectionBand(ws, row, "Notas", 3);
  row += 1;
  const notes = [PARITY_NOTE, NO_READING_NOTE];
  if (issues.length >= ISSUE_LIMIT) {
    notes.push(`A rotina devolve as ${ISSUE_LIMIT.toLocaleString("pt-BR")} ocorrências mais recentes. Para todas as leituras do período, use a Base Consolidada.`);
  }
  for (const note of notes) {
    ws.mergeCells(row, 1, row, 3);
    const c = ws.getCell(row, 1);
    c.value = note;
    c.alignment = { wrapText: true, vertical: "top" };
    c.font = { size: 10, color: { argb: BRAND.muted } };
    ws.getRow(row).height = 30;
    row += 1;
  }

  // ------------------------------------------------------- indicadores --
  dataSheet(
    wb,
    "Indicadores",
    "Indicadores de qualidade",
    context,
    [{ header: "Indicador", width: 34 }, { header: "Quantidade", numFmt: NUM.int, width: 14 }, { header: "Descrição", width: 70 }],
    INDICATORS.map(([key, label, hint]) => [label, data.indicators?.[key] ?? null, hint]),
  );

  // -------------------------------------------------------- ocorrências --
  dataSheet(
    wb,
    "Ocorrências",
    "Ocorrências do período",
    context,
    [
      { header: "Data", numFmt: NUM.date, width: 12 },
      { header: "Placa", width: 11 },
      { header: "Frota", width: 10 },
      { header: "Tipo", width: 16 },
      { header: "Subcategoria", width: 14 },
      { header: "Modelo", width: 18 },
      { header: "Situação", width: 20 },
      { header: "Alertas", width: 32 },
      { header: "Hodômetro inicial", numFmt: NUM.km2, width: 14 },
      { header: "Hodômetro final", numFmt: NUM.km2, width: 14 },
      { header: "KM informado", numFmt: NUM.km, width: 12 },
      { header: "KM calculado", numFmt: NUM.km, width: 12 },
      { header: "KM validado", numFmt: NUM.km, width: 12 },
      { header: "Corrigido", width: 10 },
    ],
    issues.map((i) => [
      excelDate(i.day), i.plate, i.fleetCode, i.type, i.subcategory, i.model, kmStatusLabel(i.status), alertText(i.alerts),
      i.odometerStart, i.odometerEnd, i.kmInformed, i.kmCalculated, i.km, Boolean(i.corrected),
    ]),
    {
      freezeCols: 2,
      note:
        issues.length >= ISSUE_LIMIT
          ? `Lista limitada às ${ISSUE_LIMIT.toLocaleString("pt-BR")} ocorrências mais recentes.`
          : undefined,
    },
  );

  // ------------------------------------------------- frotas desatualizadas --
  dataSheet(
    wb,
    "Frotas desatualizadas",
    "Frotas desatualizadas (2 dias ou mais sem leitura, ou nunca)",
    context,
    [
      { header: "Placa", width: 11 },
      { header: "Frota", width: 10 },
      { header: "Tipo", width: 16 },
      { header: "Subcategoria", width: 14 },
      { header: "Modelo", width: 18 },
      { header: "Situação cadastral", width: 12 },
      { header: "Última leitura", numFmt: NUM.date, width: 13 },
      { header: "Dias sem leitura", numFmt: NUM.int, width: 12 },
      { header: "Faixa", width: 20 },
    ],
    stale.map((s) => [
      s.plate, s.fleetCode, s.type, s.subcategory, s.model, s.status === "active" ? "Ativo" : s.status === "inactive" ? "Inativo" : s.status,
      excelDate(s.lastReadingDate), s.missingDays, KM_FRESHNESS.find((f) => f.key === s.bucket)?.label ?? s.bucket,
    ]),
    { freezeCols: 2 },
  );

  return xlsxResponse(wb, `km-qualidade-${kmPeriodSlug(data.period, filters)}.xlsx`);
}
