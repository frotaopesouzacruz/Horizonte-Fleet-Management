"use client";

import * as React from "react";
import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { ChartCard } from "@/components/charts/chart-card";
import { Badge } from "@/components/ui/badge";
import { SearchField } from "@/components/ui/search-field";
import { Switch } from "@/components/ui/switch";
import {
  Table, TableBody, TableCaption, TableCell, TableContainer, TableEmpty, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/cn";
import type { KmAnalysisCohort, KmAnalysisData, KmAnalysisVehicle } from "@/lib/km/analysis";
import {
  byCode, fmt1, fmtInt, fmtKm, fmtKm1, fmtPct, KM_BAND, KM_OUTLIER, KM_OUTLIER_TAG, KM_QUADRANT,
} from "@/lib/km/types";
import type { KmPanelContext } from "../../shared";
import {
  MarkerSwatch, QUADRANT_ORDER, QuadrantChart, type QuadrantPoint,
} from "./quadrant-chart";
import { signedNum, signedPct, SortHead, ToneBadge, useSorted, useUrlParam } from "./shared";

/**
 * Análise gerencial → Dispersão & outliers por coorte técnica.
 *
 * Coorte = tipo · subcategoria · modelo (N1), com recuo para N2/N3 quando o
 * grupo fino é pequeno. Estatísticas sobre KM/dia dos veículos elegíveis
 * (cobertura mínima). Faixa por z robusto (mediana/MAD), ponto para análise
 * pela cerca de IQR — nunca "erro". Tudo devolvido pela rotina.
 */
export const vehicleLocal = (v: Pick<KmAnalysisVehicle, "operation" | "local" | "br">) =>
  [v.operation, v.local, v.br].filter(Boolean).join(" · ") || "Sem local";

function defaultCohort(cohorts: KmAnalysisCohort[]): string {
  const best = [...cohorts].sort(
    (a, b) => Number(b.sufficient) - Number(a.sufficient) || (b.eligible ?? 0) - (a.eligible ?? 0) || a.label.localeCompare(b.label),
  )[0];
  return best?.key ?? "";
}

type VKey = "plate" | "model" | "local" | "odometer" | "kmPeriod" | "dailyAvg" | "coverage" | "deviation" | "percentile" | "z";

const V_ACCESSORS: Record<VKey, (v: KmAnalysisVehicle) => number | string | null> = {
  plate: (v) => v.plate,
  model: (v) => v.model,
  local: (v) => vehicleLocal(v),
  odometer: (v) => v.odometer,
  kmPeriod: (v) => v.kmPeriod,
  dailyAvg: (v) => v.dailyAvg,
  coverage: (v) => v.coveragePct,
  deviation: (v) => v.deviationPct,
  percentile: (v) => v.dailyPercentile,
  z: (v) => v.robustZ,
};

export function DispersionView({ data, ctx }: { data: KmAnalysisData; ctx: KmPanelContext }) {
  const cohorts = React.useMemo(() => data.cohorts ?? [], [data.cohorts]);
  const vehicles = React.useMemo(() => data.vehicles ?? [], [data.vehicles]);
  const fallback = React.useMemo(() => defaultCohort(cohorts), [cohorts]);
  const [requested, setCohort] = useUrlParam(ctx, "coorte", fallback);
  const cohort = cohorts.find((c) => c.key === requested) ?? cohorts.find((c) => c.key === fallback) ?? null;

  if (cohorts.length === 0) {
    return (
      <p className="rounded-md border border-dashed border-border px-4 py-8 text-center text-body-sm text-fg-muted">
        Nenhuma coorte técnica com veículos no período e filtros escolhidos.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-4" data-testid="km-analise-dispersao">
      <QuadrantTiles quadrants={data.quadrants} />
      <div className="grid gap-4 xl:grid-cols-[minmax(17rem,22rem)_minmax(0,1fr)]">
        <CohortList cohorts={cohorts} selected={cohort?.key ?? null} onSelect={setCohort} />
        {cohort ? (
          <CohortDetail key={cohort.key} cohort={cohort} vehicles={vehicles.filter((v) => v.cohortKey === cohort.key)} />
        ) : null}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
function QuadrantTiles({ quadrants }: { quadrants: Record<string, number> | undefined }) {
  return (
    <section aria-labelledby="km-quadrantes-titulo" className="flex flex-col gap-2">
      <h3 id="km-quadrantes-titulo" className="text-label font-semibold text-fg">
        Quadrantes — todas as coortes com base suficiente
      </h3>
      <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-4" data-testid="km-analise-quadrantes">
        {QUADRANT_ORDER.map((code) => {
          const meta = KM_QUADRANT[code];
          return (
            <li key={code} className="flex min-w-0 items-start gap-2.5 rounded-lg border border-border bg-surface-raised px-3 py-2.5 shadow-card">
              <span className="mt-1"><MarkerSwatch code={code} /></span>
              <div className="min-w-0">
                <p className="flex items-baseline gap-2">
                  <span className="text-h3 font-semibold text-fg tabular-nums">{fmtInt(byCode(quadrants, code) ?? 0)}</span>
                  <span className="text-body-sm font-medium text-fg">{meta.label}</span>
                </p>
                <p className="text-caption text-fg-muted">{meta.hint}</p>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

// ---------------------------------------------------------------------------
function CohortList({
  cohorts, selected, onSelect,
}: {
  cohorts: KmAnalysisCohort[];
  selected: string | null;
  onSelect: (key: string) => void;
}) {
  return (
    <section
      aria-labelledby="km-coortes-titulo"
      className="flex min-w-0 flex-col rounded-lg border border-border bg-surface-raised shadow-card"
    >
      <header className="flex items-baseline justify-between gap-2 border-b border-border bg-surface-secondary px-3 py-2 rounded-t-lg">
        <h3 id="km-coortes-titulo" className="text-label font-semibold text-fg">Coortes técnicas</h3>
        <span className="text-caption text-fg-muted">{fmtInt(cohorts.length)}</span>
      </header>
      <ul className="flex max-h-[34rem] flex-col overflow-y-auto p-1.5" data-testid="km-analise-coortes">
        {cohorts.map((c) => {
          const active = c.key === selected;
          return (
            <li key={c.key}>
              <button
                type="button"
                aria-pressed={active}
                onClick={() => onSelect(c.key)}
                data-testid="km-analise-coorte"
                className={cn(
                  "flex w-full flex-col gap-1 rounded-md border border-transparent px-2.5 py-2 text-left hfm-transition hfm-focus-ring",
                  "hover:bg-hover-overlay",
                  active && "border-primary bg-primary-soft hover:bg-primary-soft",
                )}
              >
                <span className="flex min-w-0 items-start justify-between gap-2">
                  <span className="min-w-0 text-body-sm font-medium text-fg">{c.label}</span>
                  {c.level ? (
                    <Badge size="sm" variant="neutral" appearance="outline" title="Nível da coorte (N1 = tipo · subcategoria · modelo)">
                      {c.level}
                    </Badge>
                  ) : null}
                </span>
                <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-caption text-fg-muted">
                  <span className="tabular-nums">{fmtInt(c.vehicles)} frota(s)</span>
                  <span aria-hidden>·</span>
                  <span className="tabular-nums">{fmtInt(c.eligible)} elegível(is)</span>
                  {c.outliers ? (
                    <>
                      <span aria-hidden>·</span>
                      <span className="tabular-nums">{fmtInt(c.outliers)} ponto(s) para análise</span>
                    </>
                  ) : null}
                </span>
                <span>
                  {c.sufficient ? (
                    <ToneBadge tone="success">Base suficiente</ToneBadge>
                  ) : (
                    <ToneBadge tone="neutral">Coorte insuficiente</ToneBadge>
                  )}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

// ---------------------------------------------------------------------------
function Stat({ label, value, hint }: { label: string; value: React.ReactNode; hint?: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5 bg-surface-raised px-3 py-2">
      <dt className="truncate text-caption text-fg-muted">{label}</dt>
      <dd className="text-body font-semibold text-fg tabular-nums">{value}</dd>
      {hint != null ? <dd className="text-caption text-fg-muted">{hint}</dd> : null}
    </div>
  );
}

function OdometerIqrTrend({ current, previous }: { current: number | null; previous: number | null }) {
  if (current == null || previous == null) return <span className="text-caption text-fg-muted">Sem período anterior comparável</span>;
  const dir = current > previous ? "up" : current < previous ? "down" : "flat";
  const Icon = dir === "up" ? ArrowUpRight : dir === "down" ? ArrowDownRight : Minus;
  const text = dir === "up" ? "Dispersão aumentou" : dir === "down" ? "Dispersão diminuiu" : "Dispersão estável";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 text-caption font-medium",
        dir === "up" ? "text-warning-soft-fg" : dir === "down" ? "text-success-soft-fg" : "text-fg-muted",
      )}
    >
      <Icon className="size-3.5" aria-hidden />
      {text} (anterior {fmtKm(previous)})
    </span>
  );
}

function CohortDetail({ cohort, vehicles }: { cohort: KmAnalysisCohort; vehicles: KmAnalysisVehicle[] }) {
  const [onlyFlagged, setOnlyFlagged] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const listed = React.useMemo(() => {
    const q = query.trim().toUpperCase();
    return vehicles.filter(
      (v) =>
        (!onlyFlagged || v.outlier != null) &&
        (!q || v.plate.toUpperCase().includes(q) || (v.fleetCode ?? "").toUpperCase().includes(q)),
    );
  }, [vehicles, onlyFlagged, query]);
  const { sorted, sort, setSort } = useSorted(listed, V_ACCESSORS, { key: "dailyAvg", dir: "desc" });

  const points: QuadrantPoint[] = React.useMemo(
    () =>
      vehicles
        .filter((v) => v.odometer != null && v.dailyAvg != null)
        .map((v) => ({
          key: v.vehicleId,
          plate: v.plate,
          subtitle: `${v.model ?? "Modelo não informado"} · ${vehicleLocal(v)}`,
          x: v.odometer as number,
          y: v.dailyAvg as number,
          kmPeriod: v.kmPeriod,
          quadrant: v.quadrant,
        })),
    [vehicles],
  );
  const outside = vehicles.length - points.length;
  const hasUnclassified = points.some((p) => !p.quadrant);
  const flagged = vehicles.filter((v) => v.outlier != null).length;

  return (
    <div className="flex min-w-0 flex-col gap-4" data-testid="km-analise-coorte-detalhe">
      <section aria-labelledby="km-coorte-stats" className="flex flex-col gap-2">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 id="km-coorte-stats" className="text-h4 font-semibold text-fg">
            {cohort.label} {cohort.level ? <span className="text-fg-muted">· {cohort.level}</span> : null}
          </h3>
          <span className="text-caption text-fg-muted">
            {fmtInt(cohort.eligible)} de {fmtInt(cohort.vehicles)} frota(s) elegíveis · estatísticas em KM/dia
          </span>
        </div>
        {!cohort.sufficient ? (
          <p className="rounded-md border border-border bg-neutral-soft px-3 py-2 text-body-sm text-neutral-soft-fg">
            Coorte com menos frotas elegíveis que o mínimo configurado: faixa, quadrantes e pontos para análise não se
            aplicam. Os números abaixo são só descritivos.
          </p>
        ) : null}
        <dl
          className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-border bg-border-subtle shadow-card sm:grid-cols-4 lg:grid-cols-7"
          data-testid="km-analise-coorte-estatisticas"
        >
          <Stat label="Média" value={fmt1(cohort.mean)} />
          <Stat label="Mediana" value={fmt1(cohort.median)} />
          <Stat label="Q1" value={fmt1(cohort.q1)} />
          <Stat label="Q3" value={fmt1(cohort.q3)} />
          <Stat label="P10" value={fmt1(cohort.p10)} />
          <Stat label="P90" value={fmt1(cohort.p90)} />
          <Stat label="IQR" value={fmt1(cohort.iqr)} />
          <Stat label="Mínimo" value={fmt1(cohort.min)} />
          <Stat label="Máximo" value={fmt1(cohort.max)} />
          <Stat label="Amplitude" value={fmt1(cohort.range)} />
          <Stat label="Coef. de dispersão" value={fmtPct(cohort.cvPct)} />
          <Stat label="Hodômetro mediano" value={fmtKm(cohort.odometerMedian)} />
          <Stat
            label="IQR do hodômetro"
            value={fmtKm(cohort.odometerIqr)}
            hint={<OdometerIqrTrend current={cohort.odometerIqr} previous={cohort.odometerIqrPrevious} />}
          />
          <Stat label="Acima do P90" value={fmtInt(cohort.aboveP90 ?? null)} hint="frota(s)" />
        </dl>
      </section>

      <ChartCard
        title="Quadrantes da coorte"
        description="Hodômetro acumulado × KM/dia no período. Tracejados nas medianas da coorte."
        legend={
          <ul aria-label="Legenda" className="flex flex-wrap items-center gap-x-4 gap-y-1 text-caption text-fg-secondary">
            {QUADRANT_ORDER.map((code) => (
              <li key={code} className="inline-flex items-center gap-1.5">
                <MarkerSwatch code={code} />
                {KM_QUADRANT[code].label}
              </li>
            ))}
            {hasUnclassified ? (
              <li className="inline-flex items-center gap-1.5">
                <MarkerSwatch code={null} />
                Sem quadrante
              </li>
            ) : null}
            <li className="inline-flex items-center gap-1.5">
              <span aria-hidden className="inline-flex w-4 items-center">
                <span className="h-0 w-full border-t-2 border-dashed" style={{ borderColor: "var(--chart-crosshair)" }} />
              </span>
              Medianas da coorte
            </li>
          </ul>
        }
        empty={points.length === 0 ? "Nenhuma frota da coorte tem hodômetro e KM/dia no período." : undefined}
        insight={
          outside > 0
            ? `${fmtInt(outside)} frota(s) da coorte fora do gráfico por falta de hodômetro ou de leituras suficientes no período.`
            : undefined
        }
        data-testid="km-analise-quadrantes-grafico"
      >
        <QuadrantChart
          points={points}
          medianX={cohort.odometerMedian}
          medianY={cohort.median}
          ariaLabel={`Quadrantes da coorte ${cohort.label}: hodômetro acumulado por KM/dia`}
          caption={`Frotas da coorte ${cohort.label} por quadrante`}
        />
        {hasUnclassified ? (
          <p className="mt-2 text-caption text-fg-muted">
            Pontos vazados (sem quadrante): coorte insuficiente ou frota sem base para classificar.
          </p>
        ) : null}
      </ChartCard>

      <section aria-labelledby="km-coorte-frotas" className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 id="km-coorte-frotas" className="text-label font-semibold text-fg">
            Frotas da coorte <span className="font-normal text-fg-muted">({fmtInt(listed.length)})</span>
          </h3>
          <div className="flex flex-wrap items-center gap-3">
            <SearchField
              size="sm"
              wrapperClassName="w-44"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onClear={() => setQuery("")}
              aria-label="Buscar placa ou frota na coorte"
              placeholder="Placa ou frota"
              data-testid="km-analise-coorte-busca"
            />
            <label className="inline-flex items-center gap-2 text-body-sm text-fg-secondary">
              <Switch
                checked={onlyFlagged}
                onCheckedChange={setOnlyFlagged}
                disabled={flagged === 0}
                data-testid="km-analise-coorte-so-pontos"
              />
              Só pontos para análise ({fmtInt(flagged)})
            </label>
          </div>
        </div>
        <TableContainer>
          <Table className="min-w-[1360px]" data-testid="km-analise-coorte-tabela">
            <TableCaption>
              Desvio = KM/dia da frota contra a mediana da coorte. Z robusto = (KM/dia − mediana) ÷ MAD × 0,6745. Ponto para
              análise é um sinal estatístico, não um erro.
            </TableCaption>
            <TableHeader>
              <TableRow>
                <SortHead sortKey="plate" sort={sort} onSort={setSort} className="w-28">Placa</SortHead>
                <SortHead sortKey="model" sort={sort} onSort={setSort} className="w-36">Modelo</SortHead>
                <SortHead sortKey="local" sort={sort} onSort={setSort} className="w-44">Local</SortHead>
                <SortHead sortKey="odometer" sort={sort} onSort={setSort} numeric>Hodômetro</SortHead>
                <SortHead sortKey="kmPeriod" sort={sort} onSort={setSort} numeric>KM do período</SortHead>
                <SortHead sortKey="dailyAvg" sort={sort} onSort={setSort} numeric>KM/dia</SortHead>
                <SortHead sortKey="coverage" sort={sort} onSort={setSort} numeric>Cobertura</SortHead>
                <TableHead numeric>Mediana coorte</TableHead>
                <SortHead sortKey="deviation" sort={sort} onSort={setSort} numeric>Desvio</SortHead>
                <SortHead sortKey="percentile" sort={sort} onSort={setSort} numeric>Percentil</SortHead>
                <SortHead sortKey="z" sort={sort} onSort={setSort} numeric>Z robusto</SortHead>
                <TableHead className="w-44">Faixa</TableHead>
                <TableHead className="w-52">Ponto para análise</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sorted.length === 0 ? (
                <TableEmpty colSpan={13} message="Nenhuma frota para os critérios escolhidos." />
              ) : (
                sorted.map((v) => {
                  const band = v.band ? KM_BAND[v.band] : null;
                  return (
                    <TableRow key={v.vehicleId} data-testid="km-analise-coorte-linha">
                      <TableCell className="font-medium">
                        <span className="flex flex-col leading-tight">
                          <span>{v.plate}</span>
                          {v.fleetCode && v.fleetCode !== v.plate ? (
                            <span className="text-caption text-fg-muted">{v.fleetCode}</span>
                          ) : null}
                        </span>
                      </TableCell>
                      <TableCell truncate title={v.model ?? undefined} className="max-w-36">{v.model ?? "—"}</TableCell>
                      <TableCell truncate title={vehicleLocal(v)} className="max-w-44">{vehicleLocal(v)}</TableCell>
                      <TableCell numeric>{fmtKm(v.odometer)}</TableCell>
                      <TableCell numeric>{v.kmPeriod == null ? "Sem leitura" : fmtKm1(v.kmPeriod)}</TableCell>
                      <TableCell numeric className="font-medium">{fmt1(v.dailyAvg)}</TableCell>
                      <TableCell numeric>{fmtPct(v.coveragePct)}</TableCell>
                      <TableCell numeric>{fmt1(v.cohortDailyMedian)}</TableCell>
                      <TableCell numeric>{signedPct(v.deviationPct)}</TableCell>
                      <TableCell numeric>{v.dailyPercentile == null ? "—" : `P${fmtInt(v.dailyPercentile)}`}</TableCell>
                      <TableCell numeric>{signedNum(v.robustZ)}</TableCell>
                      <TableCell>
                        {band ? <ToneBadge tone={band.tone}>{band.label}</ToneBadge> : <span className="text-fg-muted">—</span>}
                      </TableCell>
                      <TableCell>
                        {v.outlier ? (
                          <span className="flex flex-col items-start gap-0.5">
                            <ToneBadge tone={v.outlier === "low_coverage" ? "neutral" : "warning"} testId="km-analise-ponto">
                              {KM_OUTLIER_TAG.toUpperCase()}
                            </ToneBadge>
                            <span className="text-caption text-fg-secondary">{KM_OUTLIER[v.outlier] ?? v.outlier}</span>
                          </span>
                        ) : (
                          <span className="text-fg-muted">—</span>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </TableContainer>
        <p className="text-caption text-fg-muted">
          KM/dia, mediana e desvio em km por dia. Hodômetro = último hodômetro válido até o fim do período; local = contexto da
          última leitura. Veículo sem cobertura mínima fica fora das estatísticas e não é tratado como baixa utilização.
        </p>
      </section>
    </div>
  );
}
