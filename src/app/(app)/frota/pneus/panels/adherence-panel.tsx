"use client";

import * as React from "react";
import Link from "next/link";
import {
  CalendarClock, CircleCheck, ClipboardList, Gauge, History, OctagonAlert, Percent, Ruler, ThermometerSun, TriangleAlert, Truck,
  CloudDownload,
} from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/feedback/alert";
import { InsightCard } from "@/components/feedback/insight-card";
import { ChartCard } from "@/components/charts";
import { Button } from "@/components/ui/button";
import { MetricStrip, type MetricStripItem } from "@/components/ui/kpi-card";
import { StatusBadge } from "@/components/ui/status-badge";
import { Table, TableBody, TableCell, TableContainer, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { TiresIndicatorData } from "@/lib/tires/loaders";
import {
  INDICATOR_LABEL, fmt1, fmtDays, fmtInt, fmtMm, fmtNum, formatDate, plural,
  type TireIndicatorKey, type TiresIndicator,
} from "@/lib/tires/types";
import type { TiresPanelContext } from "../shared";
import { PanelEmpty, PanelError, Section, SubTabs, chartColorOf, useTiresLink, type TiresNavLink } from "./tires-ui";
import { CalibrationMatrix, Columns, StatusBars, type ColumnItem } from "./indicator/charts";
import { BreakdownSection } from "./indicator/breakdown";
import { IndicatorKpi } from "./indicator/kpi";
import {
  INDICATOR_SUBS, fmtDaysAvg, statusCount, statusEntries,
  type IndicatorTab,
} from "./indicator/model";
import { PENDING_ANCHOR, PendingSection } from "./indicator/pending";
import { TrendSection } from "./indicator/trend";

/**
 * Gestão de Pneus → Aderência MM e Aderência calibragem: visões gerenciais,
 * uma por indicador (Sulco, Prazo de medição | Calibragem: prazo + PSI, Prazo
 * de calibragem, Pressão), todas com o mesmo esqueleto — definição, cartões,
 * distribuição, onde estão os desvios, evolução semanal e pendências.
 *
 * Tudo vem de `tires_indicator` (e da série semanal de `tires_kpi_history`):
 * o que é conforme, críticos, quebras e pendências são decididos no banco. A
 * tela só apresenta e liga cada número à lista que o explica.
 */
export function AdherencePanel({ tab, data, ctx }: { tab: IndicatorTab; data: TiresIndicatorData | null; ctx: TiresPanelContext }) {
  const noun = tab === "medicao" ? "medição" : "calibragem";
  if (ctx.error) {
    return <PanelError ctx={ctx} title={`Não foi possível carregar os indicadores de ${noun}.`} testId="tires-indicator-error" />;
  }
  if (!data) {
    return (
      <PanelEmpty
        icon={<ClipboardList />}
        title={`Sem dados dos indicadores de ${noun}`}
        description="A rotina não devolveu resultado. Recarregue a página."
        testId="tires-indicator-empty"
      />
    );
  }
  if (data.indicator.empty) {
    return (
      <PanelEmpty
        icon={<CloudDownload />}
        title="Nenhum dado oficial carregado"
        description={`Os indicadores de ${noun} são calculados sobre a base oficial (Rodopar), sincronizada do SharePoint. Assim que os primeiros dados forem confirmados, eles aparecem aqui.`}
        testId="tires-indicator-empty"
        action={
          ctx.perms.import ? (
            <Button asChild size="sm" variant="primary">
              <Link href={`${ctx.basePath}?aba=sincronizacao`}>
                <CloudDownload aria-hidden />
                Abrir a sincronização
              </Link>
            </Button>
          ) : undefined
        }
      />
    );
  }
  return <IndicatorView tab={tab} data={data} ctx={ctx} />;
}

/** Nome alternativo (o contrato novo é por aba + indicador). */
export const IndicatorPanel = AdherencePanel;

function IndicatorView({ tab, data, ctx }: { tab: IndicatorTab; data: TiresIndicatorData; ctx: TiresPanelContext }) {
  const ind = data.indicator;
  const subs = INDICATOR_SUBS[tab];
  const sub = (subs.find((s) => s.value === data.sub) ?? subs.find((s) => s.indicator === ind.indicator) ?? subs[0]).value;
  const link = useTiresLink(ctx);

  // Trocar de sub-visão também limpa a situação filtrada (os códigos mudam de um indicador para outro).
  const subCtx = React.useMemo<TiresPanelContext>(
    () => ({ ...ctx, navigate: (patch) => ctx.navigate({ ...patch, pendencia: null }) }),
    [ctx],
  );

  /** Leva à lista de pendências já filtrada pela situação e rola até ela. */
  const toPending = React.useCallback(
    (code: string | null): TiresNavLink => {
      const l = link({ pendencia: code });
      return {
        href: `${l.href}#${PENDING_ANCHOR}`,
        onClick: (event) => {
          l.onClick?.(event);
          if (event.defaultPrevented) document.getElementById(PENDING_ANCHOR)?.scrollIntoView({ behavior: "smooth", block: "start" });
        },
      };
    },
    [link],
  );

  return (
    <div className="flex flex-col gap-6" data-testid="tires-indicator" data-indicator={ind.indicator} data-sub={sub}>
      <div className="flex flex-col gap-3">
        <SubTabs
          ctx={subCtx}
          value={sub}
          items={subs.map((s) => ({ value: s.value, label: s.label }))}
          label={tab === "medicao" ? "Indicadores de medição" : "Indicadores de calibragem"}
          testIdPrefix="tires-indicator-sub"
        />
        <p className="text-body-sm text-fg-muted" data-testid="tires-indicator-period">
          <span className="font-medium text-fg-secondary">{INDICATOR_LABEL[ind.indicator]}</span> · dados de{" "}
          <span className="font-medium text-fg-secondary tabular-nums">{formatDate(ind.referenceDate)}</span> · {fmtInt(ind.kpis.base)}{" "}
          {plural(ind.kpis.base, "pneu em uso no recorte", "pneus em uso no recorte")} · dias contados até{" "}
          <span className="tabular-nums">{formatDate(ind.asOf)}</span>
        </p>
      </div>

      {!ind.isLatest ? (
        <Alert
          variant="warning"
          icon={<History />}
          data-testid="tires-indicator-historical"
          action={
            <Button asChild size="sm" variant="outline">
              <a {...link({ data: null, foto: null, pendencia: null })}>Ver os dados mais recentes</a>
            </Button>
          }
        >
          <AlertTitle>Consulta a dados anteriores</AlertTitle>
          <AlertDescription>
            Você está vendo os dados de {formatDate(ind.referenceDate)}, que não são os mais recentes. Dias e prazos são contados até{" "}
            {formatDate(ind.asOf)}, como estavam naquele dia.
          </AlertDescription>
        </Alert>
      ) : null}

      <DefinitionNote ind={ind} tab={tab} ctx={ctx} />

      <KpiRow ind={ind} toPending={toPending} />
      <SupportStrip ind={ind} />

      <DistributionSection ind={ind} toPending={toPending} />
      {ind.indicator === "psi" && (ind.details.gaps?.length ?? 0) > 0 ? <RuleGaps ind={ind} toPending={toPending} /> : null}

      <BreakdownSection ind={ind} ctx={ctx} />

      {ctx.perms.dashboard ? <TrendSection indicator={ind.indicator} history={data.history} ctx={ctx} /> : null}

      <PendingSection ind={ind} tab={tab} sub={sub} ctx={ctx} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Definição (com os números da regra vigente)
// ---------------------------------------------------------------------------
function DefinitionNote({ ind, tab, ctx }: { ind: TiresIndicator; tab: IndicatorTab; ctx: TiresPanelContext }) {
  const p = ind.parameters;
  const link = useTiresLink(ctx);
  const days = (n: number) => fmtDays(n);
  const strong = (t: React.ReactNode) => <strong className="font-semibold text-fg">{t}</strong>;
  let body: React.ReactNode;
  let extra: React.ReactNode = null;

  switch (ind.indicator) {
    case "tread":
      body = (
        <>
          {strong("Sulco OK")} = menor sulco acima de {fmtMm(p.treadCriticalMm)} (limite crítico) e acima do sulco legal da regra do pneu. Até{" "}
          {fmtMm(p.treadCriticalMm)} é crítico; acima disso e até {fmtMm(p.treadAttentionMm)}, atenção — ainda conforme, mas no radar. Sem
          medição não conta como OK.
        </>
      );
      break;
    case "measurement":
    case "calibration": {
      const cal = ind.indicator === "calibration";
      const ok = cal ? p.calibrationOkDays : p.measurementOkDays;
      const warn = cal ? p.calibrationWarningDays : p.measurementWarningDays;
      const noun = cal ? "calibragem" : "medição";
      body = (
        <>
          {strong("Prazo OK")} = em dia (até {days(ok)} desde a última {noun}) ou próximo do vencimento (até {days(warn)}). Acima de {days(warn)}{" "}
          está vencido; sem data de {noun}, sem registro — os dois são não conformes. Atraso = dias que passaram do limite de {days(warn)}.
        </>
      );
      if (cal && ind.details.onTimeBadPsi != null) {
        const toConf = link({ sub: "conformidade", pendencia: null });
        extra = (
          <p className="mt-1">
            Prazo em dia não garante pressão certa: {strong(`${fmtInt(ind.details.onTimeBadPsi)} ${plural(ind.details.onTimeBadPsi, "pneu está", "pneus estão")}`)}{" "}
            no prazo com PSI inadequado.{" "}
            <a href={toConf.href} onClick={toConf.onClick} className="rounded-xs font-medium text-link underline-offset-2 hover:text-link-hover hover:underline hfm-focus-ring">
              Ver em Calibragem: prazo + PSI
            </a>
          </p>
        );
      }
      break;
    }
    case "psi":
      body = (
        <>
          {strong("PSI OK")} = leitura da última calibragem dentro da faixa mín.–máx. da regra mais específica (tipo de equipamento × medida ×
          posição × eixo). Sem regra = {strong("sem parâmetro")}: não avaliado, e nunca conta como adequado. Sem leitura = sem calibragem.
          Desvio = quanto o PSI passou do limite da faixa, em % sobre o ideal.
        </>
      );
      break;
    case "calibration_conformity":
      body = (
        <>
          {strong("Conforme")} = prazo de calibragem OK (até {days(p.calibrationWarningDays)} desde a última calibragem) {strong("e")} PSI dentro
          da faixa da regra. {strong("Calibragem feita no prazo com pressão inadequada não é saudável")}: o pneu conta como não conforme. PSI sem
          parâmetro ou sem leitura também é inadequado.
        </>
      );
      break;
    default:
      body = <>{INDICATOR_LABEL[ind.indicator]}: regra centralizada no banco.</>;
  }

  return (
    <InsightCard tone="info" label={`Definição · ${tab === "medicao" ? "Aderência MM" : "Aderência calibragem"}`} compact data-testid="tires-indicator-definition">
      <p>{body}</p>
      {extra}
    </InsightCard>
  );
}

// ---------------------------------------------------------------------------
// Cartões
// ---------------------------------------------------------------------------
const CRITICAL_TEXT: Record<TireIndicatorKey, (ind: TiresIndicator) => string> = {
  tread: (ind) => `sulco até ${fmtMm(ind.parameters.treadCriticalMm)} ou abaixo do legal`,
  measurement: () => "medição vencida",
  calibration: () => "calibragem vencida",
  psi: () => "PSI abaixo ou acima da faixa",
  calibration_conformity: () => "pneus com severidade crítica",
  overall: () => "pneus com severidade crítica",
};

function KpiRow({ ind, toPending }: { ind: TiresIndicator; toPending: (code: string | null) => TiresNavLink }) {
  const k = ind.kpis;
  const d = ind.details;
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6" data-testid="tires-indicator-kpis">
      <IndicatorKpi
        testId="tires-indicator-kpi-pct"
        label="Conformidade"
        value={k.pct == null ? "—" : fmt1(k.pct)}
        unit={k.pct == null ? undefined : "%"}
        period={k.base > 0 ? `${fmtInt(k.ok)} de ${fmtInt(k.base)} pneus em uso` : "nenhum pneu em uso no recorte"}
        status="primary"
        icon={<Percent />}
      />
      <IndicatorKpi
        testId="tires-indicator-kpi-ok"
        label="Conformes"
        value={fmtInt(k.ok)}
        unit={plural(k.ok, "pneu", "pneus")}
        period="dentro da regra deste indicador"
        status={k.ok > 0 ? "success" : undefined}
        icon={<CircleCheck />}
      />
      <IndicatorKpi
        testId="tires-indicator-kpi-nok"
        label="Não conformes"
        value={fmtInt(k.nok)}
        unit={plural(k.nok, "pneu", "pneus")}
        period={k.nok > 0 ? "ver a lista de pendências" : "nenhuma pendência"}
        status={k.nok > 0 ? "danger" : undefined}
        icon={<TriangleAlert />}
        nav={k.nok > 0 ? toPending(null) : null}
        destination="Ir para a lista de pendências"
      />
      <IndicatorKpi
        testId="tires-indicator-kpi-critical"
        label="Críticos"
        value={fmtInt(k.critical)}
        unit={plural(k.critical, "pneu", "pneus")}
        period={CRITICAL_TEXT[ind.indicator](ind)}
        status={k.critical > 0 ? "danger" : undefined}
        icon={<OctagonAlert />}
      />
      <IndicatorKpi
        testId="tires-indicator-kpi-fleets"
        label="Frotas afetadas"
        value={fmtInt(k.fleetsAffected)}
        unit={plural(k.fleetsAffected, "frota", "frotas")}
        period="com ao menos um pneu não conforme"
        status={k.fleetsAffected > 0 ? "warning" : undefined}
        icon={<Truck />}
      />
      {ind.indicator === "tread" ? (
        <IndicatorKpi
          testId="tires-indicator-kpi-below-legal"
          label="Abaixo do legal"
          value={fmtInt(statusCount(ind, "abaixo_legal"))}
          unit={plural(statusCount(ind, "abaixo_legal"), "pneu", "pneus")}
          period="sulco no ou abaixo do legal da regra"
          status={statusCount(ind, "abaixo_legal") > 0 ? "danger" : undefined}
          icon={<Ruler />}
          nav={statusCount(ind, "abaixo_legal") > 0 ? toPending("abaixo_legal") : null}
          destination="Ver os pneus abaixo do sulco legal"
        />
      ) : ind.indicator === "measurement" || ind.indicator === "calibration" ? (
        <IndicatorKpi
          testId="tires-indicator-kpi-due7d"
          label="Vencem em 7 dias"
          value={fmtInt(d.due7d)}
          unit={plural(d.due7d, "pneu", "pneus")}
          period={`em 15 dias: ${fmtInt(d.due15d)}`}
          status={(d.due7d ?? 0) > 0 ? "warning" : undefined}
          icon={<CalendarClock />}
        />
      ) : ind.indicator === "psi" ? (
        <IndicatorKpi
          testId="tires-indicator-kpi-psi-dev"
          label="Desvio médio"
          value={d.avgDevPct == null ? "—" : fmt1(d.avgDevPct)}
          unit={d.avgDevPct == null ? undefined : "%"}
          period={d.avgDevPct == null ? "nenhum pneu fora da faixa" : "além do limite da faixa, sobre o ideal"}
          status={d.avgDevPct != null ? "warning" : undefined}
          icon={<Gauge />}
        />
      ) : ind.indicator === "calibration_conformity" ? (
        <IndicatorKpi
          testId="tires-oncall-bad-psi"
          label="No prazo, mas PSI inadequado"
          value={fmtInt(d.onTimeBadPsi)}
          unit={plural(d.onTimeBadPsi, "pneu", "pneus")}
          period="calibrado no prazo com pressão fora: não é saudável"
          badge={
            <StatusBadge status="danger" size="sm">
              Não conforme
            </StatusBadge>
          }
          status={(d.onTimeBadPsi ?? 0) > 0 ? "danger" : "neutral"}
          icon={<ThermometerSun />}
          nav={(d.onTimeBadPsi ?? 0) > 0 ? toPending("prazo_ok_psi_inadequado") : null}
          destination="Ver os pneus no prazo com PSI inadequado"
        />
      ) : null}
    </div>
  );
}

/** Números de apoio, abaixo dos cartões: o segundo nível da leitura. */
function SupportStrip({ ind }: { ind: TiresIndicator }) {
  const d = ind.details;
  const p = ind.parameters;
  let items: MetricStripItem[] = [];
  let cols: string | undefined;
  switch (ind.indicator) {
    case "tread":
      items = [
        { key: "avg", label: "Sulco médio", value: fmtMm(d.avg), hint: "menor sulco dos pneus em uso" },
        { key: "median", label: "Mediana", value: fmtMm(d.median), hint: "metade dos pneus abaixo deste valor" },
        { key: "min", label: "Menor sulco", value: fmtMm(d.min), hint: "o pneu mais gasto do recorte" },
        { key: "divergent", label: "Divergências de MM", value: fmtInt(d.divergent), hint: "menor MM informado difere do medido" },
      ];
      break;
    case "measurement":
    case "calibration": {
      const warn = ind.indicator === "calibration" ? p.calibrationWarningDays : p.measurementWarningDays;
      items = [
        { key: "missing", label: "Sem registro", value: fmtInt(statusCount(ind, "sem_registro")), hint: "sem data no Rodopar" },
        { key: "due15d", label: "Vencem em 15 dias", value: fmtInt(d.due15d), hint: "vencimento a partir de hoje" },
        { key: "maxLate", label: "Maior atraso", value: fmtDays(d.maxLate), hint: `além do prazo de ${fmtDays(warn)}` },
        { key: "avgLate", label: "Atraso médio", value: fmtDaysAvg(d.avgLate), hint: "entre os vencidos" },
      ];
      break;
    }
    case "psi":
      items = [
        { key: "low", label: "Abaixo da faixa", value: fmtInt(statusCount(ind, "baixa")), hint: "PSI menor que o mínimo" },
        { key: "high", label: "Acima da faixa", value: fmtInt(statusCount(ind, "excesso")), hint: "PSI maior que o máximo" },
        { key: "norule", label: "Sem parâmetro", value: fmtInt(statusCount(ind, "sem_parametro")), hint: "não avaliado — nunca conta como adequado" },
        { key: "gaps", label: "Combinações sem regra", value: fmtInt(d.ruleGaps), hint: "tipo × medida × posição sem regra de PSI" },
      ];
      break;
    case "calibration_conformity":
      cols = "md:grid-cols-2";
      items = [
        { key: "lateGood", label: "PSI OK, prazo vencido", value: fmtInt(d.lateGoodPsi), hint: "pressão certa, mas calibragem fora do prazo" },
        { key: "lateBad", label: "Prazo e PSI fora", value: fmtInt(d.lateBadPsi), hint: "calibragem vencida e pressão inadequada" },
      ];
      break;
    default:
      return null;
  }
  return (
    <div data-testid="tires-indicator-details">
      <MetricStrip items={items} ariaLabel={`Detalhes de ${INDICATOR_LABEL[ind.indicator]}`} className={cols} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Distribuição
// ---------------------------------------------------------------------------
function DistributionSection({ ind, toPending }: { ind: TiresIndicator; toPending: (code: string | null) => TiresNavLink }) {
  const entries = statusEntries(ind);
  const active = ind.status || null;
  return (
    <Section
      title="Distribuição"
      testId="tires-indicator-distribution"
      description={`Os ${fmtInt(ind.kpis.base)} pneus em uso por situação neste indicador. Clique numa situação não conforme para filtrar as pendências.`}
    >
      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard title="Por situação" description="Quantidade e % sobre os pneus em uso">
          <StatusBars entries={entries} base={ind.kpis.base} active={active} linkFor={toPending} testId="tires-indicator-status-bars" />
        </ChartCard>
        <SpecificChart ind={ind} entries={entries} active={active} toPending={toPending} />
      </div>
    </Section>
  );
}

function SpecificChart({
  ind, entries, active, toPending,
}: {
  ind: TiresIndicator;
  entries: ReturnType<typeof statusEntries>;
  active: string | null;
  toPending: (code: string | null) => TiresNavLink;
}) {
  const d = ind.details;
  const p = ind.parameters;
  switch (ind.indicator) {
    case "tread": {
      const counts = new Map((d.histogram ?? []).map((h) => [h.bucket, h.count]));
      const items: ColumnItem[] = Array.from({ length: 17 }, (_, b) => ({
        key: String(b),
        label: b === 16 ? "16+" : String(b),
        count: counts.get(b) ?? 0,
        tone: b < p.treadCriticalMm ? "danger" : b < p.treadAttentionMm ? "warning" : "success",
      }));
      const total = items.reduce((a, i) => a + i.count, 0);
      return (
        <ChartCard
          title="Menor sulco (mm)"
          description="Pneus por faixa de 1 mm do menor sulco (16 = 16 mm ou mais). As linhas marcam os limites da regra."
          empty={total === 0 ? "Nenhum pneu com medição de sulco no recorte." : undefined}
          data-testid="tires-indicator-histogram"
        >
          <Columns
            items={items}
            markers={[
              { at: p.treadCriticalMm, label: fmtMm(p.treadCriticalMm) },
              { at: p.treadAttentionMm, label: fmtMm(p.treadAttentionMm) },
            ]}
            legend={[
              { key: "crit", label: `Crítico: até ${fmtMm(p.treadCriticalMm)}`, color: chartColorOf("danger") },
              { key: "att", label: `Atenção: até ${fmtMm(p.treadAttentionMm)}`, color: chartColorOf("warning") },
              { key: "ok", label: `Adequado: acima de ${fmtMm(p.treadAttentionMm)}`, color: chartColorOf("success") },
              { key: "lim", label: "Limites da regra", color: "var(--chart-target)", shape: "dashed" },
            ]}
            caption={`Pneus em uso por menor sulco, em faixas de 1 mm. Limite crítico ${fmtNum(p.treadCriticalMm)} mm, atenção ${fmtNum(p.treadAttentionMm)} mm.`}
          />
        </ChartCard>
      );
    }
    case "measurement":
    case "calibration": {
      const warn = ind.indicator === "calibration" ? p.calibrationWarningDays : p.measurementWarningDays;
      const items: ColumnItem[] = (d.lateBuckets ?? []).map((b) => ({
        key: b.bucket,
        label: b.bucket.replace("-", "–"),
        count: b.count,
        tone: "danger",
      }));
      const total = items.reduce((a, i) => a + i.count, 0);
      return (
        <ChartCard
          title="Dias de atraso"
          description={`Pneus vencidos por dias além do prazo de ${fmtDays(warn)}.`}
          empty={total === 0 ? "Nenhum pneu com prazo vencido no recorte." : undefined}
          data-testid="tires-indicator-late"
        >
          <Columns items={items} caption={`Pneus vencidos por faixa de dias de atraso (além de ${fmtDays(warn)}).`} />
        </ChartCard>
      );
    }
    case "psi": {
      const items: ColumnItem[] = (d.deviationBuckets ?? []).map((b) => ({
        key: `${b.side}-${b.bucket}`,
        label: b.bucket.replace(/-/g, "−"),
        count: b.count,
        tone: b.side === "below" ? "danger" : b.side === "above" ? "warning" : "success",
        band: b.side === "ok",
      }));
      return (
        <ChartCard
          title="Desvio em relação à faixa"
          description="Pneus pelo desvio do PSI, em % sobre o ideal. Sem parâmetro e sem calibragem não têm desvio e ficam fora."
          empty={items.length === 0 ? "Sem leituras de PSI no recorte." : undefined}
          data-testid="tires-indicator-deviation"
        >
          <Columns
            items={items}
            legend={[
              { key: "below", label: "Abaixo da faixa", color: chartColorOf("danger") },
              { key: "ok", label: "Na faixa", color: chartColorOf("success") },
              { key: "above", label: "Acima da faixa", color: chartColorOf("warning") },
            ]}
            caption="Pneus em uso pelo desvio do PSI em relação à faixa da regra: abaixo, na faixa e acima."
          />
        </ChartCard>
      );
    }
    case "calibration_conformity":
      return (
        <ChartCard
          title="Prazo × PSI"
          description="Os quatro cenários da calibragem. PSI inadequado inclui fora da faixa, sem parâmetro e sem leitura."
          data-testid="tires-indicator-matrix"
        >
          <CalibrationMatrix entries={entries} base={ind.kpis.base} active={active} linkFor={toPending} />
        </ChartCard>
      );
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Combinações sem regra de PSI
// ---------------------------------------------------------------------------
function RuleGaps({ ind, toPending }: { ind: TiresIndicator; toPending: (code: string | null) => TiresNavLink }) {
  const gaps = ind.details.gaps ?? [];
  const nav = toPending("sem_parametro");
  return (
    <Section
      title="Combinações sem regra de PSI"
      testId="tires-indicator-gaps"
      description="Tipo de equipamento × medida × posição com pneus calibrados e sem regra de pressão. Esses pneus ficam como “Sem parâmetro”: não são avaliados e nunca contam como adequados."
      actions={
        <Button asChild size="sm" variant="outline">
          <a href={nav.href} onClick={nav.onClick}>
            Ver os pneus
          </a>
        </Button>
      }
    >
      <TableContainer stickyHeader maxHeight={320}>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Tipo de equipamento</TableHead>
              <TableHead>Medida</TableHead>
              <TableHead>Posição</TableHead>
              <TableHead numeric>Pneus sem parâmetro</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {gaps.map((g, i) => (
              <TableRow key={`${g.vehicleTypeName ?? "-"}|${g.dimension ?? "-"}|${g.positionCode ?? "-"}|${i}`} className="h-10" data-testid="tires-indicator-gap-row">
                <TableCell className={g.vehicleTypeName ? "py-1.5 text-fg" : "py-1.5 text-fg-muted"}>{g.vehicleTypeName ?? "Sem tipo"}</TableCell>
                <TableCell className={g.dimension ? "py-1.5 tabular-nums text-fg-secondary" : "py-1.5 text-fg-muted"}>{g.dimension ?? "Sem medida"}</TableCell>
                <TableCell className={g.positionCode ? "py-1.5 text-fg-secondary" : "py-1.5 text-fg-muted"}>{g.positionCode ?? "Sem posição"}</TableCell>
                <TableCell numeric className="py-1.5 font-semibold">{fmtInt(g.tires)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
    </Section>
  );
}
