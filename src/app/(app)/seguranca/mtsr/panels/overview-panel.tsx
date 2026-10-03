"use client";

import * as React from "react";
import Link from "next/link";
import {
  Activity, AlertOctagon, AlertTriangle, CalendarClock, CircleSlash, ClipboardCheck, Clock, Flame, Gauge, Hourglass,
  Percent, RefreshCw, ShieldCheck, Smartphone, Truck, Upload, Wrench,
} from "lucide-react";
import { InsightCard } from "@/components/feedback/insight-card";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { Table, TableBody, TableCell, TableContainer, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  ChartCard, ChartLegend, ColumnChart, DonutChart, HBarChart, SrTable, TrendChart, type ColumnDatum, type HBarDatum,
} from "@/components/charts";
import { STATUS_TONE as MAINT_STATUS_TONE, type MaintenanceStatus } from "@/lib/maintenance/types";
import type { MtsrDashboard } from "@/lib/mtsr/types";
import {
  CONFORMITY_LABEL, CONFORMITY_TONE, CRITICALITY_LABEL, CRITICALITY_ORDER, CRITICALITY_TONE, DEADLINE_LABEL, DEADLINE_TONE,
  fmt1, fmtDays, fmtInt, fmtPct, formatDate, formatStamp, MTSR_APP_PATH, sourceTypeLabel, type ConformityStatus,
  type Criticality, type DeadlineStatus,
} from "@/lib/mtsr/types";
import type { MtsrPanelContext } from "../shared";
import { chartColorOf, fmtHours, MtsrKpi, PanelEmpty, PanelError, plural, Section, useMtsrLink } from "./mtsr-ui";

/**
 * MTSR → Visão geral.
 *
 * Tudo chega pronto de `mtsr_dashboard` sobre a frota filtrada: contagens,
 * percentuais, distribuições e tendência. A tela formata e liga cada número à
 * Conformidade com o filtro correspondente — nunca recalcula status, prazo ou
 * criticidade.
 */
export function OverviewPanel({ data, ctx }: { data: MtsrDashboard | null; ctx: MtsrPanelContext }) {
  const link = useMtsrLink(ctx);

  if (ctx.error) return <PanelError ctx={ctx} title="Não foi possível carregar a visão geral do MTSR." testId="mtsr-visao-geral-error" />;
  if (!data || !data.kpis) {
    return (
      <PanelEmpty
        icon={<ShieldCheck />}
        title="Sem dados do MTSR para mostrar"
        description="A leitura da visão geral não trouxe resultado. Ajuste os filtros ou recarregue a página."
        testId="mtsr-visao-geral-empty"
      />
    );
  }

  const { kpis: k, parameters: p } = data;
  const canConformity = ctx.perms.conformity;
  const toConformity = (patch: Record<string, string | null>) => (canConformity ? link({ aba: "conformidade", ...patch }) : null);
  const ingestionVisible = ctx.perms.ingestionManage || ctx.perms.backofficeUpdate || ctx.perms.import;

  const rule = (
    <InsightCard tone="info" label="Regra vigente" compact data-testid="mtsr-visao-geral-rule">
      Regra de prazo vigente desde {formatDate(p.effectiveFrom)}: até {fmtDays(p.conformeMaxDays)} desde a última vistoria válida é{" "}
      <strong>Conforme</strong>; de {fmtInt(p.attentionMinDays)} a {fmtDays(p.attentionMaxDays)} é <strong>Atenção</strong>; acima disso,{" "}
      <strong>Vencido</strong>; sem vistoria válida, <strong>Pendente</strong>. SLAs: validação {fmtDays(p.reviewSlaDays)}, abertura de
      manutenção após NOK {fmtDays(p.maintenanceOpenSlaDays)}, revalidação {fmtDays(p.revalidationSlaDays)}. Retenção de evidências:{" "}
      {fmtInt(p.evidenceRetentionInspections)} {plural(p.evidenceRetentionInspections, "vistoria", "vistorias")} por veículo
      {p.evidenceRetentionDays != null ? ` ou ${fmtDays(p.evidenceRetentionDays)}` : ""}.
    </InsightCard>
  );

  if (data.empty) {
    return (
      <div className="flex flex-col gap-4" data-testid="mtsr-visao-geral">
        <PanelEmpty
          icon={<ShieldCheck />}
          title="Nenhum componente com leitura ainda"
          description="Nenhum veículo do recorte tem estado oficial de componente MTSR. O estado nasce de uma vistoria validada, de uma atualização de backoffice ou de uma importação."
          testId="mtsr-visao-geral-empty"
          action={
            ingestionVisible ? (
              <Button asChild size="sm" variant="primary">
                <Link href={`${ctx.basePath}?aba=ingestao`}>
                  <Upload aria-hidden />
                  Ingestão e importação
                </Link>
              </Button>
            ) : undefined
          }
          secondaryAction={
            <Button asChild size="sm" variant="secondary">
              <Link href={MTSR_APP_PATH}>
                <Smartphone aria-hidden />
                Abrir o app Vistoria MTSR
              </Link>
            </Button>
          }
        />
        {rule}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6" data-testid="mtsr-visao-geral">
      <p className="text-body-sm text-fg-muted" data-testid="mtsr-visao-geral-period">
        Retrato de <span className="font-medium text-fg-secondary tabular-nums">{formatDate(data.today)}</span> · {fmtInt(k.vehicles)}{" "}
        {plural(k.vehicles, "veículo no recorte", "veículos no recorte")} · {fmtInt(k.withInspection)} com vistoria válida
        {k.avgDaysSinceInspection != null ? ` · ${fmt1(k.avgDaysSinceInspection)} dias em média desde a última vistoria` : ""}
      </p>

      {/* ----------------------------------------------------------- Conformidade */}
      <Section
        title="Conformidade da frota"
        testId="mtsr-visao-geral-kpis"
        description="Veículo monitorado é o que tem pelo menos um componente com estado oficial. Conformidade é a parcela dos monitorados sem nenhum componente NOK; sem leitura não é conforme nem não conforme."
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          <MtsrKpi
            kpi="monitored"
            label="Frota monitorada"
            value={fmtInt(k.monitored)}
            unit={`de ${fmtInt(k.vehicles)}`}
            period={k.coveragePct == null ? "sem cobertura calculada" : `cobertura ${fmtPct(k.coveragePct)}`}
            icon={<Truck />}
            status="primary"
            nav={toConformity({})}
            destination="Abrir a Conformidade"
          />
          <MtsrKpi
            kpi="conformity"
            label="Conformidade"
            value={k.conformityPct == null ? "—" : fmt1(k.conformityPct)}
            unit={k.conformityPct == null ? undefined : "%"}
            period={k.conformityPct == null ? "sem leitura" : `${fmtInt(k.conforme)} ${plural(k.conforme, "veículo conforme", "veículos conformes")}`}
            status={k.conformityPct == null ? undefined : k.conformityPct >= 90 ? "success" : "warning"}
            icon={<Percent />}
            nav={toConformity({ conformidade: "conforme" })}
            destination="Abrir a Conformidade filtrada por conformes"
          />
          <MtsrKpi
            kpi="nao-conforme"
            label="Não conformes"
            value={fmtInt(k.naoConforme)}
            unit={plural(k.naoConforme, "veículo", "veículos")}
            period={`${fmtInt(k.semInformacao)} sem informação`}
            status={k.naoConforme > 0 ? "danger" : "success"}
            icon={<AlertOctagon />}
            nav={toConformity({ conformidade: "nao_conforme" })}
            destination="Abrir a Conformidade filtrada por não conformes"
          />
          <MtsrKpi
            kpi="nok-componentes"
            label="Componentes NOK"
            value={fmtInt(k.nokComponents)}
            unit={plural(k.nokComponents, "célula", "células")}
            period="veículo × componente em NOK"
            status={k.nokComponents > 0 ? "danger" : undefined}
            icon={<CircleSlash />}
            nav={toConformity({ conformidade: "nao_conforme" })}
            destination="Abrir a Conformidade filtrada por não conformes"
          />
        </div>
      </Section>

      {/* --------------------------------------------------- Criticidade e prazo */}
      <Section
        title="Criticidade e prazo"
        testId="mtsr-visao-geral-kpis-criticality"
        description="A criticidade de um veículo é a maior entre seus componentes NOK; o prazo conta os dias desde a última vistoria válida pela regra vigente."
      >
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
          <MtsrKpi kpi="critica" label="Críticas" value={fmtInt(k.critica)} status={k.critica > 0 ? "danger" : undefined} icon={<Flame />}
            nav={toConformity({ criticidade: "critica" })} destination="Abrir a Conformidade filtrada por criticidade crítica" />
          <MtsrKpi kpi="alta" label="Altas" value={fmtInt(k.alta)} status={k.alta > 0 ? "warning" : undefined} icon={<AlertTriangle />}
            nav={toConformity({ criticidade: "alta" })} destination="Abrir a Conformidade filtrada por criticidade alta" />
          <MtsrKpi kpi="media" label="Médias" value={fmtInt(k.media)} status={k.media > 0 ? "info" : undefined} icon={<Activity />}
            nav={toConformity({ criticidade: "media" })} destination="Abrir a Conformidade filtrada por criticidade média" />
          <MtsrKpi kpi="vencido" label="Vencidos" value={fmtInt(k.vencido)} status={k.vencido > 0 ? "danger" : undefined} icon={<CalendarClock />}
            period={`acima de ${fmtDays(p.attentionMaxDays)}`}
            nav={toConformity({ prazo: "vencido" })} destination="Abrir a Conformidade filtrada por prazo vencido" />
          <MtsrKpi kpi="atencao" label="Atenção" value={fmtInt(k.atencao)} status={k.atencao > 0 ? "warning" : undefined} icon={<Clock />}
            period={`${fmtInt(p.attentionMinDays)} a ${fmtDays(p.attentionMaxDays)}`}
            nav={toConformity({ prazo: "atencao" })} destination="Abrir a Conformidade filtrada por prazo em atenção" />
          <MtsrKpi kpi="pendente" label="Pendentes" value={fmtInt(k.pendente)} icon={<Hourglass />}
            period="sem vistoria válida"
            nav={toConformity({ prazo: "pendente" })} destination="Abrir a Conformidade filtrada por prazo pendente" />
        </div>
      </Section>

      {/* ------------------------------------------------------- Fluxo de trabalho */}
      <Section
        title="Fluxo de trabalho"
        testId="mtsr-visao-geral-kpis-flow"
        description="Vistorias aguardando validação, manutenções abertas a partir de NOK e componentes que esperam nova leitura depois da manutenção."
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
          <MtsrKpi
            kpi="aguardando"
            label="Aguardando revalidação"
            value={fmtInt(k.awaitingVehicles)}
            unit={plural(k.awaitingVehicles, "veículo", "veículos")}
            period={`${fmtInt(k.awaitingComponents)} ${plural(k.awaitingComponents, "componente", "componentes")} · ${fmtInt(k.awaitingOverSla)} acima do SLA`}
            status={k.awaitingOverSla > 0 ? "warning" : undefined}
            icon={<RefreshCw />}
            nav={toConformity({ revalidacao: "1" })}
            destination="Abrir a Conformidade filtrada por aguardando revalidação"
          />
          <MtsrKpi
            kpi="vistorias-pendentes"
            label="Vistorias pendentes"
            value={fmtInt(k.pendingInspections)}
            period={`${fmtInt(k.pendingOverSla)} acima do SLA de ${fmtDays(p.reviewSlaDays)}`}
            status={k.pendingOverSla > 0 ? "warning" : undefined}
            icon={<ClipboardCheck />}
            nav={ctx.perms.review ? link({ aba: "vistorias" }) : null}
            destination="Abrir as Vistorias recebidas"
          />
          <MtsrKpi
            kpi="manutencoes-abertas"
            label="Manutenções abertas"
            value={fmtInt(k.openMaintenances)}
            period={k.avgDaysNokToMaintenance == null ? "vinculadas a componentes" : `${fmt1(k.avgDaysNokToMaintenance)} dias do NOK à abertura (média)`}
            icon={<Wrench />}
            nav={link({ aba: "manutencoes" })}
            destination="Abrir as Manutenções"
          />
          <MtsrKpi
            kpi="nok-sem-manutencao"
            label="NOK sem manutenção"
            value={fmtInt(k.nokWithoutMaintenance)}
            period={`${fmtInt(k.nokOverOpenSla)} acima do SLA de ${fmtDays(p.maintenanceOpenSlaDays)}`}
            status={k.nokWithoutMaintenance > 0 ? "danger" : undefined}
            icon={<AlertOctagon />}
            nav={toConformity({ conformidade: "nao_conforme" })}
            destination="Abrir a Conformidade filtrada por não conformes"
          />
          <MtsrKpi
            kpi="validacao-media"
            label="Tempo médio de validação"
            value={k.avgReviewHours == null ? "—" : fmtHours(k.avgReviewHours)}
            period={`${fmtInt(k.inspections30d)} ${plural(k.inspections30d, "vistoria", "vistorias")} em 30 dias${
              k.returnedRatePct != null ? ` · ${fmtPct(k.returnedRatePct)} retornadas` : ""
            }`}
            icon={<Gauge />}
          />
        </div>
      </Section>

      {/* -------------------------------------------------------- Distribuições */}
      <Section title="Distribuição" testId="mtsr-visao-geral-distribution">
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 2xl:grid-cols-3">
          <ConformityDonut data={data} />
          <CriticalityDonut data={data} />
          <DeadlineColumns data={data} ctx={ctx} />
          <OperationColumns data={data} ctx={ctx} />
          <NokRanking data={data} ctx={ctx} />
          <ComponentColumns data={data} ctx={ctx} />
        </div>
      </Section>

      {/* -------------------------------------------------------- Vistorias/manut. */}
      <Section title="Vistorias e manutenções" testId="mtsr-visao-geral-flow">
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          <InspectionsTrend data={data} />
          <div className="grid grid-cols-1 gap-4">
            <MaintenanceByStatus data={data} />
            <MaintenanceAging data={data} />
          </div>
        </div>
      </Section>

      <SourcesTable data={data} />

      {rule}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Gráficos
// ---------------------------------------------------------------------------
const CONFORMITY_ORDER: ConformityStatus[] = ["conforme", "nao_conforme", "sem_informacao"];
const DEADLINE_ORDER: DeadlineStatus[] = ["conforme", "atencao", "vencido", "pendente"];

const totalOf = (list: { key: string; total: number }[], key: string) => list.find((x) => x.key === key)?.total ?? 0;

function ConformityDonut({ data }: { data: MtsrDashboard }) {
  const slices = CONFORMITY_ORDER.map((code) => ({
    key: code,
    label: CONFORMITY_LABEL[code],
    value: totalOf(data.byConformity, code),
    color: chartColorOf(CONFORMITY_TONE[code]),
  }));
  const total = slices.reduce((a, s) => a + s.value, 0);
  return (
    <ChartCard
      title="Por conformidade"
      description="Veículos do recorte pelo estado consolidado dos componentes."
      empty={total === 0 ? "Nenhum veículo no recorte." : undefined}
      data-testid="mtsr-visao-geral-by-conformity"
    >
      <DonutChart slices={slices} ariaLabel="Veículos por conformidade" centerLabel="Veículos" />
      <SrTable caption="Veículos por conformidade" columns={["Conformidade", "Veículos"]} rows={slices.map((s) => ({ key: s.key, cells: [s.label, fmtInt(s.value)] }))} />
    </ChartCard>
  );
}

function CriticalityDonut({ data }: { data: MtsrDashboard }) {
  const slices = CRITICALITY_ORDER.map((code: Criticality) => ({
    key: code,
    label: CRITICALITY_LABEL[code],
    value: totalOf(data.byCriticality, code),
    color: chartColorOf(CRITICALITY_TONE[code]),
  }));
  const total = slices.reduce((a, s) => a + s.value, 0);
  return (
    <ChartCard
      title="Por criticidade"
      description="A maior criticidade entre os componentes NOK de cada veículo; sem NOK, sem criticidade."
      empty={total === 0 ? "Nenhum veículo no recorte." : undefined}
      data-testid="mtsr-visao-geral-by-criticality"
    >
      <DonutChart slices={slices} ariaLabel="Veículos por criticidade" centerLabel="Veículos" />
      <SrTable caption="Veículos por criticidade" columns={["Criticidade", "Veículos"]} rows={slices.map((s) => ({ key: s.key, cells: [s.label, fmtInt(s.value)] }))} />
    </ChartCard>
  );
}

function DeadlineColumns({ data, ctx }: { data: MtsrDashboard; ctx: MtsrPanelContext }) {
  const items: ColumnDatum[] = DEADLINE_ORDER.map((code) => {
    const n = totalOf(data.byDeadline, code);
    return {
      key: code,
      label: DEADLINE_LABEL[code],
      value: n,
      color: chartColorOf(DEADLINE_TONE[code]),
      tooltip: { title: DEADLINE_LABEL[code], rows: [{ label: "Veículos", value: fmtInt(n), emphasis: true }], announce: `${DEADLINE_LABEL[code]}: ${fmtInt(n)} veículos.` },
    };
  });
  const total = items.reduce((a, i) => a + (i.value ?? 0), 0);
  return (
    <ChartCard
      title="Por prazo"
      description={`Dias desde a última vistoria válida: conforme até ${fmtDays(data.parameters.conformeMaxDays)}, atenção até ${fmtDays(data.parameters.attentionMaxDays)}.`}
      empty={total === 0 ? "Nenhum veículo no recorte." : undefined}
      insight={ctx.perms.conformity ? "Clique numa coluna para abrir a Conformidade com esse prazo." : undefined}
      data-testid="mtsr-visao-geral-by-deadline"
    >
      <ColumnChart
        items={items}
        ariaLabel="Veículos por prazo"
        format={fmtInt}
        kind="count"
        height={160}
        onSelect={ctx.perms.conformity ? (item) => ctx.navigate({ aba: "conformidade", prazo: item.key, pagina: null }) : undefined}
      />
      <SrTable caption="Veículos por prazo" columns={["Prazo", "Veículos"]} rows={items.map((i) => ({ key: i.key, cells: [i.label, fmtInt(i.value)] }))} />
    </ChartCard>
  );
}

function OperationColumns({ data, ctx }: { data: MtsrDashboard; ctx: MtsrPanelContext }) {
  const rows = data.byOperation;
  const items: ColumnDatum[] = rows.map((o) => {
    const label = o.name ?? "Sem operação";
    const ok = Math.max(0, o.total - o.naoConforme);
    return {
      key: o.operationId ?? "none",
      label,
      value: o.total,
      segments: [
        { key: "ok", value: ok, color: "var(--chart-brand-primary)" },
        { key: "nok", value: o.naoConforme, color: "var(--chart-danger)" },
      ],
      tooltip: {
        title: label,
        rows: [
          { label: "Veículos", value: fmtInt(o.total), emphasis: true },
          { label: "Não conformes", value: fmtInt(o.naoConforme), color: "var(--chart-danger)", tone: o.naoConforme > 0 ? "danger" : undefined },
          { label: "Críticos", value: fmtInt(o.critica) },
          { label: "Vencidos", value: fmtInt(o.vencido) },
        ],
        announce: `${label}: ${fmtInt(o.total)} veículos, ${fmtInt(o.naoConforme)} não conformes.`,
      },
    };
  });
  return (
    <ChartCard
      title="Por operação"
      description="Veículos de cada operação, com a parcela não conforme destacada."
      legend={
        <ChartLegend
          items={[
            { key: "ok", label: "Conformes ou sem informação", color: "var(--chart-brand-primary)" },
            { key: "nok", label: "Não conformes", color: "var(--chart-danger)" },
          ]}
        />
      }
      empty={rows.length === 0 ? "Nenhuma operação no recorte." : undefined}
      insight={ctx.perms.conformity ? "Clique numa coluna para abrir a Conformidade dessa operação." : undefined}
      data-testid="mtsr-visao-geral-by-operation"
    >
      <ColumnChart
        items={items}
        ariaLabel="Veículos por operação"
        format={fmtInt}
        kind="count"
        onSelect={ctx.perms.conformity ? (item) => ctx.navigate({ aba: "conformidade", operacao: item.key === "none" ? null : item.key, pagina: null }) : undefined}
      />
      <SrTable
        caption="Veículos por operação"
        columns={["Operação", "Veículos", "Não conformes", "Críticos", "Vencidos"]}
        rows={rows.map((o) => ({ key: o.operationId ?? "none", cells: [o.name ?? "Sem operação", fmtInt(o.total), fmtInt(o.naoConforme), fmtInt(o.critica), fmtInt(o.vencido)] }))}
      />
    </ChartCard>
  );
}

function NokRanking({ data, ctx }: { data: MtsrDashboard; ctx: MtsrPanelContext }) {
  const items: HBarDatum[] = data.rankingNok.map((r) => ({
    key: r.componentId,
    label: r.name,
    value: r.total,
    color: "var(--chart-danger)",
    tooltip: { title: r.name, rows: [{ label: "Veículos em NOK", value: fmtInt(r.total), emphasis: true }], announce: `${r.name}: ${fmtInt(r.total)} veículos em NOK.` },
  }));
  return (
    <ChartCard
      title="Ranking de NOK por componente"
      description="Quantos veículos têm cada componente em NOK agora."
      empty={items.length === 0 || items.every((i) => !i.value) ? "Nenhum componente em NOK no recorte." : undefined}
      insight={ctx.perms.conformity ? "Clique numa barra para ver os veículos com esse componente em NOK." : undefined}
      data-testid="mtsr-visao-geral-ranking-nok"
    >
      <HBarChart
        items={items}
        ariaLabel="Veículos em NOK por componente"
        format={fmtInt}
        onSelect={ctx.perms.conformity ? (item) => ctx.navigate({ aba: "conformidade", componente: item.key, status_componente: "nok", pagina: null }) : undefined}
      />
      <SrTable caption="Veículos em NOK por componente" columns={["Componente", "Veículos em NOK"]} rows={data.rankingNok.map((r) => ({ key: r.componentId, cells: [r.name, fmtInt(r.total)] }))} />
    </ChartCard>
  );
}

function ComponentColumns({ data, ctx }: { data: MtsrDashboard; ctx: MtsrPanelContext }) {
  const items: ColumnDatum[] = data.byComponent.map((c) => {
    const total = c.ok + c.nok + c.semInformacao;
    return {
      key: c.componentId,
      label: c.name,
      value: total,
      segments: [
        { key: "ok", value: c.ok, color: "var(--chart-success)" },
        { key: "nok", value: c.nok, color: "var(--chart-danger)" },
        { key: "unknown", value: c.semInformacao, color: "var(--chart-neutral)" },
      ],
      tooltip: {
        title: c.name,
        subtitle: c.verificationMode === "backoffice" ? "Backoffice" : "Campo (vistoria)",
        rows: [
          { label: "OK", value: fmtInt(c.ok), color: "var(--chart-success)" },
          { label: "NOK", value: fmtInt(c.nok), color: "var(--chart-danger)", tone: c.nok > 0 ? "danger" : undefined },
          { label: "Sem informação", value: fmtInt(c.semInformacao), color: "var(--chart-neutral)" },
          { label: "Aguardando revalidação", value: fmtInt(c.awaiting) },
        ],
        announce: `${c.name}: ${fmtInt(c.ok)} OK, ${fmtInt(c.nok)} NOK, ${fmtInt(c.semInformacao)} sem informação.`,
      },
    };
  });
  return (
    <ChartCard
      title="Por componente"
      description="Estado oficial de cada componente em todos os veículos do recorte."
      legend={
        <ChartLegend
          items={[
            { key: "ok", label: "OK", color: "var(--chart-success)" },
            { key: "nok", label: "NOK", color: "var(--chart-danger)" },
            { key: "unknown", label: "Sem informação", color: "var(--chart-neutral)" },
          ]}
        />
      }
      empty={items.length === 0 ? "Nenhum componente ativo no catálogo." : undefined}
      insight={ctx.perms.conformity ? "Clique numa coluna para abrir a Conformidade com esse componente." : undefined}
      data-testid="mtsr-visao-geral-by-component"
    >
      <ColumnChart
        items={items}
        ariaLabel="Estado oficial por componente"
        format={fmtInt}
        kind="count"
        onSelect={ctx.perms.conformity ? (item) => ctx.navigate({ aba: "conformidade", componente: item.key, pagina: null }) : undefined}
      />
      <SrTable
        caption="Estado oficial por componente"
        columns={["Componente", "OK", "NOK", "Sem informação", "Aguardando revalidação"]}
        rows={data.byComponent.map((c) => ({ key: c.componentId, cells: [c.name, fmtInt(c.ok), fmtInt(c.nok), fmtInt(c.semInformacao), fmtInt(c.awaiting)] }))}
      />
    </ChartCard>
  );
}

/** "30/09" a partir de aaaa-mm-dd. */
const dayMonth = (iso: string) => {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}` : iso;
};

function InspectionsTrend({ data }: { data: MtsrDashboard }) {
  const points = data.inspectionsTrend.map((w) => ({
    key: w.weekStart,
    label: dayMonth(w.weekStart),
    value: w.submitted,
    tooltip: {
      title: `Semana de ${formatDate(w.weekStart)}`,
      rows: [
        { label: "Enviadas", value: fmtInt(w.submitted), emphasis: true, color: "var(--chart-brand-primary)" },
        { label: "Validadas", value: fmtInt(w.validated), color: "var(--chart-success)" },
        { label: "Com NOK", value: fmtInt(w.nok), color: "var(--chart-danger)", tone: w.nok > 0 ? ("danger" as const) : undefined },
      ],
      announce: `Semana de ${formatDate(w.weekStart)}: ${fmtInt(w.submitted)} enviadas, ${fmtInt(w.validated)} validadas, ${fmtInt(w.nok)} com NOK.`,
    },
  }));
  return (
    <ChartCard
      title="Vistorias por semana"
      description="Vistorias enviadas pelo app por semana; validadas e com NOK no detalhe de cada ponto."
      empty={points.length === 0 ? "Nenhuma vistoria recebida no período." : undefined}
      data-testid="mtsr-visao-geral-inspections-trend"
    >
      <TrendChart points={points} ariaLabel="Vistorias enviadas por semana" kind="number" format={fmtInt} height={180} />
      <SrTable
        caption="Vistorias por semana"
        columns={["Semana", "Enviadas", "Validadas", "Com NOK"]}
        rows={data.inspectionsTrend.map((w) => ({ key: w.weekStart, cells: [formatDate(w.weekStart), fmtInt(w.submitted), fmtInt(w.validated), fmtInt(w.nok)] }))}
      />
    </ChartCard>
  );
}

function MaintenanceByStatus({ data }: { data: MtsrDashboard }) {
  const items: HBarDatum[] = data.maintenanceByStatus.map((m) => ({
    key: m.status,
    label: m.label,
    value: m.total,
    color: chartColorOf(MAINT_STATUS_TONE[m.status as MaintenanceStatus] ?? "neutral"),
    tooltip: { title: m.label, rows: [{ label: "Manutenções", value: fmtInt(m.total), emphasis: true }], announce: `${m.label}: ${fmtInt(m.total)} manutenções.` },
  }));
  return (
    <ChartCard
      title="Manutenções vinculadas por situação"
      description="Manutenções corporativas abertas a partir de NOK ou vinculadas a componentes."
      empty={items.length === 0 ? "Nenhuma manutenção vinculada." : undefined}
      data-testid="mtsr-visao-geral-maintenance-status"
    >
      <HBarChart items={items} ariaLabel="Manutenções vinculadas por situação" format={fmtInt} />
      <SrTable caption="Manutenções vinculadas por situação" columns={["Situação", "Manutenções"]} rows={data.maintenanceByStatus.map((m) => ({ key: m.status, cells: [m.label, fmtInt(m.total)] }))} />
    </ChartCard>
  );
}

function MaintenanceAging({ data }: { data: MtsrDashboard }) {
  const items: HBarDatum[] = data.maintenanceAging.map((b, i) => ({
    key: b.bucket,
    label: b.bucket,
    value: b.total,
    color: i === data.maintenanceAging.length - 1 ? "var(--chart-danger)" : "var(--chart-brand-secondary)",
    tooltip: { title: b.bucket, rows: [{ label: "Manutenções abertas", value: fmtInt(b.total), emphasis: true }], announce: `${b.bucket}: ${fmtInt(b.total)} manutenções abertas.` },
  }));
  return (
    <ChartCard
      title="Tempo em aberto das manutenções"
      description="Manutenções vinculadas ainda abertas, por faixa de dias desde a abertura."
      empty={items.length === 0 ? "Nenhuma manutenção aberta." : undefined}
      data-testid="mtsr-visao-geral-maintenance-aging"
    >
      <HBarChart items={items} ariaLabel="Manutenções abertas por tempo em aberto" format={fmtInt} />
      <SrTable caption="Manutenções abertas por tempo em aberto" columns={["Faixa", "Manutenções"]} rows={data.maintenanceAging.map((b) => ({ key: b.bucket, cells: [b.bucket, fmtInt(b.total)] }))} />
    </ChartCard>
  );
}

function SourcesTable({ data }: { data: MtsrDashboard }) {
  return (
    <Section
      title="Fontes de leitura"
      testId="mtsr-visao-geral-sources"
      description="De onde vem o estado oficial dos componentes. Fonte indisponível não tem adaptador nesta versão — não inventamos APIs."
    >
      <TableContainer>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Fonte</TableHead>
              <TableHead>Tipo</TableHead>
              <TableHead>Situação</TableHead>
              <TableHead>Último evento</TableHead>
              <TableHead numeric>Eventos em 30 dias</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.sources.map((s) => (
              <TableRow key={s.code} className="h-10">
                <TableCell className="font-medium text-fg">{s.name}</TableCell>
                <TableCell className="text-fg-secondary">{sourceTypeLabel(s.sourceType)}</TableCell>
                <TableCell>
                  <span className="flex flex-wrap items-center gap-1.5">
                    <StatusBadge status={s.isAvailable ? "success" : "neutral"} size="sm">{s.isAvailable ? "Disponível" : "Indisponível"}</StatusBadge>
                    <StatusBadge status={s.isEnabled ? "info" : "neutral"} size="sm">{s.isEnabled ? "Habilitada" : "Desabilitada"}</StatusBadge>
                  </span>
                </TableCell>
                <TableCell className="whitespace-nowrap text-fg-secondary tabular-nums">
                  {s.lastEventAt ? `${formatStamp(s.lastEventAt)}${s.daysSince != null ? ` · há ${fmtDays(s.daysSince)}` : ""}` : "Nenhum evento"}
                </TableCell>
                <TableCell numeric>{fmtInt(s.events30d)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
    </Section>
  );
}
