"use client";

import * as React from "react";
import { CalendarRange, Truck, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DateInput } from "@/components/ui/date-input";
import { SectionHeader } from "@/components/layout/section-header";
import { EmptyState } from "@/components/feedback/empty-state";
import { ErrorState } from "@/components/feedback/error-state";
import type { KmHistoryData } from "@/lib/km/history";
import type { KmPanelContext } from "../shared";
import { KmCorrectionDialog, type KmCorrectionTarget } from "../components/correction-dialog";
import { VehiclePicker } from "./history/vehicle-picker";
import { KmPerDayChart, OdometerChart } from "./history/history-charts";
import { DailyTable, MonthlyTable } from "./history/history-tables";
import { AuditTrail, HistoryKpis, PreventiveCard, ProjectionCard, VehicleHeader } from "./history/history-cards";
import { fullDate, monthFull } from "./history/format";

/**
 * Gestão de KM → Histórico por frota.
 *
 * Um veículo, um período: KPIs, hodômetro e KM por dia, quadro mensal, dia a
 * dia (com correção auditada para quem pode), projeção, preventiva e trilha.
 * Tudo vem de `km_vehicle_history`; a tela só apresenta. Veículo e período
 * moram na URL (`veiculo`, `de`, `ate`).
 */
export function HistoryPanel({ data, ctx }: { data: KmHistoryData | null; ctx: KmPanelContext }) {
  const vehicleId = data?.request?.vehicleId ?? firstId(ctx.params.veiculo);
  const from = data?.request?.from ?? ctx.params.de ?? "";
  const to = data?.request?.to ?? ctx.params.ate ?? "";
  const periodKey = `${vehicleId ?? ""}|${from}|${to}`;

  return (
    <div className="flex flex-col gap-5" data-testid="km-historico">
      <Toolbar ctx={ctx} vehicleId={vehicleId} from={from} to={to} resolved={data?.period} />

      {ctx.error ? (
        <ErrorState
          title="Não foi possível carregar o histórico"
          description={ctx.error}
          onRetry={ctx.refresh}
          retrying={ctx.pending}
          data-testid="km-historico-error"
        />
      ) : !data?.vehicle ? (
        <EmptyState
          icon={<Truck />}
          title="Escolha um veículo"
          description="Selecione uma placa ou frota acima para ver o histórico de KM, a projeção e a trilha de auditoria."
          data-testid="km-historico-empty"
        />
      ) : (
        <HistoryContent key={periodKey} data={data} ctx={ctx} />
      )}
    </div>
  );
}

const firstId = (value: string | undefined) =>
  (value ?? "")
    .split(",")
    .map((v) => v.trim())
    .find(Boolean) ?? null;

// ---------------------------------------------------------------------------
// Barra: veículo e período
// ---------------------------------------------------------------------------
function Toolbar({
  ctx, vehicleId, from, to, resolved,
}: {
  ctx: KmPanelContext;
  vehicleId: string | null;
  from: string;
  to: string;
  resolved?: { from: string; to: string };
}) {
  const hasPeriod = Boolean(from || to);
  const fromId = React.useId();
  const toId = React.useId();
  const vehicleFieldId = React.useId();
  return (
    <section
      aria-label="Veículo e período do histórico"
      className="flex flex-wrap items-end gap-3 rounded-lg border border-border bg-surface-raised p-3 shadow-card"
      data-testid="km-historico-toolbar"
    >
      <div className="flex min-w-0 flex-1 basis-64 flex-col gap-1">
        <label htmlFor={vehicleFieldId} className="text-caption text-fg-muted">Veículo</label>
        <VehiclePicker
          id={vehicleFieldId}
          vehicles={ctx.options.vehicles}
          value={vehicleId}
          disabled={ctx.pending}
          onChange={(id) => ctx.navigate({ veiculo: id })}
        />
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor={fromId} className="text-caption text-fg-muted">De</label>
        <DateInput
          id={fromId}
          size="sm"
          value={from}
          max={to || undefined}
          disabled={ctx.pending}
          onChange={(e) => ctx.navigate({ de: e.target.value || null })}
          wrapperClassName="w-40"
          data-testid="km-historico-from"
        />
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor={toId} className="text-caption text-fg-muted">Até</label>
        <DateInput
          id={toId}
          size="sm"
          value={to}
          min={from || undefined}
          disabled={ctx.pending}
          onChange={(e) => ctx.navigate({ ate: e.target.value || null })}
          wrapperClassName="w-40"
          data-testid="km-historico-to"
        />
      </div>
      {hasPeriod ? (
        <Button
          variant="ghost"
          size="sm"
          leadingIcon={<X aria-hidden />}
          onClick={() => ctx.navigate({ de: null, ate: null })}
          disabled={ctx.pending}
          data-testid="km-historico-clear-period"
        >
          Limpar período
        </Button>
      ) : null}
      <p className="flex basis-full items-center gap-1.5 text-caption text-fg-muted">
        <CalendarRange aria-hidden className="size-3.5" />
        {resolved
          ? `Exibindo ${fullDate(resolved.from)} a ${fullDate(resolved.to)}.`
          : "Sem período informado, o histórico mostra os últimos 6 meses até a última leitura."}{" "}
        Intervalos acima de 400 dias são limitados aos 400 dias finais.
      </p>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Conteúdo
// ---------------------------------------------------------------------------
function HistoryContent({ data, ctx }: { data: KmHistoryData; ctx: KmPanelContext }) {
  const vehicle = data.vehicle!;
  const daily = React.useMemo(() => data.daily ?? [], [data.daily]);
  const monthly = data.monthly ?? [];
  const months = React.useMemo(() => {
    const seen = new Set<string>();
    for (const d of daily) seen.add(d.day.slice(0, 7));
    return [...seen].sort();
  }, [daily]);
  const [month, setMonth] = React.useState<string | null>(() => {
    // Mês em foco: o da última leitura; sem leitura, o último já decorrido.
    const withReading = daily.filter((d) => d.status !== "future" && d.status !== "no_reading");
    const past = daily.filter((d) => d.status !== "future");
    return (withReading.at(-1) ?? past.at(-1) ?? daily.at(-1))?.day.slice(0, 7) ?? null;
  });

  const [target, setTarget] = React.useState<KmCorrectionTarget | null>(null);
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const canCorrect = Boolean(data.canCorrect && ctx.perms.correct);
  const monthDays = React.useMemo(() => (month ? daily.filter((d) => d.day.startsWith(month)) : daily), [daily, month]);

  return (
    <div className="flex flex-col gap-5">
      <VehicleHeader vehicle={vehicle} period={data.period} kpis={data.kpis} />

      {data.kpis ? <HistoryKpis kpis={data.kpis} /> : null}

      {daily.length === 0 ? (
        <EmptyState
          title="Sem dias no período"
          description="A grade deste veículo está vazia no intervalo escolhido."
          data-testid="km-historico-no-days"
        />
      ) : (
        <>
          <section className="flex flex-col gap-3" aria-label="Evolução diária">
            <SectionHeader
              title="Evolução diária"
              description="Dias sem leitura ficam sem ponto e sem barra: ausência de dado não é 0 km."
            />
            <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
              <OdometerChart daily={daily} plate={vehicle.plate} />
              <KmPerDayChart daily={daily} month={month} months={months} onMonthChange={setMonth} />
            </div>
          </section>

          <section className="flex flex-col gap-3" aria-label="Quadro mensal">
            <SectionHeader title="Mês a mês" description="KM validado, dias com e sem leitura e ritmo diário de cada mês do período." />
            <MonthlyTable monthly={monthly} />
          </section>

          <section className="flex flex-col gap-3" aria-label="Dia a dia">
            <SectionHeader
              title="Dia a dia"
              description={
                month
                  ? `Leituras de ${monthFull(month)}, mais recentes primeiro. Troque o mês no gráfico “KM por dia”.`
                  : "Leituras do período, mais recentes primeiro."
              }
            />
            <DailyTable
              days={monthDays}
              plate={vehicle.plate}
              canCorrect={canCorrect}
              onCorrect={(t) => {
                setTarget(t);
                setDialogOpen(true);
              }}
            />
          </section>
        </>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <ProjectionCard projection={data.projection} />
        <PreventiveCard preventive={data.preventive} />
      </div>

      {ctx.perms.audit && data.audit ? <AuditTrail audit={data.audit} /> : null}

      {canCorrect ? (
        <KmCorrectionDialog
          target={target}
          open={dialogOpen}
          onOpenChange={(open) => {
            setDialogOpen(open);
            if (!open) setTarget(null);
          }}
          onDone={() => ctx.refresh()}
          allowReview={target?.status === "pending_review"}
        />
      ) : null}
    </div>
  );
}
