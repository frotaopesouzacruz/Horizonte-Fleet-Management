import { NextResponse, type NextRequest } from "next/server";
import { requireOrganization } from "@/lib/auth/session";
import { getMtsrEvents } from "@/lib/mtsr/queries";
import {
  componentStatusLabel,
  eventTypeLabel,
  formatDate,
  INGESTION_REASON_LABEL,
  sourceTypeLabel,
  type MtsrEventsList,
} from "@/lib/mtsr/types";
import { firstParam, mtsrFiltersPayload, parseMtsrFilters } from "@/lib/mtsr/url";
import type { Json } from "@/types/database.types";
import { dataSheet, excelStamp, newWorkbook, NUM, xlsxResponse, type XCol } from "@/app/(app)/frota/km/relatorio/xlsx-kit";
import { logMtsrExport } from "../export-log";
import { fileSlug, filterLine, generatedLine, readAllPages, snapshotLine, todayIso } from "../shared";

/**
 * Auditoria do MTSR (XLSX) — `mtsr_events_list` com os mesmos filtros da aba
 * (evento, período, veículos, busca), lida página a página até o total. Uma
 * linha por evento, com o payload resumido em texto legível (nunca JSON cru).
 * Registrada antes de sair — a própria exportação vira um evento EXPORTACAO.
 */
export const maxDuration = 60;

const PAGE = 500;
const list = (v: string | undefined) => (v ?? "").split(",").map((s) => s.trim()).filter(Boolean);

export async function GET(request: NextRequest) {
  const { session, organization } = await requireOrganization("mtsr.export");
  const orgId = organization.organizationId;
  const params = Object.fromEntries(request.nextUrl.searchParams.entries());
  const filters = parseMtsrFilters(params);
  const fleet = mtsrFiltersPayload(filters);

  const f: Record<string, Json> = {};
  const types = list(firstParam(params, "evento"));
  if (types.length) f.event_types = types;
  if (fleet.vehicle_ids) f.vehicle_ids = fleet.vehicle_ids;
  const from = firstParam(params, "de");
  const to = firstParam(params, "ate");
  if (from) f.date_from = from;
  if (to) f.date_to = to;
  if (filters.q) f.search = filters.q;

  let rows: MtsrEventsList["rows"];
  try {
    rows = (await readAllPages((limit, offset) => getMtsrEvents(orgId, f, limit, offset), PAGE)).rows;
  } catch (error) {
    const message = error instanceof Error ? error.message.replace(/^mtsr_[a-z_]+:\s*/, "") : "";
    return NextResponse.json({ error: message || "Não foi possível ler a auditoria do MTSR." }, { status: 500 });
  }

  const auditError = await logMtsrExport(orgId, "auditoria", "xlsx", rows.length, f);
  if (auditError) {
    return NextResponse.json({ error: "Não foi possível registrar a exportação na auditoria." }, { status: 403 });
  }

  const parts: string[] = [];
  if (types.length) parts.push(`Evento: ${types.map(eventTypeLabel).join(", ")}`);
  if (from || to) parts.push(`Período: ${from ? formatDate(from) : "—"} a ${to ? formatDate(to) : "—"}`);
  if (fleet.vehicle_ids) parts.push(`Veículos: ${(fleet.vehicle_ids as string[]).length} selecionado(s)`);
  if (filters.q) parts.push(`Busca: ${filters.q}`);

  const today = todayIso();
  const cols: XCol[] = [
    { header: "Quando", width: 16, numFmt: NUM.stamp },
    { header: "Evento", width: 30 },
    { header: "Placa", width: 11 },
    { header: "Frota", width: 12 },
    { header: "Componente", width: 22 },
    { header: "Fonte", width: 20 },
    { header: "Ator", width: 26 },
    { header: "Motivo", width: 36 },
    { header: "Resumo", width: 90 },
  ];

  const wb = newWorkbook();
  dataSheet(
    wb,
    "Auditoria",
    "Auditoria do MTSR",
    [snapshotLine(today), filterLine(parts, "nenhum (todos os eventos visíveis)"), generatedLine(session.displayName, organization.organizationName)],
    cols,
    rows.map((e) => [
      excelStamp(e.occurredAt),
      eventTypeLabel(e.eventType),
      e.licensePlate ?? null,
      e.fleetCode ?? null,
      e.componentName,
      e.sourceType ? sourceTypeLabel(e.sourceType) : EVENT_SOURCE_LABEL[e.source] ?? e.source,
      e.actorName,
      e.reason,
      summarizePayload(e.payload),
    ]),
    {
      freezeCols: 2,
      note: "Trilha append-only de mtsr_events: quem fez o quê, quando e por qual fonte. O resumo traduz o conteúdo registrado; detalhes completos ficam na ficha do veículo.",
    },
  );

  return xlsxResponse(wb, `mtsr-auditoria-${fileSlug(today)}.xlsx`);
}

/** Origem do evento (`mtsr_events.source`) quando a linha não traz a fonte do componente. */
const EVENT_SOURCE_LABEL: Record<string, string> = {
  user: "Usuário",
  system: "Sistema",
  import: "Importação",
  integration: "Integração",
};

const KEY_LABEL: Record<string, string> = {
  status: "status",
  previous_status: "status anterior",
  from: "de",
  to: "para",
  result: "resultado",
  reference_date: "data de referência",
  inspection_date: "data da vistoria",
  changed: "mudou",
  observation: "observação",
  component: "componente",
  protocol: "protocolo",
  item_count: "itens",
  nok_count: "NOK",
  nok: "NOK",
  evidence_count: "fotos",
  applied: "aplicados",
  skipped_backoffice: "ignorados (backoffice)",
  skipped_stale: "ignorados (leitura antiga)",
  last_valid_advanced: "última vistoria avançou",
  maintenance_code: "manutenção",
  maintenance_status: "situação da manutenção",
  priority: "prioridade",
  exit_date: "saída",
  requires_revalidation: "exige revalidação",
  note: "nota",
  reason: "motivo",
  source: "fonte",
  file_name: "arquivo",
  ignored: "ignorados",
  conflict: "conflitos",
  rejected: "rejeitados",
  duplicate: "duplicados",
  rows: "linhas",
  facts: "datas de vistoria",
  kind: "tipo",
  format: "formato",
  row_count: "linhas",
  count: "quantidade",
  effective_from: "vigência a partir de",
  services: "serviços",
  operation_id: "operação",
  batch_id: "lote",
};
const STATUS_KEYS = new Set(["status", "previous_status", "from", "to", "result"]);
const DATE_KEYS = new Set(["reference_date", "inspection_date", "exit_date", "effective_from"]);
const HIDDEN_KEYS = new Set(["link_id", "service_ids", "filters", "component_sources", "maintenance_id", "batch_id", "operation_id"]);
const PRIORITY_LABEL: Record<string, string> = { critical: "Crítica", high: "Alta", medium: "Média", low: "Baixa" };

/**
 * Payload do evento em texto: "rótulo: valor · rótulo: valor". Objetos
 * antes/depois viram a lista dos campos alterados; listas viram contagem.
 */
function summarizePayload(payload: Record<string, unknown> | null): string | null {
  if (!payload) return null;
  const parts: string[] = [];
  const before = isObject(payload.before) ? payload.before : null;
  const after = isObject(payload.after) ? payload.after : null;
  if (after) {
    const changed = before
      ? Object.keys(after).filter((k) => JSON.stringify(before[k]) !== JSON.stringify(after[k]))
      : Object.keys(after);
    parts.push(before ? (changed.length ? `campos alterados: ${changed.join(", ")}` : "sem alteração de campos") : `registro criado (${changed.length} campos)`);
  }
  for (const [key, raw] of Object.entries(payload)) {
    if (key === "before" || key === "after" || HIDDEN_KEYS.has(key) || raw === null || raw === undefined || raw === "") continue;
    const label = KEY_LABEL[key] ?? key.replace(/_/g, " ");
    const value = valueText(key, raw);
    if (value !== null) parts.push(`${label}: ${value}`);
  }
  return parts.length ? parts.join(" · ") : null;
}

function valueText(key: string, raw: unknown): string | null {
  if (typeof raw === "boolean") return raw ? "sim" : "não";
  if (typeof raw === "number") return raw.toLocaleString("pt-BR");
  if (typeof raw === "string") {
    if (STATUS_KEYS.has(key)) return componentStatusLabel(raw);
    if (DATE_KEYS.has(key)) return formatDate(raw);
    if (key === "reason") return INGESTION_REASON_LABEL[raw] ?? raw;
    if (key === "priority") return PRIORITY_LABEL[raw] ?? raw;
    if (key === "source") return sourceTypeLabel(raw);
    return raw;
  }
  if (Array.isArray(raw)) return `${raw.length} item(ns)`;
  if (isObject(raw)) return `${Object.keys(raw).length} campo(s)`;
  return null;
}

const isObject = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === "object" && !Array.isArray(v);
