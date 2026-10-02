"use client";

import * as React from "react";
import { PencilLine } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/ui/status-badge";
import { CheckboxField } from "@/components/ui/checkbox";
import {
  Table, TableBody, TableCell, TableContainer, TableEmpty, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { fmt1, fmt2, fmtInt, fmtKm1, KM_ALERT_LABEL, kmStatusLabel, kmStatusTone, type KmAlert } from "@/lib/km/types";
import type { KmHistoryDay, KmHistoryMonth } from "@/lib/km/history";
import type { KmCorrectionTarget } from "../../components/correction-dialog";
import { fullDate, monthFull, QUIET_STATUSES, weekdayOf } from "./format";

/** Rótulo de um alerta (os do catálogo, e os secundários da classificação). */
const EXTRA_ALERT: Record<string, string> = {
  high_mileage: "Alta rodagem",
  missing_odometer: "Hodômetro ausente",
  end_before_start: "Final menor que o inicial",
};
export const alertLabel = (code: string) => KM_ALERT_LABEL[code as KmAlert] ?? EXTRA_ALERT[code] ?? code;

// ---------------------------------------------------------------------------
// Mensal
// ---------------------------------------------------------------------------
export function MonthlyTable({ monthly }: { monthly: KmHistoryMonth[] }) {
  return (
    <TableContainer data-testid="km-historico-monthly">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Mês</TableHead>
            <TableHead numeric>KM validado</TableHead>
            <TableHead numeric>Dias com leitura</TableHead>
            <TableHead numeric>Sem leitura</TableHead>
            <TableHead numeric>Sem movimento</TableHead>
            <TableHead numeric>Média diária</TableHead>
            <TableHead numeric>Mediana diária</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {monthly.length === 0 ? (
            <TableEmpty colSpan={7} message="Sem meses no período." />
          ) : (
            monthly.map((m) => (
              <TableRow key={m.month}>
                <TableCell>
                  <span className="inline-block first-letter:uppercase">{monthFull(m.month)}</span>
                </TableCell>
                <TableCell numeric className="font-medium">{m.readingDays > 0 ? fmtKm1(m.km) : "—"}</TableCell>
                <TableCell numeric>{fmtInt(m.readingDays)}</TableCell>
                <TableCell numeric>{fmtInt(m.noReadingDays)}</TableCell>
                <TableCell numeric>{fmtInt(m.noMovementDays)}</TableCell>
                <TableCell numeric>{m.avgDaily == null ? "—" : fmtKm1(m.avgDaily)}</TableCell>
                <TableCell numeric>{m.medianDaily == null ? "—" : fmtKm1(m.medianDaily)}</TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </TableContainer>
  );
}

// ---------------------------------------------------------------------------
// Diária
// ---------------------------------------------------------------------------
const hasIssue = (d: KmHistoryDay) => !QUIET_STATUSES.has(d.status) || (d.alerts?.length ?? 0) > 0 || Boolean(d.corrected);

export function DailyTable({
  days,
  plate,
  canCorrect,
  onCorrect,
}: {
  days: KmHistoryDay[];
  plate: string;
  canCorrect: boolean;
  onCorrect: (target: KmCorrectionTarget) => void;
}) {
  const [onlyIssues, setOnlyIssues] = React.useState(false);
  // Mais recente primeiro; dias futuros não entram na tabela.
  const rows = React.useMemo(
    () => days.filter((d) => d.status !== "future" && (!onlyIssues || hasIssue(d))).slice().reverse(),
    [days, onlyIssues],
  );
  const cols = canCorrect ? 11 : 10;

  return (
    <div className="flex flex-col gap-2">
      <CheckboxField
        label="Somente dias com ocorrência"
        description="Situação fora de validado/sem movimento, com alerta ou corrigido."
        checked={onlyIssues}
        onCheckedChange={(v) => setOnlyIssues(v === true)}
        className="self-start"
        data-testid="km-historico-only-issues"
      />
      <TableContainer stickyHeader maxHeight={520} data-testid="km-historico-daily">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Dia</TableHead>
              <TableHead>Situação</TableHead>
              <TableHead numeric>Hod. inicial</TableHead>
              <TableHead numeric>Hod. final</TableHead>
              <TableHead numeric>KM informado</TableHead>
              <TableHead numeric>KM validado</TableHead>
              <TableHead>Alertas</TableHead>
              <TableHead>Corrigido</TableHead>
              <TableHead>Local</TableHead>
              <TableHead>BR</TableHead>
              {canCorrect ? (
                <TableHead>
                  <span className="sr-only">Ações</span>
                </TableHead>
              ) : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableEmpty
                colSpan={cols}
                message={onlyIssues ? "Nenhum dia com ocorrência neste recorte." : "Sem dias no recorte."}
              />
            ) : (
              rows.map((d) => {
                const noReading = d.status === "no_reading";
                return (
                  <TableRow key={d.day} data-testid="km-historico-daily-row">
                    <TableCell className="whitespace-nowrap tabular-nums">
                      <span className="text-fg-muted">{weekdayOf(d.day)}</span> {fullDate(d.day)}
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={kmStatusTone(d.status)} size="sm">
                        {kmStatusLabel(d.status)}
                      </StatusBadge>
                    </TableCell>
                    <TableCell numeric>{noReading ? "—" : fmt2(d.odometerStart)}</TableCell>
                    <TableCell numeric>{noReading ? "—" : fmt2(d.odometerEnd)}</TableCell>
                    <TableCell numeric>{noReading ? "—" : fmt1(d.kmInformed)}</TableCell>
                    <TableCell numeric className="font-medium">
                      {noReading ? (
                        <span className="font-normal text-fg-muted">Sem leitura</span>
                      ) : d.km == null ? (
                        <span className="font-normal text-fg-muted" title="Não entra nos totais">—</span>
                      ) : (
                        fmt1(d.km)
                      )}
                    </TableCell>
                    <TableCell>
                      {d.alerts && d.alerts.length > 0 ? (
                        <span className="flex flex-wrap gap-1">
                          {d.alerts.map((a) => (
                            <Badge key={a} variant="warning" size="sm">
                              {alertLabel(a)}
                            </Badge>
                          ))}
                        </span>
                      ) : (
                        <span className="text-fg-muted">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {d.corrected ? (
                        <Badge variant="info" size="sm">
                          Corrigido
                        </Badge>
                      ) : (
                        <span className="text-fg-muted">Não</span>
                      )}
                    </TableCell>
                    <TableCell className="whitespace-nowrap">{d.local ?? <span className="text-fg-muted">—</span>}</TableCell>
                    <TableCell className="whitespace-nowrap">{d.br ?? <span className="text-fg-muted">—</span>}</TableCell>
                    {canCorrect ? (
                      <TableCell className="text-right">
                        {d.readingId ? (
                          <Button
                            variant="ghost"
                            size="sm"
                            leadingIcon={<PencilLine aria-hidden />}
                            aria-label={`Corrigir a leitura de ${fullDate(d.day)} do veículo ${plate}`}
                            onClick={() =>
                              onCorrect({
                                readingId: d.readingId as string,
                                plate,
                                day: d.day,
                                odometerStart: d.odometerStart,
                                odometerEnd: d.odometerEnd,
                                kmInformed: d.kmInformed,
                                status: d.status,
                                alerts: d.alerts,
                              })
                            }
                            data-testid="km-historico-correct"
                          >
                            Corrigir
                          </Button>
                        ) : null}
                      </TableCell>
                    ) : null}
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </TableContainer>
    </div>
  );
}
