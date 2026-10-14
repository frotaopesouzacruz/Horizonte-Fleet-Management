"use client";

import * as React from "react";
import { RefreshCw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { FilterBar } from "@/components/ui/filter-bar";
import { Table, TableBody, TableCell, TableContainer, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState } from "@/components/feedback/empty-state";
import { useToast } from "@/components/feedback/toast";
import { NativeSelect } from "@/components/governance/selects";
import { refreshPredictiveQuality } from "@/lib/maintenance/actions";
import {
  formatInt,
  formatStamp,
  QUALITY_ISSUE_LABEL,
  SEVERITY_LABEL,
  SEVERITY_TONE,
  vehicleLabel,
  type IssueSeverity,
  type PredictiveQuality,
} from "@/lib/maintenance/types";
import { FilterField, StatTile } from "./preventive-panel";
import { ServerPagination } from "./predictive-shared";
import type { MaintenancePerms, PanelActions } from "./shared";

/**
 * Qualidade dos dados da preditiva: as inconsistências persistidas pelo motor
 * (frota sem plano, plano ambíguo, sem KM, KM desatualizado, referência no
 * futuro ou acima do KM atual, cluster sem regra, serviço sem cobertura…),
 * com severidade, veículo/ciclo e quando foram vistas pela última vez. Quem
 * pode recalcular reprocessa aqui; as resolvidas ficam no histórico.
 */
export interface PredictiveQualityPanelProps {
  quality: PredictiveQuality | null | undefined;
  page: number;
  pageSize: number;
  params: { type?: string; severity?: string; includeResolved: boolean };
  perms: MaintenancePerms;
  pending: boolean;
  actions: PanelActions;
  onOpenCycle: (cycleId: string) => void;
}

const SEVERITIES: IssueSeverity[] = ["critical", "high", "medium", "low"];

export function PredictiveQualityPanel({ quality, page, pageSize, params, perms, pending, actions, onOpenCycle }: PredictiveQualityPanelProps) {
  const { toast } = useToast();
  const [busy, startTransition] = React.useTransition();
  const set = (patch: Record<string, string | null>) => actions.navigate({ ...patch, pagina: null });

  const refresh = () =>
    startTransition(async () => {
      const result = await refreshPredictiveQuality();
      if (!result.ok || !result.data) {
        toast({ title: result.error ?? "Não foi possível reprocessar as inconsistências.", variant: "danger" });
        return;
      }
      toast({
        title: "Inconsistências reprocessadas.",
        description: `${formatInt(result.data.open)} aberta(s) · ${formatInt(result.data.resolvedNow)} resolvida(s) agora.`,
        variant: "success",
      });
      actions.refresh();
    });

  const types = Object.keys(QUALITY_ISSUE_LABEL);
  const anyFilter = Boolean(params.type || params.severity || params.includeResolved);

  return (
    <div className="flex flex-col gap-4" data-testid="maintenance-predictive-quality">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <FilterBar className="items-end gap-3" label="Filtros das inconsistências">
          <FilterField label="Tipo">
            <NativeSelect fieldSize="sm" aria-label="Tipo de inconsistência" value={params.type ?? ""} disabled={pending} onChange={(e) => set({ pd_inconsistencia: e.target.value || null })} className="min-w-[14rem]">
              <option value="">Todos</option>
              {types.map((t) => (
                <option key={t} value={t}>{QUALITY_ISSUE_LABEL[t]}{quality?.byType[t] != null ? ` (${formatInt(quality.byType[t])})` : ""}</option>
              ))}
            </NativeSelect>
          </FilterField>
          <FilterField label="Severidade">
            <NativeSelect fieldSize="sm" aria-label="Severidade" value={params.severity ?? ""} disabled={pending} onChange={(e) => set({ pd_severidade: e.target.value || null })} className="min-w-[9rem]">
              <option value="">Todas</option>
              {SEVERITIES.map((sv) => (
                <option key={sv} value={sv}>{SEVERITY_LABEL[sv]}</option>
              ))}
            </NativeSelect>
          </FilterField>
          <FilterField label="Situação">
            <NativeSelect fieldSize="sm" aria-label="Situação da inconsistência" value={params.includeResolved ? "1" : ""} disabled={pending} onChange={(e) => set({ pd_resolvidas: e.target.value || null })} className="min-w-[10rem]">
              <option value="">Só abertas</option>
              <option value="1">Abertas e resolvidas</option>
            </NativeSelect>
          </FilterField>
          {anyFilter ? (
            <Button variant="ghost" size="sm" leadingIcon={<X />} onClick={() => set({ pd_inconsistencia: null, pd_severidade: null, pd_resolvidas: null })} disabled={pending}>
              Limpar
            </Button>
          ) : null}
        </FilterBar>
        {perms.predictiveRecalculate ? (
          <Button variant="secondary" size="sm" leadingIcon={<RefreshCw />} onClick={refresh} loading={busy} disabled={pending} data-testid="maintenance-predictive-quality-refresh">
            Reprocessar inconsistências
          </Button>
        ) : null}
      </div>

      {quality ? (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            <StatTile label="Abertas" value={formatInt(quality.total)} unit="inconsistências" hint={quality.lastRun ? `última rotina ${formatStamp(quality.lastRun)}` : "rotina ainda não executada"} />
            {SEVERITIES.map((sv) => (
              <StatTile
                key={sv}
                label={SEVERITY_LABEL[sv]}
                value={formatInt(quality.bySeverity[sv] ?? 0)}
                tone={SEVERITY_TONE[sv]}
                onClick={() => set({ pd_severidade: params.severity === sv ? null : sv })}
                active={params.severity === sv}
                disabled={pending}
                testId={`maintenance-predictive-quality-${sv}`}
              />
            ))}
          </div>
          {quality.items.length === 0 ? (
            <EmptyState variant="panel" size="sm" title="Nenhuma inconsistência" description={anyFilter ? "Nenhuma inconsistência corresponde aos filtros." : "Os dados da preditiva estão consistentes no recorte."} />
          ) : (
            <>
              <TableContainer tabIndex={0}>
                <Table layout="fixed" style={{ minWidth: "72rem" }}>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[7rem]">Severidade</TableHead>
                      <TableHead className="w-[16rem]">Tipo</TableHead>
                      <TableHead className="w-[11rem]">Veículo</TableHead>
                      <TableHead className="w-[12rem]">Cluster / item</TableHead>
                      <TableHead>Mensagem</TableHead>
                      <TableHead className="w-[12rem]">Detectada · vista</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {quality.items.map((issue) => (
                      <TableRow key={issue.id} className="align-top" data-testid="maintenance-predictive-quality-row" data-type={issue.issueType}>
                        <TableCell className="py-2">
                          <StatusBadge status={SEVERITY_TONE[issue.severity] ?? "neutral"} size="sm">{SEVERITY_LABEL[issue.severity] ?? issue.severity}</StatusBadge>
                          {issue.resolvedAt ? <p className="mt-1 text-caption text-fg-muted">resolvida {formatStamp(issue.resolvedAt)}</p> : null}
                        </TableCell>
                        <TableCell className="py-2 text-body-sm text-fg">{QUALITY_ISSUE_LABEL[issue.issueType] ?? issue.issueType}</TableCell>
                        <TableCell className="py-2 text-body-sm">
                          {issue.vehicleId ? (
                            issue.cycleId ? (
                              <button type="button" className="rounded-xs font-medium text-link underline-offset-2 hover:underline hfm-focus-ring" onClick={() => onOpenCycle(issue.cycleId!)}>
                                {vehicleLabel(issue.licensePlate, issue.fleetCode)}
                              </button>
                            ) : (
                              <span className="text-fg">{vehicleLabel(issue.licensePlate, issue.fleetCode)}</span>
                            )
                          ) : (
                            <span className="text-fg-muted">—</span>
                          )}
                        </TableCell>
                        <TableCell className="py-2 text-body-sm text-fg-secondary">
                          {[issue.cluster, typeof issue.details?.item === "string" ? issue.details.item : null].filter(Boolean).join(" · ") || "—"}
                        </TableCell>
                        <TableCell className="py-2 text-body-sm text-fg">{issue.message}</TableCell>
                        <TableCell className="py-2 text-caption text-fg-muted">
                          {formatStamp(issue.detectedAt)}
                          <br />
                          {formatStamp(issue.lastSeenAt)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
              <ServerPagination page={page} pageSize={pageSize} total={quality.total} pending={pending} actions={actions} label="Páginas das inconsistências" />
            </>
          )}
        </>
      ) : (
        <EmptyState variant="panel" size="sm" title="Não foi possível carregar as inconsistências" description="Tente de novo em instantes." action={<Button size="sm" variant="secondary" onClick={actions.refresh} disabled={pending}>Tentar de novo</Button>} />
      )}
    </div>
  );
}
