import { NextResponse, type NextRequest } from "next/server";
import { requireOrganization } from "@/lib/auth/session";
import { getMtsrInspectionsReceived } from "@/lib/mtsr/queries";
import { INSPECTION_STATUS_LABEL, fmtInt, type InspectionStatus, type MtsrInspectionsReceived } from "@/lib/mtsr/types";
import { firstParam, mtsrFiltersPayload, parseMtsrFilters } from "@/lib/mtsr/url";
import type { Json } from "@/types/database.types";
import { dataSheet, excelDate, excelStamp, newWorkbook, NUM, xlsxResponse, type XCol } from "@/app/(app)/frota/km/relatorio/xlsx-kit";
import { logMtsrExport } from "../export-log";
import { fileSlug, filterLine, generatedLine, readAllPages, snapshotLine } from "../shared";

/**
 * Vistorias recebidas (XLSX) — `mtsr_inspections_received` com os mesmos
 * filtros da aba (situação, período, inspetor, só com NOK, busca, operação e
 * tipo de equipamento), lida página a página até o total. Uma linha por
 * vistoria, com SLA de análise calculado pelo banco. Registrada antes de sair.
 */
export const maxDuration = 60;

const PAGE = 500;
const list = (v: string | undefined) => (v ?? "").split(",").map((s) => s.trim()).filter(Boolean);
const statusLabel = (s: string) => INSPECTION_STATUS_LABEL[s as InspectionStatus] ?? s;

export async function GET(request: NextRequest) {
  const { session, organization } = await requireOrganization("mtsr.export");
  const orgId = organization.organizationId;
  const params = Object.fromEntries(request.nextUrl.searchParams.entries());
  const filters = parseMtsrFilters(params);
  const fleet = mtsrFiltersPayload(filters);

  // Mesma montagem da aba Vistorias recebidas: sem situação informada, a fila pendente;
  // "todas" libera todas as situações.
  const f: Record<string, Json> = {};
  const situacao = firstParam(params, "situacao");
  const statuses = list(situacao).filter((s) => s !== "todas" && s !== "all");
  if (situacao !== "todas" && situacao !== "all") f.statuses = statuses.length ? statuses : ["pendente_validacao"];
  if (filters.q) f.search = filters.q;
  if (fleet.operation_ids) f.operation_ids = fleet.operation_ids;
  if (fleet.vehicle_type_ids) f.vehicle_type_ids = fleet.vehicle_type_ids;
  const inspector = firstParam(params, "inspetor");
  if (inspector) f.inspector_ids = [inspector];
  const from = firstParam(params, "de");
  const to = firstParam(params, "ate");
  if (from) f.date_from = from;
  if (to) f.date_to = to;
  if (firstParam(params, "nok") === "1") f.nok_only = true;

  let data: MtsrInspectionsReceived;
  let rows: MtsrInspectionsReceived["rows"];
  try {
    const pages = await readAllPages((limit, offset) => getMtsrInspectionsReceived(orgId, f, limit, offset), PAGE);
    data = pages.first;
    rows = pages.rows;
  } catch (error) {
    const message = error instanceof Error ? error.message.replace(/^mtsr_[a-z_]+:\s*/, "") : "";
    return NextResponse.json({ error: message || "Não foi possível ler as vistorias recebidas." }, { status: 500 });
  }

  const auditError = await logMtsrExport(orgId, "vistorias", "xlsx", rows.length, f);
  if (auditError) {
    return NextResponse.json({ error: "Não foi possível registrar a exportação na auditoria." }, { status: 403 });
  }

  const parts: string[] = [];
  if (f.statuses) parts.push(`Situação: ${(f.statuses as string[]).map(statusLabel).join(", ")}`);
  else parts.push("Situação: todas");
  if (from || to) parts.push(`Vistoria de ${from ? excelDateText(from) : "—"} a ${to ? excelDateText(to) : "—"}`);
  if (inspector) parts.push(`Inspetor: ${data.options.inspectors.find((i) => i.id === inspector)?.name ?? "(não encontrado)"}`);
  if (fleet.operation_ids) {
    const names = (fleet.operation_ids as string[]).map((id) => data.options.operations.find((o) => o.id === id)?.name ?? "(não encontrado)");
    parts.push(`Operação: ${names.join(", ")}`);
  }
  if (fleet.vehicle_type_ids) parts.push(`Tipo de equipamento: ${(fleet.vehicle_type_ids as string[]).length} selecionado(s)`);
  if (f.nok_only) parts.push("Só vistorias com NOK");
  if (filters.q) parts.push(`Busca: ${filters.q}`);

  const k = data.kpis;
  const kpiLine =
    `No escopo: ${fmtInt(k.pendentes)} pendente(s) (${fmtInt(k.comNok)} com NOK, ${fmtInt(k.acimaSla)} acima do SLA de ${fmtInt(data.reviewSlaDays)} dia(s)), ` +
    `${fmtInt(k.validadas)} validada(s), ${fmtInt(k.retornadas)} retornada(s), ${fmtInt(k.rejeitadas)} rejeitada(s); ${fmtInt(k.ultimos30d)} enviada(s) nos últimos 30 dias.`;

  const cols: XCol[] = [
    { header: "Protocolo", width: 18 },
    { header: "Situação", width: 22 },
    { header: "Placa", width: 11 },
    { header: "Frota", width: 12 },
    { header: "Operação", width: 28 },
    { header: "Cidade/UF", width: 22 },
    { header: "Inspetor", width: 26 },
    { header: "Matrícula", width: 12 },
    { header: "Data da vistoria", width: 14, numFmt: NUM.date },
    { header: "Enviada em", width: 16, numFmt: NUM.stamp },
    { header: "Itens", width: 8, numFmt: NUM.int },
    { header: "NOK", width: 8, numFmt: NUM.int },
    { header: "Fotos", width: 8, numFmt: NUM.int },
    { header: "Dias aguardando", width: 12, numFmt: NUM.int },
    { header: "Acima do SLA", width: 12 },
    { header: "Revisor", width: 26 },
    { header: "Revisada em", width: 16, numFmt: NUM.stamp },
    { header: "Motivo", width: 48 },
  ];

  const wb = newWorkbook();
  dataSheet(
    wb,
    "Vistorias",
    "Vistorias MTSR recebidas",
    [snapshotLine(data.today), filterLine(parts, "fila pendente de validação"), kpiLine, generatedLine(session.displayName, organization.organizationName)],
    cols,
    rows.map((r) => [
      r.protocol,
      statusLabel(r.status),
      r.licensePlateSnapshot,
      r.fleetCodeSnapshot,
      r.operationNameSnapshot ?? "Sem operação",
      r.cityNameSnapshot ? `${r.cityNameSnapshot}${r.stateUfSnapshot ? `/${r.stateUfSnapshot}` : ""}` : r.stateUfSnapshot,
      r.inspectorNameSnapshot,
      r.inspectorCodeSnapshot,
      excelDate(r.inspectionDate),
      excelStamp(r.submittedAt),
      r.itemCount,
      r.nokCount,
      r.evidenceCount,
      r.daysWaiting,
      r.status === "pendente_validacao" ? r.overSla : null,
      r.reviewerNameSnapshot,
      excelStamp(r.reviewedAt),
      r.reviewReason,
    ]),
    {
      freezeCols: 3,
      highlight: (i) => rows[i]?.overSla === true || (rows[i]?.nokCount ?? 0) > 0,
      note: "Linhas destacadas: pendentes acima do SLA de análise ou com algum componente NOK. O envio de uma vistoria não altera o estado oficial; só a validação aplica.",
    },
  );

  return xlsxResponse(wb, `mtsr-vistorias-${fileSlug(data.today)}.xlsx`);
}

const excelDateText = (iso: string) => (/^\d{4}-\d{2}-\d{2}/.test(iso) ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : iso);
