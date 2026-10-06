"use client";

import * as React from "react";
import Link from "next/link";
import { ChevronDown, ChevronRight, History, ScrollText } from "lucide-react";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { DateInput } from "@/components/ui/date-input";
import { ToggleChip } from "@/components/ui/segmented-control";
import { StatusBadge, statusTone } from "@/components/ui/status-badge";
import { Table, TableBody, TableCell, TableContainer, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { NativeSelect } from "@/components/governance/selects";
import type { TiresHistorySub, TiresTabData } from "@/lib/tires/loaders";
import {
  AUDIT_ACTION_LABEL, AXLE_LABEL, CONFIDENCE_LABEL, EVENT_TONE, EVENT_TYPES, eventTypeLabel, fmtInt, fmtMm, fmtNum, fmtPsi, formatDate,
  formatStamp, INSPECTION_STATUS_LABEL, LAYOUT_SOURCE_LABEL, RESOLUTION_LABEL, SERVICE_KIND_LABEL, SIDE_LABEL, SLOT_LABEL, STATUS_LABEL,
  TIRES_TAB_LABEL, type TireAuditRow, type TireEventRow, type TiresAuditList, type TiresEventsList,
} from "@/lib/tires/types";
import type { TiresPanelContext } from "../shared";
import {
  ExportButton, FireLink, PanelEmpty, PanelError, PlateLink, plural, SubTabs, TiresPagination, vehicleName,
} from "./tires-ui";

/**
 * Gestão de Pneus → Histórico.
 *
 * Duas trilhas, cada uma com a sua permissão: os eventos de cada pneu que a
 * importação do Rodopar registrou ao comparar fotografias
 * (`tires_events_list`) e a auditoria das ações das pessoas no módulo
 * (`tires_audit_list`). As rotinas filtram e paginam; a tela traduz tipos,
 * ações e valores para texto legível — nunca JSON cru.
 */
export function HistoryPanel({ data, ctx }: { data: TiresTabData["historico"] | null; ctx: TiresPanelContext }) {
  if (ctx.error) return <PanelError ctx={ctx} title="Não foi possível carregar o histórico." testId="tires-historico-error" />;
  if (!data) {
    return (
      <PanelEmpty icon={<History />} title="Sem dados de histórico" description="A rotina não devolveu a trilha. Recarregue a página." testId="tires-historico-empty" />
    );
  }

  const items: { value: TiresHistorySub; label: string }[] = [];
  if (ctx.perms.history) items.push({ value: "eventos", label: "Eventos dos pneus" });
  if (ctx.perms.audit) items.push({ value: "auditoria", label: "Auditoria do módulo" });

  return (
    <div className="flex flex-col gap-4" data-testid="tires-historico">
      {items.length > 1 ? <SubTabs ctx={ctx} value={data.sub} items={items} label="Trilhas do histórico" testIdPrefix="tires-historico-sub" /> : null}
      {data.sub === "eventos" ? (
        data.events ? <EventsView data={data.events} ctx={ctx} /> : <Missing />
      ) : data.audit ? (
        <AuditView data={data.audit} ctx={ctx} />
      ) : (
        <Missing />
      )}
    </div>
  );
}

function Missing() {
  return (
    <PanelEmpty icon={<History />} title="Sem dados desta trilha" description="A rotina não devolveu os registros. Recarregue a página." testId="tires-historico-empty" />
  );
}

/** Período sobre a data de referência (eventos). */
function PeriodFilter({ ctx, label }: { ctx: TiresPanelContext; label: string }) {
  const from = ctx.params.de ?? "";
  const to = ctx.params.ate ?? "";
  return (
    <div className="flex flex-col gap-1">
      <span className="text-caption text-fg-muted">{label}</span>
      <div className="flex items-center gap-1.5">
        <DateInput
          size="sm"
          aria-label={`${label}: de`}
          value={from}
          max={to || undefined}
          disabled={ctx.pending}
          onChange={(e) => ctx.navigate({ de: e.target.value || null, pagina: null })}
          wrapperClassName="w-[9.5rem]"
          data-testid="tires-history-from"
        />
        <span className="text-caption text-fg-muted">até</span>
        <DateInput
          size="sm"
          aria-label={`${label}: até`}
          value={to}
          min={from || undefined}
          disabled={ctx.pending}
          onChange={(e) => ctx.navigate({ ate: e.target.value || null, pagina: null })}
          wrapperClassName="w-[9.5rem]"
          data-testid="tires-history-to"
        />
      </div>
    </div>
  );
}

function useExpanded() {
  const [expanded, setExpanded] = React.useState<Set<string>>(() => new Set());
  const toggle = React.useCallback(
    (id: string) =>
      setExpanded((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      }),
    [],
  );
  return [expanded, toggle] as const;
}

// ---------------------------------------------------------------------------
// Eventos dos pneus
// ---------------------------------------------------------------------------
const SOURCE_LABEL: Record<string, string> = { rodopar_import: "Importação Rodopar", system: "Sistema" };

function EventsView({ data, ctx }: { data: TiresEventsList; ctx: TiresPanelContext }) {
  const [expanded, toggle] = useExpanded();
  const rawTypes = ctx.params.evento ?? "";
  const selected = rawTypes.split(",").map((s) => s.trim()).filter(Boolean);
  const filtered = selected.length > 0;
  const toggleType = (type: string) => {
    const next = selected.includes(type) ? selected.filter((t) => t !== type) : EVENT_TYPES.filter((t) => t === type || selected.includes(t));
    ctx.navigate({ evento: next.length ? next.join(",") : null, pagina: null });
  };
  const anyFilter = filtered || Boolean(ctx.params.de || ctx.params.ate || ctx.filters.q || ctx.filters.vehicle);
  // Primeiro os tipos com eventos (ou os escolhidos); os demais, esmaecidos, no fim.
  const first = (t: string) => (filtered ? selected.includes(t) : (data.counts[t] ?? 0) > 0);
  const chipOrder = [...EVENT_TYPES.filter(first), ...EVENT_TYPES.filter((t) => !first(t))];
  const batchLinks = ctx.perms.import || ctx.perms.audit;

  return (
    <div className="flex flex-col gap-4" data-testid="tires-history-events">
      <p className="text-caption text-fg-muted">
        Cada evento nasce da comparação de uma fotografia oficial do Rodopar com a anterior do mesmo pneu. A vistoria de campo não gera evento.
      </p>

      <div className="flex flex-col gap-1">
        <span className="text-caption text-fg-muted" id="tires-history-type-label">Tipo de evento</span>
        <div
          className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1 sm:flex-wrap sm:overflow-visible"
          role="group"
          aria-labelledby="tires-history-type-label"
          data-testid="tires-history-types"
        >
          <ToggleChip
            pressed={!filtered}
            onPressedChange={() => ctx.navigate({ evento: null, pagina: null })}
            disabled={ctx.pending}
            data-testid="tires-history-type-all"
          >
            Todos
            {!filtered ? <span className="text-caption text-fg-muted tabular-nums">{fmtInt(data.total)}</span> : null}
          </ToggleChip>
          {chipOrder.map((type) => {
            const pressed = selected.includes(type);
            // Sem filtro de tipo a contagem cobre todos os tipos (ausente = 0);
            // com filtro, só os escolhidos têm contagem conhecida.
            const count = filtered ? (pressed ? data.counts[type] ?? 0 : null) : data.counts[type] ?? 0;
            const tone = statusTone(EVENT_TONE[type] ?? "neutral");
            return (
              <ToggleChip
                key={type}
                pressed={pressed}
                onPressedChange={() => toggleType(type)}
                disabled={ctx.pending || (!filtered && count === 0)}
                data-testid={`tires-history-type-${type}`}
              >
                <span aria-hidden className={cn("size-2 rounded-full", tone.dotClassName)} />
                {eventTypeLabel(type)}
                {count != null ? <span className="text-caption text-fg-muted tabular-nums">{fmtInt(count)}</span> : null}
              </ToggleChip>
            );
          })}
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <PeriodFilter ctx={ctx} label="Data de referência" />
        <div className="flex w-full items-center justify-between gap-2 sm:ml-auto sm:w-auto sm:justify-end">
          <span className="text-caption text-fg-muted tabular-nums" aria-live="polite" data-testid="tires-history-total">
            {fmtInt(data.total)} {plural(data.total, "evento", "eventos")}
          </span>
          <ExportButton
            ctx={ctx}
            kind="historico"
            extra={{ sub: "eventos", evento: rawTypes || null, de: ctx.params.de ?? null, ate: ctx.params.ate ?? null }}
          />
        </div>
      </div>

      {data.rows.length === 0 ? (
        <PanelEmpty
          icon={<ScrollText />}
          title="Nenhum evento"
          description={
            anyFilter
              ? "Nenhum evento corresponde ao tipo, ao período, ao veículo ou à busca."
              : "Os eventos aparecem a partir da segunda fotografia importada do Rodopar."
          }
          testId="tires-history-events-empty"
        />
      ) : (
        <TableContainer stickyHeader className="max-h-[70vh]" data-testid="tires-history-events-table">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Referência</TableHead>
                <TableHead>Nº Fogo</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead>Veículo</TableHead>
                <TableHead>Posição</TableHead>
                <TableHead>Mudanças</TableHead>
                <TableHead>Origem</TableHead>
                <TableHead><span className="sr-only">Detalhes</span></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.rows.map((ev) => {
                const isOpen = expanded.has(ev.id);
                const fields = diffFields(ev.previous, ev.current, EVENT_HIDDEN);
                return (
                  <React.Fragment key={ev.id}>
                    <TableRow data-testid="tires-history-event-row" data-event={ev.eventType}>
                      <TableCell className="whitespace-nowrap tabular-nums" title={`Registrado em ${formatStamp(ev.occurredAt)}`}>
                        {formatDate(ev.referenceDate)}
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        <FireLink tireId={ev.tireId} fireNumber={ev.fireNumber} testId="tires-history-fire" />
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        <StatusBadge status={EVENT_TONE[ev.eventType] ?? "neutral"} size="sm">{eventTypeLabel(ev.eventType)}</StatusBadge>
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        <FromTo
                          before={vehicleName(ev.previousFleetNumber, ev.previousLicensePlate) === "—" ? null : (
                            <PlateLink vehicleId={ev.previousVehicleId} plate={ev.previousLicensePlate} fleetCode={ev.previousFleetNumber} className="font-medium" />
                          )}
                          after={vehicleName(ev.fleetNumber, ev.licensePlate) === "—" ? null : (
                            <PlateLink vehicleId={ev.vehicleId} plate={ev.licensePlate} fleetCode={ev.fleetNumber} />
                          )}
                          same={
                            (ev.previousVehicleId ?? ev.previousLicensePlate ?? ev.previousFleetNumber) ===
                            (ev.vehicleId ?? ev.licensePlate ?? ev.fleetNumber)
                          }
                        />
                      </TableCell>
                      <TableCell className="whitespace-nowrap tabular-nums">
                        <FromTo
                          before={ev.previousPositionCode}
                          after={ev.positionCode}
                          same={ev.previousPositionCode === ev.positionCode}
                        />
                      </TableCell>
                      <TableCell className="min-w-[15rem] max-w-[24rem] text-fg-secondary" data-testid="tires-history-event-summary">
                        {eventSummary(ev) ?? "—"}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-fg-secondary">
                        {SOURCE_LABEL[ev.source] ?? ev.source}
                        {ev.importBatchId ? (
                          batchLinks ? (
                            <Link
                              href={`${ctx.basePath}?aba=importacao&lote=${ev.importBatchId}`}
                              className="block rounded-xs text-caption text-link underline-offset-2 hover:underline hfm-focus-ring"
                              data-testid="tires-history-batch"
                            >
                              Abrir o lote
                            </Link>
                          ) : null
                        ) : null}
                      </TableCell>
                      <TableCell className="w-px whitespace-nowrap">
                        {fields.length > 0 ? (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => toggle(ev.id)}
                            aria-expanded={isOpen}
                            aria-label={`${isOpen ? "Ocultar" : "Ver"} os valores do evento do pneu ${ev.fireNumber}`}
                            data-testid="tires-history-event-details"
                          >
                            {isOpen ? <ChevronDown aria-hidden /> : <ChevronRight aria-hidden />}
                            Valores
                          </Button>
                        ) : null}
                      </TableCell>
                    </TableRow>
                    {isOpen ? (
                      <TableRow className="bg-surface-sunken/50 hover:bg-surface-sunken/50" data-testid="tires-history-event-detail-row">
                        <TableCell colSpan={8} className="py-3">
                          <ValuesList fields={fields} beforeLabel="Fotografia anterior" afterLabel="Esta fotografia" />
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

      <TiresPagination ctx={ctx} total={data.total} limit={data.limit} label="Paginação dos eventos" testId="tires-history-pagination" />
    </div>
  );
}

/** "antes → depois"; quando não mudou, só o valor. */
function FromTo({ before, after, same }: { before: React.ReactNode; after: React.ReactNode; same: boolean }) {
  if (same || before == null) return <>{after ?? <span className="text-fg-muted">—</span>}</>;
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="text-fg-secondary">{before}</span>
      <span aria-hidden className="text-fg-muted">→</span>
      <span className="sr-only">para</span>
      {after ?? <span className="text-fg-muted">—</span>}
    </span>
  );
}

/** Chaves que o próprio evento já mostra em colunas (veículo e posição). */
const EVENT_HIDDEN = new Set(["licensePlate", "fleetNumber", "positionCode"]);

/** O que cada tipo de evento muda, na ordem em que se lê. */
const EVENT_KEYS: Record<string, string[]> = {
  TIRE_MEASURED: ["treadMin", "measurementDate", "tread1", "tread2", "tread3", "tread4"],
  TIRE_PRESSURE_UPDATED: ["psi", "calibrationDate"],
  TIRE_LIFE_CHANGED: ["life", "rubber", "drawing"],
  TIRE_STATUS_CHANGED: ["status"],
  TIRE_RETURNED_TO_STOCK: ["status"],
  TIRE_SENT_TO_RETREAD: ["status"],
  TIRE_DISCARDED: ["status"],
  TIRE_REMOVED: ["status"],
  TIRE_MOVED: ["status"],
  TIRE_POSITION_CHANGED: ["status"],
  TIRE_IMPORTED: ["brand", "model", "dimension", "dot", "drawing", "rubber", "serialNumber"],
};

/** Frase curta com as mudanças do evento (chaves conhecidas, com rótulo e unidade). */
function eventSummary(ev: TireEventRow): string | null {
  const prev = ev.previous ?? {};
  const cur = ev.current ?? {};
  if (ev.eventType === "TIRE_CREATED" || ev.eventType === "TIRE_REAPPEARED") {
    const parts: string[] = [];
    if (cur.status != null) parts.push(formatValue("status", cur.status));
    if (cur.life != null) parts.push(`Vida ${formatValue("life", cur.life)}`);
    if (cur.treadMin != null) parts.push(`Sulco mín. ${formatValue("treadMin", cur.treadMin)}`);
    if (cur.psi != null) parts.push(formatValue("psi", cur.psi));
    return parts.length ? parts.join(" · ") : null;
  }
  if (ev.eventType === "TIRE_ABSENT") {
    return prev.status != null ? `Última situação: ${formatValue("status", prev.status)}` : "Ausente no relatório desta data";
  }
  const changed = (k: string) => !sameValue(prev[k], cur[k]) && (prev[k] != null || cur[k] != null);
  let keys = (EVENT_KEYS[ev.eventType] ?? []).filter(changed);
  // Com o sulco mínimo já na frase, os quatro sulcos ficam no detalhe.
  if (keys.includes("treadMin")) keys = keys.filter((k) => !/^tread[1-4]$/.test(k));
  if (keys.length === 0) {
    keys = Object.keys({ ...prev, ...cur }).filter((k) => !EVENT_HIDDEN.has(k) && changed(k));
    keys.sort(byKeyOrder);
  }
  if (keys.length === 0) return null;
  const shown = keys.slice(0, 3).map((k) => `${SHORT_LABEL[k] ?? keyLabel(k)} ${changeText(k, prev[k], cur[k])}`);
  return keys.length > 3 ? `${shown.join(" · ")} · +${keys.length - 3}` : shown.join(" · ");
}

/** Rótulos curtos para a frase do evento. */
const SHORT_LABEL: Record<string, string> = {
  treadMin: "Sulco mín.",
  tread1: "S1",
  tread2: "S2",
  tread3: "S3",
  tread4: "S4",
  measurementDate: "Medição",
  calibrationDate: "Calibragem",
  psi: "PSI",
  status: "Situação",
  life: "Vida",
};

/** "4,69 → 4,09 mm": a unidade uma vez só quando os dois lados são números. */
function changeText(key: string, before: unknown, after: unknown): string {
  const unit = key === "treadMin" || /^tread[1-4]$/.test(key) ? " mm" : key === "psi" ? " PSI" : null;
  if (unit && typeof before === "number" && typeof after === "number") return `${fmtNum(before)} → ${fmtNum(after)}${unit}`;
  return `${formatValue(key, before)} → ${formatValue(key, after)}`;
}

// ---------------------------------------------------------------------------
// Auditoria
// ---------------------------------------------------------------------------
const ENTITY_LABEL: Record<string, string> = {
  tire_import_batch: "Lote de importação",
  tire_inspection: "Vistoria",
  tire_repair: "Conserto",
  tire_parameter_set: "Parâmetros",
  tire_pressure_rule: "Regra de PSI",
  tire_position: "Posição",
  tire_layout: "Layout",
  vehicle_type: "Tipo de equipamento",
  vehicle: "Veículo",
  maintenance_service: "Serviço da Manutenção",
  export: "Exportação",
};

/** Ação completa ("import.confirmed") → o que aconteceu, em texto. */
const ACTION_DETAIL: Record<string, string> = {
  "import.confirmed": "Fotografia confirmada",
  "import.cancelled": "Lote descartado",
  "repair.created": "Conserto registrado",
  "repair.updated": "Conserto alterado",
  "repair.voided": "Conserto cancelado",
  "parameters.saved": "Parâmetros salvos",
  "pressure_rule.created": "Regra de PSI criada",
  "pressure_rule.updated": "Regra de PSI alterada",
  "position.saved": "Posição salva",
  "layout.saved": "Layout salvo",
  "layout.vehicle_type": "Layout padrão do tipo de equipamento",
  "layout.vehicle": "Layout do veículo",
  "service_kind.saved": "Mapeamento de serviço salvo",
};

function actionText(action: string): { area: string; detail: string } {
  const dot = action.indexOf(".");
  const prefix = dot >= 0 ? action.slice(0, dot) : action;
  const suffix = dot >= 0 ? action.slice(dot + 1) : "";
  const area = AUDIT_ACTION_LABEL[prefix] ?? prefix;
  if (ACTION_DETAIL[action]) return { area, detail: ACTION_DETAIL[action] };
  if (prefix === "inspection" && suffix in INSPECTION_STATUS_LABEL) {
    return { area, detail: `Para “${INSPECTION_STATUS_LABEL[suffix as keyof typeof INSPECTION_STATUS_LABEL]}”` };
  }
  if (prefix === "export") return { area, detail: TIRES_TAB_LABEL[suffix as keyof typeof TIRES_TAB_LABEL] ?? suffix };
  return { area, detail: suffix || area };
}

/** O resumo gravado pela rotina, com os códigos de situação da vistoria em texto. */
const STATUS_CODE = /\b(pendente_revisao|pendente_rodopar|sincronizado_rodopar|retornar_divergencia|substituida)\b/g;
const readableSummary = (s: string | null) =>
  s
    ? s.replace(STATUS_CODE, (m) => {
        const label = INSPECTION_STATUS_LABEL[m as keyof typeof INSPECTION_STATUS_LABEL] ?? m;
        return label.charAt(0).toLowerCase() + label.slice(1);
      })
    : null;

/** Link para a entidade quando ela tem tela no módulo. */
function entityHref(row: TireAuditRow, basePath: string): string | null {
  if (!row.entityId) return null;
  if (row.entityType === "tire_inspection") return `${basePath}?aba=vistorias&fase=todas&vistoria=${row.entityId}`;
  if (row.entityType === "tire_import_batch") return `${basePath}?aba=importacao&lote=${row.entityId}`;
  return null;
}

const AUDIT_HIDDEN = new Set(["organizationId"]);

function AuditView({ data, ctx }: { data: TiresAuditList; ctx: TiresPanelContext }) {
  const [expanded, toggle] = useExpanded();
  const action = ctx.params.acao ?? "";
  const anyFilter = Boolean(action || ctx.filters.q);
  const actions = action && !data.actions.includes(action) ? [...data.actions, action] : data.actions;

  return (
    <div className="flex flex-col gap-4" data-testid="tires-history-audit">
      <p className="text-caption text-fg-muted">
        Quem fez o quê no módulo: importações, decisões sobre vistorias, consertos, parâmetros, layouts e exportações — sempre com a pessoa autenticada como autora.
      </p>
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex w-full min-w-[14rem] flex-col gap-1 sm:w-auto">
          <span className="text-caption text-fg-muted">Ação</span>
          <NativeSelect
            fieldSize="sm"
            value={action}
            disabled={ctx.pending}
            onChange={(e) => ctx.navigate({ acao: e.target.value || null, pagina: null })}
            data-testid="tires-audit-action"
          >
            <option value="">Todas</option>
            {actions.map((a) => (
              <option key={a} value={a}>{AUDIT_ACTION_LABEL[a] ?? a}</option>
            ))}
          </NativeSelect>
        </label>
        <div className="flex w-full items-center justify-between gap-2 sm:ml-auto sm:w-auto sm:justify-end">
          <span className="text-caption text-fg-muted tabular-nums" aria-live="polite" data-testid="tires-audit-total">
            {fmtInt(data.total)} {plural(data.total, "registro", "registros")}
          </span>
          <ExportButton ctx={ctx} kind="historico" extra={{ sub: "auditoria", acao: action || null }} testId="tires-export-auditoria" />
        </div>
      </div>

      {data.rows.length === 0 ? (
        <PanelEmpty
          icon={<ScrollText />}
          title="Nenhum registro na auditoria"
          description={
            anyFilter
              ? "Nenhum registro corresponde à ação ou à busca."
              : "A auditoria registra cada importação, decisão sobre vistoria, conserto, parâmetro, layout e exportação."
          }
          testId="tires-history-audit-empty"
        />
      ) : (
        <TableContainer stickyHeader className="max-h-[70vh]" data-testid="tires-audit-table">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Quando</TableHead>
                <TableHead>Autor</TableHead>
                <TableHead>Ação</TableHead>
                <TableHead>Entidade</TableHead>
                <TableHead>Resumo</TableHead>
                <TableHead><span className="sr-only">Valores</span></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.rows.map((row) => {
                const isOpen = expanded.has(row.id);
                const fields = diffFields(row.previousValues, row.currentValues, AUDIT_HIDDEN);
                const { area, detail } = actionText(row.action);
                const href = entityHref(row, ctx.basePath);
                return (
                  <React.Fragment key={row.id}>
                    <TableRow data-testid="tires-audit-row" data-action={row.action}>
                      <TableCell className="whitespace-nowrap tabular-nums text-fg-secondary">{formatStamp(row.createdAt)}</TableCell>
                      <TableCell className="max-w-[10rem] truncate text-fg-secondary" title={row.actorName ?? undefined}>{row.actorName ?? "—"}</TableCell>
                      <TableCell className="min-w-[12rem]">
                        <span className="block text-caption text-fg-muted">{area}</span>
                        <span className="font-medium text-fg">{detail}</span>
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-fg-secondary">
                        {ENTITY_LABEL[row.entityType] ?? row.entityType}
                        {href ? (
                          <Link href={href} className="block rounded-xs text-caption text-link underline-offset-2 hover:underline hfm-focus-ring" data-testid="tires-audit-entity">
                            Abrir
                          </Link>
                        ) : null}
                      </TableCell>
                      <TableCell className="min-w-[15rem] max-w-[34rem] text-fg-secondary">{readableSummary(row.summary) ?? "—"}</TableCell>
                      <TableCell className="w-px whitespace-nowrap">
                        {fields.length > 0 ? (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => toggle(row.id)}
                            aria-expanded={isOpen}
                            aria-label={`${isOpen ? "Ocultar" : "Ver"} os valores do registro de ${formatStamp(row.createdAt)}`}
                            data-testid="tires-audit-details"
                          >
                            {isOpen ? <ChevronDown aria-hidden /> : <ChevronRight aria-hidden />}
                            Valores
                          </Button>
                        ) : null}
                      </TableCell>
                    </TableRow>
                    {isOpen ? (
                      <TableRow className="bg-surface-sunken/50 hover:bg-surface-sunken/50" data-testid="tires-audit-detail-row">
                        <TableCell colSpan={6} className="py-3">
                          <ValuesList fields={fields} beforeLabel="Antes" afterLabel="Depois" />
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

      <TiresPagination ctx={ctx} total={data.total} limit={data.limit} label="Paginação da auditoria" testId="tires-audit-pagination" />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Valores anteriores × atuais → lista legível
// ---------------------------------------------------------------------------
interface Field {
  key: string;
  before: unknown;
  after: unknown;
  changed: boolean;
}

function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a == null || b == null) return a == null && b == null;
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Ordem de leitura das chaves mais comuns; as demais vêm depois, em ordem alfabética. */
const KEY_ORDER = [
  "status", "reason", "note", "notes", "fireNumberSnapshot", "licensePlate", "licensePlateSnapshot", "fleetNumber", "fleetCodeSnapshot",
  "positionCode", "positionCodeSnapshot", "life", "treadMin", "tread1", "tread2", "tread3", "tread4", "measurementDate", "psi",
  "calibrationDate", "brand", "model", "dimension", "dot", "drawing", "rubber", "serialNumber", "repairType", "serviceDate",
  "serviceOrderNumber", "supplierNameSnapshot", "vehicleResolution", "resolutionConfidence", "resolutionReferenceDate", "overrideReason",
  "voidReason", "referenceDate", "fileName", "snapshots", "newTires", "events", "absent", "reconciliation", "kind", "rows", "filters",
  "code", "name", "label", "description", "effectiveFrom", "effectiveTo", "validFrom", "validTo",
];
const byKeyOrder = (a: string, b: string) => {
  const ia = KEY_ORDER.indexOf(a);
  const ib = KEY_ORDER.indexOf(b);
  if (ia >= 0 || ib >= 0) return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib);
  return a.localeCompare(b);
};

function diffFields(
  before: Record<string, unknown> | null | undefined,
  after: Record<string, unknown> | null | undefined,
  hidden: Set<string>,
): Field[] {
  const b = before ?? {};
  const a = after ?? {};
  const keys = Object.keys({ ...b, ...a }).filter((k) => !hidden.has(k) && (b[k] != null || a[k] != null));
  keys.sort(byKeyOrder);
  const hasBefore = Object.keys(b).length > 0;
  return keys.map((key) => ({ key, before: b[key], after: a[key], changed: hasBefore && !sameValue(b[key], a[key]) }));
}

/** Lista chave → valor; com valores anteriores, as duas colunas e as mudanças em destaque. */
function ValuesList({ fields, beforeLabel, afterLabel }: { fields: Field[]; beforeLabel: string; afterLabel: string }) {
  const withBefore = fields.some((f) => f.before != null);
  const withAfter = fields.some((f) => f.after != null);
  const changed = fields.filter((f) => f.changed).length;
  return (
    <div className="flex flex-col gap-2">
      {withBefore && withAfter ? (
        <p className="text-caption text-fg-muted">
          {changed > 0 ? `${fmtInt(changed)} ${plural(changed, "campo alterado", "campos alterados")} (em destaque).` : "Nenhum campo alterado."}
        </p>
      ) : null}
      <dl className="grid grid-cols-1 gap-x-6 gap-y-1.5 text-body-sm md:grid-cols-2">
        {fields.map((f) => (
          <div key={f.key} className={cn("flex min-w-0 flex-wrap gap-x-2", f.changed && "rounded-xs bg-warning-soft px-1.5 py-0.5")} data-changed={f.changed || undefined}>
            <dt className="shrink-0 text-fg-muted">{keyLabel(f.key)}:</dt>
            <dd className="min-w-0 break-words text-fg">
              {withBefore && withAfter ? (
                f.changed ? (
                  <>
                    <span className="text-fg-secondary line-through decoration-fg-muted/60" title={beforeLabel}>{formatValue(f.key, f.before)}</span>
                    <span aria-hidden className="mx-1 text-fg-muted">→</span>
                    <span className="sr-only"> ({beforeLabel}), {afterLabel}: </span>
                    <span className="font-medium">{formatValue(f.key, f.after)}</span>
                  </>
                ) : (
                  <span>{formatValue(f.key, f.after ?? f.before)}</span>
                )
              ) : (
                <span className="font-medium">{formatValue(f.key, withAfter ? f.after : f.before)}</span>
              )}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

const KEY_LABEL: Record<string, string> = {
  status: "Situação",
  reason: "Motivo",
  note: "Nota",
  notes: "Observações",
  life: "Vida",
  treadMin: "Sulco mínimo",
  tread1: "Sulco 1",
  tread2: "Sulco 2",
  tread3: "Sulco 3",
  tread4: "Sulco 4",
  measurementDate: "Data da medição",
  psi: "PSI",
  calibrationDate: "Data da calibragem",
  brand: "Marca",
  model: "Modelo",
  dimension: "Dimensão",
  dimensionKey: "Dimensão (chave)",
  dot: "DOT",
  drawing: "Desenho",
  rubber: "Borracha",
  serialNumber: "Nº de série",
  licensePlate: "Placa",
  fleetNumber: "Frota",
  positionCode: "Posição",
  id: "Registro (id)",
  tireId: "Pneu (id)",
  vehicleId: "Veículo (id)",
  vehicleTypeId: "Tipo de equipamento (id)",
  serviceId: "Serviço (id)",
  supplierId: "Fornecedor (id)",
  layoutId: "Layout (id)",
  fireNumberSnapshot: "Nº Fogo",
  licensePlateSnapshot: "Placa",
  fleetCodeSnapshot: "Frota",
  positionCodeSnapshot: "Posição",
  supplierNameSnapshot: "Fornecedor",
  repairType: "Tipo de conserto",
  serviceDate: "Data do serviço",
  serviceOrderNumber: "OS",
  vehicleResolution: "Veículo resolvido por",
  resolutionReferenceDate: "Fotografia usada",
  resolutionConfidence: "Confiança",
  overrideReason: "Justificativa da troca de veículo",
  voidReason: "Motivo do cancelamento",
  voidedAt: "Cancelado em",
  voidedBy: "Cancelado por (id)",
  createdAt: "Criado em",
  createdBy: "Criado por (id)",
  createdByName: "Criado por",
  updatedAt: "Alterado em",
  updatedBy: "Alterado por (id)",
  fileName: "Arquivo",
  fileHash: "Hash do arquivo",
  referenceDate: "Data da fotografia",
  snapshots: "Pneus na fotografia",
  newTires: "Pneus novos",
  events: "Eventos",
  absent: "Ausentes",
  reconciliation: "Conciliação das vistorias",
  synced: "Sincronizadas",
  checked: "Verificadas",
  pending: "Aguardando",
  persistent: "Persistentes",
  kind: "Tipo",
  filters: "Filtros",
  rows: "Linhas",
  code: "Código",
  name: "Nome",
  label: "Rótulo",
  description: "Descrição",
  axleGroup: "Eixo",
  axleIndex: "Nº do eixo",
  side: "Lado",
  slot: "Rodado",
  sortOrder: "Ordem",
  aliases: "Outros códigos",
  positionCodes: "Posições",
  isActive: "Ativo",
  effectiveFrom: "Vigência a partir de",
  effectiveTo: "Vigência até",
  validFrom: "Válida a partir de",
  validTo: "Válida até",
  minPsi: "PSI mínimo",
  idealPsi: "PSI ideal",
  maxPsi: "PSI máximo",
  minLegalTreadMm: "Sulco legal (mm)",
  attentionTreadMm: "Sulco de atenção (mm)",
  measurementOkDays: "Medição em dia até (dias)",
  measurementWarningDays: "Medição em alerta até (dias)",
  calibrationOkDays: "Calibragem em dia até (dias)",
  calibrationWarningDays: "Calibragem em alerta até (dias)",
  treadCriticalMm: "Sulco crítico (mm)",
  treadAttentionMm: "Sulco de atenção (mm)",
  maxValidTreadMm: "Sulco máximo válido (mm)",
  maxValidPsi: "PSI máximo válido",
  futureDateToleranceDays: "Tolerância de data futura (dias)",
  treadMinDivergenceToleranceMm: "Tolerância do sulco mínimo (mm)",
  inspectionTreadToleranceMm: "Tolerância de sulco na vistoria (mm)",
  inspectionPsiTolerance: "Tolerância de PSI na vistoria",
  staleUpdateDays: "Cadastro desatualizado após (dias)",
  reviewSlaDays: "SLA de revisão (dias)",
  rodoparSyncSlaDays: "SLA de sincronização (dias)",
  repairResolutionMaxAgeDays: "Idade máxima da fotografia no conserto (dias)",
  retreadAlertUseRodoparCondition: "Alerta de ressolagem pela condição Rodopar",
  retreadAlertTreadMm: "Alerta de ressolagem por sulco (mm)",
  layoutSource: "Origem do layout",
};

const humanize = (k: string) => {
  const spaced = k.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/_/g, " ").toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
};
const keyLabel = (k: string) => KEY_LABEL[k] ?? humanize(k);

/** Rótulos dos códigos por chave (situação, resolução, eixo…). */
const VALUE_WORDS: Record<string, Record<string, string>> = {
  status: { ...STATUS_LABEL, ...INSPECTION_STATUS_LABEL, active: "Ativo", voided: "Cancelado" },
  vehicleResolution: RESOLUTION_LABEL,
  resolutionConfidence: CONFIDENCE_LABEL,
  kind: { ...SERVICE_KIND_LABEL, ...TIRES_TAB_LABEL },
  axleGroup: AXLE_LABEL,
  side: SIDE_LABEL,
  slot: SLOT_LABEL,
  layoutSource: LAYOUT_SOURCE_LABEL,
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_STAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HASH = /^[0-9a-f]{40,}$/i;

/** Um valor em texto legível (unidades, datas pt-BR, rótulos, ids encurtados). */
function formatValue(key: string, value: unknown): string {
  if (value == null || value === "") return "—";
  if (typeof value === "boolean") return value ? "Sim" : "Não";
  if (typeof value === "number") {
    if (key === "treadMin" || /^tread[1-4]$/.test(key)) return fmtMm(value);
    if (key === "psi") return fmtPsi(value);
    return Number.isInteger(value) ? fmtInt(value) : fmtNum(value);
  }
  if (typeof value === "string") {
    const words = VALUE_WORDS[key];
    if (words?.[value]) return words[value];
    if (ISO_STAMP.test(value)) return formatStamp(value);
    if (ISO_DATE.test(value)) return formatDate(value);
    if (UUID.test(value)) return `${value.slice(0, 8)}…`;
    if (HASH.test(value)) return `${value.slice(0, 12)}…`;
    return value;
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return "—";
    if (value.every((v) => typeof v !== "object" || v == null)) return value.map((v) => formatValue(key, v)).join(", ");
    return `${fmtInt(value.length)} ${plural(value.length, "item", "itens")}`;
  }
  if (typeof value === "object") {
    const inner = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v != null && v !== "" && !(Array.isArray(v) && v.length === 0))
      .map(([k, v]) => `${keyLabel(k)} ${formatValue(k, v)}`);
    return inner.length ? inner.join(" · ") : "—";
  }
  return String(value);
}
