"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { EmptyState } from "@/components/feedback/empty-state";
import { ErrorState } from "@/components/feedback/error-state";
import { LoadingState } from "@/components/feedback/loading-state";
import { VehicleCroqui, croquiLayout } from "@/components/tires/vehicle-croqui";
import { loadVehicleTireSummary } from "@/lib/tires/actions";
import {
  INSPECTION_STATUS_LABEL,
  INSPECTION_STATUS_TONE,
  LAYOUT_SOURCE_LABEL,
  TIRES_BASE_PATH,
  fmtInt,
  formatDate,
  type TireVehicleSummary,
} from "@/lib/tires/types";

/**
 * Pneus de um veículo — a aba "Pneus" do Cadastro de Frotas.
 *
 * CONSULTA à rotina `tires_vehicle_summary` (pelo id do veículo, nunca pela
 * placa): a base oficial (Rodopar) mais recente, posição a posição no croqui
 * do veículo (`VehicleCroqui`, montado do layout e do dicionário de posições)
 * e as últimas vistorias de campo. Tratar é na Gestão de Pneus, que abre daqui.
 */
export function VehicleTires({ vehicleId }: { vehicleId: string }) {
  const [attempt, setAttempt] = React.useState(0);
  const [state, setState] = React.useState<{
    id: string;
    attempt: number;
    data: TireVehicleSummary | null;
    error: string | null;
  } | null>(null);

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
  const positions = React.useMemo(() => current?.data?.positions ?? [], [current]);
  const layout = React.useMemo(() => croquiLayout(current?.data?.layout), [current]);

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
  // sem agrupamento: a única frota do recorte já abre com o croqui
  const baseHref = `${TIRES_BASE_PATH}?aba=base&veiculo=${vehicleId}&agrupar=nenhum`;
  if (!data || data.empty) {
    return (
      <EmptyState
        size="sm"
        title={data?.empty ? "Ainda não há dados de pneus" : "Veículo fora do seu escopo de pneus"}
        description={
          data?.empty
            ? "A Gestão de Pneus ainda não recebeu a base oficial (Rodopar)."
            : "Este veículo não está nos dados de pneus visíveis para você."
        }
        action={
          <Button asChild size="sm" variant="secondary" trailingIcon={<ArrowUpRight />}>
            <Link href={TIRES_BASE_PATH}>Abrir Gestão de Pneus</Link>
          </Button>
        }
      />
    );
  }

  const inspections = data.inspections ?? [];

  return (
    <div className="flex flex-col gap-4" data-testid="vehicle-tires">
      <p className="text-caption text-fg-muted">
        Base oficial (Rodopar), dados de {formatDate(data.referenceDate)}
        {data.layout ? ` · ${data.layout.layoutName ?? "layout"} (${LAYOUT_SOURCE_LABEL[data.layout.layoutSource] ?? data.layout.layoutSource})` : ""}
        {` · ${fmtInt(tires.length)} ${tires.length === 1 ? "pneu" : "pneus"}`}
      </p>

      {positions.length || tires.length ? (
        <VehicleCroqui
          positions={positions}
          positionsScope="vehicle"
          layout={layout}
          tires={tires}
          size="sm"
          label="Croqui dos pneus do veículo: posições"
          className="md:flex-col md:items-stretch"
        />
      ) : (
        <p className="text-caption text-fg-muted">Nenhum pneu em uso neste veículo nos dados atuais.</p>
      )}

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
        <p className="text-caption text-fg-muted">A vistoria de campo não altera a base oficial: ela é revisada e conciliada com o próximo Rodopar.</p>
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

