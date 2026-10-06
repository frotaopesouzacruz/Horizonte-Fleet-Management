"use client";

import * as React from "react";
import Link from "next/link";
import {
  CalendarCheck, CalendarClock, CalendarX, CircleCheck, CircleSlash, ClipboardList, Gauge, History, Layers, Percent,
  Ruler, Settings2, ThermometerSnowflake, ThermometerSun, TriangleAlert, Truck, Upload,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { Alert, AlertDescription, AlertTitle } from "@/components/feedback/alert";
import { InsightCard } from "@/components/feedback/insight-card";
import { ChartLegend } from "@/components/charts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { StatusBadge } from "@/components/ui/status-badge";
import { Table, TableBody, TableCell, TableContainer, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { NativeSelect } from "@/components/governance/selects";
import {
  BREAKDOWN_LABEL, DEADLINE_SHORT, DEADLINE_TONE, PSI_LABEL, PSI_TONE, TIRES_FILTER_PARAM, TREAD_LABEL, TREAD_TONE,
  fmt1, fmtDays, fmtInt, fmtMm, fmtNum, fmtPct, formatDate, plural,
  type DeadlineStatus, type PsiStatus, type TireBreakdownDim, type TireBreakdownItem, type TirePendingRow,
  type TiresAdherence, type TiresFilters, type TiresTone,
} from "@/lib/tires/types";
import type { TiresPanelContext } from "../shared";
import {
  ExportButton, FireLink, PanelEmpty, PanelError, PlateLink, Section, TiresKpi, TiresPagination, useTiresLink, useViewParam,
  type TiresNavLink,
} from "./tires-ui";

/**
 * Gestão de Pneus → Aderência MM e Aderência calibragem.
 *
 * Tudo vem pronto de `tires_adherence` sobre os pneus EM USO da fotografia
 * oficial (Rodopar 10): contagens por prazo, cobertura, aderência, pressão,
 * quebras por dimensão, ranking de veículos, lacunas de regra de PSI e a
 * página de pendências. A tela só formata e liga cada número à lista que o
 * explica — não recalcula prazo, classe de sulco nem situação de pressão.
 */
type Kind = "measurement" | "calibration";
type PendingFilter = "all" | "vencido" | "proximo" | "sem_registro" | "pressao" | "sem_parametro";

const WORDS: Record<Kind, { slug: "medicao" | "calibragem"; noun: string; title: string; missing: string }> = {
  measurement: { slug: "medicao", noun: "medição", title: "Aderência de medição (MM)", missing: "Sem medição" },
  calibration: { slug: "calibragem", noun: "calibragem", title: "Aderência de calibragem", missing: "Sem calibragem" },
};

const PENDING_OPTIONS: Record<Kind, PendingFilter[]> = {
  measurement: ["all", "vencido", "proximo", "sem_registro"],
  calibration: ["all", "vencido", "proximo", "sem_registro", "pressao", "sem_parametro"],
};

const PENDING_LABEL: Record<PendingFilter, string> = {
  all: "Todas",
  vencido: "Vencidos",
  proximo: "Próximos",
  sem_registro: "Sem registro",
  pressao: "Pressão fora da faixa",
  sem_parametro: "Sem parâmetro",
};

const KPI_STATUS: Record<TiresTone, "success" | "warning" | "danger" | "info" | "neutral" | "progress"> = {
  success: "success",
  warning: "warning",
  danger: "danger",
  info: "info",
  neutral: "neutral",
  pending: "neutral",
  progress: "progress",
};

/** Filtro global da tela que corresponde a cada dimensão de quebra (ids canônicos). */
const DIM_FILTER: Record<TireBreakdownDim, keyof TiresFilters> = {
  operation: "operation",
  state: "state",
  city: "city",
  br: "br",
  unit: "unit",
  leader: "leader",
  vehicleType: "vehicleType",
};

const DIM_EMPTY: Record<TireBreakdownDim, string> = {
  operation: "Sem operação",
  state: "Sem estado",
  city: "Sem local",
  br: "Sem BR",
  unit: "Sem filial",
  leader: "Sem liderança",
  vehicleType: "Sem tipo",
};

const DIM_ORDER = Object.keys(BREAKDOWN_LABEL) as TireBreakdownDim[];

/** Cores das fatias (tokens do kit de gráficos; o texto ao lado leva o rótulo). */
const SEGMENTS: { key: DeadlineStatus; field: keyof Pick<TireBreakdownItem, "emDia" | "proximo" | "vencido" | "semRegistro">; bar: string; color: string }[] = [
  { key: "em_dia", field: "emDia", bar: "bg-chart-success", color: "var(--chart-success)" },
  { key: "proximo", field: "proximo", bar: "bg-chart-warning", color: "var(--chart-warning)" },
  { key: "vencido", field: "vencido", bar: "bg-chart-danger", color: "var(--chart-danger)" },
  { key: "sem_registro", field: "semRegistro", bar: "bg-chart-neutral", color: "var(--chart-neutral)" },
];

export function AdherencePanel({ kind, data, ctx }: { kind: Kind; data: TiresAdherence | null; ctx: TiresPanelContext }) {
  const w = WORDS[kind];
  if (ctx.error) {
    return <PanelError ctx={ctx} title={`Não foi possível carregar a aderência de ${w.noun}.`} testId={`tires-${w.slug}-error`} />;
  }
  if (!data) {
    return (
      <PanelEmpty
        icon={<ClipboardList />}
        title={`Sem dados de aderência de ${w.noun}`}
        description="A rotina não devolveu resultado. Recarregue a página."
        testId={`tires-${w.slug}-empty`}
      />
    );
  }
  if (data.empty) {
    return (
      <PanelEmpty
        icon={<Upload />}
        title="Nenhuma fotografia importada"
        description={`A aderência de ${w.noun} é calculada sobre a fotografia oficial importada do Rodopar 10. Assim que a primeira planilha for confirmada, os prazos aparecem aqui.`}
        testId={`tires-${w.slug}-empty`}
        action={
          ctx.perms.import ? (
            <Button asChild size="sm" variant="primary">
              <Link href={`${ctx.basePath}?aba=importacao`}>
                <Upload aria-hidden />
                Importar fotografia
              </Link>
            </Button>
          ) : undefined
        }
      />
    );
  }
  return <AdherenceContent kind={kind} data={data} ctx={ctx} />;
}

function AdherenceContent({ kind, data, ctx }: { kind: Kind; data: TiresAdherence; ctx: TiresPanelContext }) {
  const w = WORDS[kind];
  const cal = kind === "calibration";
  const k = data.kpis;
  const p = data.parameters;
  const link = useTiresLink(ctx);
  const pendingId = `tires-${w.slug}-pendencias`;

  /** Leva à lista de pendências já filtrada e rola até ela. */
  const toPending = (value: PendingFilter): TiresNavLink => {
    const l = link({ pendencia: value === "all" ? null : value });
    return {
      href: `${l.href}#${pendingId}`,
      onClick: (event) => {
        l.onClick?.(event);
        if (event.defaultPrevented) document.getElementById(pendingId)?.scrollIntoView({ behavior: "smooth", block: "start" });
      },
    };
  };

  return (
    <div className="flex flex-col gap-6" data-testid={`tires-${w.slug}`}>
      <p className="text-body-sm text-fg-muted" data-testid={`tires-${w.slug}-period`}>
        Fotografia oficial de <span className="font-medium text-fg-secondary tabular-nums">{formatDate(data.referenceDate)}</span> ·{" "}
        {fmtInt(k.eligible)} {plural(k.eligible, "pneu em uso no recorte", "pneus em uso no recorte")} · dias contados até{" "}
        <span className="tabular-nums">{formatDate(data.asOf)}</span>
      </p>

      {!data.isLatest ? (
        <Alert
          variant="warning"
          icon={<History />}
          data-testid={`tires-${w.slug}-historical`}
          action={
            <Button asChild size="sm" variant="outline">
              <a {...link({ foto: null })}>Ver a fotografia mais recente</a>
            </Button>
          }
        >
          <AlertTitle>Fotografia histórica</AlertTitle>
          <AlertDescription>
            Você está vendo a fotografia de {formatDate(data.referenceDate)}, que não é a mais recente. Dias e prazos são contados até a
            data dela ({formatDate(data.asOf)}), como estavam naquele dia — não até hoje.
          </AlertDescription>
        </Alert>
      ) : null}

      {/* ------------------------------------------------------------ Prazo */}
      <Section
        title={`Prazo de ${w.noun}`}
        testId={`tires-${w.slug}-kpis`}
        description={`Elegíveis são os pneus em uso. Cobertura: pneus com registro de ${w.noun} sobre os elegíveis. Aderência: em dia e próximos sobre os pneus com registro — quem nunca teve ${w.noun} fica fora da aderência e pesa na cobertura.`}
      >
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <TiresKpi
            kpi={`${w.slug}-aderencia`}
            label="Aderência ao prazo"
            value={k.adherencePct == null ? "—" : fmt1(k.adherencePct)}
            unit={k.adherencePct == null ? undefined : "%"}
            period={k.adherencePct == null ? "nenhum pneu com registro" : "em dia + próximo, sobre com registro"}
            status="primary"
            icon={<Percent />}
          />
          <TiresKpi
            kpi={`${w.slug}-cobertura`}
            label="Cobertura"
            value={k.coveragePct == null ? "—" : fmt1(k.coveragePct)}
            unit={k.coveragePct == null ? undefined : "%"}
            period={`${fmtInt(k.withRecord)} de ${fmtInt(k.eligible)} com registro`}
            status="primary"
            icon={<Gauge />}
          />
          <TiresKpi
            kpi={`${w.slug}-elegiveis`}
            label="Elegíveis"
            value={fmtInt(k.eligible)}
            unit={plural(k.eligible, "pneu", "pneus")}
            period="em uso na fotografia"
            icon={<Truck />}
          />
          <TiresKpi
            kpi={`${w.slug}-com-registro`}
            label={`Com registro de ${w.noun}`}
            value={fmtInt(k.withRecord)}
            unit={plural(k.withRecord, "pneu", "pneus")}
            period={`têm data de ${w.noun}`}
            icon={<ClipboardList />}
          />
          <TiresKpi
            kpi={`${w.slug}-em-dia`}
            label="Em dia"
            value={fmtInt(k.emDia)}
            period={`até ${fmtDays(p.okDays)}`}
            status={k.emDia > 0 ? "success" : undefined}
            icon={<CalendarCheck />}
          />
          <TiresKpi
            kpi={`${w.slug}-proximo`}
            label="Próximo do vencimento"
            value={fmtInt(k.proximo)}
            period={`${fmtInt(p.okDays + 1)} a ${fmtDays(p.warningDays)}`}
            status={k.proximo > 0 ? "warning" : undefined}
            icon={<CalendarClock />}
            nav={toPending("proximo")}
            destination="Ver as pendências próximas do vencimento"
          />
          <TiresKpi
            kpi={`${w.slug}-vencido`}
            label="Vencido"
            value={fmtInt(k.vencido)}
            period={`acima de ${fmtDays(p.warningDays)}`}
            status={k.vencido > 0 ? "danger" : undefined}
            icon={<CalendarX />}
            nav={toPending("vencido")}
            destination="Ver as pendências vencidas"
          />
          <TiresKpi
            kpi={`${w.slug}-sem-registro`}
            label={w.missing}
            value={fmtInt(k.semRegistro)}
            period={`nenhuma data de ${w.noun}`}
            status={k.semRegistro > 0 ? "neutral" : undefined}
            icon={<CircleSlash />}
            nav={toPending("sem_registro")}
            destination={`Ver as pendências ${w.missing.toLowerCase()}`}
          />
        </div>
      </Section>

      {cal ? <PressureKpis data={data} toPending={toPending} /> : <TreadKpis data={data} ctx={ctx} />}

      <RuleNote kind={kind} data={data} />

      <BreakdownSection kind={kind} data={data} ctx={ctx} />

      <RankingSection kind={kind} data={data} />

      {cal ? <GapsSection data={data} ctx={ctx} toPending={toPending} /> : null}

      <PendingSection kind={kind} data={data} ctx={ctx} id={pendingId} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Indicadores complementares
// ---------------------------------------------------------------------------
function TreadKpis({ data, ctx }: { data: TiresAdherence; ctx: TiresPanelContext }) {
  const link = useTiresLink(ctx);
  const k = data.kpis;
  const toBase = (sulco: string) =>
    ctx.perms.base ? link({ aba: "base", sulco, pendencia: null, grupo: null }) : null;
  return (
    <Section
      title="Sulco dos pneus em uso"
      testId="tires-medicao-tread"
      description="Classe do menor sulco pela regra vigente. Crítico inclui os pneus abaixo do sulco legal."
    >
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <TiresKpi
          kpi="medicao-sulco-critico"
          label="Sulco crítico"
          value={fmtInt(k.treadCritical)}
          unit={plural(k.treadCritical, "pneu", "pneus")}
          period={`${TREAD_LABEL.abaixo_legal.toLowerCase()} ou ${TREAD_LABEL.critico.toLowerCase()}`}
          status={k.treadCritical > 0 ? "danger" : undefined}
          icon={<Ruler />}
          nav={toBase("abaixo_legal,critico")}
          destination="Abrir a Base geral filtrada por sulco crítico"
        />
        <TiresKpi
          kpi="medicao-sulco-atencao"
          label="Sulco em atenção"
          value={fmtInt(k.treadAttention)}
          unit={plural(k.treadAttention, "pneu", "pneus")}
          period="acompanhar na próxima medição"
          status={k.treadAttention > 0 ? "warning" : undefined}
          icon={<TriangleAlert />}
          nav={toBase("atencao")}
          destination="Abrir a Base geral filtrada por sulco em atenção"
        />
      </div>
    </Section>
  );
}

function PressureKpis({ data, toPending }: { data: TiresAdherence; toPending: (v: PendingFilter) => TiresNavLink }) {
  const k = data.kpis;
  return (
    <Section
      title="Pressão (PSI)"
      testId="tires-calibragem-psi"
      description="PSI lido na última calibragem contra a faixa da regra vigente (tipo × dimensão × posição). Pressão adequada considera só os pneus avaliados: sem parâmetro e sem calibragem ficam fora — e nunca contam como adequados."
    >
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
        <TiresKpi
          kpi="calibragem-pressao-adequada"
          label="Pressão adequada"
          value={k.pressureAdequatePct == null ? "—" : fmt1(k.pressureAdequatePct)}
          unit={k.pressureAdequatePct == null ? undefined : "%"}
          period={k.pressureAdequatePct == null ? "nenhum pneu avaliado" : "dos pneus avaliados (com regra e PSI)"}
          status="primary"
          icon={<Percent />}
        />
        <TiresKpi
          kpi="calibragem-psi-adequada"
          label={PSI_LABEL.adequada}
          value={fmtInt(k.psiAdequate)}
          period="dentro da faixa mín.–máx."
          status={k.psiAdequate > 0 ? "success" : undefined}
          icon={<CircleCheck />}
        />
        <TiresKpi
          kpi="calibragem-psi-baixa"
          label={PSI_LABEL.baixa}
          value={fmtInt(k.psiLow)}
          period="PSI abaixo da faixa"
          status={k.psiLow > 0 ? KPI_STATUS[PSI_TONE.baixa] : undefined}
          icon={<ThermometerSnowflake />}
          nav={toPending("pressao")}
          destination="Ver as pendências de pressão fora da faixa"
        />
        <TiresKpi
          kpi="calibragem-psi-excesso"
          label={PSI_LABEL.excesso}
          value={fmtInt(k.psiHigh)}
          period="PSI acima da faixa"
          status={k.psiHigh > 0 ? KPI_STATUS[PSI_TONE.excesso] : undefined}
          icon={<ThermometerSun />}
          nav={toPending("pressao")}
          destination="Ver as pendências de pressão fora da faixa"
        />
        <TiresKpi
          kpi="calibragem-psi-sem-parametro"
          label={PSI_LABEL.sem_parametro}
          value={fmtInt(k.psiNoRule)}
          period={k.psiNoRule > 0 ? <NoRuleBadge>Não avaliada</NoRuleBadge> : "sem regra de PSI vigente"}
          status={k.psiNoRule > 0 ? "highlight" : undefined}
          icon={<Settings2 />}
          nav={toPending("sem_parametro")}
          destination="Ver os pneus sem parâmetro de PSI"
        />
        <TiresKpi
          kpi="calibragem-psi-sem-calibragem"
          label={PSI_LABEL.sem_calibragem}
          value={fmtInt(k.psiMissing)}
          period="sem PSI registrado"
          icon={<CircleSlash />}
          nav={toPending("sem_registro")}
          destination="Ver as pendências sem calibragem"
        />
      </div>
    </Section>
  );
}

/** "Sem parâmetro" tem destaque próprio: nunca se confunde com adequada nem com sem calibragem. */
function NoRuleBadge({ children }: { children: React.ReactNode }) {
  return (
    <Badge variant="highlight" size="sm" icon={<Settings2 />}>
      {children}
    </Badge>
  );
}

function RuleNote({ kind, data }: { kind: Kind; data: TiresAdherence }) {
  const w = WORDS[kind];
  const p = data.parameters;
  return (
    <InsightCard tone="info" label="Regra vigente" compact data-testid={`tires-${w.slug}-rule`}>
      Até {fmtDays(p.okDays)} desde a última {w.noun} o pneu está <strong>em dia</strong>; até {fmtDays(p.warningDays)}, <strong>próximo do vencimento</strong>;
      acima disso, <strong>vencido</strong>; sem data, <strong>sem registro</strong>. O vencimento é a data da última {w.noun} mais{" "}
      {fmtDays(p.warningDays)}.
      {kind === "calibration"
        ? " A pressão é comparada à faixa da regra de PSI vigente; sem regra, o pneu fica como sem parâmetro e não é avaliado."
        : ""}{" "}
      Os números vêm da fotografia oficial do Rodopar 10; vistorias de campo não alteram a base — só contam depois de lançadas no Rodopar e
      importadas numa nova fotografia.
      {!data.isLatest ? ` Nesta fotografia histórica, os dias são contados até ${formatDate(data.asOf)}.` : ""}
    </InsightCard>
  );
}

// ---------------------------------------------------------------------------
// Quebras por dimensão
// ---------------------------------------------------------------------------
function BreakdownSection({ kind, data, ctx }: { kind: Kind; data: TiresAdherence; ctx: TiresPanelContext }) {
  const w = WORDS[kind];
  const link = useTiresLink(ctx);
  const [grupo, setGrupo] = useViewParam("grupo");
  const dims = DIM_ORDER.filter((d) => (data.breakdowns[d]?.length ?? 0) > 0);
  const dim = grupo && (dims as string[]).includes(grupo) ? (grupo as TireBreakdownDim) : dims[0];
  const items = dim ? data.breakdowns[dim] ?? [] : [];
  const selectId = React.useId();
  const filterKey = dim ? DIM_FILTER[dim] : null;
  const filterParam = filterKey ? TIRES_FILTER_PARAM[filterKey] : null;
  const activeFilter = filterKey ? ctx.filters[filterKey] : undefined;

  return (
    <Section
      title={dim ? `Aderência por ${BREAKDOWN_LABEL[dim].toLowerCase()}` : "Aderência por grupo"}
      testId={`tires-${w.slug}-breakdown`}
      description={`Os pneus em uso de cada grupo pelo prazo de ${w.noun}, com cobertura e aderência calculadas no banco. Clique no nome de um grupo para filtrar a tela por ele.`}
      actions={
        dims.length > 1 ? (
          <div className="flex items-center gap-2">
            <label htmlFor={selectId} className="whitespace-nowrap text-caption text-fg-muted">
              Agrupar por
            </label>
            <NativeSelect
              id={selectId}
              fieldSize="sm"
              value={dim}
              onChange={(e) => setGrupo(e.target.value === dims[0] ? null : e.target.value)}
              className="min-w-[11rem]"
              data-testid={`tires-${w.slug}-breakdown-dim`}
            >
              {dims.map((d) => (
                <option key={d} value={d}>
                  {BREAKDOWN_LABEL[d]}
                </option>
              ))}
            </NativeSelect>
          </div>
        ) : undefined
      }
    >
      {!dim || items.length === 0 ? (
        <PanelEmpty
          icon={<Layers />}
          title="Nenhum grupo no recorte"
          description="Nenhum pneu em uso corresponde aos filtros. Ajuste ou limpe os filtros da tela."
          testId={`tires-${w.slug}-breakdown-empty`}
        />
      ) : (
        <div className="flex flex-col gap-2">
          <ChartLegend
            items={SEGMENTS.map((s) => ({ key: s.key, label: DEADLINE_SHORT[s.key], color: s.color }))}
          />
          <TableContainer stickyHeader maxHeight={480} data-testid={`tires-${w.slug}-breakdown-table`}>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{BREAKDOWN_LABEL[dim]}</TableHead>
                  <TableHead numeric>Pneus</TableHead>
                  <TableHead className="min-w-40">Distribuição do prazo</TableHead>
                  <TableHead numeric>{DEADLINE_SHORT.em_dia}</TableHead>
                  <TableHead numeric>{DEADLINE_SHORT.proximo}</TableHead>
                  <TableHead numeric>{DEADLINE_SHORT.vencido}</TableHead>
                  <TableHead numeric>{DEADLINE_SHORT.sem_registro}</TableHead>
                  <TableHead numeric>Cobertura</TableHead>
                  <TableHead numeric>Aderência</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((item, i) => {
                  const name = item.name ?? DIM_EMPTY[dim];
                  const canFilter = item.id != null && filterParam != null && activeFilter !== item.id;
                  const nav = canFilter ? link({ [filterParam as string]: item.id, pendencia: null }) : null;
                  return (
                    <TableRow key={item.id ?? `none-${i}`} className="h-10" data-testid={`tires-${w.slug}-breakdown-row`}>
                      <TableCell className="max-w-[16rem] py-1.5">
                        {nav ? (
                          <a
                            href={nav.href}
                            onClick={nav.onClick}
                            className="rounded-xs font-medium text-fg underline-offset-2 hover:text-primary hover:underline hfm-focus-ring"
                          >
                            {name}
                            <span className="sr-only"> — filtrar a tela por este grupo</span>
                          </a>
                        ) : (
                          <span className={cn("font-medium", item.name ? "text-fg" : "text-fg-muted")}>{name}</span>
                        )}
                      </TableCell>
                      <TableCell numeric className="py-1.5 font-semibold">{fmtInt(item.total)}</TableCell>
                      <TableCell className="py-1.5">
                        <ShareBar item={item} name={name} />
                      </TableCell>
                      <TableCell numeric className={cn("py-1.5", item.emDia === 0 && "text-fg-muted")}>{fmtInt(item.emDia)}</TableCell>
                      <TableCell numeric className={cn("py-1.5", item.proximo === 0 && "text-fg-muted")}>{fmtInt(item.proximo)}</TableCell>
                      <TableCell numeric className={cn("py-1.5", item.vencido === 0 ? "text-fg-muted" : "font-semibold text-danger-soft-fg")}>
                        {fmtInt(item.vencido)}
                      </TableCell>
                      <TableCell numeric className={cn("py-1.5", item.semRegistro === 0 && "text-fg-muted")}>{fmtInt(item.semRegistro)}</TableCell>
                      <TableCell numeric className="py-1.5">{fmtPct(item.coveragePct)}</TableCell>
                      <TableCell numeric className="py-1.5 font-semibold">{fmtPct(item.adherencePct)}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </TableContainer>
        </div>
      )}
    </Section>
  );
}

/** Barra 100% empilhada (em dia · próximo · vencido · sem registro); os números ficam na própria linha. */
function ShareBar({ item, name }: { item: TireBreakdownItem; name: string }) {
  const parts = SEGMENTS.filter((s) => item[s.field] > 0);
  const label = `${name}: ${SEGMENTS.map((s) => `${fmtInt(item[s.field])} ${DEADLINE_SHORT[s.key].toLowerCase()}`).join(", ")}`;
  return (
    <div role="img" aria-label={label} className="flex h-3 w-full min-w-32 gap-0.5 overflow-hidden rounded-xs bg-surface-sunken">
      {parts.map((s) => (
        <span key={s.key} className={cn("h-full min-w-0.5", s.bar)} style={{ flexGrow: item[s.field], flexBasis: 0 }} />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Ranking de veículos
// ---------------------------------------------------------------------------
function RankingSection({ kind, data }: { kind: Kind; data: TiresAdherence }) {
  const w = WORDS[kind];
  const rows = data.ranking;
  return (
    <Section
      title="Veículos com maior atraso"
      testId={`tires-${w.slug}-ranking`}
      description={`Até 20 veículos com pneu vencido ou sem registro de ${w.noun}, do maior atraso para o menor (sem registro primeiro). A placa abre a Base geral com os pneus do veículo.`}
    >
      {rows.length === 0 ? (
        <PanelEmpty
          icon={<Truck />}
          title="Nenhum veículo com pneu vencido ou sem registro"
          description={`Todos os veículos do recorte têm a ${w.noun} dos pneus em dia ou próxima do vencimento.`}
          testId={`tires-${w.slug}-ranking-empty`}
        />
      ) : (
        <TableContainer data-testid={`tires-${w.slug}-ranking-table`}>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead numeric className="w-10">#</TableHead>
                <TableHead>Veículo</TableHead>
                <TableHead>Operação / local</TableHead>
                <TableHead numeric>Pneus</TableHead>
                <TableHead numeric>Vencidos</TableHead>
                <TableHead numeric>Sem registro</TableHead>
                <TableHead numeric>Maior atraso</TableHead>
                <TableHead numeric>Aderência</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r, i) => (
                <TableRow key={r.vehicleId ?? `${r.fleetNumber ?? "?"}-${i}`} className="h-10" data-testid={`tires-${w.slug}-ranking-row`}>
                  <TableCell numeric className="py-1.5 text-fg-muted">{i + 1}</TableCell>
                  <TableCell className="whitespace-nowrap py-1.5">
                    <PlateLink vehicleId={r.vehicleId} plate={r.licensePlate} fleetCode={r.fleetNumber} testId={`tires-${w.slug}-ranking-plate`} />
                  </TableCell>
                  <TableCell className="py-1.5">
                    <Place operation={r.operationName} city={r.cityName} />
                  </TableCell>
                  <TableCell numeric className="py-1.5">{fmtInt(r.tires)}</TableCell>
                  <TableCell numeric className={cn("py-1.5", r.overdue > 0 ? "font-semibold text-danger-soft-fg" : "text-fg-muted")}>
                    {fmtInt(r.overdue)}
                  </TableCell>
                  <TableCell numeric className={cn("py-1.5", r.missing === 0 && "text-fg-muted")}>{fmtInt(r.missing)}</TableCell>
                  <TableCell numeric className="whitespace-nowrap py-1.5 font-semibold">
                    {r.worstDays == null ? <span className="font-normal text-fg-muted">sem registro</span> : fmtDays(r.worstDays)}
                  </TableCell>
                  <TableCell numeric className="py-1.5">{fmtPct(r.adherencePct)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}
    </Section>
  );
}

function Place({ operation, city, uf }: { operation: string | null; city: string | null; uf?: string | null }) {
  const local = [city, uf].filter(Boolean).join("/");
  return (
    <span className="flex min-w-0 flex-col leading-tight">
      <span className={cn("truncate", operation ? "text-fg-secondary" : "text-fg-muted")}>{operation ?? "Sem operação"}</span>
      {local ? <span className="truncate text-caption text-fg-muted">{local}</span> : null}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Lacunas de regra de PSI (só calibragem)
// ---------------------------------------------------------------------------
function GapsSection({ data, ctx, toPending }: { data: TiresAdherence; ctx: TiresPanelContext; toPending: (v: PendingFilter) => TiresNavLink }) {
  const gaps = data.gaps;
  const pending = toPending("sem_parametro");
  return (
    <Section
      title="Lacunas de regra de PSI"
      testId="tires-calibragem-gaps"
      description="Combinações de tipo de equipamento × dimensão × posição com pneus calibrados e sem regra de pressão vigente. Esses pneus ficam como “Sem parâmetro”: a pressão não é avaliada e nunca conta como adequada."
      actions={
        gaps.length > 0 ? (
          <>
            <Button asChild size="sm" variant="outline">
              <a href={pending.href} onClick={pending.onClick} data-testid="tires-calibragem-gaps-pending">
                Ver os pneus
              </a>
            </Button>
            {ctx.perms.parameters ? (
              <Button asChild size="sm" variant="secondary">
                <Link href={`${ctx.basePath}?aba=parametros&sub=psi`} data-testid="tires-calibragem-gaps-rules">
                  <Settings2 aria-hidden />
                  Cadastrar regras de PSI
                </Link>
              </Button>
            ) : null}
          </>
        ) : undefined
      }
    >
      {gaps.length === 0 ? (
        <InsightCard tone="success" label="Cobertura de regras" compact data-testid="tires-calibragem-gaps-empty">
          Nenhum pneu calibrado do recorte ficou sem regra de PSI vigente.
        </InsightCard>
      ) : (
        <TableContainer stickyHeader maxHeight={360} data-testid="tires-calibragem-gaps-table">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Tipo de equipamento</TableHead>
                <TableHead>Dimensão</TableHead>
                <TableHead>Posição</TableHead>
                <TableHead numeric>Pneus sem parâmetro</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {gaps.map((g, i) => (
                <TableRow
                  key={`${g.vehicleTypeId ?? "-"}|${g.dimensionKey ?? "-"}|${g.positionCode ?? "-"}|${i}`}
                  className="h-10"
                  data-testid="tires-calibragem-gap-row"
                >
                  <TableCell className={cn("py-1.5", g.vehicleTypeName ? "text-fg" : "text-fg-muted")}>{g.vehicleTypeName ?? "Sem tipo"}</TableCell>
                  <TableCell className={cn("whitespace-nowrap py-1.5 tabular-nums", g.dimension || g.dimensionKey ? "text-fg-secondary" : "text-fg-muted")}>
                    {g.dimension ?? g.dimensionKey ?? "Sem dimensão"}
                  </TableCell>
                  <TableCell className={cn("whitespace-nowrap py-1.5", g.positionCode ? "text-fg-secondary" : "text-fg-muted")}>{g.positionCode ?? "Sem posição"}</TableCell>
                  <TableCell numeric className="py-1.5 font-semibold">{fmtInt(g.tires)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}
    </Section>
  );
}

// ---------------------------------------------------------------------------
// Pendências (paginadas no servidor)
// ---------------------------------------------------------------------------
function PendingSection({ kind, data, ctx, id }: { kind: Kind; data: TiresAdherence; ctx: TiresPanelContext; id: string }) {
  const w = WORDS[kind];
  const cal = kind === "calibration";
  const k = data.kpis;
  const options = PENDING_OPTIONS[kind];
  const raw = ctx.params.pendencia as PendingFilter | undefined;
  const value: PendingFilter = raw && options.includes(raw) ? raw : "all";
  const counts: Partial<Record<PendingFilter, number>> = {
    vencido: k.vencido,
    proximo: k.proximo,
    sem_registro: k.semRegistro,
    ...(cal ? { pressao: k.psiLow + k.psiHigh, sem_parametro: k.psiNoRule } : {}),
  };

  return (
    <div id={id} className="scroll-mt-4">
      <Section
        title="Pendências"
        testId={`tires-${w.slug}-pending`}
        description={
          <span>
            {fmtInt(data.pendingTotal)} {plural(data.pendingTotal, "pneu", "pneus")}
            {value === "all"
              ? cal
                ? " fora do prazo de calibragem, com pressão fora da faixa ou sem parâmetro de PSI"
                : " com medição vencida, próxima do vencimento ou sem registro"
              : ` em “${PENDING_LABEL[value]}”`}
            , do maior atraso para o menor. Nº Fogo abre a ficha do pneu; a placa, a Base geral do veículo.
          </span>
        }
        actions={<ExportButton ctx={ctx} kind={w.slug} extra={{ pendencia: value === "all" ? null : value }} />}
      >
        <SegmentedControl<PendingFilter>
          aria-label="Tipo de pendência"
          value={value}
          wrap
          disabled={ctx.pending}
          onValueChange={(v) => ctx.navigate({ pendencia: v === "all" ? null : v, pagina: null })}
          data-testid={`tires-${w.slug}-pending-filter`}
          options={options.map((o) => ({
            value: o,
            "data-testid": `tires-${w.slug}-pending-${o}`,
            label: (
              <>
                {o === "sem_parametro" ? <Settings2 aria-hidden /> : null}
                {PENDING_LABEL[o]}
                {counts[o] != null ? <span className="tabular-nums text-fg-muted">{fmtInt(counts[o])}</span> : null}
              </>
            ),
          }))}
        />

        {data.pending.length === 0 ? (
          <PanelEmpty
            icon={<CalendarCheck />}
            title={value === "all" ? "Nenhuma pendência no recorte" : `Nenhum pneu em “${PENDING_LABEL[value]}”`}
            description={
              value === "all"
                ? cal
                  ? "Todos os pneus em uso estão com a calibragem em dia e a pressão avaliada dentro da faixa."
                  : "Todos os pneus em uso estão com a medição em dia."
                : "Escolha outro tipo de pendência ou ajuste os filtros da tela."
            }
            testId={`tires-${w.slug}-pending-empty`}
          />
        ) : cal ? (
          <CalibrationTable rows={data.pending} />
        ) : (
          <MeasurementTable rows={data.pending} />
        )}

        <TiresPagination
          ctx={ctx}
          total={data.pendingTotal}
          limit={data.limit}
          label={`Paginação das pendências de ${w.noun}`}
          testId={`tires-${w.slug}-pagination`}
        />
      </Section>
    </div>
  );
}

function DeadlineBadge({ status }: { status: DeadlineStatus }) {
  return (
    <StatusBadge status={DEADLINE_TONE[status]} size="sm">
      {DEADLINE_SHORT[status]}
    </StatusBadge>
  );
}

function PsiBadge({ status }: { status: PsiStatus }) {
  if (status === "sem_parametro") return <NoRuleBadge>{PSI_LABEL.sem_parametro}</NoRuleBadge>;
  return (
    <StatusBadge status={PSI_TONE[status]} size="sm">
      {PSI_LABEL[status]}
    </StatusBadge>
  );
}

/** Colunas iniciais das duas listas: pneu, veículo e posição. */
function LeadCells({ row, slug }: { row: TirePendingRow; slug: string }) {
  const position = row.positionLabel ?? row.positionCode;
  return (
    <>
      <TableCell className="whitespace-nowrap py-1.5">
        <FireLink tireId={row.tireId} fireNumber={row.fireNumber} testId={`tires-${slug}-pending-fire`} />
      </TableCell>
      <TableCell className="whitespace-nowrap py-1.5">
        <PlateLink vehicleId={row.vehicleId} plate={row.licensePlate} fleetCode={row.fleetNumber} testId={`tires-${slug}-pending-plate`} />
      </TableCell>
      <TableCell className="py-1.5">
        <span className="flex flex-col leading-tight">
          <span className={cn("whitespace-nowrap", position ? "text-fg-secondary" : "text-fg-muted")}>{position ?? "—"}</span>
          {row.positionLabel && row.positionCode && row.positionLabel !== row.positionCode ? (
            <span className="text-caption text-fg-muted">{row.positionCode}</span>
          ) : null}
        </span>
      </TableCell>
    </>
  );
}

/** Prazo (situação + vencimento) e a última data com os dias desde ela. */
function DeadlineCells({ row }: { row: TirePendingRow }) {
  return (
    <>
      <TableCell className="whitespace-nowrap py-1.5">
        <span className="flex flex-col items-start gap-0.5">
          <DeadlineBadge status={row.status} />
          {row.dueDate ? (
            <span className="text-caption text-fg-muted tabular-nums">
              {row.status === "vencido" ? "venceu" : "vence"} {formatDate(row.dueDate)}
            </span>
          ) : null}
        </span>
      </TableCell>
      <TableCell className="whitespace-nowrap py-1.5">
        {row.lastDate ? (
          <span className="flex flex-col leading-tight">
            <span className="tabular-nums">{formatDate(row.lastDate)}</span>
            <span className={cn("text-caption tabular-nums", row.status === "vencido" ? "font-semibold text-danger-soft-fg" : "text-fg-muted")}>
              {row.days == null ? "" : `há ${fmtDays(row.days)}`}
            </span>
          </span>
        ) : (
          <span className="text-fg-muted">sem registro</span>
        )}
      </TableCell>
    </>
  );
}

function PlaceCell({ row }: { row: TirePendingRow }) {
  return (
    <TableCell className="max-w-[14rem] py-1.5">
      <Place operation={row.operationName} city={row.cityName} uf={row.stateUf} />
    </TableCell>
  );
}

function MeasurementTable({ rows }: { rows: TirePendingRow[] }) {
  return (
    <TableContainer stickyHeader className="max-h-[70vh]" data-testid="tires-medicao-pending-table">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Nº Fogo</TableHead>
            <TableHead>Veículo</TableHead>
            <TableHead>Posição</TableHead>
            <TableHead>Prazo</TableHead>
            <TableHead>Última medição</TableHead>
            <TableHead>Menor sulco</TableHead>
            {[1, 2, 3, 4].map((n) => (
              <TableHead key={n} numeric className="px-2">
                <abbr title={`Sulco ${n} (mm)`} className="no-underline">S{n}</abbr>
              </TableHead>
            ))}
            <TableHead>Operação / local</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow key={r.tireId} className="h-11" data-testid="tires-medicao-pending-row" data-status={r.status}>
              <LeadCells row={r} slug="medicao" />
              <DeadlineCells row={r} />
              <TableCell className="whitespace-nowrap py-1.5">
                <span className="flex flex-col items-start gap-0.5">
                  <span className="font-semibold tabular-nums">{fmtMm(r.treadMin)}</span>
                  <StatusBadge status={TREAD_TONE[r.treadClass]} size="sm">
                    {TREAD_LABEL[r.treadClass]}
                  </StatusBadge>
                </span>
              </TableCell>
              {[r.tread1, r.tread2, r.tread3, r.tread4].map((v, i) => (
                <TableCell key={i} numeric className="px-2 py-1.5 text-fg-secondary">{fmtNum(v)}</TableCell>
              ))}
              <PlaceCell row={r} />
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  );
}

function CalibrationTable({ rows }: { rows: TirePendingRow[] }) {
  return (
    <TableContainer stickyHeader className="max-h-[70vh]" data-testid="tires-calibragem-pending-table">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Nº Fogo</TableHead>
            <TableHead>Veículo</TableHead>
            <TableHead>Posição</TableHead>
            <TableHead>Prazo</TableHead>
            <TableHead>Última calibragem</TableHead>
            <TableHead>Pressão</TableHead>
            <TableHead numeric>PSI lido</TableHead>
            <TableHead numeric>Mín. · ideal · máx.</TableHead>
            <TableHead>Operação / local</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => {
            const hasRule = r.psiMin != null || r.psiIdeal != null || r.psiMax != null;
            const out = r.psiStatus === "baixa" || r.psiStatus === "excesso";
            return (
              <TableRow key={r.tireId} className="h-11" data-testid="tires-calibragem-pending-row" data-status={r.status} data-psi={r.psiStatus}>
                <LeadCells row={r} slug="calibragem" />
                <DeadlineCells row={r} />
                <TableCell className="py-1.5">
                  <PsiBadge status={r.psiStatus} />
                </TableCell>
                <TableCell numeric className={cn("py-1.5 font-semibold", out && "text-danger-soft-fg")}>{fmtNum(r.psi)}</TableCell>
                <TableCell numeric className="whitespace-nowrap py-1.5 text-fg-secondary">
                  {hasRule ? (
                    <>
                      {fmtNum(r.psiMin)} · <span className="font-medium text-fg">{fmtNum(r.psiIdeal)}</span> · {fmtNum(r.psiMax)}
                    </>
                  ) : (
                    <span className="text-fg-muted">sem regra</span>
                  )}
                </TableCell>
                <PlaceCell row={r} />
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </TableContainer>
  );
}
