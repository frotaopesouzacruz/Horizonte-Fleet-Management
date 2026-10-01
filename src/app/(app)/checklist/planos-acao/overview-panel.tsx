"use client";

import * as React from "react";
import { usePathname, useSearchParams } from "next/navigation";
import {
  ArrowDown, Ban, CalendarClock, CircleCheck, CircleSlash, ClipboardList, Flag, Funnel, Gauge, Hourglass, Inbox, Info,
  MapPin, Repeat, ScanSearch, ShieldAlert, Timer, TrendingUp, TriangleAlert, Truck, Unlink, Wrench,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { KpiCard, MetricStrip, type KpiCardProps } from "@/components/ui/kpi-card";
import { SectionHeader } from "@/components/layout/section-header";
import { StatusBadge } from "@/components/ui/status-badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ErrorState } from "@/components/feedback/error-state";
import {
  ChartCard,
  ChartFrame,
  ChartLegend,
  ColumnChart,
  HBarChart,
  SrTable,
  chartFormat,
  columnPath,
  linePath,
  niceScale,
  segmentsOf,
  ticksOf,
  type ChartLegendItem,
  type ChartTooltipContent,
  type ChartTooltipRow,
} from "@/components/charts";
import {
  DEADLINE_TONE,
  FUNNEL_LABEL,
  PLAN_STATUS_LABEL,
  PLAN_STATUS_ORDER,
  PLAN_STATUS_TONE,
  PRIORITY_LABEL,
  PRIORITY_ORDER,
  PRIORITY_TONE,
  formatDate,
  formatDays,
  formatInt,
  formatPct,
  type Tone,
} from "@/lib/action-plans/labels";
import type {
  ActionPlanCatalog,
  ActionPlanDashboard,
  ActionPlanFilters,
  Deadline,
  KeyValue,
  PlanStatus,
  Priority,
} from "@/lib/action-plans/types";
import type { PanelActions } from "./shared";

/**
 * Planos de Ação → Visão geral (§16–§22, §60–§63).
 *
 * Uma narrativa em sete perguntas: o que temos, onde está, qual a prioridade,
 * está sendo tratado, está dentro do prazo, qual a causa e qual o resultado.
 * Todos os números chegam prontos de `action_plan_dashboard`, sobre o mesmo
 * filtro e escopo da lista; a tela só formata e leva cada indicador e cada
 * barra à lista de planos que o explica (§63), com o período da leitura.
 *
 * Cores só por papel semântico (§62): verde = tratado/no prazo, âmbar =
 * atenção, vermelho = vencido/crítico, azul = informacional, ciano =
 * complementar, dourado = meta/destaque. A cor nunca está sozinha: todo
 * gráfico tem rótulo, tooltip e tabela gêmea.
 */

export interface OverviewPanelProps {
  dashboard: ActionPlanDashboard | null;
  filters: ActionPlanFilters;
  catalog: ActionPlanCatalog;
  actions: PanelActions;
}

// ---------------------------------------------------------------------------
// Navegação (drill-down)
// ---------------------------------------------------------------------------

export type Patch = Record<string, string | null>;

/** Ao abrir a lista, ela começa do zero: sem página, ordenação, agrupamento ou seção herdados. */
export const LIST_RESET: Patch = { pagina: null, ordenar: null, dir: null, agrupar: null, secao: null, confianca: null };

export interface DrillLink {
  href: string;
  onClick: (event: React.MouseEvent<HTMLAnchorElement>) => void;
}

/**
 * Link de verdade (abre em nova aba, copia o endereço) que, no clique simples,
 * navega pela transição da tela (`actions.navigate`) — com o `pending` de sempre.
 */
export function useDrillLink(actions: PanelActions) {
  const params = useSearchParams();
  const pathname = usePathname();
  return React.useCallback(
    (patch: Patch): DrillLink => {
      const next = new URLSearchParams(params.toString());
      for (const [key, value] of Object.entries(patch)) {
        if (value === null || value === "") next.delete(key);
        else next.set(key, value);
      }
      next.delete("plano");
      const qs = next.toString();
      return {
        href: qs ? `${pathname}?${qs}` : pathname,
        onClick: (event) => {
          if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
            return;
          }
          event.preventDefault();
          actions.navigate(patch);
        },
      };
    },
    [params, pathname, actions],
  );
}

// ---------------------------------------------------------------------------
// Papéis de cor (§62) — sempre tokens `--chart-*`
// ---------------------------------------------------------------------------

export const TONE_COLOR: Record<Tone, string> = {
  neutral: "var(--chart-neutral)",
  info: "var(--chart-brand-primary)",
  success: "var(--chart-success)",
  warning: "var(--chart-warning)",
  danger: "var(--chart-danger)",
  accent: "var(--chart-brand-secondary)",
};
const C_INFO = TONE_COLOR.info;
const C_SUCCESS = TONE_COLOR.success;
const C_WARNING = TONE_COLOR.warning;
const C_DANGER = TONE_COLOR.danger;
const C_COMPLEMENT = TONE_COLOR.accent;
const C_NEUTRAL = TONE_COLOR.neutral;

// ---------------------------------------------------------------------------
// Formatação (apresentação apenas)
// ---------------------------------------------------------------------------

const nf1 = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const num1 = (v: number | null | undefined) => (v == null ? "—" : nf1.format(v));
const share = (part: number, whole: number) => (whole > 0 ? (part / whole) * 100 : null);
const signedInt = (v: number) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${formatInt(Math.abs(v))}`;
const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

const MONTHS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const MONTHS_FULL = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];
const BUCKET_LABEL: Record<ActionPlanDashboard["period"]["bucket"], string> = {
  day: "por dia",
  week: "por semana",
  month: "por mês",
};

function isoParts(iso: string): [number, number, number] {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return [y || 1970, m || 1, d || 1];
}

/** Soma dias a uma data aaaa-mm-dd, sem fuso. */
function addDays(iso: string, days: number): string {
  const [y, m, d] = isoParts(iso);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

function bucketEnd(start: string, bucket: ActionPlanDashboard["period"]["bucket"]): string {
  if (bucket === "day") return start;
  if (bucket === "week") return addDays(start, 6);
  const [y, m] = isoParts(start);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}

function bucketLabel(start: string, bucket: ActionPlanDashboard["period"]["bucket"]): string {
  const [y, m, d] = isoParts(start);
  if (bucket === "month") return `${MONTHS[m - 1]}/${String(y).slice(2)}`;
  return `${String(d).padStart(2, "0")}/${String(m).padStart(2, "0")}`;
}

function bucketTitle(start: string, end: string, bucket: ActionPlanDashboard["period"]["bucket"]): string {
  const [y, m] = isoParts(start);
  if (bucket === "day") return formatDate(start);
  if (bucket === "month") return `${MONTHS_FULL[m - 1]}/${y}`;
  return `Semana de ${formatDate(start).slice(0, 5)} a ${formatDate(end)}`;
}

const maxIso = (a: string, b: string) => (a > b ? a : b);
const minIso = (a: string, b: string) => (a < b ? a : b);

// ---------------------------------------------------------------------------
// Rótulos locais
// ---------------------------------------------------------------------------

const CLOSED_TREATED = "resolved,resolved_without_maintenance,improper";

/** Rótulo curto no eixo; o título completo vai no tooltip e na tabela gêmea. */
const RESOLUTION_ORIGIN: { key: string; label: string; title: string; color: string; patch: Patch }[] = [
  { key: "maintenance_auto", label: "Baixa automática", title: "Baixa automática pela manutenção", color: C_SUCCESS, patch: { situacao: "resolved" } },
  { key: "maintenance_validated", label: "Validado na manutenção", title: "Resolvido pela manutenção (validado)", color: C_COMPLEMENT, patch: { situacao: "resolved" } },
  { key: "resolved_without_maintenance", label: "Sem manutenção", title: "Resolvido sem manutenção", color: C_INFO, patch: { situacao: "resolved_without_maintenance" } },
  { key: "improper", label: "Improcedente", title: "Improcedente", color: C_NEUTRAL, patch: { situacao: "improper" } },
  { key: "cancelled", label: "Cancelado", title: "Cancelado", color: C_NEUTRAL, patch: { situacao: "cancelled" } },
];

const AGING: { key: string; label: string; title: string; color: string }[] = [
  { key: "0-7", label: "0–7", title: "Até 7 dias", color: C_INFO },
  { key: "8-30", label: "8–30", title: "De 8 a 30 dias", color: C_INFO },
  { key: "31-60", label: "31–60", title: "De 31 a 60 dias", color: C_WARNING },
  { key: "61-90", label: "61–90", title: "De 61 a 90 dias", color: C_WARNING },
  { key: "90+", label: "90+", title: "Mais de 90 dias", color: C_DANGER },
];

/**
 * O que a queda entre duas etapas do funil significa, e a lista que mostra
 * quem ficou parado ali. `bottleneck` marca as quedas que são fila de
 * tratamento (as duas primeiras são triagem: avaria/não elegível e cancelados).
 */
const FUNNEL_STAGE: Record<string, { patch: Patch | null; stuck: string; stuckPatch: Patch | null; bottleneck: boolean }> = {
  received: { patch: null, stuck: "", stuckPatch: null, bottleneck: false },
  classified: { patch: { grupo: null }, stuck: "", stuckPatch: null, bottleneck: false },
  in_plan: { patch: { grupo: null }, stuck: "cancelados ou sem plano", stuckPatch: { situacao: "cancelled" }, bottleneck: false },
  treatment_defined: {
    patch: {
      situacao: "awaiting_maintenance,maintenance_open,maintenance_scheduled,maintenance_in_progress,pending_new_action,resolved,resolved_without_maintenance,improper",
    },
    stuck: "sem tratativa definida",
    stuckPatch: { situacao: "new,in_analysis" },
    bottleneck: true,
  },
  maintenance_or_other: {
    patch: { situacao: "maintenance_open,maintenance_scheduled,maintenance_in_progress,pending_new_action,resolved,resolved_without_maintenance,improper" },
    stuck: "aguardando manutenção",
    stuckPatch: { situacao: "awaiting_maintenance" },
    bottleneck: true,
  },
  resolved: {
    patch: { situacao: CLOSED_TREATED },
    stuck: "em manutenção ou pendentes de nova tratativa",
    stuckPatch: { situacao: "maintenance_open,maintenance_scheduled,maintenance_in_progress,pending_new_action" },
    bottleneck: true,
  },
};

// ---------------------------------------------------------------------------
// Indicador com drill-down
// ---------------------------------------------------------------------------

/** O realce de hover do Card interativo, aplicado ao KpiCard sob o link. */
const INTERACTIVE_KPI = cn(
  "after:pointer-events-none after:absolute after:inset-0 after:rounded-[inherit] after:bg-hover-overlay after:opacity-0",
  "after:transition-opacity after:duration-(--duration-base) group-hover:after:opacity-100",
);

export interface DrillKpiProps extends Omit<KpiCardProps, "size" | "label"> {
  label: string;
  testId: string;
  /** Leva à lista que explica o número. */
  link?: DrillLink;
  /** Para leitor de tela: para onde o link leva. */
  destination?: string;
  /** Definição do indicador, num tooltip ao lado do rótulo. */
  hint?: React.ReactNode;
}

/**
 * Um indicador. O link cobre o cartão inteiro (sem aninhar o botão de ajuda
 * dentro dele); os rótulos reservam duas linhas para que os números da
 * fileira fiquem na mesma linha de base.
 */
export function DrillKpi({ label, testId, link, destination, hint, className, ...card }: DrillKpiProps) {
  return (
    <div className="group relative h-full min-w-0" data-testid={testId}>
      <KpiCard
        size="compact"
        label={
          <span className="flex min-h-9 items-start gap-1 leading-snug">
            <span>{label}</span>
            {hint ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    aria-label={`Sobre: ${label}`}
                    className="relative z-[2] -my-0.5 inline-flex size-5 shrink-0 items-center justify-center rounded-xs text-fg-muted hfm-transition hover:text-fg hfm-focus-ring"
                  >
                    <Info className="size-3.5" aria-hidden />
                  </button>
                </TooltipTrigger>
                <TooltipContent className="max-w-80">{hint}</TooltipContent>
              </Tooltip>
            ) : null}
          </span>
        }
        className={cn("h-full justify-start", link && INTERACTIVE_KPI, className)}
        {...card}
      />
      {link ? (
        <a
          href={link.href}
          onClick={link.onClick}
          aria-label={destination ? `${label}: ${destination}` : label}
          className="absolute inset-0 z-[1] rounded-lg hfm-focus-ring"
        />
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Blocos
// ---------------------------------------------------------------------------

function Section({
  title, description, icon, children, testId,
}: { title: string; description?: React.ReactNode; icon: React.ReactNode; children: React.ReactNode; testId?: string }) {
  return (
    <section aria-label={title} className="flex min-w-0 flex-col gap-3" data-testid={testId}>
      <SectionHeader title={title} description={description} icon={icon} />
      {children}
    </section>
  );
}

interface DrillBar {
  key: string;
  label: string;
  value: number | null;
  color?: string;
  detail?: string;
  /** Título do tooltip e da tabela gêmea, quando o rótulo do eixo é abreviado. */
  title?: string;
  subtitle?: string;
  /** Linhas do tooltip (a primeira é a métrica da barra). */
  rows: ChartTooltipRow[];
  /** Células da tabela gêmea, depois do rótulo. */
  cells: React.ReactNode[];
  /** Filtro da lista de planos; nulo = sem drill-down (ex.: "Sem operação"). */
  patch: Patch | null;
}

interface BarsCardProps {
  title: string;
  description?: React.ReactNode;
  insight?: React.ReactNode;
  legend?: ChartLegendItem[];
  actions?: React.ReactNode;
  bars: DrillBar[];
  ariaLabel: string;
  /** Colunas da tabela gêmea (a primeira é a dimensão). */
  columns: string[];
  format: (value: number) => string;
  emptyMessage: string;
  onDrill: (patch: Patch) => void;
  testId?: string;
  labelWidth?: number;
  className?: string;
  footerHint?: string;
}

/** Ranking/quebra por dimensão: HBarChart + tabela gêmea; Enter/clique abre a lista filtrada. */
function BarsCard({
  title, description, insight, legend, actions, bars, ariaLabel, columns, format, emptyMessage, onDrill, testId,
  labelWidth, className, footerHint = "Clique para ver os planos.",
}: BarsCardProps) {
  return (
    <ChartCard
      title={title}
      description={description}
      insight={insight}
      actions={actions}
      legend={legend ? <ChartLegend items={legend} /> : undefined}
      empty={bars.length === 0 ? emptyMessage : undefined}
      className={className}
      data-testid={testId}
    >
      <HBarChart
        ariaLabel={ariaLabel}
        kind="count"
        format={format}
        labelWidth={labelWidth}
        items={bars.map((b) => ({
          key: b.key,
          label: b.label,
          value: b.value,
          color: b.color ?? C_INFO,
          detail: b.detail,
          tooltip: {
            title: b.title ?? b.label,
            subtitle: b.subtitle,
            rows: b.rows,
            footer: b.patch ? footerHint : undefined,
            announce: `${b.label}: ${b.value == null ? "sem base" : format(b.value)}${b.detail ? ` ${b.detail}` : ""}`,
          },
        }))}
        onSelect={(_, index) => {
          const patch = bars[index]?.patch;
          if (patch) onDrill(patch);
        }}
      />
      <SrTable caption={ariaLabel} columns={columns} rows={bars.map((b) => ({ key: b.key, cells: [b.title ?? b.label, ...b.cells] }))} />
    </ChartCard>
  );
}

function CardLink({ link, children, testId }: { link: DrillLink; children: React.ReactNode; testId?: string }) {
  return (
    <a
      href={link.href}
      onClick={link.onClick}
      data-testid={testId}
      className="rounded-xs text-caption font-medium text-link hfm-transition hover:text-link-hover hover:underline hfm-focus-ring"
    >
      {children}
    </a>
  );
}

// ---------------------------------------------------------------------------
// Funil
// ---------------------------------------------------------------------------

/** Maior queda entre etapas de tratamento (a triagem não conta como gargalo). */
function funnelBottleneck(stages: KeyValue[]): { key: string; drop: number } | null {
  let worst: { key: string; drop: number } | null = null;
  for (let i = 1; i < stages.length; i += 1) {
    const drop = Math.max(0, stages[i - 1].value - stages[i].value);
    if (FUNNEL_STAGE[stages[i].key]?.bottleneck && drop > (worst?.drop ?? 0)) worst = { key: stages[i].key, drop };
  }
  return worst;
}

function TreatmentFunnel({
  stages, damage, notEligible, link,
}: {
  stages: KeyValue[];
  damage: number;
  notEligible: number;
  link: (stageKey: string, patch: Patch | null, history?: boolean) => DrillLink | null;
}) {
  const max = Math.max(1, ...stages.map((s) => s.value));
  const drops = stages.map((s, i) => (i === 0 ? 0 : Math.max(0, stages[i - 1].value - s.value)));
  const bottleneck = funnelBottleneck(stages)?.key ?? null;

  return (
    <ol className="flex flex-col" aria-label="Funil de tratamento, em apontamentos" data-testid="funnel">
      {stages.map((s, i) => {
        const prev = i > 0 ? stages[i - 1] : null;
        const drop = drops[i];
        const meta = FUNNEL_STAGE[s.key];
        const width = s.value > 0 ? Math.max(1.5, (s.value / max) * 100) : 0;
        const stageLink = i === 0 ? link(s.key, null, true) : link(s.key, meta?.patch ?? null);
        const stuckLink = meta?.stuckPatch && drop > 0 ? link(`${s.key}-stuck`, meta.stuckPatch) : null;
        const isBottleneck = bottleneck === s.key;
        const label = FUNNEL_LABEL[s.key] ?? s.key;
        const body = (
          <>
            <span className="flex items-baseline justify-between gap-3">
              <span className="min-w-0 text-body-sm font-medium text-fg">{label}</span>
              <span className="shrink-0 text-body-sm font-semibold tabular-nums text-fg">{formatInt(s.value)}</span>
            </span>
            <span aria-hidden className="block h-2.5 w-full overflow-hidden rounded-full bg-surface-sunken">
              <span
                className={cn("block h-full rounded-full", s.key === "resolved" ? "bg-chart-success" : "bg-chart-brand-primary")}
                style={{ width: `${width}%` }}
              />
            </span>
          </>
        );
        return (
          <li key={s.key} className="flex min-w-0 flex-col" data-stage={s.key}>
            {prev ? (
              <div
                className={cn(
                  "flex flex-wrap items-center gap-x-2 gap-y-1 py-1 pl-3 text-caption",
                  isBottleneck ? "text-warning-soft-fg" : "text-fg-muted",
                )}
              >
                <ArrowDown className="size-3.5 shrink-0" aria-hidden />
                <span className="tabular-nums">
                  {drop > 0 ? `−${formatInt(drop)}` : "sem perda"}
                  {drop > 0 && prev.value > 0 ? ` (${formatPct((drop / prev.value) * 100)} da etapa anterior)` : ""}
                </span>
                {s.key === "classified" ? (
                  <span>
                    · {formatInt(damage)} avaria → fluxo de Avarias · {formatInt(notEligible)} não {plural(notEligible, "elegível", "elegíveis")}
                  </span>
                ) : stuckLink && meta ? (
                  <>
                    <span aria-hidden>·</span>
                    <a
                      href={stuckLink.href}
                      onClick={stuckLink.onClick}
                      className="rounded-xs font-medium text-link hover:text-link-hover hover:underline hfm-focus-ring"
                      data-testid={`funnel-stuck-${s.key}`}
                    >
                      ver {meta.stuck}
                    </a>
                  </>
                ) : null}
                {isBottleneck ? (
                  <StatusBadge status="warning" size="sm" data-testid="funnel-bottleneck">
                    Gargalo
                  </StatusBadge>
                ) : null}
              </div>
            ) : null}
            {stageLink ? (
              <a
                href={stageLink.href}
                onClick={stageLink.onClick}
                className="flex flex-col gap-1.5 rounded-md px-2 py-2 hfm-transition hover:bg-hover-overlay hfm-focus-ring"
                data-testid={`funnel-stage-${s.key}`}
              >
                {body}
              </a>
            ) : (
              <div className="flex flex-col gap-1.5 px-2 py-2">{body}</div>
            )}
          </li>
        );
      })}
    </ol>
  );
}

// ---------------------------------------------------------------------------
// Evolução: colunas pareadas (entrada × saída) e, embaixo, a linha do estoque
// ---------------------------------------------------------------------------

interface FlowPoint {
  key: string;
  label: string;
  title: string;
  a: number;
  b: number;
  line: number | null;
}

interface FlowSeries {
  key: string;
  label: string;
  color: string;
}

interface FlowChartProps {
  points: FlowPoint[];
  a: FlowSeries;
  b: FlowSeries;
  /** Série de estoque num painel próprio abaixo (mesmo eixo X, sem eixo duplo). */
  line?: FlowSeries;
  ariaLabel: string;
  onSelect?: (point: FlowPoint, index: number) => void;
}

/**
 * Entrada × saída por período, em colunas lado a lado, e o estoque (backlog)
 * num painel separado com o mesmo eixo de tempo — fluxo e estoque não dividem
 * escala. Mesma gramática do kit: grade em hairline, canto arredondado, base
 * reta, tooltip e navegação por teclado da `ChartFrame`.
 */
function FlowChart({ points, a, b, line, ariaLabel, onSelect }: FlowChartProps) {
  const [active, setActive] = React.useState<number | null>(null);
  const colMax = points.reduce((acc, p) => Math.max(acc, p.a, p.b), 0);
  const colScale = niceScale(0, Math.max(colMax, 1), 4, true);
  const colTicks = ticksOf(colScale);
  const lineMax = line ? points.reduce((acc, p) => Math.max(acc, p.line ?? 0), 0) : 0;
  const lineScale = niceScale(0, Math.max(lineMax, 1), 2, true);
  const lineTicks = ticksOf(lineScale);
  const lastLine = points.reduce<number>((acc, p, i) => (p.line != null ? i : acc), -1);

  const tooltipOf = (p: FlowPoint): ChartTooltipContent => {
    const balance = p.a - p.b;
    return {
      title: p.title,
      rows: [
        { label: a.label, value: formatInt(p.a), color: a.color, marker: "square" },
        { label: b.label, value: formatInt(p.b), color: b.color, marker: "square" },
        {
          label: "Saldo (entrada − saída)",
          value: signedInt(balance),
          tone: balance > 0 ? "warning" : balance < 0 ? "success" : "muted",
          emphasis: true,
        },
        ...(line ? [{ label: line.label, value: formatInt(p.line), color: line.color, marker: "line" as const }] : []),
      ],
      footer: onSelect ? "Clique para ver os planos do período." : undefined,
      announce: `${p.title}: ${a.label} ${formatInt(p.a)}, ${b.label} ${formatInt(p.b)}${line ? `, ${line.label} ${formatInt(p.line)}` : ""}`,
    };
  };

  return (
    <ChartFrame
      ariaLabel={ariaLabel}
      count={points.length}
      active={active}
      onActiveChange={setActive}
      onActivate={onSelect ? (i) => onSelect(points[i], i) : undefined}
      render={(width) => {
        const left = 44;
        const right = 14;
        const top = 18;
        const colH = 150;
        const gap = line ? 38 : 0;
        const lineH = line ? 60 : 0;
        const bottom = 28;
        const svgW = Math.max(width, left + right + points.length * 12);
        const plotW = svgW - left - right;
        const slot = plotW / Math.max(points.length, 1);
        const groupW = Math.max(3, Math.min(44, slot * 0.72));
        const barW = Math.max(1, (groupW - 2) / 2);
        const colBase = top + colH;
        const yc = (v: number) => colBase - ((v - colScale.min) / (colScale.max - colScale.min)) * colH;
        const lineTop = colBase + gap;
        const lineBase = lineTop + lineH;
        const yl = (v: number) => lineBase - ((v - lineScale.min) / (lineScale.max - lineScale.min)) * lineH;
        const axisY = line ? lineBase : colBase;
        const totalH = axisY + bottom;
        const labelEvery = slot >= 34 ? 1 : slot >= 18 ? 2 : slot >= 10 ? 4 : 7;
        const cx = (i: number) => left + slot * i + slot / 2;
        const coords = points.map((p, i) => (line && p.line != null ? { x: cx(i), y: yl(p.line) } : null));
        const segments = segmentsOf(coords);
        const activePoint = active != null ? points[active] : null;
        const tip = activePoint
          ? { content: tooltipOf(activePoint), x: Math.min(cx(active as number), width - 8), y: yc(Math.max(activePoint.a, activePoint.b)) }
          : null;

        const chart = (
          <svg
            width={svgW}
            height={totalH}
            viewBox={`0 0 ${svgW} ${totalH}`}
            role="img"
            aria-label={ariaLabel}
            className="block text-fg"
            style={{ fontFamily: "inherit" }}
            onPointerMove={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              const i = Math.floor((e.clientX - rect.left - left) / slot);
              setActive(i >= 0 && i < points.length ? i : null);
            }}
            onClick={() => {
              if (active != null && onSelect) onSelect(points[active], active);
            }}
          >
            {colTicks.map((t) => (
              <g key={`c${t}`}>
                <line x1={left} x2={left + plotW} y1={yc(t)} y2={yc(t)} stroke="var(--chart-grid)" strokeWidth="1" />
                <text x={left - 8} y={yc(t) + 4} textAnchor="end" fontSize="11" fill="var(--chart-label)" className="tabular-nums">
                  {chartFormat.compact(t)}
                </text>
              </g>
            ))}

            {line ? (
              <g>
                <text x={left} y={lineTop - 12} fontSize="11" fontWeight={600} fill="var(--chart-label)">
                  {line.label}
                </text>
                {lineTicks.map((t) => (
                  <g key={`l${t}`}>
                    <line x1={left} x2={left + plotW} y1={yl(t)} y2={yl(t)} stroke="var(--chart-grid)" strokeWidth="1" />
                    <text x={left - 8} y={yl(t) + 4} textAnchor="end" fontSize="11" fill="var(--chart-label)" className="tabular-nums">
                      {chartFormat.compact(t)}
                    </text>
                  </g>
                ))}
              </g>
            ) : null}

            {active != null ? (
              <rect x={left + slot * active} y={top} width={slot} height={axisY - top} fill="var(--chart-hover-band)" rx="4" />
            ) : null}

            {points.map((p, i) => {
              const x0 = cx(i) - groupW / 2;
              const xb = x0 + barW + 2;
              return (
                <g key={p.key}>
                  {colBase - yc(p.a) > 0.75 ? <path d={columnPath(x0, yc(p.a), colBase, barW)} fill={a.color} /> : null}
                  {colBase - yc(p.b) > 0.75 ? <path d={columnPath(xb, yc(p.b), colBase, barW)} fill={b.color} /> : null}
                  {active === i ? (
                    <>
                      <text x={x0 + barW / 2} y={yc(p.a) - 6} textAnchor="middle" fontSize="11" fontWeight={600} fill="currentColor"
                        stroke="var(--surface-raised)" strokeWidth="3" paintOrder="stroke" className="tabular-nums">
                        {formatInt(p.a)}
                      </text>
                      <text x={xb + barW / 2} y={yc(p.b) - 6} textAnchor="middle" fontSize="11" fontWeight={600} fill="currentColor"
                        stroke="var(--surface-raised)" strokeWidth="3" paintOrder="stroke" className="tabular-nums">
                        {formatInt(p.b)}
                      </text>
                    </>
                  ) : null}
                  {i % labelEvery === 0 || active === i ? (
                    <text x={cx(i)} y={axisY + 18} textAnchor="middle" fontSize="11" fontWeight={active === i ? 700 : 500}
                      fill={active === i ? "currentColor" : "var(--chart-label)"}>
                      {p.label}
                    </text>
                  ) : null}
                </g>
              );
            })}

            <line x1={left} x2={left + plotW} y1={colBase} y2={colBase} stroke="var(--chart-axis-line)" strokeWidth="1" />

            {line ? (
              <g>
                {segments.map((seg, i) => (
                  <path key={i} d={linePath(seg)} fill="none" stroke={line.color} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
                ))}
                {coords.map((c, i) =>
                  c && (active === i || i === lastLine || slot >= 18) ? (
                    <circle
                      key={i}
                      cx={c.x}
                      cy={c.y}
                      r={active === i || i === lastLine ? 4.5 : 3}
                      fill={active === i || i === lastLine ? line.color : "var(--surface-raised)"}
                      stroke={line.color}
                      strokeWidth="2"
                    />
                  ) : null,
                )}
                {lastLine >= 0 && coords[lastLine] ? (
                  <text
                    x={coords[lastLine]!.x}
                    y={coords[lastLine]!.y - 9}
                    textAnchor={coords[lastLine]!.x > left + plotW - 24 ? "end" : "middle"}
                    fontSize="11"
                    fontWeight={600}
                    fill="currentColor"
                    stroke="var(--surface-raised)"
                    strokeWidth="3"
                    paintOrder="stroke"
                    className="tabular-nums"
                  >
                    {formatInt(points[lastLine].line)}
                  </text>
                ) : null}
                <line x1={left} x2={left + plotW} y1={lineBase} y2={lineBase} stroke="var(--chart-axis-line)" strokeWidth="1" />
              </g>
            ) : null}
          </svg>
        );
        return { chart, tooltip: tip };
      }}
    />
  );
}

// ---------------------------------------------------------------------------
// Painel
// ---------------------------------------------------------------------------

export function OverviewPanel({ dashboard, filters, catalog, actions }: OverviewPanelProps) {
  const link = useDrillLink(actions);

  if (!dashboard) {
    return (
      <div data-testid="action-plans-overview">
        <ErrorState
          variant="panel"
          title="Não foi possível carregar a visão geral"
          description="A leitura dos indicadores falhou. Os filtros continuam valendo; tente de novo em instantes."
          onRetry={actions.refresh}
          retryLabel="Tentar de novo"
          retrying={actions.pending}
          data-testid="action-plans-overview-error"
        />
      </div>
    );
  }

  const { period } = dashboard;
  const k = dashboard.kpis;
  const deadline = dashboard.deadline ?? {};
  const funnel = dashboard.funnel ?? [];
  const funnelWorst = funnelBottleneck(funnel);
  const aging = dashboard.aging ?? [];
  const trend = dashboard.trend ?? [];
  const coverage = dashboard.coverage;
  const soonDays = catalog.settings.dueSoonDays;
  const periodText = `${formatDate(period.from)} a ${formatDate(period.to)}`;

  /** Lista de planos com o período desta leitura e o filtro do indicador. */
  // Sem situação, prazo nem grupo escolhidos, o portal abriria só nos abertos:
  // os totais do painel valem para todas as situações ("grupo=all").
  const plansPatch = (patch: Patch): Patch => {
    const p: Patch = { ...LIST_RESET, aba: "planos", de: period.from, ate: period.to, ...patch };
    if (p.grupo === null && !p.situacao && !p.prazo) p.grupo = "all";
    return p;
  };
  const plansLink = (patch: Patch) => link(plansPatch(patch));
  const drill = (patch: Patch) => actions.navigate(plansPatch(patch));
  const historyLink = link({ ...LIST_RESET, aba: "historico", de: period.from, ate: period.to });
  const mappingLink = link({ ...LIST_RESET, aba: "parametros" });

  // -------------------------------------------------------- O que temos?
  const itemsBase = k.items - k.itemsCancelled;
  const treatedOnTime = deadline.treated_on_time ?? 0;
  const treatedLate = deadline.treated_late ?? 0;
  const closedWithDue = treatedOnTime + treatedLate;
  const sparkTreated = trend.length > 1 ? trend.map((t) => t.treatedItems) : undefined;
  const sparkBacklog = trend.length > 1 ? trend.map((t) => t.backlog) : undefined;
  const nothing = k.findingsReceived === 0 && k.items === 0 && k.plansTotal === 0;

  // -------------------------------------------------------- Onde está?
  const operations = dashboard.byOperation ?? [];
  const opsOpen = operations.reduce((acc, o) => acc + o.open, 0);
  const topOp = operations[0];
  const opBars: DrillBar[] = operations.slice(0, 12).map((o) => ({
    key: o.key ?? `none-${o.label}`,
    label: o.label,
    value: o.open,
    color: C_INFO,
    detail: o.overdue > 0 ? `· ${formatInt(o.overdue)} venc.` : `de ${formatInt(o.total)}`,
    subtitle: "Operação",
    rows: [
      { label: "Em aberto", value: formatInt(o.open), color: C_INFO, marker: "square", emphasis: true },
      { label: "Vencidos", value: formatInt(o.overdue), tone: o.overdue > 0 ? "danger" : "muted" },
      { label: "Planos no período", value: formatInt(o.total) },
    ],
    cells: [formatInt(o.open), formatInt(o.overdue), formatInt(o.total)],
    patch: o.key ? { operacao: o.key, grupo: "open" } : null,
  }));
  const cityBars: DrillBar[] = (dashboard.byCity ?? []).map((c) => ({
    key: c.key == null ? `none-${c.label}` : String(c.key),
    label: c.label,
    value: c.open,
    color: C_INFO,
    detail: `de ${formatInt(c.total)}`,
    subtitle: "Cidade",
    rows: [
      { label: "Em aberto", value: formatInt(c.open), color: C_INFO, marker: "square", emphasis: true },
      { label: "Planos no período", value: formatInt(c.total) },
    ],
    cells: [formatInt(c.open), formatInt(c.total)],
    patch: c.key == null ? null : { cidade: String(c.key), grupo: "open" },
  }));
  const leaderBars: DrillBar[] = (dashboard.byLeader ?? []).map((l) => ({
    key: l.key ?? `none-${l.label}`,
    label: l.label,
    value: l.open,
    color: C_INFO,
    detail: `de ${formatInt(l.total)}`,
    subtitle: "Liderança do checklist",
    rows: [
      { label: "Em aberto", value: formatInt(l.open), color: C_INFO, marker: "square", emphasis: true },
      { label: "Planos no período", value: formatInt(l.total) },
    ],
    cells: [formatInt(l.open), formatInt(l.total)],
    patch: l.key ? { lideranca: l.key, grupo: "open" } : null,
  }));
  const clusterBars: DrillBar[] = (dashboard.byCluster ?? []).slice(0, 12).map((c) => ({
    key: c.key ?? `none-${c.label}`,
    label: c.label,
    value: c.open,
    color: C_INFO,
    detail: `de ${formatInt(c.total)}`,
    subtitle: "Cluster técnico",
    rows: [
      { label: "Em aberto", value: formatInt(c.open), color: C_INFO, marker: "square", emphasis: true },
      { label: "Planos no período", value: formatInt(c.total) },
      { label: "Ocorrências", value: formatInt(c.items) },
    ],
    cells: [formatInt(c.open), formatInt(c.total), formatInt(c.items)],
    patch: c.key ? { cluster: c.key, grupo: "open" } : null,
  }));

  // -------------------------------------------------------- Prioridade e situação
  const byPriority = new Map((dashboard.byPriority ?? []).map((p) => [p.key, p]));
  const priorityBars: DrillBar[] = PRIORITY_ORDER.map((key: Priority) => {
    const p = byPriority.get(key) ?? { key, open: 0, total: 0 };
    const color = TONE_COLOR[PRIORITY_TONE[key]];
    return {
      key,
      label: PRIORITY_LABEL[key],
      value: p.open,
      color,
      detail: `de ${formatInt(p.total)}`,
      subtitle: "Prioridade",
      rows: [
        { label: "Em aberto", value: formatInt(p.open), color, marker: "square", emphasis: true },
        { label: "Planos no período", value: formatInt(p.total) },
      ],
      cells: [formatInt(p.open), formatInt(p.total)],
      patch: { prioridade: key, grupo: "open" },
    };
  });
  const byStatus = new Map((dashboard.byStatus ?? []).map((s) => [s.key, s.value]));
  const statusBars: DrillBar[] = PLAN_STATUS_ORDER.filter((s) => (byStatus.get(s) ?? 0) > 0).map((key: PlanStatus) => {
    const value = byStatus.get(key) ?? 0;
    const color = TONE_COLOR[PLAN_STATUS_TONE[key]];
    return {
      key,
      label: PLAN_STATUS_LABEL[key],
      value,
      color,
      detail: `· ${formatPct(share(value, k.plansTotal))}`,
      subtitle: "Situação do plano",
      rows: [
        { label: "Planos", value: formatInt(value), color, marker: "square", emphasis: true },
        { label: "Participação", value: formatPct(share(value, k.plansTotal)) },
      ],
      cells: [formatInt(value), formatPct(share(value, k.plansTotal))],
      patch: { situacao: key, grupo: null },
    };
  });
  const criticalOpen = byPriority.get("critical")?.open ?? 0;

  // -------------------------------------------------------- Resolução
  const originMap = new Map((dashboard.resolutionOrigin ?? []).map((o) => [o.key, o.value]));
  const originTotal = (dashboard.resolutionOrigin ?? []).reduce((acc, o) => acc + o.value, 0);
  const originBars: DrillBar[] = RESOLUTION_ORIGIN.filter((o) => (originMap.get(o.key) ?? 0) > 0).map((o) => {
    const value = originMap.get(o.key) ?? 0;
    return {
      key: o.key,
      label: o.label,
      title: o.title,
      value,
      color: o.color,
      detail: `· ${formatPct(share(value, originTotal))}`,
      subtitle: "Origem da resolução",
      rows: [
        { label: "Apontamentos", value: formatInt(value), color: o.color, marker: "square", emphasis: true },
        { label: "Participação", value: formatPct(share(value, originTotal)) },
      ],
      cells: [formatInt(value), formatPct(share(value, originTotal))],
      patch: { ...o.patch, grupo: null },
    };
  });
  const autoShare = share((originMap.get("maintenance_auto") ?? 0) + (originMap.get("maintenance_validated") ?? 0), originTotal);

  // -------------------------------------------------------- Prazo e aging
  const soonLabel = soonDays === 1 ? "Próximo 1 dia" : `Próximos ${formatInt(soonDays)} dias`;
  const DEADLINE_BUCKETS: { key: Deadline; label: string }[] = [
    { key: "on_time", label: "No prazo" },
    { key: "overdue", label: "Vencidos" },
    { key: "today", label: "Vencem hoje" },
    { key: "soon", label: soonLabel },
    { key: "no_due", label: "Sem prazo" },
    { key: "treated_on_time", label: "Tratados no prazo" },
    { key: "treated_late", label: "Tratados fora do prazo" },
  ];
  const deadlineTotal = DEADLINE_BUCKETS.reduce((acc, d) => acc + (deadline[d.key] ?? 0), 0);
  const deadlineBars: DrillBar[] = deadlineTotal === 0 ? [] : DEADLINE_BUCKETS.map((d) => {
    const value = deadline[d.key] ?? 0;
    const color = TONE_COLOR[DEADLINE_TONE[d.key]];
    return {
      key: d.key,
      label: d.label,
      value,
      color,
      detail: `· ${formatPct(share(value, deadlineTotal))}`,
      subtitle: d.key.startsWith("treated_") ? "Planos encerrados" : "Planos em aberto",
      rows: [
        { label: "Planos", value: formatInt(value), color, marker: "square", emphasis: true },
        { label: "Participação", value: formatPct(share(value, deadlineTotal)) },
      ],
      cells: [formatInt(value), formatPct(share(value, deadlineTotal))],
      patch: { prazo: d.key, grupo: null },
    };
  });
  const agingMap = new Map(aging.map((a) => [a.key, a.value]));
  const agingTotal = aging.reduce((acc, a) => acc + a.value, 0);
  const agingOld = (agingMap.get("61-90") ?? 0) + (agingMap.get("90+") ?? 0);

  // -------------------------------------------------------- Causa
  const topItemBars: DrillBar[] = (dashboard.topItems ?? []).map((t) => ({
    key: t.key,
    label: t.label,
    value: t.items,
    color: C_INFO,
    detail: `· ${formatInt(t.plans)} ${plural(t.plans, "plano", "planos")}`,
    subtitle: "Item com falha",
    rows: [
      { label: "Apontamentos", value: formatInt(t.items), color: C_INFO, marker: "square", emphasis: true },
      { label: "Planos", value: formatInt(t.plans) },
      { label: "Planos em aberto", value: formatInt(t.open), tone: t.open > 0 ? "warning" : "muted" },
    ],
    cells: [formatInt(t.items), formatInt(t.plans), formatInt(t.open)],
    patch: { item: t.key, grupo: null },
  }));
  const vehicleBars: DrillBar[] = (dashboard.topRecurrentVehicles ?? []).map((v) => {
    const color = v.recurrences > 0 ? C_WARNING : C_INFO;
    const label = `${v.label || "Sem placa"}${v.sub ? ` · ${v.sub}` : ""}`;
    return {
      key: v.key,
      label,
      value: v.occurrences,
      color,
      detail: `· ${formatInt(v.recurrences)} reinc.`,
      subtitle: "Veículo",
      rows: [
        { label: "Ocorrências", value: formatInt(v.occurrences), color, marker: "square", emphasis: true },
        { label: "Possíveis reincidências", value: formatInt(v.recurrences), tone: v.recurrences > 0 ? "warning" : "muted" },
        { label: "Planos em aberto", value: formatInt(v.open) },
      ],
      cells: [formatInt(v.occurrences), formatInt(v.recurrences), formatInt(v.open)],
      patch: { veiculo: v.key, grupo: null },
    };
  });
  const tmrPriority = new Map((dashboard.tmrByPriority ?? []).map((t) => [t.key, t]));
  const tmrPriorityBars: DrillBar[] = PRIORITY_ORDER.filter((p) => (tmrPriority.get(p)?.n ?? 0) > 0).map((key) => {
    const t = tmrPriority.get(key)!;
    const color = TONE_COLOR[PRIORITY_TONE[key]];
    return {
      key,
      label: PRIORITY_LABEL[key],
      value: t.avg,
      color,
      detail: `· mediana ${formatDays(t.median)}`,
      subtitle: "TMR por prioridade",
      rows: [
        { label: "TMR médio", value: formatDays(t.avg), color, marker: "square", emphasis: true },
        { label: "TMR mediano", value: formatDays(t.median) },
        { label: "Planos encerrados", value: formatInt(t.n) },
      ],
      cells: [formatDays(t.avg), formatDays(t.median), formatInt(t.n)],
      patch: { prioridade: key, situacao: CLOSED_TREATED, grupo: null },
    };
  });
  const tmrClusterBars: DrillBar[] = (dashboard.tmrByCluster ?? []).slice(0, 12).map((t) => {
    const key = t.key;
    return {
      key: t.key ?? "sem-cluster",
      label: t.label,
      value: t.avg,
      color: C_COMPLEMENT,
      detail: `· ${formatInt(t.n)} ${plural(t.n, "plano", "planos")}`,
      subtitle: "TMR por cluster",
      rows: [
        { label: "TMR médio", value: formatDays(t.avg), color: C_COMPLEMENT, marker: "square", emphasis: true },
        { label: "Planos encerrados", value: formatInt(t.n) },
      ],
      cells: [formatDays(t.avg), formatInt(t.n)],
      patch: key ? { cluster: key, situacao: CLOSED_TREATED, grupo: null } : null,
    };
  });

  // -------------------------------------------------------- Resultado
  const flowRows = trend.map((t) => {
    const start = t.bucket.slice(0, 10);
    const end = bucketEnd(start, period.bucket);
    return { ...t, start, end, label: bucketLabel(start, period.bucket), title: bucketTitle(start, end, period.bucket) };
  });
  const flowDrill = (index: number) => {
    const r = flowRows[index];
    if (!r) return;
    actions.navigate({
      ...LIST_RESET,
      aba: "planos",
      de: maxIso(r.start, period.from),
      ate: minIso(r.end, period.to),
      grupo: null,
    });
  };
  const newItemsTotal = trend.reduce((acc, t) => acc + t.newItems, 0);
  const treatedItemsTotal = trend.reduce((acc, t) => acc + t.treatedItems, 0);
  const newPlansTotal = trend.reduce((acc, t) => acc + t.newPlans, 0);
  const closedPlansTotal = trend.reduce((acc, t) => acc + t.closedPlans, 0);
  const backlogFirst = trend[0]?.backlog ?? null;
  const backlogLast = trend.length ? trend[trend.length - 1].backlog : null;
  const hasFlow = trend.some((t) => t.newItems + t.treatedItems + t.newPlans + t.closedPlans + t.backlog > 0);

  const SERIES_NEW_ITEMS: FlowSeries = { key: "new", label: "Novos apontamentos", color: C_INFO };
  const SERIES_TREATED: FlowSeries = { key: "treated", label: "Apontamentos tratados", color: C_SUCCESS };
  const SERIES_BACKLOG: FlowSeries = { key: "backlog", label: "Backlog · planos em aberto", color: C_WARNING };
  const SERIES_NEW_PLANS: FlowSeries = { key: "newPlans", label: "Planos novos", color: C_INFO };
  const SERIES_CLOSED_PLANS: FlowSeries = { key: "closedPlans", label: "Planos encerrados", color: C_SUCCESS };

  const coveragePctMapped = share(coverage.mapped, coverage.actionKeys) ?? 0;
  const coveragePctUnmapped = share(coverage.unmapped, coverage.actionKeys) ?? 0;

  return (
    <div className="flex min-w-0 flex-col gap-8" data-testid="action-plans-overview">
      <div className="flex flex-col gap-1">
        <p className="text-body-sm text-fg-muted" data-testid="action-plans-overview-period">
          Período <span className="font-medium text-fg-secondary tabular-nums">{periodText}</span>
          {!filters.from && !filters.to ? " (padrão: últimos 90 dias)" : ""} · evolução {BUCKET_LABEL[period.bucket]} · hoje{" "}
          <span className="tabular-nums">{formatDate(period.today)}</span>
        </p>
        <p className="max-w-[90ch] text-caption text-fg-muted">
          Planos com ocorrência no período, na situação de hoje. Avarias não entram: seguem o fluxo próprio de Sinistros/Avarias.
          Os indicadores e as barras abrem a lista de planos com o filtro correspondente.
        </p>
      </div>

      {nothing ? (
        <p
          className="rounded-lg border border-dashed border-border bg-surface-raised px-4 py-3 text-body-sm text-fg-secondary"
          data-testid="action-plans-overview-empty"
        >
          Nenhuma inconformidade recebida no período e nos filtros atuais. Amplie o período ou limpe os filtros.
        </p>
      ) : null}

      {/* ------------------------------------------------------- O que temos? */}
      <Section
        title="O que temos?"
        icon={<Inbox />}
        testId="overview-section-what"
        description="Volume recebido no período e a situação atual dos apontamentos e planos de manutenção."
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <DrillKpi
            testId="kpi-findings-received"
            label="Inconformidades recebidas"
            value={formatInt(k.findingsReceived)}
            status="info"
            icon={<ClipboardList />}
            period={`${formatInt(k.findingsDamage)} avaria → fluxo de Avarias, ${formatInt(k.findingsNotEligible)} não ${plural(k.findingsNotEligible, "elegível", "elegíveis")}`}
            hint="Todas as respostas inconformes dos checklists do período: manutenção, avaria e não elegíveis. Só as de manutenção viram apontamento."
            link={historyLink}
            destination="abrir o histórico de checklists do período"
          />
          <DrillKpi
            testId="kpi-items-open"
            label="Apontamentos pendentes"
            value={formatInt(k.itemsOpen)}
            status={k.itemsOpen > 0 ? "warning" : "neutral"}
            icon={<Hourglass />}
            period={`${formatInt(k.itemsInMaintenance)} em manutenção · de ${formatInt(k.items)} apontamentos`}
            link={plansLink({ grupo: "open" })}
            destination="ver os planos em aberto"
          />
          <DrillKpi
            testId="kpi-items-treated"
            label="Apontamentos tratados"
            value={formatInt(k.itemsTreated)}
            status="success"
            icon={<CircleCheck />}
            period={`${formatInt(k.itemsRwm)} sem manutenção · ${formatInt(k.itemsImproper)} improcedentes`}
            sparkline={sparkTreated}
            link={plansLink({ situacao: CLOSED_TREATED, grupo: null })}
            destination="ver os planos encerrados com tratativa"
          />
          <DrillKpi
            testId="kpi-vehicles-pending"
            label="Veículos com pendência"
            value={formatInt(k.vehiclesPending)}
            status={k.vehiclesPending > 0 ? "warning" : "neutral"}
            icon={<Truck />}
            period="com ao menos um plano em aberto"
            link={plansLink({ grupo: "open", agrupar: "vehicle" })}
            destination="ver os planos em aberto agrupados por veículo"
          />
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          <DrillKpi
            testId="kpi-treatment-adherence"
            label="Aderência de Tratativa"
            value={k.treatmentAdherence == null ? "—" : nf1.format(k.treatmentAdherence)}
            unit={
              k.treatmentAdherence == null ? undefined : `% · ${formatInt(k.itemsTreated)} ÷ ${formatInt(itemsBase)}`
            }
            status="highlight"
            icon={<Gauge />}
            period={
              itemsBase > 0
                ? "tratados ÷ (apontamentos − cancelados)"
                : "sem apontamentos elegíveis no período"
            }
            hint={
              <>
                A inconformidade recebeu a tratativa? Diferente da Aderência de Checklist (o checklist foi feito?).
                <br />
                Fórmula: tratados ÷ (apontamentos − cancelados).
              </>
            }
            link={plansLink({ grupo: "open" })}
            destination="ver os planos ainda sem tratativa concluída"
          />
          <DrillKpi
            testId="kpi-tmr"
            label="TMR (tempo médio de resolução)"
            value={num1(k.tmrAvgDays)}
            unit={k.tmrAvgDays == null ? undefined : "dias"}
            status="info"
            icon={<Timer />}
            period={k.tmrAvgDays == null ? "sem planos encerrados no período" : `mediana ${formatDays(k.tmrMedianDays)} · P90 ${formatDays(k.tmrP90Days)}`}
            hint="Do 1º apontamento ao encerramento dos planos resolvidos (com manutenção, sem manutenção e improcedentes). P90: 90% foram resolvidos em até esse prazo."
            link={plansLink({ situacao: CLOSED_TREATED, grupo: null })}
            destination="ver os planos encerrados"
          />
          <DrillKpi
            testId="kpi-on-time"
            label="% tratado no prazo"
            value={k.onTimePct == null ? "—" : nf1.format(k.onTimePct)}
            unit={k.onTimePct == null ? undefined : "%"}
            status="success"
            icon={<CalendarClock />}
            period={
              closedWithDue > 0
                ? `${formatInt(treatedOnTime)} de ${formatInt(closedWithDue)} encerrados com prazo`
                : "sem planos encerrados com prazo"
            }
            hint="Planos encerrados até o prazo ÷ planos encerrados que tinham prazo."
            link={plansLink({ prazo: "treated_on_time", grupo: null })}
            destination="ver os planos tratados no prazo"
          />
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <DrillKpi
            testId="kpi-plans-active"
            label="Planos ativos"
            value={formatInt(k.plansActive)}
            status="info"
            icon={<Inbox />}
            period={`de ${formatInt(k.plansTotal)} planos no período`}
            sparkline={sparkBacklog}
            link={plansLink({ grupo: "open" })}
            destination="ver os planos em aberto"
          />
          <DrillKpi
            testId="kpi-plans-overdue"
            label="Planos vencidos"
            value={formatInt(k.plansOverdue)}
            status={k.plansOverdue > 0 ? "danger" : "neutral"}
            icon={<TriangleAlert />}
            period={k.plansActive > 0 ? `${formatPct(share(k.plansOverdue, k.plansActive))} dos ativos` : "nenhum plano ativo"}
            link={plansLink({ prazo: "overdue", grupo: null })}
            destination="ver os planos vencidos"
          />
          <DrillKpi
            testId="kpi-plans-critical"
            label="Planos críticos"
            value={formatInt(k.plansCritical)}
            status={k.plansCritical > 0 ? "danger" : "neutral"}
            icon={<ShieldAlert />}
            period="prioridade crítica, em aberto"
            link={plansLink({ prioridade: "critical", grupo: "open" })}
            destination="ver os planos críticos em aberto"
          />
          <DrillKpi
            testId="kpi-recurrences"
            label="Possível reincidência"
            value={formatInt(k.recurrences)}
            status={k.recurrences > 0 ? "warning" : "neutral"}
            icon={<Repeat />}
            period={`janela de ${formatInt(catalog.settings.recurrenceWindowDays)} dias · sinal para análise`}
            link={plansLink({ reincidente: "1", grupo: null })}
            destination="ver os planos com possível reincidência"
          />
          <DrillKpi
            testId="kpi-plans-with-maintenance"
            label="Planos com manutenção"
            value={formatInt(k.plansWithMaintenance)}
            status="accent"
            icon={<Wrench />}
            period="ativos, com manutenção vinculada"
            link={plansLink({ manutencao: "yes", grupo: "open" })}
            destination="ver os planos ativos com manutenção"
          />
          <DrillKpi
            testId="kpi-plans-without-maintenance"
            label="Planos sem manutenção"
            value={formatInt(k.plansWithoutMaintenance)}
            status={k.plansWithoutMaintenance > 0 ? "warning" : "neutral"}
            icon={<Unlink />}
            period="ativos, sem manutenção vinculada"
            link={plansLink({ manutencao: "no", grupo: "open" })}
            destination="ver os planos ativos sem manutenção"
          />
          <DrillKpi
            testId="kpi-plans-rwm"
            label="Resolvidos sem manutenção"
            value={formatInt(k.plansRwm)}
            status="success"
            icon={<CircleSlash />}
            period="sem intervenção técnica"
            link={plansLink({ situacao: "resolved_without_maintenance", grupo: null })}
            destination="ver os planos resolvidos sem manutenção"
          />
          <DrillKpi
            testId="kpi-plans-improper"
            label="Improcedentes"
            value={formatInt(k.plansImproper)}
            status="neutral"
            icon={<Ban />}
            period={`${formatInt(k.plansResolved)} resolvidos pela manutenção`}
            link={plansLink({ situacao: "improper", grupo: null })}
            destination="ver os planos improcedentes"
          />
        </div>

        <MetricStrip
          ariaLabel="Composição dos apontamentos"
          items={[
            { key: "items", label: "Apontamentos no período", value: formatInt(k.items), hint: "inconformidades de manutenção" },
            { key: "cancelled", label: "Cancelados", value: formatInt(k.itemsCancelled), hint: "fora das taxas" },
            { key: "in-maintenance", label: "Em manutenção", value: formatInt(k.itemsInMaintenance), hint: "cobertos por manutenção aberta" },
            { key: "plans", label: "Planos no período", value: formatInt(k.plansTotal), hint: `${formatInt(k.plansResolved)} resolvidos` },
          ]}
        />
      </Section>

      {/* ------------------------------------------------------- Onde está? */}
      <Section
        title="Onde está?"
        icon={<MapPin />}
        testId="overview-section-where"
        description="Planos em aberto por operação, cidade, liderança do checklist e cluster técnico."
      >
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <BarsCard
            title="Por operação"
            description={operations.length > opBars.length ? `${opBars.length} maiores de ${operations.length}` : "Planos em aberto · vencidos ao lado"}
            insight={
              topOp && opsOpen > 0
                ? `${topOp.label} concentra ${formatPct(share(topOp.open, opsOpen))} dos planos em aberto (${formatInt(topOp.open)} de ${formatInt(opsOpen)}).`
                : undefined
            }
            bars={opBars}
            ariaLabel={`Planos em aberto por operação, ${periodText}`}
            columns={["Operação", "Em aberto", "Vencidos", "Planos no período"]}
            format={chartFormat.int}
            emptyMessage="Sem planos no período."
            onDrill={drill}
            testId="overview-by-operation"
          />
          <BarsCard
            title="Por cluster técnico"
            description="Planos em aberto · total do período ao lado"
            bars={clusterBars}
            ariaLabel={`Planos em aberto por cluster técnico, ${periodText}`}
            columns={["Cluster", "Em aberto", "Planos no período", "Ocorrências"]}
            format={chartFormat.int}
            emptyMessage="Sem planos no período."
            onDrill={drill}
            testId="overview-by-cluster"
          />
          <BarsCard
            title="Por cidade"
            description="Até 15 cidades com mais planos em aberto"
            bars={cityBars}
            ariaLabel={`Planos em aberto por cidade, ${periodText}`}
            columns={["Cidade", "Em aberto", "Planos no período"]}
            format={chartFormat.int}
            emptyMessage="Sem planos no período."
            onDrill={drill}
            testId="overview-by-city"
          />
          <BarsCard
            title="Por liderança"
            description="Liderança registrada no checklist de origem · até 15"
            bars={leaderBars}
            ariaLabel={`Planos em aberto por liderança, ${periodText}`}
            columns={["Liderança", "Em aberto", "Planos no período"]}
            format={chartFormat.int}
            emptyMessage="Sem planos no período."
            onDrill={drill}
            testId="overview-by-leader"
          />
        </div>
      </Section>

      {/* ------------------------------------------------------- Prioridade */}
      <Section
        title="Qual a prioridade?"
        icon={<Flag />}
        testId="overview-section-priority"
        description="Planos em aberto por prioridade e a situação de todos os planos do período."
      >
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <BarsCard
            title="Por prioridade"
            description="Em aberto · total do período ao lado"
            insight={criticalOpen > 0 ? `${formatInt(criticalOpen)} ${plural(criticalOpen, "plano crítico em aberto", "planos críticos em aberto")}.` : "Nenhum plano crítico em aberto."}
            legend={PRIORITY_ORDER.map((p) => ({ key: p, label: PRIORITY_LABEL[p], color: TONE_COLOR[PRIORITY_TONE[p]] }))}
            bars={k.plansTotal > 0 ? priorityBars : []}
            ariaLabel={`Planos em aberto por prioridade, ${periodText}`}
            columns={["Prioridade", "Em aberto", "Planos no período"]}
            format={chartFormat.int}
            emptyMessage="Sem planos no período."
            onDrill={drill}
            testId="overview-by-priority"
          />
          <BarsCard
            title="Por situação"
            description="Todos os planos do período, na situação de hoje"
            bars={statusBars}
            ariaLabel={`Planos por situação, ${periodText}`}
            columns={["Situação", "Planos", "Participação"]}
            format={chartFormat.int}
            emptyMessage="Sem planos no período."
            onDrill={drill}
            testId="overview-by-status"
            labelWidth={184}
          />
        </div>
      </Section>

      {/* ------------------------------------------------------- Tratamento */}
      <Section
        title="Está sendo tratado?"
        icon={<Funnel />}
        testId="overview-section-treatment"
        description="Do recebimento à resolução, em apontamentos. A queda entre etapas mostra onde a fila para."
      >
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          <ChartCard
            title="Funil de tratamento"
            description="Recebidas → classificadas → em plano → tratativa definida → manutenção/outra resolução → resolvidas"
            insight={
              funnelWorst
                ? `Gargalo: ${formatInt(funnelWorst.drop)} ${plural(funnelWorst.drop, "apontamento", "apontamentos")} ${FUNNEL_STAGE[funnelWorst.key].stuck}.`
                : funnel.length > 0
                  ? "Sem fila parada entre as etapas de tratamento."
                  : undefined
            }
            empty={funnel.length === 0 || funnel.every((s) => s.value === 0) ? "Sem inconformidades no período." : undefined}
            data-testid="overview-funnel"
          >
            <TreatmentFunnel
              stages={funnel}
              damage={k.findingsDamage}
              notEligible={k.findingsNotEligible}
              link={(_, patch, history) => (history ? historyLink : patch ? plansLink(patch) : null)}
            />
          </ChartCard>

          <BarsCard
            title="Origem das resoluções"
            description="Apontamentos encerrados no período, por como foram resolvidos"
            insight={autoShare != null ? `${formatPct(autoShare)} das resoluções vieram da manutenção (baixa automática ou validada).` : undefined}
            bars={originBars}
            ariaLabel={`Apontamentos encerrados por origem da resolução, ${periodText}`}
            columns={["Origem", "Apontamentos", "Participação"]}
            format={chartFormat.int}
            emptyMessage="Nenhum apontamento encerrado no período."
            onDrill={drill}
            testId="overview-resolution-origin"
          />
        </div>
      </Section>

      {/* ------------------------------------------------------- Prazo */}
      <Section
        title="Está dentro do prazo?"
        icon={<CalendarClock />}
        testId="overview-section-deadline"
        description={`Faixas de prazo dos planos (SLA por prioridade ou prazo ajustado); "em breve" = próximos ${formatInt(soonDays)} dias. Aging: dias desde a 1ª ocorrência dos planos em aberto.`}
      >
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <BarsCard
            title="Faixas de prazo"
            description="Abertos (no prazo, vencidos, a vencer, sem prazo) e encerrados (no prazo ou fora)"
            insight={
              k.plansActive > 0
                ? `${formatInt(k.plansOverdue)} de ${formatInt(k.plansActive)} planos ativos estão vencidos (${formatPct(share(k.plansOverdue, k.plansActive))}).`
                : undefined
            }
            legend={[
              { key: "ok", label: "No prazo", color: C_SUCCESS },
              { key: "attention", label: "Atenção", color: C_WARNING },
              { key: "late", label: "Vencido / fora do prazo", color: C_DANGER },
              { key: "none", label: "Sem prazo", color: C_NEUTRAL },
            ]}
            bars={deadlineBars}
            ariaLabel={`Planos por faixa de prazo, ${periodText}`}
            columns={["Faixa de prazo", "Planos", "Participação"]}
            format={chartFormat.int}
            emptyMessage="Sem planos no período."
            onDrill={drill}
            testId="overview-deadline"
            labelWidth={180}
          />
          <ChartCard
            title="Aging dos planos em aberto"
            description="Dias desde a 1ª ocorrência"
            legend={
              <ChartLegend
                items={[
                  { key: "recent", label: "Até 30 dias", color: C_INFO },
                  { key: "attention", label: "31 a 90 dias", color: C_WARNING },
                  { key: "old", label: "Mais de 90 dias", color: C_DANGER },
                ]}
              />
            }
            insight={
              agingTotal > 0
                ? `${formatInt(agingOld)} ${plural(agingOld, "plano aberto há", "planos abertos há")} mais de 60 dias (${formatPct(share(agingOld, agingTotal))}).`
                : undefined
            }
            empty={agingTotal === 0 ? "Nenhum plano em aberto." : undefined}
            data-testid="overview-aging"
          >
            <ColumnChart
              ariaLabel="Planos em aberto por faixa de idade, em dias"
              kind="count"
              format={chartFormat.int}
              height={160}
              items={AGING.map((a) => {
                const value = agingMap.get(a.key) ?? 0;
                return {
                  key: a.key,
                  label: a.label,
                  value,
                  color: a.color,
                  tooltip: {
                    title: a.title,
                    subtitle: "Planos em aberto",
                    rows: [
                      { label: "Planos", value: formatInt(value), color: a.color, marker: "square" as const, emphasis: true },
                      { label: "Participação", value: formatPct(share(value, agingTotal)) },
                    ],
                    footer: "Clique para ver os em aberto, dos mais antigos.",
                    announce: `${a.title}: ${formatInt(value)} planos`,
                  },
                };
              })}
              onSelect={() => drill({ grupo: "open", ordenar: "age", dir: "desc" })}
            />
            <SrTable
              caption="Planos em aberto por faixa de idade"
              columns={["Faixa (dias)", "Planos", "Participação"]}
              rows={AGING.map((a) => {
                const value = agingMap.get(a.key) ?? 0;
                return { key: a.key, cells: [a.title, formatInt(value), formatPct(share(value, agingTotal))] };
              })}
            />
          </ChartCard>
        </div>
      </Section>

      {/* ------------------------------------------------------- Causa */}
      <Section
        title="Qual a causa?"
        icon={<ScanSearch />}
        testId="overview-section-cause"
        description="Os itens que mais falham, os veículos que mais voltam e onde a resolução demora."
      >
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <BarsCard
            title="Itens com mais falhas"
            description="Apontamentos no período · planos ao lado"
            bars={topItemBars}
            ariaLabel={`Itens com mais apontamentos, ${periodText}`}
            columns={["Item", "Apontamentos", "Planos", "Planos em aberto"]}
            format={chartFormat.int}
            emptyMessage="Sem apontamentos no período."
            onDrill={drill}
            testId="overview-top-items"
          />
          <BarsCard
            title="Veículos com reincidência"
            description="Ocorrências no período · possíveis reincidências ao lado"
            legend={[
              { key: "recurrent", label: "Com possível reincidência", color: C_WARNING },
              { key: "plain", label: "Sem reincidência", color: C_INFO },
            ]}
            actions={
              <CardLink link={plansLink({ reincidente: "1", grupo: null })} testId="overview-recurrence-link">
                Ver reincidências
              </CardLink>
            }
            bars={vehicleBars}
            ariaLabel={`Veículos com mais ocorrências e possíveis reincidências, ${periodText}`}
            columns={["Veículo", "Ocorrências", "Possíveis reincidências", "Planos em aberto"]}
            format={chartFormat.int}
            emptyMessage="Nenhum veículo com reincidência no período."
            onDrill={drill}
            testId="overview-top-vehicles"
          />
          <BarsCard
            title="TMR por prioridade"
            description="Dias até o encerramento · mediana ao lado"
            bars={tmrPriorityBars}
            ariaLabel={`Tempo médio de resolução por prioridade, ${periodText}`}
            columns={["Prioridade", "TMR médio", "TMR mediano", "Planos encerrados"]}
            format={formatDays}
            emptyMessage="Nenhum plano encerrado no período."
            onDrill={drill}
            testId="overview-tmr-priority"
          />
          <BarsCard
            title="TMR por cluster técnico"
            description="Dias até o encerramento · planos ao lado"
            bars={tmrClusterBars}
            ariaLabel={`Tempo médio de resolução por cluster técnico, ${periodText}`}
            columns={["Cluster", "TMR médio", "Planos encerrados"]}
            format={formatDays}
            emptyMessage="Nenhum plano encerrado no período."
            onDrill={drill}
            testId="overview-tmr-cluster"
          />
        </div>
      </Section>

      {/* ------------------------------------------------------- Resultado */}
      <Section
        title="Qual o resultado?"
        icon={<TrendingUp />}
        testId="overview-section-result"
        description={`Entrada × tratamento ${BUCKET_LABEL[period.bucket]}, o estoque de planos em aberto e a cobertura do mapeamento Pergunta × Serviço.`}
      >
        <ChartCard
          title="Novos × tratados"
          description="Apontamentos que entraram e que foram tratados em cada período; abaixo, o backlog de planos em aberto no fim de cada período"
          legend={<ChartLegend items={[
            { key: "new", label: SERIES_NEW_ITEMS.label, color: SERIES_NEW_ITEMS.color },
            { key: "treated", label: SERIES_TREATED.label, color: SERIES_TREATED.color },
            { key: "backlog", label: SERIES_BACKLOG.label, color: SERIES_BACKLOG.color, shape: "line" },
          ]} />}
          insight={
            hasFlow
              ? `Entraram ${formatInt(newItemsTotal)} e foram tratados ${formatInt(treatedItemsTotal)} apontamentos; o backlog foi de ${formatInt(backlogFirst)} para ${formatInt(backlogLast)} planos em aberto.`
              : undefined
          }
          empty={!hasFlow ? "Sem movimento no período." : undefined}
          data-testid="trend-chart"
        >
          <FlowChart
            points={flowRows.map((r) => ({ key: r.start, label: r.label, title: r.title, a: r.newItems, b: r.treatedItems, line: r.backlog }))}
            a={SERIES_NEW_ITEMS}
            b={SERIES_TREATED}
            line={SERIES_BACKLOG}
            ariaLabel={`Novos e tratados ${BUCKET_LABEL[period.bucket]}, com o backlog de planos em aberto, ${periodText}`}
            onSelect={(_, i) => flowDrill(i)}
          />
          <SrTable
            caption={`Novos e tratados ${BUCKET_LABEL[period.bucket]}, ${periodText}`}
            columns={["Período", "Novos apontamentos", "Apontamentos tratados", "Saldo", "Backlog (planos em aberto)"]}
            rows={flowRows.map((r) => ({
              key: r.start,
              cells: [r.title, formatInt(r.newItems), formatInt(r.treatedItems), signedInt(r.newItems - r.treatedItems), formatInt(r.backlog)],
            }))}
          />
        </ChartCard>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
          <ChartCard
            title="Planos novos × encerrados"
            description={`Planos abertos e encerrados ${BUCKET_LABEL[period.bucket]}`}
            legend={<ChartLegend items={[
              { key: "new", label: SERIES_NEW_PLANS.label, color: SERIES_NEW_PLANS.color },
              { key: "closed", label: SERIES_CLOSED_PLANS.label, color: SERIES_CLOSED_PLANS.color },
            ]} />}
            insight={
              hasFlow
                ? `${formatInt(newPlansTotal)} ${plural(newPlansTotal, "plano novo", "planos novos")} e ${formatInt(closedPlansTotal)} ${plural(closedPlansTotal, "encerrado", "encerrados")} no período (saldo ${signedInt(newPlansTotal - closedPlansTotal)}).`
                : undefined
            }
            empty={!hasFlow ? "Sem movimento no período." : undefined}
            data-testid="overview-plans-flow"
          >
            <FlowChart
              points={flowRows.map((r) => ({ key: r.start, label: r.label, title: r.title, a: r.newPlans, b: r.closedPlans, line: null }))}
              a={SERIES_NEW_PLANS}
              b={SERIES_CLOSED_PLANS}
              ariaLabel={`Planos novos e encerrados ${BUCKET_LABEL[period.bucket]}, ${periodText}`}
              onSelect={(_, i) => flowDrill(i)}
            />
            <SrTable
              caption={`Planos novos e encerrados ${BUCKET_LABEL[period.bucket]}, ${periodText}`}
              columns={["Período", "Planos novos", "Planos encerrados", "Saldo"]}
              rows={flowRows.map((r) => ({
                key: r.start,
                cells: [r.title, formatInt(r.newPlans), formatInt(r.closedPlans), signedInt(r.newPlans - r.closedPlans)],
              }))}
            />
          </ChartCard>

          <ChartCard
            title="Cobertura do mapeamento"
            description="Itens que geram plano com serviço ativo da Manutenção. Independe do período."
            actions={
              <CardLink link={mappingLink} testId="overview-coverage-link">
                Abrir mapeamento
              </CardLink>
            }
            insight={
              coverage.unmapped > 0
                ? `${formatInt(coverage.unmapped)} ${plural(coverage.unmapped, "item sem serviço mapeado", "itens sem serviço mapeado")}: sem baixa automática nem conciliação de alta confiança.`
                : coverage.actionKeys > 0
                  ? "Todos os itens que geram plano têm serviço mapeado."
                  : undefined
            }
            empty={coverage.actionKeys === 0 ? "Nenhum item configurado para gerar plano." : undefined}
            data-testid="overview-coverage"
          >
            <div className="flex flex-col gap-3">
              <p className="flex flex-wrap items-baseline gap-x-2">
                <span className="text-kpi-sm font-semibold tabular-nums text-fg">{formatPct(coverage.pct)}</span>
                <span className="text-caption text-fg-muted">
                  {formatInt(coverage.mapped)} de {formatInt(coverage.actionKeys)} itens com serviço mapeado
                </span>
              </p>
              <span aria-hidden className="flex h-3 w-full gap-0.5 overflow-hidden rounded-full bg-surface-sunken">
                {coverage.mapped > 0 ? <span className="h-full bg-chart-success" style={{ width: `${coveragePctMapped}%` }} /> : null}
                {coverage.unmapped > 0 ? <span className="h-full bg-chart-warning" style={{ width: `${coveragePctUnmapped}%` }} /> : null}
              </span>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-2.5">
                {[
                  { key: "mapped", label: "Mapeados", value: coverage.mapped, cls: "bg-chart-success", pct: share(coverage.mapped, coverage.actionKeys) },
                  { key: "unmapped", label: "Sem mapeamento", value: coverage.unmapped, cls: "bg-chart-warning", pct: share(coverage.unmapped, coverage.actionKeys) },
                  { key: "conflicting", label: "Em conflito", value: coverage.conflicting, cls: "bg-chart-danger", pct: share(coverage.conflicting, coverage.actionKeys) },
                  { key: "auto", label: "Baixa automática", value: coverage.autoResolve, cls: "bg-chart-brand-secondary", pct: share(coverage.autoResolve, coverage.actionKeys) },
                ].map((c) => (
                  <div key={c.key} className="flex min-w-0 flex-col gap-0.5" data-testid={`overview-coverage-${c.key}`}>
                    <dt className="flex items-center gap-1.5 text-caption text-fg-muted">
                      <span aria-hidden className={cn("size-2.5 shrink-0 rounded-[3px]", c.cls)} />
                      <span className="truncate">{c.label}</span>
                    </dt>
                    <dd className="text-body-sm font-semibold tabular-nums text-fg">
                      {formatInt(c.value)} <span className="font-normal text-fg-muted">· {formatPct(c.pct)}</span>
                    </dd>
                  </div>
                ))}
              </dl>
              {coverage.conflicting > 0 ? (
                <p className="text-caption text-fg-muted">
                  Em conflito: o item aponta para serviço inativo ou arquivado. Revise em Parâmetros &amp; Mapeamento.
                </p>
              ) : null}
            </div>
          </ChartCard>
        </div>
      </Section>
    </div>
  );
}
