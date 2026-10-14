"use client";

import * as React from "react";
import { AlertTriangle, ClipboardCheck, History, MoreHorizontal, Wrench, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { Badge } from "@/components/ui/badge";
import { Button, IconButton } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Table, TableBody, TableCell, TableContainer, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState } from "@/components/feedback/empty-state";
import { CriticalityBadge, PredictiveStatusBadge } from "@/components/maintenance/badges";
import {
  CONFORMITY_LABEL,
  formatDate,
  formatInt,
  formatKm,
  vehicleLabel,
  type PredictiveAlert,
  type PredictiveOverview,
} from "@/lib/maintenance/types";
import { ExecutionBadge, remainingDaysText, remainingKmText } from "./predictive-cycle-drawer";
import { KmStaleBadge, MonitoringBadge, ReferenceBadge, ServerPagination, pctText } from "./predictive-shared";
import type { PanelActions } from "./shared";

/**
 * Alertas e ações: os itens que pedem atenção (críticos, vencidos, a programar,
 * próximos, em inspeção inicial ou aguardando corretiva), priorizados pelo
 * servidor e AGRUPADOS POR PLACA — quem programa a oficina pensa por veículo.
 * A página vem do servidor (`alerts_page`/`alerts_page_size`).
 */
export interface PredictiveAlertsProps {
  overview: PredictiveOverview;
  page: number;
  pageSize: number;
  anyFilter: boolean;
  canVerify: boolean;
  canGenerate: boolean;
  pending: boolean;
  actions: PanelActions;
  onHistory: (cycleId: string) => void;
  onVerify: (cycleId: string) => void;
  onGenerate: (cycleId: string) => void;
  onClear: () => void;
}

interface VehicleGroup {
  vehicleId: string;
  head: PredictiveAlert;
  items: PredictiveAlert[];
}

function groupByVehicle(alerts: PredictiveAlert[]): VehicleGroup[] {
  const groups: VehicleGroup[] = [];
  const index = new Map<string, VehicleGroup>();
  for (const alert of alerts) {
    let group = index.get(alert.vehicleId);
    if (!group) {
      group = { vehicleId: alert.vehicleId, head: alert, items: [] };
      index.set(alert.vehicleId, group);
      groups.push(group);
    }
    group.items.push(alert);
  }
  return groups;
}

export function PredictiveAlerts({
  overview, page, pageSize, anyFilter, canVerify, canGenerate, pending, actions, onHistory, onVerify, onGenerate, onClear,
}: PredictiveAlertsProps) {
  const groups = React.useMemo(() => groupByVehicle(overview.alerts), [overview.alerts]);

  if (overview.alerts.length === 0) {
    return (
      <EmptyState
        variant="panel"
        size="sm"
        title="Nenhum item em alerta"
        description={
          anyFilter
            ? "Nenhum item crítico, vencido, a programar, próximo, em inspeção inicial ou aguardando corretiva corresponde aos filtros."
            : "Nenhum item crítico, vencido, a programar, próximo, em inspeção inicial ou aguardando corretiva."
        }
        action={
          anyFilter ? (
            <Button variant="secondary" size="sm" leadingIcon={<X />} onClick={onClear}>
              Limpar filtros
            </Button>
          ) : undefined
        }
      />
    );
  }

  return (
    <>
      <p className="text-caption text-fg-muted">
        {formatInt(overview.alertsTotal)} item(ns) em alerta em {formatInt(groups.length)} veículo(s) nesta página — priorizados pela
        situação técnica e, depois, pelo menor saldo de KM. Cada placa reúne os seus itens.
      </p>
      <TableContainer tabIndex={0} data-testid="maintenance-predictive-alerts">
        <Table layout="fixed" style={{ minWidth: "88rem" }}>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[17rem]">Item técnico</TableHead>
              <TableHead className="w-[11rem]">Situação técnica</TableHead>
              <TableHead className="w-[10.5rem]">Execução</TableHead>
              <TableHead className="w-[8.5rem]">Conformidade</TableHead>
              <TableHead className="w-[9rem]">Próximo marco</TableHead>
              <TableHead className="w-[10rem]">Saldo</TableHead>
              <TableHead className="w-[13rem]">Referência</TableHead>
              <TableHead className="w-[8rem]">Manutenção</TableHead>
              <TableHead className="w-[3.5rem]">
                <span className="sr-only">Ações</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {groups.map((group) => {
              const v = group.head;
              const vehicle = vehicleLabel(v.licensePlate, v.fleetCode);
              const where = [v.operationName, v.cityName, v.brCode ? `BR ${v.brCode}` : null, v.leaderName].filter(Boolean).join(" · ");
              return (
                <React.Fragment key={group.vehicleId}>
                  <TableRow className="bg-surface-secondary/70" data-testid="maintenance-predictive-alert-vehicle">
                    <TableCell colSpan={9} className="py-1.5">
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                        <span className="text-label font-semibold text-fg">
                          {v.fleetCode ?? "—"} <span className="font-normal text-fg-muted">{v.licensePlate ?? ""}</span>
                        </span>
                        <span className="text-caption text-fg-muted">{where || "Sem operação"}</span>
                        <span className="text-caption tabular-nums text-fg-muted">
                          KM {formatKm(v.currentKm)}
                          {v.currentKmDate ? ` em ${formatDate(v.currentKmDate)}` : ""}
                        </span>
                        {v.kmStale ? <KmStaleBadge /> : null}
                        <span className="ml-auto text-caption text-fg-muted">{formatInt(group.items.length)} item(ns)</span>
                      </div>
                    </TableCell>
                  </TableRow>
                  {group.items.map((a) => (
                    <TableRow key={a.cycleId} className="align-top" data-testid="maintenance-predictive-alert" data-status={a.status}>
                      <TableCell className="py-2 align-top">
                        <button
                          type="button"
                          className="block max-w-full truncate rounded-xs text-left font-medium text-link underline-offset-2 hover:underline hfm-focus-ring"
                          onClick={() => onHistory(a.cycleId)}
                          title={`${a.item} — abrir histórico`}
                        >
                          {a.item}
                        </button>
                        <p className="flex flex-wrap items-center gap-1.5 text-caption text-fg-muted" title={`${a.cluster} · ${a.planName}`}>
                          <span className="truncate">{a.cluster}</span>
                          <CriticalityBadge value={a.criticality} />
                        </p>
                      </TableCell>
                      <TableCell className="py-2 align-top">
                        <div className="flex flex-col items-start gap-1">
                          <PredictiveStatusBadge status={a.status} />
                          {a.monitoring ? <MonitoringBadge /> : null}
                        </div>
                      </TableCell>
                      <TableCell className="py-2 align-top">
                        <ExecutionBadge execution={a.execution} />
                      </TableCell>
                      <TableCell className="py-2 align-top text-fg-secondary">
                        <span className={cn("inline-flex items-center gap-1", a.conformity === "non_conforming" && "text-danger-soft-fg")}>
                          {a.conformity === "non_conforming" ? <AlertTriangle className="size-3.5" aria-hidden /> : null}
                          {CONFORMITY_LABEL[a.conformity] ?? a.conformity}
                        </span>
                      </TableCell>
                      <TableCell className="py-2 align-top tabular-nums">
                        <p className="text-fg">{a.nextKm != null ? formatKm(a.nextKm) : "—"}</p>
                        <p className="text-caption text-fg-muted">{a.nextDate ? formatDate(a.nextDate) : "sem data"}</p>
                      </TableCell>
                      <TableCell className="py-2 align-top tabular-nums">
                        <p className={cn(a.kmRemaining != null && a.kmRemaining < 0 ? "text-danger-soft-fg" : "text-fg")}>
                          {remainingKmText(a.kmRemaining)}
                        </p>
                        <p className={cn("text-caption", a.daysRemaining != null && a.daysRemaining < 0 ? "text-danger-soft-fg" : "text-fg-muted")}>
                          {remainingDaysText(a.daysRemaining)}
                          {a.pctConsumed != null ? ` · ${pctText(a.pctConsumed)} consumido` : ""}
                        </p>
                      </TableCell>
                      <TableCell className="py-2 align-top">
                        <ReferenceBadge type={a.referenceType} />
                        <p className="mt-1 truncate text-caption text-fg-muted">
                          {[a.referenceDate ? formatDate(a.referenceDate) : null, a.referenceKm != null ? formatKm(a.referenceKm) : null]
                            .filter(Boolean)
                            .join(" · ") || "—"}
                        </p>
                      </TableCell>
                      <TableCell className="py-2 align-top">
                        {a.openMaintenanceId ? (
                          <button
                            type="button"
                            className="rounded-xs font-semibold text-link underline-offset-2 hover:underline hfm-focus-ring"
                            onClick={() => actions.openMaintenance(a.openMaintenanceId!)}
                            aria-label={`Abrir a manutenção ${a.openMaintenanceCode ?? ""} de ${a.item} em ${vehicle}`}
                          >
                            {a.openMaintenanceCode ?? "Abrir"}
                          </button>
                        ) : (
                          <span className="text-fg-muted">—</span>
                        )}
                      </TableCell>
                      <TableCell className="px-1 py-1.5 align-top">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <IconButton label={`Ações de ${a.item} em ${vehicle}`} size="sm" variant="ghost" disabled={pending}>
                              <MoreHorizontal aria-hidden />
                            </IconButton>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="min-w-56">
                            <DropdownMenuLabel className="truncate">{a.item}</DropdownMenuLabel>
                            <DropdownMenuSeparator />
                            {canVerify ? (
                              <DropdownMenuItem onSelect={() => onVerify(a.cycleId)}>
                                <ClipboardCheck aria-hidden /> Registrar verificação
                              </DropdownMenuItem>
                            ) : null}
                            {canGenerate && !a.openMaintenanceId ? (
                              <DropdownMenuItem onSelect={() => onGenerate(a.cycleId)}>
                                <Wrench aria-hidden /> Gerar manutenção
                              </DropdownMenuItem>
                            ) : null}
                            <DropdownMenuItem onSelect={() => onHistory(a.cycleId)}>
                              <History aria-hidden /> Histórico do ciclo
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  ))}
                </React.Fragment>
              );
            })}
          </TableBody>
        </Table>
      </TableContainer>
      <ServerPagination page={page} pageSize={pageSize} total={overview.alertsTotal} pending={pending} actions={actions} label="Páginas dos alertas preditivos" />
      {overview.alerts.some((a) => a.kmStale) ? (
        <p className="flex items-center gap-1.5 text-caption text-fg-muted">
          <Badge size="sm" variant="warning" appearance="outline">KM desatualizado</Badge>
          KM oficial mais velho que {formatInt(overview.summary.kmMaxAgeDays)} dias: a situação continua calculada, mas é uma estimativa.
        </p>
      ) : null}
    </>
  );
}
