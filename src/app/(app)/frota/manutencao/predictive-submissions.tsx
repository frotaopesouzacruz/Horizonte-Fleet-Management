"use client";

import * as React from "react";
import { AlertTriangle, RotateCw, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { FilterBar } from "@/components/ui/filter-bar";
import { Table, TableBody, TableCell, TableContainer, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Alert, AlertDescription } from "@/components/feedback/alert";
import { EmptyState } from "@/components/feedback/empty-state";
import { Skeleton } from "@/components/feedback/skeleton";
import { NativeSelect } from "@/components/governance/selects";
import { CriticalityBadge, MaintenanceStatusBadge, VerificationResultBadge } from "@/components/maintenance/badges";
import { loadPredictiveSubmissionDetail } from "@/lib/maintenance/actions";
import {
  DECISION_LABEL,
  formatDate,
  formatInt,
  formatKm,
  formatStamp,
  KM_STATUS_LABEL,
  VERIFICATION_RESULT_LABEL,
  VERIFICATION_SOURCE_LABEL,
  vehicleLabel,
  type KmStatus,
  type PredictiveSubmissionDetail,
  type PredictiveSubmissionSearch,
  type PredictiveVerificationSearch,
  type VerificationResult,
} from "@/lib/maintenance/types";
import { FilterField, StatTile } from "./preventive-panel";
import { ServerPagination, ViewButton } from "./predictive-shared";
import type { PanelActions } from "./shared";

/**
 * Verificações do app: os envios do aplicativo "Verificação Preditiva de
 * Frota" (protocolo VPF, responsável, KM informado × oficial, totais por
 * resultado, corretivas abertas) e a busca de todas as verificações formais
 * (portal e app). O detalhe do envio mostra item a item o que o campo
 * respondeu e a decisão que o servidor tomou.
 */
export interface PredictiveSubmissionsPanelProps {
  submissions: PredictiveSubmissionSearch | null | undefined;
  verifications: PredictiveVerificationSearch | null | undefined;
  list: "envios" | "verificacoes";
  page: number;
  pageSize: number;
  params: { result?: string; source?: string; onlyNc: boolean };
  pending: boolean;
  actions: PanelActions;
  onOpenCycle: (cycleId: string) => void;
}

const RESULTS: VerificationResult[] = ["conforming", "monitor", "non_conforming", "not_performed"];

export function PredictiveSubmissionsPanel({ submissions, verifications, list, page, pageSize, params, pending, actions, onOpenCycle }: PredictiveSubmissionsPanelProps) {
  const [detailId, setDetailId] = React.useState<string | null>(null);
  const set = (patch: Record<string, string | null>) => actions.navigate({ ...patch, pagina: null });

  return (
    <div className="flex flex-col gap-4" data-testid="maintenance-predictive-submissions">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div role="group" aria-label="Lista" className="inline-flex max-w-full flex-wrap gap-1 rounded-md border border-border bg-surface-secondary p-0.5">
          <ViewButton pressed={list === "envios"} disabled={pending} onClick={() => set({ pd_lista: null })} testId="maintenance-predictive-list-submissions">
            Envios do aplicativo {submissions ? <span className="tabular-nums text-fg-muted">({formatInt(submissions.total)})</span> : null}
          </ViewButton>
          <ViewButton pressed={list === "verificacoes"} disabled={pending} onClick={() => set({ pd_lista: "verificacoes" })} testId="maintenance-predictive-list-verifications">
            Todas as verificações {verifications ? <span className="tabular-nums text-fg-muted">({formatInt(verifications.total)})</span> : null}
          </ViewButton>
        </div>
        <FilterBar className="items-end gap-3" label="Filtros das verificações">
          {list === "verificacoes" ? (
            <>
              <FilterField label="Resultado">
                <NativeSelect fieldSize="sm" aria-label="Resultado" value={params.result ?? ""} disabled={pending} onChange={(e) => set({ pd_resultado: e.target.value || null })} className="min-w-[10rem]">
                  <option value="">Todos</option>
                  {RESULTS.map((r) => (
                    <option key={r} value={r}>{VERIFICATION_RESULT_LABEL[r]}</option>
                  ))}
                </NativeSelect>
              </FilterField>
              <FilterField label="Origem">
                <NativeSelect fieldSize="sm" aria-label="Origem" value={params.source ?? ""} disabled={pending} onChange={(e) => set({ pd_origem: e.target.value || null })} className="min-w-[9rem]">
                  <option value="">Todas</option>
                  {Object.entries(VERIFICATION_SOURCE_LABEL).map(([code, label]) => (
                    <option key={code} value={code}>{label}</option>
                  ))}
                </NativeSelect>
              </FilterField>
            </>
          ) : (
            <FilterField label="Envios">
              <NativeSelect fieldSize="sm" aria-label="Envios" value={params.onlyNc ? "1" : ""} disabled={pending} onChange={(e) => set({ pd_so_nc: e.target.value || null })} className="min-w-[12rem]">
                <option value="">Todos</option>
                <option value="1">Só com não conformidade</option>
              </NativeSelect>
            </FilterField>
          )}
          {params.result || params.source || params.onlyNc ? (
            <Button variant="ghost" size="sm" leadingIcon={<X />} onClick={() => set({ pd_resultado: null, pd_origem: null, pd_so_nc: null })} disabled={pending}>
              Limpar
            </Button>
          ) : null}
        </FilterBar>
      </div>

      {list === "verificacoes" && verifications ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatTile label="Conformes" value={formatInt(verifications.summary.conforming)} tone="success" />
          <StatTile label="Monitoramento" value={formatInt(verifications.summary.monitor)} tone="warning" />
          <StatTile label="Não conformes" value={formatInt(verifications.summary.nonConforming)} tone="danger" />
          <StatTile label="Não realizadas" value={formatInt(verifications.summary.notPerformed)} tone="neutral" />
        </div>
      ) : null}

      {list === "envios" ? (
        !submissions ? (
          <EmptyState variant="panel" size="sm" title="Não foi possível carregar os envios" action={<Button size="sm" variant="secondary" onClick={actions.refresh} disabled={pending}>Tentar de novo</Button>} />
        ) : submissions.items.length === 0 ? (
          <EmptyState variant="panel" size="sm" title="Nenhum envio do aplicativo" description="As verificações enviadas pelo app Verificação Preditiva de Frota aparecem aqui com o protocolo." />
        ) : (
          <>
            <TableContainer tabIndex={0}>
              <Table layout="fixed" style={{ minWidth: "80rem" }}>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[11rem]">Protocolo</TableHead>
                    <TableHead className="w-[11rem]">Veículo</TableHead>
                    <TableHead className="w-[14rem]">Responsável</TableHead>
                    <TableHead className="w-[14rem]">Operação · local</TableHead>
                    <TableHead className="w-[12rem]">KM informado × oficial</TableHead>
                    <TableHead>Resultado</TableHead>
                    <TableHead className="w-[7rem]">Corretivas</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {submissions.items.map((s) => (
                    <TableRow key={s.id} className="align-top" data-testid="maintenance-predictive-submission">
                      <TableCell className="py-2">
                        <button type="button" className="rounded-xs font-mono text-body-sm font-semibold text-link underline-offset-2 hover:underline hfm-focus-ring" onClick={() => setDetailId(s.id)}>
                          {s.protocol}
                        </button>
                        <p className="text-caption text-fg-muted">{formatDate(s.verifiedOn)}</p>
                      </TableCell>
                      <TableCell className="py-2 text-body-sm text-fg">{vehicleLabel(s.licensePlate, s.fleetCode)}</TableCell>
                      <TableCell className="py-2 text-body-sm text-fg-secondary">{s.inspector ?? "—"}</TableCell>
                      <TableCell className="py-2 text-body-sm text-fg-secondary">{[s.operationName, s.cityName].filter(Boolean).join(" · ") || "—"}</TableCell>
                      <TableCell className="py-2 text-body-sm tabular-nums">
                        <span className="text-fg">{s.kmInformed != null ? formatKm(s.kmInformed) : "—"}</span>
                        <span className="text-fg-muted"> × {s.kmOfficial != null ? formatKm(s.kmOfficial) : "—"}</span>
                        {s.kmDivergent ? <Badge size="sm" variant="warning" appearance="soft" className="ml-1">divergente</Badge> : null}
                      </TableCell>
                      <TableCell className="py-2">
                        <div className="flex flex-wrap gap-1">
                          <Badge size="sm" variant="success" appearance="soft">{formatInt(s.totalConforming)} conf.</Badge>
                          {s.totalMonitoring > 0 ? <Badge size="sm" variant="warning" appearance="soft">{formatInt(s.totalMonitoring)} monit.</Badge> : null}
                          {s.totalNonConforming > 0 ? <Badge size="sm" variant="danger" appearance="soft">{formatInt(s.totalNonConforming)} NC</Badge> : null}
                          {s.totalNotPerformed > 0 ? <Badge size="sm" variant="neutral" appearance="soft">{formatInt(s.totalNotPerformed)} não realiz.</Badge> : null}
                        </div>
                      </TableCell>
                      <TableCell className="py-2 text-body-sm tabular-nums text-fg">{formatInt(s.maintenancesOpened)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
            <ServerPagination page={page} pageSize={pageSize} total={submissions.total} pending={pending} actions={actions} label="Páginas dos envios" />
          </>
        )
      ) : !verifications ? (
        <EmptyState variant="panel" size="sm" title="Não foi possível carregar as verificações" action={<Button size="sm" variant="secondary" onClick={actions.refresh} disabled={pending}>Tentar de novo</Button>} />
      ) : verifications.items.length === 0 ? (
        <EmptyState variant="panel" size="sm" title="Nenhuma verificação" description="Nenhuma verificação formal corresponde aos filtros." />
      ) : (
        <>
          <TableContainer tabIndex={0}>
            <Table layout="fixed" style={{ minWidth: "84rem" }}>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[7rem]">Data</TableHead>
                  <TableHead className="w-[11rem]">Veículo</TableHead>
                  <TableHead className="w-[15rem]">Item · cluster</TableHead>
                  <TableHead className="w-[9rem]">Resultado</TableHead>
                  <TableHead className="w-[12rem]">Decisão</TableHead>
                  <TableHead className="w-[9rem]">KM</TableHead>
                  <TableHead className="w-[12rem]">Responsável</TableHead>
                  <TableHead className="w-[8rem]">Origem</TableHead>
                  <TableHead>Observações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {verifications.items.map((row) => (
                  <TableRow key={row.id} className="align-top" data-testid="maintenance-predictive-verification-row">
                    <TableCell className="py-2 text-body-sm tabular-nums text-fg-secondary">{formatDate(row.verifiedOn)}</TableCell>
                    <TableCell className="py-2 text-body-sm">
                      <button type="button" className="rounded-xs text-left font-medium text-link underline-offset-2 hover:underline hfm-focus-ring" onClick={() => onOpenCycle(row.cycleId)}>
                        {vehicleLabel(row.licensePlate, row.fleetCode)}
                      </button>
                    </TableCell>
                    <TableCell className="py-2 text-body-sm">
                      <span className="block truncate text-fg">{row.item}</span>
                      <span className="block truncate text-caption text-fg-muted">{row.cluster}</span>
                    </TableCell>
                    <TableCell className="py-2"><VerificationResultBadge result={row.result} /></TableCell>
                    <TableCell className="py-2 text-body-sm text-fg-secondary">{DECISION_LABEL[row.decision] ?? row.decision}</TableCell>
                    <TableCell className="py-2 text-body-sm tabular-nums">
                      {row.km != null ? formatKm(row.km) : "—"}
                      {row.kmSource ? <span className="block text-caption text-fg-muted">{KM_STATUS_LABEL[row.kmSource as KmStatus] ?? (row.kmSource === "informed" ? "Informado" : row.kmSource)}</span> : null}
                    </TableCell>
                    <TableCell className="py-2 text-body-sm text-fg-secondary">{row.responsible ?? "—"}</TableCell>
                    <TableCell className="py-2">
                      <Badge size="sm" variant="neutral" appearance="outline">{VERIFICATION_SOURCE_LABEL[row.source] ?? row.source}</Badge>
                      {row.protocol ? <span className="mt-1 block font-mono text-caption text-fg-muted">{row.protocol}</span> : null}
                    </TableCell>
                    <TableCell className="py-2 text-caption text-fg-secondary">
                      {row.notes ?? "—"}
                      {row.maintenanceCode ? <span className="block text-fg-muted">Manutenção {row.maintenanceCode}</span> : null}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
          <ServerPagination page={page} pageSize={pageSize} total={verifications.total} pending={pending} actions={actions} label="Páginas das verificações" />
        </>
      )}

      <SubmissionDetailDialog submissionId={detailId} onOpenChange={(open) => { if (!open) setDetailId(null); }} onOpenMaintenance={actions.openMaintenance} onOpenCycle={onOpenCycle} />
    </div>
  );
}

export function SubmissionDetailDialog({
  submissionId, onOpenChange, onOpenMaintenance, onOpenCycle,
}: {
  submissionId: string | null;
  onOpenChange: (open: boolean) => void;
  onOpenMaintenance?: (id: string) => void;
  onOpenCycle?: (cycleId: string) => void;
}) {
  return (
    <Dialog open={Boolean(submissionId)} onOpenChange={onOpenChange}>
      <DialogContent size="lg" data-testid="maintenance-predictive-submission-dialog">
        {submissionId ? <SubmissionDetailBody key={submissionId} submissionId={submissionId} onOpenChange={onOpenChange} onOpenMaintenance={onOpenMaintenance} onOpenCycle={onOpenCycle} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function SubmissionDetailBody({
  submissionId, onOpenChange, onOpenMaintenance, onOpenCycle,
}: {
  submissionId: string;
  onOpenChange: (open: boolean) => void;
  onOpenMaintenance?: (id: string) => void;
  onOpenCycle?: (cycleId: string) => void;
}) {
  const [state, setState] = React.useState<{ key: string; data: PredictiveSubmissionDetail | null; error: string | null } | null>(null);
  const [nonce, setNonce] = React.useState(0);
  const key = `${submissionId}#${nonce}`;
  React.useEffect(() => {
    let alive = true;
    loadPredictiveSubmissionDetail(submissionId)
      .then((r) => {
        if (!alive) return;
        if (!r.ok) setState({ key, data: null, error: r.error ?? "Não foi possível carregar o envio." });
        else if (!r.data) setState({ key, data: null, error: "Envio não encontrado ou fora do seu acesso." });
        else setState({ key, data: r.data, error: null });
      })
      .catch(() => alive && setState({ key, data: null, error: "Não foi possível carregar o envio." }));
    return () => {
      alive = false;
    };
  }, [submissionId, key]);
  const loading = state?.key !== key;
  const d = state?.data ?? null;

  return (
    <>
      <DialogHeader>
        <DialogTitle>Envio {d?.protocol ?? ""}</DialogTitle>
        <DialogDescription>
          {d ? `${vehicleLabel(d.licensePlate, d.fleetCode)} · ${formatDate(d.verifiedOn)} · ${d.inspector.name}` : "Verificação enviada pelo aplicativo"}
        </DialogDescription>
      </DialogHeader>
      <DialogBody className="flex flex-col gap-4" aria-busy={loading}>
        {loading && !d ? <Skeleton className="h-40 w-full" /> : null}
        {state?.error ? (
          <Alert variant="danger" action={<Button size="sm" variant="outline" leadingIcon={<RotateCw />} onClick={() => setNonce((n) => n + 1)}>Tentar de novo</Button>}>
            <AlertDescription>{state.error}</AlertDescription>
          </Alert>
        ) : null}
        {d ? (
          <>
            <dl className="grid grid-cols-2 gap-3 rounded-md border border-border p-3 text-body-sm sm:grid-cols-3">
              <Field label="Operação">{[d.operationName, d.cityName && d.stateUf ? `${d.cityName}/${d.stateUf}` : d.cityName].filter(Boolean).join(" · ") || "—"}</Field>
              <Field label="BR · liderança">{[d.brCode ? `BR ${d.brCode}` : null, d.leaderName].filter(Boolean).join(" · ") || "—"}</Field>
              <Field label="Tipo">{d.vehicleTypeName ?? "—"}</Field>
              <Field label="KM informado">{d.km.informed != null ? formatKm(d.km.informed) : "não informado"}</Field>
              <Field label="KM oficial">{d.km.official != null ? `${formatKm(d.km.official)}${d.km.officialDate ? ` (${formatDate(d.km.officialDate)})` : ""}` : "sem leitura"}</Field>
              <Field label="Divergência">
                {d.km.divergent ? (
                  <span className="inline-flex items-center gap-1 text-warning-soft-fg"><AlertTriangle className="size-3.5" aria-hidden /> justificada</span>
                ) : (
                  "dentro da tolerância"
                )}
              </Field>
              {d.km.justification ? <Field label="Justificativa do KM" wide>{d.km.justification}</Field> : null}
              {d.generalObservation ? <Field label="Observação geral" wide>{d.generalObservation}</Field> : null}
              <Field label="Enviado em">{formatStamp(d.createdAt)}</Field>
            </dl>
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
              <StatTile label="Itens" value={formatInt(d.totals.items)} />
              <StatTile label="Conformes" value={formatInt(d.totals.conforming)} tone="success" />
              <StatTile label="Monitor." value={formatInt(d.totals.monitoring)} tone="warning" />
              <StatTile label="NC" value={formatInt(d.totals.nonConforming)} tone="danger" />
              <StatTile label="Não realiz." value={formatInt(d.totals.notPerformed)} />
              <StatTile label="Corretivas" value={formatInt(d.totals.maintenancesOpened)} tone="info" />
            </div>
            <ul className="flex flex-col gap-2">
              {d.items.map((item) => (
                <li key={item.verificationId} className="flex flex-col gap-1.5 rounded-sm border border-border bg-surface-secondary p-2.5 text-body-sm" data-testid="maintenance-predictive-submission-item">
                  <div className="flex flex-wrap items-center gap-2">
                    {onOpenCycle ? (
                      <button type="button" className="rounded-xs font-medium text-link underline-offset-2 hover:underline hfm-focus-ring" onClick={() => { onOpenChange(false); onOpenCycle(item.cycleId); }}>
                        {item.itemName}
                      </button>
                    ) : (
                      <span className="font-medium text-fg">{item.itemName}</span>
                    )}
                    <span className="text-caption text-fg-muted">{item.clusterName}</span>
                    <CriticalityBadge value={item.criticality} />
                    <span className="ml-auto flex items-center gap-2">
                      <VerificationResultBadge result={item.result} />
                      <span className="text-caption text-fg-secondary">{DECISION_LABEL[item.decision] ?? item.decision}</span>
                    </span>
                  </div>
                  <p className="text-caption text-fg-secondary">
                    KM {item.km != null ? formatKm(item.km) : "—"}
                    {item.monitorKm != null || item.monitorDays != null
                      ? ` · monitorar por ${[item.monitorKm != null ? formatKm(item.monitorKm) : null, item.monitorDays != null ? `${formatInt(item.monitorDays)} dias` : null].filter(Boolean).join(" ou ")}`
                      : ""}
                  </p>
                  {item.notes ? <p className="whitespace-pre-line text-fg">{item.notes}</p> : null}
                  {item.checklist.length > 0 ? (
                    <ul className="flex flex-col gap-0.5 border-t border-border-subtle pt-1.5">
                      {item.checklist.map((a) => (
                        <li key={a.key} className="flex items-start justify-between gap-3 text-caption">
                          <span className="min-w-0 text-fg-secondary">{a.key}</span>
                          <span className="shrink-0 font-medium text-fg">{a.answer}</span>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  {item.maintenance ? (
                    <p className="flex flex-wrap items-center gap-2 text-caption">
                      <span className="text-fg-muted">Manutenção</span>
                      {onOpenMaintenance ? (
                        <button type="button" className="rounded-xs font-semibold text-link underline-offset-2 hover:underline hfm-focus-ring" onClick={() => { onOpenChange(false); onOpenMaintenance(item.maintenance!.id); }}>
                          {item.maintenance.code}
                        </button>
                      ) : (
                        <span className="font-semibold text-fg">{item.maintenance.code}</span>
                      )}
                      <MaintenanceStatusBadge status={item.maintenance.status} />
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>
          </>
        ) : null}
      </DialogBody>
      <DialogFooter>
        <Button onClick={() => onOpenChange(false)}>Fechar</Button>
      </DialogFooter>
    </>
  );
}

function Field({ label, children, wide = false }: { label: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className={wide ? "col-span-full flex min-w-0 flex-col gap-0.5" : "flex min-w-0 flex-col gap-0.5"}>
      <dt className="text-caption text-fg-muted">{label}</dt>
      <dd className="text-body-sm text-fg">{children}</dd>
    </div>
  );
}
