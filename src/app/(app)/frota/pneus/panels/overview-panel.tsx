"use client";

import * as React from "react";
import {
  AlertOctagon, AlertTriangle, ArrowLeftRight, Camera, ChevronRight, CircleSlash, ClipboardCheck, ClipboardList, Disc3, Gauge,
  Recycle, Repeat2, Ruler, SearchX, ShieldCheck, Truck, Undo2, Unlink, Upload, Warehouse,
} from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/feedback/alert";
import { InsightCard, InsightList } from "@/components/feedback/insight-card";
import { Button } from "@/components/ui/button";
import { StatusBadge, StatusDot, type StatusTone } from "@/components/ui/status-badge";
import { Table, TableBody, TableCell, TableContainer, TableEmpty, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  ChartCard, DonutChart, HBarChart, SrTable, TrendChart, type ChartTooltipRow, type HBarDatum, type TrendPoint,
} from "@/components/charts";
import type { TiresTabData } from "@/lib/tires/loaders";
import {
  DEADLINE_LABEL, DEADLINE_ORDER, DEADLINE_SHORT, DEADLINE_TONE, fmt1, fmtDays, fmtInt, fmtMm, fmtNum, fmtPct, fmtPsi, formatDate,
  formatStamp, plural, PSI_LABEL, PSI_ORDER, PSI_TONE, SEVERITY_LABEL, SEVERITY_TONE, STATUS_LABEL, STATUS_ORDER, STATUS_TONE,
  tiresVisibleTabs, TREAD_LABEL, TREAD_ORDER, TREAD_TONE, type CanonicalStatus, type DeadlineStatus, type PsiStatus,
  type TireDistItem, type TireInsight, type TireOverview, type TireOverviewKpis, type TireParameterSet, type TirePriorityRow,
  type TiresTab, type TireTrendPoint, type TreadClass,
} from "@/lib/tires/types";
import type { TiresPanelContext } from "../shared";
import {
  chartColorOf, FireLink, PanelEmpty, PanelError, PlateLink, Section, TiresKpi, useTiresLink, type TiresNavLink,
} from "./tires-ui";

/**
 * Gestão de Pneus → Visão geral.
 *
 * Tudo chega pronto de `tires_overview` sobre a fotografia escolhida (a mais
 * recente por padrão) e os filtros da tela: contagens, taxas, distribuições,
 * prioridades, leituras e a tendência por fotografia. A tela só formata e liga
 * cada número à aba que o explica — nunca recalcula classe de sulco, prazo,
 * PSI ou severidade.
 */
type Nav = (tab: TiresTab, patch?: Record<string, string | null>) => TiresNavLink | null;

export function OverviewPanel({ data, ctx }: { data: TiresTabData["visao-geral"] | null; ctx: TiresPanelContext }) {
  const link = useTiresLink(ctx);
  const visible = React.useMemo(() => new Set(tiresVisibleTabs(ctx.perms)), [ctx.perms]);
  const to: Nav = (tab, patch = {}) => (visible.has(tab) ? link({ aba: tab, ...patch }) : null);

  if (ctx.error) return <PanelError ctx={ctx} title="Não foi possível carregar a visão geral dos pneus." testId="tires-visao-geral-error" />;
  if (!data) {
    return (
      <PanelEmpty
        icon={<Disc3 />}
        title="Sem dados da visão geral"
        description="A leitura da visão geral não trouxe resultado. Ajuste os filtros ou recarregue a página."
        testId="tires-visao-geral-empty"
      />
    );
  }

  if (data.empty || !data.kpis || !data.parameters) {
    const importNav = ctx.perms.import ? link({ aba: "importacao" }) : null;
    return (
      <PanelEmpty
        icon={<Camera />}
        title="Nenhuma fotografia oficial de pneus"
        description="Os números da Gestão de Pneus nascem da importação confirmada do relatório Rodopar 10. Enquanto nenhuma importação for confirmada, não há situação, sulco, pressão ou prazo para mostrar."
        testId="tires-visao-geral-empty"
        action={
          importNav ? (
            <Button asChild size="sm" variant="primary">
              <a href={importNav.href} onClick={importNav.onClick} data-testid="tires-visao-geral-import">
                <Upload aria-hidden />
                Importação Rodopar
              </a>
            </Button>
          ) : undefined
        }
      />
    );
  }

  return <OverviewContent data={data} kpis={data.kpis} params={data.parameters} ctx={ctx} to={to} link={link} />;
}

function OverviewContent({
  data, kpis: k, params: p, ctx, to, link,
}: {
  data: TireOverview;
  kpis: TireOverviewKpis;
  params: TireParameterSet;
  ctx: TiresPanelContext;
  to: Nav;
  link: ReturnType<typeof useTiresLink>;
}) {
  const ref = data.referenceDate ?? "";
  const trend = data.trend ?? [];
  const spark = (pick: (t: TireTrendPoint) => number | null) => (trend.length > 1 ? trend.map(pick) : undefined);
  const inUse = (patch: Record<string, string | null>) => to("base", { visao: "fogo", situacao: "em_uso", ...patch });
  const insp = k.inspections;
  const movements = k.movements30d ?? null;
  const lifeChanges = k.lifeChanges30d ?? null;
  // Janela dos eventos de 30 dias: (fotografia − 30, fotografia], como a rotina conta.
  const eventWindow = { sub: "eventos", de: shiftDays(ref, -29), ate: ref };
  const MOVES = "TIRE_MOVED,TIRE_POSITION_CHANGED,TIRE_REMOVED,TIRE_RETURNED_TO_STOCK,TIRE_SENT_TO_RETREAD,TIRE_DISCARDED";

  if (k.total === 0) {
    return (
      <div className="flex flex-col gap-6" data-testid="tires-visao-geral">
        <PhotoBand data={data} ctx={ctx} link={link} to={to} />
        <PanelEmpty
          icon={<SearchX />}
          title="Nenhum pneu neste recorte"
          description="A fotografia existe, mas nenhum pneu atende aos filtros escolhidos. Ajuste ou limpe os filtros para ver os números."
          testId="tires-visao-geral-no-match"
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6" data-testid="tires-visao-geral">
      <PhotoBand data={data} ctx={ctx} link={link} to={to} />

      {/* --------------------------------------------------------- Situação */}
      <Section
        title="Pneus na fotografia"
        testId="tires-visao-geral-kpis-status"
        description="Situação de cada pneu no relatório Rodopar, já classificada pela importação."
      >
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
          <TiresKpi
            kpi="total"
            label="Pneus na fotografia"
            value={fmtInt(k.total)}
            icon={<Disc3 />}
            status="primary"
            period={`${fmtInt(k.fleets)} ${plural(k.fleets, "frota", "frotas")} com pneu em uso${k.outro > 0 ? ` · ${fmtInt(k.outro)} em situação não reconhecida` : ""}`}
            nav={to("base", { visao: "fogo" })}
            destination="Abrir a Base geral por Nº Fogo"
          />
          <TiresKpi
            kpi="em-uso"
            label="Em uso"
            value={fmtInt(k.emUso)}
            icon={<Truck />}
            status="success"
            period={k.pctEmUso == null ? undefined : `${fmtPct(k.pctEmUso)} do total`}
            sparkline={spark((t) => t.inUse)}
            nav={to("base", { visao: "frota" })}
            destination="Abrir a Base geral por frota"
          />
          <TiresKpi
            kpi="estoque"
            label="Estoque"
            value={fmtInt(k.estoque)}
            icon={<Warehouse />}
            status="info"
            period={k.pctEstoque == null ? undefined : `${fmtPct(k.pctEstoque)} do total`}
            nav={to("base", { visao: "fora", situacao: "estoque" })}
            destination="Abrir a Base geral fora da frota, em estoque"
          />
          <TiresKpi
            kpi="ressolagem"
            label="Ressolagem"
            value={fmtInt(k.ressolagem)}
            icon={<Recycle />}
            status="progress"
            period="situação Ressolagem no Rodopar"
            nav={to("base", { visao: "fora", situacao: "ressolagem" })}
            destination="Abrir a Base geral fora da frota, em ressolagem"
          />
          <TiresKpi
            kpi="descarte"
            label="Descarte e baixa"
            value={fmtInt(k.descartado + k.baixado)}
            icon={<CircleSlash />}
            period={`${fmtInt(k.descartado)} ${plural(k.descartado, "descartado", "descartados")} · ${fmtInt(k.baixado)} ${plural(k.baixado, "baixado", "baixados")}`}
            nav={to("base", { visao: "fora", situacao: "descartado,baixado" })}
            destination="Abrir a Base geral fora da frota, descartados e baixados"
          />
        </div>
      </Section>

      {/* ------------------------------------------------------------- Sulco */}
      <Section
        title="Sulco dos pneus em uso"
        testId="tires-visao-geral-kpis-tread"
        description={
          <>
            Classe pelo menor sulco do pneu (o menor entre o informado e o medido). Média do menor sulco {fmtMm(k.treadAvg)}, mediana{" "}
            {fmtMm(k.treadMedian)}
            {k.treadUnknown > 0 ? ` · ${fmtInt(k.treadUnknown)} ${plural(k.treadUnknown, "pneu sem medição", "pneus sem medição")}` : ""}. O alerta
            de ressolagem vale para pneus em uso e em estoque.
          </>
        }
      >
        <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
          <TiresKpi
            kpi="abaixo-legal"
            label="Abaixo do sulco legal"
            value={fmtInt(k.belowLegal)}
            icon={<AlertOctagon />}
            status={k.belowLegal > 0 ? "danger" : "success"}
            period="pelo mínimo legal da regra de PSI do pneu"
            nav={inUse({ sulco: "abaixo_legal" })}
            destination="Abrir a Base geral com os pneus abaixo do sulco legal"
          />
          <TiresKpi
            kpi="critico"
            label="Sulco crítico"
            value={fmtInt(k.critical)}
            icon={<Ruler />}
            status={k.critical > 0 ? "danger" : "success"}
            period={`até ${fmtMm(p.treadCriticalMm)} · inclui abaixo do legal`}
            sparkline={spark((t) => t.critical)}
            nav={inUse({ sulco: "abaixo_legal,critico" })}
            destination="Abrir a Base geral com os pneus de sulco crítico"
          />
          <TiresKpi
            kpi="atencao"
            label="Sulco em atenção"
            value={fmtInt(k.attention)}
            icon={<AlertTriangle />}
            status={k.attention > 0 ? "warning" : "success"}
            period={`acima de ${fmtMm(p.treadCriticalMm)} e até ${fmtMm(p.treadAttentionMm)}`}
            nav={inUse({ sulco: "atencao" })}
            destination="Abrir a Base geral com os pneus de sulco em atenção"
          />
          <TiresKpi
            kpi="alerta-ressolagem"
            label="Alertas de ressolagem"
            value={fmtInt(k.retreadAlerts)}
            icon={<Recycle />}
            status={k.retreadAlerts > 0 ? "info" : undefined}
            period="só alerta operacional: não muda a situação"
            nav={to("base", { visao: "fogo", ressolagem: "1" })}
            destination="Abrir a Base geral com os pneus em alerta de ressolagem"
          />
        </div>
      </Section>

      {/* -------------------------------------------------- Prazos e pressão */}
      <Section
        title="Prazos e pressão dos pneus em uso"
        testId="tires-visao-geral-kpis-deadlines"
        description="Aderência = (em dia + próximos) ÷ pneus com registro; quem nunca teve registro fica fora da conta e aparece em “Sem registro”. Pressão adequada = dentro da faixa da regra ÷ pneus calibrados com regra."
      >
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          <ComplianceCard
            testId="tires-kpi-medicao"
            title="Medição de sulco"
            icon={<Ruler />}
            headlineLabel="Aderência de medição"
            headline={k.measurementAdherencePct}
            caption={`Cobertura ${fmtPct(k.measurementCoveragePct)} · em dia até ${fmtDays(p.measurementOkDays)}`}
            nav={to("medicao")}
            destination="Abrir a Aderência MM"
            rows={[
              { key: "vencido", label: "Vencida", hint: `mais de ${fmtDays(p.measurementWarningDays)}`, value: k.measurementOverdue, tone: "danger", nav: to("medicao", { pendencia: "vencido" }) },
              { key: "proximo", label: "Próxima do vencimento", hint: `${fmtInt(p.measurementOkDays + 1)} a ${fmtDays(p.measurementWarningDays)}`, value: k.measurementDueSoon, tone: "warning", nav: to("medicao", { pendencia: "proximo" }) },
              { key: "sem-registro", label: "Sem registro", hint: "nenhuma data de medição", value: k.measurementMissing, tone: "pending", nav: to("medicao", { pendencia: "sem_registro" }) },
            ]}
          />
          <ComplianceCard
            testId="tires-kpi-calibragem"
            title="Calibragem"
            icon={<Gauge />}
            headlineLabel="Aderência de calibragem"
            headline={k.calibrationAdherencePct}
            caption={`Cobertura ${fmtPct(k.calibrationCoveragePct)} · em dia até ${fmtDays(p.calibrationOkDays)}`}
            nav={to("calibragem")}
            destination="Abrir a Aderência de calibragem"
            rows={[
              { key: "vencido", label: "Vencida", hint: `mais de ${fmtDays(p.calibrationWarningDays)}`, value: k.calibrationOverdue, tone: "danger", nav: to("calibragem", { pendencia: "vencido" }) },
              { key: "proximo", label: "Próxima do vencimento", hint: `${fmtInt(p.calibrationOkDays + 1)} a ${fmtDays(p.calibrationWarningDays)}`, value: k.calibrationDueSoon, tone: "warning", nav: to("calibragem", { pendencia: "proximo" }) },
              { key: "sem-registro", label: "Sem registro", hint: "nenhuma data de calibragem", value: k.calibrationMissing, tone: "pending", nav: to("calibragem", { pendencia: "sem_registro" }) },
            ]}
          />
          <ComplianceCard
            testId="tires-kpi-pressao"
            title="Pressão (PSI)"
            icon={<Gauge />}
            headlineLabel="Pressão adequada"
            headline={k.pressureAdequatePct}
            caption="Sem parâmetro nunca conta como adequada"
            nav={to("calibragem", { pendencia: "pressao" })}
            destination="Abrir a Aderência de calibragem com as pendências de pressão"
            rows={[
              { key: "baixa", label: PSI_LABEL.baixa, hint: "abaixo do mínimo da regra", value: k.psiLow, tone: PSI_TONE.baixa, nav: to("calibragem", { pendencia: "pressao" }) },
              { key: "excesso", label: PSI_LABEL.excesso, hint: "acima do máximo da regra", value: k.psiHigh, tone: PSI_TONE.excesso, nav: to("calibragem", { pendencia: "pressao" }) },
              {
                key: "sem-parametro",
                label: PSI_LABEL.sem_parametro,
                hint: k.psiRuleGaps > 0 ? `${fmtInt(k.psiRuleGaps)} ${plural(k.psiRuleGaps, "combinação", "combinações")} sem regra` : "sem regra aplicável",
                value: k.psiNoRule,
                tone: PSI_TONE.sem_parametro,
                nav: to("calibragem", { pendencia: "sem_parametro" }),
              },
              { key: "sem-calibragem", label: PSI_LABEL.sem_calibragem, hint: "sem PSI no relatório", value: k.psiMissing, tone: PSI_TONE.sem_calibragem, nav: inUse({ pressao: "sem_calibragem" }) },
            ]}
          />
        </div>
      </Section>

      {/* ----------------------------------------- Qualidade e movimentação */}
      <Section
        title="Qualidade, vínculo e movimentação"
        testId="tires-visao-geral-kpis-quality"
        description={`Índice de qualidade = pneus sem inconsistência no relatório ÷ pneus da fotografia. ${fmtInt(k.stale)} ${plural(k.stale, "pneu está", "pneus estão")} sem alteração no Rodopar há mais de ${fmtDays(p.staleUpdateDays)}.`}
      >
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
          <TiresKpi
            kpi="qualidade"
            label="Índice de qualidade"
            value={k.qualityScore == null ? "—" : fmt1(k.qualityScore)}
            unit={k.qualityScore == null ? undefined : "%"}
            icon={<ShieldCheck />}
            status="primary"
            period={`${fmtInt(k.qualityIssueTires)} ${plural(k.qualityIssueTires, "pneu com inconsistência", "pneus com inconsistência")}`}
            sparkline={spark((t) => t.qualityScore)}
            sparklineDomain={[0, 100]}
            nav={to("qualidade")}
            destination="Abrir a Qualidade de dados"
          />
          <TiresKpi
            kpi="sem-veiculo"
            label="Em uso sem veículo"
            value={fmtInt(k.inUseWithoutVehicle)}
            icon={<Unlink />}
            status={k.inUseWithoutVehicle > 0 ? "warning" : "success"}
            period="frota ausente ou não encontrada no HFM"
            nav={to("qualidade")}
            destination="Abrir a Qualidade de dados"
          />
          <TiresKpi
            kpi="movimentacoes"
            label="Movimentações em 30 dias"
            value={fmtInt(movements)}
            icon={<ArrowLeftRight />}
            period="frota, posição ou situação, até a fotografia"
            nav={to("historico", { ...eventWindow, evento: MOVES })}
            destination="Abrir o Histórico de movimentações dos últimos 30 dias"
          />
          <TiresKpi
            kpi="trocas-vida"
            label="Trocas de vida em 30 dias"
            value={fmtInt(lifeChanges)}
            icon={<Repeat2 />}
            period="mudança do nº da vida no Rodopar"
            nav={to("historico", { ...eventWindow, evento: "TIRE_LIFE_CHANGED" })}
            destination="Abrir o Histórico de trocas de vida dos últimos 30 dias"
          />
          <TiresKpi
            kpi="ausentes"
            label="Ausentes no último relatório"
            value={fmtInt(k.absent)}
            icon={<SearchX />}
            status={k.absent > 0 ? "warning" : undefined}
            period="no seu escopo, sem os filtros da tela"
            nav={to("qualidade", { problema: "ausente_ultima_importacao" })}
            destination="Abrir a Qualidade de dados com os pneus ausentes"
          />
        </div>
      </Section>

      {/* ----------------------------------------------------------- Vistorias */}
      <Section
        title="Vistorias de campo"
        testId="tires-visao-geral-kpis-inspections"
        description="A vistoria de campo é leitura cega e nunca altera a fotografia oficial: o dado só muda quando é lançado no Rodopar e volta na próxima importação. Contagem de todas as vistorias no seu escopo (os filtros da fotografia não se aplicam)."
      >
        <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
          <TiresKpi
            kpi="vistorias-revisao"
            label="Pendentes de revisão"
            value={fmtInt(insp.pendingReview)}
            icon={<ClipboardList />}
            status={insp.pendingReview > 0 ? "warning" : undefined}
            period={`SLA de revisão: ${fmtDays(p.reviewSlaDays)}`}
            nav={to("vistorias", { fase: "pendente_revisao" })}
            destination="Abrir as Vistorias recebidas pendentes de revisão"
          />
          <TiresKpi
            kpi="vistorias-rodopar"
            label="Pendentes de lançamento no Rodopar"
            value={fmtInt(insp.pendingRodopar)}
            icon={<ClipboardCheck />}
            status={insp.pendingRodoparOverSla > 0 ? "danger" : insp.pendingRodopar > 0 ? "progress" : undefined}
            period={`${fmtInt(insp.pendingRodoparOverSla)} acima do SLA de ${fmtDays(p.rodoparSyncSlaDays)}`}
            nav={to("vistorias", { fase: "pendente_rodopar" })}
            destination="Abrir as Vistorias recebidas pendentes de lançamento no Rodopar"
          />
          <TiresKpi
            kpi="vistorias-retornadas"
            label="Retornadas por divergência"
            value={fmtInt(insp.returned)}
            icon={<Undo2 />}
            status={insp.returned > 0 ? "warning" : undefined}
            period="aguardando nova medição"
            nav={to("vistorias", { fase: "retornar_divergencia" })}
            destination="Abrir as Vistorias recebidas retornadas por divergência"
          />
          <TiresKpi
            kpi="vistorias-persistente"
            label="Divergência persistente"
            value={fmtInt(insp.persistent)}
            icon={<AlertOctagon />}
            status={insp.persistent > 0 ? "danger" : undefined}
            period="o Rodopar seguiu diferente após a importação"
            nav={to("vistorias", { fase: "pendente_rodopar", divergencia: "persistente" })}
            destination="Abrir as Vistorias recebidas com divergência persistente"
          />
        </div>
      </Section>

      <Insights insights={data.insights ?? []} to={to} inUse={inUse} />

      <Priorities rows={data.priorities ?? []} to={to} />

      <Distributions data={data} ctx={ctx} canBase={to("base") !== null} />

      <TrendSection trend={trend} referenceDate={ref} />

      <ParametersFooter p={p} to={to} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Fotografia de referência
// ---------------------------------------------------------------------------
function PhotoBand({ data, ctx, link, to }: { data: TireOverview; ctx: TiresPanelContext; link: ReturnType<typeof useTiresLink>; to: Nav }) {
  const latest = data.isLatest !== false;
  const photo = data.photo ?? null;
  const batchNav = photo && (ctx.perms.import || ctx.perms.audit) ? to("importacao", { lote: photo.batchId }) : null;
  const current = link({ foto: null });
  return (
    <div className="flex flex-col gap-3">
      <section
        aria-label="Fotografia de referência"
        className="flex flex-col gap-3 rounded-lg border border-border bg-surface-raised px-4 py-3 shadow-card sm:flex-row sm:items-center sm:justify-between"
        data-testid="tires-visao-geral-photo"
      >
        <div className="flex min-w-0 items-start gap-3">
          <span aria-hidden className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary-soft text-primary-soft-fg [&_svg]:size-[18px]">
            <Camera />
          </span>
          <div className="flex min-w-0 flex-col gap-0.5">
            <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-body font-semibold text-fg">
              <span>
                Fotografia oficial de <span className="tabular-nums">{formatDate(data.referenceDate)}</span>
              </span>
              <StatusBadge status={latest ? "success" : "warning"} size="sm" data-testid="tires-visao-geral-photo-state">
                {latest ? "Mais recente" : "Histórica"}
              </StatusBadge>
            </p>
            <p className="text-caption text-fg-muted [overflow-wrap:anywhere]">
              {photo ? (
                <>
                  Arquivo <span className="font-medium text-fg-secondary">{photo.fileName}</span> · {fmtInt(photo.totalRows)}{" "}
                  {plural(photo.totalRows, "linha", "linhas")} · confirmada
                  {photo.confirmedByName ? (
                    <>
                      {" "}por <span className="font-medium text-fg-secondary">{photo.confirmedByName}</span>
                    </>
                  ) : null}{" "}
                  em <span className="tabular-nums">{formatStamp(photo.confirmedAt)}</span>
                </>
              ) : (
                "Lote de importação desta data não localizado."
              )}
            </p>
            <p className="text-caption text-fg-muted">
              Prazos contados até <span className="tabular-nums">{formatDate(data.asOf ?? data.today)}</span>
              {data.previousReferenceDate ? (
                <>
                  {" "}· fotografia anterior: <span className="tabular-nums">{formatDate(data.previousReferenceDate)}</span>
                </>
              ) : (
                " · primeira fotografia confirmada"
              )}
            </p>
          </div>
        </div>
        {batchNav ? (
          <Button asChild size="sm" variant="secondary" className="self-start sm:self-center">
            <a href={batchNav.href} onClick={batchNav.onClick} data-testid="tires-visao-geral-photo-batch">
              Ver o lote importado
              <ChevronRight aria-hidden />
            </a>
          </Button>
        ) : null}
      </section>
      {!latest ? (
        <Alert
          variant="warning"
          data-testid="tires-visao-geral-historical"
          action={
            <Button asChild size="sm" variant="secondary">
              <a href={current.href} onClick={current.onClick} data-testid="tires-visao-geral-current">
                Ver a fotografia atual{data.latestReferenceDate ? ` (${formatDate(data.latestReferenceDate)})` : ""}
              </a>
            </Button>
          }
        >
          <AlertTitle>Fotografia histórica</AlertTitle>
          <AlertDescription>
            Os números abaixo refletem o relatório de {formatDate(data.referenceDate)}, com os prazos contados até essa data. As vistorias e os
            ausentes continuam sendo os de hoje.
          </AlertDescription>
        </Alert>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Cartão composto (aderência + pendências)
// ---------------------------------------------------------------------------
interface ComplianceRow {
  key: string;
  label: string;
  hint: string;
  value: number;
  tone: StatusTone;
  nav: TiresNavLink | null;
}

function ComplianceCard({
  testId, title, icon, headlineLabel, headline, caption, nav, destination, rows,
}: {
  testId: string;
  title: string;
  icon: React.ReactNode;
  headlineLabel: string;
  headline: number | null;
  caption: string;
  nav: TiresNavLink | null;
  destination: string;
  rows: ComplianceRow[];
}) {
  const headingId = React.useId();
  const head = (
    <>
      <span className="flex items-baseline gap-1.5">
        <span className="text-kpi-sm font-semibold text-fg tabular-nums">{headline == null ? "—" : fmt1(headline)}</span>
        {headline != null ? <span className="text-body-sm font-medium text-fg-muted">%</span> : null}
        <span className="ml-1 text-caption text-fg-muted">{headlineLabel.toLowerCase()}</span>
      </span>
      <span className="text-caption text-fg-muted">{caption}</span>
    </>
  );
  return (
    <section
      aria-labelledby={headingId}
      className="flex min-w-0 flex-col overflow-hidden rounded-lg border border-border bg-surface-raised shadow-card"
      data-testid={testId}
    >
      <header className="flex items-start justify-between gap-2 px-3.5 pt-3">
        <h3 id={headingId} className="text-caption font-semibold tracking-wide text-fg-muted uppercase">{title}</h3>
        <span aria-hidden className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-surface-interactive text-fg-secondary [&_svg]:size-4">
          {icon}
        </span>
      </header>
      {nav ? (
        <a
          href={nav.href}
          onClick={nav.onClick}
          className="mx-1.5 flex flex-col gap-0.5 rounded-md px-2 py-1.5 hfm-transition hfm-focus-ring hover:bg-hover-overlay"
          data-testid={`${testId}-headline`}
        >
          {head}
          <span className="sr-only">. {destination}</span>
        </a>
      ) : (
        <div className="flex flex-col gap-0.5 px-3.5 py-1.5" data-testid={`${testId}-headline`}>{head}</div>
      )}
      <ul className="mt-1 flex flex-col border-t border-border-subtle py-1">
        {rows.map((r) => {
          const body = (
            <>
              <StatusDot status={r.tone} />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="text-body-sm font-medium text-fg">{r.label}</span>
                <span className="text-caption text-fg-muted">{r.hint}</span>
              </span>
              <span className="text-body font-semibold text-fg tabular-nums">{fmtInt(r.value)}</span>
              {r.nav ? <ChevronRight aria-hidden className="size-4 shrink-0 text-fg-muted" /> : <span aria-hidden className="w-4" />}
            </>
          );
          return (
            <li key={r.key}>
              {r.nav ? (
                <a
                  href={r.nav.href}
                  onClick={r.nav.onClick}
                  className="mx-1.5 flex items-center gap-2.5 rounded-md px-2 py-1.5 hfm-transition hfm-focus-ring hover:bg-hover-overlay"
                  data-testid={`${testId}-${r.key}`}
                >
                  {body}
                </a>
              ) : (
                <div className="mx-1.5 flex items-center gap-2.5 px-2 py-1.5" data-testid={`${testId}-${r.key}`}>{body}</div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Leituras (somente as que a rotina devolve)
// ---------------------------------------------------------------------------
function Insights({
  insights, to, inUse,
}: {
  insights: TireInsight[];
  to: Nav;
  inUse: (patch: Record<string, string | null>) => TiresNavLink | null;
}) {
  if (insights.length === 0) {
    return (
      <Section title="Leituras da fotografia" testId="tires-visao-geral-insights">
        <p className="text-body-sm text-fg-muted">A rotina não apontou nenhuma leitura de atenção para esta fotografia e estes filtros.</p>
      </Section>
    );
  }
  // Para onde cada leitura leva (a frase vem pronta do banco; aqui só o destino).
  const target = (key: string): { nav: TiresNavLink | null; label: string } | null => {
    switch (key) {
      case "measurement_overdue":
        return { nav: to("medicao", { pendencia: "vencido" }), label: "Ver medições vencidas" };
      case "fleets_with_critical":
        return { nav: to("base", { visao: "frota", sulco: "abaixo_legal,critico" }), label: "Ver as frotas" };
      case "below_legal":
        return { nav: inUse({ sulco: "abaixo_legal" }), label: "Ver os pneus" };
      case "worst_operation":
        return { nav: to("medicao"), label: "Ver a aderência por operação" };
      case "psi_low":
      case "psi_high":
        return { nav: to("calibragem", { pendencia: "pressao" }), label: "Ver as pendências de pressão" };
      case "psi_gaps":
        return { nav: to("calibragem", { pendencia: "sem_parametro" }), label: "Ver os pneus sem parâmetro" };
      case "absent":
        return { nav: to("qualidade", { problema: "ausente_ultima_importacao" }), label: "Ver os ausentes" };
      case "rodopar_sla":
        return { nav: to("vistorias", { fase: "pendente_rodopar" }), label: "Ver as vistorias" };
      case "quality":
        return { nav: to("qualidade"), label: "Abrir a Qualidade de dados" };
      default:
        return null;
    }
  };
  return (
    <Section title="Leituras da fotografia" testId="tires-visao-geral-insights" description="Fatos que a rotina destacou sobre esta fotografia e estes filtros.">
      <InsightList className="xl:grid-cols-3">
        {insights.map((i) => {
          const t = target(i.key);
          return (
            <InsightCard
              key={i.key}
              tone={i.tone}
              compact
              data-testid="tires-visao-geral-insight"
              data-key={i.key}
              action={
                t?.nav ? (
                  <a href={t.nav.href} onClick={t.nav.onClick} className="inline-flex items-center gap-1 rounded-xs text-body-sm font-medium text-link hover:text-link-hover hover:underline hfm-focus-ring">
                    {t.label}
                    <ChevronRight aria-hidden className="size-3.5" />
                  </a>
                ) : undefined
              }
            >
              {i.text}
            </InsightCard>
          );
        })}
      </InsightList>
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Prioridades
// ---------------------------------------------------------------------------
const PRIORITY_VISIBLE = 15;
/** Teto de linhas que `tires_overview` devolve em `priorities`. */
const PRIORITY_CAP = 400;

function Priorities({ rows, to }: { rows: TirePriorityRow[]; to: Nav }) {
  const shown = rows.slice(0, PRIORITY_VISIBLE);
  const all = to("base", { visao: "fogo", situacao: "em_uso", severidade: "critica,alta,media" });
  return (
    <Section
      title="Prioridades"
      testId="tires-visao-geral-priorities"
      description={
        rows.length > PRIORITY_VISIBLE
          ? `Os ${fmtInt(PRIORITY_VISIBLE)} pneus em uso de maior severidade, de ${rows.length >= PRIORITY_CAP ? `mais de ${fmtInt(PRIORITY_CAP)}` : fmtInt(rows.length)} com severidade crítica, alta ou média. A severidade soma sulco, prazos, pressão, divergência do menor sulco e alerta de ressolagem.`
          : "Pneus em uso com severidade crítica, alta ou média, do mais grave para o menos grave. A severidade soma sulco, prazos, pressão, divergência do menor sulco e alerta de ressolagem."
      }
      actions={
        all && rows.length > 0 ? (
          <Button asChild size="sm" variant="secondary">
            <a href={all.href} onClick={all.onClick} data-testid="tires-visao-geral-priorities-all">
              Ver todos na Base geral
              <ChevronRight aria-hidden />
            </a>
          </Button>
        ) : undefined
      }
    >
      <TableContainer>
        <Table className="min-w-[1000px]" data-testid="tires-visao-geral-priorities-table">
          <TableHeader>
            <TableRow>
              <TableHead>Nº Fogo</TableHead>
              <TableHead>Veículo</TableHead>
              <TableHead>Posição</TableHead>
              <TableHead>Sulco mínimo</TableHead>
              <TableHead>Pressão</TableHead>
              <TableHead>Medição</TableHead>
              <TableHead>Calibragem</TableHead>
              <TableHead>Severidade</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {shown.length === 0 ? (
              <TableEmpty colSpan={8} message="Nenhum pneu em uso com severidade crítica, alta ou média neste recorte." />
            ) : (
              shown.map((r) => <PriorityRow key={r.tireId} r={r} />)
            )}
          </TableBody>
        </Table>
      </TableContainer>
    </Section>
  );
}

/** Célula de duas linhas: o valor em cima, o selo ou o contexto embaixo. */
function Cell2({ top, bottom, title }: { top: React.ReactNode; bottom?: React.ReactNode; title?: string }) {
  return (
    <span className="flex min-w-0 flex-col items-start gap-1 leading-tight" title={title}>
      <span className="max-w-full truncate whitespace-nowrap">{top}</span>
      {bottom ? <span className="max-w-full truncate whitespace-nowrap text-caption text-fg-muted">{bottom}</span> : null}
    </span>
  );
}

function PriorityRow({ r }: { r: TirePriorityRow }) {
  const place = [r.operationName, r.cityName ? `${r.cityName}${r.stateUf ? ` · ${r.stateUf}` : ""}` : null].filter(Boolean).join(" — ");
  const hasCode = Boolean(r.positionCode && r.positionLabel && r.positionLabel !== r.positionCode);
  const signals = [r.retreadAlert ? "Ressolagem" : null, r.treadDivergence ? "MM divergente" : null].filter(Boolean).join(" · ");
  const signalsTitle = [r.retreadAlert ? "Alerta de ressolagem (só alerta operacional)" : null, r.treadDivergence ? "Menor sulco informado difere do medido" : null]
    .filter(Boolean)
    .join(" · ");
  return (
    <TableRow className="h-auto" data-testid="tires-priority-row" data-severity={r.severity}>
      <TableCell className="py-2">
        <FireLink tireId={r.tireId} fireNumber={r.fireNumber} testId="tires-priority-fire" />
      </TableCell>
      <TableCell className="max-w-48 py-2">
        <Cell2
          top={<PlateLink vehicleId={r.vehicleId} plate={r.licensePlate} fleetCode={r.fleetNumber} testId="tires-priority-plate" />}
          bottom={place || null}
          title={place || undefined}
        />
      </TableCell>
      <TableCell className="py-2">
        <Cell2 top={<span className="text-fg">{r.positionLabel ?? r.positionCode ?? "—"}</span>} bottom={hasCode ? r.positionCode : null} />
      </TableCell>
      <TableCell className="py-2">
        <Cell2
          top={
            <>
              <span className="font-semibold text-fg tabular-nums">{fmtMm(r.treadMin)}</span>
              <span className="text-caption text-fg-muted"> · legal {r.legalTreadMm != null ? fmtMm(r.legalTreadMm) : "—"}</span>
            </>
          }
          bottom={<StatusBadge status={TREAD_TONE[r.treadClass]} size="sm">{TREAD_LABEL[r.treadClass]}</StatusBadge>}
        />
      </TableCell>
      <TableCell className="py-2">
        <Cell2
          top={
            <>
              <span className="font-semibold text-fg tabular-nums">{fmtPsi(r.psi)}</span>
              <span className="text-caption text-fg-muted tabular-nums">
                {" "}· {r.psiMin != null && r.psiMax != null ? `faixa ${fmtNum(r.psiMin)}–${fmtNum(r.psiMax)}` : "sem faixa"}
              </span>
            </>
          }
          bottom={<StatusBadge status={PSI_TONE[r.psiStatus]} size="sm">{PSI_LABEL[r.psiStatus]}</StatusBadge>}
        />
      </TableCell>
      <TableCell className="py-2">
        <DeadlineCell status={r.measurementStatus} days={r.measurementDays} date={r.measurementDate} />
      </TableCell>
      <TableCell className="py-2">
        <DeadlineCell status={r.calibrationStatus} days={r.calibrationDays} date={r.calibrationDate} />
      </TableCell>
      <TableCell className="py-2">
        <Cell2
          top={<StatusBadge status={SEVERITY_TONE[r.severity]} size="sm" withIcon>{SEVERITY_LABEL[r.severity]}</StatusBadge>}
          bottom={signals ? `+ ${signals}` : null}
          title={signalsTitle || undefined}
        />
      </TableCell>
    </TableRow>
  );
}

function DeadlineCell({ status, days, date }: { status: DeadlineStatus; days: number | null; date: string | null }) {
  return (
    <Cell2
      top={<StatusBadge status={DEADLINE_TONE[status]} size="sm">{DEADLINE_SHORT[status]}</StatusBadge>}
      bottom={date ? <span className="tabular-nums">há {fmtDays(days)}</span> : "sem data"}
      title={date ? `Última em ${formatDate(date)}` : undefined}
    />
  );
}

// ---------------------------------------------------------------------------
// Distribuições
// ---------------------------------------------------------------------------
const BAR_COLOR = "var(--chart-brand-primary)";
const OTHER_COLOR = "var(--chart-neutral)";
/** Barras visíveis por gráfico; o restante vira "Outros" (a tabela acessível traz tudo). */
const BAR_LIMIT = 12;

const isNone = (key: string | null | undefined) => key == null || key === "" || key === "—";
const STATUS_COLOR: Record<CanonicalStatus, string> = {
  em_uso: chartColorOf(STATUS_TONE.em_uso),
  estoque: chartColorOf(STATUS_TONE.estoque),
  ressolagem: chartColorOf(STATUS_TONE.ressolagem),
  descartado: chartColorOf(STATUS_TONE.descartado),
  // Descartado e baixado têm o mesmo tom de negócio; no gráfico, uma cor própria para distinguir as fatias.
  baixado: "var(--chart-future)",
  outro: "var(--chart-warning)",
};

interface DistSpec {
  testId: string;
  title: string;
  description: string;
  noneLabel: string;
  list: TireDistItem[];
  /** Rótulo do item (sem o "Sem …"). */
  label?: (item: TireDistItem) => string;
  /** Linhas extras do tooltip e da tabela (críticos e vencidos por local). */
  extra?: boolean;
  /** Filtro global da Base geral que reproduz a barra. */
  filter?: string;
  /** A distribuição é dos pneus em uso (o destino filtra a situação). */
  inUse?: boolean;
  /** Barras visíveis antes de "Outros" (lista em ordem de quantidade); sem limite quando a ordem é do vocabulário. */
  limit?: number;
  /** Ocupa duas colunas (rótulos longos). */
  wide?: boolean;
  /** Título do tooltip (padrão: o rótulo). */
  tipTitle?: (item: TireDistItem) => string;
}

function Distributions({ data, ctx, canBase }: { data: TireOverview; ctx: TiresPanelContext; canBase: boolean }) {
  const d = data.distributions;
  if (!d) return null;
  const select = (spec: DistSpec) =>
    canBase && spec.filter
      ? (item: HBarDatum) => {
          if (item.key === "__outros" || isNone(item.key)) return;
          ctx.navigate({ aba: "base", visao: "fogo", pagina: null, situacao: spec.inUse ? "em_uso" : null, [spec.filter as string]: item.key });
        }
      : undefined;
  const hint = canBase ? " Clique numa barra para abrir a Base geral com esse filtro." : "";

  const profile: DistSpec[] = [
    { testId: "brand", title: "Marcas", description: "Todos os pneus da fotografia.", noneLabel: "Sem marca", list: d.brand, filter: "marca" },
    { testId: "model", title: "Modelos", description: "Os 12 modelos mais frequentes, todos os pneus.", noneLabel: "Sem modelo", list: d.model, filter: "modelo" },
    { testId: "dimension", title: "Dimensões", description: "Todos os pneus da fotografia.", noneLabel: "Sem dimensão", list: d.dimension, filter: "dimensao" },
    { testId: "life", title: "Vida", description: "Nº da vida no Rodopar, todos os pneus.", noneLabel: "Sem vida informada", list: d.life, label: (i) => `Vida ${i.key}`, filter: "vida", limit: Infinity },
    {
      testId: "position", title: "Posições", description: "Pneus em uso por posição, na ordem do dicionário de posições.", noneLabel: "Sem posição", list: d.position,
      label: (i) => i.label ?? i.key, tipTitle: (i) => (i.label && i.label !== i.key ? `${i.label} (${i.key})` : i.key),
      filter: "posicao", inUse: true, limit: Infinity, wide: true,
    },
    { testId: "vehicle-type", title: "Tipos de equipamento", description: "Pneus em uso pelo tipo do veículo.", noneLabel: "Sem tipo", list: d.vehicleType, filter: "tipo", inUse: true },
  ];
  const where: DistSpec[] = [
    { testId: "operation", title: "Operações", description: "Pneus em uso por operação; críticos e vencidos no detalhe.", noneLabel: "Sem operação", list: d.operation, extra: true, filter: "operacao", inUse: true },
    { testId: "city", title: "Locais", description: "Pneus em uso por cidade da operação.", noneLabel: "Sem local", list: d.city, extra: true, filter: "local", inUse: true },
    { testId: "br", title: "BRs", description: "As 15 BRs com mais pneus em uso.", noneLabel: "Sem BR", list: d.br, extra: true, filter: "br", inUse: true },
  ];

  return (
    <>
      <Section
        title="Saúde e prazos"
        testId="tires-visao-geral-dist-health"
        description={`Situação de todos os pneus da fotografia; sulco, prazos e pressão dos pneus em uso.${hint}`}
      >
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 2xl:grid-cols-3">
          <StatusDonut list={d.status} />
          <ClassBars
            testId="tread"
            title="Classe de sulco"
            description="Pelo menor sulco de cada pneu em uso."
            order={TREAD_ORDER}
            labelOf={(c) => TREAD_LABEL[c as TreadClass]}
            toneOf={(c) => TREAD_TONE[c as TreadClass]}
            list={d.treadClass}
            onSelect={canBase ? (key) => ctx.navigate({ aba: "base", visao: "fogo", pagina: null, situacao: "em_uso", sulco: key }) : undefined}
          />
          <ClassBars
            testId="measurement"
            title="Status de medição"
            description="Prazo desde a última medição de sulco."
            order={DEADLINE_ORDER}
            labelOf={(c) => DEADLINE_LABEL[c as DeadlineStatus]}
            toneOf={(c) => DEADLINE_TONE[c as DeadlineStatus]}
            list={d.measurementStatus}
            onSelect={canBase ? (key) => ctx.navigate({ aba: "base", visao: "fogo", pagina: null, situacao: "em_uso", medicao: key }) : undefined}
          />
          <ClassBars
            testId="calibration"
            title="Status de calibragem"
            description="Prazo desde a última calibragem."
            order={DEADLINE_ORDER}
            labelOf={(c) => DEADLINE_LABEL[c as DeadlineStatus]}
            toneOf={(c) => DEADLINE_TONE[c as DeadlineStatus]}
            list={d.calibrationStatus}
            onSelect={canBase ? (key) => ctx.navigate({ aba: "base", visao: "fogo", pagina: null, situacao: "em_uso", calibragem: key }) : undefined}
          />
          <ClassBars
            testId="psi"
            title="Pressão (PSI) × regra"
            description="PSI informado contra a faixa da regra aplicável."
            order={PSI_ORDER}
            labelOf={(c) => PSI_LABEL[c as PsiStatus]}
            toneOf={(c) => PSI_TONE[c as PsiStatus]}
            list={d.psiStatus}
            onSelect={canBase ? (key) => ctx.navigate({ aba: "base", visao: "fogo", pagina: null, situacao: "em_uso", pressao: key }) : undefined}
          />
        </div>
      </Section>

      <Section title="Perfil dos pneus" testId="tires-visao-geral-dist-profile" description={hint.trim() || undefined}>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 2xl:grid-cols-3">
          {profile.map((s) => (
            <DistBars key={s.testId} spec={s} onSelect={select(s)} />
          ))}
        </div>
      </Section>

      <Section title="Onde estão os pneus em uso" testId="tires-visao-geral-dist-where" description={`Contexto oficial da operação na data da fotografia (o vínculo é congelado na importação).${hint}`}>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 2xl:grid-cols-3">
          {where.map((s) => (
            <DistBars key={s.testId} spec={s} onSelect={select(s)} />
          ))}
        </div>
      </Section>
    </>
  );
}

const countOf = (list: TireDistItem[], key: string) => list.find((x) => x.key === key)?.count ?? 0;
const shareOf = (n: number, total: number) => (total > 0 ? fmtPct((100 * n) / total) : "—");

function StatusDonut({ list }: { list: TireDistItem[] }) {
  const slices = STATUS_ORDER.filter((s) => s !== "outro" || countOf(list, s) > 0).map((s) => ({
    key: s,
    label: STATUS_LABEL[s],
    value: countOf(list, s),
    color: STATUS_COLOR[s],
  }));
  const total = slices.reduce((a, s) => a + s.value, 0);
  return (
    <ChartCard
      title="Situação"
      description="Todos os pneus da fotografia pela situação no Rodopar."
      empty={total === 0 ? "Nenhum pneu no recorte." : undefined}
      data-testid="tires-visao-geral-dist-status"
    >
      <DonutChart slices={slices} ariaLabel="Pneus por situação" centerLabel="Pneus" />
      <SrTable caption="Pneus por situação" columns={["Situação", "Pneus"]} rows={slices.map((s) => ({ key: s.key, cells: [s.label, fmtInt(s.value)] }))} />
    </ChartCard>
  );
}

function ClassBars({
  testId, title, description, order, labelOf, toneOf, list, onSelect,
}: {
  testId: string;
  title: string;
  description: string;
  order: string[];
  labelOf: (code: string) => string;
  toneOf: (code: string) => string;
  list: TireDistItem[];
  onSelect?: (key: string) => void;
}) {
  const total = list.reduce((a, i) => a + i.count, 0);
  // Ordem fixa do vocabulário; códigos que o vocabulário não conhece vão ao fim, com o próprio código.
  const codes = [...order, ...list.map((i) => i.key).filter((key) => !order.includes(key))];
  const items: HBarDatum[] = codes.map((code) => {
    const n = countOf(list, code);
    const label = labelOf(code) ?? code;
    return {
      key: code,
      label,
      value: n,
      color: chartColorOf(toneOf(code)),
      tooltip: {
        title: label,
        rows: [
          { label: "Pneus em uso", value: fmtInt(n), emphasis: true },
          { label: "Participação", value: shareOf(n, total) },
        ],
        announce: `${label}: ${fmtInt(n)} pneus.`,
      },
    };
  });
  return (
    <ChartCard
      title={title}
      description={description}
      empty={total === 0 ? "Nenhum pneu em uso no recorte." : undefined}
      data-testid={`tires-visao-geral-dist-${testId}`}
    >
      <HBarChart items={items} ariaLabel={`Pneus em uso por ${title.toLowerCase()}`} format={fmtInt} onSelect={onSelect ? (item) => onSelect(item.key) : undefined} labelWidth={176} />
      <SrTable caption={title} columns={[title, "Pneus em uso"]} rows={items.map((i) => ({ key: i.key, cells: [i.label, fmtInt(i.value)] }))} />
    </ChartCard>
  );
}

function DistBars({ spec, onSelect }: { spec: DistSpec; onSelect?: (item: HBarDatum) => void }) {
  const { list } = spec;
  const total = list.reduce((a, i) => a + i.count, 0);
  const nameOf = (i: TireDistItem) => (isNone(i.key) ? spec.noneLabel : spec.label ? spec.label(i) : i.label ?? i.key);
  const limit = spec.limit ?? BAR_LIMIT;
  const head = list.slice(0, limit);
  const rest = list.slice(limit);
  const restCount = rest.reduce((a, i) => a + i.count, 0);
  const subject = spec.inUse ? "Pneus em uso" : "Pneus";

  const items: HBarDatum[] = head.map((i) => {
    const name = nameOf(i);
    const rows: ChartTooltipRow[] = [
      { label: subject, value: fmtInt(i.count), emphasis: true },
      { label: "Participação", value: shareOf(i.count, total) },
    ];
    if (spec.extra) {
      rows.push({ label: "Sulco crítico", value: fmtInt(i.critical ?? null) });
      rows.push({ label: "Medição vencida", value: fmtInt(i.overdue ?? null) });
    }
    return {
      key: isNone(i.key) ? "—" : i.key,
      label: name,
      value: i.count,
      color: isNone(i.key) ? OTHER_COLOR : BAR_COLOR,
      tooltip: { title: spec.tipTitle && !isNone(i.key) ? spec.tipTitle(i) : name, rows, announce: `${name}: ${fmtInt(i.count)} pneus.` },
    };
  });
  if (rest.length > 0) {
    const name = `Outros (${fmtInt(rest.length)})`;
    items.push({
      key: "__outros",
      label: name,
      value: restCount,
      color: OTHER_COLOR,
      tooltip: { title: name, rows: [{ label: subject, value: fmtInt(restCount), emphasis: true }, { label: "Participação", value: shareOf(restCount, total) }] },
    });
  }

  const columns = spec.extra ? [spec.title, subject, "Sulco crítico", "Medição vencida"] : [spec.title, subject];
  return (
    <ChartCard
      title={spec.title}
      description={spec.description}
      empty={total === 0 ? (spec.inUse ? "Nenhum pneu em uso no recorte." : "Nenhum pneu no recorte.") : undefined}
      className={spec.wide ? "lg:col-span-2" : undefined}
      data-testid={`tires-visao-geral-dist-${spec.testId}`}
    >
      <HBarChart items={items} ariaLabel={`${subject} por ${spec.title.toLowerCase()}`} format={fmtInt} onSelect={onSelect} labelWidth={spec.wide ? 260 : 200} />
      <SrTable
        caption={`${subject} por ${spec.title.toLowerCase()}`}
        columns={columns}
        rows={list.map((i, idx) => ({
          key: `${i.key}-${idx}`,
          cells: spec.extra ? [nameOf(i), fmtInt(i.count), fmtInt(i.critical ?? null), fmtInt(i.overdue ?? null)] : [nameOf(i), fmtInt(i.count)],
        }))}
      />
    </ChartCard>
  );
}

// ---------------------------------------------------------------------------
// Tendência por fotografia
// ---------------------------------------------------------------------------
/** "05/10" a partir de aaaa-mm-dd. */
const dayMonth = (iso: string) => {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}` : iso;
};

interface Series {
  key: string;
  title: string;
  kind: "number" | "percent";
  value: (t: TireTrendPoint) => number | null;
  coverage?: (t: TireTrendPoint) => number | null;
}

const SERIES: Series[] = [
  { key: "in-use", title: "Pneus em uso", kind: "number", value: (t) => t.inUse },
  { key: "critical", title: "Sulco crítico", kind: "number", value: (t) => t.critical },
  { key: "psi-out", title: "PSI fora da faixa", kind: "number", value: (t) => t.psiOut },
  { key: "measurement", title: "Aderência de medição", kind: "percent", value: (t) => t.measurementAdherencePct, coverage: (t) => t.measurementCoveragePct },
  { key: "calibration", title: "Aderência de calibragem", kind: "percent", value: (t) => t.calibrationAdherencePct, coverage: (t) => t.calibrationCoveragePct },
  { key: "quality", title: "Índice de qualidade", kind: "percent", value: (t) => t.qualityScore },
];

function TrendSection({ trend, referenceDate }: { trend: TireTrendPoint[]; referenceDate: string }) {
  return (
    <ChartCard
      title="Tendência por fotografia"
      headingLevel={2}
      description="Até as 12 últimas fotografias confirmadas, com os mesmos filtros. Cada fotografia é avaliada na própria data — por isso a aderência do último ponto pode diferir do indicador acima, que conta os prazos até hoje."
      empty={trend.length === 0 ? "Nenhuma fotografia confirmada até esta data." : undefined}
      data-testid="tires-visao-geral-trend"
    >
      <div className="grid grid-cols-1 gap-x-6 gap-y-5 md:grid-cols-2 xl:grid-cols-3">
        {SERIES.map((s) => {
          const points: TrendPoint[] = trend.map((t) => {
            const v = s.value(t);
            const cov = s.coverage?.(t);
            const fmt = s.kind === "percent" ? fmtPct : fmtInt;
            return {
              key: t.referenceDate,
              label: dayMonth(t.referenceDate),
              value: v,
              current: t.referenceDate === referenceDate,
              tooltip: {
                title: `Fotografia de ${formatDate(t.referenceDate)}`,
                rows: [
                  { label: s.title, value: fmt(v), emphasis: true },
                  ...(s.coverage ? [{ label: "Cobertura", value: fmtPct(cov ?? null) }] : []),
                ],
                announce: `${formatDate(t.referenceDate)}: ${s.title} ${fmt(v)}.`,
              },
            };
          });
          return (
            <div key={s.key} className="flex min-w-0 flex-col gap-1" data-testid={`tires-visao-geral-trend-${s.key}`}>
              <h3 className="text-label font-semibold text-fg-secondary">{s.title}</h3>
              <TrendChart
                points={points}
                ariaLabel={`${s.title} por fotografia`}
                kind={s.kind}
                format={s.kind === "percent" ? (v) => fmtPct(v) : (v) => fmtInt(v)}
                axisFormat={s.kind === "percent" ? (v) => `${fmtInt(v)}%` : (v) => fmtInt(v)}
                height={110}
              />
            </div>
          );
        })}
      </div>
      <SrTable
        caption="Tendência por fotografia"
        columns={["Fotografia", "Pneus", "Em uso", "Sulco crítico", "PSI fora", "Aderência de medição", "Cobertura de medição", "Aderência de calibragem", "Cobertura de calibragem", "Índice de qualidade"]}
        rows={trend.map((t) => ({
          key: t.referenceDate,
          cells: [
            formatDate(t.referenceDate), fmtInt(t.total), fmtInt(t.inUse), fmtInt(t.critical), fmtInt(t.psiOut),
            fmtPct(t.measurementAdherencePct), fmtPct(t.measurementCoveragePct), fmtPct(t.calibrationAdherencePct),
            fmtPct(t.calibrationCoveragePct), fmtPct(t.qualityScore),
          ],
        }))}
      />
    </ChartCard>
  );
}

// ---------------------------------------------------------------------------
// Parâmetros vigentes
// ---------------------------------------------------------------------------
function ParametersFooter({ p, to }: { p: TireParameterSet; to: Nav }) {
  const nav = to("parametros");
  const retread = [
    p.retreadAlertUseRodoparCondition ? "condição “Recapar” no Rodopar" : null,
    p.retreadAlertTreadMm != null ? `menor sulco até ${fmtMm(p.retreadAlertTreadMm)}` : null,
  ].filter(Boolean);
  return (
    <footer className="border-t border-border-subtle pt-4 text-caption text-fg-muted" data-testid="tires-visao-geral-parameters">
      <p>
        <span className="font-semibold text-fg-secondary">Parâmetros vigentes desde {formatDate(p.effectiveFrom)}:</span> medição em dia até{" "}
        {fmtDays(p.measurementOkDays)} e próxima até {fmtDays(p.measurementWarningDays)}; calibragem em dia até {fmtDays(p.calibrationOkDays)} e próxima até{" "}
        {fmtDays(p.calibrationWarningDays)}; sulco crítico até {fmtMm(p.treadCriticalMm)} e atenção até {fmtMm(p.treadAttentionMm)} (o mínimo legal vem
        da regra de PSI); revisão de vistoria em {fmtDays(p.reviewSlaDays)} e lançamento no Rodopar em {fmtDays(p.rodoparSyncSlaDays)}; alerta de
        ressolagem: {retread.length ? retread.join(" ou ") : "desligado"}.{" "}
        {nav ? (
          <a href={nav.href} onClick={nav.onClick} className="rounded-xs font-medium text-link hover:text-link-hover hover:underline hfm-focus-ring" data-testid="tires-visao-geral-parameters-link">
            Ver os parâmetros
          </a>
        ) : null}
      </p>
    </footer>
  );
}

/** aaaa-mm-dd deslocada em dias, pelo calendário (sem fuso). */
function shiftDays(iso: string, days: number): string | null {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + days));
  return d.toISOString().slice(0, 10);
}
