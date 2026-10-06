"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { EmptyState } from "@/components/feedback/empty-state";
import { ErrorState } from "@/components/feedback/error-state";
import { LoadingState } from "@/components/feedback/loading-state";
import { AxleDiagram, type AxlePosition } from "@/components/tires/axle-diagram";
import { loadVehicleTireSummary } from "@/lib/tires/actions";
import {
  DEADLINE_SHORT,
  DEADLINE_TONE,
  INSPECTION_STATUS_LABEL,
  INSPECTION_STATUS_TONE,
  LAYOUT_SOURCE_LABEL,
  PSI_LABEL,
  PSI_TONE,
  SEVERITY_TONE,
  TIRES_BASE_PATH,
  TREAD_LABEL,
  TREAD_TONE,
  fmtInt,
  fmtMm,
  fmtPsi,
  formatDate,
  type TireRow,
  type TireVehicleSummary,
} from "@/lib/tires/types";

/**
 * Pneus de um veículo — a aba "Pneus" do Cadastro de Frotas.
 *
 * CONSULTA à rotina `tires_vehicle_summary` (pelo id do veículo, nunca pela
 * placa): a fotografia oficial mais recente do Rodopar, posição a posição no
 * diagrama de eixos (montado do dicionário de posições), e as últimas
 * vistorias de campo. Tratar é na Gestão de Pneus, que abre daqui.
 */
export function VehicleTires({ vehicleId }: { vehicleId: string }) {
  const [attempt, setAttempt] = React.useState(0);
  const [state, setState] = React.useState<{
    id: string;
    attempt: number;
    data: TireVehicleSummary | null;
    error: string | null;
  } | null>(null);
  const [selected, setSelected] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    void loadVehicleTireSummary(vehicleId).then((result) => {
      if (cancelled) return;
      setState({
        id: vehicleId,
        attempt,
        data: result.ok ? (result.data ?? null) : null,
        error: result.ok ? null : (result.error ?? "Não foi possível ler os pneus do veículo."),
      });
    });
    return () => {
      cancelled = true;
    };
  }, [vehicleId, attempt]);

  const current = state && state.id === vehicleId && state.attempt === attempt ? state : null;
  const tires = React.useMemo(() => current?.data?.tires ?? [], [current]);
  const byPosition = React.useMemo(() => {
    const map = new Map<string, TireRow>();
    for (const t of tires) if (t.positionCode) map.set(t.positionCode, t);
    return map;
  }, [tires]);

  if (!current) return <LoadingState label="Carregando pneus do veículo…" />;
  if (current.error) {
    return (
      <ErrorState
        variant="inline"
        title="Não foi possível ler os pneus do veículo"
        description={current.error}
        onRetry={() => setAttempt((n) => n + 1)}
      />
    );
  }

  const data = current.data;
  const baseHref = `${TIRES_BASE_PATH}?aba=base&veiculo=${vehicleId}`;
  if (!data || data.empty) {
    return (
      <EmptyState
        size="sm"
        title={data?.empty ? "Ainda não há fotografia de pneus" : "Veículo fora do seu escopo de pneus"}
        description={
          data?.empty
            ? "A Gestão de Pneus ainda não recebeu uma importação Rodopar 10 confirmada."
            : "Este veículo não está na fotografia de pneus visível para você."
        }
        action={
          <Button asChild size="sm" variant="secondary" trailingIcon={<ArrowUpRight />}>
            <Link href={TIRES_BASE_PATH}>Abrir Gestão de Pneus</Link>
          </Button>
        }
      />
    );
  }

  const positions: AxlePosition[] = (data.positions ?? []).map((p) => ({ ...p }));
  const known = new Set(positions.map((p) => p.code));
  const unplaced = tires.filter((t) => !t.positionCode || !known.has(t.positionCode));
  const chosen = selected ? byPosition.get(selected) ?? null : null;
  const inspections = data.inspections ?? [];

  return (
    <div className="flex flex-col gap-4" data-testid="vehicle-tires">
      <p className="text-caption text-fg-muted">
        Fotografia oficial Rodopar de {formatDate(data.referenceDate)}
        {data.layout ? ` · ${data.layout.layoutName ?? "layout"} (${LAYOUT_SOURCE_LABEL[data.layout.layoutSource] ?? data.layout.layoutSource})` : ""}
        {` · ${fmtInt(tires.length)} ${tires.length === 1 ? "pneu" : "pneus"}`}
      </p>

      {positions.length ? (
        <AxleDiagram
          positions={positions}
          size="sm"
          label="Pneus por posição"
          selected={selected}
          onSelect={(code) => setSelected((s) => (s === code ? null : code))}
          testIdPrefix="vehicle-tire"
          state={(p) => {
            const t = byPosition.get(p.code);
            if (!t) return { caption: "vazio", tone: null, srText: "sem pneu na fotografia" };
            return {
              caption: t.fireNumber,
              tone: SEVERITY_TONE[t.severity],
              srText: `Nº Fogo ${t.fireNumber}, sulco ${fmtMm(t.treadMin)}, ${TREAD_LABEL[t.treadClass]}`,
            };
          }}
        />
      ) : null}

      {chosen ? (
        <dl className="grid grid-cols-2 gap-3 rounded-md border border-border bg-surface p-3 sm:grid-cols-4" data-testid="vehicle-tire-detail">
          <Fact label={`Posição ${chosen.positionCode ?? ""}`}>
            <Link href={`${TIRES_BASE_PATH}/${chosen.tireId}`} className="font-semibold text-fg underline-offset-2 hover:text-primary hover:underline">
              {chosen.fireNumber}
            </Link>
          </Fact>
          <Fact label="Sulco mínimo">
            <span className="flex flex-wrap items-center gap-1.5">
              {fmtMm(chosen.treadMin)}
              <StatusBadge status={TREAD_TONE[chosen.treadClass]} size="sm">{TREAD_LABEL[chosen.treadClass]}</StatusBadge>
            </span>
          </Fact>
          <Fact label="Pressão">
            <span className="flex flex-wrap items-center gap-1.5">
              {fmtPsi(chosen.psi)}
              <StatusBadge status={PSI_TONE[chosen.psiStatus]} size="sm">{PSI_LABEL[chosen.psiStatus]}</StatusBadge>
            </span>
          </Fact>
          <Fact label="Medição · calibragem">
            <span className="flex flex-wrap items-center gap-1.5">
              <StatusBadge status={DEADLINE_TONE[chosen.measurementStatus]} size="sm">MM {DEADLINE_SHORT[chosen.measurementStatus]}</StatusBadge>
              <StatusBadge status={DEADLINE_TONE[chosen.calibrationStatus]} size="sm">PSI {DEADLINE_SHORT[chosen.calibrationStatus]}</StatusBadge>
            </span>
          </Fact>
        </dl>
      ) : positions.length ? (
        <p className="text-caption text-fg-muted">Toque num pneu do diagrama para ver sulco, pressão e prazos.</p>
      ) : null}

      {unplaced.length ? (
        <p className="text-caption text-fg-muted">
          Fora do layout: {unplaced.map((t) => `${t.fireNumber}${t.positionCode ? ` (${t.positionCode})` : ""}`).join(", ")}
        </p>
      ) : null}

      <section aria-labelledby="vehicle-tires-inspections" className="flex flex-col gap-2">
        <h3 id="vehicle-tires-inspections" className="text-label font-semibold text-fg">
          Vistorias de campo
        </h3>
        {inspections.length ? (
          <ul className="flex flex-col divide-y divide-border-subtle rounded-md border border-border bg-surface" aria-label="Últimas vistorias de pneus">
            {inspections.map((i) => (
              <li key={i.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-body-sm">
                <span className="font-mono text-caption font-semibold text-fg">{i.protocol}</span>
                <StatusBadge status={INSPECTION_STATUS_TONE[i.status]} size="sm">{INSPECTION_STATUS_LABEL[i.status]}</StatusBadge>
                <span className="text-caption text-fg-muted">{formatDate(i.inspectionDate)}</span>
                <span className="text-caption text-fg-muted">
                  {fmtInt(i.positionsMeasured)} medidas · {fmtInt(i.positionsDivergent)} com divergência
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-caption text-fg-muted">Nenhuma vistoria de pneus recebida para este veículo.</p>
        )}
        <p className="text-caption text-fg-muted">A vistoria de campo não altera a fotografia oficial: ela é revisada e conciliada com o próximo Rodopar.</p>
      </section>

      <div>
        <Button asChild size="sm" variant="secondary" trailingIcon={<ArrowUpRight />}>
          <Link href={baseHref} data-testid="vehicle-tires-open">
            Abrir na Gestão de Pneus
          </Link>
        </Button>
      </div>
    </div>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className="text-caption text-fg-muted">{label}</dt>
      <dd className="text-body-sm font-medium tabular-nums text-fg">{children}</dd>
    </div>
  );
}
