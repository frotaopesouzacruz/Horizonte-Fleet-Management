"use client";

import * as React from "react";
import { CircleCheck, Settings2 } from "lucide-react";
import { cn } from "@/lib/cn";
import { Badge } from "@/components/ui/badge";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { StatusBadge } from "@/components/ui/status-badge";
import { Table, TableBody, TableCell, TableContainer, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  CRITICALITY_LABEL, CRITICALITY_TONE, DEADLINE_LABEL, DEADLINE_TONE, PSI_LABEL, PSI_TONE, TREAD_LABEL, TREAD_TONE,
  fmtDays, fmtInt, fmtMm, fmtNum, formatDate, plural, reasonLabel,
  type DeadlineStatus, type TireIndicatorPendingRow, type TiresIndicator,
} from "@/lib/tires/types";
import type { TiresPanelContext } from "../../shared";
import { ExportButton, FireLink, PanelEmpty, PlateLink, Section, TiresPagination } from "../tires-ui";
import { fmtSignedPct, statusEntries, statusLabel, statusTone, type IndicatorSub, type IndicatorTab } from "./model";

export const PENDING_ANCHOR = "tires-indicator-pendencias";

/**
 * Pendências do indicador: os pneus não conformes, do pior para o melhor,
 * paginados no servidor (`?pagina=`) e filtráveis pela situação
 * (`?pendencia=<código>`). Nº Fogo abre a ficha; a placa, a Base geral.
 */
export function PendingSection({
  ind, tab, sub, ctx,
}: {
  ind: TiresIndicator;
  tab: IndicatorTab;
  sub: IndicatorSub;
  ctx: TiresPanelContext;
}) {
  const active = ind.status || null;
  const options = statusEntries(ind).filter((e) => (!e.ok && e.count > 0) || e.code === active);
  const activeLabel = active ? statusLabel(ind.indicator, active) : null;

  return (
    <div id={PENDING_ANCHOR} className="scroll-mt-4">
      <Section
        title="Pendências"
        testId="tires-indicator-pending"
        description={
          <span>
            {fmtInt(ind.pendingTotal)} {plural(ind.pendingTotal, "pneu não conforme", "pneus não conformes")}
            {activeLabel ? ` em “${activeLabel}”` : " neste indicador"}, do pior para o melhor. Nº Fogo abre a ficha do pneu; a placa, a
            Base geral do veículo.
          </span>
        }
        actions={
          <ExportButton
            ctx={ctx}
            kind={tab}
            extra={{ sub, pendencia: active }}
            testId="tires-indicator-export"
          />
        }
      >
        {options.length > 0 ? (
          <SegmentedControl<string>
            aria-label="Situação das pendências"
            value={active ?? "all"}
            wrap
            disabled={ctx.pending}
            onValueChange={(v) => ctx.navigate({ pendencia: v === "all" ? null : v, pagina: null })}
            data-testid="tires-indicator-pending-filter"
            options={[
              { value: "all", label: "Todas", "data-testid": "tires-indicator-pending-all" },
              ...options.map((o) => ({
                value: o.code,
                "data-testid": `tires-indicator-pending-${o.code}`,
                label: (
                  <>
                    {o.code === "sem_parametro" ? <Settings2 aria-hidden /> : null}
                    {o.label}
                    <span className="tabular-nums text-fg-muted">{fmtInt(o.count)}</span>
                  </>
                ),
              })),
            ]}
          />
        ) : null}

        {ind.pending.length === 0 ? (
          <PanelEmpty
            icon={<CircleCheck />}
            title={activeLabel ? `Nenhum pneu em “${activeLabel}”` : "Nenhuma pendência no recorte"}
            description={
              activeLabel
                ? "Escolha outra situação ou ajuste os filtros da tela."
                : "Todos os pneus em uso do recorte estão conformes neste indicador."
            }
            testId="tires-indicator-pending-empty"
          />
        ) : (
          <PendingTable ind={ind} />
        )}

        <TiresPagination
          ctx={ctx}
          total={ind.pendingTotal}
          limit={ind.limit}
          label="Paginação das pendências"
          testId="tires-indicator-pagination"
        />
      </Section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tabela
// ---------------------------------------------------------------------------
interface Col {
  key: string;
  head: React.ReactNode;
  numeric?: boolean;
  cell: (r: TireIndicatorPendingRow) => React.ReactNode;
}

const muted = (v: React.ReactNode) => <span className="text-fg-muted">{v}</span>;

function DeadlineBadge({ status }: { status: DeadlineStatus }) {
  return (
    <StatusBadge status={DEADLINE_TONE[status] ?? "neutral"} size="sm">
      {DEADLINE_LABEL[status] ?? status}
    </StatusBadge>
  );
}

function PsiBadge({ row }: { row: TireIndicatorPendingRow }) {
  if (row.psiStatus === "sem_parametro") {
    return (
      <Badge variant="highlight" size="sm" icon={<Settings2 />}>
        {PSI_LABEL.sem_parametro}
      </Badge>
    );
  }
  return (
    <StatusBadge status={PSI_TONE[row.psiStatus] ?? "neutral"} size="sm">
      {PSI_LABEL[row.psiStatus] ?? row.psiStatus}
    </StatusBadge>
  );
}

/** PSI medido × faixa da regra (mín–máx, ideal). */
function PsiRange({ row }: { row: TireIndicatorPendingRow }) {
  const hasRule = row.psiMin != null || row.psiMax != null;
  if (!hasRule) return muted("sem regra");
  return (
    <span className="flex flex-col leading-tight">
      <span className="tabular-nums text-fg-secondary">
        {fmtNum(row.psiMin)}–{fmtNum(row.psiMax)}
      </span>
      {row.psiIdeal != null ? <span className="text-caption text-fg-muted tabular-nums">ideal {fmtNum(row.psiIdeal)}</span> : null}
    </span>
  );
}

function PsiDeviation({ row }: { row: TireIndicatorPendingRow }) {
  if (row.psiDevPct == null) return muted("—");
  return (
    <span className="flex flex-col items-end leading-tight">
      <span className={cn("font-semibold tabular-nums", row.psiDevPct < 0 ? "text-danger-soft-fg" : "text-warning-soft-fg")}>
        {fmtSignedPct(row.psiDevPct)}
      </span>
      {row.psiDev != null ? (
        <span className="text-caption text-fg-muted tabular-nums">
          {row.psiDev > 0 ? "+" : row.psiDev < 0 ? "−" : ""}
          {fmtNum(Math.abs(row.psiDev))} PSI {row.psiDevPct < 0 ? "abaixo do mín." : "acima do máx."}
        </span>
      ) : null}
    </span>
  );
}

/** Data do último registro, dias desde ela, vencimento e atraso (medição ou calibragem). */
function deadlineCols(kind: "measurement" | "calibration"): Col[] {
  const pick = (r: TireIndicatorPendingRow) =>
    kind === "measurement"
      ? { date: r.measurementDate, days: r.measurementDays, status: r.measurementStatus, due: r.measurementDueDate, late: r.measurementLate }
      : { date: r.calibrationDate, days: r.calibrationDays, status: r.calibrationStatus, due: r.calibrationDueDate, late: r.calibrationLate };
  const noun = kind === "measurement" ? "medição" : "calibragem";
  return [
    { key: "status", head: "Prazo", cell: (r) => <DeadlineBadge status={pick(r).status} /> },
    { key: "date", head: `Última ${noun}`, cell: (r) => (pick(r).date ? <span className="tabular-nums">{formatDate(pick(r).date)}</span> : muted("sem registro")) },
    { key: "days", head: "Dias", numeric: true, cell: (r) => (pick(r).days == null ? muted("—") : fmtInt(pick(r).days)) },
    { key: "due", head: "Vencimento", cell: (r) => (pick(r).due ? <span className="tabular-nums">{formatDate(pick(r).due)}</span> : muted("—")) },
    {
      key: "late",
      head: "Atraso",
      numeric: true,
      cell: (r) => {
        const late = pick(r).late;
        return late == null ? muted("—") : <span className="font-semibold text-danger-soft-fg">{fmtDays(late)}</span>;
      },
    },
  ];
}

function columnsOf(ind: TiresIndicator): Col[] {
  switch (ind.indicator) {
    case "tread":
      return [
        {
          key: "treadMin",
          head: "Menor MM",
          cell: (r) => (
            <span className="flex flex-col items-start gap-0.5">
              <span className="font-semibold tabular-nums">{fmtMm(r.treadMin)}</span>
              <StatusBadge status={TREAD_TONE[r.treadClass] ?? "neutral"} size="sm">
                {TREAD_LABEL[r.treadClass] ?? r.treadClass}
              </StatusBadge>
              {r.legalTreadMm != null ? <span className="text-caption text-fg-muted tabular-nums">legal {fmtMm(r.legalTreadMm)}</span> : null}
            </span>
          ),
        },
        ...[1, 2, 3, 4].map((n) => ({
          key: `tread${n}`,
          head: (
            <abbr title={`Sulco ${n} (mm)`} className="no-underline">
              S{n}
            </abbr>
          ),
          numeric: true,
          cell: (r: TireIndicatorPendingRow) => {
            const v = [r.tread1, r.tread2, r.tread3, r.tread4][n - 1];
            return <span className={cn(v != null && v === r.treadMin ? "font-semibold text-fg" : "text-fg-secondary")}>{fmtNum(v)}</span>;
          },
        })),
      ];
    case "measurement":
      return deadlineCols("measurement");
    case "calibration":
      return deadlineCols("calibration");
    case "psi":
      return [
        { key: "psiStatus", head: "Pressão", cell: (r) => <PsiBadge row={r} /> },
        { key: "psi", head: "PSI medido", numeric: true, cell: (r) => <span className="font-semibold">{fmtNum(r.psi)}</span> },
        { key: "range", head: "Faixa (mín–máx)", cell: (r) => <PsiRange row={r} /> },
        { key: "dev", head: "Desvio", numeric: true, cell: (r) => <PsiDeviation row={r} /> },
        { key: "cal", head: "Última calibragem", cell: (r) => (r.calibrationDate ? <span className="tabular-nums">{formatDate(r.calibrationDate)}</span> : muted("sem registro")) },
      ];
    case "calibration_conformity":
      return [
        {
          key: "status",
          head: "Situação",
          cell: (r) => (
            <StatusBadge status={statusTone(ind.indicator, r.status)} size="sm">
              {statusLabel(ind.indicator, r.status)}
            </StatusBadge>
          ),
        },
        {
          key: "deadline",
          head: "Prazo de calibragem",
          cell: (r) => (
            <span className="flex flex-col items-start gap-0.5">
              <DeadlineBadge status={r.calibrationStatus} />
              <span className="text-caption text-fg-muted tabular-nums">
                {r.calibrationDate ? `${formatDate(r.calibrationDate)}${r.calibrationLate != null ? ` · ${fmtDays(r.calibrationLate)} de atraso` : ""}` : "sem registro"}
              </span>
            </span>
          ),
        },
        { key: "psiStatus", head: "Pressão", cell: (r) => <PsiBadge row={r} /> },
        { key: "psi", head: "PSI medido", numeric: true, cell: (r) => <span className="font-semibold">{fmtNum(r.psi)}</span> },
        { key: "range", head: "Faixa (mín–máx)", cell: (r) => <PsiRange row={r} /> },
        { key: "dev", head: "Desvio", numeric: true, cell: (r) => <PsiDeviation row={r} /> },
      ];
    default:
      return [
        {
          key: "status",
          head: "Situação",
          cell: (r) => (
            <StatusBadge status={statusTone(ind.indicator, r.status)} size="sm">
              {statusLabel(ind.indicator, r.status)}
            </StatusBadge>
          ),
        },
      ];
  }
}

function PendingTable({ ind }: { ind: TiresIndicator }) {
  const cols = columnsOf(ind);
  return (
    <TableContainer stickyHeader className="max-h-[70vh]" data-testid="tires-indicator-pending-table">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Nº Fogo</TableHead>
            <TableHead>Veículo</TableHead>
            <TableHead>Posição</TableHead>
            <TableHead>Criticidade</TableHead>
            {cols.map((c) => (
              <TableHead key={c.key} numeric={c.numeric} className={c.key.startsWith("tread") && c.key !== "treadMin" ? "px-2" : undefined}>
                {c.head}
              </TableHead>
            ))}
            <TableHead>Motivos</TableHead>
            <TableHead>Operação · local · liderança</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {ind.pending.map((r) => {
            const position = r.positionLabel ?? r.positionCode;
            const local = [r.cityName, r.stateUf].filter(Boolean).join("/");
            return (
              <TableRow key={r.tireId} className="h-11" data-testid="tires-indicator-pending-row" data-status={r.status} data-criticality={r.criticality}>
                <TableCell className="whitespace-nowrap py-1.5">
                  <FireLink tireId={r.tireId} fireNumber={r.fireNumber} testId="tires-indicator-pending-fire" />
                </TableCell>
                <TableCell className="whitespace-nowrap py-1.5">
                  <PlateLink vehicleId={r.vehicleId} plate={r.licensePlate} fleetCode={r.fleetNumber} testId="tires-indicator-pending-plate" />
                </TableCell>
                <TableCell className="py-1.5">
                  <span className="flex flex-col leading-tight">
                    <span className={cn("whitespace-nowrap", position ? "text-fg-secondary" : "text-fg-muted")}>{position ?? "—"}</span>
                    {r.positionLabel && r.positionCode && r.positionLabel !== r.positionCode ? (
                      <span className="text-caption text-fg-muted">{r.positionCode}</span>
                    ) : null}
                  </span>
                </TableCell>
                <TableCell className="whitespace-nowrap py-1.5">
                  <StatusBadge status={CRITICALITY_TONE[r.criticality] ?? "neutral"} size="sm" withIcon>
                    {CRITICALITY_LABEL[r.criticality] ?? r.criticality}
                  </StatusBadge>
                </TableCell>
                {cols.map((c) => (
                  <TableCell
                    key={c.key}
                    numeric={c.numeric}
                    className={cn("whitespace-nowrap py-1.5", c.key.startsWith("tread") && c.key !== "treadMin" && "px-2")}
                  >
                    {c.cell(r)}
                  </TableCell>
                ))}
                <TableCell className="min-w-44 py-1.5">
                  {r.reasons.length ? (
                    <ul className="flex flex-col gap-0.5 text-caption leading-tight text-fg-secondary">
                      {r.reasons.map((code) => (
                        <li key={code}>{reasonLabel(code)}</li>
                      ))}
                    </ul>
                  ) : (
                    muted("—")
                  )}
                </TableCell>
                <TableCell className="max-w-[16rem] py-1.5">
                  <span className="flex min-w-0 flex-col leading-tight">
                    <span className={cn("truncate", r.operationName ? "text-fg-secondary" : "text-fg-muted")}>{r.operationName ?? "Sem operação"}</span>
                    <span className="truncate text-caption text-fg-muted">
                      {[local || "Sem local", r.leaderName ?? "Sem liderança"].join(" · ")}
                    </span>
                  </span>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </TableContainer>
  );
}
