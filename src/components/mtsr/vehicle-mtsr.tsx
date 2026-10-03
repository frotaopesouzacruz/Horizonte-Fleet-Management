"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/feedback/empty-state";
import { ErrorState } from "@/components/feedback/error-state";
import { LoadingState } from "@/components/feedback/loading-state";
import {
  ComponentStatusBadge,
  ConformityBadge,
  CriticalityBadge,
  DeadlineBadge,
  InspectionStatusBadge,
  VerificationModeBadge,
} from "@/components/mtsr/badges";
import { loadVehicleMtsrSummary } from "@/lib/mtsr/actions";
import { MTSR_BASE_PATH, fmtDays, fmtInt, formatDate, type MtsrVehicleSummary } from "@/lib/mtsr/types";

/**
 * Situação MTSR de um veículo — a aba "MTSR" do Cadastro de Frotas.
 *
 * É uma CONSULTA à rotina `mtsr_vehicle_summary` (pelo id do veículo, nunca
 * pela placa): conformidade, criticidade, prazo, estado oficial por componente
 * e a última vistoria. Tratar o veículo é na ficha MTSR, que abre daqui.
 */

const sheetHref = (vehicleId: string) => `${MTSR_BASE_PATH}/veiculos/${vehicleId}`;

export function VehicleMtsr({ vehicleId }: { vehicleId: string }) {
  const [attempt, setAttempt] = React.useState(0);
  const [state, setState] = React.useState<{
    id: string;
    attempt: number;
    data: MtsrVehicleSummary | null;
    error: string | null;
  } | null>(null);

  // A resposta só vale para o veículo e a tentativa que a pediram; trocar de
  // veículo no meio da leitura descarta a resposta atrasada.
  React.useEffect(() => {
    let cancelled = false;
    void loadVehicleMtsrSummary(vehicleId).then((result) => {
      if (cancelled) return;
      setState({
        id: vehicleId,
        attempt,
        data: result.ok ? (result.data ?? null) : null,
        error: result.ok ? null : (result.error ?? "Não foi possível ler a situação MTSR do veículo."),
      });
    });
    return () => {
      cancelled = true;
    };
  }, [vehicleId, attempt]);

  const current = state && state.id === vehicleId && state.attempt === attempt ? state : null;

  if (!current) return <LoadingState label="Carregando situação MTSR…" />;
  if (current.error) {
    return (
      <ErrorState
        variant="inline"
        title="Não foi possível ler a situação MTSR"
        description={current.error}
        onRetry={() => setAttempt((n) => n + 1)}
      />
    );
  }

  const data = current.data;
  const vehicle = data?.vehicle ?? null;
  if (!data || !vehicle) {
    return (
      <EmptyState
        size="sm"
        title="Veículo fora do escopo do MTSR"
        description="Este veículo não está na frota avaliada pelo MTSR (tipo ou operação não habilitados) ou está fora do seu escopo de acesso."
        action={
          <Button asChild size="sm" variant="secondary" trailingIcon={<ArrowUpRight />}>
            <Link href={MTSR_BASE_PATH}>Abrir Gestão de MTSR</Link>
          </Button>
        }
      />
    );
  }

  const last = data.lastInspection;

  return (
    <div className="flex flex-col gap-4" data-testid="vehicle-mtsr">
      <div className="flex flex-wrap items-center gap-1.5" data-testid="vehicle-mtsr-status">
        <ConformityBadge value={vehicle.conformityStatus} />
        <CriticalityBadge value={vehicle.criticality} />
        <DeadlineBadge value={vehicle.deadlineStatus} />
      </div>

      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Fact label="Última vistoria válida">{formatDate(vehicle.lastValidInspectionDate)}</Fact>
        <Fact label="Dias desde a vistoria">{fmtDays(vehicle.daysSince)}</Fact>
        <Fact label="Componentes NOK">{fmtInt(vehicle.nokCount)}</Fact>
        <Fact label="Aguardando revalidação">{fmtInt(vehicle.awaitingCount)}</Fact>
      </dl>

      <section aria-labelledby="vehicle-mtsr-components" className="flex flex-col gap-2">
        <h3 id="vehicle-mtsr-components" className="text-label font-semibold text-fg">
          Componentes
        </h3>
        {data.components.length === 0 ? (
          <p className="text-caption text-fg-muted">Nenhum componente ativo no catálogo do MTSR.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-border-subtle rounded-md border border-border bg-surface" aria-label="Componentes MTSR">
            {data.components.map((c) => (
              <li key={c.componentId} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-3 py-2 text-body-sm">
                <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                  <span className="font-medium text-fg">{c.name}</span>
                  <VerificationModeBadge value={c.verificationMode} size="sm" />
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-caption tabular-nums text-fg-muted">{formatDate(c.referenceDate)}</span>
                  <ComponentStatusBadge value={c.status} awaiting={c.awaitingRevalidation} size="sm" />
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="vehicle-mtsr-last-inspection" className="flex flex-col gap-2">
        <h3 id="vehicle-mtsr-last-inspection" className="text-label font-semibold text-fg">
          Última vistoria
        </h3>
        {last ? (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-border bg-surface px-3 py-2 text-body-sm">
            <span className="font-mono text-caption font-semibold text-fg">{last.protocol}</span>
            <InspectionStatusBadge value={last.status} size="sm" />
            <span className="text-caption text-fg-muted">{formatDate(last.inspectionDate)}</span>
            <span className="text-caption text-fg-muted">{last.nokCount === 0 ? "Sem NOK" : last.nokCount === 1 ? "1 NOK" : `${fmtInt(last.nokCount)} NOK`}</span>
          </div>
        ) : (
          <p className="text-caption text-fg-muted">Nenhuma vistoria recebida para este veículo.</p>
        )}
      </section>

      <p className="text-caption text-fg-muted">
        A conclusão de uma manutenção não torna o componente OK: ele fica Aguardando revalidação até nova vistoria ou leitura.
      </p>

      <div>
        <Button asChild size="sm" variant="secondary" trailingIcon={<ArrowUpRight />}>
          <Link href={sheetHref(vehicleId)} data-testid="vehicle-mtsr-open-sheet">
            Abrir ficha MTSR
          </Link>
        </Button>
      </div>
    </div>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-caption text-fg-muted">{label}</dt>
      <dd className="text-body-sm font-medium tabular-nums text-fg">{children}</dd>
    </div>
  );
}
