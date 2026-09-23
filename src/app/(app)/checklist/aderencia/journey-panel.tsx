"use client";

import * as React from "react";
import { ArrowRight } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { DateInput } from "@/components/ui/date-input";
import { StatusBadge } from "@/components/ui/status-badge";
import { Button } from "@/components/ui/button";
import {
  Table, TableBody, TableCell, TableContainer, TableEmpty, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import type { ChecklistContext, JourneyRow, ReturnTracking } from "@/lib/adherence/queries";
import type { Competence } from "@/lib/governance/competence";
import { formatDateBr, formatInt, JOURNEY_META, statusMeta } from "./status";
import { ReturnTrackingPanel } from "./return-tracking-panel";
import type { Navigate } from "./adherence-view";

export interface JourneyPanelProps {
  rows: JourneyRow[];
  day: string;
  today: string;
  context: ChecklistContext;
  competence: Competence;
  /** Acompanhamento do Retorno na competência (§46–§51); null quando não carregou. */
  returnTracking: ReturnTracking | null;
  navigate: Navigate;
  pending: boolean;
  onSelect: (obligationId: string) => void;
}

function Step({ code }: { code: string | null }) {
  if (!code) return <span className="text-caption text-fg-subtle">Sem obrigação</span>;
  const m = statusMeta(code);
  return <StatusBadge status={m.tone} size="sm">{m.label}</StatusBadge>;
}

/**
 * Jornada (§53): Previsto → Saída → Em rota → Retorno, por veículo e dia.
 * Saída feita não é jornada completa; o retorno responde por si.
 *
 * Abaixo da tabela do dia vem o Acompanhamento do Retorno da competência
 * (§46–§51); no contexto de retorno ele sobe para o topo, porque é o que a
 * pessoa veio ver.
 */
export function JourneyPanel({ rows, day, today, context, competence, returnTracking, navigate, pending, onSelect }: JourneyPanelProps) {
  const counts = React.useMemo(() => {
    const c: Record<string, number> = {};
    for (const r of rows) c[r.journey] = (c[r.journey] ?? 0) + 1;
    return c;
  }, [rows]);

  const tracking = (
    <ReturnTrackingPanel returnTracking={returnTracking} competence={competence} today={today} onSelect={onSelect} />
  );

  return (
    <div className="flex flex-col gap-5">
    {context === "retorno" ? tracking : null}
    <Card>
      <CardContent className="flex flex-col gap-4 p-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="flex flex-col gap-1">
            <span className="text-caption text-fg-muted">Dia operacional</span>
            <DateInput
              size="sm"
              aria-label="Dia operacional"
              value={day}
              disabled={pending}
              onChange={(e) => { if (e.target.value) navigate({ dia: e.target.value }); }}
            />
          </div>
          <ul className="flex flex-wrap gap-2" aria-label="Resumo das jornadas">
            {Object.entries(JOURNEY_META).map(([key, meta]) => (
              <li key={key}>
                <StatusBadge status={meta.tone} size="sm">{meta.label}: {formatInt(counts[key] ?? 0)}</StatusBadge>
              </li>
            ))}
          </ul>
        </div>
        <p className="text-caption text-fg-muted">
          {formatDateBr(day)}{day === today ? " · dia vigente: a situação é provisória enquanto o dia corre" : ""}{day > today ? " · data futura: planejamento, não descumprimento" : ""}
        </p>

        <TableContainer>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Veículo</TableHead>
                <TableHead>Operação · Cidade · BR</TableHead>
                <TableHead>Liderança</TableHead>
                <TableHead>Saída</TableHead>
                <TableHead aria-hidden />
                <TableHead>Retorno</TableHead>
                <TableHead>Jornada</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 ? (
                <TableEmpty colSpan={7} message="Nenhum veículo previsto para este dia no recorte." />
              ) : (
                rows.map((r) => {
                  const j = JOURNEY_META[r.journey] ?? JOURNEY_META.nao_realizada;
                  return (
                    <TableRow key={r.vehicleId}>
                      <TableCell>
                        <span className="font-medium text-fg">{r.fleetCode ?? "—"}</span>
                        <span className="ml-1 text-fg-muted">{r.licensePlate ?? ""}</span>
                      </TableCell>
                      <TableCell className="text-fg-muted">
                        {[r.operationName, r.cityName, r.brCode].filter(Boolean).join(" · ")}
                      </TableCell>
                      <TableCell className="text-fg-muted">{r.leaderName ?? "—"}</TableCell>
                      <TableCell>
                        {r.departureId ? (
                          <Button variant="ghost" size="sm" onClick={() => onSelect(r.departureId!)} className="-ml-2 px-2">
                            <Step code={r.departureStatus} />
                          </Button>
                        ) : <Step code={r.departureStatus} />}
                      </TableCell>
                      <TableCell className="text-fg-subtle"><ArrowRight className="size-4" aria-hidden /></TableCell>
                      <TableCell>
                        {r.returnId ? (
                          <Button variant="ghost" size="sm" onClick={() => onSelect(r.returnId!)} className="-ml-2 px-2">
                            <Step code={r.returnStatus} />
                          </Button>
                        ) : <Step code={r.returnStatus} />}
                      </TableCell>
                      <TableCell><StatusBadge status={j.tone} size="sm">{j.label}</StatusBadge></TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </TableContainer>
      </CardContent>
    </Card>
    {context === "retorno" ? null : tracking}
    </div>
  );
}
