import { NextResponse, type NextRequest } from "next/server";
import { requireOrganization } from "@/lib/auth/session";
import { getMtsrCatalog, getMtsrFilterOptions, getMtsrFleetStatus } from "@/lib/mtsr/queries";
import {
  componentStatusLabel,
  conformityLabel,
  criticalityLabel,
  deadlineLabel,
  type MtsrCatalog,
  type MtsrFleetStatus,
} from "@/lib/mtsr/types";
import { mtsrFiltersPayload, parseMtsrFilters, parseSort } from "@/lib/mtsr/url";
import { BRAND, dataSheet, excelDate, loadLogo, newWorkbook, NUM, placeLogo, writeTable, xlsxResponse, type XCol } from "@/app/(app)/frota/km/relatorio/xlsx-kit";
import { logMtsrExport } from "../export-log";
import { fileSlug, filterLine, generatedLine, mtsrFilterSummary, readAllPages, snapshotLine } from "../shared";

/**
 * Matriz de conformidade MTSR (XLSX) — `mtsr_fleet_status` com os mesmos
 * filtros, a mesma ordenação e o mesmo escopo da aba Conformidade, lida página
 * a página até o total (sem teto de linhas). Aba Resumo com o sumário da matriz
 * e aba Conformidade com uma linha por veículo e uma coluna por componente
 * (OK / NOK / —). Linhas não conformes saem destacadas. A exportação é
 * registrada antes de o arquivo sair.
 */
export const maxDuration = 60;

const PAGE = 1000;

export async function GET(request: NextRequest) {
  const { session, organization } = await requireOrganization("mtsr.export");
  const orgId = organization.organizationId;
  const params = Object.fromEntries(request.nextUrl.searchParams.entries());
  const filters = parseMtsrFilters(params);
  const payload = mtsrFiltersPayload(filters);
  const { sort, dir } = parseSort(params);

  let status: MtsrFleetStatus;
  let rows: MtsrFleetStatus["rows"];
  let catalog: MtsrCatalog;
  let options: Awaited<ReturnType<typeof getMtsrFilterOptions>> | null = null;
  try {
    const [pages, cat, opts] = await Promise.all([
      readAllPages((limit, offset) => getMtsrFleetStatus(orgId, payload, sort, dir, limit, offset), PAGE),
      getMtsrCatalog(orgId),
      getMtsrFilterOptions(orgId).catch(() => null),
    ]);
    status = pages.first;
    rows = pages.rows;
    catalog = cat;
    options = opts;
  } catch (error) {
    const message = error instanceof Error ? error.message.replace(/^mtsr_[a-z_]+:\s*/, "") : "";
    return NextResponse.json({ error: message || "Não foi possível ler a matriz de conformidade." }, { status: 500 });
  }

  const auditError = await logMtsrExport(orgId, "conformidade", "xlsx", rows.length, { ...payload, sort, dir });
  if (auditError) {
    return NextResponse.json({ error: "Não foi possível registrar a exportação na auditoria." }, { status: 403 });
  }

  const components = catalog.components.filter((c) => c.isActive).sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, "pt-BR"));
  const wb = newWorkbook();
  const logo = await loadLogo(request.nextUrl.origin);
  const todayText = snapshotLine(status.today);
  const filtersText = filterLine(mtsrFilterSummary(filters, options, components), "nenhum (toda a frota visível)");
  const generated = generatedLine(session.displayName, organization.organizationName);
  const context = [todayText, filtersText, generated];

  // ------------------------------------------------------------- resumo --
  const ws = wb.addWorksheet("Resumo", { properties: { tabColor: { argb: BRAND.accent } } });
  ws.columns = [{ width: 40 }, { width: 18 }, { width: 72 }];
  ws.views = [{ state: "frozen", ySplit: 5, showGridLines: false }];
  placeLogo(wb, ws, logo, 64);
  for (let r = 1; r <= 5; r++) ws.getRow(r).height = r === 5 ? 8 : 18;
  ws.getCell("B1").value = "Conformidade MTSR";
  ws.getCell("B1").font = { bold: true, size: 16, color: { argb: BRAND.primary } };
  ws.getCell("B2").value = todayText;
  ws.getCell("B2").font = { bold: true, size: 11, color: { argb: BRAND.ink } };
  ws.getCell("B3").value = generated;
  ws.getCell("B3").font = { size: 10, color: { argb: BRAND.muted } };
  ws.getCell("B4").value = filtersText;
  ws.getCell("B4").font = { size: 10, color: { argb: BRAND.muted } };
  for (let c = 1; c <= 3; c++) ws.getCell(5, c).border = { bottom: { style: "medium", color: { argb: BRAND.accent } } };

  const s = status.summary;
  const start = 7;
  const end = writeTable(
    ws,
    start,
    [{ header: "Indicador" }, { header: "Valor", numFmt: NUM.int }, { header: "Como é lido" }],
    [
      ["Veículos", s.vehicles, "Frota no escopo e nos filtros aplicados (padrão: frotas ativas)."],
      ["Conformes", s.conforme, "Todos os componentes conhecidos estão OK."],
      ["Não conformes", s.naoConforme, "Pelo menos um componente NOK no estado oficial."],
      ["Sem informação", s.semInformacao, "Nenhum componente com leitura conhecida (não é 0 e não é conforme)."],
      ["Criticidade crítica", s.critica, "NOK com prazo de vistoria vencido ou pendente."],
      ["Criticidade alta", s.alta, "NOK com prazo em atenção."],
      ["Criticidade média", s.media, "NOK com prazo conforme."],
      ["Prazo vencido", s.vencido, `Última vistoria válida há mais de ${catalog.parameters.attentionMaxDays} dias.`],
      ["Prazo em atenção", s.atencao, `Última vistoria válida entre ${catalog.parameters.attentionMinDays} e ${catalog.parameters.attentionMaxDays} dias.`],
      ["Prazo pendente", s.pendente, "Veículo sem nenhuma vistoria válida registrada."],
      ["Aguardando revalidação", s.awaiting, "Veículos com componente cuja manutenção foi concluída e ainda não teve nova verificação."],
    ],
  );
  ws.mergeCells(end + 2, 1, end + 2, 3);
  const note = ws.getCell(end + 2, 1);
  note.value =
    "O estado oficial de cada componente muda só por vistoria validada (componentes de campo), por atualização do backoffice ou por importação. " +
    "A conclusão de uma manutenção não torna o componente OK: ele fica aguardando revalidação até nova leitura. " +
    `Prazo vigente: conforme até ${catalog.parameters.conformeMaxDays} dias, atenção de ${catalog.parameters.attentionMinDays} a ${catalog.parameters.attentionMaxDays}, vencido acima disso.`;
  note.alignment = { wrapText: true, vertical: "top" };
  note.font = { size: 10, color: { argb: BRAND.muted } };
  ws.getRow(end + 2).height = 56;

  // ------------------------------------------------------- conformidade --
  const fixed: XCol[] = [
    { header: "Operação", width: 28 },
    { header: "Frota", width: 12 },
    { header: "Placa", width: 11 },
    { header: "Tipo", width: 22 },
    { header: "Cidade/UF", width: 22 },
    { header: "BR", width: 10 },
    { header: "Liderança", width: 24 },
    { header: "Filial", width: 20 },
    { header: "Última vistoria válida", width: 14, numFmt: NUM.date },
    { header: "Dias desde a vistoria", width: 12, numFmt: NUM.int },
    { header: "Prazo", width: 12 },
    { header: "Conformidade", width: 16 },
    { header: "Criticidade", width: 14 },
    { header: "Componente principal", width: 22 },
    { header: "NOK", width: 8, numFmt: NUM.int },
    { header: "OK", width: 8, numFmt: NUM.int },
    { header: "Sem informação", width: 12, numFmt: NUM.int },
    { header: "Aguardando revalidação", width: 14, numFmt: NUM.int },
    { header: "Manutenções abertas", width: 12, numFmt: NUM.int },
    { header: "Vistorias pendentes", width: 12, numFmt: NUM.int },
  ];
  const cols: XCol[] = [...fixed, ...components.map((c) => ({ header: c.name, width: Math.min(28, Math.max(12, c.name.length + 4)) }))];

  const cellLabel = (value: string | undefined) => (!value || value === "sem_informacao" ? "—" : componentStatusLabel(value));

  dataSheet(
    wb,
    "Conformidade",
    "Conformidade MTSR por veículo",
    context,
    cols,
    rows.map((r) => {
      const byComponent = new Map(r.components.map((c) => [c.componentId, c]));
      return [
        r.operationName ?? "Sem operação",
        r.fleetCode,
        r.licensePlate,
        r.vehicleTypeName,
        r.cityName ? `${r.cityName}${r.stateUf ? `/${r.stateUf}` : ""}` : r.stateUf,
        r.brCode,
        r.leaderName,
        r.unitName,
        excelDate(r.lastValidInspectionDate),
        r.daysSince,
        deadlineLabel(r.deadlineStatus),
        conformityLabel(r.conformityStatus),
        criticalityLabel(r.criticality),
        r.mainComponentName,
        r.nokCount,
        r.okCount,
        r.unknownCount,
        r.awaitingCount,
        r.openMaintenances,
        r.pendingInspections,
        ...components.map((c) => cellLabel(byComponent.get(c.id)?.status)),
      ];
    }),
    {
      freezeCols: 3,
      highlight: (i) => rows[i]?.conformityStatus === "nao_conforme",
      note: "Linhas destacadas: veículos não conformes. Nas colunas de componente, — significa sem informação (nunca OK por omissão).",
    },
  );

  return xlsxResponse(wb, `mtsr-conformidade-${fileSlug(status.today)}.xlsx`);
}
