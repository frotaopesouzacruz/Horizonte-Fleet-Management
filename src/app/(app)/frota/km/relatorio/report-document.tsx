import * as React from "react";
import { BrandLogo } from "@/components/brand/brand-logo";
import { cn } from "@/lib/cn";
import { byCode, fmt1, fmtInt, fmtKm, fmtKm1, fmtPct, KM_QUADRANT } from "@/lib/km/types";
import type { KmFilterSummaryItem } from "./filter-summary";
import { locationRows, type ManagementReport, type ReportRankedVehicle } from "./report-data";
import { COHORT_LEVEL, NO_READING_NOTE, outlierLabel, OUTLIER_NOTE, PARITY_NOTE, REPORT_TITLE, TONE_LABEL } from "./labels";

/**
 * Relatório Gerencial — versão imprimível (A4). Só apresenta o que
 * `km_overview` e `km_analysis` devolveram; ordenar e recortar para caber na
 * página é o único tratamento.
 */

const br = (iso: string | null | undefined) =>
  iso && /^\d{4}-\d{2}-\d{2}/.test(iso) ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : "—";

function Section({ title, description, children, testId }: { title: string; description?: string; children: React.ReactNode; testId?: string }) {
  return (
    <section className="flex flex-col gap-2 break-inside-avoid-page" data-testid={testId}>
      <div className="border-b-2 border-highlight pb-1">
        <h2 className="text-body font-semibold uppercase tracking-wide text-primary">{title}</h2>
        {description ? <p className="text-caption text-fg-muted">{description}</p> : null}
      </div>
      {children}
    </section>
  );
}

interface Col<T> {
  header: string;
  numeric?: boolean;
  cell: (row: T) => React.ReactNode;
}

function ReportTable<T>({ cols, rows, rowKey, empty, caption }: { cols: Col<T>[]; rows: T[]; rowKey: (row: T, i: number) => string; empty: string; caption: string }) {
  return (
    <div className="w-full overflow-x-auto">
      <table className="w-full border-collapse text-caption">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="bg-primary text-primary-fg">
            {cols.map((c) => (
              <th key={c.header} scope="col" className={cn("px-2 py-1.5 font-semibold", c.numeric ? "text-right" : "text-left")}>
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={cols.length} className="px-2 py-2 text-fg-muted">{empty}</td>
            </tr>
          ) : (
            rows.map((r, i) => (
              <tr key={rowKey(r, i)} className={cn("border-b border-border-subtle break-inside-avoid", i % 2 === 1 && "bg-surface-sunken")}>
                {cols.map((c, ci) =>
                  ci === 0 ? (
                    <th key={c.header} scope="row" className="px-2 py-1 text-left font-medium text-fg">{c.cell(r)}</th>
                  ) : (
                    <td key={c.header} className={cn("px-2 py-1 text-fg", c.numeric && "text-right tabular-nums")}>{c.cell(r)}</td>
                  ),
                )}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

function Tile({ label, value, hint }: { label: string; value: React.ReactNode; hint?: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5 rounded-md border border-border px-3 py-2 break-inside-avoid">
      <span className="text-caption text-fg-muted">{label}</span>
      <span className="text-h4 font-semibold tabular-nums text-fg">{value}</span>
      {hint ? <span className="text-caption text-fg-muted">{hint}</span> : null}
    </div>
  );
}

const plateOf = (v: { plate: string; fleetCode: string | null }) =>
  v.fleetCode && v.fleetCode !== v.plate ? `${v.plate} · ${v.fleetCode}` : v.plate;

function RankTable({ title, rows }: { title: string; rows: ReportRankedVehicle[] }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <h3 className="text-body-sm font-semibold text-fg">{title}</h3>
      <ReportTable
        caption={title}
        rows={rows}
        rowKey={(r) => r.vehicleId}
        empty="Sem veículos."
        cols={[
          { header: "Veículo", cell: (r) => plateOf(r) },
          { header: "Modelo", cell: (r) => r.model ?? "—" },
          { header: "KM", numeric: true, cell: (r) => fmtKm1(r.km) },
          { header: "Dias c/ leitura", numeric: true, cell: (r) => fmtInt(r.readingDays) },
          { header: "Média/dia", numeric: true, cell: (r) => fmtKm1(r.avgDaily) },
        ]}
      />
    </div>
  );
}

export function ReportDocument({
  report,
  periodText,
  filters,
  generatedAt,
  responsible,
  organizationName,
}: {
  report: ManagementReport;
  periodText: string;
  filters: KmFilterSummaryItem[];
  generatedAt: string;
  responsible: string;
  organizationName: string;
}) {
  const ov = report.overview;
  const an = report.analysis;
  const k = ov?.kpis;
  const insights = [...(ov?.insights ?? []), ...(an?.insights ?? [])];
  const outliers = (an?.vehicles ?? [])
    .filter((v) => v.outlier && v.outlier !== "low_coverage")
    .sort((a, b) => Math.abs(b.deviationPct ?? 0) - Math.abs(a.deviationPct ?? 0));
  const preventiveSoon = (an?.vehicles ?? [])
    .filter((v) => v.preventive && v.preventive.daysEstimate != null && v.preventive.daysEstimate <= 30)
    .sort((a, b) => (a.preventive?.daysEstimate ?? 0) - (b.preventive?.daysEstimate ?? 0));
  const preventiveOverdue = (an?.vehicles ?? []).filter(
    (v) => v.preventive && v.preventive.kmRemaining != null && v.preventive.kmRemaining <= 0,
  );

  return (
    <article
      data-km-report
      aria-label={REPORT_TITLE}
      className="mx-auto flex w-full max-w-[210mm] flex-col gap-6 rounded-lg border border-border bg-surface-raised p-6 text-fg shadow-card sm:p-[12mm]"
      data-testid="km-relatorio"
    >
      {/* Cabeçalho */}
      <div className="flex flex-wrap items-start justify-between gap-4 border-b-2 border-highlight pb-4">
        <div className="flex items-center gap-4">
          <BrandLogo variant="light" height={52} alt="Horizonte" />
          <div className="flex flex-col gap-0.5">
            <h1 className="text-h3 font-semibold text-primary">{REPORT_TITLE}</h1>
            <p className="text-body-sm font-medium text-fg">{periodText}</p>
            {ov?.period.referenceDay ? (
              <p className="text-caption text-fg-muted">Dia de referência: {br(ov.period.referenceDay)}</p>
            ) : null}
          </div>
        </div>
        <dl className="flex flex-col gap-0.5 text-right text-caption text-fg-muted">
          <div>
            <dt className="inline">Gerado em </dt>
            <dd className="inline font-medium text-fg">{generatedAt}</dd>
          </div>
          <div>
            <dt className="inline">Responsável: </dt>
            <dd className="inline font-medium text-fg">{responsible}</dd>
          </div>
          <div>
            <dt className="sr-only">Organização</dt>
            <dd>{organizationName}</dd>
          </div>
        </dl>
      </div>

      {report.errors.length ? (
        <p className="rounded-md border border-warning/30 bg-warning-soft px-3 py-2 text-body-sm text-warning-soft-fg" role="note">
          Parte do relatório não pôde ser lida: {report.errors.join(" · ")}
        </p>
      ) : null}

      {/* Filtros */}
      <Section title="Filtros aplicados" testId="km-relatorio-filters">
        {filters.length === 0 ? (
          <p className="text-body-sm text-fg-secondary">Nenhum filtro além do período: todas as frotas visíveis.</p>
        ) : (
          <dl className="grid grid-cols-1 gap-x-6 gap-y-1 sm:grid-cols-2">
            {filters.map((f) => (
              <div key={f.key} className="flex gap-2 text-body-sm">
                <dt className="text-fg-muted">{f.label}:</dt>
                <dd className="font-medium text-fg">{f.value}</dd>
              </div>
            ))}
          </dl>
        )}
      </Section>

      {/* Indicadores */}
      {k ? (
        <Section title="Indicadores do período" testId="km-relatorio-kpis">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Tile label="KM total" value={fmtKm1(k.kmTotal)} hint="Soma do KM validado" />
            <Tile label="Veículos" value={fmtInt(k.vehicles)} hint={`${fmtInt(k.activeVehicles)} ativos`} />
            <Tile label="Média por veículo" value={fmtKm1(k.avgPerVehicle)} hint={`Mediana ${fmtKm1(k.medianPerVehicle)}`} />
            <Tile label="Média diária da frota" value={fmtKm1(k.avgDailyFleet)} hint={`Mediana ${fmtKm1(k.medianDailyFleet)}`} />
            <Tile label="Cobertura do período" value={fmtPct(k.coveragePeriodPct)} hint={`${fmtInt(k.validDays)} dias com leitura`} />
            <Tile
              label="Leitura no dia de referência"
              value={`${fmtInt(k.coverageRefCount)} de ${fmtInt(k.coverageRefTotal)}`}
              hint={`${fmtKm1(k.kmRefDay)} no dia`}
            />
            <Tile label="Sem leitura no dia de referência" value={fmtInt(k.vehiclesWithoutReadingRef)} hint="Não é 0 km" />
            <Tile label="Sem movimento no dia de referência" value={fmtInt(k.noMovementRef)} />
            <Tile label="Frotas atualizadas" value={fmtInt(k.vehiclesUpdated)} hint={`${fmtInt(k.vehiclesStale)} desatualizadas`} />
            <Tile
              label="Alta rodagem"
              value={`${fmtInt(k.highMileageDays)} dias`}
              hint={`${fmtInt(k.highMileageVehicles)} veículos${k.highMileageKm != null ? ` · acima de ${fmtInt(k.highMileageKm)} km/dia` : ""}`}
            />
            <Tile label="Inconsistências" value={fmtInt(k.inconsistencies)} hint="Inconsistentes, pendentes, divergências, regressões" />
            <Tile label="Média diária por veículo" value={fmtKm1(k.avgDailyPerVehicle)} hint="Nos dias com leitura" />
          </div>
        </Section>
      ) : null}

      {/* Leitura gerencial */}
      <Section title="Leitura gerencial" testId="km-relatorio-insights">
        {insights.length === 0 ? (
          <p className="text-body-sm text-fg-secondary">Sem destaques para o recorte.</p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {insights.map((i, idx) => (
              <li key={idx} className="flex items-start gap-2 text-body-sm break-inside-avoid">
                <span
                  className={cn(
                    "mt-0.5 shrink-0 rounded-xs px-1.5 text-caption font-semibold",
                    i.tone === "warning" && "bg-warning-soft text-warning-soft-fg",
                    i.tone === "danger" && "bg-danger-soft text-danger-soft-fg",
                    i.tone === "success" && "bg-success-soft text-success-soft-fg",
                    (i.tone === "info" || i.tone === "neutral") && "bg-info-soft text-info-soft-fg",
                  )}
                >
                  {TONE_LABEL[i.tone] ?? "Informativo"}
                </span>
                <span className="text-fg">{i.text}</span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {/* Operação */}
      {an ? (
        <Section title="KM por operação" testId="km-relatorio-operation">
          <ReportTable
            caption="KM por operação"
            rows={an.byOperation}
            rowKey={(r, i) => `${r.operationId ?? "none"}-${i}`}
            empty="Sem operações no recorte."
            cols={[
              { header: "Operação", cell: (r) => r.operation },
              { header: "KM", numeric: true, cell: (r) => fmtKm1(r.km) },
              { header: "Veículos", numeric: true, cell: (r) => fmtInt(r.vehicles) },
              { header: "Média/veículo", numeric: true, cell: (r) => fmtKm1(r.avgPerVehicle) },
              { header: "Mediana/veículo", numeric: true, cell: (r) => fmtKm1(r.medianPerVehicle) },
              { header: "KM/dia", numeric: true, cell: (r) => fmtKm1(r.kmPerDay) },
              { header: "Cobertura", numeric: true, cell: (r) => fmtPct(r.coveragePct) },
              { header: "Participação", numeric: true, cell: (r) => fmtPct(r.sharePct) },
            ]}
          />
        </Section>
      ) : null}

      {/* Localização */}
      {an ? (
        <Section title="KM por localização" description="Operação › UF › cidade › BR." testId="km-relatorio-location">
          <ReportTable
            caption="KM por localização"
            rows={locationRows(an.byLocation)}
            rowKey={(r, i) => `${r.level}-${r.operationId ?? "none"}-${r.state ?? ""}-${r.city ?? ""}-${r.br ?? ""}-${i}`}
            empty="Sem localizações no recorte."
            cols={[
              { header: "Operação", cell: (r) => r.operation },
              { header: "Nível", cell: (r) => r.level },
              { header: "UF", cell: (r) => r.state ?? "—" },
              { header: "Cidade", cell: (r) => r.city ?? "—" },
              { header: "BR", cell: (r) => r.br ?? "—" },
              { header: "KM", numeric: true, cell: (r) => fmtKm1(r.km) },
              { header: "Veículos", numeric: true, cell: (r) => fmtInt(r.vehicles) },
              { header: "Cobertura", numeric: true, cell: (r) => fmtPct(r.coveragePct) },
              { header: "Participação", numeric: true, cell: (r) => fmtPct(r.sharePct) },
            ]}
          />
        </Section>
      ) : null}

      {/* Coortes */}
      {an ? (
        <Section
          title="Coortes técnicas"
          description="Média diária (km/dia) dos veículos elegíveis de cada coorte (tipo, subcategoria e modelo)."
          testId="km-relatorio-cohorts"
        >
          <ReportTable
            caption="Coortes técnicas"
            rows={an.cohorts}
            rowKey={(r) => r.key}
            empty="Sem coortes no recorte."
            cols={[
              { header: "Coorte", cell: (r) => r.label },
              { header: "Nível", cell: (r) => (COHORT_LEVEL[r.level] ?? r.level).split(" · ")[0] },
              { header: "Veículos", numeric: true, cell: (r) => `${fmtInt(r.eligible)}/${fmtInt(r.vehicles)}` },
              { header: "Mediana", numeric: true, cell: (r) => fmt1(r.median) },
              { header: "Q1–Q3", numeric: true, cell: (r) => (r.q1 == null || r.q3 == null ? "—" : `${fmt1(r.q1)}–${fmt1(r.q3)}`) },
              { header: "P90", numeric: true, cell: (r) => fmt1(r.p90) },
              { header: "CV", numeric: true, cell: (r) => fmtPct(r.cvPct) },
              { header: "Pontos p/ análise", numeric: true, cell: (r) => fmtInt(r.outliers) },
              { header: "Suficiente", cell: (r) => (r.sufficient ? "Sim" : "Não") },
            ]}
          />
        </Section>
      ) : null}

      {/* Destaques */}
      <Section title="Destaques" testId="km-relatorio-highlights">
        {ov ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <RankTable title="Maiores rodagens" rows={ov.topVehicles ?? []} />
            <RankTable title="Menores rodagens (com cobertura mínima)" rows={ov.bottomVehicles ?? []} />
          </div>
        ) : null}

        {an?.quadrants ? (
          <div className="flex flex-col gap-1">
            <h3 className="text-body-sm font-semibold text-fg">Quadrantes (hodômetro acumulado × intensidade de rodagem)</h3>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {Object.entries(KM_QUADRANT).map(([code, q]) => (
                <Tile key={code} label={q.label} value={fmtInt(byCode(an.quadrants, code) ?? 0)} hint="veículos" />
              ))}
            </div>
          </div>
        ) : null}

        {an ? (
          <div className="flex flex-col gap-1">
            <h3 className="text-body-sm font-semibold text-fg">Pontos para análise ({fmtInt(outliers.length)})</h3>
            <ReportTable
              caption="Pontos para análise"
              rows={outliers.slice(0, 20)}
              rowKey={(r) => r.vehicleId}
              empty="Nenhum veículo fora do padrão da coorte."
              cols={[
                { header: "Veículo", cell: (r) => plateOf(r) },
                { header: "Coorte", cell: (r) => r.cohortLabel },
                { header: "Média/dia", numeric: true, cell: (r) => fmtKm1(r.dailyAvg) },
                { header: "Mediana coorte", numeric: true, cell: (r) => fmtKm1(r.cohortDailyMedian) },
                { header: "Desvio", numeric: true, cell: (r) => fmtPct(r.deviationPct) },
                { header: "Motivo", cell: (r) => outlierLabel(r.outlier) },
              ]}
            />
            {outliers.length > 20 ? (
              <p className="text-caption text-fg-muted">Mostrando os 20 maiores desvios; a lista completa está no Excel (aba Veículos).</p>
            ) : null}
          </div>
        ) : null}

        {an ? (
          <div className="flex flex-col gap-1">
            <h3 className="text-body-sm font-semibold text-fg">
              Preventiva: {fmtInt(preventiveSoon.length)} veículos com marco em até 30 dias · {fmtInt(preventiveOverdue.length)} com marco já atingido
            </h3>
            <ReportTable
              caption="Preventiva nos próximos 30 dias"
              rows={preventiveSoon.slice(0, 20)}
              rowKey={(r) => r.vehicleId}
              empty="Nenhum marco preventivo previsto para os próximos 30 dias."
              cols={[
                { header: "Veículo", cell: (r) => plateOf(r) },
                { header: "Modelo", cell: (r) => r.model ?? "—" },
                { header: "Ciclo", numeric: true, cell: (r) => fmtInt(r.preventive?.cycleNumber) },
                { header: "Marco", numeric: true, cell: (r) => fmtKm(r.preventive?.milestoneKm) },
                { header: "KM restantes", numeric: true, cell: (r) => fmtKm(r.preventive?.kmRemaining) },
                { header: "Dias estimados", numeric: true, cell: (r) => fmtInt(r.preventive?.daysEstimate) },
              ]}
            />
          </div>
        ) : null}
      </Section>

      {/* Notas */}
      <Section title="Notas">
        <ul className="flex list-disc flex-col gap-1 pl-5 text-caption text-fg-secondary">
          <li>{PARITY_NOTE}</li>
          <li>{NO_READING_NOTE}</li>
          <li>{OUTLIER_NOTE}</li>
        </ul>
      </Section>

      <footer className="flex flex-wrap justify-between gap-2 border-t border-border pt-2 text-caption text-fg-muted">
        <span>Horizonte Fleet Management · Fonte: Gestão de KM Rodado</span>
        <span>Gerado em {generatedAt}</span>
      </footer>
    </article>
  );
}
