"use client";

import * as React from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { FilterBar, FilterChip } from "@/components/ui/filter-bar";
import { Table, TableBody, TableCell, TableContainer, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState } from "@/components/feedback/empty-state";
import { NativeSelect } from "@/components/governance/selects";
import { PredictiveStatusBadge, VerificationResultBadge } from "@/components/maintenance/badges";
import {
  formatKm,
  formatInt,
  formatStamp,
  PREDICTIVE_EVENT_LABEL,
  PREDICTIVE_EVENT_SOURCE_LABEL,
  REFERENCE_TYPE_LABEL,
  vehicleLabel,
  type PredictiveEvents,
} from "@/lib/maintenance/types";
import { FilterField } from "./preventive-panel";
import { ServerPagination } from "./predictive-shared";
import type { PanelActions } from "./shared";

/**
 * Auditoria da preditiva: a linha do tempo imutável dos ciclos — criação,
 * referência pelo histórico, verificações, monitoramento, manutenções geradas e
 * reinícios, baixas manuais, mudanças de situação e versões de plano — com
 * quem fez (ou a rotina), por onde (portal, aplicativo, rotina, importação) e
 * os valores de antes e depois.
 */
export interface PredictiveAuditPanelProps {
  events: PredictiveEvents | null | undefined;
  page: number;
  pageSize: number;
  params: { type?: string; cycle?: string; vehicleLabel?: string | null };
  pending: boolean;
  actions: PanelActions;
  onOpenCycle: (cycleId: string) => void;
}

function detailText(e: PredictiveEvents["items"][number]): string {
  const d = e.details ?? {};
  const parts: string[] = [];
  if (e.fromStatus || e.toStatus) parts.push(`${e.fromStatus ?? "—"} → ${e.toStatus ?? "—"}`);
  if (typeof d.decision === "string") parts.push(`decisão: ${d.decision}`);
  if (typeof d.reason === "string") parts.push(`motivo: ${d.reason}`);
  if (typeof d.code === "string") parts.push(`manutenção ${d.code}`);
  if (d.monitor_km != null) parts.push(`alvo ${formatKm(Number(d.monitor_km))}`);
  if (d.monitor_days != null) parts.push(`${formatInt(Number(d.monitor_days))} dias`);
  if (d.from_version != null && d.to_version != null) parts.push(`v${d.from_version} → v${d.to_version}`);
  if (e.coverage) parts.push(`cobertura ${e.coverage === "full" ? "total" : e.coverage === "partial" ? "parcial" : e.coverage}`);
  return parts.join(" · ");
}

export function PredictiveAuditPanel({ events, page, pageSize, params, pending, actions, onOpenCycle }: PredictiveAuditPanelProps) {
  const set = (patch: Record<string, string | null>) => actions.navigate({ ...patch, pagina: null });
  const anyFilter = Boolean(params.type || params.cycle);

  return (
    <div className="flex flex-col gap-4" data-testid="maintenance-predictive-audit">
      <FilterBar className="items-end gap-3" label="Filtros da auditoria">
        <FilterField label="Evento">
          <NativeSelect fieldSize="sm" aria-label="Tipo de evento" value={params.type ?? ""} disabled={pending} onChange={(e) => set({ pd_evento: e.target.value || null })} className="min-w-[14rem]">
            <option value="">Todos</option>
            {Object.entries(PREDICTIVE_EVENT_LABEL).map(([code, label]) => (
              <option key={code} value={code}>{label}</option>
            ))}
          </NativeSelect>
        </FilterField>
        {params.cycle ? <FilterChip label="Ciclo" value={params.vehicleLabel ?? "selecionado"} onRemove={() => set({ ciclo: null })} disabled={pending} /> : null}
        {anyFilter ? (
          <Button variant="ghost" size="sm" leadingIcon={<X />} onClick={() => set({ pd_evento: null, ciclo: null })} disabled={pending}>
            Limpar
          </Button>
        ) : null}
        <p className="ml-auto self-center text-caption text-fg-muted">Período, veículo e operação seguem os filtros da aba.</p>
      </FilterBar>

      {!events ? (
        <EmptyState variant="panel" size="sm" title="Não foi possível carregar a auditoria" description="Tente de novo em instantes." action={<Button size="sm" variant="secondary" onClick={actions.refresh} disabled={pending}>Tentar de novo</Button>} />
      ) : events.items.length === 0 ? (
        <EmptyState variant="panel" size="sm" title="Nenhum evento" description="Nenhum evento preditivo corresponde aos filtros." />
      ) : (
        <>
          <TableContainer tabIndex={0}>
            <Table layout="fixed" style={{ minWidth: "84rem" }}>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[10rem]">Quando</TableHead>
                  <TableHead className="w-[14rem]">Evento</TableHead>
                  <TableHead className="w-[11rem]">Veículo</TableHead>
                  <TableHead className="w-[14rem]">Item · cluster</TableHead>
                  <TableHead className="w-[8rem]">Resultado</TableHead>
                  <TableHead className="w-[8rem]">KM</TableHead>
                  <TableHead>Detalhes</TableHead>
                  <TableHead className="w-[12rem]">Autor · origem</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {events.items.map((e) => (
                  <TableRow key={e.id} className="align-top" data-testid="maintenance-predictive-event" data-type={e.eventType}>
                    <TableCell className="py-2 text-caption text-fg-secondary tabular-nums">{formatStamp(e.occurredAt)}</TableCell>
                    <TableCell className="py-2 text-body-sm font-medium text-fg">{PREDICTIVE_EVENT_LABEL[e.eventType] ?? e.eventType}</TableCell>
                    <TableCell className="py-2 text-body-sm">
                      <button type="button" className="rounded-xs text-left font-medium text-link underline-offset-2 hover:underline hfm-focus-ring" onClick={() => onOpenCycle(e.cycleId)}>
                        {vehicleLabel(e.licensePlate, e.fleetCode)}
                      </button>
                    </TableCell>
                    <TableCell className="py-2 text-body-sm text-fg-secondary">
                      <span className="block truncate text-fg">{e.item ?? "—"}</span>
                      <span className="block truncate text-caption">{e.cluster ?? ""}</span>
                    </TableCell>
                    <TableCell className="py-2">
                      {e.result ? <VerificationResultBadge result={e.result} /> : e.toStatus ? <PredictiveStatusBadge status={e.toStatus} /> : <span className="text-fg-muted">—</span>}
                    </TableCell>
                    <TableCell className="py-2 text-body-sm tabular-nums text-fg-secondary">{e.km != null ? formatKm(e.km) : "—"}</TableCell>
                    <TableCell className="py-2 text-caption text-fg-secondary">
                      {detailText(e) || (e.referenceType ? `referência: ${REFERENCE_TYPE_LABEL[e.referenceType] ?? e.referenceType}` : "—")}
                      {e.maintenanceId ? (
                        <>
                          {" · "}
                          <button type="button" className="rounded-xs font-medium text-link underline-offset-2 hover:underline hfm-focus-ring" onClick={() => actions.openMaintenance(e.maintenanceId!)}>
                            abrir manutenção
                          </button>
                        </>
                      ) : null}
                    </TableCell>
                    <TableCell className="py-2 text-caption text-fg-secondary">
                      <span className="block truncate text-fg">{e.actorName ?? "—"}</span>
                      <Badge size="sm" variant="neutral" appearance="outline">{PREDICTIVE_EVENT_SOURCE_LABEL[e.source] ?? e.source}</Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
          <ServerPagination page={page} pageSize={pageSize} total={events.total} pending={pending} actions={actions} label="Páginas da auditoria preditiva" />
        </>
      )}
    </div>
  );
}
