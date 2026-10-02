import { NextResponse, type NextRequest } from "next/server";
import { requireOrganization } from "@/lib/auth/session";
import { spreadsheetResponse, type ExportCell } from "@/lib/admin/spreadsheet";
import { kmRpc } from "@/lib/km/rpc";
import { kmFiltersPayload, parseKmFilters } from "@/lib/km/url";
import { KM_ALERT_LABEL, kmStatusLabel, type KmAlert } from "@/lib/km/types";
import { kmPeriodSlug } from "../../relatorio/filter-summary";
import { logKmExport } from "../../relatorio/export-log";

/**
 * Base Consolidada de KM (XLSX ou CSV, `?format=`).
 *
 * Uma linha por veículo × dia decorrido do período, com os mesmos filtros e o
 * mesmo escopo da tela (`km_readings_export`, sob o cliente de quem exporta).
 * Sem teto: a rotina é lida em páginas de 5.000 até o total, e o arquivo sai
 * em fluxo. Dia sem leitura sai com a situação "Sem leitura" e o KM em
 * branco — nunca 0. A exportação é registrada antes de o arquivo sair.
 */
export const maxDuration = 120;

const PAGE = 5000;

const HEADERS = [
  "Data", "Placa", "Frota", "Tipo", "Subcategoria", "Modelo", "Operação", "UF", "Cidade", "BR", "Liderança",
  "Hodômetro inicial", "Hodômetro final", "KM informado", "KM calculado", "KM validado", "Situação", "Alertas",
  "Corrigido", "Contexto",
];

interface ExportRow {
  day: string;
  plate: string | null;
  fleetCode: string | null;
  type: string | null;
  subcategory: string | null;
  model: string | null;
  operation: string | null;
  state: string | null;
  city: string | null;
  br: string | null;
  leader: string | null;
  odometerStart: number | null;
  odometerEnd: number | null;
  kmInformed: number | null;
  kmCalculated: number | null;
  kmValidated: number | null;
  status: string;
  /** Códigos separados por ", ". */
  alerts: string | null;
  corrected: boolean | null;
  contextSource: string | null;
}

interface ExportPage {
  period: { from: string; to: string };
  total: number;
  rows: ExportRow[];
}

const EXTRA_ALERT: Record<string, string> = {
  high_mileage: "Alta rodagem",
  missing_odometer: "Hodômetro ausente",
  end_before_start: "Final menor que o inicial",
};

const CONTEXT: Record<string, string> = {
  fidelization: "Fidelização",
  allocation: "Alocação do cadastro",
  none: "Sem contexto",
};

const brDate = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

function alertsText(codes: string | null): string | null {
  if (!codes) return null;
  return codes
    .split(",")
    .map((c) => c.trim())
    .filter(Boolean)
    .map((c) => KM_ALERT_LABEL[c as KmAlert] ?? EXTRA_ALERT[c] ?? c)
    .join("; ");
}

function toRow(r: ExportRow): ExportCell[] {
  return [
    brDate(r.day),
    r.plate,
    r.fleetCode,
    r.type,
    r.subcategory,
    r.model,
    r.operation,
    r.state,
    r.city,
    r.br,
    r.leader,
    r.odometerStart,
    r.odometerEnd,
    r.kmInformed,
    r.kmCalculated,
    r.kmValidated,
    kmStatusLabel(r.status),
    alertsText(r.alerts),
    r.corrected ? "Sim" : "Não",
    r.contextSource ? (CONTEXT[r.contextSource] ?? r.contextSource) : null,
  ];
}

export async function GET(request: NextRequest) {
  const { organization } = await requireOrganization("km.export");
  const orgId = organization.organizationId;
  const search = request.nextUrl.searchParams;
  const format: "xlsx" | "csv" = search.get("format") === "csv" ? "csv" : "xlsx";
  const filters = parseKmFilters(Object.fromEntries(search.entries()));
  const payload = kmFiltersPayload(filters);

  const rows: ExportCell[][] = [];
  let period: ExportPage["period"] | null = null;
  try {
    let total = Infinity;
    for (let offset = 0; offset < total; ) {
      const page = await kmRpc<ExportPage>("km_readings_export", {
        p_organization_id: orgId,
        p_filters: payload,
        p_limit: PAGE,
        p_offset: offset,
      });
      period ??= page.period;
      total = page.total ?? 0;
      const batch = page.rows ?? [];
      for (const r of batch) rows.push(toRow(r));
      if (batch.length === 0) break;
      offset += batch.length;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message.replace(/^km_readings_export:\s*/, "") : "";
    return NextResponse.json(
      { error: message || "Não foi possível ler a base consolidada de KM para exportar." },
      { status: 500 },
    );
  }

  const auditError = await logKmExport(orgId, "base", format, rows.length, payload);
  // Sem registro não há exportação.
  if (auditError) {
    return NextResponse.json({ error: "Não foi possível registrar a exportação na auditoria." }, { status: 403 });
  }

  return spreadsheetResponse({
    format,
    fileName: `km-base-${kmPeriodSlug(period, filters)}.${format}`,
    sheetName: "Base consolidada",
    headers: HEADERS,
    rows,
  });
}
