"use client";

import * as React from "react";
import { usePathname, useSearchParams } from "next/navigation";
import {
  Activity, AlarmClock, CalendarCheck, CalendarClock, CalendarPlus, CalendarX, CircleCheck, ClipboardList, Gauge,
  Hourglass, Inbox, Repeat, ShieldAlert, ShieldCheck, Target, Timer, TimerOff, TriangleAlert, Truck, Wrench,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { Card, CardContent } from "@/components/ui/card";
import { KpiCard, type KpiCardProps, type KpiTrend } from "@/components/ui/kpi-card";
import {
  Table, TableBody, TableCell, TableContainer, TableEmpty, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { EmptyState } from "@/components/feedback/empty-state";
import { ErrorState } from "@/components/feedback/error-state";
import {
  formatDate,
  formatDays,
  formatInt,
  STATUS_LABEL,
  typeLabel,
  type MaintenanceCatalog,
  type MaintenanceDashboard,
  type MaintenanceFilters,
  type ScheduleQueue,
} from "@/lib/maintenance/types";
import {
  ChartLegend,
  ColumnChart,
  CountBarChart,
  InlineBar,
  StackedColumnChart,
  TYPE_SERIES,
  typeColor,
  type StackedColumnItem,
} from "./overview-charts";
import type { PanelActions } from "./shared";

/**
 * Manutenção → Visão geral.
 *
 * Três leituras numa tela: o período (tempo, volume, SLA), o agora (fila e
 * frota parada, sem recorte de período) e a preventiva/preditiva. Tudo chega
 * pronto de `maintenance_dashboard`; a tela só formata, compara com o período
 * anterior e leva cada número à fila que o explica.
 */

export interface OverviewPanelProps {
  dashboard: MaintenanceDashboard | null;
  filters: MaintenanceFilters;
  catalog: MaintenanceCatalog;
  actions: PanelActions;
}

const nf1 = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const MONTHS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const MONTHS_FULL = [
  "janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
];

/** Ao trocar de aba, a lista começa do zero: sem página, ordenação ou fila herdadas. */
const RESET: Record<string, null> = { pagina: null, ordenar: null, dir: null, visao: null, secao: null, fila: null };

/**
 * Fila "de agora" na Programação. O indicador não tem recorte de período, então
 * a fila também não: sai `de`/`ate`, e o número do cartão é o número da lista.
 */
const queuePatch = (fila: ScheduleQueue | null) => ({ ...RESET, aba: "programacao", de: null, ate: null, fila });

// ---------------------------------------------------------------------------
// Formatação e comparação (apresentação apenas)
// ---------------------------------------------------------------------------
const num1 = (v: number | null | undefined) => (v == null ? "—" : nf1.format(v));
const share = (part: number, whole: number) => (whole > 0 ? (part / whole) * 100 : null);
const formatPct = (v: number | null) => (v == null ? "—" : `${nf1.format(v)}%`);
const signed = (v: number) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${nf1.format(Math.abs(v))}`;

/** Variação relativa contra o período anterior. Sem base anterior, não há variação. */
function relativeTrend(cur: number | null, prev: number | null, positiveIsGood: boolean): KpiTrend | undefined {
  if (cur == null || prev == null || prev === 0) {
    return cur === 0 && prev === 0 ? { value: "0,0%", direction: "flat", positiveIsGood } : undefined;
  }
  const change = Math.round(((cur - prev) / prev) * 1000) / 10;
  if (change === 0) return { value: "0,0%", direction: "flat", positiveIsGood };
  return { value: `${signed(change)}%`, direction: change > 0 ? "up" : "down", positiveIsGood };
}

/** Diferença em pontos percentuais (para taxas). */
function pointsTrend(cur: number | null, prev: number | null): KpiTrend | undefined {
  if (cur == null || prev == null) return undefined;
  const diff = Math.round((cur - prev) * 10) / 10;
  if (diff === 0) return { value: "0,0 p.p.", direction: "flat" };
  return { value: `${signed(diff)} p.p.`, direction: diff > 0 ? "up" : "down", positiveIsGood: true };
}

function monthLabel(ym: string, full = false): string {
  const [y, m] = ym.split("-").map(Number);
  if (!y || !m) return ym;
  return full ? `${MONTHS_FULL[m - 1]}/${y}` : `${MONTHS[m - 1]}/${String(y).slice(2)}`;
}

/** Todos os meses do período, inclusive os sem manutenção: o eixo não pula meses. */
function monthRange(from: string, to: string): string[] {
  const [fy, fm] = from.slice(0, 7).split("-").map(Number);
  const [ty, tm] = to.slice(0, 7).split("-").map(Number);
  const out: string[] = [];
  if (!fy || !fm || !ty || !tm) return out;
  let y = fy;
  let m = fm;
  while ((y < ty || (y === ty && m <= tm)) && out.length < 120) {
    out.push(`${y}-${String(m).padStart(2, "0")}`);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Links entre abas
// ---------------------------------------------------------------------------
interface NavLink {
  href: string;
  onClick?: (event: React.MouseEvent<HTMLAnchorElement>) => void;
}

/**
 * Link de verdade (abre em nova aba, copia o endereço) que, no clique simples,
 * navega pela transição da tela — com o `pending` e o `aria-busy` de sempre.
 */
function useNavLink(actions: PanelActions) {
  const params = useSearchParams();
  const pathname = usePathname();
  return React.useCallback(
    (patch: Record<string, string | null>): NavLink => {
      const next = new URLSearchParams(params.toString());
      for (const [key, value] of Object.entries(patch)) {
        if (value === null || value === "") next.delete(key);
        else next.set(key, value);
      }
      next.delete("m");
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
// Blocos
// ---------------------------------------------------------------------------
function Section({
  id, title, description, children, testId,
}: { id?: string; title: string; description?: React.ReactNode; children: React.ReactNode; testId?: string }) {
  const headingId = React.useId();
  return (
    <section id={id} aria-labelledby={headingId} className="flex scroll-mt-4 flex-col gap-3" data-testid={testId}>
      <div className="flex flex-col gap-0.5">
        <h2 id={headingId} className="text-h4 font-semibold text-fg">{title}</h2>
        {description ? <p className="max-w-[80ch] text-caption text-fg-muted">{description}</p> : null}
      </div>
      {children}
    </section>
  );
}

function ChartCard({
  title, description, children, className, testId,
}: { title: string; description?: React.ReactNode; children: React.ReactNode; className?: string; testId?: string }) {
  return (
    <Card className={cn("min-w-0", className)} data-testid={testId}>
      <CardContent className="flex flex-col gap-3 p-4">
        <div>
          <h3 className="text-h4 font-semibold text-fg">{title}</h3>
          {description ? <p className="text-caption text-fg-muted">{description}</p> : null}
        </div>
        {children}
      </CardContent>
    </Card>
  );
}

function EmptyBlock({ title, description }: { title: string; description?: string }) {
  return <EmptyState size="sm" title={title} description={description} headingLevel={4} />;
}

/** O realce de hover do Card interativo, aplicado ao KpiCard dentro do link. */
const INTERACTIVE_KPI = cn(
  "cursor-pointer",
  "after:pointer-events-none after:absolute after:inset-0 after:rounded-[inherit] after:bg-hover-overlay after:opacity-0",
  "after:transition-opacity after:duration-(--duration-base) group-hover:after:opacity-100",
);

type KpiProps = Omit<KpiCardProps, "size"> & {
  testId: string;
  /** Leva à fila que explica o número. */
  nav?: NavLink;
  /** Para leitor de tela: para onde o link leva. */
  destination?: string;
};

/**
 * Um indicador. Os rótulos reservam duas linhas, para que os números da
 * fileira fiquem na mesma linha de base qualquer que seja o tamanho do nome.
 */
function Kpi({ testId, nav, destination, label, className, ...card }: KpiProps) {
  const body = (
    <KpiCard
      size="compact"
      label={<span className="block min-h-9 leading-snug">{label}</span>}
      className={cn("h-full justify-start", nav && INTERACTIVE_KPI, className)}
      data-testid={nav ? undefined : testId}
      {...card}
    />
  );
  if (!nav) return body;
  return (
    <a
      href={nav.href}
      onClick={nav.onClick}
      className="group block h-full rounded-md hfm-focus-ring"
      data-testid={testId}
    >
      {body}
      {destination ? <span className="sr-only">. {destination}</span> : null}
    </a>
  );
}

// ---------------------------------------------------------------------------
// Painel
// ---------------------------------------------------------------------------
export function OverviewPanel({ dashboard, filters, catalog, actions }: OverviewPanelProps) {
  const link = useNavLink(actions);

  if (!dashboard) {
    return (
      <ErrorState
        variant="panel"
        title="Não foi possível carregar a visão geral."
        description="A leitura dos indicadores falhou. Os filtros continuam valendo; tente de novo em instantes."
        onRetry={actions.refresh}
        retryLabel="Tentar de novo"
        retrying={actions.pending}
        data-testid="maintenance-overview-error"
      />
    );
  }

  const { period, recurrenceWindowDays } = dashboard;
  const k = dashboard.kpis;
  const p = dashboard.previous;
  const settings = catalog.settings;
  const monthly = dashboard.monthly ?? [];
  const mix = dashboard.mix ?? [];
  const statuses = dashboard.statuses ?? [];
  const aging = dashboard.aging ?? [];
  const clusters = dashboard.clusters ?? [];
  const services = dashboard.services ?? [];
  const suppliers = dashboard.suppliers ?? [];
  const recurrence = dashboard.recurrence ?? [];
  const typeName = (code: string) => typeLabel(code, catalog.types.find((t) => t.code === code)?.name);

  // Tempo e volume
  const slaPct = share(k.slaWithin, k.completed);
  const prevSlaPct = share(p.slaWithin, p.completed);

  // Frota e fila agora
  const available = Math.max(0, k.activeVehicles - k.immobilizedVehicles);
  const immobilizedPct = share(k.immobilizedVehicles, k.activeVehicles);
  const availablePct = share(available, k.activeVehicles);

  // Preventiva
  const adherenceDone = k.preventiveEarly + k.preventiveOnTime + k.preventiveLate;

  // Volume mensal: o eixo cobre o período inteiro; "outros tipos" só aparece se existir.
  const byMonth = new Map(monthly.map((m) => [m.month, m]));
  const months = Array.from(new Set([...monthRange(period.from, period.to), ...byMonth.keys()])).sort();
  const monthRows = months.map((month) => {
    const m = byMonth.get(month);
    const preventive = m?.preventive ?? 0;
    const corrective = m?.corrective ?? 0;
    const predictive = m?.predictive ?? 0;
    const total = m?.total ?? 0;
    return { month, preventive, corrective, predictive, other: Math.max(0, total - preventive - corrective - predictive), total };
  });
  const hasOther = monthRows.some((r) => r.other > 0);
  const monthSeries = TYPE_SERIES.filter((s) => s.key !== "other" || hasOther);
  const monthTotal = monthRows.reduce((acc, r) => acc + r.total, 0);
  const monthItems: StackedColumnItem[] = monthRows.map((r) => ({
    key: r.month,
    label: monthLabel(r.month),
    title: `${monthLabel(r.month, true)}: ${formatInt(r.total)} manutenções · ${monthSeries
      .map((s) => `${s.label} ${formatInt(r[s.key as "preventive" | "corrective" | "predictive" | "other"])}`)
      .join(" · ")}`,
    values: { preventive: r.preventive, corrective: r.corrective, predictive: r.predictive, other: r.other },
    total: r.total,
  }));

  const clusterMax = clusters.reduce((acc, c) => Math.max(acc, c.count), 0);
  const serviceMax = services.reduce((acc, s) => Math.max(acc, s.count), 0);
  const supplierMax = suppliers.reduce((acc, s) => Math.max(acc, s.count), 0);
  const periodText = `${formatDate(period.from)} a ${formatDate(period.to)}`;

  return (
    <div className="flex flex-col gap-6" data-testid="maintenance-overview">
      <p className="text-body-sm text-fg-muted" data-testid="maintenance-overview-period">
        Período <span className="font-medium text-fg-secondary tabular-nums">{periodText}</span> ({formatInt(period.days)} dias
        {!filters.from && !filters.to ? ", padrão de 6 meses" : ""}) · comparado com{" "}
        <span className="tabular-nums">{formatDate(period.previousFrom)} a {formatDate(period.previousTo)}</span> · hoje{" "}
        <span className="tabular-nums">{formatDate(period.today)}</span>
      </p>

      {/* ------------------------------------------------------------- Período */}
      <Section
        title="Tempo e volume"
        testId="maintenance-overview-period-kpis"
        description={
          <>
            TMM é a média de (saída real − entrada real) das manutenções concluídas com saída no período; a data de
            solicitação nunca entra no cálculo. P90: 90% das corretivas concluídas saíram em até esse prazo. SLA é a
            soma das horas previstas dos serviços ou, sem previsão, o padrão de {formatInt(settings.defaultSlaHours)} h.
          </>
        }
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6">
          <Kpi
            testId="maintenance-kpi-tmm"
            label="TMM"
            value={num1(k.tmmDays)}
            unit={k.tmmDays == null ? undefined : `dias · ${num1(k.tmmHours)} h`}
            trend={relativeTrend(k.tmmDays, p.tmmDays, false)}
            period={`anterior: ${formatDays(p.tmmDays)}`}
            icon={<Timer />}
          />
          <Kpi
            testId="maintenance-kpi-tmm-corrective"
            label="TMM corretivo"
            value={num1(k.tmmCorrectiveDays)}
            unit={k.tmmCorrectiveDays == null ? undefined : "dias"}
            trend={relativeTrend(k.tmmCorrectiveDays, p.tmmCorrectiveDays, false)}
            period={`anterior: ${formatDays(p.tmmCorrectiveDays)}`}
            icon={<Wrench />}
          />
          <Kpi
            testId="maintenance-kpi-p90"
            label="P90 corretivo"
            value={num1(k.tmmCorrectiveP90Days)}
            unit={k.tmmCorrectiveP90Days == null ? undefined : "dias"}
            trend={relativeTrend(k.tmmCorrectiveP90Days, p.tmmCorrectiveP90Days, false)}
            period={`anterior: ${formatDays(p.tmmCorrectiveP90Days)}`}
            icon={<Gauge />}
          />
          <Kpi
            testId="maintenance-kpi-volume"
            label="Volume"
            value={formatInt(k.volume)}
            unit="manut."
            trend={relativeTrend(k.volume, p.volume, false)}
            period={`anterior: ${formatInt(p.volume)}`}
            icon={<ClipboardList />}
          />
          <Kpi
            testId="maintenance-kpi-downtime"
            label="Downtime (horas paradas)"
            value={num1(k.downtimeHours)}
            unit="h"
            trend={relativeTrend(k.downtimeHours, p.downtimeHours, false)}
            period={`anterior: ${num1(p.downtimeHours)} h`}
            icon={<TimerOff />}
          />
          <Kpi
            testId="maintenance-kpi-sla"
            label="Dentro do SLA"
            value={slaPct == null ? "—" : nf1.format(slaPct)}
            unit={slaPct == null ? undefined : "%"}
            trend={pointsTrend(slaPct, prevSlaPct)}
            period={k.completed > 0 ? `${formatInt(k.slaWithin)} de ${formatInt(k.completed)} concluídas` : "sem concluídas no período"}
            icon={<ShieldCheck />}
          />
        </div>
      </Section>

      {/* ---------------------------------------------------------------- Agora */}
      <Section
        title="Frota e fila agora"
        testId="maintenance-overview-now-kpis"
        description={
          <>
            Fila em aberto hoje ({formatDate(period.today)}), sem o recorte de período. Os indicadores com link abrem a
            fila correspondente em Programação & execução.
          </>
        }
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Kpi
            testId="maintenance-kpi-immobilized"
            label="Frota imobilizada"
            value={formatInt(k.immobilizedVehicles)}
            unit={`de ${formatInt(k.activeVehicles)}`}
            status={k.immobilizedVehicles > 0 ? "warning" : undefined}
            period={`${formatPct(immobilizedPct)} da frota · ${formatInt(k.ongoingDowntimeHours)} h paradas`}
            icon={<Truck />}
          />
          <Kpi
            testId="maintenance-kpi-available"
            label="Frota disponível"
            value={formatInt(available)}
            unit={`de ${formatInt(k.activeVehicles)}`}
            period={`${formatPct(availablePct)} da frota ativa no escopo`}
            icon={<CircleCheck />}
          />
          <Kpi
            testId="maintenance-kpi-open"
            label="Em aberto"
            value={formatInt(k.open)}
            period={`${formatInt(k.inProgress)} em execução · ${formatInt(k.toSchedule)} há agendar`}
            icon={<Inbox />}
            nav={link(queuePatch(null))}
            destination="Abrir a fila em aberto na Programação"
          />
          <Kpi
            testId="maintenance-kpi-scheduled-today"
            label="Agendadas hoje"
            value={formatInt(k.scheduledToday)}
            period={`de ${formatInt(k.scheduled)} agendadas`}
            icon={<CalendarCheck />}
            nav={link(queuePatch("scheduled_today"))}
            destination="Abrir a fila de agendadas hoje"
          />
          <Kpi
            testId="maintenance-kpi-late-entry"
            label="Atrasadas para entrada"
            value={formatInt(k.lateEntry)}
            status={k.lateEntry > 0 ? "warning" : undefined}
            period="agendadas com data passada"
            icon={<CalendarX />}
            nav={link(queuePatch("late_entry"))}
            destination="Abrir a fila de atrasadas para entrada"
          />
          <Kpi
            testId="maintenance-kpi-exit-overdue"
            label="Previsão de saída vencida"
            value={formatInt(k.exitOverdue)}
            status={k.exitOverdue > 0 ? "danger" : undefined}
            period="em execução, saída prevista vencida"
            icon={<AlarmClock />}
            nav={link(queuePatch("exit_overdue"))}
            destination="Abrir a fila de previsão de saída vencida"
          />
          <Kpi
            testId="maintenance-kpi-unscheduled-overdue"
            label="Vencidas sem agendamento"
            value={formatInt(k.unscheduledOverdue)}
            status={k.unscheduledOverdue > 0 ? "warning" : undefined}
            period={`há agendar há mais de ${formatInt(settings.scheduleOverdueDays)} dias`}
            icon={<CalendarClock />}
            nav={link(queuePatch("unscheduled_overdue"))}
            destination="Abrir a fila de vencidas sem agendamento"
          />
          <Kpi
            testId="maintenance-kpi-backlog"
            label="Backlog > 7 dias"
            value={formatInt(k.backlog7d)}
            status={k.backlog7d > 0 ? "warning" : undefined}
            period="abertas há mais de 7 dias"
            icon={<Hourglass />}
          />
        </div>
      </Section>

      {/* ------------------------------------------------ Preventiva e preditiva */}
      <Section
        title="Preventiva e preditiva"
        testId="maintenance-overview-plans-kpis"
        description="Situação de hoje dos ciclos preventivos e dos itens preditivos da frota ativa no seu escopo. A aderência conta as preventivas realizadas no período."
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6">
          <Kpi
            testId="maintenance-kpi-preventive-critical"
            label="Preventivas críticas"
            value={formatInt(k.preventiveCritical)}
            status={k.preventiveCritical > 0 ? "danger" : undefined}
            period="ciclos em estado crítico"
            icon={<ShieldAlert />}
            nav={link({ ...RESET, aba: "preventiva", mp_situacao: "critical" })}
            destination="Abrir a Preventiva filtrada em críticas"
          />
          <Kpi
            testId="maintenance-kpi-preventive-due"
            label="Preventivas vencidas"
            value={formatInt(k.preventiveDue)}
            status={k.preventiveDue > 0 ? "warning" : undefined}
            period="ciclos vencidos"
            icon={<TriangleAlert />}
            nav={link({ ...RESET, aba: "preventiva", mp_situacao: "due" })}
            destination="Abrir a Preventiva filtrada em vencidas"
          />
          <Kpi
            testId="maintenance-kpi-preventive-to-schedule"
            label="Preventivas a programar"
            value={formatInt(k.preventiveToSchedule)}
            period="ciclos na faixa de programar"
            icon={<CalendarPlus />}
            nav={link({ ...RESET, aba: "preventiva", mp_situacao: "to_schedule" })}
            destination="Abrir a Preventiva filtrada em a programar"
          />
          <Kpi
            testId="maintenance-kpi-preventive-adherence"
            label="Aderência preventiva no período"
            value={formatInt(k.preventiveOnTime)}
            unit="no prazo"
            period={
              adherenceDone > 0
                ? `${formatInt(k.preventiveEarly)} antecipadas · ${formatInt(k.preventiveLate)} atrasadas`
                : "nenhuma realizada no período"
            }
            icon={<Target />}
          />
          <Kpi
            testId="maintenance-kpi-predictive-critical"
            label="Preditivas críticas"
            value={formatInt(k.predictiveCritical)}
            status={k.predictiveCritical > 0 ? "danger" : undefined}
            period="itens críticos ou vencidos"
            icon={<Activity />}
            nav={link({ ...RESET, aba: "preditiva", pd_situacao: "critical,due" })}
            destination="Abrir a Preditiva filtrada em críticos"
          />
          <Kpi
            testId="maintenance-kpi-recurrence"
            label="Possível reincidência"
            value={formatInt(k.recurrences)}
            unit="manut."
            status={k.recurrences > 0 ? "warning" : undefined}
            trend={relativeTrend(k.recurrences, p.recurrences, false)}
            period={`${formatInt(k.recurrentVehicles)} veículos · janela de ${formatInt(recurrenceWindowDays)} dias`}
            icon={<Repeat />}
            nav={{ href: "#maintenance-overview-recurrence" }}
            destination="Ir para a tabela de possível reincidência"
          />
        </div>
      </Section>

      {/* --------------------------------------------------------- Distribuição */}
      <Section title="Volume e distribuição" testId="maintenance-overview-distribution">
        <ChartCard
          title="Volume mensal por tipo"
          description="Manutenções não canceladas, pelo mês de referência (entrada, agendamento ou solicitação)."
          testId="maintenance-overview-monthly"
        >
          {monthTotal > 0 ? (
            <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
              <div className="flex min-w-0 flex-col gap-2">
                <ChartLegend series={monthSeries} />
                <StackedColumnChart
                  items={monthItems}
                  series={monthSeries}
                  ariaLabel={`Volume mensal de manutenções por tipo, ${periodText}. Valores na tabela ao lado.`}
                />
              </div>
              <TableContainer tabIndex={0} className="self-start">
                <Table className="min-w-[26rem]">
                  <TableHeader>
                    <TableRow>
                      <TableHead>Mês</TableHead>
                      {monthSeries.map((s) => (
                        <TableHead key={s.key} numeric>{s.label}</TableHead>
                      ))}
                      <TableHead numeric>Total</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {monthRows.map((r) => (
                      <TableRow key={r.month}>
                        <TableCell className="font-medium text-fg">{monthLabel(r.month, true)}</TableCell>
                        {monthSeries.map((s) => (
                          <TableCell key={s.key} numeric>
                            {formatInt(r[s.key as "preventive" | "corrective" | "predictive" | "other"])}
                          </TableCell>
                        ))}
                        <TableCell numeric className="font-semibold text-fg">{formatInt(r.total)}</TableCell>
                      </TableRow>
                    ))}
                    <TableRow className="bg-surface-secondary font-semibold">
                      <TableCell className="text-fg">Total do período</TableCell>
                      {monthSeries.map((s) => (
                        <TableCell key={s.key} numeric>
                          {formatInt(monthRows.reduce((acc, r) => acc + r[s.key as "preventive" | "corrective" | "predictive" | "other"], 0))}
                        </TableCell>
                      ))}
                      <TableCell numeric className="text-fg">{formatInt(monthTotal)}</TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </TableContainer>
            </div>
          ) : (
            <EmptyBlock
              title="Sem manutenções no período"
              description="Nenhuma manutenção não cancelada tem referência entre as datas escolhidas. Amplie o período ou limpe os filtros."
            />
          )}
        </ChartCard>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          <ChartCard title="Mix por tipo" description="Manutenções não canceladas no período." testId="maintenance-overview-mix">
            {mix.length > 0 ? (
              <CountBarChart
                items={mix.map((m) => ({ key: m.type, label: typeName(m.type), value: m.count, color: typeColor(m.type) }))}
                ariaLabel={`Manutenções por tipo, ${periodText}`}
                dimensionLabel="Tipo"
              />
            ) : (
              <EmptyBlock title="Sem manutenções no período" />
            )}
          </ChartCard>

          <ChartCard title="Por situação" description="Todas as manutenções do período, inclusive canceladas." testId="maintenance-overview-statuses">
            {statuses.length > 0 ? (
              <CountBarChart
                items={statuses.map((s) => ({ key: s.status, label: STATUS_LABEL[s.status] ?? s.status, value: s.count }))}
                ariaLabel={`Manutenções por situação, ${periodText}`}
                dimensionLabel="Situação"
              />
            ) : (
              <EmptyBlock title="Sem manutenções no período" />
            )}
          </ChartCard>

          <ChartCard
            title="Aging das abertas"
            description="Em aberto hoje, por dias desde a entrada (ou, sem entrada, desde a solicitação). Faixas configuráveis em Cadastros."
            className="md:col-span-2 xl:col-span-1"
            testId="maintenance-overview-aging"
          >
            {aging.length > 0 && aging.some((a) => a.count > 0) ? (
              <ColumnChart
                items={aging.map((a) => ({ key: a.bucket, label: a.bucket, value: a.count }))}
                ariaLabel="Manutenções em aberto por faixa de idade"
                dimensionLabel="Faixa de idade"
              />
            ) : (
              <EmptyBlock title="Nenhuma manutenção em aberto" description="Não há fila em aberto no escopo e nos filtros atuais." />
            )}
          </ChartCard>
        </div>
      </Section>

      {/* ------------------------------------------ Clusters, serviços, fornecedores */}
      <Section
        title="Clusters, serviços e fornecedores"
        testId="maintenance-overview-rankings"
        description="Volume no período e TMM das concluídas (entrada real → saída real), em dias."
      >
        <ChartCard title="Volume × TMM por cluster" testId="maintenance-overview-clusters">
          <TableContainer tabIndex={0}>
            <Table className="min-w-[36rem]">
              <TableHeader>
                <TableRow>
                  <TableHead>Cluster</TableHead>
                  <TableHead className="w-[38%]">Volume</TableHead>
                  <TableHead numeric>Concluídas</TableHead>
                  <TableHead numeric>TMM médio</TableHead>
                  <TableHead numeric>TMM mediano</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {clusters.length === 0 ? (
                  <TableEmpty colSpan={5} message="Sem serviços lançados no período." />
                ) : (
                  clusters.map((c) => (
                    <TableRow key={c.cluster}>
                      <TableCell className="font-medium text-fg"><span className="block max-w-[16rem] truncate" title={c.cluster}>{c.cluster}</span></TableCell>
                      <TableCell>
                        <span className="flex items-center gap-2">
                          <span className="w-10 shrink-0 text-right tabular-nums">{formatInt(c.count)}</span>
                          <InlineBar value={c.count} max={clusterMax} />
                        </span>
                      </TableCell>
                      <TableCell numeric>{formatInt(c.completed)}</TableCell>
                      <TableCell numeric>{formatDays(c.tmmDays)}</TableCell>
                      <TableCell numeric>{formatDays(c.tmmMedianDays)}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </TableContainer>
        </ChartCard>

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          <ChartCard title="Top serviços" description="Serviços mais lançados no período." testId="maintenance-overview-services">
            <TableContainer tabIndex={0}>
              <Table className="min-w-[32rem]">
                <TableHeader>
                  <TableRow>
                    <TableHead>Serviço</TableHead>
                    <TableHead>Cluster</TableHead>
                    <TableHead className="w-[30%]">Volume</TableHead>
                    <TableHead numeric>TMM</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {services.length === 0 ? (
                    <TableEmpty colSpan={4} message="Sem serviços lançados no período." />
                  ) : (
                    services.map((s) => (
                      <TableRow key={`${s.service}|${s.cluster}`}>
                        <TableCell className="font-medium text-fg"><span className="block max-w-[14rem] truncate" title={s.service}>{s.service}</span></TableCell>
                        <TableCell className="text-fg-secondary"><span className="block max-w-[10rem] truncate" title={s.cluster}>{s.cluster}</span></TableCell>
                        <TableCell>
                          <span className="flex items-center gap-2">
                            <span className="w-8 shrink-0 text-right tabular-nums">{formatInt(s.count)}</span>
                            <InlineBar value={s.count} max={serviceMax} />
                          </span>
                        </TableCell>
                        <TableCell numeric>{formatDays(s.tmmDays)}</TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </TableContainer>
          </ChartCard>

          <ChartCard title="Top fornecedores" description="Fornecedores com mais manutenções no período." testId="maintenance-overview-suppliers">
            <TableContainer tabIndex={0}>
              <Table className="min-w-[34rem]">
                <TableHeader>
                  <TableRow>
                    <TableHead>Fornecedor</TableHead>
                    <TableHead className="w-[30%]">Volume</TableHead>
                    <TableHead numeric>Concluídas</TableHead>
                    <TableHead numeric>Abertas</TableHead>
                    <TableHead numeric>TMM</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {suppliers.length === 0 ? (
                    <TableEmpty colSpan={5} message="Nenhuma manutenção com fornecedor no período." />
                  ) : (
                    suppliers.map((s) => (
                      <TableRow key={s.supplier}>
                        <TableCell className="font-medium text-fg"><span className="block max-w-[14rem] truncate" title={s.supplier}>{s.supplier}</span></TableCell>
                        <TableCell>
                          <span className="flex items-center gap-2">
                            <span className="w-8 shrink-0 text-right tabular-nums">{formatInt(s.count)}</span>
                            <InlineBar value={s.count} max={supplierMax} />
                          </span>
                        </TableCell>
                        <TableCell numeric>{formatInt(s.completed)}</TableCell>
                        <TableCell numeric>{formatInt(s.open)}</TableCell>
                        <TableCell numeric>{formatDays(s.tmmDays)}</TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </TableContainer>
          </ChartCard>
        </div>
      </Section>

      {/* ----------------------------------------------------- Reincidência */}
      <Section
        id="maintenance-overview-recurrence"
        title="Possível reincidência"
        testId="maintenance-overview-recurrence"
        description={
          <>
            Mesmo veículo com nova manutenção no mesmo cluster técnico em até {formatInt(recurrenceWindowDays)} dias. É um
            sinal para investigar, não um defeito ou retrabalho confirmado. Até 30 combinações de veículo e cluster; a placa
            abre as manutenções do veículo na Base geral.
          </>
        }
      >
        <TableContainer tabIndex={0}>
          <Table className="min-w-[40rem]">
            <TableHeader>
              <TableRow>
                <TableHead>Placa</TableHead>
                <TableHead>Cluster</TableHead>
                <TableHead numeric>Ocorrências</TableHead>
                <TableHead numeric>Mesmo serviço</TableHead>
                <TableHead numeric>Intervalo médio (dias)</TableHead>
                <TableHead numeric>Última</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {recurrence.length === 0 ? (
                <TableEmpty
                  colSpan={6}
                  message={`Nenhuma possível reincidência no período (janela de ${formatInt(recurrenceWindowDays)} dias).`}
                />
              ) : (
                recurrence.map((r) => {
                  const plate = r.licensePlate || "Sem placa";
                  const nav = link({ ...RESET, aba: "base", veiculo: r.vehicleId });
                  return (
                    <TableRow key={`${r.vehicleId}|${r.cluster}`}>
                      <TableCell>
                        <a
                          href={nav.href}
                          onClick={nav.onClick}
                          className="rounded-xs font-medium text-link hover:text-link-hover hover:underline hfm-focus-ring"
                          aria-label={`${plate}: ver as manutenções do veículo na Base geral`}
                          data-testid="maintenance-overview-recurrence-plate"
                        >
                          {plate}
                        </a>
                      </TableCell>
                      <TableCell className="text-fg-secondary"><span className="block max-w-[14rem] truncate" title={r.cluster}>{r.cluster}</span></TableCell>
                      <TableCell numeric className="font-semibold text-fg">{formatInt(r.recurrences)}</TableCell>
                      <TableCell numeric>{formatInt(r.sameService)}</TableCell>
                      <TableCell numeric>{num1(r.avgIntervalDays)}</TableCell>
                      <TableCell numeric>{formatDate(r.last)}</TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </TableContainer>
      </Section>
    </div>
  );
}
