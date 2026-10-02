"use client";

import * as React from "react";
import { Activity, Gauge, History, Percent, Route, TrendingUp, Wrench } from "lucide-react";
import { cn } from "@/lib/cn";
import { KpiCard, MetricStrip } from "@/components/ui/kpi-card";
import { StatusBadge } from "@/components/ui/status-badge";
import { EmptyState } from "@/components/feedback/empty-state";
import {
  Table, TableBody, TableCell, TableContainer, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { fmt1, fmtInt, fmtKm, fmtKm1, fmtPct, kmStatusLabel, type KmVehicleCard } from "@/lib/km/types";
import type { KmHistoryAuditEntry, KmHistoryKpis, KmHistoryPreventive, KmHistoryProjection } from "@/lib/km/history";
import {
  AUDIT_ACTION, AUDIT_FIELD, CONFIDENCE, freshnessMeta, fullDate, HEALTH, stamp, VEHICLE_STATUS,
} from "./format";

// ---------------------------------------------------------------------------
// Cabeçalho do veículo
// ---------------------------------------------------------------------------
function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className="text-caption text-fg-muted">{label}</dt>
      <dd className="truncate text-body-sm text-fg">{children}</dd>
    </div>
  );
}

const dash = <span className="text-fg-muted">—</span>;

export function VehicleHeader({
  vehicle,
  period,
  kpis,
}: {
  vehicle: KmVehicleCard;
  period?: { from: string; to: string };
  kpis?: KmHistoryKpis;
}) {
  const status = VEHICLE_STATUS[vehicle.status] ?? { label: vehicle.status, tone: "neutral" as const };
  const fresh = freshnessMeta(kpis?.freshness);
  const health = kpis?.health ? HEALTH[kpis.health] : null;
  return (
    <section
      aria-label={`Veículo ${vehicle.plate}`}
      className="flex flex-col gap-4 rounded-lg border border-border bg-surface-raised p-4 shadow-card"
      data-testid="km-historico-header"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-h3 font-semibold tracking-tight text-fg">{vehicle.plate}</h2>
            {vehicle.fleetCode && vehicle.fleetCode !== vehicle.plate ? (
              <span className="text-body text-fg-secondary">Frota {vehicle.fleetCode}</span>
            ) : null}
            <StatusBadge status={status.tone} size="sm">
              {status.label}
            </StatusBadge>
          </div>
          <p className="text-body-sm text-fg-muted">
            {period ? `Período ${fullDate(period.from)} a ${fullDate(period.to)}` : "Período padrão"}
            {kpis?.lastReadingDate ? ` · Última leitura em ${fullDate(kpis.lastReadingDate)}` : " · Sem leitura registrada"}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-caption text-fg-muted">Atualização</span>
          <StatusBadge status={fresh.tone} size="sm" data-testid="km-historico-freshness">
            {fresh.label}
            {kpis?.missingDays != null && kpis.missingDays > 0 ? ` (${fmtInt(kpis.missingDays)} d)` : ""}
          </StatusBadge>
          <span className="text-caption text-fg-muted">Saúde do hodômetro</span>
          <StatusBadge status={health?.tone ?? "neutral"} size="sm" title={health?.hint} data-testid="km-historico-health">
            {health?.label ?? "—"}
          </StatusBadge>
        </div>
      </div>
      <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Fact label="Tipo">{vehicle.type ?? dash}</Fact>
        <Fact label="Subcategoria">{vehicle.subcategory ?? dash}</Fact>
        <Fact label="Modelo">{vehicle.model ?? dash}</Fact>
        <Fact label="Situação cadastral">{status.label}</Fact>
      </dl>
    </section>
  );
}

// ---------------------------------------------------------------------------
// KPIs
// ---------------------------------------------------------------------------
export function HistoryKpis({ kpis }: { kpis: KmHistoryKpis }) {
  const health = kpis.health ? HEALTH[kpis.health] : null;
  const fresh = freshnessMeta(kpis.freshness);
  const elapsed = kpis.readingDays + kpis.noReadingDays;
  return (
    <div className="flex flex-col gap-3" data-testid="km-historico-kpis">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          label="KM atual"
          value={kpis.currentKm == null ? "—" : fmtInt(kpis.currentKm)}
          unit={kpis.currentKm == null ? undefined : "km"}
          period={kpis.lastReadingDate ? `Hodômetro em ${fullDate(kpis.lastReadingDate)}` : "Sem leitura confiável"}
          icon={<Gauge />}
          status="primary"
        />
        <KpiCard
          label="KM no período"
          value={kpis.readingDays > 0 ? fmt1(kpis.kmPeriod) : "—"}
          unit={kpis.readingDays > 0 ? "km" : undefined}
          period="Soma do KM validado (só o que conta nos totais)"
          icon={<Route />}
          status="accent"
        />
        <KpiCard
          label="Média diária"
          value={kpis.avgDaily == null ? "—" : fmt1(kpis.avgDaily)}
          unit={kpis.avgDaily == null ? undefined : "km/dia"}
          period={`Mediana ${fmtKm1(kpis.medianDaily)} · máximo ${fmtKm1(kpis.maxDaily)}`}
          icon={<Activity />}
        />
        <KpiCard
          label="Cobertura"
          value={kpis.coveragePct == null ? "—" : fmt1(kpis.coveragePct)}
          unit={kpis.coveragePct == null ? undefined : "%"}
          period={`${fmtInt(kpis.readingDays)} de ${fmtInt(elapsed)} dias decorridos com leitura`}
          icon={<Percent />}
          status={kpis.coveragePct == null ? "neutral" : kpis.coveragePct >= 70 ? "success" : kpis.coveragePct >= 30 ? "warning" : "danger"}
        />
      </div>
      <MetricStrip
        ariaLabel="Indicadores do período"
        className="md:grid-cols-4 xl:grid-cols-5"
        items={[
          { key: "median", label: "Mediana diária", value: fmtKm1(kpis.medianDaily) },
          { key: "max", label: "Máximo diário", value: fmtKm1(kpis.maxDaily) },
          { key: "reading", label: "Dias com leitura", value: fmtInt(kpis.readingDays) },
          { key: "noreading", label: "Sem leitura", value: fmtInt(kpis.noReadingDays), hint: "Não é 0 km" },
          { key: "nomove", label: "Sem movimento", value: fmtInt(kpis.noMovementDays), hint: "Leitura válida, sem deslocamento" },
          { key: "jumps", label: "Saltos de hodômetro", value: fmtInt(kpis.jumps) },
          { key: "regressions", label: "Regressões", value: fmtInt(kpis.regressions) },
          { key: "divergences", label: "Divergências de KM", value: fmtInt(kpis.divergences) },
          {
            key: "freshness",
            label: "Atualização",
            value: <span className="text-body font-semibold">{fresh.label}</span>,
            hint:
              kpis.missingDays == null
                ? "Nunca teve leitura"
                : kpis.missingDays === 0
                  ? "Leitura até ontem"
                  : `${fmtInt(kpis.missingDays)} ${kpis.missingDays === 1 ? "dia" : "dias"} sem leitura`,
          },
          {
            key: "health",
            label: "Saúde do hodômetro",
            value: <span className="text-body font-semibold">{health?.label ?? "—"}</span>,
            hint: health?.hint,
          },
        ]}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Projeção e preventiva
// ---------------------------------------------------------------------------
function CardShell({
  title, description, icon, children, testId,
}: { title: string; description?: React.ReactNode; icon: React.ReactNode; children: React.ReactNode; testId?: string }) {
  const id = React.useId();
  return (
    <section
      aria-labelledby={id}
      className="flex min-w-0 flex-col gap-3 rounded-lg border border-border bg-surface-raised p-4 shadow-card"
      data-testid={testId}
    >
      <header className="flex items-start gap-2.5">
        <span aria-hidden className="flex size-8 shrink-0 items-center justify-center rounded-md bg-primary-soft text-primary-soft-fg [&_svg]:size-4">
          {icon}
        </span>
        <div className="min-w-0">
          <h3 id={id} className="text-card-title font-semibold text-fg">{title}</h3>
          {description ? <p className="text-caption text-fg-muted">{description}</p> : null}
        </div>
      </header>
      {children}
    </section>
  );
}

export function ProjectionCard({ projection }: { projection: KmHistoryProjection | null | undefined }) {
  const conf = CONFIDENCE[projection?.confidence ?? "none"] ?? CONFIDENCE.none;
  const horizons = projection?.horizons ?? [];
  return (
    <CardShell
      title="Projeção 30/60/90 dias"
      description="Ritmo = mediana do KM/dia nos dias com leitura dos últimos 30 dias do período."
      icon={<TrendingUp />}
      testId="km-historico-projection"
    >
      <div className="flex flex-wrap items-center gap-2 text-body-sm">
        <span className="text-fg-secondary">
          Ritmo: <strong className="tabular-nums text-fg">{projection?.rateKmDay == null ? "—" : `${fmt1(projection.rateKmDay)} km/dia`}</strong>
        </span>
        <span className="text-fg-muted">· cobertura em 30 dias {fmtPct(projection?.coverage30dPct)}</span>
        <StatusBadge status={conf.tone} size="sm">{conf.label}</StatusBadge>
      </div>
      {horizons.length === 0 ? (
        <p className="rounded-md bg-surface-secondary px-3 py-2 text-body-sm text-fg-muted">
          Sem leituras suficientes nos últimos 30 dias para projetar.
        </p>
      ) : (
        <TableContainer>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Horizonte</TableHead>
                <TableHead numeric>KM a rodar</TableHead>
                <TableHead numeric>Hodômetro estimado</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {horizons.map((h) => (
                <TableRow key={h.days}>
                  <TableHead scope="row" className="font-normal">{h.days} dias</TableHead>
                  <TableCell numeric>{fmtKm(h.km)}</TableCell>
                  <TableCell numeric className="font-medium">{fmtKm(h.odometer)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}
      <p className="text-caption text-fg-muted">Estimativa pelo ritmo recente; não é compromisso de rodagem.</p>
    </CardShell>
  );
}

export function PreventiveCard({ preventive }: { preventive: KmHistoryPreventive | null | undefined }) {
  return (
    <CardShell
      title="Preventiva"
      description="Próximo ciclo em aberto do plano preventivo do veículo."
      icon={<Wrench />}
      testId="km-historico-preventive"
    >
      {!preventive ? (
        <p className="rounded-md bg-surface-secondary px-3 py-2 text-body-sm text-fg-muted">
          Nenhum ciclo preventivo em aberto para este veículo.
        </p>
      ) : (
        <>
          <dl className="grid grid-cols-2 gap-4">
            <Fact label="Ciclo">{preventive.cycleNumber == null ? "—" : `${fmtInt(preventive.cycleNumber)}º ciclo`}</Fact>
            <Fact label="Marco">{fmtKm(preventive.milestoneKm)}</Fact>
            <Fact label="KM restantes">
              <span className={cn("tabular-nums", preventive.overdue && "font-semibold text-danger")}>
                {preventive.kmRemaining == null
                  ? "—"
                  : preventive.overdue
                    ? `${fmtKm(Math.abs(preventive.kmRemaining))} além do marco`
                    : fmtKm(preventive.kmRemaining)}
              </span>
            </Fact>
            <Fact label="Estimativa">
              {preventive.overdue
                ? "Marco já atingido"
                : preventive.daysEstimate == null
                  ? "Sem ritmo para estimar"
                  : `Em ~${fmtInt(preventive.daysEstimate)} dias${preventive.dateEstimate ? ` (${fullDate(preventive.dateEstimate)})` : ""}`}
            </Fact>
          </dl>
          {preventive.overdue ? (
            <StatusBadge status="danger" size="sm" className="self-start">
              Preventiva vencida por KM
            </StatusBadge>
          ) : preventive.daysEstimate != null && preventive.daysEstimate <= 30 ? (
            <StatusBadge status="warning" size="sm" className="self-start">
              Marco previsto em até 30 dias
            </StatusBadge>
          ) : null}
        </>
      )}
    </CardShell>
  );
}

// ---------------------------------------------------------------------------
// Trilha de auditoria
// ---------------------------------------------------------------------------
function changeValue(kind: "km" | "status" | "ref", v: unknown): string {
  if (v == null) return "—";
  if (kind === "km") return typeof v === "number" ? fmt1(v) : String(v);
  if (kind === "status") return kmStatusLabel(String(v));
  return "alterado";
}

function ChangeList({ changes }: { changes: KmHistoryAuditEntry["changes"] }) {
  const entries = Object.entries(changes ?? {}).filter(([, v]) => v != null);
  if (entries.length === 0) return <span className="text-fg-muted">—</span>;
  return (
    <ul className="flex flex-col gap-0.5">
      {entries.map(([field, change]) => {
        const meta = AUDIT_FIELD[field] ?? { label: field, kind: "ref" as const };
        return (
          <li key={field} className="text-caption">
            <span className="text-fg-muted">{meta.label}: </span>
            {meta.kind === "ref" ? (
              <span className="text-fg">alterado</span>
            ) : (
              <span className="tabular-nums text-fg">
                {changeValue(meta.kind, change?.from)} → {changeValue(meta.kind, change?.to)}
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

export function AuditTrail({ audit }: { audit: KmHistoryAuditEntry[] }) {
  return (
    <CardShell
      title="Trilha de auditoria"
      description="Correções, análises, reprocessamentos e atualizações da importação (as 100 mais recentes)."
      icon={<History />}
      testId="km-historico-audit"
    >
      {audit.length === 0 ? (
        <EmptyState size="sm" headingLevel={4} title="Sem registros" description="Nenhuma alteração registrada para este veículo." />
      ) : (
        <TableContainer stickyHeader maxHeight={420}>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Quando</TableHead>
                <TableHead>Dia da leitura</TableHead>
                <TableHead>Ação</TableHead>
                <TableHead>Alterações</TableHead>
                <TableHead>Motivo</TableHead>
                <TableHead>Responsável</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {audit.map((a, i) => (
                <TableRow key={`${a.at}-${i}`}>
                  <TableCell className="whitespace-nowrap tabular-nums">{stamp(a.at)}</TableCell>
                  <TableCell className="whitespace-nowrap tabular-nums">{fullDate(a.day)}</TableCell>
                  <TableCell className="whitespace-nowrap">{AUDIT_ACTION[a.action] ?? a.action}</TableCell>
                  <TableCell><ChangeList changes={a.changes} /></TableCell>
                  <TableCell className="min-w-48 text-body-sm text-fg-secondary">{a.reason ?? "—"}</TableCell>
                  <TableCell className="whitespace-nowrap">{a.actor ?? "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}
    </CardShell>
  );
}

