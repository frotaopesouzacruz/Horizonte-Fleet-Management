"use client";

import { CheckCircle2, Clock, Gauge, ShieldOff, Timer, TriangleAlert, Undo2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { KpiCard } from "@/components/ui/kpi-card";
import { StatusBadge } from "@/components/ui/status-badge";
import { Alert, AlertDescription } from "@/components/feedback/alert";
import { EmptyState } from "@/components/feedback/empty-state";
import {
  Table, TableBody, TableCell, TableContainer, TableEmpty, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import type { ReturnRow, ReturnSituation, ReturnTracking, StatusTone } from "@/lib/adherence/queries";
import { formatCompetence, type Competence } from "@/lib/governance/competence";
import { pctTone } from "./consolidated-panel";
import { formatDateBr, formatDateTimeBr, formatInt, formatPct, statusMeta } from "./status";

export interface ReturnTrackingPanelProps {
  returnTracking: ReturnTracking | null;
  competence: Competence;
  today: string;
  onSelect: (obligationId: string) => void;
}

/** Situações do retorno (§46–§51). Um retorno no prazo nunca é falta (§50). */
const SITUATION_META: Record<ReturnSituation, { label: string; tone: StatusTone }> = {
  awaiting_return: { label: "Aguardando retorno", tone: "info" },
  not_departed: { label: "Sem saída registrada", tone: "neutral" },
  overdue_after_departure: { label: "Retorno vencido (saiu)", tone: "danger" },
  overdue: { label: "Retorno vencido", tone: "danger" },
};

function situationOf(row: ReturnRow) {
  return SITUATION_META[row.situation] ?? SITUATION_META.overdue;
}

/** Dia (YYYY-MM-DD) de um instante no fuso operacional, para comparar com `today`. */
function dayInSaoPaulo(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
}

/**
 * Prazo do retorno; "vencido" quando o banco já o classificou assim
 * (`situation`) ou quando o dia do prazo é anterior ao dia operacional
 * vigente do servidor — nunca pelo relógio do navegador.
 */
function Deadline({ row, today }: { row: ReturnRow; today: string }) {
  if (!row.deadlineAt) return <span className="text-fg-subtle">—</span>;
  const past = row.situation === "overdue" || row.situation === "overdue_after_departure" || dayInSaoPaulo(row.deadlineAt) < today;
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5 tabular-nums">
      {formatDateTimeBr(row.deadlineAt)}
      {past ? <StatusBadge status="danger" size="sm">vencido</StatusBadge> : null}
    </span>
  );
}

/**
 * Acompanhamento do Retorno (§46–§51).
 *
 * O retorno tem denominador próprio (§46) e responde por si: a saída feita
 * não completa a jornada, e o retorno dentro do prazo — em geral até as 02:00
 * do dia seguinte — nunca é falta (§50). Vencido é só depois do prazo; a
 * herança de expurgo da saída só vale quando o motivo replica no retorno e a
 * solicitação pede isso (§49).
 */
export function ReturnTrackingPanel({ returnTracking, competence, today, onSelect }: ReturnTrackingPanelProps) {
  if (returnTracking === null) {
    return (
      <Card>
        <CardContent className="flex flex-col gap-3 p-4">
          <h3 className="text-h4 font-semibold text-fg">Acompanhamento do retorno</h3>
          <Alert variant="neutral">
            <AlertDescription>Não foi possível carregar o acompanhamento do retorno.</AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    );
  }

  const { stats, byLeader, rows, rowsTotal } = returnTracking;
  const tone = pctTone(stats.adherencePct, stats.targetPct);

  return (
    <Card>
      <CardContent className="flex flex-col gap-4 p-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h3 className="text-h4 font-semibold text-fg">Acompanhamento do retorno</h3>
            <p className="text-caption text-fg-muted">
              {formatCompetence(competence)} · {formatDateBr(returnTracking.dateFrom)} a {formatDateBr(returnTracking.dateTo)} · o retorno tem denominador próprio e não se mistura com a saída (§46).
            </p>
          </div>
          <StatusBadge status={stats.pendingRequests > 0 ? "warning" : "neutral"} size="sm">
            {formatInt(stats.pendingRequests)} {stats.pendingRequests === 1 ? "justificativa pendente" : "justificativas pendentes"}
          </StatusBadge>
        </div>

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" aria-label="Indicadores do retorno">
          <KpiCard label="Retornos previstos" value={formatInt(stats.expected)} icon={<Undo2 />}
            period={stats.planned > 0 ? `${formatInt(stats.planned)} planejados (futuros)` : undefined} />
          <KpiCard label="Realizados" value={formatInt(stats.done)} icon={<CheckCircle2 />} status="success" />
          <KpiCard label="Aguardando retorno" value={formatInt(stats.awaitingReturn)} icon={<Clock />} status="info"
            period="saída feita, dentro do prazo" />
          <KpiCard label="No prazo sem saída" value={formatInt(Math.max(0, stats.pendingInDeadline - stats.awaitingReturn))} icon={<Timer />}
            period="ainda dentro do prazo (§50)" />
          <KpiCard label="Vencidos" value={formatInt(stats.overdue)} icon={<TriangleAlert />} status="danger"
            period={stats.departureDoneReturnMissing > 0 ? `${formatInt(stats.departureDoneReturnMissing)} com saída feita` : undefined} />
          <KpiCard label="Expurgados" value={formatInt(stats.excluded)} icon={<ShieldOff />} />
          <KpiCard label="Aderência do retorno" value={formatPct(stats.adherencePct)} icon={<Gauge />}
            status={tone === "neutral" ? "neutral" : tone}
            period={`${formatInt(stats.numerator)} / ${formatInt(stats.denominator)} · meta ${stats.targetPct == null ? "não definida" : formatPct(stats.targetPct)}`} />
        </div>

        <p className="text-caption text-fg-muted">
          Um retorno no prazo nunca é falta (§50); a herança de expurgo da saída só vale quando o motivo replica no retorno e a solicitação pede isso (§49).
        </p>

        <section className="flex flex-col gap-2" aria-labelledby="return-by-leader">
          <h4 id="return-by-leader" className="text-label font-semibold text-fg">Por liderança</h4>
          <TableContainer>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Liderança</TableHead>
                  <TableHead className="text-right">Previstos</TableHead>
                  <TableHead className="text-right">Realizados</TableHead>
                  <TableHead className="text-right">No prazo</TableHead>
                  <TableHead className="text-right">Vencidos</TableHead>
                  <TableHead className="text-right">Expurgos</TableHead>
                  <TableHead className="text-right">Aderência</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {byLeader.length === 0 ? (
                  <TableEmpty colSpan={7} message="Nenhuma liderança com retorno previsto no recorte." />
                ) : byLeader.map((l) => (
                  <TableRow key={l.key}>
                    <TableCell className="font-medium text-fg">{l.label}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatInt(l.expected)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatInt(l.done)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatInt(l.pending)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatInt(l.overdue)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatInt(l.excluded)}</TableCell>
                    <TableCell className="text-right">
                      <StatusBadge status={pctTone(l.adherencePct, stats.targetPct)} size="sm">{formatPct(l.adherencePct)}</StatusBadge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </section>

        <section className="flex flex-col gap-2" aria-labelledby="return-queue">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h4 id="return-queue" className="text-label font-semibold text-fg">Fila de retorno</h4>
            <span className="text-caption text-fg-muted">{formatInt(rows.length)} de {formatInt(rowsTotal)}</span>
          </div>
          {rows.length === 0 ? (
            <EmptyState
              size="sm"
              variant="panel"
              title="Nenhum retorno em aberto"
              description="Todos os retornos previstos no recorte foram registrados, expurgados ou ainda não têm saída prevista."
            />
          ) : (
            <TableContainer>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Data</TableHead>
                    <TableHead>Frota / Placa</TableHead>
                    <TableHead>Operação · Cidade · BR</TableHead>
                    <TableHead>Liderança</TableHead>
                    <TableHead>Retorno previsto</TableHead>
                    <TableHead>Prazo</TableHead>
                    <TableHead>Situação</TableHead>
                    <TableHead>Saída</TableHead>
                    <TableHead>Justificativa</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row) => {
                    const sit = situationOf(row);
                    const dep = statusMeta(row.departureStatus);
                    return (
                      <TableRow key={row.id}>
                        <TableCell className="tabular-nums">{formatDateBr(row.operationalDate)}</TableCell>
                        <TableCell>
                          <button
                            type="button"
                            onClick={() => onSelect(row.id)}
                            className="hfm-focus-ring rounded-xs text-left font-medium text-fg underline-offset-2 hover:underline"
                            aria-label={`Abrir retorno de ${row.fleetCode ?? row.licensePlate ?? row.vehicleId} em ${formatDateBr(row.operationalDate)}`}
                          >
                            {row.fleetCode ?? "—"}
                          </button>
                          <span className="ml-1 text-fg-muted">{row.licensePlate ?? ""}</span>
                        </TableCell>
                        <TableCell className="text-fg-muted">{[row.operationName, row.cityName, row.brCode].filter(Boolean).join(" · ")}</TableCell>
                        <TableCell className="text-fg-muted">{row.leaderName ?? "—"}</TableCell>
                        <TableCell className="tabular-nums">{formatDateTimeBr(row.expectedAt)}</TableCell>
                        <TableCell><Deadline row={row} today={today} /></TableCell>
                        <TableCell>
                          <StatusBadge status={sit.tone} size="sm">{sit.label}{row.provisional ? " · provisório" : ""}</StatusBadge>
                        </TableCell>
                        <TableCell>
                          {row.departureStatus ? <StatusBadge status={dep.tone} size="sm">{dep.label}</StatusBadge> : <span className="text-caption text-fg-subtle">Sem obrigação</span>}
                        </TableCell>
                        <TableCell>
                          {row.pendingRequest
                            ? <StatusBadge status="warning" size="sm">Pendente</StatusBadge>
                            : <span className="text-caption text-fg-subtle">—</span>}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </TableContainer>
          )}
        </section>
      </CardContent>
    </Card>
  );
}
