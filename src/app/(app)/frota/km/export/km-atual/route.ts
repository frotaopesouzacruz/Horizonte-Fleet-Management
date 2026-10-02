import { NextResponse, type NextRequest } from "next/server";
import { requireOrganization } from "@/lib/auth/session";
import { getKmFilterOptions } from "@/lib/km/options";
import { fetchFleetCurrent, kmFleetCurrentPayload, type KmFleetCurrentData } from "@/lib/km/fleet-current";
import { parseKmFilters } from "@/lib/km/url";
import { KM_CURRENT_FRESHNESS_LABEL } from "@/lib/km/types";
import { kmFilterSummary } from "../../relatorio/filter-summary";
import {
  BRAND, dataSheet, excelDate, loadLogo, logKmExport, newWorkbook, NUM, placeLogo, stampText, writeTable, xlsxResponse,
} from "../../relatorio/xlsx-kit";
import { sourceLabel } from "../../panels/fleet/model";

/**
 * KM atual das frotas (XLSX) — `km_fleet_current` com os mesmos filtros, o
 * mesmo escopo e o mesmo filtro de atualização (`leitura`) da aba. Uma linha
 * por frota: operação, local, hodômetro oficial vigente, origem, data, dias
 * sem atualização e situação. Frota sem leitura sai com o KM em branco —
 * nunca 0. A exportação é registrada antes de o arquivo sair.
 */
export const maxDuration = 60;

const CONTEXT: Record<string, string> = {
  fidelization: "Fidelização",
  allocation: "Alocação do cadastro",
  leadership: "Lideranças",
  none: "Sem contexto",
};

export async function GET(request: NextRequest) {
  const { session, organization } = await requireOrganization("km.export");
  const orgId = organization.organizationId;
  const params = Object.fromEntries(request.nextUrl.searchParams.entries());
  const filters = parseKmFilters(params);
  const { freshness, payload } = kmFleetCurrentPayload({ filters, params });

  let data: Omit<KmFleetCurrentData, "freshnessFilter">;
  let options: Awaited<ReturnType<typeof getKmFilterOptions>> | null = null;
  try {
    [data, options] = await Promise.all([fetchFleetCurrent(orgId, payload), getKmFilterOptions(orgId).catch(() => null)]);
  } catch (error) {
    const message = error instanceof Error ? error.message.replace(/^km_fleet_current:\s*/, "") : "";
    return NextResponse.json({ error: message || "Não foi possível ler o KM atual das frotas." }, { status: 500 });
  }

  const rows = data.rows ?? [];
  const auditError = await logKmExport(orgId, "km_atual", "xlsx", rows.length, payload);
  if (auditError) {
    return NextResponse.json({ error: "Não foi possível registrar a exportação na auditoria." }, { status: 403 });
  }

  const wb = newWorkbook();
  const logo = await loadLogo(request.nextUrl.origin);
  const todayText = `Retrato de ${data.today.slice(8, 10)}/${data.today.slice(5, 7)}/${data.today.slice(0, 4)}`;
  const summary = kmFilterSummary(filters, options);
  const filterParts = summary.map((s) => `${s.label}: ${s.value}`);
  if (freshness.length) filterParts.push(`Atualização: ${freshness.map((f) => KM_CURRENT_FRESHNESS_LABEL[f]).join(", ")}`);
  const filterLine = filterParts.length ? `Filtros: ${filterParts.join(" · ")}` : "Filtros: nenhum (todas as frotas visíveis)";
  const generated = `Gerado em ${stampText(new Date())} por ${session.displayName} · ${organization.organizationName}`;
  const context = [todayText, filterLine, generated];

  // ------------------------------------------------------------- resumo --
  const ws = wb.addWorksheet("Resumo", { properties: { tabColor: { argb: BRAND.accent } } });
  ws.columns = [{ width: 40 }, { width: 18 }, { width: 64 }];
  ws.views = [{ state: "frozen", ySplit: 5, showGridLines: false }];
  placeLogo(wb, ws, logo, 64);
  for (let r = 1; r <= 5; r++) ws.getRow(r).height = r === 5 ? 8 : 18;
  ws.getCell("B1").value = "KM atual das frotas";
  ws.getCell("B1").font = { bold: true, size: 16, color: { argb: BRAND.primary } };
  ws.getCell("B2").value = todayText;
  ws.getCell("B2").font = { bold: true, size: 11, color: { argb: BRAND.ink } };
  ws.getCell("B3").value = generated;
  ws.getCell("B3").font = { size: 10, color: { argb: BRAND.muted } };
  ws.getCell("B4").value = filterLine;
  ws.getCell("B4").font = { size: 10, color: { argb: BRAND.muted } };
  for (let c = 1; c <= 3; c++) ws.getCell(5, c).border = { bottom: { style: "medium", color: { argb: BRAND.accent } } };

  const s = data.summary;
  const start = 7;
  const end = writeTable(
    ws,
    start,
    [{ header: "Indicador" }, { header: "Valor" }, { header: "Como é lido" }],
    [
      ["Frotas", s.vehicles, `${s.operations} operação(ões) no contexto de hoje (Fidelização, alocação ou Lideranças).`],
      ["Atualizadas recentemente", s.recent, "Hodômetro oficial com leitura de hoje ou de ontem."],
      ["Leitura defasada", s.stale, "2 dias ou mais sem leitura."],
      ["Sem leitura", s.never, "Nunca tiveram hodômetro registrado (KM em branco — não é 0)."],
      ["Dias sem atualização (média)", s.avgDays, "Entre as frotas com leitura."],
      ["Dias sem atualização (máximo)", s.maxDays, "Entre as frotas com leitura."],
      ["Leituras vindas da Gestão de KM", s.fromKmModule, "Hodômetro final do dia gravado pela importação de KM."],
      ["Última leitura registrada", excelDate(s.lastReadingDate), "Data mais recente entre as leituras vigentes."],
    ],
  );
  for (let i = 1; i <= 4; i++) ws.getCell(start + i, 2).numFmt = NUM.int;
  ws.getCell(start + 5, 2).numFmt = "0.0";
  for (let i = 6; i <= 7; i++) ws.getCell(start + i, 2).numFmt = NUM.int;
  ws.getCell(start + 8, 2).numFmt = NUM.date;
  ws.mergeCells(end + 2, 1, end + 2, 3);
  const note = ws.getCell(end + 2, 1);
  note.value =
    "A leitura vigente é a mesma do Cadastro de Frotas e da Manutenção (vehicle_odometer_readings): a mais recente de qualquer origem que ninguém corrigiu. A coluna Origem diz quem a gravou.";
  note.alignment = { wrapText: true, vertical: "top" };
  note.font = { size: 10, color: { argb: BRAND.muted } };
  ws.getRow(end + 2).height = 42;

  // ------------------------------------------------------------- frotas --
  dataSheet(
    wb,
    "Frotas",
    "KM atual das frotas",
    context,
    [
      { header: "Operação", width: 28 },
      { header: "Frota", width: 12 },
      { header: "Placa", width: 11 },
      { header: "Tipo", width: 22 },
      { header: "Carroceria", width: 18 },
      { header: "Modelo", width: 22 },
      { header: "UF", width: 6 },
      { header: "Cidade", width: 20 },
      { header: "BR", width: 10 },
      { header: "Liderança", width: 24 },
      { header: "Contexto", width: 18 },
      { header: "Última leitura", width: 14, numFmt: NUM.date },
      { header: "Origem", width: 20 },
      { header: "KM atual", width: 12, numFmt: NUM.int },
      { header: "Dias s/ atualização", width: 12, numFmt: NUM.int },
      { header: "Status", width: 24 },
      { header: "Última leitura do KM", width: 14, numFmt: NUM.date },
      { header: "Hodômetro do KM", width: 14, numFmt: NUM.int },
    ],
    rows.map((r) => [
      r.operation ?? "Sem operação",
      r.fleetCode,
      r.plate,
      r.type,
      r.subcategory,
      r.model,
      r.state,
      r.city,
      r.br,
      r.leader,
      r.contextSource ? (CONTEXT[r.contextSource] ?? r.contextSource) : null,
      excelDate(r.lastReadingDate),
      sourceLabel(r),
      r.odometerKm,
      r.daysSince,
      KM_CURRENT_FRESHNESS_LABEL[r.freshness],
      excelDate(r.kmReadingDate),
      r.kmOdometer,
    ]),
    {
      freezeCols: 3,
      highlight: (i) => rows[i]?.freshness !== "recent",
      note: "Linhas destacadas: leitura defasada ou sem leitura. Local = cidade/UF do contexto de hoje.",
    },
  );

  const slug = data.today.replace(/-/g, "");
  return xlsxResponse(wb, `km-atual-frotas-${slug}.xlsx`);
}
