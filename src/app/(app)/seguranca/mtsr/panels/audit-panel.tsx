"use client";

import * as React from "react";
import { ChevronDown, ChevronRight, FileSpreadsheet, History, ScrollText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DateInput } from "@/components/ui/date-input";
import { SearchField } from "@/components/ui/search-field";
import { Table, TableBody, TableCell, TableContainer, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { NativeSelect } from "@/components/governance/selects";
import {
  COMPONENT_STATUS_LABEL, CONFORMITY_LABEL, CRITICALITY_LABEL, DEADLINE_LABEL, EVENT_TYPES, eventTypeLabel, fmtInt, formatDate,
  formatStamp, INSPECTION_STATUS_LABEL, MTSR_BASE_PATH, MTSR_FILTER_PARAM, REVALIDATION_LABEL, sourceTypeLabel, VERIFICATION_MODE_LABEL,
  type MtsrEvent, type MtsrEventsList,
} from "@/lib/mtsr/types";
import { mtsrFiltersQuery } from "@/lib/mtsr/url";
import type { MtsrPanelContext } from "../shared";
import { MtsrPagination, PanelEmpty, PanelError, plural, vehicleName } from "./mtsr-ui";

/**
 * MTSR → Auditoria: a trilha de eventos do módulo.
 *
 * `mtsr_events_list` pagina e filtra; a tela traduz tipo, fonte, ator e o
 * payload para texto legível — nunca JSON cru. "Detalhes" abre o payload
 * completo em chave: valor formatado.
 */
export function AuditPanel({ data, ctx }: { data: MtsrEventsList | null; ctx: MtsrPanelContext }) {
  if (ctx.error) return <PanelError ctx={ctx} title="Não foi possível carregar a auditoria do MTSR." testId="mtsr-auditoria-error" />;
  if (!data) {
    return (
      <PanelEmpty icon={<History />} title="Sem dados de auditoria" description="A rotina não devolveu a trilha. Recarregue a página." testId="mtsr-auditoria-empty" />
    );
  }
  return <AuditContent data={data} ctx={ctx} />;
}

function AuditContent({ data, ctx }: { data: MtsrEventsList; ctx: MtsrPanelContext }) {
  const [expanded, setExpanded] = React.useState<Set<string>>(() => new Set());
  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const evento = ctx.params.evento ?? "";
  const exportQs = mtsrFiltersQuery(ctx.filters, { evento: evento || null, de: ctx.params.de ?? null, ate: ctx.params.ate ?? null });
  const exportHref = `${MTSR_BASE_PATH}/export/auditoria${exportQs ? `?${exportQs}` : ""}`;
  const anyFilter = Boolean(evento || ctx.params.de || ctx.params.ate || ctx.filters.q || ctx.filters.vehicle);

  return (
    <div className="flex flex-col gap-4" data-testid="mtsr-auditoria">
      <div className="flex flex-wrap items-end gap-3" data-testid="mtsr-audit-filters">
        <label className="flex min-w-[14rem] flex-col gap-1">
          <span className="text-caption text-fg-muted">Tipo de evento</span>
          <NativeSelect fieldSize="sm" value={evento} disabled={ctx.pending} onChange={(e) => ctx.navigate({ evento: e.target.value || null, pagina: null })} data-testid="mtsr-audit-event-type">
            <option value="">Todos</option>
            {EVENT_TYPES.map((t) => (
              <option key={t} value={t}>{eventTypeLabel(t)}</option>
            ))}
          </NativeSelect>
        </label>
        <div className="flex flex-col gap-1">
          <span className="text-caption text-fg-muted">Período</span>
          <div className="flex items-center gap-1.5">
            <DateInput size="sm" aria-label="De" value={ctx.params.de ?? ""} onChange={(e) => ctx.navigate({ de: e.target.value || null, pagina: null })} wrapperClassName="w-[9.5rem]" />
            <span className="text-caption text-fg-muted">até</span>
            <DateInput size="sm" aria-label="Até" value={ctx.params.ate ?? ""} onChange={(e) => ctx.navigate({ ate: e.target.value || null, pagina: null })} wrapperClassName="w-[9.5rem]" />
          </div>
        </div>
        <label className="flex min-w-[12rem] flex-1 flex-col gap-1 sm:max-w-xs">
          <span className="text-caption text-fg-muted">Placa ou frota</span>
          <SearchField
            size="sm"
            defaultValue={ctx.filters.q ?? ""}
            placeholder="Ex.: SNT8I36"
            onKeyDown={(e) => {
              if (e.key === "Enter") ctx.navigate({ [MTSR_FILTER_PARAM.q]: (e.target as HTMLInputElement).value.trim() || null, pagina: null });
            }}
            onClear={() => ctx.navigate({ [MTSR_FILTER_PARAM.q]: null, pagina: null })}
            data-testid="mtsr-audit-search"
          />
        </label>
        <div className="ml-auto flex items-center gap-2">
          <span className="text-caption text-fg-muted tabular-nums">{fmtInt(data.total)} {plural(data.total, "evento", "eventos")}</span>
          {ctx.perms.export ? (
            <Button asChild size="sm" variant="secondary">
              <a href={exportHref} download data-testid="mtsr-audit-export">
                <FileSpreadsheet aria-hidden />
                Exportar XLSX
              </a>
            </Button>
          ) : null}
        </div>
      </div>

      {data.rows.length === 0 ? (
        <PanelEmpty
          icon={<ScrollText />}
          title="Nenhum evento na trilha"
          description={anyFilter ? "Nenhum evento corresponde aos filtros. Ajuste o tipo, o período ou a busca." : "A trilha registra cada mudança de estado, decisão sobre vistoria, vínculo de manutenção e alteração de cadastro."}
          testId="mtsr-auditoria-empty"
        />
      ) : (
        <TableContainer stickyHeader className="max-h-[70vh]" data-testid="mtsr-audit-table">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Quando</TableHead>
                <TableHead>Evento</TableHead>
                <TableHead>Placa / frota</TableHead>
                <TableHead>Componente</TableHead>
                <TableHead>Fonte</TableHead>
                <TableHead>Ator</TableHead>
                <TableHead>Motivo</TableHead>
                <TableHead>Resumo</TableHead>
                <TableHead className="sr-only">Detalhes</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.rows.map((ev) => {
                const isOpen = expanded.has(ev.id);
                const entries = payloadEntries(ev.payload);
                return (
                  <React.Fragment key={ev.id}>
                    <TableRow data-testid="mtsr-audit-row" data-event={ev.eventType}>
                      <TableCell className="whitespace-nowrap tabular-nums text-fg-secondary">{formatStamp(ev.occurredAt)}</TableCell>
                      <TableCell className="font-medium text-fg">{eventTypeLabel(ev.eventType)}</TableCell>
                      <TableCell className="whitespace-nowrap tabular-nums">{vehicleName(ev.fleetCode, ev.licensePlate)}</TableCell>
                      <TableCell className="text-fg-secondary">{ev.componentName ?? "—"}</TableCell>
                      <TableCell className="text-fg-secondary">{sourceTypeLabel(ev.sourceType ?? ev.source)}</TableCell>
                      <TableCell className="text-fg-secondary">{ev.actorName ?? "Sistema"}</TableCell>
                      <TableCell className="max-w-[18rem] text-fg-secondary">{ev.reason ?? "—"}</TableCell>
                      <TableCell className="max-w-[22rem] text-fg-secondary">{summarize(ev) ?? "—"}</TableCell>
                      <TableCell className="w-px whitespace-nowrap">
                        {entries.length > 0 ? (
                          <Button size="sm" variant="ghost" onClick={() => toggle(ev.id)} aria-expanded={isOpen} data-testid="mtsr-audit-details">
                            {isOpen ? <ChevronDown aria-hidden /> : <ChevronRight aria-hidden />}
                            Detalhes
                          </Button>
                        ) : null}
                      </TableCell>
                    </TableRow>
                    {isOpen ? (
                      <TableRow className="bg-surface-sunken/50 hover:bg-surface-sunken/50" data-testid="mtsr-audit-detail-row">
                        <TableCell colSpan={9} className="py-2">
                          <dl className="grid grid-cols-1 gap-x-6 gap-y-1.5 text-body-sm sm:grid-cols-2 lg:grid-cols-3">
                            {entries.map(([key, value]) => (
                              <div key={key} className="flex min-w-0 gap-2">
                                <dt className="shrink-0 text-fg-muted">{keyLabel(key)}:</dt>
                                <dd className="min-w-0 break-words font-medium text-fg">{value}</dd>
                              </div>
                            ))}
                          </dl>
                        </TableCell>
                      </TableRow>
                    ) : null}
                  </React.Fragment>
                );
              })}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      <MtsrPagination ctx={ctx} total={data.total} limit={data.limit} label="Paginação da auditoria" testId="mtsr-audit-pagination" />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Payload → texto
// ---------------------------------------------------------------------------
const KEY_LABEL: Record<string, string> = {
  previousStatus: "De",
  newStatus: "Para",
  status: "Situação",
  referenceDate: "Referência",
  reference: "Referência externa",
  sourceSystem: "Sistema de origem",
  sourceType: "Fonte",
  protocol: "Protocolo",
  code: "Código",
  maintenanceCode: "Manutenção",
  maintenanceId: "Manutenção (id)",
  inspectionId: "Vistoria (id)",
  inspectionItemId: "Item da vistoria (id)",
  vehicleId: "Veículo (id)",
  componentId: "Componente (id)",
  componentCode: "Código do componente",
  componentName: "Componente",
  linkType: "Tipo de vínculo",
  linkId: "Vínculo (id)",
  revalidationStatus: "Revalidação",
  applied: "Aplicados",
  skipped: "Pulados",
  skippedStale: "Pulados (leitura mais recente)",
  changed: "Alterados",
  nok: "NOK",
  nokCount: "NOK",
  itemCount: "Itens",
  evidenceCount: "Fotos",
  lastValidAdvanced: "Última vistoria válida avançou",
  effectiveFrom: "Vigência a partir de",
  effectiveTo: "Vigência até",
  conformeMaxDays: "Conforme até (dias)",
  attentionMinDays: "Atenção de (dias)",
  attentionMaxDays: "Atenção até (dias)",
  evidenceRetentionInspections: "Retenção (vistorias)",
  evidenceRetentionDays: "Retenção (dias)",
  reviewSlaDays: "SLA de validação (dias)",
  maintenanceOpenSlaDays: "SLA de abertura (dias)",
  revalidationSlaDays: "SLA de revalidação (dias)",
  verificationMode: "Modo",
  baseCriticality: "Criticidade base",
  priority: "Prioridade",
  sortOrder: "Ordem",
  isActive: "Ativo",
  isEnabled: "Habilitada",
  isAvailable: "Disponível",
  name: "Nome",
  description: "Descrição",
  note: "Nota",
  notes: "Notas",
  observation: "Observação",
  reason: "Motivo",
  actorName: "Ator",
  purged: "Expurgadas",
  removed: "Removidas",
  candidates: "Candidatas",
  total: "Total",
  rows: "Linhas",
  batchId: "Lote",
  fileName: "Arquivo",
  format: "Formato",
  duplicateJustification: "Justificativa de duplicidade",
};

const camelKey = (k: string) => k.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());
const humanize = (k: string) => {
  const spaced = k.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/_/g, " ").toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
};
const keyLabel = (k: string) => KEY_LABEL[camelKey(k)] ?? humanize(k);

const STATUS_WORDS: Record<string, string> = {
  ...COMPONENT_STATUS_LABEL,
  ...CONFORMITY_LABEL,
  ...CRITICALITY_LABEL,
  ...DEADLINE_LABEL,
  ...INSPECTION_STATUS_LABEL,
  ...REVALIDATION_LABEL,
  ...VERIFICATION_MODE_LABEL,
  active: "Ativo",
  unlinked: "Desvinculado",
  opened_from_nok: "Aberta do NOK",
  linked_existing: "Vinculada",
  import: "Importação",
  to_schedule: "Há agendar",
  scheduled: "Agendado",
  in_progress: "Em execução",
  completed: "Concluído",
  cancelled: "Cancelado",
  not_performed: "Não realizada",
  retention: "Retenção",
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_STAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Um valor do payload em texto legível (datas pt-BR, booleanos, rótulos de status). */
function formatValue(key: string, value: unknown): string {
  if (value == null) return "—";
  if (typeof value === "boolean") return value ? "Sim" : "Não";
  if (typeof value === "number") return Number.isInteger(value) ? fmtInt(value) : new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 }).format(value);
  if (typeof value === "string") {
    if (ISO_STAMP.test(value)) return formatStamp(value);
    if (ISO_DATE.test(value)) return formatDate(value);
    if (/type/i.test(key) && key !== "linkType") return eventTypeLabel(STATUS_WORDS[value] ?? sourceTypeLabel(value));
    if (STATUS_WORDS[value]) return STATUS_WORDS[value];
    if (UUID.test(value)) return value.slice(0, 8) + "…";
    return value;
  }
  if (Array.isArray(value)) return `${fmtInt(value.length)} ${value.length === 1 ? "item" : "itens"}`;
  if (typeof value === "object") {
    const inner = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v != null && typeof v !== "object")
      .slice(0, 4)
      .map(([k, v]) => `${keyLabel(k)} ${formatValue(k, v)}`);
    return inner.length ? inner.join(" · ") : "—";
  }
  return String(value);
}

function payloadEntries(payload: Record<string, unknown> | null): [string, string][] {
  if (!payload) return [];
  return Object.entries(payload)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => [k, formatValue(k, v)] as [string, string]);
}

const pick = (p: Record<string, unknown>, ...keys: string[]): unknown => {
  for (const k of keys) {
    if (p[k] != null) return p[k];
    const snake = k.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
    if (p[snake] != null) return p[snake];
  }
  return undefined;
};

/** Frase curta com o essencial do payload, por tipo de evento. */
function summarize(ev: MtsrEvent): string | null {
  const p = ev.payload;
  if (!p) return null;
  const parts: string[] = [];
  const prev = pick(p, "previousStatus");
  const next = pick(p, "newStatus", "status");
  if (prev != null && next != null) parts.push(`de ${formatValue("status", prev)} para ${formatValue("status", next)}`);
  else if (next != null && typeof next === "string" && STATUS_WORDS[next]) parts.push(STATUS_WORDS[next]);
  const ref = pick(p, "referenceDate");
  if (typeof ref === "string") parts.push(`ref. ${formatDate(ref)}`);
  const protocol = pick(p, "protocol");
  if (protocol != null) parts.push(`protocolo ${String(protocol)}`);
  const code = pick(p, "maintenanceCode", "code");
  if (code != null && !protocol) parts.push(`manutenção ${String(code)}`);
  const applied = pick(p, "applied");
  if (typeof applied === "number") {
    const skipped = pick(p, "skipped");
    const nok = pick(p, "nok", "nokCount");
    parts.push(`${fmtInt(applied)} ${applied === 1 ? "aplicado" : "aplicados"}${typeof skipped === "number" && skipped > 0 ? `, ${fmtInt(skipped)} pulados` : ""}${typeof nok === "number" ? `, ${fmtInt(nok)} NOK` : ""}`);
  }
  const linkType = pick(p, "linkType");
  if (typeof linkType === "string" && !parts.length) parts.push(STATUS_WORDS[linkType] ?? linkType);
  const reval = pick(p, "revalidationStatus");
  if (typeof reval === "string") parts.push(`revalidação: ${STATUS_WORDS[reval] ?? reval}`);
  const purged = pick(p, "purged", "removed");
  if (typeof purged === "number") parts.push(`${fmtInt(purged)} ${purged === 1 ? "foto expurgada" : "fotos expurgadas"}`);
  const effective = pick(p, "effectiveFrom");
  if (typeof effective === "string") parts.push(`vigência ${formatDate(effective)}`);
  const name = pick(p, "name", "componentName");
  if (typeof name === "string" && (ev.eventType === "COMPONENTE_ALTERADO" || ev.eventType === "FONTE_ALTERADA")) parts.push(name);
  const system = pick(p, "sourceSystem");
  if (typeof system === "string") parts.push(`origem ${system}`);
  if (parts.length) return parts.join(" · ");
  // Sem chave conhecida: as três primeiras entradas simples, em texto.
  const simple = Object.entries(p).filter(([, v]) => v != null && typeof v !== "object").slice(0, 3);
  return simple.length ? simple.map(([k, v]) => `${keyLabel(k)}: ${formatValue(k, v)}`).join(" · ") : null;
}
