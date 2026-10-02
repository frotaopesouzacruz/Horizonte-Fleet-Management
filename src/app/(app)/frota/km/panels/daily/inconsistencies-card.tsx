"use client";

import * as React from "react";
import { ChevronDown, ChevronRight, History } from "lucide-react";
import { cn } from "@/lib/cn";
import { ChartCard } from "@/components/charts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  Table, TableBody, TableCell, TableContainer, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import type { KmDailyInconsistency } from "@/lib/km/daily";
import {
  fmt2, fmtInt, KM_ALERT_LABEL, KM_STATUS, kmStatusLabel, kmStatusTone, type KmAlert, type KmReadingStatus,
} from "@/lib/km/types";
import type { KmPanelContext } from "../../shared";
import { statusToneOf, vehicleName, VehicleRef } from "../overview/km-ui";

const signed2 = (v: number | null | undefined) => (v == null ? "—" : `${v > 0 ? "+" : v < 0 ? "−" : ""}${fmt2(Math.abs(v))}`);
const alertLabel = (a: string) => KM_ALERT_LABEL[a as KmAlert] ?? kmStatusLabel(a);

/**
 * Inconsistências do dia, com o mesmo critério do indicador (a rotina garante
 * a paridade). Cada linha abre os hodômetros, o KM informado × calculado, a
 * diferença, os alertas e a situação — e leva ao Histórico por frota.
 */
export function InconsistenciesCard({ rows, ctx }: { rows: KmDailyInconsistency[]; ctx: KmPanelContext }) {
  const [open, setOpen] = React.useState<Set<string>>(() => new Set());
  const baseId = React.useId();
  const toggle = (key: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  const COLS = 6;

  return (
    <ChartCard
      id="km-diaria-inconsistencias"
      title={`Inconsistências do dia (${fmtInt(rows.length)})`}
      description="Inconsistente, divergência de KM, pendente de análise, alta rodagem ou alertas de hodômetro/cadastro. Abra a linha para ver os hodômetros e o cálculo."
      empty={rows.length === 0 ? "Sem inconsistências neste dia." : undefined}
      className="scroll-mt-4"
      data-testid="km-diaria-inconsistencies"
    >
      <TableContainer>
        <Table>
          <caption className="sr-only">Inconsistências do dia</caption>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10"><span className="sr-only">Detalhes</span></TableHead>
              <TableHead>Veículo</TableHead>
              <TableHead>Situação</TableHead>
              <TableHead>Alertas</TableHead>
              <TableHead numeric>Diferença (km)</TableHead>
              <TableHead>Local · BR</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r, i) => {
              const key = r.readingId ?? `${r.vehicleId}-${i}`;
              const expanded = open.has(key);
              const detailId = `${baseId}-${i}`;
              const alerts = r.alerts ?? [];
              const statusMeta = KM_STATUS[r.status as KmReadingStatus];
              return (
                <React.Fragment key={key}>
                  <TableRow data-testid="km-diaria-inconsistency-row" data-state={expanded ? "selected" : undefined}>
                    <TableCell className="px-2">
                      <button
                        type="button"
                        onClick={() => toggle(key)}
                        aria-expanded={expanded}
                        aria-controls={detailId}
                        aria-label={`${expanded ? "Ocultar" : "Ver"} detalhes de ${vehicleName(r.fleetCode, r.plate)}`}
                        className="inline-flex size-7 items-center justify-center rounded-xs text-fg-secondary hfm-transition hover:bg-secondary hover:text-fg hfm-focus-ring"
                        data-testid="km-diaria-inconsistency-toggle"
                      >
                        {expanded ? <ChevronDown className="size-4" aria-hidden /> : <ChevronRight className="size-4" aria-hidden />}
                      </button>
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      <VehicleRef ctx={ctx} vehicleId={r.vehicleId} fleetCode={r.fleetCode} plate={r.plate} />
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      <StatusBadge size="sm" status={statusToneOf(kmStatusTone(r.status))}>
                        {kmStatusLabel(r.status)}
                      </StatusBadge>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {alerts.length > 0
                          ? alerts.map((a) => (
                              <Badge key={a} size="sm" variant="warning" appearance="outline">
                                {alertLabel(a)}
                              </Badge>
                            ))
                          : <span className="text-fg-muted">—</span>}
                      </div>
                    </TableCell>
                    <TableCell numeric className="whitespace-nowrap">{signed2(r.diff)}</TableCell>
                    <TableCell className="max-w-48 truncate text-fg-secondary">
                      {[r.local, r.br].filter(Boolean).join(" · ") || "—"}
                    </TableCell>
                  </TableRow>
                  <TableRow
                    id={detailId}
                    hidden={!expanded}
                    className="bg-surface-sunken hover:bg-surface-sunken"
                    data-testid="km-diaria-inconsistency-detail"
                  >
                    <TableCell colSpan={COLS} className="px-4 py-3">
                      {expanded ? (
                        <div className="flex flex-col gap-3">
                          <dl className="grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-3 lg:grid-cols-6">
                            <Fact label="Hodômetro inicial" value={fmt2(r.odometerStart)} />
                            <Fact label="Hodômetro final" value={fmt2(r.odometerEnd)} />
                            <Fact label="KM informado" value={fmt2(r.kmInformed)} />
                            <Fact label="KM calculado" value={fmt2(r.kmCalculated)} />
                            <Fact label="Diferença (informado − calculado)" value={signed2(r.diff)} />
                            <Fact
                              label="Tipo · modelo"
                              value={[r.type, r.model].filter(Boolean).join(" · ") || "—"}
                            />
                          </dl>
                          <div className="flex flex-col gap-1 text-body-sm">
                            <p>
                              <span className="font-medium text-fg">Situação: </span>
                              <span className="text-fg-secondary">
                                {kmStatusLabel(r.status)}
                                {statusMeta ? ` — ${statusMeta.description}` : ""}
                              </span>
                            </p>
                            <p>
                              <span className="font-medium text-fg">Alertas: </span>
                              <span className="text-fg-secondary">
                                {alerts.length > 0 ? alerts.map(alertLabel).join(", ") : "nenhum"}
                              </span>
                            </p>
                          </div>
                          {ctx.perms.history ? (
                            <div>
                              <Button
                                variant="outline"
                                size="sm"
                                leadingIcon={<History aria-hidden />}
                                onClick={() => ctx.navigate({ aba: "historico", veiculo: r.vehicleId })}
                                data-testid="km-diaria-inconsistency-history"
                              >
                                Abrir histórico
                              </Button>
                            </div>
                          ) : null}
                        </div>
                      ) : null}
                    </TableCell>
                  </TableRow>
                </React.Fragment>
              );
            })}
          </TableBody>
        </Table>
      </TableContainer>
    </ChartCard>
  );
}

function Fact({ label, value, className }: { label: string; value: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-0.5", className)}>
      <dt className="text-caption text-fg-muted">{label}</dt>
      <dd className="text-body-sm font-medium tabular-nums text-fg">{value}</dd>
    </div>
  );
}
